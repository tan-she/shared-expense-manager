/**
 * services/importengine/CsvImportEngine.js
 *
 * Directs the entire CSV ingestion pipeline:
 *   1. Custom quote-aware CSV parser.
 *   2. Gathers group members and existing expenses database context.
 *   3. Evaluates rows via AnomalyDetectionService.
 *   4. Stages results in import_sessions and import_anomalies tables.
 *   5. Commits a staged session to the standard database tables atomically.
 *
 * Design Pattern: Facade Pattern / Pipeline Orchestrator
 */

import pool from '../../config/db.js';
import AnomalyDetectionService from './AnomalyDetectionService.js';
import CurrencyService from '../CurrencyService.js';
import EqualSplitStrategy from '../splitstrategy/EqualSplitStrategy.js';
import PercentageSplitStrategy from '../splitstrategy/PercentageSplitStrategy.js';
import ExactAmountSplitStrategy from '../splitstrategy/ExactAmountSplitStrategy.js';
import { createError } from '../../middleware/errorHandler.js';

const strategies = {
  EQUAL: new EqualSplitStrategy(),
  PERCENTAGE: new PercentageSplitStrategy(),
  EXACT: new ExactAmountSplitStrategy()
};

class CsvImportEngine {
  /**
   * Custom CSV parser that handles commas inside quotes.
   * Format: Date,Description,Amount,Currency,PayerEmail,SplitType,ParticipantsSplits
   */
  parseCsv(csvString) {
    const lines = csvString.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length <= 1) {
      throw createError(400, 'The uploaded CSV file is empty.');
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const parsedRows = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const cells = this.parseCsvLine(line);

      if (cells.length < headers.length) {
        continue; // Skip malformed rows
      }

      const row = {};
      headers.forEach((h, idx) => {
        row[h] = cells[idx];
      });

      parsedRows.push(row);
    }

    return parsedRows;
  }

  /**
   * Helper that splits a string by commas, respecting double quotes.
   */
  parseCsvLine(line) {
    const result = [];
    let currentCell = '';
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        result.push(currentCell.trim());
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
    result.push(currentCell.trim());
    return result;
  }

  /**
   * Stages the CSV upload by evaluating it and saving to DB.
   */
  async stageImport(userId, groupId, fileName, csvContent) {
    // 1. Parse CSV
    const rows = this.parseCsv(csvContent);

    // 2. Fetch context (group members and existing group expenses)
    const membersResult = await pool.query(
      `SELECT gm.user_id, u.name, u.email, gm.joined_at, gm.left_at
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1`,
      [groupId]
    );
    const groupMembers = membersResult.rows;

    const expensesResult = await pool.query(
      `SELECT e.id, e.payer_id, u.email AS payer_email, e.description, e.amount, e.expense_date
       FROM expenses e
       JOIN users u ON u.id = e.payer_id
       WHERE e.group_id = $1 AND e.status = 'ACTIVE'`,
      [groupId]
    );
    const existingExpenses = expensesResult.rows;

    const context = {
      groupMembers,
      existingExpenses,
      allRows: rows
    };

    // 3. Stage the Import Session in DB
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const sessionResult = await client.query(
        `INSERT INTO import_sessions (user_id, group_id, file_name, status, rows_processed, csv_data)
         VALUES ($1, $2, $3, 'PENDING', $4, $5)
         RETURNING id, file_name, status, rows_processed, imported_at`,
        [userId, groupId, fileName, rows.length, JSON.stringify(rows)]
      );
      const session = sessionResult.rows[0];

      let totalAnomaliesCount = 0;

      // 4. Run anomaly detection and stage findings
      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        const rowContext = { ...context, currentRowIndex: idx };
        const anomalies = AnomalyDetectionService.detectAnomalies(row, rowContext);

        for (const anomaly of anomalies) {
          totalAnomaliesCount++;
          await client.query(
            `INSERT INTO import_anomalies (import_session_id, row_number, anomaly_type, severity, description)
             VALUES ($1, $2, $3, $4, $5)`,
            [session.id, idx + 1, anomaly.anomaly_type, anomaly.severity, anomaly.description]
          );
        }
      }

      await client.query('COMMIT');
      return {
        session,
        anomaliesCount: totalAnomaliesCount
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Commits the import session to actual database tables after user review.
   *
   * @param {number} sessionId - The staged import session
   * @param {Array<object>} resolutions - Array of { row_number, action: 'IMPORT' | 'SKIP' | 'FIX', fix_data: object }
   */
  async commitImport(sessionId, resolutions = []) {
    const sessionResult = await pool.query(
      `SELECT id, group_id, csv_data, status FROM import_sessions WHERE id = $1`,
      [sessionId]
    );
    if (sessionResult.rows.length === 0) {
      throw createError(404, 'Import session not found.');
    }

    const session = sessionResult.rows[0];
    if (session.status !== 'PENDING') {
      throw createError(400, `Import session has already been processed (status: ${session.status}).`);
    }

    const groupId = session.group_id;
    const rows = session.csv_data; // JSON parsed rows array

    // Gather active group members map for email-to-id mapping
    const membersResult = await pool.query(
      `SELECT gm.user_id, u.email FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1`,
      [groupId]
    );
    const emailToIdMap = {};
    membersResult.rows.forEach(m => {
      emailToIdMap[m.email.toLowerCase().trim()] = m.user_id;
    });

    const client = await pool.connect();
    let rowsImported = 0;
    let rowsSkipped = 0;

    try {
      await client.query('BEGIN');

      for (let i = 0; i < rows.length; i++) {
        const rowNumber = i + 1;
        const resolution = resolutions.find(r => r.row_number === rowNumber) || { action: 'IMPORT' };

        if (resolution.action === 'SKIP') {
          rowsSkipped++;
          await client.query(
            `UPDATE import_anomalies SET action_taken = 'SKIPPED_BY_USER', approved = true
             WHERE import_session_id = $1 AND row_number = $2`,
            [sessionId, rowNumber]
          );
          continue;
        }

        // Apply edits if action is 'FIX'
        const row = resolution.action === 'FIX' && resolution.fix_data
          ? { ...rows[i], ...resolution.fix_data }
          : rows[i];

        // Map payer email to database ID
        const payerEmail = row.PayerEmail?.toLowerCase().trim();
        const payerId = emailToIdMap[payerEmail];
        if (!payerId) {
          throw createError(400, `Row #${rowNumber} Payer email (${payerEmail}) does not belong to any active group member.`);
        }

        const amount = parseFloat(row.Amount);
        const currency = row.Currency?.toUpperCase().trim();
        const splitType = row.SplitType?.toUpperCase().trim();
        const date = new Date(row.Date);

        // Convert currency parameters
        const exchangeRate = CurrencyService.getRate(currency);
        const convertedAmount = CurrencyService.convertToBase(amount, currency);

        // Parse participants splits
        // EQUAL splits: email1;email2
        // PERCENTAGE/EXACT splits: email1:value;email2:value
        const splitPairs = row.ParticipantsSplits?.split(';').filter(s => s.trim() !== '') || [];
        const splitsInput = splitPairs.map(pair => {
          if (splitType === 'EQUAL') {
            const email = pair.toLowerCase().trim();
            const userId = emailToIdMap[email];
            if (!userId) throw createError(400, `Unknown participant email "${email}" in Row #${rowNumber}.`);
            return { user_id: userId };
          } else {
            const parts = pair.split(':');
            const email = parts[0].toLowerCase().trim();
            const value = parseFloat(parts[1]);
            const userId = emailToIdMap[email];
            if (!userId) throw createError(400, `Unknown participant email "${email}" in Row #${rowNumber}.`);
            return { user_id: userId, value };
          }
        });

        // Run split strategy calculation
        const strategy = strategies[splitType];
        if (!strategy) {
          throw createError(400, `Unsupported split type: ${splitType} in Row #${rowNumber}.`);
        }

        const calculatedSplits = strategy.calculate(convertedAmount, splitsInput, payerId);

        // Save expense record (marking as DRAFT first if needed, but committing commits it as ACTIVE)
        const expenseResult = await client.query(
          `INSERT INTO expenses (group_id, payer_id, description, amount, currency, expense_date, split_type, exchange_rate, converted_amount, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')
           RETURNING id`,
          [groupId, payerId, row.Description.trim(), amount, currency, date, splitType, exchangeRate, convertedAmount]
        );
        const expenseId = expenseResult.rows[0].id;

        // Save splits
        for (const s of calculatedSplits) {
          await client.query(
            `INSERT INTO expense_splits (expense_id, user_id, share_value) VALUES ($1, $2, $3)`,
            [expenseId, s.user_id, s.share_value]
          );
        }

        // Update anomalies action log
        await client.query(
          `UPDATE import_anomalies SET action_taken = $1, approved = true
           WHERE import_session_id = $2 AND row_number = $3`,
          [resolution.action === 'FIX' ? 'RESOLVED_WITH_FIX' : 'IMPORTED_AS_IS', sessionId, rowNumber]
        );

        rowsImported++;
      }

      // 7. Close import session status
      await client.query(
        `UPDATE import_sessions
         SET status = 'COMMITTED', rows_imported = $1, rows_skipped = $2
         WHERE id = $3`,
        [rowsImported, rowsSkipped, sessionId]
      );

      await client.query('COMMIT');
      return {
        rowsImported,
        rowsSkipped
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export default new CsvImportEngine();

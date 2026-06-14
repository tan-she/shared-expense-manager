/**
 * services/importengine/CsvImportEngine.js
 *
 * Directs the entire CSV Ingest pipeline:
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
        continue;
      }

      const row = {};
      headers.forEach((h, idx) => {
        row[h] = cells[idx];
      });

      parsedRows.push(row);
    }

    return parsedRows;
  }

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

  async stageImport(userId, groupId, fileName, csvContent) {
    const rows = this.parseCsv(csvContent);

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

      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        const rowContext = { ...context, currentRowIndex: idx };
        const anomalies = AnomalyDetectionService.detectAnomalies(row, rowContext);

        for (const anomaly of anomalies) {
          totalAnomaliesCount++;
          await client.query(
            `INSERT INTO import_anomalies (import_session_id, row_number, anomaly_type, severity, description, raw_row_json, suggested_fix)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              session.id,
              idx + 1,
              anomaly.anomaly_type,
              anomaly.severity,
              anomaly.description,
              JSON.stringify(row),
              anomaly.suggested_fix || 'No automated suggestion. Please review manually.'
            ]
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

  async commitImport(sessionId, resolutions = [], userId) {
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
    const rows = session.csv_data;

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
            `UPDATE import_anomalies 
             SET action_taken = 'SKIPPED_BY_USER', approved = true, resolved_by = $1, resolved_at = NOW()
             WHERE import_session_id = $2 AND row_number = $3`,
            [userId, sessionId, rowNumber]
          );
          continue;
        }

        // Apply edits if action is 'FIX'
        let row = resolution.action === 'FIX' && resolution.fix_data
          ? { ...rows[i], ...resolution.fix_data }
          : rows[i];

        let amount = parseFloat(row.Amount);
        let payerEmail = row.PayerEmail?.toLowerCase().trim();
        let payerId = emailToIdMap[payerEmail];

        // ── REFUND HANDLING RULE ──────────────────────────────────────────
        // Refunds are transformed into compensating transactions that reverse
        // the original debt direction.
        let isRefund = false;
        if (amount < 0 && (resolution.action === 'REFUND' || resolution.treatAsRefund)) {
          isRefund = true;
          amount = Math.abs(amount);
        }

        const currency = row.Currency?.toUpperCase().trim();
        
        // STRICT CURRENCY CHECK:
        // Do not silently fallback. If the currency is invalid or empty,
        // block import unless it is explicitly resolved.
        if (!currency || (currency !== 'INR' && currency !== 'USD')) {
          throw createError(400, `Row #${rowNumber} fails import: Invalid or missing currency code "${row.Currency}". Explicit resolution is required.`);
        }

        const splitType = row.SplitType?.toUpperCase().trim();
        const date = new Date(row.Date);

        // Convert currency parameters
        const exchangeRate = CurrencyService.getRate(currency);
        const convertedAmount = CurrencyService.convertToBase(amount, currency);

        // Parse participants splits
        const splitPairs = row.ParticipantsSplits?.split(';').filter(s => s.trim() !== '') || [];
        
        let splitsInput = splitPairs.map(pair => {
          if (splitType === 'EQUAL') {
            const email = pair.toLowerCase().trim();
            const uId = emailToIdMap[email];
            if (!uId) throw createError(400, `Unknown participant email "${email}" in Row #${rowNumber}.`);
            return { user_id: uId };
          } else {
            const parts = pair.split(':');
            const email = parts[0].toLowerCase().trim();
            const value = parseFloat(parts[1]);
            const uId = emailToIdMap[email];
            if (!uId) throw createError(400, `Unknown participant email "${email}" in Row #${rowNumber}.`);
            return { user_id: uId, value };
          }
        });

        if (isRefund) {
          if (splitsInput.length === 1) {
            const originalParticipant = splitsInput[0].user_id;
            splitsInput = [{ user_id: payerId, value: splitsInput[0].value }];
            payerId = originalParticipant;
          } else {
            for (const item of splitsInput) {
              const itemPayer = item.user_id;
              const refundValue = splitType === 'EQUAL' ? (convertedAmount / splitsInput.length) : item.value;
              
              const expenseResult = await client.query(
                `INSERT INTO expenses (group_id, payer_id, description, amount, currency, expense_date, split_type, exchange_rate, converted_amount, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')
                 RETURNING id`,
                [groupId, itemPayer, `[Refund] ${row.Description.trim()}`, refundValue, currency, date, 'EXACT', exchangeRate, refundValue]
              );
              const expenseId = expenseResult.rows[0].id;

              await client.query(
                `INSERT INTO expense_splits (expense_id, user_id, share_value) VALUES ($1, $2, $3)`,
                [expenseId, payerId, refundValue]
              );
            }

            await client.query(
              `UPDATE import_anomalies 
               SET action_taken = 'IMPORTED_AS_REFUND', approved = true, resolved_by = $1, resolved_at = NOW()
               WHERE import_session_id = $2 AND row_number = $3`,
              [userId, sessionId, rowNumber]
            );
            rowsImported++;
            continue;
          }
        }

        if (!payerId) {
          throw createError(400, `Row #${rowNumber} Payer email (${payerEmail}) does not belong to any active group member.`);
        }

        const strategy = strategies[splitType];
        if (!strategy) {
          throw createError(400, `Unsupported split type: ${splitType} in Row #${rowNumber}.`);
        }

        const calculatedSplits = strategy.calculate(convertedAmount, splitsInput, payerId);

        const expenseResult = await client.query(
          `INSERT INTO expenses (group_id, payer_id, description, amount, currency, expense_date, split_type, exchange_rate, converted_amount, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')
           RETURNING id`,
          [groupId, payerId, row.Description.trim(), amount, currency, date, splitType, exchangeRate, convertedAmount]
        );
        const expenseId = expenseResult.rows[0].id;

        for (const s of calculatedSplits) {
          await client.query(
            `INSERT INTO expense_splits (expense_id, user_id, share_value) VALUES ($1, $2, $3)`,
            [expenseId, s.user_id, s.share_value]
          );
        }

        await client.query(
          `UPDATE import_anomalies 
           SET action_taken = $1, approved = true, resolved_by = $2, resolved_at = NOW()
           WHERE import_session_id = $3 AND row_number = $4`,
          [isRefund ? 'IMPORTED_AS_REFUND' : (resolution.action === 'FIX' ? 'RESOLVED_WITH_FIX' : 'IMPORTED_AS_IS'), userId, sessionId, rowNumber]
        );

        rowsImported++;
      }

      // ── SESSION LEVEL AUDIT LOGGING ───────────────────────────────────────
      await client.query(
        `UPDATE import_sessions
         SET status = 'COMMITTED', rows_imported = $1, rows_skipped = $2, approved_by = $3, approved_at = NOW()
         WHERE id = $4`,
        [rowsImported, rowsSkipped, userId, sessionId]
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

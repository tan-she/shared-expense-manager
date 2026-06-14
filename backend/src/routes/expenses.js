/**
 * routes/expenses.js — Expense Management Router
 *
 * Implements CRUD actions for group expenses.
 * Incorporates:
 *   - Strategy Pattern: Selects proper SplitStrategy based on split_type.
 *   - Temporal membership: Verifies payer and splits were active members on expense_date.
 *   - Multi-currency auditing: Saves original values, exchange rates, and converted amounts.
 */

import express from 'express';
import pool from '../config/db.js';
import { protect } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import MembershipService from '../services/MembershipService.js';
import CurrencyService from '../services/CurrencyService.js';

// Strategies
import EqualSplitStrategy from '../services/splitstrategy/EqualSplitStrategy.js';
import PercentageSplitStrategy from '../services/splitstrategy/PercentageSplitStrategy.js';
import ExactAmountSplitStrategy from '../services/splitstrategy/ExactAmountSplitStrategy.js';

const router = express.Router();
router.use(protect);

const strategies = {
  EQUAL: new EqualSplitStrategy(),
  PERCENTAGE: new PercentageSplitStrategy(),
  EXACT: new ExactAmountSplitStrategy()
};

// ── GET /api/expenses/group/:groupId ──────────────────────────────────────
router.get('/group/:groupId', asyncHandler(async (req, res) => {
  const groupId = parseInt(req.params.groupId);
  await assertMembership(req.user.id, groupId);

  const result = await pool.query(
    `SELECT
       e.id,
       e.group_id,
       e.payer_id,
       u.name AS payer_name,
       e.description,
       e.amount,
       e.currency,
       e.expense_date,
       e.split_type,
       e.exchange_rate,
       e.converted_amount,
       e.created_at
     FROM expenses e
     JOIN users u ON u.id = e.payer_id
     WHERE e.group_id = $1
     ORDER BY e.expense_date DESC`,
    [groupId]
  );

  res.status(200).json({ success: true, expenses: result.rows });
}));

// ── GET /api/expenses/:id ─────────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  const expenseId = parseInt(req.params.id);

  const expenseResult = await pool.query(
    `SELECT id, group_id, payer_id, description, amount, currency, expense_date, split_type, exchange_rate, converted_amount FROM expenses WHERE id = $1`,
    [expenseId]
  );
  if (expenseResult.rows.length === 0) {
    throw createError(404, 'Expense not found.');
  }

  const expense = expenseResult.rows[0];
  await assertMembership(req.user.id, expense.group_id);

  // Fetch individual splits
  const splitsResult = await pool.query(
    `SELECT
       es.user_id,
       u.name AS user_name,
       es.share_value
     FROM expense_splits es
     JOIN users u ON u.id = es.user_id
     WHERE es.expense_id = $1`,
    [expenseId]
  );

  res.status(200).json({
    success: true,
    expense,
    splits: splitsResult.rows
  });
}));

// ── POST /api/expenses ────────────────────────────────────────────────────
router.post('/', asyncHandler(async (req, res) => {
  const { group_id, payer_id, description, amount, currency, expense_date, split_type, splits } = req.body;

  // 1. Basic validation
  if (!group_id || !payer_id || !description || !amount || !currency || !expense_date || !split_type || !splits) {
    throw createError(400, 'All expense details and splits are required.');
  }

  await assertMembership(req.user.id, group_id);

  // 2. Select strategy
  const strategy = strategies[split_type?.toUpperCase()];
  if (!strategy) {
    throw createError(400, `Unsupported split type: ${split_type}`);
  }

  // 3. Temporal verification
  const participantIds = splits.map(s => parseInt(s.user_id));
  await MembershipService.validateExpenseParticipants(group_id, payer_id, participantIds, expense_date);

  // 4. Currency conversion logic
  const exchangeRate = CurrencyService.getRate(currency);
  const convertedAmount = CurrencyService.convertToBase(amount, currency);

  // 5. Calculate splits
  const calculatedSplits = strategy.calculate(convertedAmount, splits);

  // 6. DB Transaction Commit
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const expenseResult = await client.query(
      `INSERT INTO expenses (group_id, payer_id, description, amount, currency, expense_date, split_type, exchange_rate, converted_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, group_id, payer_id, description, amount, currency, expense_date, split_type, exchange_rate, converted_amount`,
      [group_id, payer_id, description, amount, currency.toUpperCase(), new Date(expense_date), split_type.toUpperCase(), exchangeRate, convertedAmount]
    );

    const expense = expenseResult.rows[0];

    // Bulk insert splits
    for (const s of calculatedSplits) {
      await client.query(
        `INSERT INTO expense_splits (expense_id, user_id, share_value) VALUES ($1, $2, $3)`,
        [expense.id, s.user_id, s.share_value]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, expense, splits: calculatedSplits });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// ── PUT /api/expenses/:id ─────────────────────────────────────────────────
router.put('/:id', asyncHandler(async (req, res) => {
  const expenseId = parseInt(req.params.id);
  const { payer_id, description, amount, currency, expense_date, split_type, splits } = req.body;

  // Verify expense exists
  const expenseCheck = await pool.query(
    'SELECT group_id FROM expenses WHERE id = $1',
    [expenseId]
  );
  if (expenseCheck.rows.length === 0) {
    throw createError(404, 'Expense not found.');
  }

  const groupId = expenseCheck.rows[0].group_id;
  await assertMembership(req.user.id, groupId);

  const strategy = strategies[split_type?.toUpperCase()];
  if (!strategy) {
    throw createError(400, `Unsupported split type: ${split_type}`);
  }

  // Temporal validation
  const participantIds = splits.map(s => parseInt(s.user_id));
  await MembershipService.validateExpenseParticipants(groupId, payer_id, participantIds, expense_date);

  const exchangeRate = CurrencyService.getRate(currency);
  const convertedAmount = CurrencyService.convertToBase(amount, currency);
  const calculatedSplits = strategy.calculate(convertedAmount, splits);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update expense record
    await client.query(
      `UPDATE expenses
       SET payer_id = $1, description = $2, amount = $3, currency = $4, expense_date = $5, split_type = $6, exchange_rate = $7, converted_amount = $8
       WHERE id = $9`,
      [payer_id, description, amount, currency.toUpperCase(), new Date(expense_date), split_type.toUpperCase(), exchangeRate, convertedAmount, expenseId]
    );

    // Rebuild splits: clear old, insert new
    await client.query('DELETE FROM expense_splits WHERE expense_id = $1', [expenseId]);
    for (const s of calculatedSplits) {
      await client.query(
        `INSERT INTO expense_splits (expense_id, user_id, share_value) VALUES ($1, $2, $3)`,
        [expenseId, s.user_id, s.share_value]
      );
    }

    await client.query('COMMIT');
    res.status(200).json({ success: true, message: 'Expense updated successfully.' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// ── DELETE /api/expenses/:id ──────────────────────────────────────────────
router.delete('/:id', asyncHandler(async (req, res) => {
  const expenseId = parseInt(req.params.id);

  const expenseCheck = await pool.query(
    'SELECT group_id FROM expenses WHERE id = $1',
    [expenseId]
  );
  if (expenseCheck.rows.length === 0) {
    throw createError(404, 'Expense not found.');
  }

  await assertMembership(req.user.id, expenseCheck.rows[0].group_id);

  await pool.query('DELETE FROM expenses WHERE id = $1', [expenseId]);
  res.status(200).json({ success: true, message: 'Expense deleted successfully.' });
}));

// ── Private Helper ────────────────────────────────────────────────────────
async function assertMembership(userId, groupId) {
  const result = await pool.query(
    `SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );
  if (result.rows.length === 0) {
    throw createError(403, 'You are not a member of this group.');
  }
}

export default router;

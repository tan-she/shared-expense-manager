/**
 * routes/settlements.js — Settlement Management Router
 *
 * All routes require authentication.
 * Settlements represent direct transfers between users to resolve debts.
 * They are stored in a dedicated `settlements` table (separate from expenses).
 */

import express from 'express';
import pool from '../config/db.js';
import { protect } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import MembershipService from '../services/MembershipService.js';

const router = express.Router();
router.use(protect);

// ── GET /api/settlements/group/:groupId ───────────────────────────────────
router.get('/group/:groupId', asyncHandler(async (req, res) => {
  const groupId = parseInt(req.params.groupId);
  await assertMembership(req.user.id, groupId);

  const result = await pool.query(
    `SELECT
       s.id,
       s.group_id,
       s.from_user_id,
       f.name AS from_user_name,
       s.to_user_id,
       t.name AS to_user_name,
       s.amount,
       s.currency,
       s.settlement_date,
       s.created_at
     FROM settlements s
     JOIN users f ON f.id = s.from_user_id
     JOIN users t ON t.id = s.to_user_id
     WHERE s.group_id = $1
     ORDER BY s.settlement_date DESC`,
    [groupId]
  );

  res.status(200).json({ success: true, settlements: result.rows });
}));

// ── POST /api/settlements ─────────────────────────────────────────────────
router.post('/', asyncHandler(async (req, res) => {
  const { group_id, from_user_id, to_user_id, amount, currency, settlement_date } = req.body;

  if (!group_id || !from_user_id || !to_user_id || !amount || !currency || !settlement_date) {
    throw createError(400, 'All settlement fields are required.');
  }

  if (parseInt(from_user_id) === parseInt(to_user_id)) {
    throw createError(400, 'You cannot record a settlement with yourself.');
  }

  await assertMembership(req.user.id, group_id);

  // Validate temporal membership at the time of settlement
  const dateToCheck = new Date(settlement_date);
  const isFromActive = await MembershipService.isActiveMember(from_user_id, group_id, dateToCheck);
  const isToActive = await MembershipService.isActiveMember(to_user_id, group_id, dateToCheck);

  if (!isFromActive || !isToActive) {
    throw createError(400, 'Both settlement participants must be active group members on the settlement date.');
  }

  // Validate settlement logic constraint:
  // Settlement is only allowed if the payer owes money (net_balance < 0)
  // OR the receiver is owed money (net_balance > 0)
  const groupBalances = await BalanceEngine.getBalancesAndBreakdown(group_id);
  const payerBal = groupBalances.find(b => b.user_id === parseInt(from_user_id))?.net_balance || 0;
  const payeeBal = groupBalances.find(b => b.user_id === parseInt(to_user_id))?.net_balance || 0;

  if (payerBal >= 0 && payeeBal <= 0) {
    throw createError(400, 'Invalid settlement: Payer must owe money or receiver must be owed money to settle a debt.');
  }

  const result = await pool.query(
    `INSERT INTO settlements (group_id, from_user_id, to_user_id, amount, currency, settlement_date)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, group_id, from_user_id, to_user_id, amount, currency, settlement_date`,
    [group_id, from_user_id, to_user_id, amount, currency.toUpperCase(), dateToCheck]
  );

  res.status(201).json({ success: true, settlement: result.rows[0] });
}));

// ── DELETE /api/settlements/:id ───────────────────────────────────────────
router.delete('/:id', asyncHandler(async (req, res) => {
  const settlementId = parseInt(req.params.id);

  const settlementCheck = await pool.query(
    'SELECT group_id FROM settlements WHERE id = $1',
    [settlementId]
  );
  if (settlementCheck.rows.length === 0) {
    throw createError(404, 'Settlement not found.');
  }

  await assertMembership(req.user.id, settlementCheck.rows[0].group_id);

  await pool.query('DELETE FROM settlements WHERE id = $1', [settlementId]);
  res.status(200).json({ success: true, message: 'Settlement reversed successfully.' });
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

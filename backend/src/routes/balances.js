/**
 * routes/balances.js — Balance Engine Endpoints
 *
 * Exposes balance calculations for a group.
 */

import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import BalanceEngine from '../services/BalanceEngine.js';
import SettlementOptimizer from '../services/SettlementOptimizer.js';
import pool from '../config/db.js';

const router = express.Router();
router.use(protect);

// ── GET /api/balances/group/:groupId ──────────────────────────────────────
// Returns net balances, line-by-line breakdowns, and optimized transactions.
router.get('/group/:groupId', asyncHandler(async (req, res) => {
  const groupId = parseInt(req.params.groupId);

  const memberCheck = await pool.query(
    `SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, req.user.id]
  );
  if (memberCheck.rows.length === 0) {
    throw createError(403, 'You are not a member of this group.');
  }

  const balancesWithBreakdown = await BalanceEngine.getBalancesAndBreakdown(groupId);
  const optimizedSettlements = SettlementOptimizer.minimizeDebts(balancesWithBreakdown);

  res.status(200).json({
    success: true,
    balances: balancesWithBreakdown,
    suggestedSettlements: optimizedSettlements
  });
}));

export default router;

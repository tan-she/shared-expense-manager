/**
 * services/BalanceEngine.js
 *
 * Primary engine coordinating net balance computations.
 * Delegating ledger compilation to BalanceBreakdownService.
 *
 * Design Pattern: Facade Pattern
 */

import pool from '../config/db.js';
import BalanceBreakdownService from './BalanceBreakdownService.js';
import { createError } from '../middleware/errorHandler.js';

class BalanceEngine {
  /**
   * Calculates net balances and returns transaction breakdowns.
   */
  async getBalancesAndBreakdown(groupId) {
    // 1. Fetch group members
    const membersResult = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.email
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1`,
      [groupId]
    );
    const members = membersResult.rows;
    if (members.length === 0) {
      return []; // Return empty array if group has no members
    }

    const balances = {};
    members.forEach(m => {
      balances[m.id] = 0;
    });

    // 2. Fetch all ACTIVE expenses
    const expensesResult = await pool.query(
      `SELECT id, payer_id, converted_amount
       FROM expenses
       WHERE group_id = $1 AND status = 'ACTIVE'`,
      [groupId]
    );

    for (const exp of expensesResult.rows) {
      const payerId = exp.payer_id;
      const expenseAmount = parseFloat(exp.converted_amount);

      if (balances[payerId] !== undefined) {
        balances[payerId] = Math.round((balances[payerId] + expenseAmount) * 100) / 100;
      }

      const splitsResult = await pool.query(
        `SELECT user_id, share_value FROM expense_splits WHERE expense_id = $1`,
        [exp.id]
      );

      for (const split of splitsResult.rows) {
        const debtorId = split.user_id;
        const share = parseFloat(split.share_value);
        if (balances[debtorId] !== undefined) {
          balances[debtorId] = Math.round((balances[debtorId] - share) * 100) / 100;
        }
      }
    }

    // 3. Fetch settlements
    const settlementsResult = await pool.query(
      `SELECT from_user_id, to_user_id, amount
       FROM settlements
       WHERE group_id = $1`,
      [groupId]
    );

    for (const set of settlementsResult.rows) {
      const fromId = set.from_user_id;
      const toId = set.to_user_id;
      const amt = parseFloat(set.amount);

      if (balances[fromId] !== undefined) {
        balances[fromId] = Math.round((balances[fromId] + amt) * 100) / 100;
      }
      if (balances[toId] !== undefined) {
        balances[toId] = Math.round((balances[toId] - amt) * 100) / 100;
      }
    }

    // 4. Fetch explanatory ledgers from breakdown service
    const breakdowns = await BalanceBreakdownService.buildLedger(groupId, members);

    // Format final structure
    return members.map(m => ({
      user_id: m.id,
      name: m.name,
      email: m.email,
      net_balance: balances[m.id],
      breakdown: breakdowns[m.id] || []
    }));
  }
}

export default new BalanceEngine();

/**
 * services/BalanceBreakdownService.js
 *
 * Builds chronological ledger statements explaining how net balances are calculated.
 * Traces CREDITS (payments), DEBITS (splits), and SETTLEMENT transactions.
 *
 * Design Pattern: Service Layer
 */

import pool from '../config/db.js';

class BalanceBreakdownService {
  /**
   * Compiles explainable ledger audit details for all members of a group.
   */
  async buildLedger(groupId, members) {
    const breakdowns = {};
    members.forEach(m => {
      breakdowns[m.id] = [];
    });

    // 1. Fetch expenses
    const expensesResult = await pool.query(
      `SELECT id, payer_id, description, converted_amount, expense_date
       FROM expenses
       WHERE group_id = $1 AND status = 'ACTIVE'`,
      [groupId]
    );

    for (const exp of expensesResult.rows) {
      const payerId = exp.payer_id;
      const expenseAmount = parseFloat(exp.converted_amount);

      if (breakdowns[payerId]) {
        breakdowns[payerId].push({
          date: exp.expense_date,
          type: 'CREDIT',
          description: `Paid for: ${exp.description}`,
          amount: expenseAmount
        });
      }

      // Fetch expense splits
      const splitsResult = await pool.query(
        `SELECT user_id, share_value FROM expense_splits WHERE expense_id = $1`,
        [exp.id]
      );

      for (const split of splitsResult.rows) {
        const debtorId = split.user_id;
        const share = parseFloat(split.share_value);

        if (breakdowns[debtorId]) {
          breakdowns[debtorId].push({
            date: exp.expense_date,
            type: 'DEBIT',
            description: `Share of: ${exp.description}`,
            amount: share
          });
        }
      }
    }

    // 2. Fetch settlements
    const settlementsResult = await pool.query(
      `SELECT from_user_id, to_user_id, amount, settlement_date
       FROM settlements
       WHERE group_id = $1`,
      [groupId]
    );

    for (const set of settlementsResult.rows) {
      const fromId = set.from_user_id;
      const toId = set.to_user_id;
      const amt = parseFloat(set.amount);

      if (breakdowns[fromId]) {
        const recipient = members.find(m => m.id === toId);
        breakdowns[fromId].push({
          date: set.settlement_date,
          type: 'SETTLEMENT_PAYOUT',
          description: `Settled payment to: ${recipient ? recipient.name : 'Unknown User'}`,
          amount: amt
        });
      }

      if (breakdowns[toId]) {
        const sender = members.find(m => m.id === fromId);
        breakdowns[toId].push({
          date: set.settlement_date,
          type: 'SETTLEMENT_RECEIVE',
          description: `Received settlement from: ${sender ? sender.name : 'Unknown User'}`,
          amount: amt
        });
      }
    }

    // Sort each ledger chronologically
    Object.keys(breakdowns).forEach(userId => {
      breakdowns[userId].sort((a, b) => new Date(a.date) - new Date(b.date));
    });

    return breakdowns;
  }
}

export default new BalanceBreakdownService();

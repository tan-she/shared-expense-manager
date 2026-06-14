/**
 * services/BalanceEngine.js
 *
 * Computes net balances and optimizes settlements.
 *
 * Greedy Flow Minimization Algorithm:
 *   1. Calculate the net balance for each user: sum(amount paid) - sum(amount owed).
 *   2. Group into Creditors (balance > 0) and Debtors (balance < 0).
 *   3. Sort both groups descending by absolute value of balance.
 *   4. Greedily match the largest debtor with the largest creditor:
 *      - Calculate the transaction amount: min(|debtor_balance|, |creditor_balance|).
 *      - Subtract/add this amount from both balances.
 *      - Add the transaction to the suggestion list.
 *      - Re-sort or filter out any zero-balance users.
 *      - Repeat until all balances are resolved (net zero).
 *   This reduces an N-person network to at most N-1 transactions.
 */

import pool from '../config/db.js';
import { createError } from '../middleware/errorHandler.js';

class BalanceEngine {
  /**
   * Calculates net balances and returns transaction-level breakdowns for explanation.
   */
  async getBalancesAndBreakdown(groupId) {
    // 1. Fetch all active members of the group
    const membersResult = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.email
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1`,
      [groupId]
    );
    const members = membersResult.rows;
    if (members.length === 0) {
      throw createError(404, 'No members found in this group.');
    }

    // Initialize balance and audit maps
    const balances = {};
    const breakdowns = {}; // stores line-by-line audit items
    
    members.forEach(m => {
      balances[m.id] = 0;
      breakdowns[m.id] = [];
    });

    // 2. Fetch all ACTIVE expenses in the group
    const expensesResult = await pool.query(
      `SELECT id, payer_id, description, converted_amount, expense_date
       FROM expenses
       WHERE group_id = $1 AND status = 'ACTIVE'`,
      [groupId]
    );

    // For each expense, process its splits
    for (const exp of expensesResult.rows) {
      const payerId = exp.payer_id;
      const expenseAmount = parseFloat(exp.converted_amount);

      // Record payer credit
      if (balances[payerId] !== undefined) {
        balances[payerId] = Math.round((balances[payerId] + expenseAmount) * 100) / 100;
        breakdowns[payerId].push({
          type: 'CREDIT',
          description: `Paid for: ${exp.description}`,
          amount: expenseAmount,
          date: exp.expense_date
        });
      }

      // Fetch splits
      const splitsResult = await pool.query(
        `SELECT user_id, share_value FROM expense_splits WHERE expense_id = $1`,
        [exp.id]
      );

      for (const split of splitsResult.rows) {
        const debtorId = split.user_id;
        const share = parseFloat(split.share_value);

        if (balances[debtorId] !== undefined) {
          balances[debtorId] = Math.round((balances[debtorId] - share) * 100) / 100;
          breakdowns[debtorId].push({
            type: 'DEBIT',
            description: `Share of: ${exp.description}`,
            amount: share,
            date: exp.expense_date
          });
        }
      }
    }

    // 3. Fetch all settlements in the group
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

      // From User pays: credit (+amt) on their net balance (resolves debt)
      if (balances[fromId] !== undefined) {
        balances[fromId] = Math.round((balances[fromId] + amt) * 100) / 100;
        breakdowns[fromId].push({
          type: 'SETTLEMENT_PAYOUT',
          description: `Settled payment to: ${members.find(m => m.id === toId)?.name || 'Unknown'}`,
          amount: amt,
          date: set.settlement_date
        });
      }

      // To User receives: debit (-amt) on their net balance (resolves credit)
      if (balances[toId] !== undefined) {
        balances[toId] = Math.round((balances[toId] - amt) * 100) / 100;
        breakdowns[toId].push({
          type: 'SETTLEMENT_RECEIVE',
          description: `Received settlement from: ${members.find(m => m.id === fromId)?.name || 'Unknown'}`,
          amount: amt,
          date: set.settlement_date
        });
      }
    }

    // Format net balances list
    const balanceSummary = members.map(m => ({
      user_id: m.id,
      name: m.name,
      email: m.email,
      net_balance: balances[m.id],
      breakdown: breakdowns[m.id].sort((a, b) => new Date(a.date) - new Date(b.date))
    }));

    return balanceSummary;
  }

  /**
   * Greedy debt minimizer reducing transactions to N-1 limit.
   */
  minimizeDebts(balanceSummary) {
    // Partition into positive (creditors) and negative (debtors) balances
    let debtors = [];
    let creditors = [];

    balanceSummary.forEach(user => {
      const balanceCents = Math.round(user.net_balance * 100);
      if (balanceCents < 0) {
        debtors.push({ user_id: user.user_id, name: user.name, balanceCents: Math.abs(balanceCents) });
      } else if (balanceCents > 0) {
        creditors.push({ user_id: user.user_id, name: user.name, balanceCents: balanceCents });
      }
    });

    const recommendedTransactions = [];

    // Greedily match largest debtor to largest creditor
    while (debtors.length > 0 && creditors.length > 0) {
      // Sort descending by balance size
      debtors.sort((a, b) => b.balanceCents - a.balanceCents);
      creditors.sort((a, b) => b.balanceCents - a.balanceCents);

      const debtor = debtors[0];
      const creditor = creditors[0];

      const settleCents = Math.min(debtor.balanceCents, creditor.balanceCents);

      recommendedTransactions.push({
        from_user_id: debtor.user_id,
        from_user_name: debtor.name,
        to_user_id: creditor.user_id,
        to_user_name: creditor.name,
        amount: settleCents / 100
      });

      debtor.balanceCents -= settleCents;
      creditor.balanceCents -= settleCents;

      // Filter out completed balances
      debtors = debtors.filter(d => d.balanceCents > 0);
      creditors = creditors.filter(c => c.balanceCents > 0);
    }

    return recommendedTransactions;
  }
}

export default new BalanceEngine();

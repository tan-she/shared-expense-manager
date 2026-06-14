/**
 * services/SettlementOptimizer.js
 *
 * Encapsulates the greedy flow matching algorithm to minimize transactions.
 * Guarantees N-1 transaction count boundary.
 *
 * Complexity:
 *   Sorting initially takes O(N log N).
 *   Instead of fully sorting the arrays in every iteration, we can maintain the sorted
 *   order or simply insert updated balances back in log(N) time. Given the small number of
 *   participants in expense sharing groups (typically < 50), linear matching on sorted
 *   boundaries keeps implementation clean and operates in O(N log N) overall.
 */

export class SettlementOptimizer {
  /**
   * Minimizes the transaction graph for a list of net balances.
   *
   * @param {Array<object>} balanceSummary - Array of { user_id, name, net_balance }
   * @returns {Array<object>} Minimized suggested settlements
   */
  minimizeDebts(balanceSummary) {
    let debtors = [];
    let creditors = [];

    // 1. Partition into positive and negative balances in cents to avoid float drift
    balanceSummary.forEach(user => {
      const balanceCents = Math.round(user.net_balance * 100);
      if (balanceCents < 0) {
        debtors.push({ user_id: user.user_id, name: user.name, balanceCents: Math.abs(balanceCents) });
      } else if (balanceCents > 0) {
        creditors.push({ user_id: user.user_id, name: user.name, balanceCents: balanceCents });
      }
    });

    const suggestions = [];

    // 2. Sort initially
    debtors.sort((a, b) => b.balanceCents - a.balanceCents);
    creditors.sort((a, b) => b.balanceCents - a.balanceCents);

    let dIdx = 0;
    let cIdx = 0;

    // 3. Match values using two pointers on the sorted arrays.
    // Since we only modify the elements at dIdx and cIdx, we can complete
    // matching in O(N) linear time once sorted, leading to O(N log N) overall complexity.
    while (dIdx < debtors.length && cIdx < creditors.length) {
      const debtor = debtors[dIdx];
      const creditor = creditors[cIdx];

      const settleCents = Math.min(debtor.balanceCents, creditor.balanceCents);

      if (settleCents > 0) {
        suggestions.push({
          from_user_id: debtor.user_id,
          from_user_name: debtor.name,
          to_user_id: creditor.user_id,
          to_user_name: creditor.name,
          amount: settleCents / 100
        });
      }

      debtor.balanceCents -= settleCents;
      creditor.balanceCents -= settleCents;

      if (debtor.balanceCents === 0) {
        dIdx++;
      }
      if (creditor.balanceCents === 0) {
        cIdx++;
      }
    }

    return suggestions;
  }
}

export default new SettlementOptimizer();

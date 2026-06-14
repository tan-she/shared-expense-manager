/**
 * services/splitstrategy/ExactAmountSplitStrategy.js
 *
 * Distributes an expense using explicit currency values per participant.
 * Invariants:
 *   - The sum of all splits must equal the total expense amount.
 */

import SplitStrategy from './SplitStrategy.js';
import { createError } from '../../middleware/errorHandler.js';

export default class ExactAmountSplitStrategy extends SplitStrategy {
  validate(totalAmount, splitsInput) {
    if (!splitsInput || splitsInput.length === 0) {
      throw createError(400, 'At least one participant is required.');
    }

    const totalSplitAmount = splitsInput.reduce((sum, p) => sum + parseFloat(p.value || 0), 0);
    // Compare in cents to avoid floating-point accuracy issues
    const totalAmountCents = Math.round(totalAmount * 100);
    const splitAmountCents = Math.round(totalSplitAmount * 100);

    if (totalAmountCents !== splitAmountCents) {
      throw createError(400, `The sum of split shares (${totalSplitAmount}) must equal the total expense amount (${totalAmount}).`);
    }
  }

  calculate(totalAmount, splitsInput) {
    this.validate(totalAmount, splitsInput);

    return splitsInput.map(p => ({
      user_id: p.user_id,
      share_value: Math.round(parseFloat(p.value) * 100) / 100
    }));
  }
}

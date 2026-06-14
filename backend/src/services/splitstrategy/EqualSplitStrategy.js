/**
 * services/splitstrategy/EqualSplitStrategy.js
 *
 * Divides an amount equally among a list of participants.
 * Handles precision adjustments for pennies/cents that do not split perfectly:
 *   - E.g. Splitting 100.00 INR among 3 people.
 *   - Basic split: 33.33 each. Sum = 99.99 (leaves 0.01 remainder).
 *   - The strategy adds the remaining 0.01 to the first participant to maintain sum integrity.
 */

import SplitStrategy from './SplitStrategy.js';
import { createError } from '../../middleware/errorHandler.js';

export default class EqualSplitStrategy extends SplitStrategy {
  validate(totalAmount, splitsInput) {
    if (!splitsInput || splitsInput.length === 0) {
      throw createError(400, 'At least one participant is required for an equal split.');
    }
  }

  calculate(totalAmount, splitsInput) {
    this.validate(totalAmount, splitsInput);

    const count = splitsInput.length;
    // Perform operations in cents to avoid floats issues
    const totalCents = Math.round(totalAmount * 100);
    const baseShareCents = Math.floor(totalCents / count);
    let remainderCents = totalCents % count;

    return splitsInput.map((p, idx) => {
      // Allocate the remaining pennies one-by-one to the first few users
      const extra = remainderCents > 0 ? 1 : 0;
      remainderCents--;

      const calculatedShare = (baseShareCents + extra) / 100;
      return {
        user_id: p.user_id,
        share_value: calculatedShare
      };
    });
  }
}

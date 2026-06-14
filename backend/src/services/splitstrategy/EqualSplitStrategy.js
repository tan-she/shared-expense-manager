/**
 * services/splitstrategy/EqualSplitStrategy.js
 *
 * Divides an amount equally among a list of participants.
 * Rounding Remainder Rule:
 *   If there is a remainder (e.g. ₹100.00 split among 3 people = 99.99 + 0.01),
 *   assign the remainder to the payer if they are in the split.
 *   Otherwise, assign it to the first participant in the list.
 */

import SplitStrategy from './SplitStrategy.js';
import { createError } from '../../middleware/errorHandler.js';

export default class EqualSplitStrategy extends SplitStrategy {
  validate(totalAmount, splitsInput) {
    if (!splitsInput || splitsInput.length === 0) {
      throw createError(400, 'At least one participant is required for an equal split.');
    }
  }

  calculate(totalAmount, splitsInput, payerId) {
    this.validate(totalAmount, splitsInput);

    const count = splitsInput.length;
    const totalCents = Math.round(totalAmount * 100);
    const baseShareCents = Math.floor(totalCents / count);
    const remainderCents = totalCents % count;

    // First assign base shares
    const shares = splitsInput.map(p => ({
      user_id: parseInt(p.user_id),
      share_value: baseShareCents / 100
    }));

    // Distribute remainder pennies
    if (remainderCents > 0) {
      // Find payer in the split participants
      const payerIndex = shares.findIndex(s => s.user_id === parseInt(payerId));
      if (payerIndex !== -1) {
        // If payer is in the split, give them the remainder cents
        shares[payerIndex].share_value = Math.round((shares[payerIndex].share_value * 100) + remainderCents) / 100;
      } else {
        // Fallback to the first participant
        shares[0].share_value = Math.round((shares[0].share_value * 100) + remainderCents) / 100;
      }
    }

    return shares;
  }
}

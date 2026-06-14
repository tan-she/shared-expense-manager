/**
 * services/splitstrategy/PercentageSplitStrategy.js
 *
 * Divides an amount based on custom percentages per participant.
 * Invariants:
 *   - Percentages must sum to exactly 100.
 *   - Handles rounding adjusters to keep total sum equal to expense amount.
 */

import SplitStrategy from './SplitStrategy.js';
import { createError } from '../../middleware/errorHandler.js';

export default class PercentageSplitStrategy extends SplitStrategy {
  validate(totalAmount, splitsInput) {
    if (!splitsInput || splitsInput.length === 0) {
      throw createError(400, 'At least one participant is required.');
    }

    const totalPercentage = splitsInput.reduce((sum, p) => sum + parseFloat(p.value || 0), 0);
    // Float comparison tolerance check: must be near 100.00
    if (Math.abs(totalPercentage - 100) > 0.01) {
      throw createError(400, `Percentages must sum to 100%. Provided total: ${totalPercentage}%`);
    }
  }

  calculate(totalAmount, splitsInput) {
    this.validate(totalAmount, splitsInput);

    const totalCents = Math.round(totalAmount * 100);
    let distributedCents = 0;

    const shares = splitsInput.map((p, idx) => {
      const pct = parseFloat(p.value);
      // Calculate share in cents
      const shareCents = Math.round((totalCents * pct) / 100);
      distributedCents += shareCents;

      return {
        user_id: p.user_id,
        share_value: shareCents / 100
      };
    });

    // Remainder adjustment due to percent rounding
    const discrepancy = totalCents - distributedCents;
    if (discrepancy !== 0 && shares.length > 0) {
      shares[0].share_value = Math.round((shares[0].share_value * 100) + discrepancy) / 100;
    }

    return shares;
  }
}

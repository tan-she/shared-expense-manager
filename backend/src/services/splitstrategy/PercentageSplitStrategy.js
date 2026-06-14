/**
 * services/splitstrategy/PercentageSplitStrategy.js
 *
 * Divides an amount based on custom percentages per participant.
 * Rounding Remainder Rule:
 *   Assign rounding remainder to the payer if they are in the split.
 *   Otherwise, assign it to the participant with the largest percentage share.
 */

import SplitStrategy from './SplitStrategy.js';
import { createError } from '../../middleware/errorHandler.js';

export default class PercentageSplitStrategy extends SplitStrategy {
  validate(totalAmount, splitsInput) {
    if (!splitsInput || splitsInput.length === 0) {
      throw createError(400, 'At least one participant is required.');
    }

    const totalPercentage = splitsInput.reduce((sum, p) => sum + parseFloat(p.value || 0), 0);
    if (Math.abs(totalPercentage - 100) > 0.01) {
      throw createError(400, `Percentages must sum to 100%. Provided total: ${totalPercentage}%`);
    }
  }

  calculate(totalAmount, splitsInput, payerId) {
    this.validate(totalAmount, splitsInput);

    const totalCents = Math.round(totalAmount * 100);
    let distributedCents = 0;

    const shares = splitsInput.map(p => {
      const pct = parseFloat(p.value);
      const shareCents = Math.round((totalCents * pct) / 100);
      distributedCents += shareCents;

      return {
        user_id: parseInt(p.user_id),
        share_value: shareCents / 100,
        pct // temporary store to identify largest share
      };
    });

    const discrepancy = totalCents - distributedCents;
    if (discrepancy !== 0 && shares.length > 0) {
      const payerIndex = shares.findIndex(s => s.user_id === parseInt(payerId));
      if (payerIndex !== -1) {
        shares[payerIndex].share_value = Math.round((shares[payerIndex].share_value * 100) + discrepancy) / 100;
      } else {
        // Fallback: Assign remainder to participant with largest percentage
        let largestIndex = 0;
        let largestPct = shares[0].pct;
        for (let i = 1; i < shares.length; i++) {
          if (shares[i].pct > largestPct) {
            largestPct = shares[i].pct;
            largestIndex = i;
          }
        }
        shares[largestIndex].share_value = Math.round((shares[largestIndex].share_value * 100) + discrepancy) / 100;
      }
    }

    // Clean up temporary pct property
    return shares.map(({ user_id, share_value }) => ({ user_id, share_value }));
  }
}

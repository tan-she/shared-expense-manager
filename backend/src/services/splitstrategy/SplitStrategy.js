/**
 * services/splitstrategy/SplitStrategy.js
 *
 * Abstract base class defining the contract for all split strategy implementations.
 *
 * Design Pattern: Strategy Pattern
 */
export default class SplitStrategy {
  /**
   * Calculates the split amount for each participant.
   *
   * @param {number} totalAmount - The total converted amount in base currency (INR)
   * @param {Array<object>} splitsInput - Array of { user_id, value } where value meaning is strategy-specific
   * @param {number} [payerId] - The ID of the user who paid the expense (for rounding adjustments)
   * @returns {Array<object>} Array of { user_id, share_value } calculated in base currency (INR)
   */
  calculate(totalAmount, splitsInput, payerId) {
    throw new Error('calculate() must be implemented by subclass.');
  }

  /**
   * Validates the input splits.
   *
   * @param {number} totalAmount - The total converted amount in base currency (INR)
   * @param {Array<object>} splitsInput - Array of { user_id, value }
   */
  validate(totalAmount, splitsInput) {
    throw new Error('validate() must be implemented by subclass.');
  }
}

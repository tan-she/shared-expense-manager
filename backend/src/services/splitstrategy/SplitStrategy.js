/**
 * services/splitstrategy/SplitStrategy.js
 *
 * Abstract base class defining the contract for all split strategy implementations.
 *
 * Design Pattern: Strategy Pattern
 * Encapsulates the algorithm to distribute an expense total among participants.
 */
export default class SplitStrategy {
  /**
   * Calculates the split amount for each participant.
   *
   * @param {number} totalAmount - The total converted amount in base currency (INR)
   * @param {Array<object>} splitsInput - Array of { userId, value } where value meaning is strategy-specific
   * @returns {Array<object>} Array of { userId, share_value } containing calculated amount in base currency (INR)
   */
  calculate(totalAmount, splitsInput) {
    throw new Error('calculate() must be implemented by subclass.');
  }

  /**
   * Validates the input splits.
   *
   * @param {number} totalAmount - The total converted amount in base currency (INR)
   * @param {Array<object>} splitsInput - Array of { userId, value }
   */
  validate(totalAmount, splitsInput) {
    throw new Error('validate() must be implemented by subclass.');
  }
}

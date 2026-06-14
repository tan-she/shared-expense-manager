/**
 * services/importengine/AnomalyDetector.js
 *
 * Abstract base class for all row-level and session-level anomaly detectors.
 *
 * Design Pattern: Template Method Pattern
 */
export default class AnomalyDetector {
  constructor(name, severity, description) {
    this.name = name;           // Unique identifier (e.g. 'DUPLICATE_EXPENSE')
    this.severity = severity;   // 'INFO' | 'WARNING' | 'CRITICAL'
    this.description = description;
  }

  /**
   * Evaluates the given CSV row/data.
   *
   * @param {object} row - The row data: { Date, Description, Amount, Currency, PayerEmail, SplitType, ParticipantsSplits }
   * @param {object} context - Contextual state (e.g., list of group members, existing expenses in group)
   * @returns {object|null} Returns an anomaly object { anomaly_type, severity, description } if detected, else null.
   */
  detect(row, context) {
    throw new Error('detect() must be implemented by subclass.');
  }
}

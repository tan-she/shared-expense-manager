import AnomalyDetector from '../AnomalyDetector.js';

export default class NegativeAmountDetector extends AnomalyDetector {
  constructor() {
    super(
      'NEGATIVE_AMOUNT',
      'CRITICAL',
      'The expense amount cannot be negative.'
    );
  }

  detect(row, context) {
    const amt = parseFloat(row.Amount);
    if (isNaN(amt) || amt < 0) {
      return {
        anomaly_type: this.name,
        severity: this.severity,
        description: this.description
      };
    }
    return null;
  }
}

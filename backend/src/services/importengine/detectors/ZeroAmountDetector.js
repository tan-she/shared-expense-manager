import AnomalyDetector from '../AnomalyDetector.js';

export default class ZeroAmountDetector extends AnomalyDetector {
  constructor() {
    super(
      'ZERO_AMOUNT',
      'WARNING',
      'The expense amount is exactly zero.'
    );
  }

  detect(row, context) {
    const amt = parseFloat(row.Amount);
    if (!isNaN(amt) && amt === 0) {
      return {
        anomaly_type: this.name,
        severity: this.severity,
        description: this.description
      };
    }
    return null;
  }
}

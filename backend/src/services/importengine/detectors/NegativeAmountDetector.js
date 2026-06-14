import AnomalyDetector from '../AnomalyDetector.js';

export default class NegativeAmountDetector extends AnomalyDetector {
  constructor() {
    super(
      'NEGATIVE_AMOUNT',
      'WARNING',
      'The expense amount is negative, which usually indicates a refund.'
    );
  }

  detect(row, context) {
    const amt = parseFloat(row.Amount);
    if (!isNaN(amt) && amt < 0) {
      return {
        anomaly_type: this.name,
        severity: this.severity,
        description: this.description,
        suggested_fix: 'Import as a Refund (swap payer and splits to reverse debt flow).'
      };
    }
    return null;
  }
}

import AnomalyDetector from '../AnomalyDetector.js';

export default class MissingPayerDetector extends AnomalyDetector {
  constructor() {
    super(
      'MISSING_PAYER',
      'CRITICAL',
      'The payer email field is missing or empty.'
    );
  }

  detect(row, context) {
    if (!row.PayerEmail || !row.PayerEmail.trim()) {
      return {
        anomaly_type: this.name,
        severity: this.severity,
        description: this.description
      };
    }
    return null;
  }
}

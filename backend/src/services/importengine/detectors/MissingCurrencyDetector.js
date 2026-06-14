import AnomalyDetector from '../AnomalyDetector.js';

export default class MissingCurrencyDetector extends AnomalyDetector {
  constructor() {
    super(
      'MISSING_CURRENCY',
      'CRITICAL',
      'The currency code is missing or unsupported. Only USD and INR are allowed.'
    );
  }

  detect(row, context) {
    const currency = row.Currency?.toUpperCase().trim();
    if (!currency || (currency !== 'INR' && currency !== 'USD')) {
      return {
        anomaly_type: this.name,
        severity: this.severity,
        description: this.description
      };
    }
    return null;
  }
}

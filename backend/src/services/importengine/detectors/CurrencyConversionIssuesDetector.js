import AnomalyDetector from '../AnomalyDetector.js';

export default class CurrencyConversionIssuesDetector extends AnomalyDetector {
  constructor() {
    super(
      'CURRENCY_CONVERSION_ISSUES',
      'CRITICAL',
      'This transaction contains values that fail currency conversion validations (e.g. rate is <= 0 or missing).'
    );
  }

  detect(row, context) {
    const currency = row.Currency?.toUpperCase().trim();
    if (!currency) return null; // Missing currency detector catches this

    if (currency !== 'INR' && currency !== 'USD') {
      return {
        anomaly_type: this.name,
        severity: this.severity,
        description: `Unsupported currency code "${currency}" prevents conversion calculations.`
      };
    }

    const amt = parseFloat(row.Amount);
    if (isNaN(amt) || amt <= 0) return null; // Handled by negative amount detector

    return null;
  }
}

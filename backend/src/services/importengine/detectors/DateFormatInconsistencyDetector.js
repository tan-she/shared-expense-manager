import AnomalyDetector from '../AnomalyDetector.js';

export default class DateFormatInconsistencyDetector extends AnomalyDetector {
  constructor() {
    super(
      'DATE_FORMAT_INCONSISTENCY',
      'WARNING',
      'The date string is invalid or inconsistent with standard date structures.'
    );
  }

  detect(row, context) {
    if (!row.Date) {
      return {
        anomaly_type: this.name,
        severity: 'CRITICAL',
        description: 'Expense date is completely missing.'
      };
    }

    const timestamp = Date.parse(row.Date);
    if (isNaN(timestamp)) {
      return {
        anomaly_type: this.name,
        severity: 'CRITICAL',
        description: `The date format is completely invalid: "${row.Date}"`
      };
    }
    return null;
  }
}

import AnomalyDetector from '../AnomalyDetector.js';

export default class InvalidSplitPercentagesDetector extends AnomalyDetector {
  constructor() {
    super(
      'INVALID_SPLIT_PERCENTAGES',
      'CRITICAL',
      'The split percentages do not sum to 100%.'
    );
  }

  detect(row, context) {
    if (row.SplitType?.toUpperCase() === 'PERCENTAGE') {
      const splits = row.ParticipantsSplits || '';
      const parts = splits.split(';');

      let sum = 0;
      for (const p of parts) {
        const value = parseFloat(p.split(':')[1]);
        if (!isNaN(value)) {
          sum += value;
        }
      }

      if (Math.abs(sum - 100) > 0.01) {
        return {
          anomaly_type: this.name,
          severity: this.severity,
          description: `Split percentages must sum to exactly 100%. Provided sum: ${sum}%`
        };
      }
    }
    return null;
  }
}

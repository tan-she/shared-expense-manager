import AnomalyDetector from '../AnomalyDetector.js';

export default class PrecisionIssuesDetector extends AnomalyDetector {
  constructor() {
    super(
      'PRECISION_ISSUES',
      'WARNING',
      'The amount or split values have more than 2 decimal places, indicating potential precision rounding issues.'
    );
  }

  detect(row, context) {
    const amtStr = row.Amount?.toString().trim() || '';
    if (amtStr.includes('.')) {
      const decimals = amtStr.split('.')[1];
      if (decimals.length > 2) {
        return {
          anomaly_type: this.name,
          severity: this.severity,
          description: `The expense amount "${amtStr}" has ${decimals.length} decimal places. Values will be rounded to 2 decimal places.`
        };
      }
    }

    const splits = row.ParticipantsSplits || '';
    const parts = splits.split(';');
    for (const p of parts) {
      const valStr = p.split(':')[1]?.trim();
      if (valStr && valStr.includes('.')) {
        const decimals = valStr.split('.')[1];
        if (decimals.length > 2) {
          return {
            anomaly_type: this.name,
            severity: this.severity,
            description: `Split participant value "${p}" has ${decimals.length} decimal places. Values will be rounded.`
          };
        }
      }
    }

    return null;
  }
}

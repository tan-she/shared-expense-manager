import AnomalyDetector from '../AnomalyDetector.js';

export default class ConflictingDuplicatesDetector extends AnomalyDetector {
  constructor() {
    super(
      'CONFLICTING_DUPLICATES',
      'CRITICAL',
      'This row conflicts with another row in the CSV file (same date, description, and payer, but different amounts).'
    );
  }

  detect(row, context) {
    const { allRows, currentRowIndex } = context;
    if (!allRows) return null;

    const rowDateStr = new Date(row.Date).toISOString().split('T')[0];
    const rowAmount = parseFloat(row.Amount);
    const rowPayer = row.PayerEmail?.toLowerCase().trim();
    const rowDesc = row.Description?.toLowerCase().trim();

    for (let i = 0; i < allRows.length; i++) {
      if (i === currentRowIndex) continue;
      const other = allRows[i];

      const otherDateStr = new Date(other.Date).toISOString().split('T')[0];
      const otherAmount = parseFloat(other.Amount);
      const otherPayer = other.PayerEmail?.toLowerCase().trim();
      const otherDesc = other.Description?.toLowerCase().trim();

      if (rowDateStr === otherDateStr &&
          rowPayer === otherPayer &&
          rowDesc === otherDesc &&
          rowAmount !== otherAmount) {
        return {
          anomaly_type: this.name,
          severity: this.severity,
          description: `This row conflicts with Row #${i + 1} (identical details, but amounts differ: ${rowAmount} vs ${otherAmount}).`
        };
      }
    }
    return null;
  }
}

import AnomalyDetector from '../AnomalyDetector.js';

export default class NearDuplicateExpenseDetector extends AnomalyDetector {
  constructor() {
    super(
      'NEAR_DUPLICATE_EXPENSE',
      'INFO',
      'An expense with the same date, amount, and payer exists, but with a different description.'
    );
  }

  detect(row, context) {
    const { existingExpenses } = context;
    const rowDateStr = new Date(row.Date).toISOString().split('T')[0];
    const rowAmount = parseFloat(row.Amount);
    const rowPayer = row.PayerEmail?.toLowerCase().trim();
    const rowDesc = row.Description?.toLowerCase().trim();

    const isNearDuplicate = existingExpenses.some(exp => {
      const expDateStr = new Date(exp.expense_date).toISOString().split('T')[0];
      return expDateStr === rowDateStr &&
             parseFloat(exp.amount) === rowAmount &&
             exp.payer_email?.toLowerCase().trim() === rowPayer &&
             exp.description?.toLowerCase().trim() !== rowDesc;
    });

    if (isNearDuplicate) {
      return {
        anomaly_type: this.name,
        severity: this.severity,
        description: this.description
      };
    }
    return null;
  }
}

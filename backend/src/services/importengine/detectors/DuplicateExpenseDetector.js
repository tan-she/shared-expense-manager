import AnomalyDetector from '../AnomalyDetector.js';

export default class DuplicateExpenseDetector extends AnomalyDetector {
  constructor() {
    super(
      'DUPLICATE_EXPENSE',
      'WARNING',
      'An expense with the exact same date, amount, payer, and description already exists in this group.'
    );
  }

  detect(row, context) {
    const { existingExpenses } = context;
    const rowDateStr = new Date(row.Date).toISOString().split('T')[0];
    const rowAmount = parseFloat(row.Amount);
    const rowPayer = row.PayerEmail?.toLowerCase().trim();
    const rowDesc = row.Description?.toLowerCase().trim();

    const isDuplicate = existingExpenses.some(exp => {
      const expDateStr = new Date(exp.expense_date).toISOString().split('T')[0];
      return expDateStr === rowDateStr &&
             parseFloat(exp.amount) === rowAmount &&
             exp.payer_email?.toLowerCase().trim() === rowPayer &&
             exp.description?.toLowerCase().trim() === rowDesc;
    });

    if (isDuplicate) {
      return {
        anomaly_type: this.name,
        severity: this.severity,
        description: this.description
      };
    }
    return null;
  }
}

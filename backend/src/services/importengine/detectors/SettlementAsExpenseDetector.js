import AnomalyDetector from '../AnomalyDetector.js';

export default class SettlementAsExpenseDetector extends AnomalyDetector {
  constructor() {
    super(
      'SETTLEMENT_AS_EXPENSE',
      'WARNING',
      'The description contains keywords indicating this transaction may be a settlement payment, not a group expense.'
    );
  }

  detect(row, context) {
    const desc = row.Description?.toLowerCase() || '';
    const keywords = ['settle', 'repay', 'payment to', 'transfer to', 'settled', 'repayment'];
    const isSettlement = keywords.some(k => desc.includes(k));

    if (isSettlement) {
      return {
        anomaly_type: this.name,
        severity: this.severity,
        description: this.description,
        suggested_fix: 'Convert transaction to a direct Settlement entry instead of an Expense.'
      };
    }
    return null;
  }
}

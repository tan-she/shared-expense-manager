import AnomalyDetector from '../AnomalyDetector.js';

export default class MembershipViolationsDetector extends AnomalyDetector {
  constructor() {
    super(
      'MEMBERSHIP_VIOLATIONS',
      'CRITICAL',
      'One or more participants (payer or split members) were not active members of this group on the expense date.'
    );
  }

  detect(row, context) {
    const { groupMembers } = context;
    if (isNaN(Date.parse(row.Date))) return null; // Let format detector catch this

    const expenseDate = new Date(row.Date);

    // Helper helper to check timeline
    const isUserActiveOnDate = (email) => {
      const records = groupMembers.filter(m => m.email.toLowerCase().trim() === email.toLowerCase().trim());
      return records.some(m => {
        const join = new Date(m.joined_at);
        const left = m.left_at ? new Date(m.left_at) : null;
        return join <= expenseDate && (left === null || left >= expenseDate);
      });
    };

    // 1. Verify payer
    const payer = row.PayerEmail?.toLowerCase().trim();
    if (payer && !isUserActiveOnDate(payer)) {
      return {
        anomaly_type: this.name,
        severity: this.severity,
        description: `Payer (${payer}) was not an active member on ${expenseDate.toISOString().split('T')[0]}.`
      };
    }

    // 2. Verify split participants
    const splits = row.ParticipantsSplits || '';
    const parts = splits.split(';').map(p => p.split(':')[0].toLowerCase().trim());

    for (const p of parts) {
      if (p && !isUserActiveOnDate(p)) {
        return {
          anomaly_type: this.name,
          severity: this.severity,
          description: `Split participant (${p}) was not an active member on ${expenseDate.toISOString().split('T')[0]}.`
        };
      }
    }

    return null;
  }
}

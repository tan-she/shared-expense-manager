import AnomalyDetector from '../AnomalyDetector.js';

export default class UnknownParticipantDetector extends AnomalyDetector {
  constructor() {
    super(
      'UNKNOWN_PARTICIPANT',
      'CRITICAL',
      'One or more participant emails are not registered users in this group.'
    );
  }

  detect(row, context) {
    const { groupMembers } = context;
    const memberEmails = new Set(groupMembers.map(m => m.email.toLowerCase().trim()));

    // 1. Check Payer
    const payer = row.PayerEmail?.toLowerCase().trim();
    if (payer && !memberEmails.has(payer)) {
      return {
        anomaly_type: this.name,
        severity: this.severity,
        description: `Payer email (${payer}) is not a registered member of this group.`
      };
    }

    // 2. Check splits participants
    const splits = row.ParticipantsSplits || '';
    const parts = splits.split(';').map(p => p.split(':')[0].toLowerCase().trim());

    for (const p of parts) {
      if (p && !memberEmails.has(p)) {
        return {
          anomaly_type: this.name,
          severity: this.severity,
          description: `Participant email (${p}) is not a registered member of this group.`
        };
      }
    }

    return null;
  }
}

import AnomalyDetector from '../AnomalyDetector.js';

export default class IdentityAliasDetector extends AnomalyDetector {
  constructor() {
    super(
      'IDENTITY_ALIAS_WARNING',
      'WARNING',
      'A participant identifier matches a member name or nickname rather than a formal email address.'
    );
  }

  detect(row, context) {
    const { groupMembers } = context;
    const splits = row.ParticipantsSplits || '';
    const items = splits.split(';').map(p => p.split(':')[0].trim());

    for (const item of items) {
      if (!item) continue;

      // If it doesn't look like an email (doesn't contain '@')
      if (!item.includes('@')) {
        // Find best match in group members by name prefix similarity
        const normalizedItem = item.toLowerCase();
        const matchedMember = groupMembers.find(m => 
          m.name.toLowerCase().includes(normalizedItem) ||
          normalizedItem.includes(m.name.toLowerCase()) ||
          m.email.toLowerCase().startsWith(normalizedItem)
        );

        if (matchedMember) {
          return {
            anomaly_type: this.name,
            severity: this.severity,
            description: `Identifier "${item}" appears to be an alias for group member "${matchedMember.name}".`,
            suggested_fix: `Replace "${item}" with "${matchedMember.email}".`
          };
        }
      }
    }
    return null;
  }
}

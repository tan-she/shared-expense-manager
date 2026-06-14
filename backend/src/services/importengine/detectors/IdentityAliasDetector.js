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

      // If it doesn't look like a formal email
      if (!item.includes('@')) {
        const normalizedItem = item.toLowerCase();
        
        // Find all potential matching members
        const matches = groupMembers.filter(m => 
          m.name.toLowerCase().includes(normalizedItem) ||
          normalizedItem.includes(m.name.toLowerCase()) ||
          m.email.toLowerCase().startsWith(normalizedItem)
        );

        if (matches.length === 1) {
          const matchedMember = matches[0];
          // High Confidence match if item is sufficiently long and matches uniquely
          const isHighConfidence = normalizedItem.length >= 3;
          
          return {
            anomaly_type: this.name,
            severity: isHighConfidence ? 'INFO' : 'WARNING',
            description: `Identifier "${item}" matched group member "${matchedMember.name}".`,
            suggested_fix: `Replace "${item}" with "${matchedMember.email}".`,
            confidence: isHighConfidence ? 'HIGH_CONFIDENCE_AUTO_RESOLVABLE' : 'LOW_CONFIDENCE_REVIEW_REQUIRED'
          };
        } else if (matches.length > 1) {
          // Ambiguous: multiple potential matches
          const candidateNames = matches.map(m => m.name).join(', ');
          return {
            anomaly_type: this.name,
            severity: 'CRITICAL',
            description: `Ambiguous alias "${item}". Matches multiple members: [${candidateNames}].`,
            suggested_fix: 'Explicit manual confirmation is required. Please specify the exact email.',
            confidence: 'LOW_CONFIDENCE_REVIEW_REQUIRED'
          };
        }
      }
    }
    return null;
  }
}

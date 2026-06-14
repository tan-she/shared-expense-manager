/**
 * services/importengine/AnomalyDetectionService.js
 *
 * Pipeline coordinator that registers all 15 anomaly detectors
 * and runs them sequentially over each parsed CSV row.
 *
 * Design Pattern: Chain of Responsibility Pattern
 */

import DuplicateExpenseDetector from './detectors/DuplicateExpenseDetector.js';
import NearDuplicateExpenseDetector from './detectors/NearDuplicateExpenseDetector.js';
import MissingPayerDetector from './detectors/MissingPayerDetector.js';
import MissingCurrencyDetector from './detectors/MissingCurrencyDetector.js';
import NegativeAmountDetector from './detectors/NegativeAmountDetector.js';
import ZeroAmountDetector from './detectors/ZeroAmountDetector.js';
import SettlementAsExpenseDetector from './detectors/SettlementAsExpenseDetector.js';
import UnknownParticipantDetector from './detectors/UnknownParticipantDetector.js';
import InvalidSplitPercentagesDetector from './detectors/InvalidSplitPercentagesDetector.js';
import DateFormatInconsistencyDetector from './detectors/DateFormatInconsistencyDetector.js';
import ConflictingDuplicatesDetector from './detectors/ConflictingDuplicatesDetector.js';
import MembershipViolationsDetector from './detectors/MembershipViolationsDetector.js';
import PrecisionIssuesDetector from './detectors/PrecisionIssuesDetector.js';
import CurrencyConversionIssuesDetector from './detectors/CurrencyConversionIssuesDetector.js';
import IdentityAliasDetector from './detectors/IdentityAliasDetector.js';

class AnomalyDetectionService {
  constructor() {
    this.detectors = [
      new DateFormatInconsistencyDetector(),
      new MissingPayerDetector(),
      new MissingCurrencyDetector(),
      new NegativeAmountDetector(),
      new ZeroAmountDetector(),
      new PrecisionIssuesDetector(),
      new UnknownParticipantDetector(),
      new InvalidSplitPercentagesDetector(),
      new CurrencyConversionIssuesDetector(),
      new MembershipViolationsDetector(),
      new ConflictingDuplicatesDetector(),
      new DuplicateExpenseDetector(),
      new NearDuplicateExpenseDetector(),
      new SettlementAsExpenseDetector(),
      new IdentityAliasDetector()
    ];
  }

  detectAnomalies(row, context) {
    const anomalies = [];

    for (const detector of this.detectors) {
      try {
        const anomaly = detector.detect(row, context);
        if (anomaly) {
          anomalies.push(anomaly);
        }
      } catch (err) {
        console.error(`[Detector Error] ${detector.name} failed:`, err.message);
      }
    }

    return anomalies;
  }
}

export default new AnomalyDetectionService();

/**
 * services/MembershipService.js
 *
 * Core service for handling group membership rules, state transitions,
 * and temporal validation across the application.
 *
 * Design Pattern: Service Layer Pattern / Domain Service
 * Enforces business invariants decoupled from Express request/response layers,
 * allowing reuse in Expenses, Settlements, and CSV Import engines.
 */

import pool from '../config/db.js';
import { createError } from '../middleware/errorHandler.js';

class MembershipService {
  /**
   * Check if a user is/was an active member on a specific date.
   * Business Rule: joined_at <= date AND (left_at IS NULL OR left_at >= date)
   */
  async isActiveMember(userId, groupId, date = new Date()) {
    const checkDate = new Date(date);
    const result = await pool.query(
      `SELECT id FROM group_members
       WHERE group_id = $1 
         AND user_id = $2 
         AND joined_at <= $3 
         AND (left_at IS NULL OR left_at >= $3)`,
      [groupId, userId, checkDate]
    );
    return result.rows.length > 0;
  }

  /**
   * Returns all user IDs active in a group on a specific date.
   */
  async getActiveMembers(groupId, date = new Date()) {
    const checkDate = new Date(date);
    const result = await pool.query(
      `SELECT user_id FROM group_members
       WHERE group_id = $1 
         AND joined_at <= $2 
         AND (left_at IS NULL OR left_at >= $2)`,
      [groupId, checkDate]
    );
    return result.rows.map(row => row.user_id);
  }

  /**
   * Validate that the payer and all split participants were active members on the expense date.
   */
  async validateExpenseParticipants(groupId, payerId, participantIds, expenseDate) {
    const dateToCheck = new Date(expenseDate);

    // Validate payer
    const isPayerActive = await this.isActiveMember(payerId, groupId, dateToCheck);
    if (!isPayerActive) {
      throw createError(400, `Payer (User ID: ${payerId}) was not an active member on the expense date (${dateToCheck.toISOString()}).`);
    }

    // Validate all participants
    for (const participantId of participantIds) {
      const isActive = await this.isActiveMember(participantId, groupId, dateToCheck);
      if (!isActive) {
        throw createError(400, `Participant (User ID: ${participantId}) was not an active member on the expense date (${dateToCheck.toISOString()}).`);
      }
    }
    return true;
  }
}

export default new MembershipService();

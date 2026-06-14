/**
 * routes/groups.js — Group & Membership Management
 *
 * All routes require authentication (protect middleware).
 *
 * Ownership Rules:
 *   Action             | Member | Creator
 *   -------------------|--------|--------
 *   View Group         |   ✅   |   ✅
 *   Add Expense        |   ✅   |   ✅
 *   Rename Group       |   ❌   |   ✅
 *   Delete Group       |   ❌   |   ✅
 *   Add Member         |   ❌   |   ✅
 *   Remove Member      |   ❌   |   ✅
 *   Leave Group (Self) |   ✅   |   ✅ (if not sole member)
 */

import express from 'express';
import pool from '../config/db.js';
import { protect } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import MembershipService from '../services/MembershipService.js';

const router = express.Router();

// All group routes require a valid JWT
router.use(protect);

// ── GET /api/groups ───────────────────────────────────────────────────────
// Returns all groups where the requesting user is (or was) a member.
router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT
       g.id,
       g.name,
       g.creator_id,
       g.created_at,
       COUNT(DISTINCT CASE WHEN gm2.left_at IS NULL THEN gm2.user_id END) AS member_count
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
     LEFT JOIN group_members gm2 ON gm2.group_id = g.id
     GROUP BY g.id, g.name, g.creator_id, g.created_at
     ORDER BY g.created_at DESC`,
    [req.user.id]
  );

  res.status(200).json({ success: true, groups: result.rows });
}));

// ── POST /api/groups ──────────────────────────────────────────────────────
router.post('/', asyncHandler(async (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    throw createError(400, 'Group name is required.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const groupResult = await client.query(
      `INSERT INTO groups (name, creator_id) VALUES ($1, $2) RETURNING id, name, creator_id, created_at`,
      [name.trim(), req.user.id]
    );
    const group = groupResult.rows[0];

    // Creator joins automatically
    await client.query(
      `INSERT INTO group_members (group_id, user_id, joined_at)
       VALUES ($1, $2, NOW())`,
      [group.id, req.user.id]
    );

    await client.query('COMMIT');

    res.status(201).json({ success: true, group });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// ── GET /api/groups/:id ───────────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  const groupId = parseInt(req.params.id);

  const groupResult = await pool.query(
    `SELECT id, name, creator_id, created_at FROM groups WHERE id = $1`,
    [groupId]
  );
  if (groupResult.rows.length === 0) {
    throw createError(404, 'Group not found.');
  }

  // User must be a past or present member to view group details
  await assertMembership(req.user.id, groupId);

  // Fetch current active members
  const membersResult = await pool.query(
    `SELECT
       u.id,
       u.name,
       u.email,
       gm.joined_at,
       gm.left_at
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1 AND gm.left_at IS NULL
     ORDER BY gm.joined_at ASC`,
    [groupId]
  );

  res.status(200).json({
    success: true,
    group: groupResult.rows[0],
    members: membersResult.rows,
  });
}));

// ── PUT /api/groups/:id ───────────────────────────────────────────────────
// Only creator can rename group
router.put('/:id', asyncHandler(async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { name } = req.body;

  if (!name || !name.trim()) {
    throw createError(400, 'Group name is required.');
  }

  await assertCreator(req.user.id, groupId);

  const result = await pool.query(
    `UPDATE groups SET name = $1 WHERE id = $2
     RETURNING id, name, creator_id, created_at`,
    [name.trim(), groupId]
  );
  if (result.rows.length === 0) {
    throw createError(404, 'Group not found.');
  }

  res.status(200).json({ success: true, group: result.rows[0] });
}));

// ── DELETE /api/groups/:id ────────────────────────────────────────────────
// Only creator can delete group
router.delete('/:id', asyncHandler(async (req, res) => {
  const groupId = parseInt(req.params.id);

  await assertCreator(req.user.id, groupId);

  const result = await pool.query(
    `DELETE FROM groups WHERE id = $1 RETURNING id`,
    [groupId]
  );
  if (result.rows.length === 0) {
    throw createError(404, 'Group not found.');
  }

  res.status(200).json({ success: true, message: 'Group deleted successfully.' });
}));

// ── POST /api/groups/:id/members ──────────────────────────────────────────
// Add or Rejoin member (Only creator can add)
router.post('/:id/members', asyncHandler(async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { email, joined_at } = req.body;

  if (!email) {
    throw createError(400, 'Member email is required.');
  }

  await assertCreator(req.user.id, groupId);

  const userResult = await pool.query(
    `SELECT id, name, email FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );
  if (userResult.rows.length === 0) {
    throw createError(404, `No account found for email: ${email}`);
  }
  const targetUser = userResult.rows[0];

  // Prevent joining twice while already active
  const isActive = await MembershipService.isActiveMember(targetUser.id, groupId);
  if (isActive) {
    throw createError(409, `${targetUser.name} is already an active member of this group.`);
  }

  const joinDate = joined_at ? new Date(joined_at) : new Date();

  // If rejoining, check that new joinDate is after the last left_at date
  const lastMembershipResult = await pool.query(
    `SELECT left_at FROM group_members
     WHERE group_id = $1 AND user_id = $2
     ORDER BY left_at DESC LIMIT 1`,
    [groupId, targetUser.id]
  );
  
  if (lastMembershipResult.rows.length > 0 && lastMembershipResult.rows[0].left_at) {
    const lastLeftAt = new Date(lastMembershipResult.rows[0].left_at);
    if (joinDate <= lastLeftAt) {
      throw createError(400, `Rejoin date must be after the last leave date (${lastLeftAt.toISOString()}).`);
    }
  }

  const result = await pool.query(
    `INSERT INTO group_members (group_id, user_id, joined_at)
     VALUES ($1, $2, $3)
     RETURNING id, group_id, user_id, joined_at, left_at`,
    [groupId, targetUser.id, joinDate]
  );

  res.status(201).json({
    success: true,
    message: `${targetUser.name} joined the group successfully.`,
    member: { ...result.rows[0], name: targetUser.name, email: targetUser.email },
  });
}));

// ── PUT /api/groups/:id/members/:userId/leave ─────────────────────────────
// Member leaves or Creator removes a member
router.put('/:id/members/:userId/leave', asyncHandler(async (req, res) => {
  const groupId  = parseInt(req.params.id);
  const userId   = parseInt(req.params.userId);
  const { left_at } = req.body;

  // Authorization check: Only self leaving or group creator removing someone
  if (req.user.id !== userId) {
    await assertCreator(req.user.id, groupId);
  } else {
    await assertMembership(req.user.id, groupId);
  }

  // Get current active membership record
  const memberCheck = await pool.query(
    `SELECT id, joined_at FROM group_members
     WHERE group_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [groupId, userId]
  );
  if (memberCheck.rows.length === 0) {
    throw createError(404, 'Active membership record not found.');
  }

  const leaveDate = left_at ? new Date(left_at) : new Date();

  if (leaveDate <= new Date(memberCheck.rows[0].joined_at)) {
    throw createError(400, 'Leave date must be after the join date.');
  }

  const result = await pool.query(
    `UPDATE group_members
     SET left_at = $1
     WHERE id = $2
     RETURNING id, group_id, user_id, joined_at, left_at`,
    [leaveDate, memberCheck.rows[0].id]
  );

  res.status(200).json({
    success: true,
    message: req.user.id === userId ? 'You left the group.' : 'Member removed from group.',
    membership: result.rows[0],
  });
}));

// ── GET /api/groups/:id/members/history ───────────────────────────────────
// Timeline history containing all historical records (joins and leaves)
router.get('/:id/members/history', asyncHandler(async (req, res) => {
  const groupId = parseInt(req.params.id);

  await assertMembership(req.user.id, groupId);

  const result = await pool.query(
    `SELECT
       u.name AS user,
       gm.joined_at,
       gm.left_at
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1
     ORDER BY gm.joined_at ASC`,
    [groupId]
  );

  res.status(200).json({ success: true, history: result.rows });
}));

// ── Private Helpers ───────────────────────────────────────────────────────

async function assertMembership(userId, groupId) {
  const result = await pool.query(
    `SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );
  if (result.rows.length === 0) {
    throw createError(403, 'You are not a member of this group.');
  }
}

async function assertCreator(userId, groupId) {
  const result = await pool.query(
    `SELECT creator_id FROM groups WHERE id = $1`,
    [groupId]
  );
  if (result.rows.length === 0) {
    throw createError(404, 'Group not found.');
  }
  if (result.rows[0].creator_id !== userId) {
    throw createError(403, 'Only the group creator can perform this action.');
  }
}

export default router;

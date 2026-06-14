/**
 * routes/groups.js — Group & Membership Management
 *
 * All routes require authentication (protect middleware).
 *
 * Endpoints:
 *   GET    /api/groups                          → List all groups the user belongs to
 *   POST   /api/groups                          → Create a new group (creator auto-joined)
 *   GET    /api/groups/:id                      → Get group details + active members
 *   PUT    /api/groups/:id                      → Rename a group
 *   DELETE /api/groups/:id                      → Delete a group (cascades to all data)
 *   POST   /api/groups/:id/members              → Add a user to the group
 *   PUT    /api/groups/:id/members/:userId/leave → Mark a member as left (set left_at)
 *   GET    /api/groups/:id/members/timeline     → Full membership history (joined + left dates)
 *
 * Temporal Membership Rule:
 *   A user is considered an ACTIVE member on date D if:
 *     joined_at <= D AND (left_at IS NULL OR left_at >= D)
 *
 *   This rule is enforced in:
 *     - Phase 4: Expense creation (payer and all split participants must be active)
 *     - Phase 5: Balance calculations
 *     - Phase 6: CSV import anomaly detection (MembershipViolationsDetector)
 */

import express from 'express';
import pool from '../config/db.js';
import { protect } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';

const router = express.Router();

// All group routes require a valid JWT
router.use(protect);

// ── GET /api/groups ───────────────────────────────────────────────────────
// Returns all groups where the requesting user is (or was) a member.
// Sorted by most recently created.
router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT
       g.id,
       g.name,
       g.created_at,
       -- Count only currently active members (left_at IS NULL)
       COUNT(DISTINCT CASE WHEN gm2.left_at IS NULL THEN gm2.user_id END) AS member_count
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
     LEFT JOIN group_members gm2 ON gm2.group_id = g.id
     GROUP BY g.id, g.name, g.created_at
     ORDER BY g.created_at DESC`,
    [req.user.id]
  );

  res.status(200).json({ success: true, groups: result.rows });
}));

// ── POST /api/groups ──────────────────────────────────────────────────────
// Creates a new group and automatically adds the creator as the first member.
// Using a transaction so both inserts succeed or both roll back.
router.post('/', asyncHandler(async (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    throw createError(400, 'Group name is required.');
  }

  // Use a transaction: group + membership must be created atomically.
  // If the membership insert fails, the group insert is rolled back.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const groupResult = await client.query(
      `INSERT INTO groups (name) VALUES ($1) RETURNING id, name, created_at`,
      [name.trim()]
    );
    const group = groupResult.rows[0];

    // Creator is automatically an active member from creation time
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
    // Always release the client back to the pool
    client.release();
  }
}));

// ── GET /api/groups/:id ───────────────────────────────────────────────────
// Returns group details + all currently active members.
// Also confirms the requesting user is a member of this group.
router.get('/:id', asyncHandler(async (req, res) => {
  const groupId = parseInt(req.params.id);

  // Confirm group exists
  const groupResult = await pool.query(
    `SELECT id, name, created_at FROM groups WHERE id = $1`,
    [groupId]
  );
  if (groupResult.rows.length === 0) {
    throw createError(404, 'Group not found.');
  }

  // Confirm requesting user is a member (current or past)
  await assertMembership(req.user.id, groupId);

  // Fetch currently active members with their user details
  const membersResult = await pool.query(
    `SELECT
       u.id,
       u.name,
       u.email,
       gm.joined_at,
       gm.left_at
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1
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
// Rename a group. Only active members may rename.
router.put('/:id', asyncHandler(async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { name } = req.body;

  if (!name || !name.trim()) {
    throw createError(400, 'Group name is required.');
  }

  await assertActiveMembership(req.user.id, groupId);

  const result = await pool.query(
    `UPDATE groups SET name = $1 WHERE id = $2
     RETURNING id, name, created_at`,
    [name.trim(), groupId]
  );
  if (result.rows.length === 0) {
    throw createError(404, 'Group not found.');
  }

  res.status(200).json({ success: true, group: result.rows[0] });
}));

// ── DELETE /api/groups/:id ────────────────────────────────────────────────
// Permanently deletes a group and all related data (CASCADE in schema).
// Only active members may delete.
router.delete('/:id', asyncHandler(async (req, res) => {
  const groupId = parseInt(req.params.id);

  await assertActiveMembership(req.user.id, groupId);

  const result = await pool.query(
    `DELETE FROM groups WHERE id = $1 RETURNING id`,
    [groupId]
  );
  if (result.rows.length === 0) {
    throw createError(404, 'Group not found.');
  }

  res.status(200).json({ success: true, message: 'Group deleted.' });
}));

// ── POST /api/groups/:id/members ──────────────────────────────────────────
// Adds a user (by email) to a group with a specific join date.
// Prevents adding an already-active member.
router.post('/:id/members', asyncHandler(async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { email, joined_at } = req.body;

  if (!email) {
    throw createError(400, 'Member email is required.');
  }

  // Only active members of the group can add new members
  await assertActiveMembership(req.user.id, groupId);

  // Lookup the user to add
  const userResult = await pool.query(
    `SELECT id, name, email FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );
  if (userResult.rows.length === 0) {
    throw createError(404, `No account found for email: ${email}`);
  }
  const targetUser = userResult.rows[0];

  // Check if this user is already an ACTIVE member (left_at IS NULL)
  const activeCheck = await pool.query(
    `SELECT id FROM group_members
     WHERE group_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [groupId, targetUser.id]
  );
  if (activeCheck.rows.length > 0) {
    throw createError(409, `${targetUser.name} is already an active member of this group.`);
  }

  // joined_at defaults to NOW() if not provided — supports backdated additions
  const joinDate = joined_at ? new Date(joined_at) : new Date();

  const result = await pool.query(
    `INSERT INTO group_members (group_id, user_id, joined_at)
     VALUES ($1, $2, $3)
     RETURNING id, group_id, user_id, joined_at, left_at`,
    [groupId, targetUser.id, joinDate]
  );

  res.status(201).json({
    success: true,
    message: `${targetUser.name} added to the group.`,
    member: { ...result.rows[0], name: targetUser.name, email: targetUser.email },
  });
}));

// ── PUT /api/groups/:id/members/:userId/leave ─────────────────────────────
// Sets left_at on a membership record. Does NOT delete the row.
// Preserving the record is essential for the temporal audit trail:
//   - The Balance Engine uses historical membership to validate past expenses.
//   - The CSV import engine checks if a user was active on the expense date.
router.put('/:id/members/:userId/leave', asyncHandler(async (req, res) => {
  const groupId  = parseInt(req.params.id);
  const userId   = parseInt(req.params.userId);
  const { left_at } = req.body;

  // A user can mark themselves as left, or an active member can mark another
  await assertActiveMembership(req.user.id, groupId);

  // Confirm the target member exists and is currently active
  const memberCheck = await pool.query(
    `SELECT id, joined_at FROM group_members
     WHERE group_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [groupId, userId]
  );
  if (memberCheck.rows.length === 0) {
    throw createError(404, 'Active membership not found for this user.');
  }

  const leaveDate = left_at ? new Date(left_at) : new Date();

  // Validate: leave date must be after join date (mirrors DB CHECK constraint)
  if (leaveDate <= new Date(memberCheck.rows[0].joined_at)) {
    throw createError(400, 'Leave date must be after the join date.');
  }

  const result = await pool.query(
    `UPDATE group_members
     SET left_at = $1
     WHERE group_id = $2 AND user_id = $3 AND left_at IS NULL
     RETURNING id, group_id, user_id, joined_at, left_at`,
    [leaveDate, groupId, userId]
  );

  res.status(200).json({
    success: true,
    message: 'Member marked as left.',
    membership: result.rows[0],
  });
}));

// ── GET /api/groups/:id/members/timeline ──────────────────────────────────
// Returns the full membership history including past members.
// Used by the frontend timeline view and CSV import anomaly review.
router.get('/:id/members/timeline', asyncHandler(async (req, res) => {
  const groupId = parseInt(req.params.id);

  await assertMembership(req.user.id, groupId);

  const result = await pool.query(
    `SELECT
       u.id,
       u.name,
       u.email,
       gm.joined_at,
       gm.left_at,
       CASE WHEN gm.left_at IS NULL THEN 'ACTIVE' ELSE 'LEFT' END AS status
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1
     ORDER BY gm.joined_at ASC`,
    [groupId]
  );

  res.status(200).json({ success: true, timeline: result.rows });
}));

// ── Private Helpers ───────────────────────────────────────────────────────

/**
 * Asserts that userId is ANY member of groupId (current or past).
 * Used for read operations — former members can still view history.
 */
async function assertMembership(userId, groupId) {
  const result = await pool.query(
    `SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );
  if (result.rows.length === 0) {
    throw createError(403, 'You are not a member of this group.');
  }
}

/**
 * Asserts that userId is an ACTIVE member of groupId (left_at IS NULL).
 * Used for write operations — only active members can modify the group.
 */
async function assertActiveMembership(userId, groupId) {
  const result = await pool.query(
    `SELECT id FROM group_members
     WHERE group_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [groupId, userId]
  );
  if (result.rows.length === 0) {
    throw createError(403, 'You must be an active member to perform this action.');
  }
}

export default router;

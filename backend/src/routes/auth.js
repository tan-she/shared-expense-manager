/**
 * routes/auth.js — Authentication Endpoints
 *
 * POST /auth/register  → Create a new user account
 * POST /auth/login     → Validate credentials, return JWT
 * GET  /auth/me        → Return the currently authenticated user (protected)
 *
 * Responsibilities of this router:
 *   - Parse and validate HTTP input
 *   - Call bcrypt / jwt (authentication concerns)
 *   - Query the database
 *   - Return HTTP responses
 *
 * This router does NOT contain business logic. If this app had a
 * UserService, these routes would delegate to it. For auth — which
 * is thin and highly I/O bound — keeping it in the router is clean.
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { protect } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';

const router = express.Router();

// ── POST /auth/register ───────────────────────────────────────────────────
router.post('/register', asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  // ── Input Validation ────────────────────────────────────────────────────
  if (!name || !email || !password) {
    throw createError(400, 'Name, email, and password are required.');
  }
  if (password.length < 6) {
    throw createError(400, 'Password must be at least 6 characters.');
  }

  // ── Duplicate Check ─────────────────────────────────────────────────────
  const existing = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  if (existing.rows.length > 0) {
    throw createError(409, 'An account with this email already exists.');
  }

  // ── Hash Password ───────────────────────────────────────────────────────
  // bcrypt salt rounds = 12 → ~250ms on modern hardware.
  // Higher = slower brute force, but slower registration.
  // 10–12 is the industry standard for interactive logins.
  const hashedPassword = await bcrypt.hash(password, 12);

  // ── Insert User ─────────────────────────────────────────────────────────
  const result = await pool.query(
    `INSERT INTO users (name, email, password, role)
     VALUES ($1, $2, $3, 'USER')
     RETURNING id, name, email, role, created_at`,
    [name.trim(), email.toLowerCase(), hashedPassword]
  );

  const user = result.rows[0];

  // ── Issue JWT ───────────────────────────────────────────────────────────
  const token = signToken(user);

  res.status(201).json({
    success: true,
    token,
    user: sanitizeUser(user),
  });
}));

// ── POST /auth/login ──────────────────────────────────────────────────────
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw createError(400, 'Email and password are required.');
  }

  // ── Fetch User ──────────────────────────────────────────────────────────
  const result = await pool.query(
    'SELECT id, name, email, password, role, created_at FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  const user = result.rows[0];

  // ── Verify Password ─────────────────────────────────────────────────────
  // IMPORTANT: We always run bcrypt.compare even if the user doesn't exist.
  // This prevents timing attacks — an attacker cannot tell whether the email
  // is registered by measuring response time.
  const dummyHash = '$2a$12$invalidhashfortimingneutrality000000000000000000000000';
  const isMatch = user
    ? await bcrypt.compare(password, user.password)
    : await bcrypt.compare(password, dummyHash);

  if (!user || !isMatch) {
    // Intentionally vague: don't reveal whether email or password was wrong.
    throw createError(401, 'Invalid email or password.');
  }

  const token = signToken(user);

  res.status(200).json({
    success: true,
    token,
    user: sanitizeUser(user),
  });
}));

// ── GET /auth/me ──────────────────────────────────────────────────────────
// Protected: requires a valid Bearer token.
// Returns the current user's profile without the password hash.
router.get('/me', protect, asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
    [req.user.id]
  );

  if (result.rows.length === 0) {
    throw createError(404, 'User not found.');
  }

  res.status(200).json({
    success: true,
    user: result.rows[0],
  });
}));

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Signs a JWT with the user's id, email, and role.
 * Payload is kept minimal — only data needed for authorization decisions.
 * We do NOT include the password hash or other sensitive fields.
 */
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
}

/**
 * Returns a user object safe to send in API responses.
 * Explicitly omits the password field — never send hashes to clients.
 */
function sanitizeUser(user) {
  const { password, ...safe } = user;
  return safe;
}

export default router;

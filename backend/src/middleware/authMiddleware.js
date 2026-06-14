/**
 * authMiddleware.js — JWT Authentication & Role Guard
 *
 * Provides two middleware functions:
 *
 *   1. protect     → Verify JWT. Attach decoded user to req.user.
 *   2. requireRole → Check that req.user.role matches an allowed role.
 *
 * Usage:
 *   // Any authenticated user
 *   router.get('/me', protect, getMe);
 *
 *   // Only ADMIN users
 *   router.delete('/user/:id', protect, requireRole('ADMIN'), deleteUser);
 *
 * Token location: Authorization header → "Bearer <token>"
 * We do NOT use cookies here to keep the API stateless and easy
 * to test with curl/Postman without managing cookie jars.
 */

import jwt from 'jsonwebtoken';
import { createError } from './errorHandler.js';

/**
 * protect — Verifies the JWT and attaches the decoded payload to req.user.
 *
 * If the token is missing, expired, or tampered with, responds with 401.
 * The decoded payload shape: { id, email, role, iat, exp }
 */
export function protect(req, res, next) {
  // Extract token from "Authorization: Bearer <token>"
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(createError(401, 'No token provided. Please log in.'));
  }

  const token = authHeader.split(' ')[1];

  try {
    // jwt.verify throws if the token is expired or the signature is invalid.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, role, iat, exp }
    next();
  } catch (err) {
    // Distinguish between expired and invalid for clear client messages.
    if (err.name === 'TokenExpiredError') {
      return next(createError(401, 'Session expired. Please log in again.'));
    }
    return next(createError(401, 'Invalid token. Please log in.'));
  }
}

/**
 * requireRole — Role-based access guard.
 * Must always be used AFTER protect (req.user must already be set).
 *
 * @param {...string} roles - One or more allowed roles, e.g. requireRole('ADMIN')
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      // Defensive: requireRole used without protect
      return next(createError(401, 'Not authenticated.'));
    }
    if (!roles.includes(req.user.role)) {
      return next(createError(403, 'You do not have permission to perform this action.'));
    }
    next();
  };
}

/**
 * app.js — Express Application Configuration
 *
 * This file BUILDS the Express app and exports it.
 * It does NOT start the HTTP server (that happens in index.js).
 *
 * Why separate app.js from index.js?
 * ────────────────────────────────────
 * Integration tests (using supertest) import the `app` directly
 * and call supertest(app).get('/...') without needing a running server.
 * If app.listen() were called here, every test file that imports app.js
 * would open a port — causing port conflicts and slow test teardown.
 *
 * Middleware registration order matters in Express:
 *   1. cors         → Must be first to handle preflight OPTIONS requests
 *   2. json parser  → Parse request body before routes read it
 *   3. routes       → All API handlers
 *   4. 404 handler  → Catch unmatched routes
 *   5. errorHandler → Must be LAST; receives err from next(err)
 */

import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import groupRoutes from './routes/groups.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────
// Allow requests from the React frontend only.
// In production, FRONTEND_URL should be the deployed Vercel URL.
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

// ── Body Parsers ──────────────────────────────────────────────────────────
app.use(express.json());

// ── Health Check ──────────────────────────────────────────────────────────
// A simple endpoint that confirms the server is alive.
// Used by load balancers, uptime monitors, and CI health checks.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/api/groups', groupRoutes);

// Placeholder mounts — will be filled in by later phases
// app.use('/api/expenses',    expenseRoutes);
// app.use('/api/settlements', settlementRoutes);
// app.use('/api/balances',    balanceRoutes);
// app.use('/api/imports',     importRoutes);

// ── 404 Handler ───────────────────────────────────────────────────────────
// If no route matched, create a 404 error and pass it to errorHandler.
app.use((req, res, next) => {
  const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.statusCode = 404;
  next(err);
});

// ── Global Error Handler ──────────────────────────────────────────────────
// Must be the LAST middleware. Four-parameter signature tells Express
// this is an error handler, not a regular middleware.
app.use(errorHandler);

export default app;

/**
 * index.js — Server Entry Point
 *
 * Responsibilities (and ONLY these):
 *   1. Load environment variables from .env
 *   2. Initialize the database schema (idempotent)
 *   3. Start the HTTP listener
 *
 * Everything else (middleware, routes) lives in app.js.
 * This separation means tests can import app.js without
 * triggering a database connection or port binding.
 */

import 'dotenv/config';
import app from './app.js';
import { initSchema } from './config/db.js';

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    // Run schema.sql against the connected database.
    // Using DROP IF EXISTS + CREATE in schema.sql makes this safe to
    // re-run in development. In production, use migrations instead.
    await initSchema();

    app.listen(PORT, () => {
      console.log(`[Server] Running at http://localhost:${PORT}`);
      console.log(`[Server] Health: http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error('[Server] Startup failed:', err.message);
    process.exit(1);
  }
}

start();

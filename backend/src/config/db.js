/**
 * db.js — PostgreSQL Connection Pool
 *
 * Creates a single shared pg.Pool instance for the entire application.
 * Using a pool (not individual clients) ensures:
 *   - Connections are reused across requests (performance)
 *   - Max connections are capped (prevents DB exhaustion)
 *   - Idle connections are cleaned up automatically
 *
 * Also exposes initSchema() which runs schema.sql once at startup.
 * This keeps the schema as a single source of truth (the .sql file)
 * rather than duplicating CREATE TABLE statements in application code.
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

// ── ESM-compatible __dirname ───────────────────────────────────────────────
// ESM modules don't have __dirname. We reconstruct it from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Connection Pool ────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Only add SSL for hosted DBs (Neon, RDS).
  // Localhost Postgres doesn't need SSL.
  ssl: process.env.DATABASE_URL?.includes('neon.tech')
    ? { rejectUnauthorized: false }
    : false,
  max: 10,           // Max connections in the pool
  idleTimeoutMillis: 30_000,  // Close idle connections after 30s
  connectionTimeoutMillis: 5_000, // Fail fast if no connection in 5s
});

/**
 * Runs schema.sql against the connected database.
 * Called once during server startup.
 * Uses DROP TABLE IF EXISTS + CREATE TABLE — idempotent and safe to re-run.
 */
export async function initSchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  await pool.query(sql);
  console.log('[DB] Schema initialized successfully.');
}

// Export the pool so routes and services can call pool.query(...)
export default pool;

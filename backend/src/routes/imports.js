/**
 * routes/imports.js — CSV Ingestion & Anomalies Audit Router
 *
 * Implements endpoints for importing group expenses via CSV templates.
 */

import express from 'express';
import multer from 'multer';
import { protect } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import CsvImportEngine from '../services/importengine/CsvImportEngine.js';
import PdfService from '../services/PdfService.js';
import pool from '../config/db.js';

const router = express.Router();
router.use(protect);

// Configure Multer memory storage (files are parsed directly in memory as strings, no disk write)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// ── POST /api/imports/upload ──────────────────────────────────────────────
router.post('/upload', upload.single('file'), asyncHandler(async (req, res) => {
  const { group_id } = req.body;
  const file = req.file;

  if (!group_id) {
    throw createError(400, 'group_id is required to link the import session.');
  }
  if (!file) {
    throw createError(400, 'No file was uploaded. Please provide a CSV file.');
  }

  // Validate requester membership
  const memberCheck = await pool.query(
    `SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [group_id, req.user.id]
  );
  if (memberCheck.rows.length === 0) {
    throw createError(403, 'You are not a member of this group.');
  }

  const csvContent = file.buffer.toString('utf-8');
  const stageResult = await CsvImportEngine.stageImport(
    req.user.id,
    parseInt(group_id),
    file.originalname,
    csvContent
  );

  res.status(201).json({
    success: true,
    message: 'CSV uploaded and staged for anomaly review.',
    sessionId: stageResult.session.id,
    anomaliesCount: stageResult.anomaliesCount,
    session: stageResult.session
  });
}));

// ── GET /api/imports/group/:groupId ───────────────────────────────────────
router.get('/group/:groupId', asyncHandler(async (req, res) => {
  const groupId = parseInt(req.params.groupId);

  const memberCheck = await pool.query(
    `SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, req.user.id]
  );
  if (memberCheck.rows.length === 0) {
    throw createError(403, 'You are not a member of this group.');
  }

  const result = await pool.query(
    `SELECT id, user_id, group_id, file_name, status, rows_processed, rows_imported, rows_skipped, imported_at
     FROM import_sessions
     WHERE group_id = $1
     ORDER BY imported_at DESC`,
    [groupId]
  );

  res.status(200).json({ success: true, sessions: result.rows });
}));

// ── GET /api/imports/session/:sessionId ───────────────────────────────────
router.get('/session/:sessionId', asyncHandler(async (req, res) => {
  const sessionId = parseInt(req.params.sessionId);

  const sessionResult = await pool.query(
    `SELECT id, group_id, file_name, status, rows_processed, csv_data FROM import_sessions WHERE id = $1`,
    [sessionId]
  );
  if (sessionResult.rows.length === 0) {
    throw createError(404, 'Import session not found.');
  }

  const session = sessionResult.rows[0];

  // Membership validation
  const memberCheck = await pool.query(
    `SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [session.group_id, req.user.id]
  );
  if (memberCheck.rows.length === 0) {
    throw createError(403, 'You are not a member of this group.');
  }

  // Fetch anomalies for review
  const anomaliesResult = await pool.query(
    `SELECT id, row_number, anomaly_type, severity, description, action_taken, approved
     FROM import_anomalies
     WHERE import_session_id = $1
     ORDER BY row_number ASC`,
    [sessionId]
  );

  res.status(200).json({
    success: true,
    session,
    anomalies: anomaliesResult.rows
  });
}));

// ── POST /api/imports/session/:sessionId/commit ───────────────────────────
router.post('/session/:sessionId/commit', asyncHandler(async (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  const { resolutions } = req.body; // Array of { row_number, action: 'IMPORT'|'SKIP'|'FIX', fix_data: {} }

  const sessionResult = await pool.query(
    `SELECT group_id FROM import_sessions WHERE id = $1`,
    [sessionId]
  );
  if (sessionResult.rows.length === 0) {
    throw createError(404, 'Import session not found.');
  }

  const memberCheck = await pool.query(
    `SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [sessionResult.rows[0].group_id, req.user.id]
  );
  if (memberCheck.rows.length === 0) {
    throw createError(403, 'You are not a member of this group.');
  }

  const result = await CsvImportEngine.commitImport(sessionId, resolutions);

  res.status(200).json({
    success: true,
    message: 'Import session committed successfully.',
    rowsImported: result.rowsImported,
    rowsSkipped: result.rowsSkipped
  });
}));

// ── GET /api/imports/session/:sessionId/report/pdf ────────────────────────
router.get('/session/:sessionId/report/pdf', asyncHandler(async (req, res) => {
  const sessionId = parseInt(req.params.sessionId);

  // Validate group member privilege
  const sessionResult = await pool.query(
    `SELECT group_id FROM import_sessions WHERE id = $1`,
    [sessionId]
  );
  if (sessionResult.rows.length === 0) {
    throw createError(404, 'Import session not found.');
  }

  const memberCheck = await pool.query(
    `SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [sessionResult.rows[0].group_id, req.user.id]
  );
  if (memberCheck.rows.length === 0) {
    throw createError(403, 'You are not a member of this group.');
  }

  const doc = await PdfService.generateAuditReport(sessionId);

  // Stream PDF directly to response
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=import_audit_${sessionId}.pdf`);

  doc.pipe(res);
  doc.end();
}));

export default router;

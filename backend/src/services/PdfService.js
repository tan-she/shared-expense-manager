/**
 * services/PdfService.js
 *
 * Generates styled PDF audit reports detailing CSV import sessions:
 *   - Executive summary of rows imported, skipped, and resolved.
 *   - Distribution breakdown of anomaly severities.
 *   - Ledger of every anomaly found with action resolution logs.
 *
 * Design Pattern: Service Layer
 */

import PDFDocument from 'pdfkit';
import pool from '../config/db.js';

class PdfService {
  /**
   * Generates a PDF stream for the given import session.
   *
   * @param {number} sessionId - The import session ID
   * @returns {Promise<PDFDocument>} PDF Kit document stream
   */
  async generateAuditReport(sessionId) {
    // 1. Fetch Session details
    const sessionResult = await pool.query(
      `SELECT
         s.id,
         s.file_name,
         s.status,
         s.rows_processed,
         s.rows_imported,
         s.rows_skipped,
         s.imported_at,
         g.name AS group_name,
         u.name AS uploader_name
       FROM import_sessions s
       JOIN groups g ON g.id = s.group_id
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1`,
      [sessionId]
    );

    if (sessionResult.rows.length === 0) {
      throw new Error('Import session not found.');
    }
    const session = sessionResult.rows[0];

    // 2. Fetch anomalies
    const anomaliesResult = await pool.query(
      `SELECT row_number, anomaly_type, severity, description, action_taken, approved
       FROM import_anomalies
       WHERE import_session_id = $1
       ORDER BY row_number ASC, severity DESC`,
      [sessionId]
    );
    const anomalies = anomaliesResult.rows;

    // 3. Construct PDF
    const doc = new PDFDocument({ margin: 50 });

    // Styles & Palette
    const primaryColor = '#4f46e5'; // Indigo-600
    const textColor = '#1e293b';    // Slate-800
    const lightGray = '#f1f5f9';    // Slate-100
    const borderGray = '#cbd5e1';   // Slate-300

    // Header Title
    doc.fillColor(primaryColor)
       .font('Helvetica-Bold')
       .fontSize(22)
       .text('CSV IMPORT AUDIT REPORT', { align: 'center' });
    doc.moveDown(0.2);

    doc.fillColor('#64748b')
       .font('Helvetica')
       .fontSize(10)
       .text(`Generated on: ${new Date().toUTCString()}`, { align: 'center' });
    doc.moveDown(1.5);

    // Section: Executive Summary Card
    doc.fillColor(primaryColor)
       .font('Helvetica-Bold')
       .fontSize(14)
       .text('1. EXECUTIVE SUMMARY');
    doc.strokeColor(primaryColor).lineWidth(1).moveTo(50, doc.y + 2).lineTo(550, doc.y + 2).stroke();
    doc.moveDown(0.8);

    doc.fillColor(textColor).font('Helvetica').fontSize(11);
    
    // Grid summary layout
    const startY = doc.y;
    doc.text(`Group Name:`, 55, startY);
    doc.font('Helvetica-Bold').text(session.group_name, 160, startY);
    
    doc.font('Helvetica').text(`Imported By:`, 55, startY + 18);
    doc.font('Helvetica-Bold').text(session.uploader_name, 160, startY + 18);
    
    doc.font('Helvetica').text(`File Ingested:`, 55, startY + 36);
    doc.font('Helvetica-Bold').text(session.file_name, 160, startY + 36);

    doc.font('Helvetica').text(`Ingest Status:`, 320, startY);
    doc.font('Helvetica-Bold')
       .fillColor(session.status === 'COMMITTED' ? '#16a34a' : '#ea580c')
       .text(session.status, 420, startY);

    doc.fillColor(textColor).font('Helvetica').text(`Rows Processed:`, 320, startY + 18);
    doc.font('Helvetica-Bold').text(session.rows_processed.toString(), 420, startY + 18);

    doc.font('Helvetica').text(`Rows Committed:`, 320, startY + 36);
    doc.font('Helvetica-Bold').text(session.rows_imported.toString(), 420, startY + 36);

    doc.font('Helvetica').text(`Rows Skipped:`, 320, startY + 54);
    doc.font('Helvetica-Bold').text(session.rows_skipped.toString(), 420, startY + 54);

    doc.moveDown(3);

    // Section: Anomalies Breakdown
    doc.fillColor(primaryColor)
       .font('Helvetica-Bold')
       .fontSize(14)
       .text('2. ANOMALIES & AUDIT LEDGER');
    doc.strokeColor(primaryColor).lineWidth(1).moveTo(50, doc.y + 2).lineTo(550, doc.y + 2).stroke();
    doc.moveDown(0.8);

    if (anomalies.length === 0) {
      doc.fillColor('#16a34a')
         .font('Helvetica-Bold')
         .fontSize(11)
         .text('No anomalies detected. Ingestion committed with zero warnings.', { align: 'left' });
    } else {
      // Table Headers
      doc.fillColor(textColor).font('Helvetica-Bold').fontSize(10);
      let tableY = doc.y;
      
      doc.rect(50, tableY, 500, 20).fill(lightGray);
      doc.fillColor(textColor);
      doc.text('Row', 55, tableY + 5);
      doc.text('Type', 90, tableY + 5);
      doc.text('Severity', 220, tableY + 5);
      doc.text('Resolution Log / Action', 300, tableY + 5);
      doc.moveDown(1.2);

      // Draw rows
      doc.font('Helvetica').fontSize(9);
      for (const anom of anomalies) {
        if (doc.y > 700) {
          doc.addPage();
          tableY = 50;
          doc.rect(50, tableY, 500, 20).fill(lightGray);
          doc.fillColor(textColor).font('Helvetica-Bold').fontSize(10);
          doc.text('Row', 55, tableY + 5);
          doc.text('Type', 90, tableY + 5);
          doc.text('Severity', 220, tableY + 5);
          doc.text('Resolution Log / Action', 300, tableY + 5);
          doc.font('Helvetica').fontSize(9).moveDown(1.2);
        }

        const currentY = doc.y;
        doc.fillColor(textColor);
        doc.text(anom.row_number.toString(), 55, currentY);
        doc.text(anom.anomaly_type, 90, currentY);

        // Color badge for severity
        let sevColor = '#0284c7'; // Info: Blue
        if (anom.severity === 'WARNING') sevColor = '#eab308'; // Orange
        if (anom.severity === 'CRITICAL') sevColor = '#dc2626'; // Red

        doc.fillColor(sevColor).font('Helvetica-Bold').text(anom.severity, 220, currentY);
        
        doc.fillColor(textColor).font('Helvetica');
        const resolution = anom.action_taken || (anom.approved ? 'RESOLVED' : 'PENDING REVIEW');
        doc.text(`${resolution} - ${anom.description.substring(0, 45)}...`, 300, currentY, { width: 240 });
        
        // Draw division line
        doc.strokeColor(borderGray).lineWidth(0.5).moveTo(50, doc.y + 4).lineTo(550, doc.y + 4).stroke();
        doc.moveDown(0.8);
      }
    }

    return doc;
  }
}

export default new PdfService();

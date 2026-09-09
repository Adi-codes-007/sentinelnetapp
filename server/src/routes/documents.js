const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const { authenticate, requireCaseAccess } = require('../middleware/auth');
const { ingestCsvDocument, removeDocumentContributions } = require('../services/ingest');
const { logAudit } = require('../services/audit');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const router = express.Router();
router.use(authenticate);

function getIo(req) { return req.app.get('io'); }

function stripRaw(doc) { if (!doc) return doc; const { rawText, ...rest } = doc; return rest; }

router.get('/cases/:caseId/documents', requireCaseAccess('caseId'), (req, res) => {
  res.json({ documents: db.get('documents').filter({ caseId: req.caseId }).value().map(stripRaw) });
});

router.post('/cases/:caseId/documents', requireCaseAccess('caseId'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });
  const srcType = req.body.srcType || 'CDR';
  const isCsv = /\.csv$/i.test(req.file.originalname);
  if (!isCsv) {
    return res.status(415).json({ error: 'Only .csv data files (CDR, financial records, transaction logs) are parsed end-to-end currently.' });
  }
  try {
    const result = await ingestCsvDocument({
      caseId: req.caseId, uploadedBy: req.user.id, srcType, fileName: req.file.originalname,
      buffer: req.file.buffer, io: getIo(req),
    });
    if (result.duplicate) {
      return res.status(409).json({ error: 'This exact file has already been processed for this case.', existingDocumentId: result.existing.id });
    }
    if (result.failed) {
      return res.status(422).json({ error: result.error, document: stripRaw(result.document), job: result.job });
    }
    res.status(201).json({
      document: stripRaw(result.document),
      job: result.job,
      leadsCreated: (result.leadsCreated || []).map(l => l.id),
    });
  } catch (e) {
    res.status(500).json({ error: 'Processing failed: ' + e.message });
  }
});

router.get('/documents/:docId', authenticate, (req, res) => {
  const doc = db.get('documents').find({ id: req.params.docId }).value();
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const access = db.get('case_access').find({ userId: req.user.id, caseId: doc.caseId }).value();
  if (!access) return res.status(403).json({ error: 'Not authorized for this document\'s case' });
  res.json({ document: stripRaw(doc) });
});

router.post('/documents/:docId/reprocess', authenticate, async (req, res) => {
  const doc = db.get('documents').find({ id: req.params.docId }).value();
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const access = db.get('case_access').find({ userId: req.user.id, caseId: doc.caseId }).value();
  if (!access) return res.status(403).json({ error: 'Not authorized for this document\'s case' });
  logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'REPROCESS_STARTED', caseId: doc.caseId, detail: doc.name });
  removeDocumentContributions(doc.id);
  const buffer = Buffer.from(doc.rawText, 'utf8');
  const result = await ingestCsvDocument({
    caseId: doc.caseId, uploadedBy: req.user.id, srcType: doc.srcType, fileName: doc.name,
    buffer, io: getIo(req), force: true, existingDocId: doc.id,
  });
  logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'REPROCESS_COMPLETE', caseId: doc.caseId, detail: `${doc.name} recomputed without duplication` });
  res.json({
    document: stripRaw(result.document),
    job: result.job,
    leadsCreated: (result.leadsCreated || []).map(l => l.id),
  });
});

router.delete('/documents/:docId', authenticate, (req, res) => {
  const doc = db.get('documents').find({ id: req.params.docId }).value();
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const access = db.get('case_access').find({ userId: req.user.id, caseId: doc.caseId }).value();
  if (!access) return res.status(403).json({ error: 'Not authorized for this document\'s case' });
  removeDocumentContributions(doc.id);
  logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'DOCUMENT_REMOVED', caseId: doc.caseId, detail: `${doc.name} and its derived records removed` });
  res.json({ ok: true });
});

module.exports = router;
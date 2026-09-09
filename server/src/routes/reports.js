const express = require('express');
const { db } = require('../db');
const { authenticate, requireCaseAccess } = require('../middleware/auth');
const { generateReport, renderReportHtml } = require('../services/reports');
const { logAudit } = require('../services/audit');

const router = express.Router();
router.use(authenticate);

router.post('/cases/:caseId/reports', requireCaseAccess('caseId'), (req, res) => {
  const report = generateReport(req.caseId, req.user);
  logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'REPORT_GENERATED', caseId: req.caseId, detail: report.id });
  res.status(201).json({ report });
});

router.get('/cases/:caseId/reports', requireCaseAccess('caseId'), (req, res) => {
  res.json({ reports: db.get('reports').filter({ caseId: req.caseId }).value() });
});

router.get('/reports/:reportId', authenticate, (req, res) => {
  const report = db.get('reports').find({ id: req.params.reportId }).value();
  if (!report) return res.status(404).json({ error: 'Not found' });
  const access = db.get('case_access').find({ userId: req.user.id, caseId: report.caseId }).value();
  if (!access) return res.status(403).json({ error: 'Not authorized' });
  res.json({ report });
});

router.get('/reports/:reportId/download', authenticate, (req, res) => {
  const report = db.get('reports').find({ id: req.params.reportId }).value();
  if (!report) return res.status(404).send('Not found');
  const access = db.get('case_access').find({ userId: req.user.id, caseId: report.caseId }).value();
  if (!access) return res.status(403).send('Not authorized');
  logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'REPORT_DOWNLOADED', caseId: report.caseId, detail: report.id });
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Content-Disposition', `inline; filename="${report.id}.html"`);
  res.send(renderReportHtml(report));
});

module.exports = router;

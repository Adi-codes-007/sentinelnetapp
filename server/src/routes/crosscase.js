const express = require('express');
const { db } = require('../db');
const { authenticate, requireCaseAccess } = require('../middleware/auth');
const { crossCaseConnections } = require('../services/crosscase');

const router = express.Router();
router.use(authenticate);

router.get('/cases/:caseId/cross-case', requireCaseAccess('caseId'), (req, res) => {
  const authorizedCaseIds = db.get('case_access').filter({ userId: req.user.id }).value().map(a => a.caseId);
  const connections = crossCaseConnections(req.caseId, authorizedCaseIds);
  res.json({ connections });
});

module.exports = router;

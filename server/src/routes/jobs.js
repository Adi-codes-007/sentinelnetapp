const express = require('express');
const { db } = require('../db');
const { authenticate, requireCaseAccess } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

/** List all processing jobs for a case */
router.get('/cases/:caseId/jobs', requireCaseAccess('caseId'), (req, res) => {
  const jobs = db.get('processing_jobs')
    .filter({ caseId: req.caseId })
    .orderBy(['startedAt'], ['desc'])
    .value();
  res.json({ jobs });
});

/** Poll single job status by jobId */
router.get('/jobs/:jobId', (req, res) => {
  const job = db.get('processing_jobs').find({ id: req.params.jobId }).value();
  if (!job) return res.status(404).json({ error: 'Job not found' });

  // Check authorization for the job's case
  const access = db.get('case_access').find({ userId: req.user.id, caseId: job.caseId }).value();
  if (!access) return res.status(403).json({ error: 'Not authorized for this job\'s case' });

  res.json({ job });
});

module.exports = router;

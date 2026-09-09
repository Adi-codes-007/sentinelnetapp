const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');

const authRoutes = require('./routes/auth');
const caseRoutes = require('./routes/cases');
const documentRoutes = require('./routes/documents');
const entityRoutes = require('./routes/entities');
const relationshipRoutes = require('./routes/relationships');
const evidenceRoutes = require('./routes/evidence');
const leadRoutes = require('./routes/leads');
const crossCaseRoutes = require('./routes/crosscase');
const reportRoutes = require('./routes/reports');
const adminRoutes = require('./routes/admin');
const jobRoutes = require('./routes/jobs');
const aiRoutes = require('./routes/ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);

app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (req, res) => res.json({
  ok: true,
  service: 'sentinelnet-api',
  time: new Date().toISOString(),
  aiEnabled: Boolean(config.GROQ_API_KEY && config.AI_ENABLED),
  aiModel: config.GROQ_MODEL,
  database: config.DATABASE_URL ? 'PostgreSQL' : 'JSON/Local',
}));

app.use('/api/auth', authRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api', documentRoutes);      // /api/cases/:id/documents, /api/documents/:id
app.use('/api', entityRoutes);        // /api/cases/:id/entities, /api/entities/:id, /api/resolution/*
app.use('/api', relationshipRoutes);  // /api/cases/:id/relationships, /api/relationships/:id, /api/cases/:id/network
app.use('/api', evidenceRoutes);      // /api/cases/:id/evidence, /api/evidence/:id
app.use('/api', leadRoutes);          // /api/cases/:id/leads, /api/leads/:id
app.use('/api', crossCaseRoutes);     // /api/cases/:id/cross-case
app.use('/api', reportRoutes);        // /api/cases/:id/reports, /api/reports/:id
app.use('/api/admin', adminRoutes);   // /api/admin/audit, /api/admin/users, /api/admin/cases/:id/access
app.use('/api', jobRoutes);           // /api/jobs/:id, /api/cases/:id/jobs
app.use('/api', aiRoutes);            // /api/cases/:id/assistant, /api/cases/:id/ai-analysis

// Serve the static frontend from the same origin — avoids CORS/file:// issues.
app.use(express.static(config.CLIENT_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(config.CLIENT_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: 'Internal server error: ' + (err.message || 'unknown') });
});

io.on('connection', (socket) => {
  socket.on('subscribe:case', (caseId) => socket.join(`case:${caseId}`));
});

if (require.main === module) {
  server.listen(config.PORT, () => {
    console.log(`SentinelNet API + client listening on http://localhost:${config.PORT}`);
    console.log(`AI Engine: ${config.GROQ_API_KEY ? 'Groq (' + config.GROQ_MODEL + ')' : 'Deterministic fallback (configure GROQ_API_KEY for LLM reasoning)'}`);
    console.log(`Persistence Layer: ${config.DATABASE_URL ? 'PostgreSQL' : 'Local JSON (' + config.DB_FILE + ')'}`);
  });
}

module.exports = app;
module.exports.server = server;

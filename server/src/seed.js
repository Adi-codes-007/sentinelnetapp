const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, nextSeq } = require('./db');
const { ingestCsvDocument } = require('./services/ingest');
const { nameSimilarity, computeMatchConfidence } = require('./services/resolution');
const { logAudit } = require('./services/audit');

async function seed() {
  console.log('Resetting local database...');
  db.set('users', []).write();
  db.set('cases', []).write();
  db.set('case_access', []).write();
  db.set('documents', []).write();
  db.set('source_records', []).write();
  db.set('entities', []).write();
  db.set('entity_identifiers', []).write();
  db.set('relationships', []).write();
  db.set('evidence', []).write();
  db.set('ai_leads', []).write();
  db.set('audit_logs', []).write();
  db.set('reports', []).write();
  db.set('identity_resolution', []).write();
  db.set('seq', { document: 0, entity: 0, relationship: 0, evidence: 0, lead: 0, report: 0, audit: 0, resolution: 0, caseNo: 0 }).write();

  console.log('Creating demo users (one per role)...');
  const users = [
    { id: 'INV-104', name: 'R. Deshmukh', role: 'investigator', password: 'investigator123' },
    { id: 'SUP-021', name: 'K. Bhatnagar', role: 'senior_investigator', password: 'supervisor123' },
    { id: 'AN-221', name: 'S. Iyer', role: 'analyst', password: 'analyst123' },
    { id: 'ADM-001', name: 'A. Fernandes', role: 'admin', password: 'admin123' },
  ];
  users.forEach(u => {
    db.get('users').push({ id: u.id, name: u.name, role: u.role, passwordHash: bcrypt.hashSync(u.password, 10) }).write();
  });

  console.log('Creating demo cases...');
  const cases = [
    { id: 'CASE-2026-00421', title: 'Organized Financial Fraud Network', type: 'Financial Fraud', unit: 'Economic Offences Wing', priority: 'High' },
    { id: 'CASE-2026-00435', title: 'Suspicious Cross-Border Fund Movement', type: 'Financial Fraud', unit: 'Economic Offences Wing', priority: 'Medium' },
  ];
  cases.forEach(c => {
    db.get('cases').push({ ...c, status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: 'ADM-001' }).write();
  });

  console.log('Granting case access...');
  const grants = [
    { userId: 'INV-104', caseId: 'CASE-2026-00421', roleAtCase: 'investigator', fullPiiAccess: true },
    { userId: 'SUP-021', caseId: 'CASE-2026-00421', roleAtCase: 'senior_investigator', fullPiiAccess: true },
    { userId: 'AN-221', caseId: 'CASE-2026-00421', roleAtCase: 'analyst', fullPiiAccess: false },
    { userId: 'ADM-001', caseId: 'CASE-2026-00421', roleAtCase: 'admin', fullPiiAccess: false },
    { userId: 'INV-104', caseId: 'CASE-2026-00435', roleAtCase: 'investigator', fullPiiAccess: true },
    { userId: 'SUP-021', caseId: 'CASE-2026-00435', roleAtCase: 'senior_investigator', fullPiiAccess: true },
    { userId: 'AN-221', caseId: 'CASE-2026-00435', roleAtCase: 'analyst', fullPiiAccess: false },
    { userId: 'ADM-001', caseId: 'CASE-2026-00435', roleAtCase: 'admin', fullPiiAccess: false },
  ];
  grants.forEach(g => db.get('case_access').push(g).write());

  console.log('Running the REAL ingestion pipeline against bundled sample CDR files...');
  const sampleDir = path.join(__dirname, '..', 'sample-data');
  const f1 = fs.readFileSync(path.join(sampleDir, 'SentinelNet_demo_CDR_CASE-2026-00421.csv'));
  const f2 = fs.readFileSync(path.join(sampleDir, 'SentinelNet_demo_CDR_CASE-2026-00435.csv'));

  await ingestCsvDocument({
    caseId: 'CASE-2026-00421', uploadedBy: 'AN-221', srcType: 'CDR',
    fileName: 'SentinelNet_demo_CDR_CASE-2026-00421.csv', buffer: f1, io: null,
  });
  const r2 = await ingestCsvDocument({
    caseId: 'CASE-2026-00435', uploadedBy: 'AN-221', srcType: 'CDR',
    fileName: 'SentinelNet_demo_CDR_CASE-2026-00435.csv', buffer: f2, io: null,
  });
  console.log(`  -> Case 00421: ingested. Case 00435: ingested (${r2.leadsCreated.length} additional leads incl. cross-case if identifiers overlap).`);

  console.log('Seeding an identity-resolution demo (real fuzzy matching, not hardcoded scores)...');
  const nameRecords = [
    { name: 'Abdul Rahim', source: 'FIR-2026-00088' },
    { name: 'Abdul Rahim Khan', source: 'CDR_2026_08.csv' },
    { name: 'A. Rahim', source: 'Surveillance Report SR-14' },
    { name: 'Rakesh Verma', source: 'Financial_Records_Q3.xlsx' },
  ];
  const personEntities = nameRecords.map(r => {
    const ent = {
      id: 'ENT-' + String(nextSeq('entity')).padStart(5, '0'),
      type: 'PERSON', canonical: r.name, originalValues: [r.name], confidence: 90,
      sources: [r.source], caseIds: ['CASE-2026-00421'], firstSeen: null, lastSeen: null, status: 'ACTIVE',
    };
    db.get('entities').push(ent).write();
    return ent;
  });
  for (let i = 0; i < personEntities.length; i++) {
    for (let j = i + 1; j < personEntities.length; j++) {
      const a = personEntities[i], b = personEntities[j];
      const sim = nameSimilarity(a.canonical, b.canonical);
      if (sim < 30) continue; // not worth queuing
      const { confidence, band, breakdown } = computeMatchConfidence({ nameSim: sim, phoneMatch: null, identifierMatch: null, locationSim: null });
      if (band === 'KEEP_SEPARATE') continue;
      db.get('identity_resolution').push({
        id: 'MATCH-' + String(nextSeq('resolution')).padStart(4, '0'),
        caseId: 'CASE-2026-00421', entityAId: a.id, entityBId: b.id,
        entityAName: a.canonical, entityBName: b.canonical,
        nameSimilarity: sim, confidence, band, breakdown, status: 'PENDING', createdAt: new Date().toISOString(),
      }).write();
    }
  }

  logAudit({ userId: 'ADM-001', userName: 'A. Fernandes', role: 'admin', action: 'SYSTEM_SEEDED', detail: 'Local demo database initialized from seed.js' });

  console.log('\nDone. Demo accounts:');
  users.forEach(u => console.log(`  ${u.id}  /  ${u.password}   (${u.role})`));
  console.log('\nStart the server with: npm run dev   then open http://localhost:4000');
}

seed().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

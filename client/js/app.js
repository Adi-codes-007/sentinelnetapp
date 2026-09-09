/* ===================== UI helpers ===================== */
const UI = {
  toast(msg, isError) {
    const wrap = document.getElementById('toast-wrap');
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 400); }, 4200);
  },
  closeAll() {
    document.getElementById('overlay').classList.remove('show');
    document.getElementById('entity-drawer').classList.remove('show');
    document.getElementById('explain-modal').classList.remove('show');
  },
  openDrawer(html) {
    document.getElementById('entity-drawer').innerHTML = html;
    document.getElementById('overlay').classList.add('show');
    document.getElementById('entity-drawer').classList.add('show');
  },
  openModal(html) {
    document.getElementById('explain-modal').innerHTML = html;
    document.getElementById('overlay').classList.add('show');
    document.getElementById('explain-modal').classList.add('show');
  },
  badgeClass(pri) {
    const p = (pri || '').toUpperCase();
    if (p === 'HIGH' || p === 'CRITICAL') return 'high';
    if (p === 'MEDIUM' || p === 'MED') return 'medium';
    return 'low';
  },
  confBarClass(c) { return c >= 75 ? '' : c >= 50 ? 'medium' : 'low'; },
  confBar(c) { return `<span class="conf-bar"><span class="conf-bar-fill ${this.confBarClass(c)}" style="width:${c}%"></span></span>`; },
  fmtTs(iso) { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); },
  esc(s) { return (s == null ? '' : String(s)).replace(/</g, '&lt;'); },
};

/* ===================== Auth ===================== */
const Auth = {
  user: null,
  async init() {
    const t = Api.loadToken();
    if (!t) { this.showLogin(); return; }
    try {
      const me = await Api.get('/api/auth/me');
      this.user = me.user;
      this.showShell();
    } catch (e) {
      Api.setToken(null);
      this.showLogin();
    }
  },
  async login() {
    const id = document.getElementById('login-id').value.trim();
    const pw = document.getElementById('login-pw').value;
    const errEl = document.getElementById('login-error');
    errEl.hidden = true;
    if (!id || !pw) { errEl.textContent = 'Enter both official ID and password.'; errEl.hidden = false; return; }
    const btn = document.getElementById('login-btn');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const res = await Api.post('/api/auth/login', { id, password: pw });
      Api.setToken(res.token);
      this.user = res.user;
      this.showShell();
    } catch (e) {
      errEl.textContent = e.message || 'Login failed';
      errEl.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Sign in to secure environment';
    }
  },
  async logout() {
    try { await Api.post('/api/auth/logout'); } catch (e) {}
    Api.setToken(null);
    this.user = null;
    App.socket && App.socket.disconnect();
    document.getElementById('shell').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
  },
  showLogin() {
    document.getElementById('shell').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
  },
  showShell() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('shell').style.display = 'flex';
    document.getElementById('user-name').textContent = this.user.name;
    document.getElementById('user-role').textContent = roleLabel(this.user.role);
    document.getElementById('user-avatar').textContent = this.user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    App.init();
  },
};

function roleLabel(role) {
  return { investigator: 'Investigating Officer', senior_investigator: 'Senior Investigation Officer', analyst: 'Intelligence Analyst', admin: 'System Administrator' }[role] || role;
}
function canRole(...roles) { return roles.includes(Auth.user.role); }

/* ===================== App shell / nav / case selection ===================== */
const App = {
  cases: [],
  currentCaseId: null,
  view: 'dashboard',
  socket: null,

  async init() {
    await this.loadCases();
    this.connectSocket();
    this.renderSidebar();
    this.navigate('dashboard');
  },

  connectSocket() {
    if (typeof io === 'undefined') return;
    try {
      this.socket = io({ auth: {} });
      this.socket.on('document:status', (payload) => {
        if (this.view === 'datasources' && payload.caseId === this.currentCaseId) DataSources.onStatus(payload);
        if (payload.status === 'COMPLETE' || payload.status === 'COMPLETED') {
          UI.toast(`Processing complete — ${payload.entitiesCreated || 0} entities, ${payload.relationshipsCreated || 0} relationships, ${payload.leadsCreated || 0} lead(s)`);
        }
        if (payload.status === 'FAILED') UI.toast('Processing failed: ' + payload.error, true);
      });
      this.socket.on('case:updated', (payload) => {
        if (payload.caseId === this.currentCaseId && ['dashboard', 'entities', 'network', 'leads'].includes(this.view)) {
          this.navigate(this.view);
        }
      });
    } catch (err) {
      console.warn('Socket connection optional fallback:', err);
    }
  },

  async loadCases() {
    const res = await Api.get('/api/cases');
    this.cases = res.cases || [];
    if (!this.currentCaseId && this.cases.length) this.currentCaseId = this.cases[0].id;
    const sel = document.getElementById('case-select');
    sel.innerHTML = this.cases.map(c => `<option value="${c.id}" ${c.id === this.currentCaseId ? 'selected' : ''}>${c.id} — ${c.title}</option>`).join('') || '<option value="">No authorized cases</option>';
    if (this.currentCaseId) this.socket && this.socket.emit('subscribe:case', this.currentCaseId);
  },
  onCaseChange() {
    this.currentCaseId = document.getElementById('case-select').value;
    this.socket && this.socket.emit('subscribe:case', this.currentCaseId);
    this.navigate(this.view === 'dashboard' ? 'dashboard' : this.view);
  },

  NAV: [
    { id: 'dashboard', label: 'Dashboard', group: null },
    { id: 'cases', label: 'Cases', group: null },
    { id: 'datasources', label: 'Data Sources', group: 'case', roles: ['investigator', 'senior_investigator', 'analyst', 'admin'] },
    { id: 'entities', label: 'Entities', group: 'case' },
    { id: 'network', label: 'Network Analysis', group: 'case' },
    { id: 'assistant', label: 'AI Case Assistant', group: 'case' },
    { id: 'leads', label: 'AI Leads', group: 'case' },
    { id: 'timeline', label: 'Timeline', group: 'case' },
    { id: 'evidence', label: 'Evidence', group: 'case' },
    { id: 'crosscase', label: 'Cross-Case Links', group: 'case' },
    { id: 'resolution', label: 'Entity Resolution', group: 'case', roles: ['investigator', 'senior_investigator'] },
    { id: 'reports', label: 'Reports', group: 'case' },
    { id: 'audit', label: 'Audit Logs', group: 'admin', roles: ['senior_investigator', 'admin'] },
    { id: 'users', label: 'Users & Access', group: 'admin', roles: ['admin'] },
  ],
  renderSidebar() {
    const items = this.NAV.filter(n => !n.roles || n.roles.includes(Auth.user.role));
    let html = '';
    let lastGroup = '__none__';
    items.forEach(n => {
      if (n.group !== lastGroup) {
        if (n.group === 'case') html += `<div class="nav-label">Selected case</div>`;
        if (n.group === 'admin') html += `<div class="nav-sep"></div><div class="nav-label">Administration</div>`;
        lastGroup = n.group;
      }
      html += `<div class="nav-item ${this.view === n.id ? 'active' : ''}" onclick="App.navigate('${n.id}')">${UI.esc(n.label)}</div>`;
    });
    document.getElementById('sidebar').innerHTML = html;
  },

  navigate(view) {
    this.view = view;
    this.renderSidebar();
    const renderers = {
      dashboard: () => Dashboard.render(), cases: () => Cases.render(),
      datasources: () => DataSources.render(), entities: () => Entities.render(), network: () => Network.render(),
      assistant: () => Assistant.render(),
      timeline: () => Timeline.render(), evidence: () => Evidence.render(), leads: () => Leads.render(),
      crosscase: () => CrossCase.render(), resolution: () => Resolution.render(), reports: () => Reports.render(),
      audit: () => Admin.renderAudit(), users: () => Admin.renderUsers(),
    };
    (renderers[view] || (() => Dashboard.render()))().catch(e => Main.error(e));
  },
};

const Main = {
  set(html) { document.getElementById('main').innerHTML = html; },
  error(e) {
    console.error(e);
    document.getElementById('main').innerHTML = `<div class="card" style="border-color:var(--red-border);"><b style="color:var(--red);">Something went wrong</b><div style="margin-top:6px;color:var(--text-dim);font-size:12.5px;">${UI.esc(e.message)}</div></div>`;
  },
  requireCase() {
    if (!App.currentCaseId) { this.set(`<div class="card empty-state">No case selected. Create or select a case first.</div>`); return false; }
    return true;
  },
};

/* ===================== Dashboard ===================== */
const Dashboard = {
  async render() {
    if (!App.currentCaseId) {
      Main.set(`<div class="page-head"><div><div class="page-title">Dashboard</div><div class="page-sub">No cases yet.</div></div></div>
        <div class="card empty-state">You have no authorized cases. ${canRole('senior_investigator', 'admin') ? 'Create one from the Cases page.' : 'Ask a Senior Investigation Officer or Administrator to grant access.'}</div>`);
      return;
    }
    const d = await Api.get(`/api/cases/${App.currentCaseId}/dashboard`);
    const c = App.cases.find(x => x.id === App.currentCaseId) || {};
    Main.set(`
      <div class="page-head">
        <div>
          <div class="page-title">Dashboard — ${UI.esc(c.title || d.caseId)}</div>
          <div class="page-sub mono">${d.caseId} · Signed in as ${UI.esc(Auth.user.name)} (${roleLabel(Auth.user.role)})</div>
        </div>
        <div class="btn-row">
          <button class="btn" onclick="App.navigate('assistant')">Ask AI Assistant</button>
          <button class="btn primary" onclick="App.navigate('datasources')">Upload data source</button>
        </div>
      </div>
      <div class="grid grid-6">
        ${statCard('Entities', d.entityCount, 'this case')}
        ${statCard('Relationships', d.relationshipCount, 'evidence-backed')}
        ${statCard('AI Leads', d.leadCount, `${d.highLeadCount} high priority`, d.highLeadCount ? 'crit' : '')}
        ${statCard('Pending Review', d.pendingLeadCount, 'requires investigator', d.pendingLeadCount ? 'warn' : '')}
        ${statCard('Evidence Records', d.evidenceCount, `${d.documentCount} source file(s)`)}
        ${statCard('Cross-Case Links', d.crossCaseConnectionCount, 'candidate bridges', d.crossCaseConnectionCount ? 'warn' : '')}
      </div>
      <div class="section-title" style="margin-top:24px;font-size:14px;font-weight:700;">Investigative Workflows</div>
      <div class="grid grid-3">
        <div class="card">
          <b>AI Case Assistant</b>
          <p style="color:var(--text-dim);font-size:12.5px;margin:8px 0 12px;">Query Groq AI for network reasoning, evidence grounding, and anomaly explanations.</p>
          <button class="btn primary sm" onclick="App.navigate('assistant')">Open AI Assistant</button>
        </div>
        <div class="card">
          <b>Review AI Leads</b>
          <p style="color:var(--text-dim);font-size:12.5px;margin:8px 0 12px;">${d.pendingLeadCount} lead(s) awaiting investigator validation or dismissal.</p>
          <button class="btn sm" onclick="App.navigate('leads')">Review Leads</button>
        </div>
        <div class="card">
          <b>Generate Official Report</b>
          <p style="color:var(--text-dim);font-size:12.5px;margin:8px 0 12px;">Compile an evidence-backed intelligence brief with auditable evidence citations.</p>
          <button class="btn sm" onclick="App.navigate('reports')">Create Report</button>
        </div>
      </div>
    `);
  },
};
function statCard(label, val, delta, tone) {
  return `<div class="card stat-card ${tone || ''}"><div class="stat-label">${label}</div><div class="stat-value">${(val ?? 0).toLocaleString('en-IN')}</div><div class="stat-delta">${delta || ''}</div></div>`;
}

/* ===================== Cases ===================== */
const Cases = {
  async render() {
    const res = await Api.get('/api/cases');
    const canCreate = canRole('senior_investigator', 'admin');
    Main.set(`
      <div class="page-head">
        <div><div class="page-title">Case Management</div><div class="page-sub">${res.cases.length} case(s) you are authorized for</div></div>
        ${canCreate ? `<button class="btn primary" onclick="Cases.openCreate()">+ New case</button>` : ''}
      </div>
      <table><thead><tr><th>Case ID</th><th>Title</th><th>Type</th><th>Priority</th><th>Status</th><th>Entities</th><th>Relationships</th><th>Leads</th></tr></thead>
      <tbody>${res.cases.map(c => `<tr class="clickable" onclick="Cases.open('${c.id}')">
        <td class="mono">${c.id}</td><td>${UI.esc(c.title)}</td><td>${UI.esc(c.type)}</td>
        <td><span class="badge ${UI.badgeClass(c.priority)}">${c.priority}</span></td>
        <td><span class="badge active">${c.status}</span></td>
        <td>${c.entityCount}</td><td>${c.relationshipCount}</td><td>${c.leadCount} ${c.highLeadCount ? `<span class="badge high">${c.highLeadCount} high</span>` : ''}</td>
      </tr>`).join('')}</tbody></table>
    `);
  },
  open(id) { App.currentCaseId = id; document.getElementById('case-select').value = id; App.socket && App.socket.emit('subscribe:case', id); App.navigate('dashboard'); },
  openCreate() {
    UI.openModal(`
      <div class="modal-head"><div style="font-size:15px;font-weight:700;">Create new case</div><button class="drawer-close" onclick="UI.closeAll()">✕</button></div>
      <div class="field"><label>Title</label><input id="nc-title" placeholder="e.g. Suspicious Transaction Cluster — Sector 12"></div>
      <div class="field"><label>Type</label><input id="nc-type" placeholder="e.g. Financial Fraud"></div>
      <div class="field"><label>Investigating unit</label><input id="nc-unit" placeholder="e.g. Cyber Crime Cell"></div>
      <div class="field"><label>Priority</label><select id="nc-priority"><option>Low</option><option selected>Medium</option><option>High</option><option>Critical</option></select></div>
      <button class="btn primary" style="width:100%;" onclick="Cases.submitCreate()">Create case</button>
    `);
  },
  async submitCreate() {
    const title = document.getElementById('nc-title').value.trim();
    const type = document.getElementById('nc-type').value.trim();
    const unit = document.getElementById('nc-unit').value.trim();
    const priority = document.getElementById('nc-priority').value;
    if (!title || !type) { UI.toast('Title and type are required', true); return; }
    try {
      const res = await Api.post('/api/cases', { title, type, unit, priority });
      UI.toast(`Case ${res.case.id} created`);
      UI.closeAll();
      await App.loadCases();
      Cases.open(res.case.id);
    } catch (e) { UI.toast(e.message, true); }
  },
};

/* ===================== Data Sources & Processing Pipeline ===================== */
const DataSources = {
  pickedFiles: [],
  selectedSrcType: 'CDR',
  SRC_TYPES: ['CDR', 'FIR / Police Report', 'Financial Transactions', 'Vehicle Records', 'Images', 'Videos', 'Audio', 'Criminal History', 'Intelligence Report'],
  STAGES: ['Validating', 'Parsing', 'Extracting', 'Normalizing', 'Resolving', 'Linking', 'Scoring', 'GraphAnalysis', 'AiAnalysis', 'Completed'],

  async render() {
    if (!Main.requireCase()) return;
    const res = await Api.get(`/api/cases/${App.currentCaseId}/documents`);
    Main.set(`
      <div class="page-head">
        <div>
          <div class="page-title">Data Sources &amp; Ingestion Pipeline</div>
          <div class="page-sub">Upload real evidence (CDRs, transaction logs). Every file is validated, hashed (SHA-256), resolved, scored, and processed through the complete intelligence pipeline.</div>
        </div>
      </div>
      <div class="upload-zone" id="upload-dropzone" ondragover="event.preventDefault();this.style.borderColor='var(--accent)'" ondragleave="this.style.borderColor='var(--border-strong)'" ondrop="DataSources.onDrop(event)">
        Drag one or more CSVs here or <b><label for="file-input" style="cursor:pointer;color:var(--accent);">browse files</label></b>
        <input type="file" id="file-input" multiple style="display:none" accept=".csv,.txt" onchange="DataSources.onPick(this.files)">
        <div class="src-grid">${this.SRC_TYPES.map(t => `<div class="src-tag ${t === this.selectedSrcType ? 'sel' : ''}" onclick="DataSources.selectSrc('${t}')">${t}</div>`).join('')}</div>
        <div id="picked-file" style="font-size:12px;color:var(--accent);margin:12px 0 6px;min-height:16px;font-weight:600;"></div>
        <button class="btn primary" id="upload-btn" onclick="DataSources.uploadAll()">Upload &amp; process</button>
      </div>
      <div class="section-title" style="margin-top:20px;font-weight:700;">Real Processing Pipeline <small style="font-weight:normal;color:var(--text-dim);">(Polled live from backend job records)</small></div>
      <div class="card"><div class="pipeline" id="pipeline-body"><div class="empty-state" style="padding:20px;">No active processing job.</div></div></div>
      <div class="section-title" style="margin-top:24px;font-weight:700;">Uploaded Sources for this Case</div>
      <table><thead><tr><th>File</th><th>Type</th><th>Uploaded by</th><th>Status</th><th>Data quality</th><th>Entities</th><th>Relationships</th><th>Evidence</th><th>Actions</th></tr></thead>
        <tbody id="doc-history">${this.rows(res.documents)}</tbody></table>
    `);
  },
  rows(docs) {
    if (!docs || !docs.length) return `<tr><td colspan="9" style="text-align:center;color:var(--text-faint);padding:24px;">No sources uploaded yet for this case.</td></tr>`;
    return docs.map(d => `<tr>
      <td>${UI.esc(d.name)}</td><td>${UI.esc(d.srcType)}</td><td class="mono">${d.uploadedBy}</td>
      <td>${statusBadge(d.status)}${d.status === 'FAILED' && d.error ? `<div style="font-size:10.5px;color:var(--red);margin-top:3px;max-width:220px;">${UI.esc(d.error)}</div>` : ''}</td>
      <td>${d.dataQuality ? d.dataQuality.overall + '%' : '—'}</td>
      <td>${d.entitiesCreated || 0}</td><td>${d.relationshipsCreated || 0}</td><td>${d.evidenceCreated || 0}</td>
      <td><div class="btn-row">
        <button class="btn sm" onclick="DataSources.reprocess('${d.id}')">Reprocess</button>
        <button class="btn sm danger" onclick="DataSources.remove('${d.id}')">Remove</button>
      </div></td>
    </tr>`).join('');
  },
  selectSrc(t) { this.selectedSrcType = t; this.render(); },
  onPick(files) { this.pickedFiles = Array.from(files); this.showPicked(); },
  onDrop(e) { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--border-strong)'; this.pickedFiles = Array.from(e.dataTransfer.files); this.showPicked(); },
  showPicked() {
    const el = document.getElementById('picked-file');
    if (!this.pickedFiles.length) { el.textContent = ''; return; }
    el.innerHTML = this.pickedFiles.map(f => `${UI.esc(f.name)} (${(f.size / 1024).toFixed(1)} KB)`).join('<br>');
  },
  async uploadAll() {
    if (!this.pickedFiles.length) { UI.toast('Choose at least one file first', true); return; }
    const files = this.pickedFiles.slice();
    this.pickedFiles = [];
    document.getElementById('file-input').value = '';
    this.showPicked();
    let okCount = 0;
    for (let i = 0; i < files.length; i++) {
      UI.toast(`Processing file ${i + 1} of ${files.length}: ${files[i].name}`);
      const ok = await this.uploadOne(files[i]);
      if (ok) okCount++;
    }
    UI.toast(`Done — ${okCount}/${files.length} file(s) processed`);
    this.render();
  },
  async uploadOne(file) {
    const form = new FormData();
    form.append('file', file);
    form.append('srcType', this.selectedSrcType);
    const host = document.getElementById('pipeline-body');
    if (host) host.innerHTML = `<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Processing: <b>${UI.esc(file.name)}</b></div>` + this.stageRows();
    try {
      const res = await Api.postForm(`/api/cases/${App.currentCaseId}/documents`, form);
      if (res.job) {
        await this.pollJob(res.job.id, file.name);
      } else {
        this.setAllStages(100);
      }
      return true;
    } catch (e) {
      if (e.status === 409) { UI.toast(`${file.name}: duplicate — already processed for this case`, true); }
      else { UI.toast(`${file.name}: ${e.message}`, true); }
      const host2 = document.getElementById('pipeline-body');
      if (host2) host2.innerHTML = `<div class="empty-state" style="color:var(--red);">${UI.esc(e.message)}</div>`;
      return false;
    }
  },
  async pollJob(jobId, fileName) {
    let done = false;
    let attempts = 0;
    while (!done && attempts < 60) {
      attempts++;
      try {
        const { job } = await Api.get(`/api/jobs/${jobId}`);
        if (!job) break;
        this.updateFromJob(job);
        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
          done = true;
          return job;
        }
      } catch (err) {
        console.warn('Poll error:', err);
        break;
      }
      await new Promise(r => setTimeout(r, 600));
    }
  },
  updateFromJob(job) {
    const stageMap = {
      VALIDATING: 'Validating', PARSING: 'Parsing', EXTRACTING: 'Extracting',
      NORMALIZING: 'Normalizing', RESOLVING: 'Resolving', LINKING: 'Linking',
      SCORING: 'Scoring', GRAPH_ANALYSIS: 'GraphAnalysis', AI_ANALYSIS: 'AiAnalysis',
      COMPLETED: 'Completed',
    };
    const activeStage = stageMap[job.currentStage] || 'Validating';
    const stageOrder = this.STAGES;
    const activeIdx = stageOrder.indexOf(activeStage);
    stageOrder.forEach((st, idx) => {
      if (idx < activeIdx) this.setStage(st, 100);
      else if (idx === activeIdx) this.setStage(st, job.progress != null ? job.progress : 75);
      else this.setStage(st, 0);
    });
    if (job.status === 'COMPLETED') this.setAllStages(100);
  },
  stageRows() {
    return this.STAGES.map(s =>
      `<div class="pipe-row" id="stage-${s}"><div class="pipe-label">${s.replace(/([A-Z])/g, ' $1').trim()}</div><div class="pipe-bar"><div class="pipe-fill" id="fill-${s}" style="width:0%"></div></div><div class="pipe-pct" id="pct-${s}">0%</div></div>`
    ).join('');
  },
  setAllStages(pct) { this.STAGES.forEach(s => this.setStage(s, pct)); },
  setStage(key, pct) {
    const f = document.getElementById('fill-' + key), p = document.getElementById('pct-' + key);
    if (f) { f.style.width = pct + '%'; p.textContent = Math.round(pct) + '%'; }
  },
  onStatus(payload) {
    const statusKey = (payload.status || '').replace(/_/g, '').toUpperCase();
    this.STAGES.forEach(st => {
      if (st.toUpperCase() === statusKey) this.setStage(st, payload.progress || 100);
    });
  },
  async reprocess(docId) {
    try {
      const res = await Api.post(`/api/documents/${docId}/reprocess`);
      UI.toast(`Reprocessed — ${res.document.entitiesCreated} entities, ${res.document.relationshipsCreated} relationships`);
      this.render();
    } catch (e) { UI.toast(e.message, true); }
  },
  async remove(docId) {
    if (!confirm('Remove this source and its derived records from the current case view?')) return;
    try { await Api.del(`/api/documents/${docId}`); UI.toast('Removed'); this.render(); }
    catch (e) { UI.toast(e.message, true); }
  },
};
function statusBadge(status) {
  const map = { COMPLETE: 'low', COMPLETED: 'low', PARSING: 'medium', EXTRACTING: 'medium', RESOLVING: 'medium', FAILED: 'high' };
  return `<span class="badge ${map[status] || 'neutral'}">${status}</span>`;
}

/* ===================== Entities ===================== */
const Entities = {
  searchQuery: '',
  async render() {
    if (!Main.requireCase()) return;
    const res = await Api.get(`/api/cases/${App.currentCaseId}/entities`);
    let list = res.entities || [];
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(e => e.id.toLowerCase().includes(q) || (e.canonical && e.canonical.toLowerCase().includes(q)));
    }
    Main.set(`
      <div class="page-head">
        <div>
          <div class="page-title">Entities (${res.entities.length})</div>
          <div class="page-sub">Extracted and normalized identifiers. Click any entity to inspect connected edges, evidence, and confidence.</div>
        </div>
        <div class="pill-filter">
          <input class="filter-input" type="text" placeholder="Search entity ID or value..." value="${UI.esc(this.searchQuery)}" oninput="Entities.onSearch(this.value)" style="width:240px;">
        </div>
      </div>
      <table><thead><tr><th>Entity ID</th><th>Type</th><th>Value</th><th>Confidence</th><th>Relationships</th><th>Cases</th><th>Last seen</th><th>Status</th></tr></thead>
      <tbody>${list.map(e => `<tr class="clickable" onclick="Entities.open('${e.id}')">
        <td class="mono">${e.id}</td><td>${e.type}</td>
        <td class="mono">${UI.esc(e.canonical)} ${e.masked ? '<span class="badge neutral">MASKED</span>' : ''}</td>
        <td>${e.confidence}%</td><td>${e.relationshipCount}</td><td class="mono">${e.caseIds.join(', ')}</td>
        <td class="mono">${UI.fmtTs(e.lastSeen)}</td><td><span class="badge active">${e.status}</span></td>
      </tr>`).join('') || `<tr><td colspan="8" style="text-align:center;color:var(--text-faint);padding:24px;">No entities match your search.</td></tr>`}</tbody></table>
    `);
  },
  onSearch(v) { this.searchQuery = v.trim(); this.render(); },
  async open(id) {
    const res = await Api.get(`/api/entities/${id}?caseId=${App.currentCaseId}`);
    const e = res.entity;
    UI.openDrawer(`
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div><div class="mono" style="font-size:11px;color:var(--text-faint);">${e.id} · ${e.type}</div><div style="font-size:18px;font-weight:700;margin-top:2px;">${UI.esc(e.canonical)}</div></div>
        <button class="drawer-close" onclick="UI.closeAll()">✕</button>
      </div>
      ${e.masked ? `<div class="disclaimer-box">This value is masked by default under your role's policy. ${canRole('senior_investigator', 'admin') ? `<button class="btn sm" style="margin-top:8px;" onclick="Entities.reveal('${e.id}')">Break-glass reveal (audited)</button>` : ''}</div>` : ''}
      <div class="kv">
        <div class="k">Original value(s)</div><div class="mono">${(e.originalValues || []).map(UI.esc).join(', ')}</div>
        <div class="k">Extraction confidence</div><div>${e.confidence}%</div>
        <div class="k">Source(s)</div><div class="mono">${(e.sources || []).join(', ')}</div>
        <div class="k">Case(s)</div><div class="mono">${e.caseIds.join(', ')}</div>
        <div class="k">First / last seen</div><div class="mono">${UI.fmtTs(e.firstSeen)} — ${UI.fmtTs(e.lastSeen)}</div>
      </div>
      <div class="section-title" style="margin-top:16px;">Relationships (${res.relationships.length})</div>
      ${res.relationships.map(r => `<div class="card" style="margin-bottom:8px;padding:10px 12px;cursor:pointer;" onclick="UI.closeAll();Network.openRelExplain('${r.id}')">
        <div style="display:flex;justify-content:space-between;"><b class="mono" style="font-size:12.5px;">${r.entityA === e.id ? r.entityB : r.entityA}</b><span class="mono" style="font-size:11.5px;color:${r.confidence >= 75 ? 'var(--green)' : r.confidence >= 50 ? 'var(--amber)' : 'var(--red)'}">${r.confidence}%</span></div>
        <div style="font-size:11px;color:var(--text-dim);">${r.interactions} interaction(s) · ${r.type}</div>
      </div>`).join('') || '<div style="font-size:12px;color:var(--text-faint);">None yet.</div>'}
    `);
  },
  async reveal(id) {
    try {
      await Api.post(`/api/entities/${id}/reveal?caseId=${App.currentCaseId}`);
      UI.toast('Revealed — access logged in the audit trail');
      Entities.open(id);
    } catch (e) { UI.toast(e.message, true); }
  },
};

/* ===================== Network Analysis ===================== */
const Network = {
  filters: { minInteractions: 1, minConfidence: 0 },
  async render() {
    if (!Main.requireCase()) return;
    Main.set(`
      <div class="page-head">
        <div>
          <div class="page-title">Network Analysis</div>
          <div class="page-sub">Algorithmic network graph with real Degree, PageRank, and Community metrics computed from actual evidence.</div>
        </div>
      </div>
      <div class="pill-filter">
        <span style="font-size:12px;color:var(--text-dim);">Min interactions:</span>
        <input class="filter-input" type="number" min="0" id="net-mininter" value="${this.filters.minInteractions}" style="width:60px;" onchange="Network.applyFilters()">
        <span style="font-size:12px;color:var(--text-dim);">Min confidence:</span>
        <input class="filter-input" type="number" min="0" max="100" id="net-minconf" value="${this.filters.minConfidence}" style="width:60px;" onchange="Network.applyFilters()">%
        <button class="btn sm" onclick="Network.load()">Refresh Graph</button>
      </div>
      <div id="graph-host"></div>
      <div class="section-title" style="margin-top:20px;font-weight:700;">Communities Detected <small style="font-weight:normal;color:var(--text-dim);">(Label-propagation clustering)</small></div>
      <div id="community-host"></div>
    `);
    await this.load();
  },
  applyFilters() {
    this.filters.minInteractions = Number(document.getElementById('net-mininter').value) || 0;
    this.filters.minConfidence = Number(document.getElementById('net-minconf').value) || 0;
    this.load();
  },
  async load() {
    const q = `minInteractions=${this.filters.minInteractions}&minConfidence=${this.filters.minConfidence}`;
    const res = await Api.get(`/api/cases/${App.currentCaseId}/network?${q}`);
    this.renderGraph(res.nodes, res.edges);
    const commEl = document.getElementById('community-host');
    if (commEl) {
      commEl.innerHTML = (res.communities || []).filter(c => c.members.length > 1).map(c =>
        `<div class="card" style="display:inline-block;margin:0 10px 10px 0;padding:10px 14px;"><b>Community ${c.communityId}</b> — ${c.members.length} entities</div>`
      ).join('') || `<div class="card empty-state" style="padding:16px;">No multi-entity communities found at current threshold.</div>`;
    }
  },
  renderGraph(nodes, edges) {
    const host = document.getElementById('graph-host');
    if (!nodes || !nodes.length) { host.innerHTML = `<div class="card empty-state">No relationships match these filters yet.</div>`; return; }
    const W = 900, H = 500, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 70;
    const pos = {};
    nodes.forEach((n, i) => { const ang = (i / nodes.length) * Math.PI * 2; pos[n.id] = { x: cx + Math.cos(ang) * R, y: cy + Math.sin(ang) * R }; });
    let svg = '';
    edges.forEach(r => {
      const a = pos[r.entityA], b = pos[r.entityB];
      if (!a || !b) return;
      const w = Math.min(6, 1 + r.interactions / 3);
      const color = r.band === 'HIGH' ? '#1D4ED8' : r.band === 'MEDIUM' ? '#B45309' : '#94A3B8';
      const op = r.band === 'HIGH' ? 0.85 : r.band === 'MEDIUM' ? 0.6 : 0.4;
      svg += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${w}" opacity="${op}" style="cursor:pointer" onclick="Network.openRelExplain('${r.id}')"><title>${r.interactions} interactions — ${r.confidence}% (${r.band})</title></line>`;
    });
    nodes.forEach(n => {
      const p = pos[n.id];
      svg += `<g style="cursor:pointer" onclick="Entities.open('${n.id}')">
        <circle cx="${p.x}" cy="${p.y}" r="10" fill="#EFF4FF" stroke="#1D4ED8" stroke-width="1.8"/>
        <circle cx="${p.x}" cy="${p.y}" r="3" fill="#1D4ED8"/>
        <text x="${p.x}" y="${p.y - 14}" text-anchor="middle" fill="#5B6B82" font-size="10" font-family="monospace">${UI.esc((n.canonical || '').slice(-6))}</text>
      </g>`;
    });
    host.innerHTML = `<div id="graph-wrap"><svg id="graph-svg" viewBox="0 0 ${W} ${H}">${svg}</svg>
      <div class="graph-legend">
        <div><span class="dot" style="background:#1D4ED8"></span> High confidence</div>
        <div><span class="dot" style="background:#B45309"></span> Medium confidence</div>
        <div><span class="dot" style="background:#94A3B8"></span> Low confidence</div>
      </div></div>`;
  },
  async openRelExplain(relId) {
    const res = await Api.get(`/api/relationships/${relId}?caseId=${App.currentCaseId}`);
    UI.openModal(`
      <div class="modal-head"><div style="font-size:15px;font-weight:700;">Relationship Evidence &amp; Explanation</div><button class="drawer-close" onclick="UI.closeAll()">✕</button></div>
      <div class="mono" style="font-size:13px;">${res.relationship.entityA} ↔ ${res.relationship.entityB}</div>
      <div style="margin:10px 0;"><span class="mono" style="font-size:22px;font-weight:700;">${res.confidence}%</span> <span class="badge ${res.band === 'HIGH' ? 'high' : res.band === 'MEDIUM' ? 'medium' : 'low'}">${res.band}</span></div>
      <div class="explain-block"><h4>What</h4><div style="font-size:12.5px;">${UI.esc(res.what)}</div></div>
      <div class="explain-block"><h4>Why</h4><ul class="explain-list">${res.why.map(w => `<li>${UI.esc(w)}</li>`).join('')}</ul></div>
      <div class="explain-block"><h4>Confidence Breakdown</h4><div style="font-size:12px;">${Object.entries(res.scoreBreakdown || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div></div>
      <div class="explain-block"><h4>Evidence Records (${res.evidence.length})</h4>${res.evidence.slice(0, 15).map(e => `<span class="evidence-chip" onclick="UI.closeAll();Evidence.open('${e}')">${e}</span>`).join('')}</div>
      <div class="disclaimer-box">${UI.esc(res.disclaimer)}</div>
    `);
  },
};

/* ===================== AI Case Assistant (Step 18) ===================== */
const Assistant = {
  history: [],
  async render() {
    if (!Main.requireCase()) return;
    Main.set(`
      <div class="page-head">
        <div>
          <div class="page-title">AI Case Assistant</div>
          <div class="page-sub">Interactive investigative reasoning powered by Groq. Grounded strictly in current case evidence.</div>
        </div>
      </div>
      <div class="quick-prompts">
        <span class="prompt-chip" onclick="Assistant.askQuick('What are the highest priority leads in this case and why?')">Highest priority leads</span>
        <span class="prompt-chip" onclick="Assistant.askQuick('Which entities have the highest centrality in this network?')">Central network entities</span>
        <span class="prompt-chip" onclick="Assistant.askQuick('What unusual communication bursts or patterns were detected?')">Communication bursts</span>
        <span class="prompt-chip" onclick="Assistant.askQuick('Which relationships have cross-case relevance or multiple evidence rows?')">Cross-case relationships</span>
      </div>
      <div class="assistant-chat">
        <div class="chat-messages" id="assistant-msgs">
          <div class="chat-msg assistant">
            <div class="msg-meta">SentinelNet AI Assistant</div>
            Hello Officer. I am grounded in the data and evidence records of case <b>${UI.esc(App.currentCaseId)}</b>. Ask me any question regarding network connections, evidence grounding, suspicious bursts, or lead rationale.
          </div>
        </div>
        <div class="chat-input-row">
          <input type="text" class="chat-input" id="assistant-input" placeholder="Ask a question about this case..." onkeydown="if(event.key==='Enter') Assistant.send()">
          <button class="btn primary" id="assistant-send-btn" onclick="Assistant.send()">Send</button>
        </div>
      </div>
      <div class="disclaimer-box" style="margin-top:14px;">
        SentinelNet AI output is intended for investigative assistance only. AI never determines guilt and requires authorized investigator verification.
      </div>
    `);
  },
  askQuick(text) {
    const input = document.getElementById('assistant-input');
    if (input) { input.value = text; this.send(); }
  },
  async send() {
    const input = document.getElementById('assistant-input');
    const btn = document.getElementById('assistant-send-btn');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    btn.disabled = true;

    const host = document.getElementById('assistant-msgs');
    host.innerHTML += `<div class="chat-msg user"><div class="msg-meta">You</div>${UI.esc(text)}</div>`;
    host.scrollTop = host.scrollHeight;

    const placeholderId = 'ai-loading-' + Date.now();
    host.innerHTML += `<div class="chat-msg assistant" id="${placeholderId}"><div class="msg-meta">SentinelNet AI</div><i>Analyzing case graph and evidence records…</i></div>`;
    host.scrollTop = host.scrollHeight;

    try {
      const res = await Api.post(`/api/cases/${App.currentCaseId}/assistant`, {
        query: text,
        history: this.history,
      });

      this.history.push({ role: 'user', content: text });
      this.history.push({ role: 'assistant', content: res.answer });

      const el = document.getElementById(placeholderId);
      if (el) {
        let chipsHtml = '';
        if (res.evidenceReferences && res.evidenceReferences.length) {
          chipsHtml = `<div style="margin-top:8px;">${res.evidenceReferences.map(ev => `<span class="evidence-chip" onclick="Evidence.open('${ev}')">${ev}</span>`).join('')}</div>`;
        }
        el.innerHTML = `<div class="msg-meta">SentinelNet AI (${res.model || 'Groq'})</div>${UI.esc(res.answer).replace(/\n/g, '<br>')}${chipsHtml}`;
      }
    } catch (e) {
      const el = document.getElementById(placeholderId);
      if (el) el.innerHTML = `<div class="msg-meta" style="color:var(--red);">Error</div>${UI.esc(e.message)}`;
    } finally {
      btn.disabled = false;
      host.scrollTop = host.scrollHeight;
    }
  },
};

/* ===================== AI Leads ===================== */
const Leads = {
  statusFilter: '',
  async render() {
    if (!Main.requireCase()) return;
    const res = await Api.get(`/api/cases/${App.currentCaseId}/leads${this.statusFilter ? '?status=' + this.statusFilter : ''}`);
    Main.set(`
      <div class="page-head">
        <div>
          <div class="page-title">AI Investigation Leads</div>
          <div class="page-sub">Evidence-backed investigative leads with verifiable evidence citations.</div>
        </div>
        <div class="btn-row">
          <button class="btn primary" id="run-ai-btn" onclick="Leads.runGroqAnalysis()">+ Analyze Case with Groq AI</button>
        </div>
      </div>
      <div class="pill-filter">
        <span class="pill ${!this.statusFilter ? 'active' : ''}" onclick="Leads.filter('')">All</span>
        <span class="pill ${this.statusFilter === 'NEW' ? 'active' : ''}" onclick="Leads.filter('NEW')">New</span>
        <span class="pill ${this.statusFilter === 'UNDER_REVIEW' ? 'active' : ''}" onclick="Leads.filter('UNDER_REVIEW')">Under review</span>
        <span class="pill ${this.statusFilter === 'VALIDATED' ? 'active' : ''}" onclick="Leads.filter('VALIDATED')">Validated</span>
        <span class="pill ${this.statusFilter === 'DISMISSED' ? 'active' : ''}" onclick="Leads.filter('DISMISSED')">Dismissed</span>
      </div>
      <table><thead><tr><th>Lead Title</th><th>Type</th><th>Priority</th><th>Confidence</th><th>Model</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${res.leads.map(l => `<tr class="clickable" onclick="Leads.open('${l.id}')">
        <td><b>${UI.esc(l.what)}</b></td><td>${(l.kind || '').replace(/_/g, ' ')}</td>
        <td><span class="badge ${UI.badgeClass(l.priority)}">${l.priority}</span></td>
        <td>${UI.confBar(l.confidence)} ${l.confidence}%</td>
        <td class="mono" style="font-size:11px;">${l.aiModel || 'rule-based'}</td>
        <td><span class="badge neutral">${l.status}</span></td>
        <td><button class="btn sm" onclick="event.stopPropagation();Leads.open('${l.id}')">Review</button></td>
      </tr>`).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--text-faint);padding:24px;">No leads at this filter. Upload a data source or click "Analyze Case with Groq AI".</td></tr>`}</tbody></table>
    `);
  },
  filter(s) { this.statusFilter = s; this.render(); },
  async runGroqAnalysis() {
    const btn = document.getElementById('run-ai-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Running Groq AI reasoning…'; }
    try {
      const res = await Api.post(`/api/cases/${App.currentCaseId}/ai-analysis`);
      UI.toast(`Analysis complete — generated ${res.leadsCreated.length} leads using ${res.model}`);
      Leads.render();
    } catch (e) {
      UI.toast(e.message, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '+ Analyze Case with Groq AI'; }
    }
  },
  async open(id) {
    const res = await Api.get(`/api/leads/${id}?caseId=${App.currentCaseId}`);
    const canAct = canRole('investigator', 'senior_investigator');
    UI.openModal(`
      <div class="modal-head"><div style="font-size:15px;font-weight:700;">${(res.lead.kind || '').replace(/_/g, ' ')}</div><button class="drawer-close" onclick="UI.closeAll()">✕</button></div>
      <div style="font-weight:700;font-size:15px;margin-bottom:6px;">${UI.esc(res.what)}</div>
      <div style="display:flex;gap:8px;align-items:center;margin:6px 0;">
        <span class="badge ${UI.badgeClass(res.lead.priority)}">${res.lead.priority} priority</span>
        <span class="badge neutral mono" style="font-size:11px;">Model: ${res.lead.aiModel || 'deterministic'}</span>
      </div>
      <div style="margin:10px 0;"><span class="mono" style="font-size:22px;font-weight:700;">${res.confidence}%</span> <span style="color:var(--text-dim);font-size:12px;">analytical confidence</span></div>
      <div class="explain-block"><h4>Factual Rationale / Why</h4><ul class="explain-list">${(res.why || []).map(w => `<li>${UI.esc(w)}</li>`).join('')}</ul></div>
      ${res.lead.suggestedAction ? `<div class="explain-block"><h4>Suggested Next Action</h4><div style="font-size:12.5px;">${UI.esc(res.lead.suggestedAction)}</div></div>` : ''}
      <div class="explain-block"><h4>Supporting Evidence Records</h4>${res.evidence.length ? res.evidence.map(e => `<span class="evidence-chip" onclick="UI.closeAll();Evidence.open('${e}')">${e}</span>`).join('') : '<i style="color:var(--text-faint);font-size:12px;">No evidence IDs attached.</i>'}</div>
      <div class="disclaimer-box">${UI.esc(res.disclaimer)}</div>
      ${canAct ? `<div class="btn-row" style="margin-top:14px;">
        <button class="btn primary sm" onclick="Leads.setStatus('${res.lead.id}','VALIDATED')">Validate</button>
        <button class="btn sm" onclick="Leads.setStatus('${res.lead.id}','UNDER_REVIEW')">Under review</button>
        <button class="btn danger sm" onclick="Leads.setStatus('${res.lead.id}','DISMISSED')">Dismiss</button>
      </div>` : ''}
    `);
  },
  async setStatus(id, status) {
    try { await Api.post(`/api/leads/${id}/status`, { status }); UI.toast('Lead marked ' + status); UI.closeAll(); Leads.render(); }
    catch (e) { UI.toast(e.message, true); }
  },
};

/* ===================== Timeline ===================== */
const Timeline = {
  async render() {
    if (!Main.requireCase()) return;
    const res = await Api.get(`/api/cases/${App.currentCaseId}/evidence`);
    const events = (res.evidence || []).filter(e => e.ts).sort((a, b) => new Date(a.ts) - new Date(b.ts));
    Main.set(`
      <div class="page-head"><div><div class="page-title">Investigation Timeline</div><div class="page-sub">${events.length} timestamped event(s) extracted from evidence</div></div></div>
      <div class="card"><div class="tl-track">${events.slice(0, 200).map(e => `
        <div class="tl-event" style="cursor:pointer" onclick="Evidence.open('${e.id}')">
          <div class="tl-time">${UI.fmtTs(e.ts)}</div>
          <div class="tl-title">${e.raw && (e.raw.caller !== undefined || e.raw.receiver !== undefined) ? `${UI.esc(e.raw.caller)} → ${UI.esc(e.raw.receiver)}` : UI.esc(e.type)}</div>
          <div class="tl-meta">${e.id} · ${e.type}${e.raw && e.raw.duration ? ' · ' + e.raw.duration + 's' : ''}${e.raw && e.raw.amount ? ' · ₹' + e.raw.amount : ''}</div>
        </div>`).join('') || `<div class="empty-state">No timestamped events yet.</div>`}</div></div>
    `);
  },
};

/* ===================== Evidence Repository ===================== */
const Evidence = {
  async render() {
    if (!Main.requireCase()) return;
    const res = await Api.get(`/api/cases/${App.currentCaseId}/evidence`);
    Main.set(`
      <div class="page-head"><div><div class="page-title">Evidence Repository</div><div class="page-sub">${(res.evidence || []).length} immutable evidence record(s)</div></div></div>
      <table><thead><tr><th>Evidence ID</th><th>Type</th><th>Source</th><th>Uploaded by</th><th>Timestamp</th><th>Integrity</th></tr></thead>
      <tbody>${(res.evidence || []).slice(0, 300).map(e => `<tr class="clickable" onclick="Evidence.open('${e.id}')">
        <td class="mono">${e.id}</td><td>${e.type}</td><td>${UI.esc(e.source)}</td><td class="mono">${e.uploadedBy}</td>
        <td class="mono">${UI.fmtTs(e.ts)}</td><td><span class="badge low">${e.integrity}</span></td>
      </tr>`).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--text-faint);padding:24px;">No evidence yet.</td></tr>`}</tbody></table>
    `);
  },
  async open(id) {
    const res = await Api.get(`/api/evidence/${id}`);
    const e = res.evidence;
    const isRelational = e.raw && (e.raw.caller !== undefined || e.raw.receiver !== undefined);
    const rawRows = isRelational
      ? `<div class="k">Caller</div><div class="mono">${UI.esc(e.raw.caller || '—')}</div>
         <div class="k">Receiver</div><div class="mono">${UI.esc(e.raw.receiver || '—')}</div>
         <div class="k">Timestamp</div><div class="mono">${UI.esc(e.raw.timestamp || '—')}</div>
         <div class="k">Duration</div><div>${e.raw.duration ? e.raw.duration + 's' : '—'}</div>
         <div class="k">Amount</div><div>${e.raw.amount ? '₹' + Number(e.raw.amount).toLocaleString('en-IN') : '—'}</div>`
      : Object.entries(e.raw || {}).filter(([k, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) =>
          `<div class="k">${UI.esc(k)}</div><div class="mono">${UI.esc(v)}</div>`).join('');
    UI.openModal(`
      <div class="modal-head"><div style="font-size:15px;font-weight:700;">${e.id}</div><button class="drawer-close" onclick="UI.closeAll()">✕</button></div>
      <div class="kv">
        <div class="k">Source</div><div>${UI.esc(e.source)}</div>
        <div class="k">Document</div><div class="mono">${e.documentId}</div>
        <div class="k">Row</div><div>#${e.rowIndex}</div>
        <div class="k">Case</div><div class="mono">${e.caseId}</div>
        ${rawRows}
        <div class="k">Uploaded by</div><div class="mono">${e.uploadedBy}</div>
        <div class="k">Integrity hash</div><div class="mono">${e.hash}</div>
      </div>
      <div class="disclaimer-box">Access to this record has been logged in the audit trail.</div>
    `);
  },
};

/* ===================== Cross-Case Links ===================== */
const CrossCase = {
  async render() {
    if (!Main.requireCase()) return;
    const res = await Api.get(`/api/cases/${App.currentCaseId}/cross-case`);
    Main.set(`
      <div class="page-head"><div><div class="page-title">Cross-Case Connections</div><div class="page-sub">Shared normalized identifiers discovered across authorized cases.</div></div></div>
      ${res.connections && res.connections.length ? res.connections.map(c => `
        <div class="card" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div><b>${c.entityType} entity</b> <span class="mono" style="color:var(--text-dim);">${c.entityId}</span><div style="font-size:12.5px;color:var(--text-dim);margin-top:4px;">${UI.esc(c.reason)}</div></div>
            <div style="text-align:right;"><div class="mono" style="font-size:18px;font-weight:700;">${c.confidence}%</div></div>
          </div>
          <div style="margin-top:10px;font-size:12.5px;"><b>Current case:</b> <span class="mono">${c.currentCase}</span> ↔ <b>Related case(s):</b> <span class="mono">${c.relatedCases.join(', ')}</span></div>
          <div style="margin-top:8px;">${c.evidenceIds.map(e => `<span class="evidence-chip" onclick="Evidence.open('${e}')">${e}</span>`).join('')}</div>
        </div>
      `).join('') : `<div class="card empty-state">No cross-case connections detected among your authorized cases.</div>`}
    `);
  },
};

/* ===================== Entity Resolution ===================== */
const Resolution = {
  async render() {
    if (!Main.requireCase()) return;
    const res = await Api.get(`/api/cases/${App.currentCaseId}/resolution-queue`);
    Main.set(`
      <div class="page-head"><div><div class="page-title">Entity Resolution Queue</div><div class="page-sub">Fuzzy name matching + multi-signal confidence. High scores are candidates — never an automatic merge.</div></div></div>
      <div id="resolution-list">${this.list(res.queue || [])}</div>
      <div class="section-title" style="margin-top:20px;font-weight:700;">Try the Matching Engine <small style="font-weight:normal;color:var(--text-dim);">(Deterministic + Groq)</small></div>
      <div class="card">
        <div class="grid grid-2">
          <div class="field"><label>Name A</label><input id="cmp-a" placeholder="e.g. Abdul Rahim"></div>
          <div class="field"><label>Name B</label><input id="cmp-b" placeholder="e.g. Abdul Rahim Khan"></div>
        </div>
        <button class="btn primary sm" onclick="Resolution.compare()">Compute match confidence</button>
        <div id="cmp-result" style="margin-top:12px;"></div>
      </div>
    `);
  },
  list(queue) {
    if (!queue.length) return `<div class="card empty-state">No pending candidate matches in queue.</div>`;
    return queue.map(m => `<div class="card" style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div><b>${UI.esc(m.entityAName)}</b> <span style="color:var(--text-faint);">↔</span> <b>${UI.esc(m.entityBName)}</b>
          <div style="font-size:11.5px;color:var(--text-dim);margin-top:2px;">Name similarity ${m.nameSimilarity}% · Band: <span class="badge ${m.band === 'STRONG_CANDIDATE' ? 'high' : 'medium'}">${m.band.replace(/_/g, ' ')}</span></div></div>
        <div class="mono" style="font-size:20px;font-weight:700;">${m.confidence}%</div>
      </div>
      <div class="btn-row" style="margin-top:12px;">
        <button class="btn primary sm" onclick="Resolution.decide('${m.id}','accept')">Accept match</button>
        <button class="btn danger sm" onclick="Resolution.decide('${m.id}','reject')">Keep separate</button>
      </div>
    </div>`).join('');
  },
  async decide(id, action) {
    try { await Api.post(`/api/resolution/${id}/${action}`); UI.toast(action === 'accept' ? 'Match accepted — graph updated consistently' : 'Kept separate'); Resolution.render(); }
    catch (e) { UI.toast(e.message, true); }
  },
  async compare() {
    const nameA = document.getElementById('cmp-a').value, nameB = document.getElementById('cmp-b').value;
    if (!nameA || !nameB) return;
    const res = await Api.post('/api/resolution/compare', { nameA, nameB, phoneMatch: null });
    document.getElementById('cmp-result').innerHTML = `<div class="explain-block"><h4>Result</h4>
      Name similarity: <b>${res.nameSimilarity}%</b> · Overall confidence: <b>${res.confidence}%</b> · Band: <span class="badge ${res.band === 'STRONG_CANDIDATE' ? 'high' : res.band === 'HUMAN_REVIEW' ? 'medium' : 'low'}">${res.band.replace(/_/g, ' ')}</span>
    </div>`;
  },
};

/* ===================== Reports ===================== */
const Reports = {
  async render() {
    if (!Main.requireCase()) return;
    const res = await Api.get(`/api/cases/${App.currentCaseId}/reports`);
    Main.set(`
      <div class="page-head"><div><div class="page-title">Investigation Reports</div><div class="page-sub">Evidence-grounded brief generation. Every claim references genuine case evidence IDs.</div></div>
        <button class="btn primary" onclick="Reports.generate()">Generate new report</button></div>
      <table><thead><tr><th>Report ID</th><th>Generated</th><th>By</th><th>Entities</th><th>Relationships</th><th>High leads</th><th>Action</th></tr></thead>
      <tbody>${(res.reports || []).map(r => `<tr>
        <td class="mono">${r.id}</td><td class="mono">${UI.fmtTs(r.generatedAt)}</td><td class="mono">${r.generatedBy}</td>
        <td>${r.summary.entityCount}</td><td>${r.summary.relationshipCount}</td><td>${r.summary.highPriorityLeadCount}</td>
        <td><button class="btn sm" onclick="Reports.download('${r.id}')">Download</button></td>
      </tr>`).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--text-faint);padding:24px;">No reports generated yet.</td></tr>`}</tbody></table>
    `);
  },
  async generate() {
    try { const res = await Api.post(`/api/cases/${App.currentCaseId}/reports`); UI.toast('Report ' + res.report.id + ' generated'); Reports.render(); }
    catch (e) { UI.toast(e.message, true); }
  },
  async download(id) {
    const resp = await fetch(`/api/reports/${id}/download`, { headers: { Authorization: 'Bearer ' + Api.token } });
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  },
};

/* ===================== Admin: Audit + Users ===================== */
const Admin = {
  async renderAudit() {
    const res = await Api.get(`/api/admin/audit${App.currentCaseId ? '?caseId=' + App.currentCaseId : ''}`);
    Main.set(`
      <div class="page-head"><div><div class="page-title">Audit Logs</div><div class="page-sub">WHO → WHAT → WHEN → CASE → ACTION. Immutable record of sensitive actions.</div></div></div>
      <table><thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Case</th><th>Detail</th></tr></thead>
      <tbody>${(res.logs || []).map(l => `<tr><td class="mono">${UI.fmtTs(l.ts)}</td><td class="mono">${l.who}</td><td>${l.role ? roleLabel(l.role) : '—'}</td><td><span class="badge neutral">${l.action}</span></td><td class="mono">${l.caseId || '—'}</td><td style="font-size:11.5px;">${UI.esc(l.detail)}</td></tr>`).join('')}</tbody></table>
    `);
  },
  async renderUsers() {
    const res = await Api.get('/api/admin/users');
    Main.set(`
      <div class="page-head"><div><div class="page-title">Users &amp; Case Access</div><div class="page-sub">Manage accounts and grant case-level authorization.</div></div>
        <button class="btn primary" onclick="Admin.openCreateUser()">+ New user</button></div>
      <table><thead><tr><th>ID</th><th>Name</th><th>Role</th><th>Action</th></tr></thead>
      <tbody>${(res.users || []).map(u => `<tr><td class="mono">${u.id}</td><td>${UI.esc(u.name)}</td><td>${roleLabel(u.role)}</td>
        <td><button class="btn sm" onclick="Admin.openGrantAccess('${u.id}')">Grant case access</button></td></tr>`).join('')}</tbody></table>
    `);
  },
  openCreateUser() {
    UI.openModal(`
      <div class="modal-head"><div style="font-size:15px;font-weight:700;">New user</div><button class="drawer-close" onclick="UI.closeAll()">✕</button></div>
      <div class="field"><label>Official ID</label><input id="nu-id" placeholder="e.g. INV-210"></div>
      <div class="field"><label>Name</label><input id="nu-name"></div>
      <div class="field"><label>Role</label><select id="nu-role"><option value="investigator">Investigating Officer</option><option value="senior_investigator">Senior Investigation Officer</option><option value="analyst">Intelligence Analyst</option><option value="admin">System Administrator</option></select></div>
      <div class="field"><label>Temporary password</label><input id="nu-pw" type="text"></div>
      <button class="btn primary" style="width:100%;" onclick="Admin.submitCreateUser()">Create user</button>
    `);
  },
  async submitCreateUser() {
    const id = document.getElementById('nu-id').value.trim(), name = document.getElementById('nu-name').value.trim(),
      role = document.getElementById('nu-role').value, password = document.getElementById('nu-pw').value;
    try { await Api.post('/api/admin/users', { id, name, role, password }); UI.toast('User created'); UI.closeAll(); Admin.renderUsers(); }
    catch (e) { UI.toast(e.message, true); }
  },
  openGrantAccess(userId) {
    UI.openModal(`
      <div class="modal-head"><div style="font-size:15px;font-weight:700;">Grant case access — ${userId}</div><button class="drawer-close" onclick="UI.closeAll()">✕</button></div>
      <div class="field"><label>Case</label><select id="ga-case">${App.cases.map(c => `<option value="${c.id}">${c.id} — ${c.title}</option>`).join('')}</select></div>
      <div class="field"><label><input type="checkbox" id="ga-pii"> Full PII access for this case</label></div>
      <button class="btn primary" style="width:100%;" onclick="Admin.submitGrant('${userId}')">Grant access</button>
    `);
  },
  async submitGrant(userId) {
    const caseId = document.getElementById('ga-case').value, fullPiiAccess = document.getElementById('ga-pii').checked;
    try { await Api.post(`/api/admin/cases/${caseId}/access`, { userId, roleAtCase: 'granted', fullPiiAccess }); UI.toast('Access granted'); UI.closeAll(); }
    catch (e) { UI.toast(e.message, true); }
  },
};

/* ===================== Boot ===================== */
Auth.init();

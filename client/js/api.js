const API_BASE = ''; // same-origin — server serves this client

const Api = {
  token: null,

  setToken(t) { this.token = t; if (t) localStorage.setItem('sn_token', t); else localStorage.removeItem('sn_token'); },
  loadToken() { this.token = localStorage.getItem('sn_token'); return this.token; },

  async request(method, path, body, isForm) {
    const headers = {};
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
    let opts = { method, headers };
    if (body && !isForm) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    if (body && isForm) { opts.body = body; }
    const res = await fetch(API_BASE + path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  },
  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body || {}); },
  patch(path, body) { return this.request('PATCH', path, body || {}); },
  del(path) { return this.request('DELETE', path); },
  postForm(path, formData) { return this.request('POST', path, formData, true); },
};

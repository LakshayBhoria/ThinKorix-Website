/* ============================================================
   Thinkorix — shared auth + API helper.
   Session is stored in localStorage under 'thx_token' / 'thx_user'.
   ============================================================ */
(function (global) {
  const TOKEN_KEY = 'thx_token';
  const USER_KEY = 'thx_user';

  // Backend is hosted separately (e.g. on Render) since Firebase Hosting only
  // serves static files. Every request to a path starting with '/' gets this
  // prefixed automatically. Replace with your real Render URL after deploying,
  // e.g. 'https://thinkorix-backend.onrender.com' (no trailing slash).
  const API_BASE = 'https://YOUR-RENDER-URL.onrender.com';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  }
  function setSession(user, token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
  function isLoggedIn() {
    return !!getToken();
  }

  // Core fetch wrapper. `body` may be a plain object (sent as JSON) or a
  // FormData instance (sent as-is, for file uploads).
  async function api(path, { method = 'GET', body, auth = true, query } = {}) {
    const headers = {};
    let payload = body;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (auth) {
      const token = getToken();
      if (token) headers['Authorization'] = 'Bearer ' + token;
    }
    let url = path.startsWith('/') ? API_BASE + path : path;
    if (query) {
      const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      const qsStr = qs.toString();
      if (qsStr) url += (url.includes('?') ? '&' : '?') + qsStr;
    }
    let res, data;
    try {
      res = await fetch(url, { method, headers, body: payload });
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) {
      if (res.status === 401) { clearSession(); }
      throw new Error(data.error || `Request failed (${res.status}).`);
    }
    return data;
  }

  // Redirects to the login page (remembering where to return) unless a
  // valid-looking session exists. If `roles` is given, also enforces role
  // and shows an access-denied gate instead of the page content.
  function requireLogin(opts) {
    opts = opts || {};
    if (!isLoggedIn()) {
      const here = global.location.pathname.split('/').pop() + global.location.search;
      global.location.href = 'login.html?redirect=' + encodeURIComponent(here);
      return false;
    }
    const user = getUser();
    if (opts.roles && opts.roles.length && (!user || !opts.roles.includes(user.role))) {
      renderAccessDenied(opts.roles);
      return false;
    }
    return true;
  }

  function renderAccessDenied(roles) {
    const main = document.querySelector('main') || document.body;
    main.innerHTML = `
      <div class="gate-screen">
        <div class="gate-card">
          <div class="gate-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
          </div>
          <h2>This portal isn't part of your account</h2>
          <p>You're signed in, but this area is limited to ${roles.join(' / ')} accounts. Contact an admin if you think this is wrong.</p>
          <a class="btn btn-primary" href="index.html">Back to home</a>
        </div>
      </div>`;
  }

  function logout() {
    clearSession();
    global.location.href = 'index.html';
  }

  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2).map(s => s[0].toUpperCase()).join('');
  }

  // Renders the shared top app bar into any element with id="appbar".
  function renderAppbar({ title, back = 'index.html', backLabel = 'Home' } = {}) {
    const el = document.getElementById('appbar');
    if (!el) return;
    const user = getUser();
    el.innerHTML = `
      <div class="appbar-inner">
        <div class="appbar-left">
          <a href="${back}" class="appbar-back">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 18l-6-6 6-6"/></svg>
            <span>${backLabel}</span>
          </a>
          <span class="appbar-title">${title || ''}</span>
        </div>
        <div class="appbar-right">
          ${user ? `
            <div class="user-chip">
              <span class="user-avatar">${initials(user.name)}</span>
              <span class="who"><b>${escapeHtml(user.name)}</b><span>${escapeHtml(user.role)}</span></span>
            </div>
            <button class="icon-btn" id="logout-btn" title="Log out" aria-label="Log out">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
            </button>` :
          `<a href="login.html" class="btn btn-ghost btn-sm">Log in</a>`}
        </div>
      </div>`;
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let toastTimer;
  function toast(msg, isError) {
    const el = document.getElementById('toast');
    if (!el) { isError ? console.error(msg) : console.log(msg); return; }
    el.textContent = msg;
    el.classList.toggle('err', !!isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
  }

  function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return String(d); }
  }

  global.THX = {
    getToken, getUser, setSession, clearSession, isLoggedIn,
    api, requireLogin, logout, initials, renderAppbar, escapeHtml, toast, fmtDate,
    API_BASE
  };
})(window);

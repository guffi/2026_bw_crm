/* Brineworks Funder CRM — front end. All data comes from the Apps Script backend after sign-in. */
(function () {
  "use strict";

  const API = (window.CRM_CONFIG && window.CRM_CONFIG.apiUrl) || "";
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  const REL = ["Active – Series A/CLA", "Existing investor", "Warm", "Grant awarded", "Grant applied", "Grant in prep", "Grant rejected", "Passed", "Dormant", "Not contacted", "Not a funder"];
  const CATS = ["Investor", "Grant/Public", "Debt/Bank", "Other"];
  const CHANNELS = ["", "Email", "Meeting", "Call", "Notes", "Logged", "Sheet"];
  const BALL = ["None", "Us", "Them"];
  const CONF = ["", "High", "Medium", "Low"];
  const OWNERS = ["", "GS", "JTP", "Olga", "Sam", "Ariana"];
  const OWNER_ALIASES = { gudfinnur: ["GS", "Gudfinnur"], joe: ["JTP", "Joe", "Joseph"], olga: ["Olga", "OM"] };
  const relClass = r => r === "Active – Series A/CLA" ? "p-active" : r === "Existing investor" ? "p-existing" : r === "Warm" ? "p-warm" : String(r || "").startsWith("Grant") ? "p-grant" : r === "Passed" ? "p-passed" : "p-idle";
  const relRank = r => { const i = REL.indexOf(r); return i < 0 ? 99 : i; };
  const fmtTime = iso => { if (!iso) return "—"; const d = new Date(iso); if (isNaN(d)) return String(iso); return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
  const ago = ms => { const m = Math.round(ms / 60000); if (m < 1) return "just now"; if (m < 60) return m + " min ago"; const h = Math.round(m / 60); return h < 24 ? h + " h ago" : Math.round(h / 24) + " d ago"; };
  const DEFAULT_VIEW = { q: "", rel: "", cat: "", usOnly: false, hideNF: true, strip: "", sortKey: "relationship", sortDir: 1 };

  const S = {
    token: store.get("crm-token"), user: null, tier: null, meta: null, prefs: {}, viewAs: null,
    rows: [], summary: null, empty: false, todos: null,
    view: null, lastCheck: 0, openId: null, pending: {}, saveTimer: null,
    pv: Object.assign({}, DEFAULT_VIEW), activeView: null, todoFilter: "all", hideDone: false,
  };

  /* ---------- api ---------- */
  async function api(action, body) {
    const payload = Object.assign({ action, token: S.token }, S.viewAs ? { view_as: S.viewAs } : {}, body || {});
    let res;
    try {
      res = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload), redirect: "follow" });
    } catch (e) {
      throw Object.assign(new Error("Can't reach the server. Check your connection."), { code: "network" });
    }
    let data;
    try { data = await res.json(); } catch (e) { throw Object.assign(new Error("The server sent an unexpected answer."), { code: "server_error" }); }
    if (!data.ok) {
      if (data.error === "unauthorized" && action !== "login") signOut(true);
      throw Object.assign(new Error(data.message || data.error), { code: data.error });
    }
    return data;
  }

  function toast(msg, kind) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false; t.className = "toast" + (kind ? " " + kind : "");
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  /** Button helper: shows Saving… then Saved for a moment, or the error. */
  async function withButton(btn, fn, labels) {
    labels = labels || {};
    const orig = btn.textContent;
    btn.classList.add("saving"); btn.textContent = labels.busy || "Saving…";
    try {
      const r = await fn();
      btn.textContent = labels.done || "Saved ✓";
      setTimeout(() => { btn.textContent = orig; btn.classList.remove("saving"); }, 1500);
      return r;
    } catch (e) {
      btn.textContent = orig; btn.classList.remove("saving");
      toast(e.message, "err");
      throw e;
    }
  }
  const setState = (el, text, kind) => { if (!el) return; el.className = "state" + (kind ? " " + kind : ""); el.innerHTML = (kind === "busy" ? '<span class="spin"></span>' : "") + esc(text); };

  /* ---------- tracking ---------- */
  const T = { q: [], view: null, start: 0 };
  function track(type, extra) {
    if (!S.token) return;
    T.q.push(Object.assign({ type, t: new Date().toISOString() }, extra || {}));
    if (T.q.length >= 20) flush();
  }
  function endView() {
    if (T.view && T.start) {
      const s = (Date.now() - T.start) / 1000;
      if (s >= 1) track("time_on_view", { view: T.view, seconds: Math.round(s) });
    }
    T.start = 0;
  }
  function beginView(v) { endView(); T.view = v; T.start = Date.now(); track("view", { view: v }); }
  function flush(beacon) {
    if (!T.q.length || !S.token || !API) return;
    const body = JSON.stringify(Object.assign({ action: "track", token: S.token, events: T.q.splice(0, 50), ua: navigator.userAgent.slice(0, 120) }, S.viewAs ? { view_as: S.viewAs } : {}));
    if (beacon && navigator.sendBeacon) {
      try { navigator.sendBeacon(API, new Blob([body], { type: "text/plain;charset=utf-8" })); return; } catch (e) { /* fall through */ }
    }
    fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body, keepalive: true }).catch(() => {});
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { endView(); flush(true); }
    else if (S.view) { T.view = S.view; T.start = Date.now(); track("view", { view: S.view }); maybeCheck(); }
  });
  setInterval(() => flush(false), 60000);
  window.addEventListener("beforeunload", () => { endView(); flush(true); });

  /* ---------- boot / auth ---------- */
  function showOnly(id) { ["#login", "#shell", "#setupMsg"].forEach(s => { $(s).hidden = s !== id; }); }

  function readCache() { try { const c = JSON.parse(store.get("crm-cache") || "null"); return c && c.rows ? c : null; } catch (e) { return null; } }
  function writeCache() { store.set("crm-cache", JSON.stringify({ version: S.meta.version, tier: S.tier.id, rows: S.rows, summary: S.summary, empty: S.empty })); }

  async function boot() {
    if (!API || /PASTE_/.test(API)) { showOnly("#setupMsg"); return; }
    if (S.token) {
      showOnly("#shell");
      $("#main").innerHTML = skeleton();
      try { await loadBoot(); return start(); }
      catch (e) { if (e.code !== "unauthorized") { showOnly("#login"); $("#loginErr").textContent = e.message; $("#loginErr").hidden = false; return; } }
    }
    showOnly("#login");
    $("#loginEmail").value = store.get("crm-email") || "";
    ($("#loginEmail").value ? $("#loginPassword") : $("#loginEmail")).focus();
  }

  /** One round trip: identity, permissions, prefs, data (unless the local copy is current) and to-dos. */
  async function loadBoot(force) {
    const cache = readCache();
    const r = await api("boot", { known_version: cache ? cache.version : null, known_tier: cache ? cache.tier : null, force: !!force });
    S.user = r.user; S.tier = r.tier; S.meta = r.meta; S.prefs = r.prefs || {}; S.viewAs = r.view_as || null;
    if (r.data) { S.rows = r.data.rows || []; S.summary = r.data.summary; S.empty = !!r.data.empty; writeCache(); }
    else if (cache) { S.rows = cache.rows; S.summary = cache.summary; S.empty = !!cache.empty; }
    S.todos = r.todos || null;
    S.lastCheck = Date.now();
    const tp = (S.prefs.todos || {}); S.todoFilter = tp.filter || "all"; S.hideDone = !!tp.hide_done;
    applyDefaultView();
  }

  $("#loginForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const btn = $("#loginBtn"), err = $("#loginErr");
    err.hidden = true; btn.disabled = true; btn.textContent = "Signing in…";
    try {
      const r = await api("login", { email: $("#loginEmail").value.trim(), password: $("#loginPassword").value, ua: navigator.userAgent.slice(0, 120) });
      S.token = r.token; store.set("crm-token", r.token); store.set("crm-email", $("#loginEmail").value.trim());
      $("#loginPassword").value = "";
      showOnly("#shell"); $("#main").innerHTML = skeleton();
      await loadBoot();
      start();
    } catch (e) {
      showOnly("#login"); err.textContent = e.message; err.hidden = false;
    } finally { btn.disabled = false; btn.textContent = "Sign in"; }
  });

  function signOut(expired) {
    if (S.token && !expired) { track("logout"); endView(); flush(true); api("logout").catch(() => {}); }
    store.del("crm-token"); store.del("crm-cache");
    S.token = null; S.user = null; S.tier = null; S.rows = []; S.todos = null; S.summary = null; S.viewAs = null;
    closeDrawer(); closeModal();
    showOnly("#login");
    if (expired) { $("#loginErr").textContent = "Your session ended. Sign in again."; $("#loginErr").hidden = false; }
  }

  function skeleton() {
    return `<div class="skelbox"><div class="skel" style="width:30%"></div><div class="skel" style="width:60%"></div><div class="skel" style="width:45%"></div><div class="skel" style="width:70%"></div></div>`;
  }

  /* ---------- shell ---------- */
  function pages() {
    const t = S.tier, p = [];
    if (t.todos) p.push(["todos", "To-dos"]);
    if (t.rows !== "summary") p.push(["pipeline", "Pipeline"]);
    p.push(["overview", "Overview"]);
    if (t.admin_page) p.push(["admin", "Admin"]);
    return p;
  }

  function start() {
    showOnly("#shell");
    $("#meBtn").innerHTML = esc(S.user.name.split(" ")[0]) + (S.viewAs ? ` <span class="viewtag">as ${esc(S.tier.label)}</span>` : "") + " ▾";
    renderViewAsBar();
    const ok = pages().map(p => p[0]);
    const fromHash = location.hash.replace("#", "");
    const first = ok.indexOf(fromHash) >= 0 ? fromHash : (ok.indexOf(S.tier.landing) >= 0 ? S.tier.landing : ok[0]);
    go(first);
    clearInterval(S.pollTimer); S.pollTimer = setInterval(maybeCheck, 30000);
    clearInterval(S.stampTimer); S.stampTimer = setInterval(stamp, 30000);
    stamp();
  }

  function renderViewAsBar() {
    const bar = $("#viewAsBar");
    if (!S.viewAs) { bar.hidden = true; bar.innerHTML = ""; return; }
    bar.hidden = false;
    bar.innerHTML = `<span>Viewing the site as <b>${esc(S.tier.label)}</b>. Changes are off until you exit.</span><button type="button" id="exitViewAs">Exit view</button>`;
    $("#exitViewAs").onclick = () => setViewAs(null);
  }
  async function setViewAs(tierId) {
    S.viewAs = tierId; store.del("crm-cache");
    $("#main").innerHTML = skeleton();
    try { await loadBoot(true); track("view_as", { detail: tierId || "exit" }); start(); }
    catch (e) { toast(e.message, "err"); }
  }

  function renderTabs() {
    const overdue = S.todos ? S.todos.items.filter(i => i.status === "open" && i.due && i.due < today()).length : 0;
    $("#tabs").innerHTML = pages().map(([id, label]) =>
      `<button type="button" data-go="${id}" ${S.view === id ? 'aria-current="page"' : ""}>${label}${id === "todos" && overdue ? `<span class="n" title="overdue">${overdue}</span>` : ""}</button>`).join("");
  }
  $("#tabs").addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) go(b.dataset.go); });
  window.addEventListener("hashchange", () => { const h = location.hash.replace("#", ""); if (S.user && h && h !== S.view && pages().some(p => p[0] === h)) go(h); });

  function go(v) {
    S.view = v;
    if (location.hash !== "#" + v) history.replaceState(null, "", "#" + v);
    renderTabs(); render(); beginView(v);
    window.scrollTo(0, 0);
  }
  function render() {
    if (S.view === "todos") return renderTodos();
    if (S.view === "pipeline") return renderPipeline();
    if (S.view === "overview") return renderOverview();
    if (S.view === "admin") return renderAdmin();
  }

  function stamp() {
    const m = S.meta || {};
    const el = $("#updated");
    if (!m.version) { el.textContent = "No data yet"; return; }
    el.innerHTML = `Updated <b>${esc(fmtTime(m.updated_at))}</b>${m.updated_by ? " by " + esc(m.updated_by.split(" ")[0]) : ""} · checked ${esc(ago(Date.now() - S.lastCheck))}`;
    el.title = "Version " + m.version + ". The page checks for a newer version every " + (S.tier.poll_minutes || 10) + " minutes.";
  }

  async function maybeCheck(force) {
    if (!S.token || !S.tier || document.visibilityState === "hidden") return;
    const every = (S.tier.poll_minutes || 10) * 60000;
    if (!force && Date.now() - S.lastCheck < every) { stamp(); return; }
    try {
      const r = await api("meta");
      const prev = S.meta || {};
      S.lastCheck = Date.now();
      const dataChanged = r.meta.version !== prev.version, todosChanged = r.meta.todos_version !== prev.todos_version;
      if ((dataChanged && !Object.keys(S.pending).length) || (todosChanged && S.tier.todos)) {
        await loadBoot();
        if (!S.openId && S.view !== "admin") render();
        renderTabs();
        if (dataChanged) toast("Newer version loaded.");
      } else { S.meta = Object.assign({}, prev, { server_time: r.meta.server_time }); }
      stamp();
    } catch (e) { /* try again next round */ }
  }

  /* ---------- user menu ---------- */
  $("#meBtn").addEventListener("click", () => {
    const tiers = (S.tier.all_tiers || []).filter(t => t.id !== S.user.tier);
    const canViewAs = S.user.tier === "admin" || (!S.viewAs && S.tier.admin_page);
    openModal(`<h2>${esc(S.user.name)}</h2>
      <div class="sub">${esc(S.user.email)} · ${esc(S.tier.all_tiers ? (S.tier.all_tiers.find(t => t.id === S.user.tier) || {}).label || S.user.tier : S.user.tier)}</div>
      ${canViewAs ? `<label class="f">View the site as <select id="viewAsSel"><option value="">Myself</option>${tiers.map(t => `<option value="${esc(t.id)}" ${S.viewAs === t.id ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select></label>` : ""}
      <details><summary class="sub" style="cursor:pointer">Change password</summary>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
        <label class="f">Current password <input id="pwCur" type="password" autocomplete="current-password"></label>
        <label class="f">New password (10+ characters) <input id="pwNew" type="password" autocomplete="new-password"></label>
        <div class="actions"><button class="btn" type="button" id="pwSave">Change password</button><span class="state" id="pwMsg"></span></div></div></details>
      <div class="actions" style="justify-content:space-between"><button class="btn danger" type="button" id="signOut">Sign out</button><button class="btn" type="button" data-close>Close</button></div>`);
    $("#signOut").onclick = () => signOut(false);
    const vs = $("#viewAsSel"); if (vs) vs.onchange = () => { closeModal(); setViewAs(vs.value || null); };
    $("#pwSave").onclick = () => withButton($("#pwSave"), async () => {
      await api("change_password", { current: $("#pwCur").value, next: $("#pwNew").value });
      $("#pwCur").value = ""; $("#pwNew").value = ""; setState($("#pwMsg"), "Password changed.", "ok");
    }, { done: "Changed ✓" }).catch(() => {});
  });

  function openModal(html) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="scrim" data-close></div><div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    root.hidden = false;
    const f = root.querySelector("input:not([type=hidden]),select,textarea,button:not([data-close])"); if (f) f.focus();
    root.querySelector(".modal").addEventListener("keydown", e => {
      if (e.key === "Enter" && e.target.tagName === "INPUT") { const p = root.querySelector(".btn.primary"); if (p) { e.preventDefault(); p.click(); } }
    });
  }
  function closeModal() { const r = $("#modalRoot"); r.hidden = true; r.innerHTML = ""; }
  $("#modalRoot").addEventListener("click", e => { if (e.target.closest("[data-close]")) closeModal(); });

  function confirmBox(title, text, okLabel, onOk) {
    openModal(`<h2>${esc(title)}</h2><p class="sub" style="margin:0">${esc(text)}</p>
      <div class="actions"><button class="btn primary" type="button" id="okBtn">${esc(okLabel)}</button><button class="btn" type="button" data-close>Cancel</button></div>`);
    $("#okBtn").onclick = async () => { closeModal(); await onOk(); };
  }

  /* ---------- pipeline: filters and saved views ---------- */
  function canEdit(group) { return !S.viewAs && S.tier.edit.indexOf(group) >= 0; }
  function canView(group) { return S.tier.view.indexOf(group) >= 0; }
  const viewsPref = () => (S.prefs.pipeline || { views: [], default: null });
  function applyDefaultView() {
    const p = viewsPref();
    const v = p.default && (p.views || []).find(x => x.name === p.default);
    S.pv = Object.assign({}, DEFAULT_VIEW, v ? v.state : {});
    S.activeView = v ? v.name : null;
  }
  function viewState() { const s = {}; Object.keys(DEFAULT_VIEW).forEach(k => { if (S.pv[k] !== DEFAULT_VIEW[k]) s[k] = S.pv[k]; }); return s; }
  function sameState(a, b) { return JSON.stringify(Object.assign({}, DEFAULT_VIEW, a)) === JSON.stringify(Object.assign({}, DEFAULT_VIEW, b)); }
  async function savePrefs(patch) {
    const r = await api("prefs_save", { prefs: patch });
    S.prefs = r.prefs || S.prefs;
  }

  function matches(r) {
    const v = S.pv, q = (v.q || "").toLowerCase();
    if (v.hideNF && r.relationship === "Not a funder") return false;
    if (v.rel && r.relationship !== v.rel) return false;
    if (v.cat && r.category !== v.cat) return false;
    if (v.usOnly && r.ball_in_court !== "Us") return false;
    const st = v.strip;
    if (st === "active" && r.relationship !== "Active – Series A/CLA") return false;
    if (st === "existing" && r.relationship !== "Existing investor") return false;
    if (st === "warm" && r.relationship !== "Warm") return false;
    if (st === "grants" && !String(r.relationship || "").startsWith("Grant")) return false;
    if (st === "us" && r.ball_in_court !== "Us") return false;
    if (st === "overdue" && !(r.next_step_due && r.next_step_due < today())) return false;
    if (q) {
      const hay = [r.org, (r.aliases || []).join(" "), r.type, r.location, r.status_summary, r.next_step, r.notes, r.intro_from, (r.contacts || []).map(c => (c.name || "") + " " + (c.email || "")).join(" ")].join(" ").toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }
  function cmp(a, b) {
    const k = S.pv.sortKey, dir = S.pv.sortDir;
    let x, y;
    if (k === "relationship") { x = relRank(a.relationship); y = relRank(b.relationship); if (x === y) { x = b.last_touch_date || ""; y = a.last_touch_date || ""; } }
    else { x = String(a[k] || ""); y = String(b[k] || ""); if (!x && y) return 1; if (x && !y) return -1; }
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  }

  function renderPipeline() {
    const main = $("#main");
    const showActions = canView("actions");
    if (S.empty) {
      main.innerHTML = `<div class="card"><h1 class="page">No data yet</h1><p class="sub">${S.tier.admin_page ? "Import the starting list from Admin › Import." : "An admin hasn’t loaded the list yet."}</p>${S.tier.admin_page ? `<div><button class="btn primary" type="button" id="goImport">Go to Import</button></div>` : ""}</div>`;
      const b = $("#goImport"); if (b) b.onclick = () => { S.adminTab = "import"; go("admin"); };
      return;
    }
    const c = k => S.rows.filter(k).length;
    const stats = [["active", "Active round", c(r => r.relationship === "Active – Series A/CLA")], ["existing", "Existing investors", c(r => r.relationship === "Existing investor")], ["warm", "Warm", c(r => r.relationship === "Warm")], ["grants", "Grants", c(r => String(r.relationship || "").startsWith("Grant"))]];
    if (showActions) stats.push(["us", "We owe a reply", c(r => r.ball_in_court === "Us")], ["overdue", "Next step overdue", c(r => r.next_step_due && r.next_step_due < today())]);
    const canSaveViews = !S.viewAs;
    main.innerHTML = `
      <div class="head"><div><h1 class="page">Pipeline</h1><div class="sub">${esc(S.tier.label)} view${S.tier.edit.length && !S.viewAs ? " · click a row to edit" : " · read only"}</div></div>
        <div class="actions">${S.tier.can_add && !S.viewAs ? `<button class="btn" type="button" id="addBtn">Add funder</button>` : ""}${S.tier.edit.length ? `<button class="btn" type="button" id="csvBtn">Export CSV</button>` : ""}</div></div>
      <div class="strip">${stats.map(([k, l, n]) => `<button class="stat${(k === "us" || k === "overdue") && n ? " alert" : ""}" type="button" data-f="${k}" aria-pressed="${S.pv.strip === k}"><span class="n">${n}</span><span class="l">${l}</span></button>`).join("")}</div>
      ${canSaveViews ? `<div class="viewsbar"><div class="chips" id="viewChips"></div></div>` : ""}
      <div class="filters">
        <input type="search" id="q" placeholder="Search name, person, note…" aria-label="Search" value="${esc(S.pv.q || "")}">
        <select id="fRel" aria-label="Relationship"><option value="">All relationships</option>${REL.map(r => `<option ${S.pv.rel === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select>
        <select id="fCat" aria-label="Category"><option value="">All categories</option>${CATS.map(r => `<option ${S.pv.cat === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select>
        ${showActions ? `<label class="chk"><input type="checkbox" id="usOnly" ${S.pv.usOnly ? "checked" : ""}> We owe a reply</label>` : ""}
        <label class="chk"><input type="checkbox" id="hideNF" ${S.pv.hideNF ? "checked" : ""}> Hide non-funders</label>
        <span class="count" id="count"></span>
      </div>
      <div class="tablebox"><table class="wide"><thead><tr>
        <th data-k="org">Organisation</th><th data-k="relationship">Relationship</th><th>Status</th><th data-k="last_touch_date">Last touch</th>
        ${showActions ? `<th data-k="next_step_due">Next step</th><th data-k="owner">Owner</th><th data-k="ball_in_court">Ball</th>` : ""}
      </tr></thead><tbody id="rows"></tbody></table></div>`;
    renderViewChips(); renderRows();
    main.querySelector(".strip").onclick = e => { const b = e.target.closest(".stat"); if (!b) return; S.pv.strip = S.pv.strip === b.dataset.f ? "" : b.dataset.f; viewChanged(); renderPipeline(); };
    const q = $("#q");
    q.oninput = () => { S.pv.q = q.value; viewChanged(); renderRows(); clearTimeout(S.qT); S.qT = setTimeout(() => { if (S.pv.q) track("search", { view: "pipeline", detail: S.pv.q.slice(0, 60) }); }, 1500); };
    $("#fRel").onchange = e => { S.pv.rel = e.target.value; viewChanged(); renderRows(); };
    $("#fCat").onchange = e => { S.pv.cat = e.target.value; viewChanged(); renderRows(); };
    if ($("#usOnly")) $("#usOnly").onchange = e => { S.pv.usOnly = e.target.checked; viewChanged(); renderRows(); };
    $("#hideNF").onchange = e => { S.pv.hideNF = e.target.checked; viewChanged(); renderRows(); };
    main.querySelector("thead").onclick = e => { const th = e.target.closest("th[data-k]"); if (!th) return; const k = th.dataset.k; if (S.pv.sortKey === k) S.pv.sortDir *= -1; else { S.pv.sortKey = k; S.pv.sortDir = k === "last_touch_date" ? -1 : 1; } viewChanged(); renderRows(); };
    $("#rows").onclick = e => { const tr = e.target.closest("tr[data-id]"); if (tr) openDrawer(tr.dataset.id); };
    $("#rows").onkeydown = e => { if (e.key === "Enter") { const tr = e.target.closest("tr[data-id]"); if (tr) openDrawer(tr.dataset.id); } };
    if ($("#csvBtn")) $("#csvBtn").onclick = exportCsv;
    if ($("#addBtn")) $("#addBtn").onclick = addFunder;
  }

  function viewChanged() {
    const p = viewsPref(), v = S.activeView && (p.views || []).find(x => x.name === S.activeView);
    if (v && !sameState(v.state, viewState())) S.activeView = null;
    renderViewChips();
  }

  function renderViewChips() {
    const box = $("#viewChips"); if (!box) return;
    const p = viewsPref(), views = p.views || [];
    const isDefault = sameState({}, viewState());
    box.innerHTML = `<button class="chip" type="button" data-view="" aria-pressed="${isDefault && !S.activeView}">All funders${!p.default ? '<span class="star" title="opens by default">★</span>' : ""}</button>`
      + views.map(v => `<button class="chip" type="button" data-view="${esc(v.name)}" aria-pressed="${S.activeView === v.name}">${esc(v.name)}${p.default === v.name ? '<span class="star" title="opens by default">★</span>' : ""}</button>`).join("")
      + `<span class="chip-sep"></span><button class="chip ghost" type="button" id="saveViewBtn">${S.activeView ? "Update or save as…" : "Save this view…"}</button>`
      + ((S.activeView || views.length || p.default) ? `<button class="chip ghost" type="button" id="viewMenuBtn" aria-label="View options">⋯</button>` : "");
    $$("[data-view]", box).forEach(b => b.onclick = () => {
      const name = b.dataset.view;
      if (!name) { S.pv = Object.assign({}, DEFAULT_VIEW); S.activeView = null; }
      else { const v = views.find(x => x.name === name); if (!v) return; S.pv = Object.assign({}, DEFAULT_VIEW, v.state); S.activeView = name; }
      renderPipeline();
    });
    $("#saveViewBtn").onclick = saveViewDialog;
    const mb = $("#viewMenuBtn"); if (mb) mb.onclick = e => viewMenu(e.currentTarget);
  }

  function saveViewDialog() {
    const p = viewsPref(), views = p.views || [];
    openModal(`<h2>${S.activeView ? "Update view" : "Save this view"}</h2>
      <p class="sub" style="margin:0">Saves the current search, filters, sort and the selected tile under a name you can pick from the chips. Only you see your views.</p>
      <label class="f">Name <input id="vwName" type="text" value="${esc(S.activeView || "")}" maxlength="40" placeholder="e.g. My follow-ups"></label>
      <label class="chk"><input type="checkbox" id="vwDefault" ${(S.activeView && p.default === S.activeView) ? "checked" : ""}> Open the pipeline with this view</label>
      <div class="actions"><button class="btn primary" type="button" id="vwSave">Save view</button><button class="btn" type="button" data-close>Cancel</button></div>`);
    $("#vwSave").onclick = () => withButton($("#vwSave"), async () => {
      const name = $("#vwName").value.trim(); if (!name) throw new Error("Give the view a name.");
      const next = views.filter(v => v.name !== name).concat([{ name, state: viewState() }]);
      const patch = { pipeline: { views: next } };
      if ($("#vwDefault").checked) patch.pipeline.default = name; else if (p.default === name) patch.pipeline.default = null;
      await savePrefs(patch);
      S.activeView = name; track("save_view", { view: "pipeline", detail: name });
      closeModal(); renderViewChips(); toast("View saved.");
    }).catch(() => {});
  }

  function viewMenu(anchor) {
    $$(".menu").forEach(m => m.remove());
    const p = viewsPref(), name = S.activeView;
    const m = document.createElement("div"); m.className = "menu";
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.min(r.left + window.scrollX, window.innerWidth - 220) + "px"; m.style.top = (r.bottom + window.scrollY + 4) + "px";
    m.innerHTML = (name ? `<button type="button" data-a="default">${p.default === name ? "Stop opening with this view" : "Open the pipeline with this view"}</button>
      <button type="button" data-a="rename">Rename…</button><hr><button type="button" class="danger" data-a="delete">Delete “${esc(name)}”</button>`
      : `<button type="button" data-a="clearDefault" ${p.default ? "" : "disabled"}>Open the pipeline with all funders</button>`);
    document.body.appendChild(m);
    const close = () => { m.remove(); document.removeEventListener("click", onDoc, true); };
    const onDoc = e => { if (!m.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener("click", onDoc, true), 0);
    m.onclick = async e => {
      const a = e.target.closest("[data-a]"); if (!a) return; close();
      try {
        if (a.dataset.a === "default") { await savePrefs({ pipeline: { default: p.default === name ? null : name } }); toast(p.default === name ? "Default cleared." : "This view now opens by default."); }
        if (a.dataset.a === "clearDefault") { await savePrefs({ pipeline: { default: null } }); toast("The pipeline opens with all funders."); }
        if (a.dataset.a === "delete") { await savePrefs({ pipeline: { views: (p.views || []).filter(v => v.name !== name), default: p.default === name ? null : p.default } }); S.activeView = null; toast("View deleted."); }
        if (a.dataset.a === "rename") {
          openModal(`<h2>Rename view</h2><label class="f">Name <input id="rnName" type="text" value="${esc(name)}" maxlength="40"></label>
            <div class="actions"><button class="btn primary" type="button" id="rnSave">Rename</button><button class="btn" type="button" data-close>Cancel</button></div>`);
          $("#rnSave").onclick = () => withButton($("#rnSave"), async () => {
            const nn = $("#rnName").value.trim(); if (!nn) throw new Error("Give it a name.");
            await savePrefs({ pipeline: { views: (p.views || []).map(v => v.name === name ? { name: nn, state: v.state } : v), default: p.default === name ? nn : p.default } });
            S.activeView = nn; closeModal(); renderViewChips();
          }).catch(() => {});
          return;
        }
        renderViewChips();
      } catch (err) { toast(err.message, "err"); }
    };
  }

  function renderRows() {
    const showActions = canView("actions");
    const list = S.rows.filter(matches).sort(cmp);
    $("#count").textContent = `${list.length} of ${S.rows.length}`;
    const cols = showActions ? 7 : 4;
    $("#rows").innerHTML = list.length ? list.map(r => {
      const od = r.next_step_due && r.next_step_due < today();
      return `<tr class="click" tabindex="0" data-id="${esc(r.id)}">
        <td class="org">${esc(r.org)}<span class="t">${esc([r.type, r.location].filter(Boolean).join(" · "))}</span></td>
        <td><span class="pill ${relClass(r.relationship)}">${esc(r.relationship || "—")}</span>${r.confidence ? `<div class="conf">${esc(r.confidence)}${r.tier === "Imported" ? " · imported" : ""}</div>` : ""}</td>
        <td class="sum"><div class="clamp">${esc(r.status_summary || "")}</div></td>
        <td class="date">${esc(r.last_touch_date || "—")}<div class="conf">${esc(r.last_touch_channel || "")}</div></td>
        ${showActions ? `<td class="sum"><div class="clamp">${esc(r.next_step || "")}</div>${r.next_step_due ? `<div class="mono ${od ? "overdue" : "conf"}">due ${esc(r.next_step_due)}</div>` : ""}</td>
        <td>${esc(r.owner || "")}</td><td class="ball ${r.ball_in_court === "Us" ? "us" : "them"}">${r.ball_in_court === "Us" ? "Us" : r.ball_in_court === "Them" ? "Them" : ""}</td>` : ""}
      </tr>`;
    }).join("") : `<tr><td colspan="${cols}" class="empty">Nothing matches these filters.</td></tr>`;
  }

  /* ---------- drawer ---------- */
  const FIELDS = {
    core: [["org", "Name", "text", "wide"], ["relationship", "Relationship", REL], ["category", "Category", CATS], ["type", "Type", "text"], ["location", "Location", "text"], ["ticket_size", "Ticket size", "text"], ["stage_focus", "Stage focus", "text"], ["lead_follow", "Lead / follow", "text"], ["rounds", "Rounds (comma separated)", "list", "wide"], ["aliases", "Other names (comma separated)", "list", "wide"]],
    status: [["status_summary", "Status", "area", "wide"], ["last_touch_date", "Last touch", "date"], ["last_touch_channel", "Channel", CHANNELS], ["last_touch_note", "Last touch note", "text", "wide"]],
    actions: [["next_step", "Next step", "text", "wide"], ["next_step_due", "Due", "date"], ["owner", "Owner", OWNERS], ["ball_in_court", "Ball in court", BALL]],
    contacts: [["contacts", "People — one per line: Name | role | email", "contacts", "wide"]],
    internal: [["notes", "Notes", "area", "wide"], ["objections", "Objections", "area", "wide"], ["intro_from", "Intro from", "text"], ["first_contact_date", "First contact", "date"], ["confidence", "Confidence", CONF]],
    sources: [["sources", "Sources — one per line: type | label | link or ref | date", "sources", "wide"]],
  };
  const GROUP_TITLES = { core: "Organisation", status: "Status", actions: "Next step", contacts: "People", internal: "Internal", sources: "Sources" };

  function fieldValue(r, f, kind) {
    const v = r[f];
    if (kind === "list") return (v || []).join(", ");
    if (kind === "contacts") return (v || []).filter(c => c && (c.name || c.email)).map(c => [c.name || "", c.role || "", c.email || ""].join(" | ")).join("\n");
    if (kind === "sources") return (v || []).map(s => [s.type || "", s.label || "", s.ref || "", s.date || ""].join(" | ")).join("\n");
    return v == null ? "" : v;
  }
  function parseField(kind, text) {
    if (kind === "list") return text.split(",").map(s => s.trim()).filter(Boolean);
    if (kind === "contacts") return text.split("\n").map(l => l.split("|").map(s => s.trim())).filter(p => p[0] || p[2]).map(p => ({ name: p[0] || "", role: p[1] || "", email: p[2] || "" }));
    if (kind === "sources") return text.split("\n").map(l => l.split("|").map(s => s.trim())).filter(p => p[1] || p[2]).map(p => ({ type: p[0] || "note", label: p[1] || "", ref: p[2] || "", date: p[3] || null }));
    return text === "" ? null : text;
  }
  function srcLink(s) {
    const ref = s.ref || "", label = esc(s.label || ref);
    if (/^https?:\/\//.test(ref)) return `<a href="${esc(ref)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    return `${label} <span class="ref">${esc(ref)}</span>`;
  }

  function openDrawer(id) {
    const r = S.rows.find(x => x.id === id); if (!r) return;
    S.openId = id;
    track("open_record", { view: S.view, target: id });
    const groupHtml = g => {
      if (!canView(g)) return "";
      const edit = canEdit(g);
      if (!edit) {
        if (g === "contacts") { const cs = (r.contacts || []).filter(c => c && (c.name || c.email)); return `<div class="secbox"><h3>People</h3>${cs.length ? `<dl class="kv">${cs.map(c => `<dt>${esc(c.name || "—")}</dt><dd>${esc([c.role, c.email].filter(Boolean).join(" · ") || "—")}</dd>`).join("")}</dl>` : `<div class="sub">No contacts recorded.</div>`}</div>`; }
        if (g === "sources") { const ss = r.sources || []; return `<div class="secbox"><h3>Sources</h3>${ss.length ? `<ul class="src">${ss.map(s => `<li><span class="tag">${esc(s.type || "")}</span><span>${srcLink(s)} <span class="ref">${esc(s.date || "")}</span></span></li>`).join("")}</ul>` : `<div class="sub">None.</div>`}</div>`; }
        return `<div class="secbox"><h3>${GROUP_TITLES[g]}</h3><dl class="kv">${FIELDS[g].filter(([f]) => f !== "org").map(([f, label, kind]) => `<dt>${esc(label.split(" (")[0].split(" —")[0])}</dt><dd>${esc(fieldValue(r, f, kind) || "—")}</dd>`).join("")}</dl></div>`;
      }
      const inputs = FIELDS[g].map(([f, label, kind, wide]) => {
        const v = fieldValue(r, f, kind);
        let ctl;
        if (Array.isArray(kind)) { const opts = kind.indexOf(v) >= 0 || v === "" ? kind : kind.concat([v]); ctl = `<select data-f="${f}" data-kind="select">${opts.map(o => `<option value="${esc(o)}" ${o === v ? "selected" : ""}>${esc(o || "—")}</option>`).join("")}</select>`; }
        else if (kind === "area" || kind === "contacts" || kind === "sources") ctl = `<textarea data-f="${f}" data-kind="${kind}">${esc(v)}</textarea>`;
        else ctl = `<input data-f="${f}" data-kind="${kind}" type="${kind === "date" ? "date" : "text"}" value="${esc(v)}">`;
        return `<label class="f ${wide || ""}">${esc(label)} ${ctl}</label>`;
      }).join("");
      let extra = "";
      if (g === "sources" && (r.sources || []).some(s => /^https?:\/\//.test(s.ref || ""))) extra = `<ul class="src" style="margin-top:6px">${r.sources.filter(s => /^https?:\/\//.test(s.ref || "")).map(s => `<li><span class="tag">${esc(s.type || "")}</span><span>${srcLink(s)}</span></li>`).join("")}</ul>`;
      return `<div class="secbox"><h3>${GROUP_TITLES[g]}</h3><div class="grid2">${inputs}</div>${extra}</div>`;
    };
    const conflicts = canView("internal") && (r.conflicts || []).length ? `<div class="secbox"><h3>Sources disagree</h3><ul class="conflicts">${r.conflicts.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>` : "";
    const root = $("#drawerRoot");
    root.innerHTML = `<div class="scrim" data-close></div>
      <aside class="drawer" role="dialog" aria-label="${esc(r.org)}">
        <div class="dhead"><div><h2>${esc(r.org)}</h2><div class="sub">${esc([r.category, r.type, r.location].filter(Boolean).join(" · "))}</div>
          ${r.updated_by ? `<div class="conf">Last changed ${esc(fmtTime(r.updated_at))} by ${esc(r.updated_by)}</div>` : ""}</div>
          <button class="btn" type="button" data-close>Close</button></div>
        <div class="dbody">
          <div class="actions">${canEdit("status") ? `<button class="btn primary small" type="button" id="touchBtn">Log a touch today</button>` : ""}<span class="state" id="saveState">${S.tier.edit.length && !S.viewAs ? "Changes save as you go" : ""}</span></div>
          ${["actions", "status", "core", "contacts", "internal"].map(groupHtml).join("")}
          ${conflicts}
          ${groupHtml("sources")}
          ${S.tier.can_delete && !S.viewAs ? `<div><button class="btn danger small" type="button" id="delBtn">Remove this funder</button></div>` : ""}
        </div>
      </aside>`;
    root.hidden = false;
    $$("[data-f]", root).forEach(el => el.addEventListener("change", () => queueEdit(id, el.dataset.f, parseField(el.dataset.kind, el.value))));
    if ($("#touchBtn")) $("#touchBtn").onclick = () => {
      const d = today(); const inp = root.querySelector('[data-f="last_touch_date"]'); if (inp) inp.value = d;
      const ch = root.querySelector('[data-f="last_touch_channel"]'); if (ch) ch.value = "Logged";
      queueEdit(id, "last_touch_date", d); queueEdit(id, "last_touch_channel", "Logged");
    };
    if ($("#delBtn")) $("#delBtn").onclick = () => confirmBox(`Remove ${r.org}?`, "It disappears from the list. Older versions in Drive still have it, and you can restore one from Admin › Versions.", "Remove", async () => {
      await flushEdits();
      try { const res = await api("delete_row", { id }); S.meta = res.meta; S.rows = S.rows.filter(x => x.id !== id); writeCache(); closeDrawer(); render(); stamp(); toast("Removed."); } catch (e) { toast(e.message, "err"); }
    });
    const closeBtn = root.querySelector(".drawer [data-close]"); if (closeBtn) closeBtn.focus();
  }
  function closeDrawer() { S.openId = null; const r = $("#drawerRoot"); r.hidden = true; r.innerHTML = ""; }
  $("#drawerRoot").addEventListener("click", e => { if (e.target.closest("[data-close]")) { flushEdits(); closeDrawer(); } });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("#modalRoot").hidden) closeModal(); else if (S.openId) { flushEdits(); closeDrawer(); } } });

  function queueEdit(id, field, value) {
    const r = S.rows.find(x => x.id === id); if (r) r[field] = value;
    S.pending[id] = S.pending[id] || {}; S.pending[id][field] = value;
    setState($("#saveState"), "Saving…", "busy");
    clearTimeout(S.saveTimer); S.saveTimer = setTimeout(flushEdits, 900);
  }
  let saving = Promise.resolve();
  function flushEdits() {
    clearTimeout(S.saveTimer);
    const ids = Object.keys(S.pending); if (!ids.length) return saving;
    const patches = ids.map(id => ({ id, fields: S.pending[id] })); S.pending = {};
    saving = saving.then(async () => {
      try {
        const res = await api("update", { patches });
        (res.rows || []).forEach(nr => { const i = S.rows.findIndex(x => x.id === nr.id); if (i >= 0) S.rows[i] = nr; });
        S.meta = res.meta; writeCache(); stamp();
        setState($("#saveState"), "Saved ✓", "ok");
        if (S.view === "pipeline" && $("#rows")) renderRows();
      } catch (e) {
        setState($("#saveState"), "Not saved: " + e.message, "err");
        if (e.code !== "forbidden") patches.forEach(p => { S.pending[p.id] = Object.assign(p.fields, S.pending[p.id] || {}); });
      }
    });
    return saving;
  }

  function addFunder() {
    openModal(`<h2>Add funder</h2>
      <label class="f">Name <input id="newOrg" type="text"></label>
      <label class="f">Category <select id="newCat">${CATS.map(c => `<option>${c}</option>`).join("")}</select></label>
      <div class="actions"><button class="btn primary" type="button" id="newSave">Add</button><button class="btn" type="button" data-close>Cancel</button></div>`);
    $("#newSave").onclick = () => withButton($("#newSave"), async () => {
      const org = $("#newOrg").value.trim(); if (!org) throw new Error("Give it a name.");
      const r = await api("add", { row: { org, category: $("#newCat").value } });
      S.rows.push(r.row); S.meta = r.meta; writeCache(); stamp(); closeModal(); render(); openDrawer(r.row.id); toast("Added.");
    }, { busy: "Adding…", done: "Added ✓" }).catch(() => {});
  }

  function exportCsv() {
    const cols = ["org", "category", "type", "location", "relationship", "status_summary", "last_touch_date", "last_touch_note", "ball_in_court", "next_step", "next_step_due", "owner", "ticket_size", "stage_focus", "lead_follow", "rounds", "objections", "intro_from", "notes", "contacts", "confidence"];
    const visible = cols.filter(c => S.rows.some(r => c in r));
    const cell = v => { if (Array.isArray(v)) v = v.map(x => x && typeof x === "object" ? Object.values(x).filter(Boolean).join(" | ") : x).join("; "); v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = S.rows.filter(matches).sort(cmp);
    const csv = [visible.join(",")].concat(rows.map(r => visible.map(c => cell(r[c])).join(","))).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `brineworks-funders-${today()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    track("export", { view: "pipeline", detail: rows.length + " rows" });
    toast(`Exported ${rows.length} rows.`);
  }

  /* ---------- to-dos ---------- */
  function mine(i) {
    const al = OWNER_ALIASES[S.user.id] || [S.user.name.split(" ")[0]];
    return al.some(a => String(i.owner || "").toLowerCase() === a.toLowerCase());
  }
  function todoFilterFn(i) {
    const f = S.todoFilter;
    if (f === "mine") return mine(i);
    if (f === "overdue") return i.due && i.due < today();
    if (f === "week") return i.due && i.due <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    if (f.indexOf("owner:") === 0) return (i.owner || "Unassigned") === f.slice(6);
    return true;
  }
  function renderTodos() {
    const main = $("#main");
    if (!S.todos) { main.innerHTML = `<div class="empty">To-dos aren’t available for this view.</div>`; return; }
    const items = S.todos.items || [];
    const t = today();
    const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const allOpen = items.filter(i => i.status === "open");
    const owners = [...new Set(allOpen.map(i => i.owner || "Unassigned"))].sort();
    const cnt = fn => allOpen.filter(fn).length;
    const chips = [
      ["all", "All", allOpen.length, false], ["mine", "Mine", cnt(mine), false],
      ["overdue", "Overdue", cnt(i => i.due && i.due < t), true], ["week", "Due this week", cnt(i => i.due && i.due <= in7), false],
    ];
    const open = allOpen.filter(todoFilterFn);
    const groups = [["Overdue", open.filter(i => i.due && i.due < t)], ["Due this week", open.filter(i => i.due && i.due >= t && i.due <= in7)], ["Later", open.filter(i => i.due && i.due > in7)], ["No date", open.filter(i => !i.due)]];
    const done = items.filter(i => i.status !== "open" && todoFilterFn(i)).sort((a, b) => (b.done_at || "").localeCompare(a.done_at || ""));
    const ls = S.todos.last_scan || {};
    const ro = !!S.viewAs;
    main.innerHTML = `
      <div class="todo-top">
        <div class="head"><div><h1 class="page">What we owe funders</h1><div class="sub">${open.length} open${S.todoFilter !== "all" ? " in this view" : ""}${chips[2][2] ? ` · <span class="overdue">${chips[2][2]} overdue</span>` : ""}</div></div>
          <div class="actions"><label class="chk"><input type="checkbox" id="hideDone" ${S.hideDone ? "checked" : ""}> Hide done</label><button class="btn" type="button" id="todoRefresh">Refresh</button></div></div>
        <div class="chips" id="todoChips">
          ${chips.map(([k, l, n, late]) => `<button class="chip${late && n ? " late" : ""}" type="button" data-tf="${k}" aria-pressed="${S.todoFilter === k}">${l}<span class="n">${n}</span></button>`).join("")}
          <span class="chip-sep"></span>
          ${owners.map(o => `<button class="chip" type="button" data-tf="owner:${esc(o)}" aria-pressed="${S.todoFilter === "owner:" + o}">${esc(o)}<span class="n">${cnt(i => (i.owner || "Unassigned") === o)}</span></button>`).join("")}
        </div>
      </div>
      <div class="todo-cols">
        <div class="group">
          ${groups.filter(g => g[1].length).map(([label, list]) => `<h2 class="sec">${label}</h2><div class="list">${list.map(i => todoHtml(i, ro)).join("")}</div>`).join("") || `<div class="card empty">Nothing open${S.todoFilter !== "all" ? " in this view" : ""}. ${S.todoFilter !== "all" ? "" : "Scans run morning and late afternoon."}</div>`}
          ${done.length && !S.hideDone ? `<details><summary class="sec" style="cursor:pointer;margin-top:8px">Done or dismissed in the last 14 days (${done.length})</summary><div class="list" style="margin-top:8px">${done.map(i => todoHtml(i, ro)).join("")}</div></details>` : ""}
        </div>
        <div class="group">
          ${ro ? "" : `<div class="card"><h2 class="sec">Add a to-do</h2>
            <div class="addrow"><input id="newTodo" type="text" placeholder="What needs doing? Press Enter to add"><input id="newTodoDue" type="date" style="flex:0 0 150px" aria-label="Due"></div>
            <div class="addrow"><select class="sel" id="newTodoOwner" aria-label="Owner">${OWNERS.filter(Boolean).map(o => `<option ${o === (OWNER_ALIASES[S.user.id] || [""])[0] ? "selected" : ""}>${o}</option>`).join("")}</select><button class="btn primary" type="button" id="newTodoAdd">Add</button></div>
          </div>`}
          <div class="card"><h2 class="sec">Where these come from</h2>
            <p class="note" style="margin:0">Only follow-ups we owe investors, VCs, family offices and public funders we are in contact with. Scheduled Claude scans (Gudfinnur's at 07:57/16:57, Olga's at 08:27/17:27) read new Krisp meetings and email, drop a file in the Drive <code>inbox</code> folder, and the site merges it on the next load. Ticking something off here is kept on later scans.</p>
            <dl class="kv"><dt>Last scan</dt><dd>${esc(fmtTime(ls.finished_at))}</dd>
              <dt>Krisp up to</dt><dd>${esc(fmtTime(ls.krisp))}</dd><dt>Email up to</dt><dd>${esc(fmtTime(ls.email))}</dd>
              <dt>List saved</dt><dd>${esc(fmtTime(S.todos.saved_at))}${S.todos.saved_by ? " by " + esc(S.todos.saved_by) : ""}</dd>
              ${S.todos.note ? `<dt>Note</dt><dd>${esc(S.todos.note)}</dd>` : ""}</dl>
          </div>
        </div>
      </div>`;
    $("#todoChips").onclick = e => { const b = e.target.closest("[data-tf]"); if (!b) return; S.todoFilter = b.dataset.tf; renderTodos(); saveTodoPrefs(); };
    $("#hideDone").onchange = e => { S.hideDone = e.target.checked; renderTodos(); saveTodoPrefs(); };
    $("#todoRefresh").onclick = async () => { const b = $("#todoRefresh"); await withButton(b, async () => { await loadBoot(true); renderTabs(); renderTodos(); }, { busy: "Checking…", done: "Up to date ✓" }).catch(() => {}); };
    const nt = $("#newTodo");
    if (nt) {
      const add = () => withButton($("#newTodoAdd"), async () => {
        const title = nt.value.trim(); if (!title) throw new Error("Write the to-do first.");
        const r = await api("todo_add", { item: { title, due: $("#newTodoDue").value || null, owner: $("#newTodoOwner").value } });
        S.todos.items.unshift(r.item); renderTabs(); renderTodos(); toast("Added.");
      }, { busy: "Adding…", done: "Added ✓" }).catch(() => {});
      $("#newTodoAdd").onclick = add;
      nt.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); add(); } };
    }
    $$(".todo input[type=checkbox]", main).forEach(cb => cb.onchange = () => setTodo(cb.dataset.id, { status: cb.checked ? "done" : "open" }));
    $$("[data-dismiss]", main).forEach(b => b.onclick = () => setTodo(b.dataset.dismiss, { status: "dismissed" }));
    $$("[data-org]", main).forEach(b => b.onclick = () => { if (S.rows.some(r => r.id === b.dataset.org)) openDrawer(b.dataset.org); });
    $$("[data-owner]", main).forEach(s => s.onchange = () => setTodo(s.dataset.owner, { owner: s.value }));
  }
  let todoPrefT = null;
  function saveTodoPrefs() { clearTimeout(todoPrefT); todoPrefT = setTimeout(() => { if (!S.viewAs) savePrefs({ todos: { filter: S.todoFilter, hide_done: S.hideDone } }).catch(() => {}); }, 800); }

  function todoHtml(i, ro) {
    const late = i.status === "open" && i.due && i.due < today();
    const src = i.source || null;
    const srcHtml = src ? (/^https?:\/\//.test(src.ref || "") ? `<a href="${esc(src.ref)}" target="_blank" rel="noopener noreferrer">${esc(src.label || "source")}</a>` : `<span title="${esc(src.ref || "")}">${esc((src.type ? src.type + ": " : "") + (src.label || src.ref || ""))}</span>`) : "";
    const orgHtml = i.org ? (i.org_id && S.rows.some(r => r.id === i.org_id) ? `<button class="linklike" type="button" data-org="${esc(i.org_id)}">${esc(i.org)}</button>` : `<span>${esc(i.org)}</span>`) : "";
    const ownerOpts = OWNERS.filter(Boolean).indexOf(i.owner) >= 0 || !i.owner ? OWNERS : OWNERS.concat([i.owner]);
    return `<div class="todo ${i.status !== "open" ? "done" : ""}">
      <input type="checkbox" data-id="${esc(i.id)}" ${i.status !== "open" ? "checked" : ""} ${ro ? "disabled" : ""} aria-label="Done">
      <div><div class="title">${esc(i.title)}</div>
        <div class="meta">${orgHtml}${srcHtml}${i.scanned_by ? `<span class="conf" title="Added by a scheduled scan">${esc(i.scanned_by.replace(/ scan$/i, ""))} scan</span>` : ""}${i.status !== "open" && i.done_by ? `<span>${i.status === "dismissed" ? "Dismissed" : "Done"} by ${esc(i.done_by.split(" ")[0])}</span>` : ""}</div>
        ${i.detail ? `<div class="detail clamp">${esc(i.detail)}</div>` : ""}</div>
      <div class="side">${i.due ? `<span class="due ${late ? "late" : ""}">${esc(i.due)}</span>` : ""}
        ${i.status === "open" && !ro ? `<select class="sel" style="padding:2px 4px;font-size:12px" data-owner="${esc(i.id)}" aria-label="Owner">${ownerOpts.map(o => `<option value="${esc(o)}" ${o === (i.owner || "") ? "selected" : ""}>${esc(o || "—")}</option>`).join("")}</select>
        <button class="linklike" type="button" data-dismiss="${esc(i.id)}">Dismiss</button>` : (i.status === "open" ? `<span class="conf">${esc(i.owner || "")}</span>` : "")}</div>
    </div>`;
  }
  async function setTodo(id, fields) {
    const item = S.todos.items.find(i => i.id === id);
    const before = Object.assign({}, item);
    Object.assign(item, fields, fields.status ? { done_at: fields.status === "open" ? null : new Date().toISOString(), done_by: fields.status === "open" ? null : S.user.name } : {});
    renderTabs(); renderTodos();
    try { const r = await api("todo_update", { id, fields }); Object.assign(item, r.item); }
    catch (e) { Object.assign(item, before); toast(e.message, "err"); renderTabs(); renderTodos(); }
  }

  /* ---------- overview ---------- */
  function renderOverview() {
    const main = $("#main");
    let counts = {}, existing = [], grants = [], activeCount, warmCount;
    if (S.summary) {
      counts = S.summary.counts; existing = S.summary.existing_investors; grants = S.summary.grants; activeCount = S.summary.active_count; warmCount = S.summary.warm_count;
    } else {
      S.rows.forEach(r => { counts[r.relationship || "Unknown"] = (counts[r.relationship || "Unknown"] || 0) + 1; });
      existing = S.rows.filter(r => r.relationship === "Existing investor").map(r => ({ org: r.org, type: r.type, location: r.location }));
      grants = S.rows.filter(r => /^Grant (awarded|applied)/.test(r.relationship || "")).map(r => ({ org: r.org, relationship: r.relationship }));
      activeCount = counts["Active – Series A/CLA"] || 0; warmCount = counts["Warm"] || 0;
    }
    if (S.empty) { main.innerHTML = `<div class="card empty">No data yet.</div>`; return; }
    const order = REL.filter(r => counts[r] && r !== "Not a funder");
    const max = Math.max(1, ...order.map(r => counts[r]));
    main.innerHTML = `
      <div class="head"><div><h1 class="page">Fundraising overview</h1><div class="sub">Brineworks CLA and Series A, ${esc(new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" }))}</div></div></div>
      <div class="strip">
        <div class="stat"><span class="n">${activeCount}</span><span class="l">In active talks</span></div>
        <div class="stat"><span class="n">${existing.length}</span><span class="l">Existing investors</span></div>
        <div class="stat"><span class="n">${warmCount}</span><span class="l">Warm</span></div>
        <div class="stat"><span class="n">${grants.length}</span><span class="l">Grants awarded or applied</span></div>
      </div>
      <div class="card"><h2 class="sec">Funders by stage</h2>
        <div class="bars">${order.map(r => `<div class="barrow"><span>${esc(r)}</span><div class="track"><div class="fill" style="width:${(counts[r] / max * 100).toFixed(1)}%"></div></div><span class="mono">${counts[r]}</span></div>`).join("")}</div>
      </div>
      <div class="cols2">
        <div class="card"><h2 class="sec">Existing investors</h2><ul class="plain">${existing.map(e => `<li><span>${esc(e.org)}</span><span class="conf">${esc([e.type, e.location].filter(Boolean).join(" · "))}</span></li>`).join("") || "<li>None listed</li>"}</ul></div>
        <div class="card"><h2 class="sec">Grants and public funding</h2><ul class="plain">${grants.map(g => `<li><span>${esc(g.org)}</span><span class="pill ${relClass(g.relationship)}">${esc(g.relationship.replace("Grant ", ""))}</span></li>`).join("") || "<li>None listed</li>"}</ul></div>
      </div>`;
  }

  /* ---------- admin ---------- */
  const ADMIN_TABS = [["users", "Users"], ["permissions", "Permissions"], ["activity", "Activity"], ["versions", "Versions"], ["import", "Import"]];
  const AC = {}; // per-session admin cache so tabs open instantly the second time
  function renderAdmin() {
    const main = $("#main");
    S.adminTab = S.adminTab || "users";
    main.innerHTML = `<div class="head"><div><h1 class="page">Admin</h1><div class="sub">Users, what each tier can do, activity and saved versions</div></div></div>
      <nav class="subtabs">${ADMIN_TABS.map(([k, l]) => `<button type="button" data-t="${k}" aria-current="${S.adminTab === k}">${l}</button>`).join("")}</nav>
      <div id="adminBody">${skeleton()}</div>`;
    main.querySelector(".subtabs").onclick = e => { const b = e.target.closest("[data-t]"); if (b) { S.adminTab = b.dataset.t; renderAdmin(); track("view", { view: "admin/" + b.dataset.t }); } };
    ({ users: adminUsers, permissions: adminPerms, activity: adminActivity, versions: adminVersions, import: adminImport })[S.adminTab]();
  }
  async function cached(key, fn, force) {
    if (!force && AC[key]) return AC[key];
    const v = await fn(); AC[key] = v; return v;
  }

  async function adminUsers(force) {
    const body = $("#adminBody");
    let d; try { d = await cached("users", () => api("users_list"), force); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (S.adminTab !== "users") return;
    const tierOpts = sel => d.tiers.map(t => `<option value="${t.id}" ${t.id === sel ? "selected" : ""}>${esc(t.label)}</option>`).join("");
    body.innerHTML = `<div class="row-between"><p class="note" style="margin:0">Change a tier and it applies on that person’s next page load. Resetting a password signs them out.</p><button class="btn" type="button" id="addUser">Add user</button></div>
      <div class="tablebox"><table><thead><tr><th>Name</th><th>Email</th><th>Tier</th><th>Active</th><th>Last sign-in</th><th></th><th></th></tr></thead><tbody>
      ${d.users.map(u => `<tr data-u="${esc(u.id)}"><td><b>${esc(u.name)}</b></td><td class="mono">${esc(u.email)}</td>
        <td><select class="sel" data-k="tier" ${u.id === S.user.id ? "disabled" : ""}>${tierOpts(u.tier)}</select></td>
        <td><input type="checkbox" data-k="active" ${u.active ? "checked" : ""} ${u.id === S.user.id ? "disabled" : ""} aria-label="Active"></td>
        <td class="mono">${esc(fmtTime(u.last_login))}</td>
        <td><button class="btn small" type="button" data-pw>Set password</button></td><td><span class="state" data-st></span></td></tr>`).join("")}
      </tbody></table></div>`;
    const save = async (tr, u, extra) => {
      const st = tr.querySelector("[data-st]"); setState(st, "Saving…", "busy");
      try { const r = await api("user_save", { user: Object.assign({ id: u.id, name: u.name, email: u.email, tier: u.tier, active: u.active }, extra) }); d.users = r.users; AC.users = d; setState(st, "Saved ✓", "ok"); setTimeout(() => setState(st, ""), 2000); return true; }
      catch (e) { setState(st, e.message, "err"); return false; }
    };
    $$("tr[data-u]", body).forEach(tr => {
      const u = () => d.users.find(x => x.id === tr.dataset.u);
      tr.querySelector('[data-k="tier"]').onchange = e => save(tr, u(), { tier: e.target.value });
      tr.querySelector('[data-k="active"]').onchange = e => save(tr, u(), { active: e.target.checked });
      tr.querySelector("[data-pw]").onclick = () => {
        const sug = suggestPassword();
        openModal(`<h2>New password for ${esc(u().name)}</h2>
          <label class="f">Password <input id="npw" type="text" value="${esc(sug)}"></label>
          <p class="note" style="margin:0">Copy it before saving and send it to them yourself. They’ll be signed out everywhere.</p>
          <div class="actions"><button class="btn primary" type="button" id="npwSave">Save password</button><button class="btn" type="button" id="npwCopy">Copy</button><button class="btn" type="button" data-close>Cancel</button></div>`);
        $("#npwCopy").onclick = () => copy($("#npw").value);
        $("#npwSave").onclick = () => withButton($("#npwSave"), async () => { if (!(await save(tr, u(), { password: $("#npw").value }))) throw new Error("Not saved."); closeModal(); toast("Password set."); }).catch(() => {});
      };
    });
    $("#addUser").onclick = () => {
      const sug = suggestPassword();
      openModal(`<h2>Add user</h2>
        <label class="f">Name <input id="nuName" type="text"></label>
        <label class="f">Email <input id="nuEmail" type="email"></label>
        <label class="f">Tier <select id="nuTier">${tierOpts("investor")}</select></label>
        <label class="f">Password <input id="nuPw" type="text" value="${esc(sug)}"></label>
        <div class="actions"><button class="btn primary" type="button" id="nuSave">Add user</button><button class="btn" type="button" id="nuCopy">Copy password</button><button class="btn" type="button" data-close>Cancel</button></div>`);
      $("#nuCopy").onclick = () => copy($("#nuPw").value);
      $("#nuSave").onclick = () => withButton($("#nuSave"), async () => {
        await api("user_save", { user: { name: $("#nuName").value.trim(), email: $("#nuEmail").value.trim(), tier: $("#nuTier").value, active: true, password: $("#nuPw").value } });
        closeModal(); toast("User added."); adminUsers(true);
      }, { busy: "Adding…", done: "Added ✓" }).catch(() => {});
    };
  }
  function suggestPassword() {
    const w = "anode brine kelp fjord ridge solar ember quartz harbor tundra cobalt lagoon basalt glacier ozone cedar falcon delta pylon amber nimbus orbit prism saffron tidal walrus lumen magma pebble raven sierra thistle velvet willow zinc alder birch coral dune geyser helix iris jasper krill lotus".split(" ");
    const a = new Uint32Array(4); crypto.getRandomValues(a);
    return [w[a[0] % w.length], w[a[1] % w.length], w[a[2] % w.length]].join("-") + "-" + (10 + a[3] % 90);
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast("Copied."), () => toast("Select the text and copy it."));
    else toast("Select the text and copy it.");
  }

  async function adminPerms(force) {
    const body = $("#adminBody");
    let cfg; try { cfg = (await cached("config", () => api("config_get"), force)).config; } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (S.adminTab !== "permissions") return;
    cfg = JSON.parse(JSON.stringify(cfg));
    const tiers = cfg.tier_order;
    const groups = Object.keys(cfg.field_groups);
    const locked = t => t === "admin";
    const cb = (t, key, checked, extra) => `<input type="checkbox" data-t="${t}" data-k="${key}" ${checked ? "checked" : ""} ${locked(t) ? "disabled" : ""} ${extra || ""}>`;
    body.innerHTML = `<p class="note" style="margin:0">View means the fields reach that person’s browser at all; edit means they can change them. Full admin always has everything. Use <b>View the site as</b> in your user menu to check what a tier sees.</p>
      <div class="tablebox"><table class="matrix"><thead><tr><th>What</th>${tiers.map(t => `<th>${esc(cfg.tiers[t].label)}</th>`).join("")}</tr></thead><tbody>
      <tr><td>Which funders they see</td>${tiers.map(t => `<td><select class="sel" data-t="${t}" data-k="rows" ${locked(t) ? "disabled" : ""}>
        ${[["all", "All"], ["pipeline", "Live pipeline only"], ["summary", "Summary numbers only"]].map(([v, l]) => `<option value="${v}" ${cfg.tiers[t].rows === v ? "selected" : ""}>${l}</option>`).join("")}</select></td>`).join("")}</tr>
      ${groups.map(g => `<tr><td>${esc(cfg.field_groups[g].label)}</td>${tiers.map(t => `<td><div class="cellpair">
        <label>${cb(t, "view:" + g, cfg.tiers[t].view.indexOf(g) >= 0, g === "core" ? "disabled" : "")} view</label>
        <label>${cb(t, "edit:" + g, cfg.tiers[t].edit.indexOf(g) >= 0)} edit</label></div></td>`).join("")}</tr>`).join("")}
      <tr><td>Add funders</td>${tiers.map(t => `<td>${cb(t, "can_add", cfg.tiers[t].can_add)}</td>`).join("")}</tr>
      <tr><td>Remove funders</td>${tiers.map(t => `<td>${cb(t, "can_delete", cfg.tiers[t].can_delete)}</td>`).join("")}</tr>
      <tr><td>To-do dashboard</td>${tiers.map(t => `<td>${cb(t, "todos", cfg.tiers[t].todos)}</td>`).join("")}</tr>
      <tr><td>Admin page</td>${tiers.map(t => `<td>${cb(t, "admin_page", cfg.tiers[t].admin_page)}</td>`).join("")}</tr>
      <tr><td>Opens on</td>${tiers.map(t => `<td><select class="sel" data-t="${t}" data-k="landing" ${locked(t) ? "disabled" : ""}>
        ${[["todos", "To-dos"], ["pipeline", "Pipeline"], ["summary", "Overview"]].map(([v, l]) => `<option value="${v}" ${cfg.tiers[t].landing === v ? "selected" : ""}>${l}</option>`).join("")}</select></td>`).join("")}</tr>
      </tbody></table></div>
      <div class="card"><h2 class="sec">Live pipeline means these stages</h2>
        <div class="actions">${REL.map(r => `<label class="chk"><input type="checkbox" data-pipe="${esc(r)}" ${cfg.pipeline_relationships.indexOf(r) >= 0 ? "checked" : ""}> ${esc(r)}</label>`).join("")}</div></div>
      <div class="actions"><button class="btn primary" type="button" id="permSave">Save permissions</button><span class="state" id="permMsg"></span></div>`;
    const markDirty = () => setState($("#permMsg"), "Unsaved changes", "");
    $$("input,select", body).forEach(el => el.addEventListener("change", markDirty));
    $("#permSave").onclick = () => withButton($("#permSave"), async () => {
      tiers.filter(t => !locked(t)).forEach(t => {
        const tc = cfg.tiers[t];
        tc.rows = body.querySelector(`select[data-t="${t}"][data-k="rows"]`).value;
        tc.landing = body.querySelector(`select[data-t="${t}"][data-k="landing"]`).value;
        tc.view = groups.filter(g => g === "core" || body.querySelector(`[data-t="${t}"][data-k="view:${g}"]`).checked);
        tc.edit = groups.filter(g => body.querySelector(`[data-t="${t}"][data-k="edit:${g}"]`).checked && tc.view.indexOf(g) >= 0);
        ["can_add", "can_delete", "todos", "admin_page"].forEach(k => { tc[k] = body.querySelector(`[data-t="${t}"][data-k="${k}"]`).checked; });
      });
      cfg.pipeline_relationships = $$("[data-pipe]", body).filter(x => x.checked).map(x => x.dataset.pipe);
      const r = await api("config_save", { config: cfg });
      AC.config = { config: r.config };
      setState($("#permMsg"), "Saved. People see the change on their next page load.", "ok");
      toast("Permissions saved.");
    }).catch(() => {});
  }

  async function adminActivity(force) {
    const body = $("#adminBody");
    let d; try { d = await cached("activity", () => api("activity", { limit: 600 }), force); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (S.adminTab !== "activity") return;
    const ev = d.events;
    const people = {};
    ev.forEach(e => {
      const p = people[e.user_id] = people[e.user_id] || { name: e.name, tier: e.tier, last: e.server_time, logins: 0, views: 0, secs: 0, edits: 0, opens: 0 };
      if (e.server_time > p.last) p.last = e.server_time;
      if (e.type === "login") p.logins++;
      if (e.type === "view") p.views++;
      if (e.type === "time_on_view") p.secs += e.seconds || 0;
      if (e.type === "edit" || e.type === "add") p.edits++;
      if (e.type === "open_record") p.opens++;
    });
    const mins = s => s < 60 ? Math.round(s) + " s" : s < 3600 ? Math.round(s / 60) + " min" : (s / 3600).toFixed(1) + " h";
    S.actUser = S.actUser || ""; S.actType = S.actType || "";
    const types = [...new Set(ev.map(e => e.type))].sort();
    const draw = () => {
      const list = ev.filter(e => (!S.actUser || e.user_id === S.actUser) && (!S.actType || e.type === S.actType)).slice(0, S.actN || 150);
      $("#actRows").innerHTML = list.map(e => `<tr><td class="mono">${esc(fmtTime(e.server_time))}</td><td>${esc(e.name)}</td><td>${esc(e.type)}</td><td>${esc(e.view)}</td><td class="mono">${esc(e.target)}</td><td class="mono">${e.seconds != null && e.seconds !== "" ? esc(mins(e.seconds)) : ""}</td><td>${esc(e.detail)}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No activity yet.</td></tr>`;
    };
    body.innerHTML = `
      <div class="row-between"><p class="note" style="margin:0">Last ${ev.length} events. The full log is the “Activity log” sheet in the Drive folder.</p><button class="btn small" type="button" id="actRefresh">Refresh</button></div>
      <div class="tablebox"><table><thead><tr><th>Person</th><th>Last seen</th><th>Sign-ins</th><th>Page views</th><th>Time on site</th><th>Records opened</th><th>Edits</th></tr></thead><tbody>
      ${Object.keys(people).map(id => { const p = people[id]; return `<tr><td><b>${esc(p.name)}</b><div class="conf">${esc(p.tier)}</div></td><td class="mono">${esc(fmtTime(p.last))}</td><td class="mono">${p.logins}</td><td class="mono">${p.views}</td><td class="mono">${mins(p.secs)}</td><td class="mono">${p.opens}</td><td class="mono">${p.edits}</td></tr>`; }).join("") || `<tr><td colspan="7" class="empty">No activity yet.</td></tr>`}
      </tbody></table></div>
      <div class="filters"><select id="actUser" aria-label="Person"><option value="">Everyone</option>${Object.keys(people).map(id => `<option value="${esc(id)}" ${S.actUser === id ? "selected" : ""}>${esc(people[id].name)}</option>`).join("")}</select>
        <select id="actType" aria-label="Event"><option value="">All events</option>${types.map(t => `<option ${S.actType === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
        <button class="btn" type="button" id="actMore">Show more</button></div>
      <div class="tablebox"><table class="wide"><thead><tr><th>When</th><th>Who</th><th>Event</th><th>Page</th><th>Target</th><th>Time</th><th>Detail</th></tr></thead><tbody id="actRows"></tbody></table></div>`;
    draw();
    $("#actUser").onchange = e => { S.actUser = e.target.value; draw(); };
    $("#actType").onchange = e => { S.actType = e.target.value; draw(); };
    $("#actMore").onclick = () => { S.actN = (S.actN || 150) + 300; draw(); };
    $("#actRefresh").onclick = () => { body.innerHTML = skeleton(); adminActivity(true); };
  }

  async function adminVersions(force) {
    const body = $("#adminBody");
    let d; try { d = await cached("versions", () => api("versions_list"), force); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (S.adminTab !== "versions") return;
    body.innerHTML = `<p class="note" style="margin:0">Every change saves a new JSON file in Drive › Brineworks Funder CRM data › crm_versions. The newest file is what everyone sees. Restoring copies an old file into a new newest version, so nothing is lost. ${d.total} versions in total.</p>
      <div class="tablebox"><table><thead><tr><th>Saved</th><th>What changed</th><th>Size</th><th></th></tr></thead><tbody>
      ${d.versions.map(v => `<tr><td class="mono">${esc(fmtTime(v.created))}</td><td>${esc(v.note || v.name)}${v.id === d.current ? ` <span class="pill p-existing">current</span>` : ""}</td><td class="mono">${Math.round(v.size / 1024)} KB</td>
        <td>${v.id === d.current ? "" : `<button class="btn small" type="button" data-restore="${esc(v.id)}" data-name="${esc(fmtTime(v.created))}">Restore</button>`}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">No versions yet.</td></tr>`}
      </tbody></table></div>`;
    $$("[data-restore]", body).forEach(b => b.onclick = () => confirmBox("Restore this version?", `The list goes back to how it was on ${b.dataset.name}. Everyone sees it within ${S.tier.poll_minutes} minutes.`, "Restore", async () => {
      try { await api("version_restore", { id: b.dataset.restore }); await loadBoot(true); stamp(); toast("Restored."); body.innerHTML = skeleton(); adminVersions(true); } catch (e) { toast(e.message, "err"); }
    }));
  }

  function adminImport() {
    const body = $("#adminBody");
    body.innerHTML = `<div class="card"><h2 class="sec">Import a JSON file</h2>
      <p class="note" style="margin:0">Use this once for the starting list (crm_seed.json), or any time to replace the list with a JSON file. It saves as a new version; older versions stay in Drive.</p>
      <input type="file" id="impFile" accept=".json,application/json">
      <div class="actions"><button class="btn primary" type="button" id="impGo" disabled>Import</button><span class="state" id="impMsg"></span></div></div>`;
    let payload = null;
    $("#impFile").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        payload = JSON.parse(await f.text());
        const rows = Array.isArray(payload) ? payload : payload.rows;
        if (!Array.isArray(rows)) throw new Error("No rows list in this file.");
        setState($("#impMsg"), `${rows.length} funders${payload.todos ? ` and ${payload.todos.items.length} to-dos` : ""} ready to import.`);
        $("#impGo").disabled = false;
      } catch (err) { payload = null; $("#impGo").disabled = true; setState($("#impMsg"), "That isn’t a valid JSON list: " + err.message, "err"); }
    };
    $("#impGo").onclick = () => withButton($("#impGo"), async () => {
      setState($("#impMsg"), "Importing… this takes a few seconds.", "busy");
      await api("import", { payload, note: "Imported " + ($("#impFile").files[0] || {}).name });
      await loadBoot(true); renderTabs(); stamp(); AC.versions = null;
      setState($("#impMsg"), "Imported. The pipeline now shows the new list.", "ok"); toast("Imported.");
    }, { busy: "Importing…", done: "Imported ✓" }).catch(() => { $("#impGo").disabled = false; });
  }

  boot();
})();

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

  const CONTACTS = ["Existing investor", "In contact", "No contact"];
  const PASSED = ["Passed Pre-Seed", "Passed Seed", "Passed CLA", "Passed Series A"];
  const STATUSES = ["Active", "Warm", "Dormant"].concat(PASSED, ["Grant in prep", "Grant applied", "Grant awarded", "Grant rejected", "Not a funder"]);
  const CATS = ["Investor – VC", "Investor – CVC", "Investor – Angel", "Investor – Family office", "Investor – Accelerator", "Investor – Other", "Grant/Public", "Debt/Bank", "Other"];
  // Before the contact/status split every row had one "relationship"; old saved views and rows are read through these.
  const LEGACY_STATUS = { "Active – Series A/CLA": "Active", "Warm": "Warm", "Dormant": "Dormant", "Passed": "Passed", "Grant awarded": "Grant awarded", "Grant applied": "Grant applied", "Grant in prep": "Grant in prep", "Grant rejected": "Grant rejected", "Not a funder": "Not a funder" };
  const legacyContact = rel => rel === "Existing investor" || rel === "Grant awarded" ? "Existing investor" : rel && rel !== "Not contacted" ? "In contact" : "No contact";
  const legacyCategory = (cat, type) => {
    const t = String(type || "").toLowerCase();
    if (cat !== "Investor") return cat;
    if (/^cvc|^corporate/.test(t)) return "Investor – CVC";
    if (/^angel/.test(t)) return "Investor – Angel";
    if (/family office/.test(t)) return "Investor – Family office";
    if (/accelerator/.test(t)) return "Investor – Accelerator";
    return "Investor – VC";
  };
  /** Fill contact / status / category on rows saved before the split (or served by a backend that strips the new fields). */
  function upgradeRow(r) {
    if (!r) return r;
    if (r.contact === undefined && r.relationship !== undefined) { r.contact = legacyContact(r.relationship); r.status = LEGACY_STATUS[r.relationship] || null; }
    if (r.category && CATS.indexOf(r.category) < 0) { if (r.type && r.category_note === undefined) r.category_note = r.type; r.category = legacyCategory(r.category, r.type); }
    return r;
  }
  const CHANNELS = ["", "Email", "Meeting", "Call", "Notes", "Logged", "Sheet"];
  const FOLLOW_UP_DAYS = 5;
  // "Next action from": a person who uses the CRM (from the backend), or "Them" when we're waiting on the funder.
  const FALLBACK_PEOPLE = ["Gudfinnur", "Olga", "Joe", "Hampus"];
  const people = () => (S.people && S.people.length ? S.people.map(p => p.short) : FALLBACK_PEOPLE);
  const ballOptions = () => [""].concat(people(), ["Them"]);
  const myShort = () => { const me = (S.people || []).find(p => S.user && p.id === S.user.id); return me ? me.short : S.user ? S.user.name.split(" ")[0] : ""; };
  const ballOf = r => { const b = r.ball_in_court; return !b || b === "None" ? "" : b; };
  const onUs = r => { const b = ballOf(r); return !!b && b !== "Them"; };
  const daysSince = d => d ? Math.floor((Date.parse(today()) - Date.parse(d)) / 86400000) : null;
  /** Waiting on them for more than 5 days with no promised date (or the promised date has passed): time to check whether to follow up. */
  function followUp(r) {
    if (ballOf(r) !== "Them") return null;
    const back = r.reply_expected_by;
    if (back && back >= today()) return { due: false, text: "back by " + back };
    const since = r.waiting_since || r.last_touch_date, n = daysSince(since);
    if (back && back < today()) return { due: true, text: "said by " + back };
    if (n != null && n > FOLLOW_UP_DAYS) return { due: true, text: n + "d waiting" };
    return n != null ? { due: false, text: n + "d waiting" } : null;
  }
  const CONF = ["", "High", "Medium", "Low"];
  const FIT = ["", "High", "Medium-High", "Medium", "Low-Medium", "Low"];
  const BC_STRENGTHS = ["strong", "medium", "weak"];
  const bcLabel = e => (e.name || "?") + (e.strength ? " · " + e.strength : "");
  const bcMine = e => S.user && (e.user_id ? e.user_id === S.user.id : String(e.name || "").toLowerCase() === String(S.user.name || "").toLowerCase());
  const OWNERS = ["", "GS", "JTP", "Olga", "Sam", "Ariana"];
  const OWNER_ALIASES = { gudfinnur: ["GS", "Gudfinnur"], joe: ["JTP", "Joe", "Joseph"], olga: ["Olga", "OM"] };
  const statusClass = s => s === "Active" ? "p-active" : s === "Warm" ? "p-warm" : String(s || "").startsWith("Grant") ? "p-grant" : String(s || "").indexOf("Passed") === 0 ? "p-passed" : "p-idle";
  const contactClass = c => c === "Existing investor" ? "p-existing" : c === "In contact" ? "p-warm" : "p-idle";
  const rank = (list, v) => { const i = list.indexOf(v); return i < 0 ? 99 : i; };
  const fmtTime = iso => { if (!iso) return "—"; const d = new Date(iso); if (isNaN(d)) return String(iso); return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
  const ago = ms => { const m = Math.round(ms / 60000); if (m < 1) return "just now"; if (m < 60) return m + " min ago"; const h = Math.round(m / 60); return h < 24 ? h + " h ago" : Math.round(h / 24) + " d ago"; };
  const DEFAULT_VIEW = { q: "", cols: {}, usOnly: false, hideNF: true, strip: "", sortKey: "contact", sortDir: 1 };
  // What the pipeline opens with when you haven't starred a saved view: investors only (no grants, debt or other), existing investors left out.
  const STARTER_STATE = () => ({ cols: { category: CATS.filter(c => c.indexOf("Investor") === 0), contact: ["In contact", "No contact"] } });
  // Column filters (Google-Sheets style): [field, label, field group, kind]
  const FILTER_FIELDS = [
    ["org", "Organisation", "core"], ["contact", "Contact", "core"], ["status", "Status", "core"], ["category", "Category", "core"], ["location", "Location", "core"],
    ["stage_focus", "Stage focus", "core"], ["lead_follow", "Lead / follow", "core"], ["tier", "Origin", "core"],
    ["investor_fit", "Investor fit", "core"], ["campaigns", "Campaign", "core", "multi"], ["backchannel", "Backchannel", "backchannel", "multi"],
    ["last_touch_date", "Last touch", "status", "touch"], ["last_touch_channel", "Channel", "status"],
    ["next_step_due", "Next step due", "actions", "due"], ["owner", "Owner", "actions"], ["ball_in_court", "Next action from", "actions"], ["followup", "Follow-up check", "actions"],
    ["confidence", "Confidence", "internal"], ["intro_from", "Intro from", "internal"],
  ];
  const BLANK = "(blank)", NONE = "\u0000none";
  const TOUCH_BUCKETS = ["This week", "This month", "Last 3 months", "Last year", "Older", BLANK];
  const DUE_BUCKETS = ["Overdue", "This week", "Later", BLANK];
  function colValue(field, r) {
    if (field === "followup") { const f = followUp(r); return !f ? BLANK : f.due ? "Check follow-up" : "Waiting (fine)"; }
    if (field === "ball_in_court") return ballOf(r) || BLANK;
    const v = r[field];
    if (field === "last_touch_date") {
      if (!v) return BLANK;
      const d = Math.round((Date.parse(today()) - Date.parse(v)) / 86400000);
      return d <= 7 ? "This week" : d <= 31 ? "This month" : d <= 92 ? "Last 3 months" : d <= 366 ? "Last year" : "Older";
    }
    if (field === "next_step_due") {
      if (!v) return BLANK;
      const t = today(), d = Math.round((Date.parse(v) - Date.parse(t)) / 86400000);
      return v < t ? "Overdue" : d <= 7 ? "This week" : "Later";
    }
    return v == null || v === "" ? BLANK : String(v);
  }
  /** Every filter value a row has: one for plain fields, several for list fields (campaigns, backchannel people). */
  function colValues(field, r) {
    if (field === "campaigns") { const v = (r.campaigns || []).filter(Boolean); return v.length ? v : [BLANK]; }
    if (field === "backchannel") { const v = (r.backchannel || []).map(e => e && e.name).filter(Boolean); return v.length ? v : [BLANK]; }
    return [colValue(field, r)];
  }
  function bucketOrder(field) { return field === "last_touch_date" ? TOUCH_BUCKETS : field === "next_step_due" ? DUE_BUCKETS : field === "contact" ? CONTACTS.concat([BLANK]) : field === "status" ? STATUSES.concat([BLANK]) : field === "category" ? CATS.concat([BLANK]) : field === "investor_fit" ? FIT.slice(1).concat([BLANK]) : null; }
  // Old saved views had rel/cat selects; fold them into cols.
  function normaliseView(st) {
    const s = Object.assign({}, st || {}); const cols = Object.assign({}, s.cols || {});
    if (s.rel) cols.relationship = [s.rel]; if (s.cat) cols.category = [s.cat];
    delete s.rel; delete s.cat;
    if (cols.relationship) {
      const old = cols.relationship; delete cols.relationship;
      const st = old.map(v => LEGACY_STATUS[v]).filter(Boolean), ct = old.filter(v => v === "Existing investor" || v === "Not contacted").map(legacyContact);
      if (st.length && !ct.length) cols.status = st; else if (ct.length && !st.length) cols.contact = ct; else if (st.length) cols.status = st;
    }
    if (cols.category) { const c = []; cols.category.forEach(v => { if (v === "Investor") CATS.filter(x => x.indexOf("Investor") === 0).forEach(x => c.push(x)); else c.push(v); }); cols.category = c; }
    delete cols.type;
    if (cols.status && cols.status.indexOf("Passed") >= 0) cols.status = cols.status.filter(v => v !== "Passed").concat(PASSED);
    if (s.sortKey === "relationship") s.sortKey = "contact";
    Object.keys(cols).forEach(k => { if (!Array.isArray(cols[k]) || !cols[k].length) delete cols[k]; });
    s.cols = cols; return s;
  }
  function activeCols() { return Object.keys(S.pv.cols || {}).filter(k => (S.pv.cols[k] || []).length); }

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

  /* ---------- outbox: every change shows at once, then saves in the background ----------
     Changes go into a queue kept in this browser (so a closed tab or a dropped connection loses nothing),
     are sent one at a time in the order they were made, and are retried with back-off on network or server
     hiccups. A change the server refuses is dropped, the person is told, and the list is reloaded from the server. */
  const OB = { items: [], running: false, timer: null, tries: 0, resync: false, waiters: [] };
  try { OB.items = JSON.parse(store.get("crm-outbox") || "[]") || []; } catch (e) { OB.items = []; }
  const saveOutbox = () => store.set("crm-outbox", JSON.stringify(OB.items));
  const MAX_TRIES = 8;
  function enqueue(action, body) {
    const it = { k: Date.now() + "-" + Math.random().toString(36).slice(2, 7), action, body, at: new Date().toISOString() };
    applyLocal(it); OB.items.push(it); saveOutbox(); stamp(); runOutbox();
    return it;
  }
  /** Apply a queued change to what's on screen. Also used after a reload, so changes still in the queue stay visible. */
  function applyLocal(it) {
    const b = it.body || {};
    if (it.action === "update") (b.patches || []).forEach(p => { const r = S.rows.find(x => x.id === p.id); if (r) Object.assign(r, p.fields); });
    if (it.action === "backchannel_set") {
      const r = S.rows.find(x => x.id === b.id); if (!r) return;
      const list = (r.backchannel || []).slice();
      const meId = S.user && S.user.id, meName = S.user && S.user.name;
      const who = b.user_id ? { user_id: b.user_id, name: ((S.people || []).find(p => p.id === b.user_id) || {}).name || b.user_id } : b.name ? { user_id: null, name: b.name } : { user_id: meId, name: meName };
      const key = e => e.user_id ? "u:" + e.user_id : "n:" + String(e.name || "").trim().toLowerCase();
      const i = list.findIndex(e => key(e) === key(who) || (!who.user_id && e.name && e.name.toLowerCase() === String(who.name).toLowerCase()));
      if (b.remove) { if (i >= 0) list.splice(i, 1); }
      else if (i >= 0) list[i] = Object.assign({}, list[i], { strength: b.strength });
      else list.push({ user_id: who.user_id, name: who.name, strength: b.strength, added_by: meName });
      r.backchannel = list;
    }
    if (it.action === "todo_update" && S.todos) {
      const item = S.todos.items.find(i => i.id === b.id); if (!item) return;
      const f = b.fields || {};
      Object.assign(item, f, f.status ? { done_at: f.status === "open" ? null : it.at, done_by: f.status === "open" ? null : (S.user && S.user.name) } : {});
    }
  }
  const laterFor = (idx, id) => OB.items.slice(idx).some(x => (x.body || {}).id === id || ((x.body || {}).patches || []).some(p => p.id === id));
  function applyResult(it, res) {
    if (res && res.meta) S.meta = res.meta;
    const b = it.body || {};
    if (it.action === "update") (res.rows || []).forEach(nr => {
      if (laterFor(0, nr.id) || S.pending[nr.id]) return; // newer changes still on their way: keep what's on screen
      const i = S.rows.findIndex(x => x.id === nr.id); if (i >= 0) S.rows[i] = upgradeRow(nr);
    });
    if (it.action === "backchannel_set" && res.row && !laterFor(0, b.id)) {
      const i = S.rows.findIndex(x => x.id === b.id);
      if (i >= 0) S.rows[i] = Object.assign({}, S.rows[i], { backchannel: res.row.backchannel || [], updated_at: res.row.updated_at, updated_by: res.row.updated_by });
    }
    if (it.action === "todo_update" && res.item && S.todos && !laterFor(0, b.id)) {
      const item = S.todos.items.find(i => i.id === b.id); if (item) Object.assign(item, res.item);
    }
    if (S.rows.length) writeCache();
  }
  async function runOutbox() {
    if (OB.running || !S.token || !API) return;
    clearTimeout(OB.timer);
    OB.running = true;
    try {
      while (OB.items.length && S.token) {
        const it = OB.items[0];
        try {
          const res = await api(it.action, Object.assign({}, it.body));
          OB.items.shift(); saveOutbox(); OB.tries = 0;
          applyResult(it, res);
        } catch (e) {
          if (e.code === "unauthorized") return; // signed out; the queue waits for the next sign-in
          const transient = e.code === "network" || e.code === "server_error";
          if (transient && ++OB.tries < MAX_TRIES) {
            OB.timer = setTimeout(runOutbox, Math.min(30000, 1500 * Math.pow(2, OB.tries - 1)));
            return;
          }
          OB.items.shift(); saveOutbox(); OB.tries = 0; OB.resync = true;
          toast("A change couldn't be saved: " + e.message, "err");
        }
      }
    } finally {
      OB.running = false; stamp();
      if (!OB.items.length) {
        const w = OB.waiters.splice(0); w.forEach(f => f());
        if (OB.resync) { OB.resync = false; try { await loadBoot(true); } catch (e) { /* next poll */ } }
        if (S.view === "pipeline" && $("#rows") && !S.openId) renderRows();
        if (S.view === "todos") renderTodos();
        renderTabsSafe();
      }
    }
  }
  const outboxIdle = () => OB.items.length ? new Promise(res => OB.waiters.push(res)) : Promise.resolve();
  function renderTabsSafe() { try { if (S.tier) renderTabs(); } catch (e) { /* not rendered yet */ } }
  window.addEventListener("online", () => { OB.tries = 0; runOutbox(); });

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
    if (r.data) { S.rows = (r.data.rows || []).map(upgradeRow); OB.items.forEach(applyLocal); S.summary = r.data.summary; S.empty = !!r.data.empty; writeCache(); }
    else if (cache) { S.rows = cache.rows.map(upgradeRow); OB.items.forEach(applyLocal); S.summary = cache.summary; S.empty = !!cache.empty; }
    S.todos = r.todos || null; if (S.todos) OB.items.filter(i => i.action === "todo_update").forEach(applyLocal); S.people = r.people || S.people || null;
    S.lastCheck = Date.now();
    const tp = (S.prefs.todos || {}); S.todoFilter = tp.filter || "all"; S.hideDone = !!tp.hide_done;
    if (!S.viewInit) { applyDefaultView(); S.viewInit = true; }
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
    if (!expired) { OB.items = []; saveOutbox(); }
    S.token = null; S.user = null; S.tier = null; S.rows = []; S.todos = null; S.summary = null; S.viewAs = null; S.viewInit = false;
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
    const link = parseHash();
    const fromHash = link.page;
    const first = ok.indexOf(fromHash) >= 0 ? fromHash : (ok.indexOf(S.tier.landing) >= 0 ? S.tier.landing : ok[0]);
    if (link.view && first === "pipeline") applyLinkView(link.view);
    go(first);
    clearInterval(S.pollTimer); S.pollTimer = setInterval(maybeCheck, 30000);
    OB.tries = 0; runOutbox();
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
    S.viewAs = tierId; store.del("crm-cache"); S.viewInit = false;
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
  window.addEventListener("hashchange", () => {
    const link = parseHash(), h = link.page;
    if (!S.user || !h || !pages().some(p => p[0] === h)) return;
    if (link.view && h === "pipeline") { applyLinkView(link.view); go(h); return; }
    if (h !== S.view) go(h);
  });

  /* ---------- shareable links: #pipeline?view=<encoded filters> ---------- */
  function parseHash() {
    const raw = location.hash.replace(/^#/, ""), i = raw.indexOf("?");
    const page = i < 0 ? raw : raw.slice(0, i);
    const params = new URLSearchParams(i < 0 ? "" : raw.slice(i + 1));
    let view = null;
    const v = params.get("view");
    if (v) { try { view = JSON.parse(decodeURIComponent(escape(atob(v.replace(/-/g, "+").replace(/_/g, "/"))))); } catch (e) { view = null; } }
    return { page, view };
  }
  function encodeView(st) { return btoa(unescape(encodeURIComponent(JSON.stringify(st)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function viewLink() {
    const st = viewState();
    const base = location.origin + location.pathname + "#pipeline";
    return base + "?view=" + encodeView(st);
  }
  /** Open a shared view. Filters on fields this person can't see are dropped, so they never hide every row. */
  function applyLinkView(st) {
    const v = normaliseView(st), seen = filterFields().map(f => f[0]);
    Object.keys(v.cols || {}).forEach(k => { if (seen.indexOf(k) < 0) delete v.cols[k]; });
    if ((["us", "mine", "followup", "overdue"].indexOf(v.strip) >= 0 || v.usOnly) && !canView("actions")) { v.strip = ""; v.usOnly = false; }
    if (v.strip === "nobc" && !S.tier.admin_page) v.strip = "";
    S.pv = Object.assign({}, DEFAULT_VIEW, v); S.activeView = null; S.viewInit = true;
    track("open_shared_view", { view: "pipeline", detail: JSON.stringify(v).slice(0, 120) });
    setTimeout(() => toast("Opened a shared view."), 300);
  }
  async function copyViewLink() {
    const url = viewLink();
    track("copy_view_link", { view: "pipeline" });
    try { await navigator.clipboard.writeText(url); toast("Link copied. It opens this exact view after sign-in."); return; } catch (e) { /* show it instead */ }
    openModal(`<h2>Link to this view</h2><p class="sub" style="margin:0">Opens the pipeline with these filters after sign-in. People only see what their access allows.</p>
      <input type="text" id="shareUrl" readonly value="${esc(url)}"><div class="actions"><button class="btn" type="button" data-close>Close</button></div>`);
    const i = $("#shareUrl"); i.focus(); i.select();
  }

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
    if (OB.items.length) {
      el.innerHTML = OB.tries ? `<b class="overdue">Offline or busy</b> · ${OB.items.length} change${OB.items.length > 1 ? "s" : ""} waiting, retrying` : `<span class="spin"></span> Saving ${OB.items.length} change${OB.items.length > 1 ? "s" : ""}…`;
      el.title = "Your changes are kept in this browser until the server has them."; return;
    }
    if (!S.tier) return;
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
      const busy = Object.keys(S.pending).length || OB.items.length;
      if (busy) { S.meta = Object.assign({}, prev, { server_time: r.meta.server_time }); stamp(); return; }
      if (dataChanged || (todosChanged && S.tier.todos)) {
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
    S.pv = Object.assign({}, DEFAULT_VIEW, normaliseView(v ? v.state : STARTER_STATE()));
    S.activeView = v ? v.name : null;
  }
  function viewState() {
    const s = {};
    Object.keys(DEFAULT_VIEW).forEach(k => { if (JSON.stringify(S.pv[k]) !== JSON.stringify(DEFAULT_VIEW[k])) s[k] = S.pv[k]; });
    if (s.cols) { s.cols = Object.assign({}, s.cols); Object.keys(s.cols).forEach(k => { if (!s.cols[k].length) delete s.cols[k]; }); if (!Object.keys(s.cols).length) delete s.cols; }
    return s;
  }
  function canon(st) { const o = Object.assign({}, DEFAULT_VIEW, normaliseView(st)); return JSON.stringify(Object.keys(o).sort().map(k => [k, k === "cols" ? Object.keys(o.cols).sort().map(c => [c, o.cols[c].slice().sort()]) : o[k]])); }
  function sameState(a, b) { return canon(a) === canon(b); }
  async function savePrefs(patch) {
    const r = await api("prefs_save", { prefs: patch });
    S.prefs = r.prefs || S.prefs;
  }

  function matches(r, skipCol) {
    const v = S.pv, q = (v.q || "").toLowerCase();
    if (v.hideNF && r.status === "Not a funder") return false;
    const cols = v.cols || {};
    for (const k in cols) { if (k === skipCol || !cols[k] || !cols[k].length) continue; if (!colValues(k, r).some(x => cols[k].indexOf(x) >= 0)) return false; }
    if (v.usOnly && !onUs(r)) return false;
    const st = v.strip;
    if (st === "active" && r.status !== "Active") return false;
    if (st === "existing" && r.contact !== "Existing investor") return false;
    if (st === "incontact" && r.contact !== "In contact") return false;
    if (st === "warm" && r.status !== "Warm") return false;
    if (st === "grants" && !String(r.status || "").startsWith("Grant")) return false;
    if (st === "us" && !onUs(r)) return false;
    if (st === "mine" && ballOf(r) !== myShort()) return false;
    if (st === "followup" && !((followUp(r) || {}).due)) return false;
    if (st === "overdue" && !(r.next_step_due && r.next_step_due < today())) return false;
    if (st === "mybc" && !(r.backchannel || []).some(bcMine)) return false;
    if (st === "nobc" && (r.backchannel || []).length) return false;
    if (q) {
      const hay = [r.org, (r.aliases || []).join(" "), r.category, r.category_note, r.location, r.parent_group, r.status_summary, r.next_step, r.notes, r.intro_from, (r.campaigns || []).join(" "), (r.backchannel || []).map(e => e.name).join(" "), (r.contacts || []).map(c => (c.name || "") + " " + (c.email || "")).join(" ")].join(" ").toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }
  function sortVal(k, r) {
    if (k === "backchannel") return (r.backchannel || []).map(e => e.name).join(", ").toLowerCase();
    if (k === "ball_in_court") return ballOf(r).toLowerCase();
    if (k === "org") return String(r.org || "").toLowerCase();
    return String(r[k] || "").toLowerCase();
  }
  function cmp(a, b) {
    const k = S.pv.sortKey, dir = S.pv.sortDir;
    let x, y;
    if (k === "contact" || k === "status") {
      const ka = k === "contact" ? [rank(CONTACTS, a.contact), rank(STATUSES, a.status)] : [rank(STATUSES, a.status), rank(CONTACTS, a.contact)];
      const kb = k === "contact" ? [rank(CONTACTS, b.contact), rank(STATUSES, b.status)] : [rank(STATUSES, b.status), rank(CONTACTS, b.contact)];
      x = ka[0] * 100 + ka[1]; y = kb[0] * 100 + kb[1];
      if (x === y) { x = b.last_touch_date || ""; y = a.last_touch_date || ""; }
    }
    else { x = sortVal(k, a); y = sortVal(k, b); if (!x && y) return 1; if (x && !y) return -1; }
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
    const stats = [["existing", "Existing investors", c(r => r.contact === "Existing investor")], ["incontact", "In contact", c(r => r.contact === "In contact" && r.status !== "Not a funder")], ["active", "Active round", c(r => r.status === "Active")], ["warm", "Warm", c(r => r.status === "Warm")], ["grants", "Grants", c(r => String(r.status || "").startsWith("Grant"))]];
    if (showActions) stats.push(["mine", "Next action: me", c(r => ballOf(r) === myShort())], ["followup", "Check follow-up", c(r => (followUp(r) || {}).due)], ["overdue", "Next step overdue", c(r => r.next_step_due && r.next_step_due < today())]);
    if (canView("backchannel")) {
      stats.push(["mybc", "I can intro", c(r => (r.backchannel || []).some(bcMine))]);
      if (S.tier.admin_page) stats.push(["nobc", "No backchannel yet", c(r => !(r.backchannel || []).length && r.status !== "Not a funder")]);
    }
    const canSaveViews = !S.viewAs;
    main.innerHTML = `
      <div class="head"><div><h1 class="page">Pipeline</h1><div class="sub">${esc(S.tier.label)} view${S.tier.edit.length && !S.viewAs ? " · click a row to edit" : " · read only"}</div></div>
        <div class="actions"><button class="btn" type="button" id="linkBtn" title="Copy a link that opens the pipeline with these filters">Copy link to view</button>${S.tier.can_add && !S.viewAs ? `<button class="btn" type="button" id="addBtn">Add funder</button>` : ""}${S.tier.edit.length ? `<button class="btn" type="button" id="csvBtn">Export CSV</button>` : ""}</div></div>
      <div class="strip">${stats.map(([k, l, n]) => `<button class="stat${(k === "us" || k === "overdue") && n ? " alert" : ""}" type="button" data-f="${k}" aria-pressed="${S.pv.strip === k}"><span class="n">${n}</span><span class="l">${l}</span></button>`).join("")}</div>
      ${canSaveViews ? `<div class="viewsbar"><div class="chips" id="viewChips"></div></div>` : ""}
      <div class="filters">
        <input type="search" id="q" placeholder="Search name, person, note…" aria-label="Search" value="${esc(S.pv.q || "")}">
        ${showActions ? `<label class="chk"><input type="checkbox" id="usOnly" ${S.pv.usOnly ? "checked" : ""}> Next action on us</label>` : ""}
        <label class="chk"><input type="checkbox" id="hideNF" ${S.pv.hideNF ? "checked" : ""}> Hide non-funders</label>
        <span class="count" id="count"></span><button type="button" class="linkbtn" id="clearAllBtn" hidden>Clear all filters</button>
      </div>
      <div class="chips colfilters" id="colFilters"></div>
      <div class="tablebox"><table class="wide"><thead><tr>
        ${th("org", "Organisation", false)}${th("category", "Category")}${th("contact", "Contact")}${th("status", "Status")}${canView("backchannel") ? th("backchannel", "Backchannel") : ""}${th("last_touch_date", "Last touch")}
        ${showActions ? `${th("next_step", "Next step", false)}${th("next_step_due", "Next step\ndue")}${th("ball_in_court", "Next action\nfrom")}` : ""}
      </tr></thead><tbody id="rows"></tbody></table></div>`;
    renderViewChips(); renderColFilters(); renderRows();
    main.querySelector(".strip").onclick = e => { const b = e.target.closest(".stat"); if (!b) return; S.pv.strip = S.pv.strip === b.dataset.f ? "" : b.dataset.f; viewChanged(); renderPipeline(); };
    const q = $("#q");
    q.oninput = () => { S.pv.q = q.value; viewChanged(); renderRows(); clearTimeout(S.qT); S.qT = setTimeout(() => { if (S.pv.q) track("search", { view: "pipeline", detail: S.pv.q.slice(0, 60) }); }, 1500); };
    if ($("#usOnly")) $("#usOnly").onchange = e => { S.pv.usOnly = e.target.checked; viewChanged(); renderRows(); };
    $("#hideNF").onchange = e => { S.pv.hideNF = e.target.checked; viewChanged(); renderRows(); };
    main.querySelector("thead").onclick = e => {
      const fb = e.target.closest("[data-filter]"); if (fb) { e.stopPropagation(); openColFilter(fb.dataset.filter, fb); return; }
      const sb = e.target.closest("[data-sk]"); if (sb) { e.stopPropagation(); S.pv.sortKey = sb.dataset.sk; S.pv.sortDir = +sb.dataset.sd; viewChanged(); renderPipeline(); return; }
      const th = e.target.closest("th[data-k]"); if (!th) return; const k = th.dataset.k; if (S.pv.sortKey === k) S.pv.sortDir *= -1; else { S.pv.sortKey = k; S.pv.sortDir = k === "last_touch_date" ? -1 : 1; } viewChanged(); renderRows();
    };
    $("#rows").onclick = e => {
      const tr = e.target.closest("tr[data-id]"); if (!tr) return;
      const pop = e.target.closest("[data-pop]");
      if (pop) { e.stopPropagation(); cellPopover(tr.dataset.id, pop.dataset.pop, pop); return; }
      openDrawer(tr.dataset.id);
    };
    $("#rows").onkeydown = e => { if (e.key === "Enter") { const tr = e.target.closest("tr[data-id]"); if (tr) openDrawer(tr.dataset.id); } };
    if ($("#csvBtn")) $("#csvBtn").onclick = exportCsv;
    $("#linkBtn").onclick = copyViewLink;
    if ($("#addBtn")) $("#addBtn").onclick = addFunder;
    $("#clearAllBtn").onclick = clearAllFilters;
  }

  /* ---------- column filters ---------- */
  const FUNNEL = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1.8 2.5h12.4L9.4 8.3v4.9l-2.8 1.5V8.3z"/></svg>`;
  const UP = `<svg viewBox="0 0 8 5" width="8" height="5" aria-hidden="true"><path d="M4 0 8 5H0z"/></svg>`;
  const DOWN = `<svg viewBox="0 0 8 5" width="8" height="5" aria-hidden="true"><path d="M0 0h8L4 5z"/></svg>`;
  // Columns in the table header, and the filter each one opens (Organisation filters by category).
  // Filters for the extra fields shown as chips above the table; the rest only appear there while they're in use (e.g. from a saved view).
  const CHIP_FILTERS = ["stage_focus", "location", "lead_follow"];
  const HEADER_FILTERS = ["org", "category", "contact", "status", "backchannel", "last_touch_date", "next_step_due", "ball_in_court"];
  function th(k, label, filterable, fkey) {
    fkey = fkey || k;
    const on = filterable !== false && (S.pv.cols[fkey] || []).length;
    const sk = S.pv.sortKey === k ? S.pv.sortDir : 0;
    const sorts = `<span class="sorts"><button type="button" class="sbtn${sk > 0 ? " on" : ""}" data-sk="${k}" data-sd="1" aria-label="Sort ${esc(label)} A to Z" title="Sort A → Z">${UP}</button><button type="button" class="sbtn${sk < 0 ? " on" : ""}" data-sk="${k}" data-sd="-1" aria-label="Sort ${esc(label)} Z to A" title="Sort Z → A">${DOWN}</button></span>`;
    return `<th data-k="${k}" data-fk="${fkey}"${on ? ' class="filtered"' : ""}><div class="thwrap"><span class="thlabel">${label.split("\n").map(esc).join("<br>")}</span>${sorts}${filterable === false ? "" : `<button type="button" class="fbtn${on ? " on" : ""}" data-filter="${fkey}" aria-label="Filter ${esc(label)}" title="${on ? "Filtered — click to change" : "Filter"}">${FUNNEL}</button>`}</div></th>`;
  }
  function anyFilter() { const v = S.pv; return activeCols().length > 0 || !!v.q || !!v.strip || !!v.usOnly; }
  function updateClearBtn() { const b = $("#clearAllBtn"); if (b) b.hidden = !anyFilter(); }
  function filterFields() { return FILTER_FIELDS.filter(f => canView(f[2])); }
  /** Every filter that isn't a table column, as a chip you can click straight away. Filtered ones are highlighted with their values. */
  function renderColFilters() {
    const box = $("#colFilters"); if (!box) return;
    const fields = filterFields().filter(f => HEADER_FILTERS.indexOf(f[0]) < 0 && (CHIP_FILTERS.indexOf(f[0]) >= 0 || (S.pv.cols[f[0]] || []).length));
    box.innerHTML = `<span class="conf" style="margin-right:2px">More filters:</span>` + fields.map(f => {
      const k = f[0], vals = (S.pv.cols[k] || []).filter(v => v !== NONE), on = (S.pv.cols[k] || []).length;
      if (!on) return `<button class="chip" type="button" data-col="${k}">${esc(f[1])} <span class="caret">▾</span></button>`;
      const txt = !vals.length ? "none" : vals.length <= 2 ? vals.join(", ") : `${vals.length} values`;
      return `<button class="chip filt" type="button" data-col="${k}" aria-pressed="true"><b>${esc(f[1])}:</b> ${esc(txt)}<span class="x" data-clear="${k}" title="Remove filter">×</span></button>`;
    }).join("");
    $$("[data-col]", box).forEach(b => b.onclick = e => { const x = e.target.closest("[data-clear]"); if (x) { setCol(x.dataset.clear, []); return; } openColFilter(b.dataset.col, b); });
    updateClearBtn();
  }
  function clearAllFilters() {
    S.pv = Object.assign({}, S.pv, { cols: {}, q: "", strip: "", usOnly: false });
    viewChanged(); renderPipeline(); track("clear_filters", { view: "pipeline" });
  }
  function setCol(k, vals) {
    S.pv.cols = Object.assign({}, S.pv.cols); if (vals.length) S.pv.cols[k] = vals; else delete S.pv.cols[k];
    viewChanged(); renderColFilters(); renderRows();
    const h = $(`th[data-fk="${k}"]`); if (h) { h.classList.toggle("filtered", !!vals.length); const b = h.querySelector(".fbtn"); if (b) b.classList.toggle("on", !!vals.length); }
  }
  function popover(anchor, cls) {
    $$(".menu").forEach(m => m.remove());
    const m = document.createElement("div"); m.className = "menu " + (cls || "");
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - 300)) + "px"; m.style.top = (r.bottom + window.scrollY + 4) + "px";
    document.body.appendChild(m);
    requestAnimationFrame(() => { const w = m.offsetWidth; const maxLeft = window.scrollX + document.documentElement.clientWidth - w - 8; if (parseFloat(m.style.left) > maxLeft) m.style.left = Math.max(8, maxLeft) + "px"; });
    const close = () => { m.remove(); document.removeEventListener("mousedown", onDoc, true); document.removeEventListener("keydown", onKey, true); };
    const onDoc = e => { if (!m.contains(e.target)) close(); };
    const onKey = e => { if (e.key === "Escape") close(); };
    setTimeout(() => { document.addEventListener("mousedown", onDoc, true); document.addEventListener("keydown", onKey, true); }, 0);
    m.close = close; return m;
  }
  function addFilterMenu(anchor) {
    const m = popover(anchor);
    const used = activeCols();
    m.innerHTML = filterFields().map(f => `<button type="button" data-f="${f[0]}" ${used.indexOf(f[0]) >= 0 ? 'class="used"' : ""}>${esc(f[1])}${used.indexOf(f[0]) >= 0 ? " ✓" : ""}</button>`).join("");
    m.onclick = e => { const b = e.target.closest("[data-f]"); if (!b) return; m.close(); openColFilter(b.dataset.f, anchor); };
  }
  function openColFilter(k, anchor) {
    const f = FILTER_FIELDS.find(x => x[0] === k); if (!f || !canView(f[2])) return;
    const m = popover(anchor, "fmenu");
    // counts over rows that pass every other filter (as in Sheets)
    const base = S.rows.filter(r => matches(r, k));
    const counts = {}; base.forEach(r => colValues(k, r).forEach(v => { counts[v] = (counts[v] || 0) + 1; }));
    const allVals = {}; S.rows.forEach(r => colValues(k, r).forEach(v => { allVals[v] = 1; }));
    const order = bucketOrder(k);
    let vals = Object.keys(allVals);
    vals.sort((a, b) => order ? order.indexOf(a) - order.indexOf(b) : a === BLANK ? 1 : b === BLANK ? -1 : a.localeCompare(b));
    let sel = (S.pv.cols[k] || []).slice();
    const sortable = ["org", "contact", "status", "last_touch_date", "next_step_due", "owner", "ball_in_court"].indexOf(k) >= 0;
    m.innerHTML = `<div class="fhead"><b>${esc(f[1])}</b><span class="conf" id="fsel"></span></div>
      ${sortable ? `<div class="frow"><button type="button" data-sort="1">Sort A → Z</button><button type="button" data-sort="-1">Sort Z → A</button></div>` : ""}
      <input type="search" id="fq" placeholder="Search values" aria-label="Search values">
      <div class="frow"><button type="button" id="fAll">Select all</button><button type="button" id="fNone">Clear</button><button type="button" id="fOnly" title="Keep only the values matching your search">Only matches</button></div>
      <div class="flist" id="flist"></div>
      <div class="frow end"><button type="button" class="btn primary small" id="fDone">Done</button></div>`;
    const list = m.querySelector("#flist"), fq = m.querySelector("#fq"), fsel = m.querySelector("#fsel");
    const visible = () => { const q = fq.value.trim().toLowerCase(); return vals.filter(v => !q || v.toLowerCase().indexOf(q) >= 0); };
    const draw = () => {
      list.innerHTML = visible().map(v => `<label class="fopt"><input type="checkbox" value="${esc(v)}" ${!sel.length || sel.indexOf(v) >= 0 ? "checked" : ""}><span>${esc(v)}</span><span class="n">${counts[v] || 0}</span></label>`).join("") || `<div class="empty">No values</div>`;
      fsel.textContent = sel.length ? `${sel.filter(v => v !== NONE).length} of ${vals.length}` : "all";
    };
    const apply = () => { setCol(k, sel.length === vals.length ? [] : sel); };
    draw();
    fq.oninput = draw;
    list.onchange = e => {
      const cb = e.target; if (cb.type !== "checkbox") return;
      if (!sel.length) sel = vals.slice();               // "all" was implicit; make it explicit before removing
      if (cb.checked) { if (sel.indexOf(cb.value) < 0) sel.push(cb.value); } else sel = sel.filter(v => v !== cb.value);
      sel = sel.filter(v => v !== NONE); if (!sel.length) sel = [NONE];
      apply(); fsel.textContent = sel.length ? `${sel.filter(v => v !== NONE).length} of ${vals.length}` : "all";
    };
    m.querySelector("#fAll").onclick = () => { sel = []; apply(); draw(); };
    m.querySelector("#fNone").onclick = () => { sel = [NONE]; apply(); draw(); };
    m.querySelector("#fOnly").onclick = () => { const v = visible(); sel = v.length ? v.slice() : [NONE]; apply(); draw(); };
    m.querySelector("#fDone").onclick = () => m.close();
    $$("[data-sort]", m).forEach(b => b.onclick = () => { S.pv.sortKey = k; S.pv.sortDir = +b.dataset.sort; viewChanged(); m.close(); renderPipeline(); });
    setTimeout(() => fq.focus(), 0);
  }

  function viewChanged() {
    const p = viewsPref(), v = S.activeView && (p.views || []).find(x => x.name === S.activeView);
    if (v && !sameState(v.state, viewState())) S.activeView = null;
    renderViewChips();
  }

  function renderViewChips() {
    const box = $("#viewChips"); if (!box) return;
    const p = viewsPref(), views = p.views || [];
    const isDefault = sameState(STARTER_STATE(), viewState());
    box.innerHTML = `<button class="chip" type="button" data-view="" aria-pressed="${isDefault && !S.activeView}" title="Investors only, existing investors left out">Default${!p.default ? '<span class="star" title="opens by default">★</span>' : ""}</button>`
      + views.map(v => `<button class="chip" type="button" data-view="${esc(v.name)}" aria-pressed="${S.activeView === v.name}">${esc(v.name)}${p.default === v.name ? '<span class="star" title="opens by default">★</span>' : ""}</button>`).join("")
      + `<span class="chip-sep"></span><button class="chip ghost" type="button" id="saveViewBtn">${S.activeView ? "Update or save as…" : "Save this view…"}</button>`
      + ((S.activeView || views.length || p.default) ? `<button class="chip ghost" type="button" id="viewMenuBtn" aria-label="View options">⋯</button>` : "");
    $$("[data-view]", box).forEach(b => b.onclick = () => {
      const name = b.dataset.view;
      if (!name) { S.pv = Object.assign({}, DEFAULT_VIEW, normaliseView(STARTER_STATE())); S.activeView = null; }
      else { const v = views.find(x => x.name === name); if (!v) return; S.pv = Object.assign({}, DEFAULT_VIEW, normaliseView(v.state)); S.activeView = name; }
      renderPipeline();
    });
    $("#saveViewBtn").onclick = saveViewDialog;
    const mb = $("#viewMenuBtn"); if (mb) mb.onclick = e => viewMenu(e.currentTarget);
  }

  function saveViewDialog() {
    const p = viewsPref(), views = p.views || [];
    openModal(`<h2>${S.activeView ? "Update view" : "Save this view"}</h2>
      <p class="sub" style="margin:0">Saves the current search, column filters, sort and the selected tile under a name you can pick from the chips. Only you see your views.</p>
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
      : `<button type="button" data-a="clearDefault" ${p.default ? "" : "disabled"}>Open the pipeline with the default view</button>`);
    document.body.appendChild(m);
    const close = () => { m.remove(); document.removeEventListener("click", onDoc, true); };
    const onDoc = e => { if (!m.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener("click", onDoc, true), 0);
    m.onclick = async e => {
      const a = e.target.closest("[data-a]"); if (!a) return; close();
      try {
        if (a.dataset.a === "default") { await savePrefs({ pipeline: { default: p.default === name ? null : name } }); toast(p.default === name ? "Default cleared." : "This view now opens by default."); }
        if (a.dataset.a === "clearDefault") { await savePrefs({ pipeline: { default: null } }); toast("The pipeline opens with the default view."); }
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

  function bcCell(r) {
    const list = canView("backchannel") ? (r.backchannel || []) : [];
    if (!list.length) return `<span class="bcnone">None</span>`;
    return `<span class="bcline">${list.map(e => `<span class="bc${bcMine(e) ? " me" : ""}${e.strength ? " s-" + esc(e.strength) : ""}">${esc(e.name.split(" ")[0])}${e.strength ? `<i>${esc(e.strength[0].toUpperCase())}</i>` : ""}</span>`).join("")}</span>`;
  }

  /** A pill that opens a small chooser when the person may edit the field, or a plain pill when they can't. */
  function pillBtn(field, value, cls) {
    const editable = canEdit("core") && !S.viewAs;
    const inner = value ? `<span class="pill ${cls}">${esc(value)}</span>` : `<span class="conf nowrap">${editable ? (field === "status" ? "Set status" : "Set contact") : "—"}</span>`;
    return editable ? `<button type="button" class="cellbtn" data-pop="${field}" title="Click to change">${inner}<span class="caret">▾</span></button>` : inner;
  }
  function cellPopover(id, field, anchor) {
    const r = S.rows.find(x => x.id === id); if (!r) return;
    if (field === "backchannel") {
      const m = popover(anchor, "bcmenu");
      m.innerHTML = bcSection(r, true); wireBc(id, m, true);
      return;
    }
    const opts = field === "contact" ? CONTACTS : [""].concat(STATUSES);
    const m = popover(anchor, "pickmenu");
    m.innerHTML = `<div class="fhead"><b>${field === "contact" ? "Contact" : "Status"}</b><span class="conf">${esc(r.org)}</span></div>` + opts.map(o => `<button type="button" data-v="${esc(o)}" class="${(r[field] || "") === o ? "cur" : ""}">${o ? `<span class="pill ${field === "contact" ? contactClass(o) : statusClass(o)}">${esc(o)}</span>` : `<span class="conf">No status</span>`}${(r[field] || "") === o ? " ✓" : ""}</button>`).join("");
    m.onclick = e => {
      const b = e.target.closest("[data-v]"); if (!b) return;
      m.close(); const v = b.dataset.v || null;
      if ((r[field] || null) === v) return;
      queueEdit(id, field, v); renderRows();
    };
  }

  function renderRows() {
    const showActions = canView("actions");
    const list = S.rows.filter(matches).sort(cmp);
    $("#count").textContent = `${list.length} of ${S.rows.length}`; updateClearBtn();
    const showBc = canView("backchannel");
    const cols = 5 + (showBc ? 1 : 0) + (showActions ? 3 : 0);
    $("#rows").innerHTML = list.length ? list.map(r => {
      const od = r.next_step_due && r.next_step_due < today();
      const b = ballOf(r), fu = followUp(r), mine = b && b === myShort();
      return `<tr class="click" tabindex="0" data-id="${esc(r.id)}">
        <td class="org">${esc(r.org)}${r.location ? `<span class="t">${esc(r.location)}</span>` : ""}</td>
        <td class="cat">${esc(String(r.category || "—").replace("Investor – ", ""))}${String(r.category || "").indexOf("Investor") === 0 ? `<span class="t">Investor</span>` : ""}</td>
        <td>${pillBtn("contact", r.contact, contactClass(r.contact))}</td>
        <td>${pillBtn("status", r.status, statusClass(r.status))}</td>
        ${showBc ? `<td class="bccol"><button type="button" class="cellbtn" data-pop="backchannel" title="Who can intro? Click to change">${bcCell(r)}</button></td>` : ""}
        <td class="date">${esc(r.last_touch_date || "—")}<div class="conf">${esc(r.last_touch_channel || "")}</div></td>
        ${showActions ? `<td class="sum"><div class="clamp" title="${esc(r.next_step || "")}">${esc(r.next_step || "")}</div></td>
        <td class="date duecol ${od ? "overdue" : ""}">${esc(r.next_step_due || "—")}${od ? `<div class="conf overdue">overdue</div>` : ""}</td>
        <td class="ball ${b === "Them" ? "them" : b ? "us" : ""}${mine ? " mine" : ""}">${esc(b || "")}${fu ? `<div class="${fu.due ? "fu due" : "fu"}">${fu.due ? "Follow up?<br>" : ""}${esc(fu.text)}</div>` : ""}</td>` : ""}
      </tr>`;
    }).join("") : `<tr><td colspan="${cols}" class="empty">Nothing matches these filters.</td></tr>`;
  }

  /* ---------- drawer ---------- */
  const FIELDS = {
    core: [["org", "Name", "text", "wide"], ["contact", "Contact", CONTACTS], ["status", "Status", [""].concat(STATUSES)], ["category", "Category", CATS], ["location", "Location", "text"], ["ticket_size", "Ticket size", "text"], ["stage_focus", "Stage focus", "text"], ["lead_follow", "Lead / follow", "text"], ["rounds", "Rounds (comma separated)", "list", "wide"], ["aliases", "Other names (comma separated)", "list", "wide"],
      ["parent_group", "Parent group", "text"], ["investor_fit", "Investor fit", FIT], ["fit_note", "Why it fits", "area", "wide"], ["strategic_angle", "Strategic angle (pilot, offtake, partner)", "area", "wide"], ["campaigns", "Campaigns / lists (comma separated)", "list", "wide"]],
    status: [["status_summary", "Status notes", "area", "wide"], ["last_touch_date", "Last touch", "date"], ["last_touch_channel", "Channel", CHANNELS], ["last_touch_note", "Last touch note", "text", "wide"]],
    actions: [["next_step", "Next step", "text", "wide"], ["next_step_due", "Due", "date"], ["owner", "Owner", OWNERS], ["ball_in_court", "Next action from", "ball"], ["reply_expected_by", "They said they'd come back by", "date"], ["waiting_since", "Waiting on them since", "date"]],
    contacts: [["contacts", "People — one per line: Name | role | email | LinkedIn", "contacts", "wide"]],
    internal: [["notes", "Notes", "area", "wide"], ["objections", "Objections", "area", "wide"], ["intro_from", "Intro from", "text"], ["first_contact_date", "First contact", "date"], ["confidence", "Confidence", CONF], ["category_note", "Note on category", "text", "wide"]],
    sources: [["sources", "Sources — one per line: type | label | link or ref | date", "sources", "wide"]],
  };
  const GROUP_TITLES = { core: "Organisation", status: "Status", actions: "Next step", contacts: "People", internal: "Internal", sources: "Sources" };

  function fieldValue(r, f, kind) {
    const v = r[f];
    if (kind === "list") return (v || []).join(", ");
    if (kind === "contacts") return (v || []).filter(c => c && (c.name || c.email)).map(c => [c.name || "", c.role || "", c.email || ""].concat(c.linkedin ? [c.linkedin] : []).join(" | ")).join("\n");
    if (kind === "sources") return (v || []).map(s => [s.type || "", s.label || "", s.ref || "", s.date || ""].join(" | ")).join("\n");
    return v == null ? "" : v;
  }
  function parseField(kind, text) {
    if (kind === "list") return text.split(",").map(s => s.trim()).filter(Boolean);
    if (kind === "contacts") return text.split("\n").map(l => l.split("|").map(s => s.trim())).filter(p => p[0] || p[2]).map(p => Object.assign({ name: p[0] || "", role: p[1] || "", email: p[2] || "" }, p[3] ? { linkedin: p[3] } : {}));
    if (kind === "sources") return text.split("\n").map(l => l.split("|").map(s => s.trim())).filter(p => p[1] || p[2]).map(p => ({ type: p[0] || "note", label: p[1] || "", ref: p[2] || "", date: p[3] || null }));
    return text === "" ? null : text;
  }
  function liLink(c) { return c && /^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(c.linkedin || "") ? ` · <a href="${esc(c.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>` : ""; }
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
        if (g === "contacts") { const cs = (r.contacts || []).filter(c => c && (c.name || c.email)); return `<div class="secbox"><h3>People</h3>${cs.length ? `<dl class="kv">${cs.map(c => `<dt>${esc(c.name || "—")}</dt><dd>${esc([c.role, c.email].filter(Boolean).join(" · ") || "—")}${liLink(c)}</dd>`).join("")}</dl>` : `<div class="sub">No contacts recorded.</div>`}</div>`; }
        if (g === "sources") { const ss = r.sources || []; return `<div class="secbox"><h3>Sources</h3>${ss.length ? `<ul class="src">${ss.map(s => `<li><span class="tag">${esc(s.type || "")}</span><span>${srcLink(s)} <span class="ref">${esc(s.date || "")}</span></span></li>`).join("")}</ul>` : `<div class="sub">None.</div>`}</div>`; }
        return `<div class="secbox"><h3>${GROUP_TITLES[g]}</h3><dl class="kv">${FIELDS[g].filter(([f]) => f !== "org").map(([f, label, kind]) => `<dt>${esc(label.split(" (")[0].split(" —")[0])}</dt><dd>${esc(fieldValue(r, f, kind) || "—")}</dd>`).join("")}</dl></div>`;
      }
      const inputs = FIELDS[g].map(([f, label, kind, wide]) => {
        const v = fieldValue(r, f, kind);
        let ctl;
        if (kind === "ball") { const opts = ballOptions(); const cur = ballOf(r); const all = opts.indexOf(cur) >= 0 ? opts : opts.concat([cur]); ctl = `<select data-f="${f}" data-kind="select">${all.map(o => `<option value="${esc(o)}" ${o === cur ? "selected" : ""}>${esc(o || "—")}</option>`).join("")}</select>`; }
        else if (Array.isArray(kind)) { const opts = kind.indexOf(v) >= 0 || v === "" ? kind : kind.concat([v]); ctl = `<select data-f="${f}" data-kind="select">${opts.map(o => `<option value="${esc(o)}" ${o === v ? "selected" : ""}>${esc(o || "—")}</option>`).join("")}</select>`; }
        else if (kind === "area" || kind === "contacts" || kind === "sources") ctl = `<textarea data-f="${f}" data-kind="${kind}">${esc(v)}</textarea>`;
        else ctl = `<input data-f="${f}" data-kind="${kind}" type="${kind === "date" ? "date" : "text"}" value="${esc(v)}">`;
        return `<label class="f ${wide || ""}">${esc(label)} ${ctl}</label>`;
      }).join("");
      let extra = "";
      if (g === "contacts" && (r.contacts || []).some(c => c && c.linkedin)) extra = `<div class="sub" style="margin-top:6px">${r.contacts.filter(c => c && c.linkedin).map(c => esc(c.name || "?") + liLink(c)).join("<br>")}</div>`;
      if (g === "sources" && (r.sources || []).some(s => /^https?:\/\//.test(s.ref || ""))) extra = `<ul class="src" style="margin-top:6px">${r.sources.filter(s => /^https?:\/\//.test(s.ref || "")).map(s => `<li><span class="tag">${esc(s.type || "")}</span><span>${srcLink(s)}</span></li>`).join("")}</ul>`;
      return `<div class="secbox"><h3>${GROUP_TITLES[g]}</h3><div class="grid2">${inputs}</div>${extra}</div>`;
    };
    const conflicts = canView("internal") && (r.conflicts || []).length ? `<div class="secbox"><h3>Sources disagree</h3><ul class="conflicts">${r.conflicts.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>` : "";
    const root = $("#drawerRoot");
    root.innerHTML = `<div class="scrim" data-close></div>
      <aside class="drawer" role="dialog" aria-label="${esc(r.org)}">
        <div class="dhead"><div><h2>${esc(r.org)}</h2><div class="sub">${esc([r.category, r.contact, r.status, r.location].filter(Boolean).join(" · "))}</div>
          ${r.updated_by ? `<div class="conf">Last changed ${esc(fmtTime(r.updated_at))} by ${esc(r.updated_by)}</div>` : ""}</div>
          <button class="btn" type="button" data-close>Close</button></div>
        <div class="dbody">
          <div class="actions">${canEdit("status") ? `<button class="btn primary small" type="button" id="touchBtn">Log a touch today</button>` : ""}<span class="state" id="saveState">${S.tier.edit.length && !S.viewAs ? "Changes save as you go" : ""}</span></div>
          <div id="bcBox">${bcSection(r)}</div>
          ${["actions", "status", "core", "contacts", "internal"].map(groupHtml).join("")}
          ${conflicts}
          ${groupHtml("sources")}
          ${S.tier.can_delete && !S.viewAs ? `<div><button class="btn danger small" type="button" id="delBtn">Remove this funder</button></div>` : ""}
        </div>
      </aside>`;
    root.hidden = false;
    wireBc(id, $("#bcBox"));
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
  /* ---------- backchannel ---------- */
  /** Who can intro to this funder. Anyone with backchannel access can add themselves or someone else, always with a strength. */
  function bcSection(r, compact) {
    if (!canView("backchannel")) return "";
    const list = r.backchannel || [], edit = canEdit("backchannel") && !S.viewAs, admin = edit && S.tier.admin_page;
    const mine = list.find(bcMine);
    const canChange = e => edit && (bcMine(e) || admin || e.added_by === (S.user && S.user.name));
    const seg = (cur, attrs) => BC_STRENGTHS.map(s => `<button type="button" class="segb${cur === s ? " on" : ""}" data-bcs="${s}" ${attrs}>${s[0].toUpperCase() + s.slice(1)}</button>`).join("");
    const rows = list.map((e, i) => {
      const self = bcMine(e);
      const ctl = canChange(e) ? `<span class="seg">${seg(e.strength, `data-bci="${i}"`)}</span><button type="button" class="btn small" data-bcrm="${i}" title="${self ? "I can’t intro here" : "Remove"}">${self ? "Not me" : "Remove"}</button>` : `<span class="conf">${esc(e.strength || "strength not set")}</span>`;
      return `<li class="bcrow"><span class="bcname">${esc(e.name)}${self ? ' <span class="conf">(you)</span>' : ""}${!e.strength ? ' <span class="fu due">set strength</span>' : ""}</span><span class="bcctl">${ctl}</span></li>`;
    }).join("");
    const me = edit && !mine ? `<div class="actions"><span class="sub">I can intro here:</span><span class="seg">${seg(null, 'data-bcme="1"')}</span></div>` : "";
    const add = edit ? `<div class="actions bcadd"><input type="text" class="bcName" placeholder="Add someone else (name)" aria-label="Backchannel name" style="flex:1;min-width:140px"><select class="bcStr" aria-label="Strength"><option value="">Strength…</option>${BC_STRENGTHS.map(s => `<option value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select><button class="btn small" type="button" data-bcadd="1">Add</button></div>` : "";
    return `<div class="${compact ? "bcpop" : "secbox bcbox"}"><h3>Backchannel — who can intro</h3>
      ${list.length ? `<ul class="bclist">${rows}</ul>` : `<div class="sub">None yet.</div>`}
      ${me}${add}
      ${edit ? `<div class="conf">Several people can be listed per fund. Pick strong, medium or weak for each.</div>` : ""}<span class="state" data-bcstate="1"></span></div>`;
  }
  /** Wire a backchannel box (drawer section or table popover) to the backend. */
  function wireBc(id, box, compact) {
    box = box || $("#bcBox"); if (!box) return;
    const r = () => S.rows.find(x => x.id === id);
    const st = () => box.querySelector("[data-bcstate]");
    const send = (body, label) => {
      if (S.viewAs) { toast("You are viewing as another tier.", "err"); return; }
      enqueue("backchannel_set", Object.assign({ id }, body));
      box.innerHTML = bcSection(r(), compact); wireBc(id, box, compact); setState(st(), label || "Saved ✓", "ok");
      if (S.view === "pipeline" && $("#rows")) renderRows();
      const db = $("#bcBox"); if (db && db !== box && S.openId === id) { db.innerHTML = bcSection(r()); wireBc(id, db); }
      track("backchannel", { view: S.view, target: id, detail: JSON.stringify(body).slice(0, 80) });
    };
    const target = i => { const e = (r().backchannel || [])[+i]; return !e ? {} : bcMine(e) ? {} : e.user_id ? { user_id: e.user_id } : { name: e.name }; };
    box.onclick = e => {
      e.stopPropagation();
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.bcme) return send({ strength: b.dataset.bcs });
      if (b.dataset.bci !== undefined) { const ent = (r().backchannel || [])[+b.dataset.bci]; if (ent && ent.strength === b.dataset.bcs) return; return send(Object.assign(target(b.dataset.bci), { strength: b.dataset.bcs })); }
      if (b.dataset.bcrm !== undefined) return send(Object.assign(target(b.dataset.bcrm), { remove: true }), "Removed ✓");
      if (b.dataset.bcadd) {
        const nm = box.querySelector(".bcName").value.trim(), str = box.querySelector(".bcStr").value;
        if (!nm) { setState(st(), "Type a name first.", "err"); return; }
        if (!str) { setState(st(), "Pick strong, medium or weak.", "err"); return; }
        return send({ name: nm, strength: str }, "Added ✓");
      }
    };
  }


  function closeDrawer() { S.openId = null; const r = $("#drawerRoot"); r.hidden = true; r.innerHTML = ""; }
  $("#drawerRoot").addEventListener("click", e => { if (e.target.closest("[data-close]")) { flushEdits(); closeDrawer(); } });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("#modalRoot").hidden) closeModal(); else if (S.openId) { flushEdits(); closeDrawer(); } } });

  function queueEdit(id, field, value) {
    const r = S.rows.find(x => x.id === id); if (r) r[field] = value;
    S.pending[id] = S.pending[id] || {}; S.pending[id][field] = value;
    setState($("#saveState"), "Saved ✓", "ok");
    clearTimeout(S.saveTimer); S.saveTimer = setTimeout(flushEdits, 700);
  }
  /** Typing is gathered for a moment, then handed to the outbox as one change per batch. */
  function flushEdits() {
    clearTimeout(S.saveTimer);
    const ids = Object.keys(S.pending);
    if (ids.length) { const patches = ids.map(id => ({ id, fields: S.pending[id] })); S.pending = {}; enqueue("update", { patches }); }
    return outboxIdle();
  }


  function addFunder() {
    openModal(`<h2>Add funder</h2>
      <label class="f">Name <input id="newOrg" type="text"></label>
      <label class="f">Category <select id="newCat">${CATS.map(c => `<option>${c}</option>`).join("")}</select></label>
      <div class="actions"><button class="btn primary" type="button" id="newSave">Add</button><button class="btn" type="button" data-close>Cancel</button></div>`);
    $("#newSave").onclick = () => withButton($("#newSave"), async () => {
      const org = $("#newOrg").value.trim(); if (!org) throw new Error("Give it a name.");
      const r = await api("add", { row: { org, category: $("#newCat").value } });
      S.rows.push(upgradeRow(r.row)); S.meta = r.meta; writeCache(); stamp(); closeModal(); render(); openDrawer(r.row.id); toast("Added.");
    }, { busy: "Adding…", done: "Added ✓" }).catch(() => {});
  }

  function exportCsv() {
    const cols = ["org", "category", "category_note", "contact", "status", "location", "parent_group", "investor_fit", "campaigns", "backchannel", "status_summary", "last_touch_date", "last_touch_note", "ball_in_court", "waiting_since", "reply_expected_by", "next_step", "next_step_due", "owner", "ticket_size", "stage_focus", "lead_follow", "rounds", "objections", "intro_from", "notes", "contacts", "confidence"];
    const visible = cols.filter(c => S.rows.some(r => c in r));
    const cell = (v, k) => { if (k === "backchannel" && Array.isArray(v)) v = v.map(bcLabel); if (Array.isArray(v)) v = v.map(x => x && typeof x === "object" ? Object.values(x).filter(Boolean).join(" | ") : x).join("; "); v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = S.rows.filter(matches).sort(cmp);
    const csv = [visible.join(",")].concat(rows.map(r => visible.map(c => cell(r[c], c)).join(","))).join("\n");
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
    if (S.todoEditing && document.body.contains(S.todoEditing)) { S.todoRenderPending = true; return; }
    S.todoEditing = null; S.todoRenderPending = false;
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
    $$("[data-duepop]", main).forEach(b => b.onclick = e => { e.stopPropagation(); duePopover(b.dataset.duepop, b); });
    $$("[data-tedit]", main).forEach(el => el.onclick = e => { if (e.target.closest("a,button")) return; todoInlineEdit(el.dataset.tedit, el.dataset.tf, el); });
  }
  let todoPrefT = null;
  function saveTodoPrefs() { clearTimeout(todoPrefT); todoPrefT = setTimeout(() => { if (!S.viewAs) savePrefs({ todos: { filter: S.todoFilter, hide_done: S.hideDone } }).catch(() => {}); }, 800); }

  function todoHtml(i, ro) {
    const late = i.status === "open" && i.due && i.due < today();
    const src = i.source || null;
    const srcHtml = src ? (/^https?:\/\//.test(src.ref || "") ? `<a href="${esc(src.ref)}" target="_blank" rel="noopener noreferrer">${esc(src.label || "source")}</a>` : `<span title="${esc(src.ref || "")}">${esc((src.type ? src.type + ": " : "") + (src.label || src.ref || ""))}</span>`) : "";
    const orgHtml = i.org ? (i.org_id && S.rows.some(r => r.id === i.org_id) ? `<button class="linklike" type="button" data-org="${esc(i.org_id)}">${esc(i.org)}</button>` : `<span>${esc(i.org)}</span>`) : "";
    const ownerOpts = OWNERS.filter(Boolean).indexOf(i.owner) >= 0 || !i.owner ? OWNERS : OWNERS.concat([i.owner]);
    const edit = !ro && i.status === "open";
    return `<div class="todo ${i.status !== "open" ? "done" : ""}">
      <input type="checkbox" data-id="${esc(i.id)}" ${i.status !== "open" ? "checked" : ""} ${ro ? "disabled" : ""} aria-label="Done">
      <div><div class="title${edit ? " editable" : ""}" ${edit ? `data-tedit="${esc(i.id)}" data-tf="title" title="Click to edit"` : ""}>${esc(i.title)}</div>
        <div class="meta">${orgHtml}${srcHtml}${i.scanned_by ? `<span class="conf" title="Added by a scheduled scan">${esc(i.scanned_by.replace(/ scan$/i, ""))} scan</span>` : ""}${i.status !== "open" && i.done_by ? `<span>${i.status === "dismissed" ? "Dismissed" : "Done"} by ${esc(i.done_by.split(" ")[0])}</span>` : ""}</div>
        ${i.detail ? `<div class="detail clamp${edit ? " editable" : ""}" ${edit ? `data-tedit="${esc(i.id)}" data-tf="detail" title="Click to edit"` : ""}>${esc(i.detail)}</div>` : edit ? `<div class="detail adddetail" data-tedit="${esc(i.id)}" data-tf="detail">+ Add description</div>` : ""}</div>
      <div class="side">${edit ? `<button type="button" class="due duebtn ${late ? "late" : ""}${i.due ? "" : " nodue"}" data-duepop="${esc(i.id)}" title="Change due date">${i.due ? esc(i.due) : "Set date"}</button>` : i.due ? `<span class="due ${late ? "late" : ""}">${esc(i.due)}</span>` : ""}
        ${i.status === "open" && !ro ? `<select class="sel" style="padding:2px 4px;font-size:12px" data-owner="${esc(i.id)}" aria-label="Owner">${ownerOpts.map(o => `<option value="${esc(o)}" ${o === (i.owner || "") ? "selected" : ""}>${esc(o || "—")}</option>`).join("")}</select>
        <button class="linklike" type="button" data-dismiss="${esc(i.id)}">Dismiss</button>` : (i.status === "open" ? `<span class="conf">${esc(i.owner || "")}</span>` : "")}</div>
    </div>`;
  }
  function setTodo(id, fields) {
    enqueue("todo_update", { id, fields });
    renderTabs(); renderTodos();
  }
  function duePopover(id, anchor) {
    const item = S.todos.items.find(i => i.id === id); if (!item) return;
    const plus = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const m = popover(anchor, "duemenu");
    m.innerHTML = `<div class="fhead"><b>Due date</b></div>
      <input type="date" class="dueIn" value="${esc(item.due || "")}" aria-label="Due date">
      <div class="quick">${[["Today", 0], ["Tomorrow", 1], ["+1 week", 7], ["+2 weeks", 14]].map(([l, n]) => `<button type="button" class="chip" data-q="${plus(n)}">${l}</button>`).join("")}</div>
      <div class="actions">${item.due ? `<button type="button" class="linklike" data-clear="1">Clear date</button>` : ""}<span style="flex:1"></span><button type="button" class="btn small" data-cancel="1">Cancel</button><button type="button" class="btn small primary" data-save="1">Save</button></div>`;
    const inp = m.querySelector(".dueIn"); setTimeout(() => inp.focus(), 0);
    const save = v => { m.close(); v = v || null; if ((item.due || null) !== v) setTodo(id, { due: v }); };
    m.onclick = e => {
      const q = e.target.closest("[data-q]"); if (q) { inp.value = q.dataset.q; return; }
      if (e.target.closest("[data-cancel]")) return m.close();
      if (e.target.closest("[data-clear]")) return save(null);
      if (e.target.closest("[data-save]")) return save(inp.value);
    };
    inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); save(inp.value); } };
  }
  function todoInlineEdit(id, field, el) {
    const item = S.todos.items.find(i => i.id === id); if (!item || S.todoEditing) return;
    const orig = item[field] || "";
    const box = document.createElement("div"); box.className = "tedit";
    box.innerHTML = `<textarea class="tedit-in ${field}" rows="1" maxlength="${field === "title" ? 300 : 600}" placeholder="${field === "title" ? "To-do" : "Description"}"></textarea>
      <div class="actions"><button type="button" class="btn small" data-cancel="1">Cancel</button><button type="button" class="btn small primary" data-save="1">Save</button><span class="conf">${field === "title" ? "Enter to save" : "⌘/Ctrl+Enter to save"} · Esc to cancel</span></div>`;
    const ta = box.querySelector("textarea"); ta.value = orig;
    const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
    el.replaceWith(box); S.todoEditing = box; fit(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    const done = () => { S.todoEditing = null; renderTodos(); };
    const save = () => {
      let v = ta.value.trim(); if (field === "title") v = v.replace(/\s*\n\s*/g, " ");
      if (field === "title" && !v) { ta.focus(); return; }
      S.todoEditing = null;
      if (v !== orig) setTodo(id, { [field]: v }); else renderTodos();
    };
    ta.oninput = fit;
    ta.onkeydown = e => {
      if (e.key === "Escape") { e.preventDefault(); done(); }
      else if (e.key === "Enter" && (field === "title" ? !e.shiftKey : (e.metaKey || e.ctrlKey))) { e.preventDefault(); save(); }
    };
    box.querySelector("[data-cancel]").onclick = done;
    box.querySelector("[data-save]").onclick = save;
  }

  /* ---------- overview ---------- */
  function renderOverview() {
    const main = $("#main");
    let counts = {}, existing = [], grants = [], activeCount, warmCount;
    if (S.summary) {
      counts = Object.assign({}, S.summary.counts); existing = S.summary.existing_investors || []; grants = (S.summary.grants || []).map(g => ({ org: g.org, status: g.status || LEGACY_STATUS[g.relationship] || g.relationship })); activeCount = S.summary.active_count; warmCount = S.summary.warm_count;
      Object.keys(LEGACY_STATUS).forEach(k => { if (counts[k] && k !== LEGACY_STATUS[k]) { counts[LEGACY_STATUS[k]] = (counts[LEGACY_STATUS[k]] || 0) + counts[k]; delete counts[k]; } });
    } else {
      S.rows.forEach(r => { const k = r.status || r.contact || "Unknown"; counts[k] = (counts[k] || 0) + 1; });
      existing = S.rows.filter(r => r.contact === "Existing investor").map(r => ({ org: r.org, category: r.category, location: r.location }));
      grants = S.rows.filter(r => /^Grant (awarded|applied)/.test(r.status || "")).map(r => ({ org: r.org, status: r.status }));
      activeCount = counts["Active"] || 0; warmCount = counts["Warm"] || 0;
    }
    if (S.empty) { main.innerHTML = `<div class="card empty">No data yet.</div>`; return; }
    const order = STATUSES.concat(["No contact", "In contact"]).filter(r => counts[r] && r !== "Not a funder");
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
        <div class="card"><h2 class="sec">Existing investors</h2><ul class="plain">${existing.map(e => `<li><span>${esc(e.org)}</span><span class="conf">${esc([e.category || e.type, e.location].filter(Boolean).join(" · "))}</span></li>`).join("") || "<li>None listed</li>"}</ul></div>
        <div class="card"><h2 class="sec">Grants and public funding</h2><ul class="plain">${grants.map(g => `<li><span>${esc(g.org)}</span><span class="pill ${statusClass(g.status)}">${esc(String(g.status || "").replace("Grant ", ""))}</span></li>`).join("") || "<li>None listed</li>"}</ul></div>
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
      <div class="card"><h2 class="sec">What the close circle sees</h2>
        <p class="sub" style="margin:0">Funders that match any ticked contact level or status, plus every funder on an outreach list or with a backchannel.</p>
        <div class="actions">${CONTACTS.map(r => `<label class="chk"><input type="checkbox" data-pipec="${esc(r)}" ${(cfg.pipeline_contacts || ["Existing investor"]).indexOf(r) >= 0 ? "checked" : ""}> ${esc(r)}</label>`).join("")}</div>
        <div class="actions">${STATUSES.map(r => `<label class="chk"><input type="checkbox" data-pipes="${esc(r)}" ${(cfg.pipeline_statuses || ["Active", "Warm", "Grant awarded", "Grant applied", "Grant in prep"]).indexOf(r) >= 0 ? "checked" : ""}> ${esc(r)}</label>`).join("")}</div></div>
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
      cfg.pipeline_contacts = $$("[data-pipec]", body).filter(x => x.checked).map(x => x.dataset.pipec);
      cfg.pipeline_statuses = $$("[data-pipes]", body).filter(x => x.checked).map(x => x.dataset.pipes);
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

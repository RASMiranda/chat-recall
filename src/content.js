// Content script for claude.ai: keeps a local index in sync and provides the Ctrl/Cmd+K search palette.
(() => {
  'use strict';
  const CR = globalThis.CR;
  const ext = globalThis.browser ?? globalThis.chrome;
  if (!CR || !ext?.storage?.local) return;
  if (window.top !== window) return;

  const t = CR.t;
  const store = CR.createStore(ext.storage.local);
  const client = CR.makeClient((u, o) => fetch(u, o));

  const SYNC_EVERY_MS = 10 * 60 * 1000;
  const LOCK_MS = 90 * 1000;
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

  const S = {
    entries: new Map(),
    projects: {},
    meta: {},
    sync: { phase: 'idle', done: 0, total: 0, errors: 0, result: null },
    ui: null,
    open: false,
    scope: 'all',
    sender: null, // null | 0 | 1
    results: [],
    sel: 0,
    timer: null
  };

  // ---------- helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const chatUrl = (id) => `${location.origin}/chat/${id}`;
  const currentChatId = () => (new RegExp(`^/chat/(${UUID})`, 'i').exec(location.pathname) || [])[1] || null;
  function currentProjectId() {
    const m = new RegExp(`^/projects?/(${UUID})`, 'i').exec(location.pathname);
    if (m) return m[1];
    const cid = currentChatId();
    const e = cid && S.entries.get(cid);
    return (e && e.project) || null;
  }

  function relTime(ms) {
    if (!ms) return t('time.never');
    const d = Date.now() - ms;
    if (d < 60e3) return t('time.justNow');
    if (d < 3600e3) return t('time.minutes', { n: Math.round(d / 60e3) });
    if (d < 86400e3) return t('time.hours', { n: Math.round(d / 3600e3) });
    return t('time.days', { n: Math.round(d / 86400e3) });
  }

  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
      return ok;
    }
  }

  // ---------- index + sync ----------
  function upsert(rawEntries) {
    for (const r of rawEntries) S.entries.set(r.id, CR.buildEntry(r));
    if (S.open) refreshStatus();
  }

  let lastPersist = 0;
  function onProgress(p) {
    S.sync = { ...S.sync, ...p };
    const now = Date.now();
    if (now - lastPersist > 1000) {
      lastPersist = now;
      store.setMeta({ status: S.sync.phase, done: S.sync.done, total: S.sync.total, errors: S.sync.errors, lock: now }).catch(() => {});
    }
    if (S.open) refreshStatus();
  }

  async function startSync({ full = false } = {}) {
    if (S.sync.phase === 'listing' || S.sync.phase === 'fetching') return;
    const meta = await store.loadMeta();
    const otherTabSyncing = meta.lock && Date.now() - meta.lock < LOCK_MS && (meta.status === 'listing' || meta.status === 'fetching');
    if (otherTabSyncing) return;
    onProgress({ phase: 'listing', done: 0, total: 0, errors: 0, result: null });
    let result;
    try {
      result = await CR.runSync({
        client, store, cookie: document.cookie, full,
        onProgress, onEntries: upsert, onProjects: (m) => { S.projects = m; }
      });
    } catch (e) {
      console.warn('[Chat Recall] sync failed', e);
      result = { status: 'error', errors: 1 };
    }
    S.sync = { ...S.sync, phase: 'idle', result };
    await store.setMeta({
      status: result.status === 'done' ? 'done' : result.status,
      lastSync: result.status === 'done' ? Date.now() : (S.meta.lastSync || 0),
      errors: result.errors || 0,
      done: S.sync.done,
      total: S.sync.total,
      lock: 0
    }).then((m) => { S.meta = m; }).catch(() => {});
    if (S.open) { refreshStatus(); runSearch(); }
  }

  // ---------- palette UI ----------
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .overlay { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.45); display: flex; justify-content: center; align-items: flex-start; padding-top: 10vh; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .panel { --bg:#fff; --fg:#1f1e1d; --muted:#6b6a68; --line:#e6e4df; --accent:#c96442; --hl:#fde9a8; --sel:#f4f1ea; width: min(780px, 94vw); max-height: 78vh; display: flex; flex-direction: column; background: var(--bg); color: var(--fg); border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.35); overflow: hidden; }
    .panel[data-dark="1"] { --bg:#262624; --fg:#ece9e2; --muted:#a09d96; --line:#3a3936; --accent:#e08a67; --hl:#6b5a1c; --sel:#32312e; }
    .top { padding: 14px 16px 8px; border-bottom: 1px solid var(--line); }
    input.q { width: 100%; font: inherit; font-size: 16px; border: 0; outline: 0; background: transparent; color: var(--fg); padding: 4px 0 10px; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .chip { font: inherit; font-size: 12px; border: 1px solid var(--line); background: transparent; color: var(--muted); padding: 3px 10px; border-radius: 999px; cursor: pointer; }
    .chip[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
    .chip[disabled] { opacity: .4; cursor: not-allowed; }
    .sep { width: 1px; height: 16px; background: var(--line); margin: 0 4px; }
    .results { overflow-y: auto; flex: 1; min-height: 80px; }
    .item { padding: 10px 16px; border-bottom: 1px solid var(--line); cursor: pointer; }
    .item[aria-selected="true"] { background: var(--sel); }
    .title { font-weight: 600; }
    .snip { color: var(--fg); opacity: .9; margin-top: 2px; word-break: break-word; }
    mark { background: var(--hl); color: inherit; border-radius: 3px; padding: 0 1px; }
    .meta { display: flex; gap: 10px; color: var(--muted); font-size: 12px; margin-top: 4px; flex-wrap: wrap; align-items: center; }
    .url { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46ch; }
    .copy { font: inherit; font-size: 11px; border: 1px solid var(--line); background: transparent; color: var(--muted); border-radius: 6px; padding: 1px 8px; cursor: pointer; }
    .empty { padding: 28px 16px; color: var(--muted); text-align: center; }
    .foot { display: flex; justify-content: space-between; gap: 12px; padding: 8px 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; align-items: center; }
    .foot .hints { display: flex; gap: 10px; white-space: nowrap; }
    .foot button { font: inherit; font-size: 12px; color: var(--accent); background: none; border: 0; cursor: pointer; padding: 0 0 0 8px; }
    .status.warn { color: #b3261e; }
  `;

  function isDark() {
    const de = document.documentElement;
    const tag = `${de.dataset.mode || ''} ${de.dataset.theme || ''} ${de.className || ''}`;
    if (/dark/i.test(tag)) return true;
    if (/light/i.test(tag)) return false;
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function buildUI() {
    const host = h('div', { id: 'chat-recall-host' });
    const root = host.attachShadow({ mode: 'closed' });
    const style = h('style');
    style.textContent = CSS;

    const input = h('input', { class: 'q', type: 'text', placeholder: t('palette.placeholder'), spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Search chats' });
    const scopeBtns = {
      all: h('button', { class: 'chip', type: 'button', onclick: () => setScope('all') }, t('scope.all')),
      project: h('button', { class: 'chip', type: 'button', onclick: () => setScope('project') }, t('scope.project')),
      chat: h('button', { class: 'chip', type: 'button', onclick: () => setScope('chat') }, t('scope.chat'))
    };
    const senderBtns = [
      h('button', { class: 'chip', type: 'button', onclick: () => setSender(null) }, t('sender.any')),
      h('button', { class: 'chip', type: 'button', onclick: () => setSender(0) }, t('sender.me')),
      h('button', { class: 'chip', type: 'button', onclick: () => setSender(1) }, t('sender.claude'))
    ];
    const chips = h('div', { class: 'chips' }, scopeBtns.all, scopeBtns.project, scopeBtns.chat, h('span', { class: 'sep' }), ...senderBtns);
    const results = h('div', { class: 'results', role: 'listbox' });
    const status = h('span', { class: 'status' });
    const syncBtn = h('button', { type: 'button', onclick: () => startSync() }, t('action.sync'));
    const hints = h('span', { class: 'hints' },
      h('span', null, t('hints.nav')), h('span', null, t('hints.open')), h('span', null, t('hints.newTab')), h('span', null, t('hints.close')));
    const foot = h('div', { class: 'foot' }, h('span', null, status, syncBtn), hints);
    const panel = h('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Chat Recall search' }, h('div', { class: 'top' }, input, chips), results, foot);
    // Close only on a real outside click (primary button): a right-click on the backdrop opens the browser menu.
    const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay && e.button === 0) closePalette(); } }, panel);
    root.append(style, overlay);

    input.addEventListener('input', () => {
      clearTimeout(S.timer);
      S.timer = setTimeout(runSearch, 80);
    });
    panel.addEventListener('keydown', onPanelKey);

    // claude.ai has document-level handlers that redirect paste/typing/focus to its composer. Events from the
    // palette must not reach them (they arrive retargeted to the host), or e.g. "Paste" from the browser's
    // context menu lands in the composer instead of here. Native default actions are not affected.
    for (const type of ['paste', 'beforeinput', 'input', 'keydown', 'keyup', 'keypress', 'contextmenu', 'focusin', 'focusout', 'compositionstart', 'compositionupdate', 'compositionend']) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }
    // If something else grabs focus while the palette is open (page focus management, the context menu closing), take it back.
    input.addEventListener('blur', () => {
      setTimeout(() => {
        const a = root.activeElement;
        if (S.open && S.ui?.input === input && document.hasFocus() && !(a && panel.contains(a))) input.focus();
      }, 0);
    });

    return { host, root, panel, input, scopeBtns, senderBtns, results, status, syncBtn };
  }

  function setScope(s) {
    if (s === 'project' && !currentProjectId()) return;
    if (s === 'chat' && !currentChatId()) return;
    S.scope = s;
    syncChips();
    runSearch();
    S.ui.input.focus();
  }

  function setSender(v) {
    S.sender = v;
    syncChips();
    runSearch();
    S.ui.input.focus();
  }

  function syncChips() {
    const u = S.ui;
    const hasProject = !!currentProjectId();
    const hasChat = !!currentChatId();
    if (S.scope === 'project' && !hasProject) S.scope = 'all';
    if (S.scope === 'chat' && !hasChat) S.scope = 'all';
    for (const [k, b] of Object.entries(u.scopeBtns)) {
      b.setAttribute('aria-pressed', String(S.scope === k));
      const disabled = (k === 'project' && !hasProject) || (k === 'chat' && !hasChat);
      b.disabled = disabled;
      b.title = disabled ? t(`scope.${k}.disabled`) : '';
    }
    u.senderBtns.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0 && S.sender == null) || i - 1 === S.sender)));
  }

  function refreshStatus() {
    if (!S.ui) return;
    const sp = S.sync;
    const el = S.ui.status;
    el.classList.remove('warn');
    let text;
    if (sp.phase === 'listing') text = t('status.listing');
    else if (sp.phase === 'fetching') text = t('status.indexing', { done: sp.done, total: sp.total });
    else if (sp.result?.status === 'auth' || S.meta.status === 'auth') { text = t('status.auth'); el.classList.add('warn'); }
    else if (sp.result?.errors || (S.meta.errors && S.meta.status === 'done')) { text = t('status.error', { errors: sp.result?.errors || S.meta.errors }); el.classList.add('warn'); }
    else if (!S.entries.size) text = t('status.empty');
    else text = `${t('status.ready', { n: S.entries.size })} · ${t('status.lastSync', { when: relTime(S.meta.lastSync) })}`;
    if (S.scope === 'project' && S.entries.size && ![...S.entries.values()].some((e) => e.project)) text += ` — ${t('status.noProject')}`;
    el.textContent = text;
    S.ui.syncBtn.disabled = sp.phase === 'listing' || sp.phase === 'fetching';
  }

  function renderSnippet(sn) {
    const frag = document.createDocumentFragment();
    if (sn.lead) frag.append('… ');
    let pos = 0;
    for (const [a, b] of sn.ranges) {
      if (a > pos) frag.append(sn.text.slice(pos, a));
      frag.append(h('mark', null, sn.text.slice(a, b)));
      pos = b;
    }
    if (pos < sn.text.length) frag.append(sn.text.slice(pos));
    if (sn.trail) frag.append(' …');
    return frag;
  }

  function projectName(id) {
    return id ? (S.projects[id] || '') : '';
  }

  function runSearch() {
    if (!S.ui) return;
    const q = CR.parseQuery(S.ui.input.value);
    if (S.sender != null) q.from = S.sender;
    const entries = [...S.entries.values()];
    const chatId = currentChatId();
    let items = [];
    let mode = 'chats';

    if (S.scope === 'chat' && chatId) {
      mode = 'messages';
      const e = S.entries.get(chatId);
      items = CR.searchChat(e, q).map((hit) => ({ kind: 'message', id: chatId, hit, title: e.title }));
    } else if (!q.terms.length && !q.excl.length && q.since == null && q.until == null && q.from == null) {
      const pid = S.scope === 'project' ? currentProjectId() : null;
      items = entries
        .filter((e) => !pid || e.project === pid)
        .sort((a, b) => b.updated - a.updated)
        .slice(0, 15)
        .map((e) => ({ kind: 'chat', id: e.id, title: e.title, updated: e.updated, project: e.project, matches: 0, best: null }));
      mode = 'recent';
    } else {
      items = CR.searchAll(entries, q, { projectId: S.scope === 'project' ? currentProjectId() : null }).map((r) => ({ kind: 'chat', ...r }));
    }

    S.query = q;
    S.results = items;
    S.sel = 0;
    renderResults(mode);
  }

  function renderResults(mode) {
    const box = S.ui.results;
    box.textContent = '';
    if (!S.results.length) {
      box.append(h('div', { class: 'empty' }, S.ui.input.value.trim() ? t('results.none') : t('results.hint')));
      return;
    }
    if (mode === 'recent') box.append(h('div', { class: 'empty', style: 'padding:8px 16px;text-align:left' }, t('results.recent')));
    S.results.forEach((r, i) => box.append(renderItem(r, i)));
    updateSel();
  }

  function renderItem(r, i) {
    const url = chatUrl(r.id);
    const title = r.title || t('untitled');
    const meta = h('div', { class: 'meta' });
    let snip = null;

    if (r.kind === 'message') {
      snip = r.hit.snippet;
      meta.append(h('span', null, r.hit.sender === 0 ? t('results.you') : t('results.claude')), h('span', null, t('results.inChatHit', { n: r.hit.index + 1 })));
    } else {
      if (r.best) {
        snip = r.best.snippet;
        meta.append(h('span', null, r.best.sender === 0 ? t('results.you') : t('results.claude')));
      }
      if (r.updated) meta.append(h('span', null, fmtDate(r.updated)));
      if (r.matches > 0) meta.append(h('span', null, t('results.matches', { n: r.matches })));
      const pn = projectName(r.project);
      if (pn) meta.append(h('span', null, pn));
    }
    meta.append(h('span', { class: 'url', title: url }, url));
    const copy = h('button', { class: 'copy', type: 'button', onclick: async (ev) => {
      ev.stopPropagation();
      const ok = await copyText(url);
      copy.textContent = ok ? t('action.copied') : '!';
      setTimeout(() => { copy.textContent = t('action.copy'); }, 1200);
    } }, t('action.copy'));
    meta.append(copy);

    return h('div', { class: 'item', role: 'option', 'data-i': i, onmousemove: () => { if (S.sel !== i) { S.sel = i; updateSel(); } }, onclick: (ev) => openResult(r, ev.ctrlKey || ev.metaKey) },
      h('div', { class: 'title' }, title),
      snip ? h('div', { class: 'snip' }, renderSnippet(snip)) : null,
      meta);
  }

  function updateSel() {
    const nodes = S.ui.results.querySelectorAll('.item');
    nodes.forEach((n) => {
      const on = Number(n.dataset.i) === S.sel;
      n.setAttribute('aria-selected', String(on));
      if (on) n.scrollIntoView({ block: 'nearest' });
    });
  }

  function onPanelKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = S.results.length;
      if (!n) return;
      S.sel = (S.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      updateSel();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = S.results[S.sel];
      if (r) openResult(r, e.ctrlKey || e.metaKey);
    }
  }

  function jumpTerms() {
    return (S.query?.terms || []).map((x) => x.raw);
  }

  function openResult(r, newTab) {
    const terms = jumpTerms();
    const inThisChat = r.id === currentChatId();
    closePalette();
    if (inThisChat) {
      if (terms.length) scheduleJump(terms, 3000);
      return;
    }
    if (terms.length) {
      try { sessionStorage.setItem('chat-recall:jump', JSON.stringify({ id: r.id, terms, ts: Date.now() })); } catch { /* ignore */ }
    }
    if (newTab) window.open(chatUrl(r.id), '_blank', 'noopener');
    else location.assign(chatUrl(r.id));
  }

  // ---------- jump to a match inside the open chat ----------
  function findTextNode(term) {
    const needle = CR.fold(term);
    if (!needle) return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest('nav, aside, script, style, textarea, input, #chat-recall-host')) return NodeFilter.FILTER_REJECT;
        return n.nodeValue && n.nodeValue.length >= needle.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let n;
    while ((n = walker.nextNode())) {
      const at = CR.fold(n.nodeValue).indexOf(needle);
      if (at !== -1) return { node: n, at, len: needle.length };
    }
    return null;
  }

  function scheduleJump(terms, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      for (const term of terms) {
        const hit = findTextNode(term);
        if (hit) {
          const range = document.createRange();
          range.setStart(hit.node, hit.at);
          range.setEnd(hit.node, hit.at + hit.len);
          const sel = getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          hit.node.parentElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return;
        }
      }
      if (Date.now() < deadline) setTimeout(attempt, 400);
    };
    attempt();
  }

  function consumePendingJump() {
    let raw;
    try { raw = sessionStorage.getItem('chat-recall:jump'); } catch { return; }
    if (!raw) return;
    try { sessionStorage.removeItem('chat-recall:jump'); } catch { /* ignore */ }
    try {
      const j = JSON.parse(raw);
      if (j && j.id === currentChatId() && Date.now() - j.ts < 60000) scheduleJump(j.terms || [], 12000);
    } catch { /* ignore */ }
  }

  // ---------- open / close ----------
  function openPalette() {
    if (!S.ui) S.ui = buildUI();
    S.ui.panel.dataset.dark = isDark() ? '1' : '0';
    if (!S.ui.host.isConnected) document.documentElement.append(S.ui.host);
    S.open = true;
    S.scope = currentChatId() ? 'all' : S.scope;
    syncChips();
    refreshStatus();
    runSearch();
    S.ui.input.focus();
    S.ui.input.select();
  }

  function closePalette() {
    S.open = false;
    if (S.ui?.host.isConnected) S.ui.host.remove();
  }

  function toggle() {
    if (S.open) closePalette();
    else openPalette();
  }

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggle();
    }
  }, true);

  // ---------- messages from the toolbar popup (via storage) ----------
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes['cr:cmd']?.newValue) return;
    const cmd = changes['cr:cmd'].newValue;
    if (cmd.type === 'cleared') { S.entries.clear(); S.projects = {}; S.meta = {}; if (S.open) { refreshStatus(); runSearch(); } }
    else if (cmd.type === 'sync') startSync({ full: !!cmd.full });
  });

  // ---------- init ----------
  (async function init() {
    try {
      const { entries, meta, projects } = await store.loadAll();
      for (const e of entries) S.entries.set(e.id, CR.buildEntry(e));
      S.projects = projects;
      S.meta = meta;
      consumePendingJump();
      const auto = meta.auto !== false;
      if (auto && Date.now() - (meta.lastSync || 0) > SYNC_EVERY_MS) startSync();
    } catch (e) {
      console.warn('[Chat Recall] init failed', e);
    }
  })();
})();

// claude.ai internal API access + response normalisers.
// These endpoints are undocumented and may change; every parser here is defensive on purpose.
(() => {
  'use strict';
  const CR = (globalThis.CR ??= {});

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  class ApiError extends Error {
    constructor(status, path) {
      super(`HTTP ${status} for ${path}`);
      this.name = 'ApiError';
      this.status = status;
      this.path = path;
    }
  }

  // fetchFn must behave like window.fetch (same-origin, so the session cookie is sent).
  function makeClient(fetchFn) {
    async function getJSON(path) {
      const res = await fetchFn(path, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) throw new ApiError(res.status, path);
      return res.json();
    }
    return { getJSON };
  }

  function asArray(x) {
    if (Array.isArray(x)) return x;
    if (x && typeof x === 'object') {
      for (const k of ['data', 'conversations', 'chat_conversations', 'items', 'results']) {
        if (Array.isArray(x[k])) return x[k];
      }
    }
    return [];
  }

  function orgFromCookie(cookie) {
    const m = /(?:^|;\s*)lastActiveOrg=([^;]+)/.exec(cookie || '');
    if (!m) return null;
    try {
      const v = decodeURIComponent(m[1]);
      return UUID_RE.test(v) ? v : null;
    } catch {
      return null;
    }
  }

  async function resolveOrg(client, cookie = '') {
    const fromCookie = orgFromCookie(cookie);
    if (fromCookie) return fromCookie;

    try {
      const orgs = asArray(await client.getJSON('/api/organizations')).filter((o) => o && UUID_RE.test(o.uuid || ''));
      const chatCapable = orgs.find((o) => Array.isArray(o.capabilities) && o.capabilities.includes('chat'));
      const pick = chatCapable || orgs[0];
      if (pick) return pick.uuid;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) throw e;
    }

    const boot = await client.getJSON('/api/bootstrap');
    const memberships = boot?.account?.memberships || [];
    for (const m of memberships) {
      const id = m?.organization?.uuid;
      if (id && UUID_RE.test(id)) return id;
    }
    throw new Error('Could not determine your claude.ai organization id');
  }

  function normalizeListItem(raw) {
    const id = raw?.uuid || raw?.id || null;
    const updatedRaw = raw?.updated_at || raw?.created_at || '';
    return {
      id,
      title: String(raw?.name || raw?.title || '').trim(),
      updatedRaw: String(updatedRaw),
      updated: Date.parse(updatedRaw) || 0,
      project: raw?.project_uuid || raw?.project?.uuid || null
    };
  }

  function projectsToMap(raw) {
    const map = {};
    for (const p of asArray(raw)) {
      const id = p?.uuid || p?.id;
      if (id) map[id] = String(p?.name || '').trim();
    }
    return map;
  }

  // Returns [[0|1, text], ...]  (0 = you, 1 = Claude). Thinking blocks and tool plumbing are skipped.
  function extractMessages(detail) {
    const list = detail?.chat_messages || detail?.messages || [];
    const out = [];
    for (const m of list) {
      const sender = m?.sender === 'human' || m?.role === 'user' ? 0 : 1;
      const parts = [];
      if (Array.isArray(m?.content)) {
        for (const b of m.content) {
          if (typeof b === 'string') parts.push(b);
          else if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
        }
      }
      let text = parts.join('\n').trim();
      if (!text && typeof m?.text === 'string') text = m.text.trim();
      if (text) out.push([sender, text]);
    }
    return out;
  }

  function detailProject(detail) {
    return detail?.project_uuid || detail?.project?.uuid || null;
  }

  Object.assign(CR, {
    ApiError, makeClient, asArray, orgFromCookie, resolveOrg,
    normalizeListItem, projectsToMap, extractMessages, detailProject, UUID_RE
  });
  if (typeof module !== 'undefined') module.exports = CR;
})();

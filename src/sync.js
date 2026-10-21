// Incremental sync engine. Dependencies are injected so it can be tested without a browser.
(() => {
  'use strict';
  const CR = (globalThis.CR ??= {});

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isRetryable(e) {
    if (e && typeof e.status === 'number') return e.status === 429 || e.status >= 500;
    return true; // network error
  }

  async function withRetry(fn, { attempts = 3, baseMs = 400, sleepFn = sleep } = {}) {
    let last;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        if (!isRetryable(e) || i === attempts - 1) break;
        await sleepFn(baseMs * 2 ** i + Math.floor(Math.random() * 150));
      }
    }
    throw last;
  }

  /**
   * deps: { client, store, cookie, concurrency, delayMs, full, sleepFn,
   *         onProgress(state), onEntries(rawEntries[]), onProjects(map) }
   * Returns { status: 'done'|'auth', total, fetched, errors, skipped }
   */
  async function runSync(deps) {
    const {
      client, store, cookie = '', concurrency = 3, delayMs = 120, full = false,
      sleepFn = sleep, onProgress = () => {}, onEntries = () => {}, onProjects = () => {}
    } = deps;

    onProgress({ phase: 'listing', done: 0, total: 0, errors: 0 });

    let org;
    let list;
    try {
      org = await CR.resolveOrg(client, cookie);
      list = CR.asArray(await client.getJSON(`/api/organizations/${org}/chat_conversations`))
        .map(CR.normalizeListItem)
        .filter((c) => c.id);
    } catch (e) {
      if (e && (e.status === 401 || e.status === 403)) return { status: 'auth', total: 0, fetched: 0, errors: 0, skipped: 0 };
      throw e;
    }

    // Project names (best effort).
    let projectNames = {};
    try {
      projectNames = CR.projectsToMap(await client.getJSON(`/api/organizations/${org}/projects`));
    } catch { /* optional */ }
    if (Object.keys(projectNames).length) {
      await store.saveProjects(projectNames);
      onProjects(projectNames);
    }

    // Fallback for project membership: only when the list carries no project info at all.
    const projectOf = {};
    if (Object.keys(projectNames).length && !list.some((c) => c.project)) {
      for (const pid of Object.keys(projectNames)) {
        try {
          const convs = CR.asArray(await client.getJSON(`/api/organizations/${org}/projects/${pid}/conversations`));
          for (const c of convs) {
            const id = c?.uuid || c?.id;
            if (id) projectOf[id] = pid;
          }
        } catch { /* endpoint may not exist */ }
      }
    }

    const idx = await store.loadIdx();
    const need = list
      .filter((c) => full || !idx[c.id] || idx[c.id].u !== c.updatedRaw)
      .sort((a, b) => b.updated - a.updated);

    const state = { phase: 'fetching', done: 0, total: need.length, errors: 0 };
    let skipped = 0;
    let authFailed = false;
    const buffer = [];
    const idxPatch = {};
    onProgress({ ...state });

    async function flush() {
      if (!buffer.length) return;
      const batch = buffer.splice(0, buffer.length);
      const patch = {};
      for (const e of batch) patch[e.id] = idxPatch[e.id];
      await store.putMany(batch, patch);
      onEntries(batch);
    }

    let cursor = 0;
    async function worker() {
      while (!authFailed) {
        const i = cursor++;
        if (i >= need.length) return;
        const c = need[i];
        try {
          const detail = await withRetry(
            () => client.getJSON(`/api/organizations/${org}/chat_conversations/${c.id}`),
            { sleepFn }
          );
          const msgs = CR.extractMessages(detail);
          const title = String(detail?.name || c.title || '').trim();
          buffer.push({
            id: c.id,
            t: title,
            u: c.updated || Date.parse(detail?.updated_at) || 0,
            p: CR.detailProject(detail) || c.project || projectOf[c.id] || null,
            m: msgs
          });
          idxPatch[c.id] = { u: c.updatedRaw };
        } catch (e) {
          if (e && (e.status === 401 || e.status === 403)) authFailed = true;
          else if (e && e.status === 404) skipped++;
          else state.errors++;
        }
        state.done++;
        if (buffer.length >= 10) await flush();
        onProgress({ ...state });
        if (delayMs) await sleepFn(delayMs);
      }
    }

    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    await flush();

    if (authFailed) return { status: 'auth', total: need.length, fetched: state.done, errors: state.errors, skipped };
    return { status: 'done', total: need.length, fetched: state.done - state.errors - skipped, errors: state.errors, skipped };
  }

  Object.assign(CR, { runSync, withRetry });
  if (typeof module !== 'undefined') module.exports = CR;
})();

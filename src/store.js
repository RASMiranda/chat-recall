// Thin wrapper over extension storage (chrome.storage.local / browser.storage.local).
// `area` must expose promise-based get/set/remove.
(() => {
  'use strict';
  const CR = (globalThis.CR ??= {});

  const K_META = 'cr:meta';
  const K_IDX = 'cr:idx';
  const K_PROJ = 'cr:projects';
  const P_CONV = 'cr:c:';

  function createStore(area) {
    async function loadAll() {
      const all = await area.get(null);
      const entries = [];
      for (const k of Object.keys(all)) if (k.startsWith(P_CONV)) entries.push(all[k]);
      return { entries, meta: all[K_META] || {}, idx: all[K_IDX] || {}, projects: all[K_PROJ] || {} };
    }

    async function loadIdx() {
      const r = await area.get(K_IDX);
      return r[K_IDX] || {};
    }

    async function loadMeta() {
      const r = await area.get(K_META);
      return r[K_META] || {};
    }

    async function setMeta(patch) {
      const cur = await loadMeta();
      const next = { ...cur, ...patch };
      await area.set({ [K_META]: next });
      return next;
    }

    // entries: [{id,t,u,p,m}], idxPatch: {id: {u: updatedRaw}}
    async function putMany(entries, idxPatch) {
      const idx = await loadIdx();
      const payload = {};
      for (const e of entries) payload[P_CONV + e.id] = e;
      payload[K_IDX] = { ...idx, ...idxPatch };
      await area.set(payload);
    }

    async function saveProjects(map) {
      await area.set({ [K_PROJ]: map });
    }

    async function clearAll() {
      const all = await area.get(null);
      const keys = Object.keys(all).filter((k) => k.startsWith('cr:') && k !== K_META);
      if (keys.length) await area.remove(keys);
      await area.set({ [K_META]: { lastSync: 0, status: 'idle', done: 0, total: 0, errors: 0, auto: (all[K_META] || {}).auto } });
    }

    return { loadAll, loadIdx, loadMeta, setMeta, putMany, saveProjects, clearAll };
  }

  CR.createStore = createStore;
  CR.STORE_KEYS = { K_META, K_IDX, K_PROJ, P_CONV };
  if (typeof module !== 'undefined') module.exports = CR;
})();

// Pure search logic: no DOM, no extension APIs. Unit-tested under Node.
(() => {
  'use strict';
  const CR = (globalThis.CR ??= {});

  const ASCII = /^[\x00-\x7f]*$/;
  const WS = /\s/;
  const DAY = 86400000;

  // Length-preserving fold: lower-case, whitespace -> ' ', strip accents on Latin letters only.
  // Same length as the input, so match offsets in the folded text map 1:1 onto the original text.
  function fold(input) {
    const s = String(input ?? '');
    if (ASCII.test(s)) return s.toLowerCase().replace(/\s/g, ' ');
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (WS.test(ch)) { out += ' '; continue; }
      const code = ch.charCodeAt(0);
      let f = ch;
      if ((code >= 0xc0 && code <= 0x24f) || (code >= 0x1e00 && code <= 0x1eff)) {
        f = ch.normalize('NFD')[0] || ch;
      }
      const l = f.toLowerCase();
      out += l.length === 1 ? l : f;
    }
    return out;
  }

  function parseRelative(v, now) {
    const m = /^(\d+)([dwmy])$/i.exec(v);
    if (!m) return null;
    const n = Number(m[1]);
    const unit = { d: DAY, w: 7 * DAY, m: 30 * DAY, y: 365 * DAY }[m[2].toLowerCase()];
    return now - n * unit;
  }

  function parseDate(v, endOfDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const t = new Date(`${v}T00:00:00`).getTime();
    if (Number.isNaN(t)) return null;
    return endOfDay ? t + DAY - 1 : t;
  }

  function parseQuery(input, now = Date.now()) {
    const q = { terms: [], excl: [], from: null, since: null, until: null, raw: String(input ?? '') };
    const re = /(-?)"([^"]+)"|(\S+)/g;
    const seen = new Set();
    let m;
    while ((m = re.exec(q.raw))) {
      if (m[2] !== undefined) {
        const f = fold(m[2].trim());
        if (!f) continue;
        if (m[1] === '-') q.excl.push({ raw: m[2], f });
        else if (!seen.has(f)) { seen.add(f); q.terms.push({ raw: m[2], f }); }
        continue;
      }
      const tok = m[3];
      const kv = /^(from|since|until):(.*)$/i.exec(tok);
      if (kv) {
        const key = kv[1].toLowerCase();
        const val = kv[2].trim();
        if (key === 'from') {
          const v = val.toLowerCase();
          if (['me', 'user', 'human', 'you'].includes(v)) q.from = 0;
          else if (['claude', 'assistant', 'ai'].includes(v)) q.from = 1;
        } else if (key === 'since') {
          const t = parseRelative(val, now) ?? parseDate(val, false);
          if (t != null) q.since = t;
        } else {
          const t = parseRelative(val, now) ?? parseDate(val, true);
          if (t != null) q.until = t;
        }
        continue;
      }
      if (tok.length > 1 && tok[0] === '-') {
        const f = fold(tok.slice(1));
        if (f) q.excl.push({ raw: tok.slice(1), f });
        continue;
      }
      const f = fold(tok);
      if (f && !seen.has(f)) { seen.add(f); q.terms.push({ raw: tok, f }); }
    }
    return q;
  }

  function buildEntry(raw) {
    const title = raw.t || '';
    return {
      id: raw.id,
      title,
      titleF: fold(title),
      updated: Number(raw.u) || 0,
      project: raw.p || null,
      msgs: (raw.m || []).map(([s, t]) => ({ s, t, f: fold(t) }))
    };
  }

  // Snippet around the first match. Returns plain text + highlight ranges (offsets into .text).
  function makeSnippet(msg, terms, { before = 60, after = 110 } = {}) {
    const f = msg.f;
    let first = -1;
    for (const t of terms) {
      const p = f.indexOf(t);
      if (p !== -1 && (first === -1 || p < first)) first = p;
    }
    let start = first === -1 ? 0 : Math.max(0, first - before);
    let end = Math.min(msg.t.length, (first === -1 ? 0 : first) + after + before);
    if (start > 0) { const sp = f.indexOf(' ', start); if (sp !== -1 && sp < first) start = sp + 1; }
    const slice = f.slice(start, end);
    const ranges = [];
    for (const t of terms) {
      let from = 0;
      let guard = 0;
      while (guard++ < 30) {
        const p = slice.indexOf(t, from);
        if (p === -1) break;
        ranges.push([p, p + t.length]);
        from = p + Math.max(1, t.length);
      }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    }
    return {
      text: msg.t.slice(start, end).replace(/\s/g, ' '),
      ranges: merged,
      lead: start > 0,
      trail: end < msg.t.length
    };
  }

  function searchAll(entries, q, { projectId = null, chatId = null, limit = 50 } = {}) {
    const terms = q.terms.map((t) => t.f);
    const hasFilters = q.since != null || q.until != null || q.from != null || q.excl.length > 0;
    if (!terms.length && !hasFilters) return [];

    const out = [];
    for (const e of entries) {
      if (chatId && e.id !== chatId) continue;
      if (projectId && e.project !== projectId) continue;
      if (q.since != null && e.updated < q.since) continue;
      if (q.until != null && e.updated > q.until) continue;

      const present = new Array(terms.length).fill(false);
      let titleHits = 0;
      for (let i = 0; i < terms.length; i++) {
        if (e.titleF.includes(terms[i])) { present[i] = true; titleHits++; }
      }

      let excluded = false;
      for (const x of q.excl) if (e.titleF.includes(x.f)) { excluded = true; break; }

      let matched = 0;
      let allInOne = 0;
      let bestIdx = -1;
      let bestScore = -1;
      let senderSeen = q.from == null;
      if (!excluded) {
        for (let mi = 0; mi < e.msgs.length; mi++) {
          const m = e.msgs[mi];
          let ex = false;
          for (const x of q.excl) if (m.f.includes(x.f)) { ex = true; break; }
          if (ex) { excluded = true; break; }
          if (q.from != null && m.s !== q.from) continue;
          senderSeen = true;
          let k = 0;
          for (let i = 0; i < terms.length; i++) {
            if (m.f.includes(terms[i])) { present[i] = true; k++; }
          }
          if (k > 0) {
            matched++;
            if (k === terms.length) allInOne++;
            const sc = k * 1000 - mi;
            if (sc > bestScore) { bestScore = sc; bestIdx = mi; }
          } else if (!terms.length && bestIdx === -1) {
            bestIdx = mi; // filter-only query: show the first eligible message
          }
        }
      }
      if (excluded || !senderSeen) continue;
      if (terms.length && !present.every(Boolean)) continue;

      const presentCount = present.filter(Boolean).length;
      const score = presentCount * 10 + titleHits * 8 + Math.min(allInOne, 10) * 4 + Math.min(matched, 20) + e.updated / 1e15;
      let best = null;
      const bm = bestIdx >= 0 ? e.msgs[bestIdx] : e.msgs[0];
      if (bm) best = { index: bestIdx >= 0 ? bestIdx : 0, sender: bm.s, snippet: makeSnippet(bm, terms) };
      out.push({ id: e.id, title: e.title, updated: e.updated, project: e.project, score, matches: matched, best });
    }
    out.sort((a, b) => b.score - a.score || b.updated - a.updated);
    return out.slice(0, limit);
  }

  // Message-level hits inside one chat.
  function searchChat(entry, q, { limit = 200 } = {}) {
    const terms = q.terms.map((t) => t.f);
    if (!entry || !terms.length) return [];
    const hits = [];
    for (let mi = 0; mi < entry.msgs.length; mi++) {
      const m = entry.msgs[mi];
      if (q.from != null && m.s !== q.from) continue;
      let k = 0;
      for (const t of terms) if (m.f.includes(t)) k++;
      if (k > 0) hits.push({ index: mi, sender: m.s, k, snippet: makeSnippet(m, terms) });
    }
    hits.sort((a, b) => b.k - a.k || a.index - b.index);
    return hits.slice(0, limit);
  }

  Object.assign(CR, { fold, parseQuery, buildEntry, makeSnippet, searchAll, searchChat });
  if (typeof module !== 'undefined') module.exports = CR;
})();

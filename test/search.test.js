'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CR = require('../src/search.js');

const DAY = 86400000;
const NOW = new Date('2026-10-19T12:00:00').getTime();

function mk(id, title, msgs, { u = NOW, p = null } = {}) {
  return CR.buildEntry({ id, t: title, u, p, m: msgs });
}

test('fold preserves length and strips Latin accents only', () => {
  for (const s of ['Hello World', 'Café Münster', 'İstanbul', 'tab\tand\nnewline', '한국어 テスト', 'naïve 😀 smile']) {
    assert.equal(CR.fold(s).length, s.length, s);
  }
  assert.equal(CR.fold('Café Münster'), 'cafe munster');
  assert.equal(CR.fold('a\nb'), 'a b');
  // Korean syllables must not collapse onto each other.
  assert.notEqual(CR.fold('한'), CR.fold('해'));
});

test('parseQuery: terms, phrases, exclusions, filters', () => {
  const q = CR.parseQuery('java "spring boot" -angular from:me since:2025-01-01 until:2025-06-30', NOW);
  assert.deepEqual(q.terms.map((t) => t.f), ['java', 'spring boot']);
  assert.deepEqual(q.excl.map((t) => t.f), ['angular']);
  assert.equal(q.from, 0);
  assert.equal(q.since, new Date('2025-01-01T00:00:00').getTime());
  assert.equal(q.until, new Date('2025-06-30T00:00:00').getTime() + DAY - 1);
});

test('parseQuery: relative dates and sender aliases', () => {
  const q = CR.parseQuery('since:7d from:claude', NOW);
  assert.equal(q.since, NOW - 7 * DAY);
  assert.equal(q.from, 1);
  assert.equal(CR.parseQuery('until:3m', NOW).until, NOW - 90 * DAY);
});

test('parseQuery: bad filter values are ignored, lone dash is a term', () => {
  const q = CR.parseQuery('since:nonsense - word', NOW);
  assert.equal(q.since, null);
  assert.deepEqual(q.terms.map((t) => t.f), ['-', 'word']);
});

test('searchAll: AND across the whole chat, case and accent insensitive', () => {
  const entries = [
    mk('a', 'Gmail filter', [[0, 'How do I filter by Cafe name?'], [1, 'Use a search operator in Gmail.']]),
    mk('b', 'Cooking', [[0, 'best espresso café in town']])
  ];
  const r = CR.searchAll(entries, CR.parseQuery('GMAIL cafe', NOW));
  assert.deepEqual(r.map((x) => x.id), ['a']);
  const r2 = CR.searchAll(entries, CR.parseQuery('cafe', NOW));
  assert.deepEqual(r2.map((x) => x.id).sort(), ['a', 'b']);
});

test('searchAll: phrase, exclusion, sender and date filters', () => {
  const entries = [
    mk('a', 'One', [[0, 'spring boot actuator'], [1, 'angular too']], { u: NOW - 2 * DAY }),
    mk('b', 'Two', [[0, 'spring boot only']], { u: NOW - 40 * DAY }),
    mk('c', 'Three', [[1, 'spring and boot apart']], { u: NOW })
  ];
  const ids = (s) => CR.searchAll(entries, CR.parseQuery(s, NOW)).map((x) => x.id).sort();
  assert.deepEqual(ids('"spring boot"'), ['a', 'b']);
  assert.deepEqual(ids('"spring boot" -angular'), ['b']);
  assert.deepEqual(ids('spring from:claude'), ['c']);
  assert.deepEqual(ids('spring since:7d'), ['a', 'c']);
  assert.deepEqual(ids('spring until:7d'), ['b']);
});

test('searchAll: scoping by project and by chat', () => {
  const entries = [
    mk('a', 'A', [[0, 'needle here']], { p: 'p1' }),
    mk('b', 'B', [[0, 'needle there']], { p: 'p2' }),
    mk('c', 'C', [[0, 'needle again']], { p: null })
  ];
  const q = CR.parseQuery('needle', NOW);
  assert.deepEqual(CR.searchAll(entries, q, { projectId: 'p1' }).map((x) => x.id), ['a']);
  assert.deepEqual(CR.searchAll(entries, q, { chatId: 'c' }).map((x) => x.id), ['c']);
});

test('searchAll: title hits rank above body-only hits; empty query returns nothing', () => {
  const entries = [
    mk('body', 'Unrelated', [[0, 'we talked about docker today']]),
    mk('title', 'Docker networking', [[0, 'hello']])
  ];
  assert.equal(CR.searchAll(entries, CR.parseQuery('docker', NOW))[0].id, 'title');
  assert.deepEqual(CR.searchAll(entries, CR.parseQuery('   ', NOW)), []);
});

test('searchAll: filter-only queries list matching chats', () => {
  const entries = [mk('old', 'Old', [[0, 'x']], { u: NOW - 90 * DAY }), mk('new', 'New', [[0, 'y']], { u: NOW })];
  const r = CR.searchAll(entries, CR.parseQuery('since:7d', NOW));
  assert.deepEqual(r.map((x) => x.id), ['new']);
});

test('snippet: highlight ranges point at the matched text', () => {
  const long = `${'lorem ipsum '.repeat(30)}The QUICK brown fox. ${'dolor sit '.repeat(30)}`;
  const e = mk('a', 'T', [[0, long]]);
  const [r] = CR.searchAll([e], CR.parseQuery('quick brown', NOW));
  const sn = r.best.snippet;
  assert.ok(sn.lead && sn.trail);
  const marked = sn.ranges.map(([a, b]) => sn.text.slice(a, b).toLowerCase());
  assert.deepEqual(marked, ['quick', 'brown']);

  // As a quoted phrase it is one highlight.
  const [p] = CR.searchAll([e], CR.parseQuery('"quick brown"', NOW));
  const pm = p.best.snippet.ranges.map(([a, b]) => p.best.snippet.text.slice(a, b).toLowerCase());
  assert.deepEqual(pm, ['quick brown']);
});

test('snippet offsets stay correct with accents and newlines', () => {
  const e = mk('a', 'T', [[0, 'Première ligne\nLa Café est ouverte']]);
  const [r] = CR.searchAll([e], CR.parseQuery('cafe', NOW));
  const sn = r.best.snippet;
  assert.equal(sn.text.slice(sn.ranges[0][0], sn.ranges[0][1]), 'Café');
});

test('searchChat returns message-level hits, most terms first', () => {
  const e = mk('a', 'T', [[0, 'alpha'], [1, 'alpha beta'], [0, 'beta']]);
  const hits = CR.searchChat(e, CR.parseQuery('alpha beta', NOW));
  assert.deepEqual(hits.map((h) => h.index), [1, 0, 2]);
  assert.deepEqual(CR.searchChat(e, CR.parseQuery('alpha from:me', NOW)).map((h) => h.index), [0]);
});

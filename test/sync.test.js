'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/api.js');
require('../src/store.js');
const CR = require('../src/sync.js');

const ORG = '11111111-2222-3333-4444-555555555555';
const noSleep = async () => {};

function memArea() {
  const data = {};
  return {
    data,
    async get(k) {
      if (k === null) return JSON.parse(JSON.stringify(data));
      return k in data ? { [k]: JSON.parse(JSON.stringify(data[k])) } : {};
    },
    async set(o) { for (const [k, v] of Object.entries(o)) data[k] = JSON.parse(JSON.stringify(v)); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; }
  };
}

function convo(id, updated, project) {
  return { uuid: id, name: `Chat ${id}`, updated_at: updated, ...(project ? { project_uuid: project } : {}) };
}

function makeClient(routes, calls = []) {
  return {
    async getJSON(path) {
      calls.push(path);
      const v = typeof routes[path] === 'function' ? routes[path]() : routes[path];
      if (v === undefined) throw new CR.ApiError(404, path);
      if (v instanceof Error) throw v;
      return v;
    }
  };
}

const cookie = `lastActiveOrg=${ORG}`;

test('first sync stores every chat; second sync fetches only changed ones', async () => {
  const area = memArea();
  const store = CR.createStore(area);
  const list = [convo('c1', '2026-10-01T00:00:00Z'), convo('c2', '2026-10-02T00:00:00Z')];
  const calls = [];
  const routes = {
    [`/api/organizations/${ORG}/chat_conversations`]: () => list,
    [`/api/organizations/${ORG}/projects`]: [],
    [`/api/organizations/${ORG}/chat_conversations/c1`]: { name: 'Chat c1', chat_messages: [{ sender: 'human', text: 'hello one' }] },
    [`/api/organizations/${ORG}/chat_conversations/c2`]: { name: 'Chat c2', chat_messages: [{ sender: 'human', text: 'hello two' }, { sender: 'assistant', text: 'reply' }] }
  };
  const seen = [];
  const r1 = await CR.runSync({ client: makeClient(routes, calls), store, cookie, sleepFn: noSleep, delayMs: 0, onEntries: (e) => seen.push(...e) });
  assert.equal(r1.status, 'done');
  assert.equal(r1.fetched, 2);
  assert.equal(seen.length, 2);
  const all = await store.loadAll();
  assert.equal(all.entries.length, 2);
  assert.equal(all.entries.find((e) => e.id === 'c2').m.length, 2);

  calls.length = 0;
  const r2 = await CR.runSync({ client: makeClient(routes, calls), store, cookie, sleepFn: noSleep, delayMs: 0 });
  assert.equal(r2.total, 0);
  assert.ok(!calls.some((p) => /chat_conversations\/c\d/.test(p)), 'no detail fetches when nothing changed');

  list[1] = convo('c2', '2026-10-05T00:00:00Z');
  calls.length = 0;
  const r3 = await CR.runSync({ client: makeClient(routes, calls), store, cookie, sleepFn: noSleep, delayMs: 0 });
  assert.equal(r3.fetched, 1);
  assert.deepEqual(calls.filter((p) => /chat_conversations\/c\d/.test(p)), [`/api/organizations/${ORG}/chat_conversations/c2`]);
});

test('project membership: from list, from detail, and per-project fallback', async () => {
  const area = memArea();
  const store = CR.createStore(area);
  const routes = {
    [`/api/organizations/${ORG}/chat_conversations`]: [convo('c1', '2026-10-01T00:00:00Z'), convo('c2', '2026-10-02T00:00:00Z'), convo('c3', '2026-10-03T00:00:00Z')],
    [`/api/organizations/${ORG}/projects`]: [{ uuid: 'p1', name: 'Alpha' }],
    [`/api/organizations/${ORG}/projects/p1/conversations`]: [{ uuid: 'c1' }, { uuid: 'c3' }],
    [`/api/organizations/${ORG}/chat_conversations/c1`]: { chat_messages: [{ sender: 'human', text: 'x' }] },
    [`/api/organizations/${ORG}/chat_conversations/c2`]: { project_uuid: 'p9', chat_messages: [{ sender: 'human', text: 'y' }] },
    [`/api/organizations/${ORG}/chat_conversations/c3`]: { chat_messages: [{ sender: 'human', text: 'z' }] }
  };
  await CR.runSync({ client: makeClient(routes), store, cookie, sleepFn: noSleep, delayMs: 0 });
  const { entries, projects } = await store.loadAll();
  const byId = Object.fromEntries(entries.map((e) => [e.id, e.p]));
  assert.deepEqual(byId, { c1: 'p1', c2: 'p9', c3: 'p1' });
  assert.deepEqual(projects, { p1: 'Alpha' });
});

test('transient errors are retried; hard failures are counted but do not stop the sync', async () => {
  const store = CR.createStore(memArea());
  let flaky = 0;
  const routes = {
    [`/api/organizations/${ORG}/chat_conversations`]: [convo('ok', '2026-10-01T00:00:00Z'), convo('flaky', '2026-10-02T00:00:00Z'), convo('bad', '2026-10-03T00:00:00Z'), convo('gone', '2026-10-04T00:00:00Z')],
    [`/api/organizations/${ORG}/projects`]: [],
    [`/api/organizations/${ORG}/chat_conversations/ok`]: { chat_messages: [{ sender: 'human', text: 'fine' }] },
    [`/api/organizations/${ORG}/chat_conversations/flaky`]: () => {
      if (flaky++ < 2) return new CR.ApiError(429, 'x');
      return { chat_messages: [{ sender: 'human', text: 'eventually' }] };
    },
    [`/api/organizations/${ORG}/chat_conversations/bad`]: new CR.ApiError(500, 'x')
    // 'gone' -> 404 (not in routes)
  };
  const r = await CR.runSync({ client: makeClient(routes), store, cookie, sleepFn: noSleep, delayMs: 0 });
  assert.equal(r.status, 'done');
  assert.equal(r.errors, 1);
  assert.equal(r.skipped, 1);
  const ids = (await store.loadAll()).entries.map((e) => e.id).sort();
  assert.deepEqual(ids, ['flaky', 'ok']);
});

test('401 on the list reports auth and stores nothing', async () => {
  const store = CR.createStore(memArea());
  const routes = { [`/api/organizations/${ORG}/chat_conversations`]: new CR.ApiError(401, 'x') };
  const r = await CR.runSync({ client: makeClient(routes), store, cookie, sleepFn: noSleep, delayMs: 0 });
  assert.equal(r.status, 'auth');
  assert.equal((await store.loadAll()).entries.length, 0);
});

test('401 mid-sync aborts with auth but keeps what was already saved', async () => {
  const store = CR.createStore(memArea());
  const routes = {
    [`/api/organizations/${ORG}/chat_conversations`]: [convo('a', '2026-10-02T00:00:00Z'), convo('b', '2026-10-01T00:00:00Z')],
    [`/api/organizations/${ORG}/projects`]: [],
    [`/api/organizations/${ORG}/chat_conversations/a`]: { chat_messages: [{ sender: 'human', text: 'first' }] },
    [`/api/organizations/${ORG}/chat_conversations/b`]: new CR.ApiError(401, 'x')
  };
  const r = await CR.runSync({ client: makeClient(routes), store, cookie, sleepFn: noSleep, delayMs: 0, concurrency: 1 });
  assert.equal(r.status, 'auth');
  assert.deepEqual((await store.loadAll()).entries.map((e) => e.id), ['a']);
});

test('clearAll removes the index but keeps the auto-sync preference', async () => {
  const area = memArea();
  const store = CR.createStore(area);
  await store.setMeta({ auto: false, lastSync: 5 });
  await store.putMany([{ id: 'x', t: 't', u: 1, p: null, m: [] }], { x: { u: '1' } });
  await store.clearAll();
  const all = await store.loadAll();
  assert.equal(all.entries.length, 0);
  assert.equal(all.meta.auto, false);
  assert.equal(all.meta.lastSync, 0);
});

test('withRetry gives up on non-retryable errors immediately', async () => {
  let n = 0;
  await assert.rejects(() => CR.withRetry(async () => { n++; throw new CR.ApiError(403, 'x'); }, { sleepFn: noSleep }));
  assert.equal(n, 1);
});

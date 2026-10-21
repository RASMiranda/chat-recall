'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CR = require('../src/api.js');

const ORG = '11111111-2222-3333-4444-555555555555';

function fakeClient(routes) {
  return {
    async getJSON(path) {
      if (!(path in routes)) throw new CR.ApiError(404, path);
      const v = routes[path];
      if (v instanceof Error) throw v;
      return v;
    }
  };
}

test('orgFromCookie only accepts uuids', () => {
  assert.equal(CR.orgFromCookie(`a=1; lastActiveOrg=${ORG}; b=2`), ORG);
  assert.equal(CR.orgFromCookie('lastActiveOrg=nonsense'), null);
  assert.equal(CR.orgFromCookie(''), null);
});

test('resolveOrg: cookie, then /api/organizations, then bootstrap', async () => {
  assert.equal(await CR.resolveOrg(fakeClient({}), `lastActiveOrg=${ORG}`), ORG);

  const orgs = fakeClient({ '/api/organizations': [{ uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', capabilities: ['api'] }, { uuid: ORG, capabilities: ['chat'] }] });
  assert.equal(await CR.resolveOrg(orgs, ''), ORG);

  const boot = fakeClient({ '/api/organizations': new CR.ApiError(500, 'x'), '/api/bootstrap': { account: { memberships: [{ organization: { uuid: ORG } }] } } });
  assert.equal(await CR.resolveOrg(boot, ''), ORG);

  const denied = fakeClient({ '/api/organizations': new CR.ApiError(401, 'x') });
  await assert.rejects(() => CR.resolveOrg(denied, ''), (e) => e.status === 401);
});

test('normalizeListItem handles both project shapes and missing fields', () => {
  const a = CR.normalizeListItem({ uuid: 'u1', name: ' Hi ', updated_at: '2026-01-02T03:04:05Z', project_uuid: 'p1' });
  assert.equal(a.id, 'u1');
  assert.equal(a.title, 'Hi');
  assert.equal(a.project, 'p1');
  assert.equal(a.updated, Date.parse('2026-01-02T03:04:05Z'));
  assert.equal(CR.normalizeListItem({ uuid: 'u2', project: { uuid: 'p2' } }).project, 'p2');
  assert.equal(CR.normalizeListItem({ uuid: 'u3' }).project, null);
  assert.equal(CR.normalizeListItem({}).id, null);
});

test('asArray tolerates wrapped payloads', () => {
  assert.deepEqual(CR.asArray([1]), [1]);
  assert.deepEqual(CR.asArray({ data: [2] }), [2]);
  assert.deepEqual(CR.asArray({ conversations: [3] }), [3]);
  assert.deepEqual(CR.asArray(null), []);
});

test('extractMessages: text field, content blocks, skips thinking/tools/empty', () => {
  const detail = {
    chat_messages: [
      { sender: 'human', text: 'question one' },
      { sender: 'assistant', text: '', content: [{ type: 'thinking', thinking: 'secret' }, { type: 'text', text: 'answer part A' }, { type: 'tool_use', name: 'x' }, { type: 'text', text: 'answer part B' }] },
      { sender: 'assistant', text: '   ' },
      { sender: 'human', content: [{ type: 'text', text: 'blocks only' }] }
    ]
  };
  assert.deepEqual(CR.extractMessages(detail), [
    [0, 'question one'],
    [1, 'answer part A\nanswer part B'],
    [0, 'blocks only']
  ]);
  assert.deepEqual(CR.extractMessages({}), []);
});

test('projectsToMap and detailProject', () => {
  assert.deepEqual(CR.projectsToMap([{ uuid: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }, {}]), { p1: 'Alpha', p2: 'Beta' });
  assert.equal(CR.detailProject({ project_uuid: 'p1' }), 'p1');
  assert.equal(CR.detailProject({ project: { uuid: 'p2' } }), 'p2');
  assert.equal(CR.detailProject({}), null);
});

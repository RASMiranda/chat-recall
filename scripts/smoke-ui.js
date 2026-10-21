#!/usr/bin/env node
// Optional UI smoke test: runs the real content script in jsdom with a fake claude.ai API.
//   npm i --no-save jsdom && node scripts/smoke-ui.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const ORG = '11111111-2222-3333-4444-555555555555';
const C1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const C2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const C3 = 'aaaaaaaa-0000-4000-8000-000000000003';
const P1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const SCRIPTS = ['i18n', 'search', 'api', 'store', 'sync', 'content'].map((n) => fs.readFileSync(path.join(root, 'src', `${n}.js`), 'utf8'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function memArea(onChange) {
  const data = {};
  return {
    data,
    async get(k) {
      if (k === null) return JSON.parse(JSON.stringify(data));
      return k in data ? { [k]: JSON.parse(JSON.stringify(data[k])) } : {};
    },
    async set(o) {
      const ch = {};
      for (const [k, v] of Object.entries(o)) { ch[k] = { oldValue: data[k], newValue: v }; data[k] = JSON.parse(JSON.stringify(v)); }
      onChange(ch);
    },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; }
  };
}

const API = {
  [`/api/organizations/${ORG}/chat_conversations`]: [
    { uuid: C1, name: 'Gmail filter for email body', updated_at: '2026-10-15T10:00:00Z', project_uuid: P1 },
    { uuid: C2, name: 'Batch job application', updated_at: '2026-10-17T10:00:00Z', project_uuid: P1 },
    { uuid: C3, name: 'Pasta recipes', updated_at: '2026-10-18T10:00:00Z' }
  ],
  [`/api/organizations/${ORG}/projects`]: [{ uuid: P1, name: 'Job hunt' }],
  [`/api/organizations/${ORG}/chat_conversations/${C1}`]: { name: 'Gmail filter for email body', chat_messages: [
    { sender: 'human', text: 'How do I skip the inbox?' },
    { sender: 'assistant', text: 'The script installs a trigger for checkNttJobs so it runs every 10 minutes.' }] },
  [`/api/organizations/${ORG}/chat_conversations/${C2}`]: { name: 'Batch job application', chat_messages: [
    { sender: 'human', text: 'Apply to all the Tier 1 jobs' }] },
  [`/api/organizations/${ORG}/chat_conversations/${C3}`]: { name: 'Pasta recipes', chat_messages: [
    { sender: 'human', text: 'Best carbonara recipe? Also checkNttJobs is not pasta.' }] }
};

async function boot(url) {
  const dom = new JSDOM('<!doctype html><html><body><main><p id="msg">The script installs a trigger for checkNttJobs here.</p></main></body></html>', { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const roots = [];
  const orig = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function (o) { const r = orig.call(this, { ...o, mode: 'open' }); roots.push(r); return r; };
  w.Element.prototype.scrollIntoView = function () { this.__scrolled = true; };
  w.matchMedia = () => ({ matches: false });
  Object.defineProperty(w.document, 'cookie', { get: () => `lastActiveOrg=${ORG}`, set() {} });

  const listeners = [];
  const area = memArea((ch) => listeners.forEach((l) => l(ch, 'local')));
  w.chrome = { storage: { local: area, onChanged: { addListener: (l) => listeners.push(l) } } };
  w.fetch = async (p) => {
    if (!(p in API)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => API[p] };
  };
  for (const code of SCRIPTS) w.eval(code);
  return { dom, w, roots, area };
}

const q = (root, sel) => root.querySelector(sel);
const all = (root, sel) => [...root.querySelectorAll(sel)];

async function typeQuery(w, root, text) {
  const input = q(root, 'input.q');
  input.value = text;
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(160);
}

(async () => {
  // ---- 1. home page: sync, palette, search, scopes ----
  {
    const { w, roots, area } = await boot('https://claude.ai/');
    for (let i = 0; i < 50 && Object.keys(area.data).filter((k) => k.startsWith('cr:c:')).length < 3; i++) await wait(100);
    assert.equal(Object.keys(area.data).filter((k) => k.startsWith('cr:c:')).length, 3, 'all chats synced into storage');
    assert.equal(area.data['cr:meta'].status, 'done');

    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    const root = roots[roots.length - 1];
    assert.ok(w.document.getElementById('chat-recall-host'), 'palette opens on Ctrl+K');
    assert.ok(all(root, '.item').length === 3, 'empty query lists recent chats');

    await typeQuery(w, root, 'checkntt');
    let items = all(root, '.item');
    assert.equal(items.length, 2, 'finds the word in two chats (case-insensitive substring)');
    assert.match(items[0].textContent, /https:\/\/claude\.ai\/chat\/aaaaaaaa-/, 'result shows the chat URL');
    assert.equal(all(root, 'mark').length >= 2, true, 'matches are highlighted');

    // project scope is disabled outside a project
    assert.equal(all(root, '.chips .chip')[1].disabled, true);

    // sender filter
    const chipsHome = all(root, '.chips .chip'); // [all, project, chat, anyone, me, claude]
    chipsHome[5].click(); // Claude
    await wait(160);
    items = all(root, '.item');
    assert.equal(items.length, 1, 'from Claude only: one chat');
    chipsHome[3].click(); // Anyone
    await typeQuery(w, root, 'checkntt -pasta');
    items = all(root, '.item');
    assert.ok(items.length <= 1, 'exclusion removes the pasta chat');

    // Enter navigates and stores the jump hint
    await typeQuery(w, root, 'checkntt');
    q(root, 'input.q').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const jump = JSON.parse(w.sessionStorage.getItem('chat-recall:jump'));
    assert.deepEqual(jump.terms, ['checkntt']);
    assert.equal(w.document.getElementById('chat-recall-host'), null, 'palette closes after opening a result');
    console.log('ok  home page: sync, search, highlight, URL, sender filter, exclusion, open');
  }

  // ---- 2. inside a chat that belongs to a project ----
  {
    const { w, roots, area } = await boot(`https://claude.ai/chat/${C1}`);
    for (let i = 0; i < 50 && Object.keys(area.data).filter((k) => k.startsWith('cr:c:')).length < 3; i++) await wait(100);
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    const root = roots[roots.length - 1];
    const chips = all(root, '.chips .chip');
    const [, projectChip, chatChip] = chips;
    assert.equal(projectChip.disabled, false, 'project scope enabled (chat belongs to a project)');
    assert.equal(chatChip.disabled, false, 'chat scope enabled inside a chat');

    projectChip.click();
    await typeQuery(w, root, 'job');
    let items = all(root, '.item');
    assert.deepEqual(items.map((i) => i.querySelector('.title').textContent).sort(), ['Batch job application', 'Gmail filter for email body']);
    assert.ok(!items.some((i) => /Pasta/.test(i.textContent)), 'project scope excludes chats outside the project');

    chatChip.click();
    await typeQuery(w, root, 'checkntt');
    items = all(root, '.item');
    assert.equal(items.length, 1, 'chat scope lists message hits for this chat only');
    assert.match(items[0].textContent, /Message 2/);

    // choosing a hit in the open chat scrolls to the text on the page
    items[0].click();
    await wait(500);
    assert.equal(w.document.getElementById('msg').__scrolled, true, 'jumped to the matching text in the page');
    console.log('ok  inside a chat: project scope, chat scope, in-page jump');
  }
  console.log('UI smoke test passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

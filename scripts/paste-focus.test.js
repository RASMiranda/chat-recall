#!/usr/bin/env node
// Regression test for #7 (paste via the right-click menu ended up in claude.ai's composer and the palette closed).
// Runs the real content script in Chromium on a page whose own document-level handlers redirect
// paste / typing / focus to a "composer" textarea, the way claude.ai does.
//   npm i --no-save playwright && node scripts/paste-focus.test.js
// (Chromium comes from `npx playwright install chromium`, or PLAYWRIGHT_BROWSERS_PATH, e.g. /opt/pw-browsers.)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SCRIPTS = ['i18n', 'search', 'api', 'store', 'sync', 'content'].map((n) => fs.readFileSync(path.join(root, 'src', `${n}.js`), 'utf8'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><html><body>
<main><textarea id="composer" aria-label="Write your prompt"></textarea></main>
<script>
  const composer = document.getElementById('composer');
  const take = (text) => { composer.focus(); composer.setRangeText(text, composer.selectionStart, composer.selectionEnd, 'select'); };
  // Bubble-phase, document-level handlers (events from the closed shadow DOM arrive retargeted to the host).
  document.addEventListener('paste', (e) => {
    if (e.target === composer) return;
    e.preventDefault();
    take(e.clipboardData.getData('text/plain'));
  });
  document.addEventListener('beforeinput', (e) => {
    if (e.target === composer) return;
    e.preventDefault();
    take(e.data || '');
  });
  document.addEventListener('keydown', (e) => {
    if (e.target !== composer && e.key.length === 1 && !e.ctrlKey && !e.metaKey) { e.preventDefault(); take(e.key); }
  });
  document.addEventListener('focusin', (e) => { if (e.target !== composer) composer.focus(); });
  // Click-away logic of the page: any click outside the composer moves focus back to it.
  document.addEventListener('mousedown', (e) => { if (e.target !== composer) setTimeout(() => composer.focus(), 0); });
</script></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route('https://claude.ai/**', (route) => {
    const u = route.request().url();
    if (u.includes('/api/')) return route.fulfill({ status: 404, body: '{}', contentType: 'application/json' });
    return route.fulfill({ status: 200, body: PAGE, contentType: 'text/html' });
  });
  await page.addInitScript(() => {
    // Expose the closed shadow root to the test and stub the extension storage.
    window.__roots = [];
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (o) { const r = orig.call(this, { ...o, mode: 'open' }); window.__roots.push(r); return r; };
    const data = {};
    window.chrome = { storage: { local: {
      async get(k) { return k === null ? { ...data } : (k in data ? { [k]: data[k] } : {}); },
      async set(o) { Object.assign(data, o); },
      async remove(keys) { for (const k of [].concat(keys)) delete data[k]; }
    }, onChanged: { addListener() {} } } };
  });
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));

  await page.goto('https://claude.ai/');
  for (const code of SCRIPTS) await page.addScriptTag({ content: code });

  const state = () => page.evaluate(() => {
    const r = window.__roots[window.__roots.length - 1];
    const input = r && r.querySelector('input.q');
    return {
      open: !!document.getElementById('chat-recall-host'),
      input: input ? input.value : null,
      inputFocused: !!(r && r.activeElement === input),
      composer: document.getElementById('composer').value,
      results: r ? r.querySelector('.results').textContent : null
    };
  });
  const checks = [];
  const check = (name, fn) => { try { fn(); checks.push(`ok    ${name}`); } catch (e) { checks.push(`FAIL  ${name}\n        ${e.message.split('\n')[0]}`); } };

  // 1. Ctrl+K opens the palette with focus in its input, even though the page steals focus on focusin.
  await page.keyboard.press('Control+k');
  await wait(100);
  let s = await state();
  check('Ctrl+K opens the palette and the input keeps focus', () => { assert.equal(s.open, true); assert.equal(s.inputFocused, true); });
  const before = s.results;

  // 2. Paste event (what the context-menu "Paste" fires at the focused input).
  await page.evaluate(() => {
    const input = window.__roots[window.__roots.length - 1].querySelector('input.q');
    const dt = new DataTransfer();
    dt.setData('text/plain', 'hello');
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
    // An untrusted event has no default action, so apply the browser default (insert) unless it was cancelled.
    if (input.dispatchEvent(ev)) {
      input.setRangeText('hello', input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertFromPaste' }));
    }
  });
  await wait(250);
  s = await state();
  check('pasted text lands in the palette input', () => assert.equal(s.input, 'hello'));
  check('pasted text does NOT land in the page composer', () => assert.equal(s.composer, ''));
  check('palette stays open after paste', () => assert.equal(s.open, true));
  check('results update after paste', () => assert.notEqual(s.results, before));

  // 3. Real typing / insertText inside the palette reaches the palette input only.
  if (s.open) {
    await page.keyboard.insertText('abc');
    await page.keyboard.press('x');
    await wait(150);
    s = await state();
    check('typing in the palette does not leak to the composer', () => { assert.equal(s.input, 'helloabcx'); assert.equal(s.composer, ''); });
  }

  // 4. Context menu: right-click on the backdrop must not close it, and page focus stealing must not stick.
  if (s.open) {
    await page.mouse.click(5, 5, { button: 'right' });
    await wait(100);
    s = await state();
    check('right-click on the backdrop does not close the palette', () => assert.equal(s.open, true));
    check('input has focus again after the right-click', () => assert.equal(s.inputFocused, true));
    await page.evaluate(() => document.getElementById('composer').focus());
    await wait(50);
    s = await state();
    check('focus the page steals is handed back to the input', () => assert.equal(s.inputFocused, true));

    // 5. A real primary click outside still closes it.
    await page.mouse.click(5, 5);
    await wait(100);
    s = await state();
    check('a primary click on the backdrop closes the palette', () => assert.equal(s.open, false));
  }

  await browser.close();
  console.log(checks.join('\n'));
  if (problems.length) console.log(`page errors: ${problems.join('; ')}`);
  const failed = checks.filter((c) => c.startsWith('FAIL')).length;
  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log(`\nall ${checks.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });

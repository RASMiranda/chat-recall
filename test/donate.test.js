'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseDonate, applyDonate } = require('../scripts/set-donate.js');

test('parseDonate recognises platforms and rejects bad input', () => {
  assert.deepEqual(parseDonate('https://ko-fi.com/someone'), { url: 'https://ko-fi.com/someone', platform: 'ko_fi', handle: 'someone' });
  assert.equal(parseDonate('https://www.buymeacoffee.com/abc').platform, 'buy_me_a_coffee');
  assert.equal(parseDonate('https://github.com/sponsors/octo').handle, 'octo');
  assert.equal(parseDonate('https://liberapay.com/x').platform, 'liberapay');
  assert.equal(parseDonate('https://paypal.me/someone').platform, 'custom');
  assert.equal(parseDonate('https://ko-fi.com/bad handle%20').platform, 'custom');
  assert.throws(() => parseDonate('http://ko-fi.com/x'), /https/);
  assert.throws(() => parseDonate('javascript:alert(1)'), /https|valid/);
  assert.throws(() => parseDonate('not a url'), /valid/);
});

test('applyDonate writes every place, and --clear undoes it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'donate-'));
  const src = path.resolve(__dirname, '..');
  for (const f of ['README.md', 'PUBLISHING.md', 'package.json', 'donate.json']) fs.copyFileSync(path.join(src, f), path.join(root, f));

  applyDonate(root, 'https://ko-fi.com/someone');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'donate.json'), 'utf8')).url, 'https://ko-fi.com/someone');
  assert.equal(fs.readFileSync(path.join(root, '.github/FUNDING.yml'), 'utf8').trim(), 'ko_fi: someone');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).funding, { type: 'ko_fi', url: 'https://ko-fi.com/someone' });
  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /\[Donate\]\(https:\/\/ko-fi\.com\/someone\)/);
  assert.match(fs.readFileSync(path.join(root, 'PUBLISHING.md'), 'utf8'), /support development: https:\/\/ko-fi\.com\/someone/);

  applyDonate(root, 'https://ko-fi.com/other'); // idempotent: replaces, never duplicates
  assert.equal((fs.readFileSync(path.join(root, 'README.md'), 'utf8').match(/## Support/g) || []).length, 1);

  applyDonate(root, null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'donate.json'), 'utf8')).url, '');
  assert.equal(fs.existsSync(path.join(root, '.github/FUNDING.yml')), false);
  assert.equal('funding' in JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')), false);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /## Support/);
});

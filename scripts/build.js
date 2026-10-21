#!/usr/bin/env node
// Builds dist/chrome and dist/firefox (+ zips). Zero dependencies except the `zip` CLI.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

const SCRIPTS = ['src/i18n.js', 'src/search.js', 'src/api.js', 'src/store.js', 'src/sync.js', 'src/content.js'];
const ICONS = { 16: 'src/icons/icon16.png', 32: 'src/icons/icon32.png', 48: 'src/icons/icon48.png', 128: 'src/icons/icon128.png' };

const base = {
  manifest_version: 3,
  name: 'Chat Recall',
  short_name: 'Chat Recall',
  version: pkg.version,
  description: 'Fast local full-text search across all your claude.ai chats, per project and per chat. Unofficial; not affiliated with Anthropic.',
  homepage_url: 'https://github.com/RASMiranda/chat-recall',
  icons: ICONS,
  permissions: ['storage', 'unlimitedStorage'],
  host_permissions: ['https://claude.ai/*'],
  content_scripts: [{ matches: ['https://claude.ai/*'], js: SCRIPTS, run_at: 'document_idle' }],
  action: { default_title: 'Chat Recall', default_popup: 'src/popup/popup.html', default_icon: ICONS }
};

const manifests = {
  chrome: { ...base, minimum_chrome_version: '110' },
  firefox: {
    ...base,
    browser_specific_settings: {
      gecko: {
        // Permanent once submitted to AMO: changing it later makes it a different add-on.
        id: 'chat-recall@rasmiranda.github.io',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] }
      },
      // Firefox for Android only supports data_collection_permissions from 142 (per web-ext lint).
      gecko_android: { strict_min_version: '142.0' }
    }
  }
};

// Donation link: donate.json (written by scripts/set-donate.js), overridable with DONATE_URL.
const { parseDonate } = require('./set-donate.js');
function readDonateUrl() {
  const raw = process.env.DONATE_URL ?? JSON.parse(fs.readFileSync(path.join(root, 'donate.json'), 'utf8')).url;
  if (!raw) return '';
  return parseDonate(raw).url; // throws on non-https / invalid
}
const donateUrl = readDonateUrl();

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

fs.rmSync(dist, { recursive: true, force: true });
for (const [target, manifest] of Object.entries(manifests)) {
  const out = path.join(dist, target);
  copyDir(src, path.join(out, 'src'));
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'src', 'config.js'), `globalThis.CR_CONFIG = ${JSON.stringify({ donateUrl })};\n`);
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'));
  const zipPath = path.join(dist, `chat-recall-${target}-${pkg.version}.zip`);
  execFileSync('zip', ['-r', '-q', '-X', zipPath, '.'], { cwd: out });
  console.log(`built ${path.relative(root, zipPath)}`);
}

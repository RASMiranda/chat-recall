#!/usr/bin/env node
// One command to wire a donation link everywhere it normally goes:
//   node scripts/set-donate.js https://ko-fi.com/yourname     (or github.com/sponsors/x, buymeacoffee.com/x, liberapay.com/x, patreon.com/x, any https URL)
//   node scripts/set-donate.js --clear                         (remove it again)
// Writes: donate.json (read by the build -> popup link), .github/FUNDING.yml (GitHub "Sponsor" button),
// package.json "funding", and the marked blocks in README.md and PUBLISHING.md.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const HANDLE = /^[\w.-]+$/;

function parseDonate(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { throw new Error('Not a valid URL'); }
  if (u.protocol !== 'https:') throw new Error('The donation link must use https://');
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean);
  const out = { url: u.href, platform: 'custom', handle: null };
  const take = (key, h) => { if (h && HANDLE.test(h)) { out.platform = key; out.handle = h; } };
  if (host === 'github.com' && seg[0] === 'sponsors') take('github', seg[1]);
  else if (host === 'ko-fi.com') take('ko_fi', seg[0]);
  else if (host === 'buymeacoffee.com') take('buy_me_a_coffee', seg[0]);
  else if (host === 'liberapay.com') take('liberapay', seg[0]);
  else if (host === 'patreon.com') take('patreon', seg[0]);
  return out;
}

function replaceBlock(text, name, body) {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(text)) throw new Error(`Marker "${name}" not found`);
  return text.replace(re, (_, a, b) => `${a}\n${body ? body + '\n' : ''}${b}`);
}

function applyDonate(root, input) {
  const clear = input == null;
  const d = clear ? null : parseDonate(input);
  const file = (...p) => path.join(root, ...p);

  fs.writeFileSync(file('donate.json'), JSON.stringify({ url: d ? d.url : '' }, null, 2) + '\n');

  const fundingPath = file('.github', 'FUNDING.yml');
  if (d) {
    fs.mkdirSync(path.dirname(fundingPath), { recursive: true });
    const line = d.platform === 'custom' ? `custom: ["${d.url}"]` : `${d.platform}: ${d.handle}`;
    fs.writeFileSync(fundingPath, `${line}\n`);
  } else {
    fs.rmSync(fundingPath, { force: true });
  }

  const pkgPath = file('package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (d) pkg.funding = { type: d.platform === 'custom' ? 'donation' : d.platform, url: d.url };
  else delete pkg.funding;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  const readmePath = file('README.md');
  fs.writeFileSync(readmePath, replaceBlock(fs.readFileSync(readmePath, 'utf8'), 'donate',
    d ? `## Support\n\nChat Recall is free and open source. If it saves you time, you can support its development: **[Donate](${d.url})**.\n` : ''));

  const pubPath = file('PUBLISHING.md');
  fs.writeFileSync(pubPath, replaceBlock(fs.readFileSync(pubPath, 'utf8'), 'donate-listing',
    d ? `Last line of the listing description: "Free and open source. If it helps you, you can support development: ${d.url}"\nPlatform notes: Chrome and Firefox stores each have their own rules about donation links and "contributions"; I have not verified either, so check them before submitting.` : ''));

  return d;
}

module.exports = { parseDonate, applyDonate, replaceBlock };

if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/set-donate.js <https-url> | --clear');
    process.exit(2);
  }
  try {
    const d = applyDonate(path.resolve(__dirname, '..'), arg === '--clear' ? null : arg);
    console.log(d ? `Donation link set (${d.platform}): ${d.url}\nNow run: npm run build` : 'Donation link removed.');
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

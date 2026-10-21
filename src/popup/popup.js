(() => {
  'use strict';
  const ext = globalThis.browser ?? globalThis.chrome;
  const area = ext.storage.local;
  const $ = (id) => document.getElementById(id);

  const STATUS_TEXT = {
    idle: 'Idle', done: 'Up to date', listing: 'Reading chat list…', fetching: 'Indexing…',
    auth: 'Not signed in to claude.ai', error: 'Error — try again'
  };

  function rel(ms) {
    if (!ms) return 'never';
    const d = Date.now() - ms;
    if (d < 60e3) return 'just now';
    if (d < 3600e3) return `${Math.round(d / 60e3)} min ago`;
    if (d < 86400e3) return `${Math.round(d / 3600e3)} h ago`;
    return `${Math.round(d / 86400e3)} d ago`;
  }

  async function snapshot() {
    const all = await area.get(null);
    const meta = all['cr:meta'] || {};
    const count = Object.keys(all).filter((k) => k.startsWith('cr:c:')).length;
    return { meta, count };
  }

  async function render() {
    const { meta, count } = await snapshot();
    $('count').textContent = String(count);
    let s = STATUS_TEXT[meta.status] || STATUS_TEXT.idle;
    if (meta.status === 'fetching') s = `Indexing ${meta.done || 0}/${meta.total || 0}…`;
    $('status').textContent = s;
    $('last').textContent = rel(meta.lastSync);
    $('auto').checked = meta.auto !== false;
    const busy = meta.status === 'listing' || meta.status === 'fetching';
    $('sync').disabled = busy;
    $('rebuild').disabled = busy;
  }

  async function command(cmd) {
    const before = (await snapshot()).meta;
    await area.set({ 'cr:cmd': { ...cmd, ts: Date.now() } });
    // If no claude.ai tab picks the command up, say so.
    setTimeout(async () => {
      const now = (await snapshot()).meta;
      const moved = now.status !== before.status || now.lastSync !== before.lastSync || now.lock !== before.lock;
      const note = $('note');
      if (!moved && cmd.type === 'sync') {
        note.hidden = false;
        note.textContent = 'No claude.ai tab responded. Open claude.ai (signed in) and try again.';
      } else {
        note.hidden = true;
      }
    }, 3000);
  }

  $('sync').addEventListener('click', () => command({ type: 'sync' }));

  $('rebuild').addEventListener('click', async () => {
    if (!confirm('Delete the local index and rebuild it from claude.ai?')) return;
    await area.get(null).then(async (all) => {
      const keys = Object.keys(all).filter((k) => k.startsWith('cr:') && k !== 'cr:meta' && k !== 'cr:cmd');
      if (keys.length) await area.remove(keys);
    });
    await area.set({ 'cr:cmd': { type: 'cleared', ts: Date.now() } });
    await command({ type: 'sync', full: true });
  });

  $('clear').addEventListener('click', async () => {
    if (!confirm('Delete the local search index? Your chats on claude.ai are not touched.')) return;
    const all = await area.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith('cr:') && k !== 'cr:meta');
    if (keys.length) await area.remove(keys);
    await area.set({ 'cr:meta': { lastSync: 0, status: 'idle', done: 0, total: 0, errors: 0, auto: (all['cr:meta'] || {}).auto } });
    await area.set({ 'cr:cmd': { type: 'cleared', ts: Date.now() } });
    render();
  });

  $('auto').addEventListener('change', async (e) => {
    const { meta } = await snapshot();
    await area.set({ 'cr:meta': { ...meta, auto: e.target.checked } });
  });

  const donateUrl = (globalThis.CR_CONFIG || {}).donateUrl;
  if (typeof donateUrl === 'string' && donateUrl.startsWith('https://')) {
    $('donate').href = donateUrl;
    $('support').hidden = false;
  }

  render();
  setInterval(render, 800);
})();

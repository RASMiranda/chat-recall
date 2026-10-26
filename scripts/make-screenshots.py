#!/usr/bin/env python3
"""Store screenshots from FAKE demo chats. No real data.
Needs: pip install playwright (with Chromium installed).
Run:   python3 scripts/make-screenshots.py   ->  store-assets/*.png"""
import json, pathlib, datetime as dt
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'store-assets'
OUT.mkdir(exist_ok=True)
ORG = '11111111-2222-3333-4444-555555555555'
P_TRIP, P_HOME = 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002'
now = dt.datetime(2026, 10, 20, 9, 0, tzinfo=dt.timezone.utc)


def ago(d):
    return (now - dt.timedelta(days=d)).strftime('%Y-%m-%dT%H:%M:%SZ')


def cid(n):
    return f'a0000000-0000-4000-8000-{n:012d}'


CHATS = [  # (n, title, project, days_ago, [(sender, text)])
    (1, 'Lisbon trip itinerary', P_TRIP, 2, [
        ('human', 'Plan 4 days in Lisbon in April. We like food markets and walking.'),
        ('assistant', 'Day 1: Alfama on foot, then lunch at the Time Out Market. Day 2: Belém, the pastéis de nata bakery, and the riverside walk.'),
        ('human', 'What was the name of that tram line again?'),
        ('assistant', 'Tram 28 runs through Alfama and Graça. Go before 9am to avoid the queue.')]),
    (2, 'Flights and hotel budget', P_TRIP, 5, [
        ('human', 'Our budget for flights and the hotel is 1,400 euros total.'),
        ('assistant', 'Book flights midweek if you can. A guesthouse in Baixa keeps the hotel under 90 euros a night.')]),
    (3, 'Packing list for spring', P_TRIP, 6, [
        ('human', 'Make a packing list for a week in Portugal in April.'),
        ('assistant', 'Light rain jacket, comfortable walking shoes, a power adapter (type F), and a small day bag.')]),
    (4, 'Fix a leaking kitchen tap', P_HOME, 3, [
        ('human', 'The kitchen tap drips even when fully closed.'),
        ('assistant', 'Most likely a worn cartridge or washer. Turn off the isolation valve, remove the handle, and replace the ceramic cartridge.'),
        ('human', 'Which size spanner do I need?'),
        ('assistant', 'A 24 mm spanner fits most single-lever mixer cartridges.')]),
    (5, 'Paint colours for the living room', P_HOME, 9, [
        ('human', 'We want a warm white for the living room, north-facing.'),
        ('assistant', 'North light is cool, so pick a warm white with a yellow base. Test two samples on different walls before buying.')]),
    (6, 'Invoice template for freelance work', None, 1, [
        ('human', 'Write an invoice template with payment terms of 14 days.'),
        ('assistant', 'Include invoice number, issue date, due date (14 days), client details, itemised services, and bank details.'),
        ('human', 'Add a late fee clause.'),
        ('assistant', 'Suggested wording: "Invoices unpaid after the due date may incur a late fee of 2% per month."')]),
    (7, 'Python script to rename photos', None, 4, [
        ('human', 'I need a script to rename photos by the date they were taken.'),
        ('assistant', 'Use Pillow to read the EXIF DateTimeOriginal tag, then os.rename to YYYY-MM-DD_HHMMSS.jpg. Fall back to the file modified time when EXIF is missing.')]),
    (8, 'Sourdough starter troubleshooting', None, 12, [
        ('human', 'My sourdough starter smells like nail polish remover.'),
        ('assistant', 'It is hungry. Feed it twice a day at a 1:2:2 ratio for three days and keep it warm.')]),
    (9, 'Weekly meal plan', None, 15, [
        ('human', 'Plan 5 vegetarian dinners with a shared shopping list.'),
        ('assistant', 'Monday: chickpea curry. Tuesday: mushroom risotto. Wednesday: shakshuka. Thursday: lentil soup. Friday: veggie tacos.')]),
    (10, 'Explain compound interest', None, 20, [
        ('human', 'Explain compound interest with a simple example.'),
        ('assistant', 'If you invest 1,000 at 5% a year, after year one you have 1,050, and after year two 1,102.50, because interest is earned on the interest.')]),
    (11, 'Cover letter feedback', None, 26, [
        ('human', 'Can you tighten this cover letter? It feels long.'),
        ('assistant', 'Cut the first paragraph to one sentence, lead with your strongest result, and remove phrases like "I am writing to apply".')]),
    (12, 'Learning Spanish: weekly routine', None, 33, [
        ('human', 'How should I structure 20 minutes a day to learn Spanish?'),
        ('assistant', 'Five minutes of vocabulary review, ten of listening, five of speaking out loud. Consistency beats long sessions.')]),
]

API = {f'/api/organizations/{ORG}/projects': [
    {'uuid': P_TRIP, 'name': 'Portugal trip'}, {'uuid': P_HOME, 'name': 'Home projects'}]}
lst = []
for n, title, proj, d, msgs in CHATS:
    rec = {'uuid': cid(n), 'name': title, 'updated_at': ago(d)}
    if proj:
        rec['project_uuid'] = proj
    lst.append(rec)
    API[f'/api/organizations/{ORG}/chat_conversations/{cid(n)}'] = {
        'name': title, 'updated_at': ago(d),
        'chat_messages': [{'sender': s, 'text': t} for s, t in msgs]}
API[f'/api/organizations/{ORG}/chat_conversations'] = lst


def page_html(title, msgs):
    rows = ''.join(
        f'<div class="m {s}"><div class="who">{"You" if s == "human" else "Assistant"}</div><div class="t">{t}</div></div>'
        for s, t in msgs)
    side = ''.join(f'<div class="si">{c[1]}</div>' for c in CHATS[:7])
    return f'''<!doctype html><html><head><meta charset=utf-8><title>{title}</title><style>
body{{margin:0;font:15px/1.5 system-ui,sans-serif;background:#f7f6f3;color:#222;display:flex;height:100vh}}
aside{{width:260px;background:#efede8;padding:18px;box-sizing:border-box;border-right:1px solid #e0ddd5}}
aside h4{{margin:0 0 14px;font-size:13px;color:#777;letter-spacing:.04em;text-transform:uppercase}}
.si{{padding:8px 10px;border-radius:8px;color:#444;font-size:14px}}
main{{flex:1;padding:28px 60px;max-width:780px}}
.m{{margin:0 0 18px}} .who{{font-size:12px;color:#888;margin-bottom:2px}}
.human .t{{background:#e8e5dd;display:inline-block;padding:8px 12px;border-radius:12px}}
.demo{{position:fixed;right:12px;bottom:8px;font-size:11px;color:#999}}</style></head><body>
<aside><h4>Demo chat app</h4>{side}</aside><main>{rows}</main></body></html>'''


SHIM = """
(() => {
  const data = {}; const ls = [];
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const area = {
    async get(k){ if(k===null) return clone(data); return k in data ? {[k]: clone(data[k])} : {}; },
    async set(o){ const ch={}; for(const [k,v] of Object.entries(o)){ ch[k]={oldValue:data[k],newValue:v}; data[k]=clone(v);} ls.forEach(l=>l(ch,'local')); },
    async remove(keys){ for(const k of [].concat(keys)) delete data[k]; }
  };
  window.chrome = { storage: { local: area, onChanged: { addListener: (l) => ls.push(l) } } };
  window.__area = data;
})();
"""
SCRIPTS = [(ROOT / 'src' / f'{n}.js').read_text() for n in ['i18n', 'search', 'api', 'store', 'sync', 'content']]


def open_page(ctx, url):
    pg = ctx.new_page()
    pg.add_init_script(SHIM)
    pg.goto(url)
    for code in SCRIPTS:
        pg.add_script_tag(content=code)
    pg.wait_for_function(
        "Object.keys(window.__area).filter(k=>k.startsWith('cr:c:')).length >= %d" % len(CHATS), timeout=15000)
    return pg


def palette(pg, query):
    pg.keyboard.press('Control+k')
    pg.wait_for_timeout(300)
    if query:
        pg.keyboard.type(query, delay=15)
    pg.wait_for_timeout(600)


with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 800})
    ctx.add_cookies([{'name': 'lastActiveOrg', 'value': ORG, 'url': 'https://claude.ai/'}])

    def handler(route):
        u = route.request.url.replace('https://claude.ai', '').split('?')[0]
        if u in API:
            return route.fulfill(status=200, content_type='application/json', body=json.dumps(API[u]))
        if u.startswith('/api/'):
            return route.fulfill(status=404, content_type='application/json', body='{}')
        if u.startswith('/chat/'):
            n = int(u.rsplit('-', 1)[1])
            c = next(c for c in CHATS if c[0] == n)
            return route.fulfill(status=200, content_type='text/html', body=page_html(c[1], c[4]))
        return route.fulfill(status=200, content_type='text/html',
                             body=page_html('New chat', [('assistant', 'How can I help today?')]))

    ctx.route('https://claude.ai/**', handler)

    for name, url, query in [
        ('1-search-all-chats', 'https://claude.ai/', 'invoice'),
        ('2-operators', 'https://claude.ai/', '"late fee" from:claude since:30d'),
        ('3-recent-chats', 'https://claude.ai/', ''),
        ('4-in-project-chat', f'https://claude.ai/chat/{cid(1)}', 'tram'),
    ]:
        pg = open_page(ctx, url)
        palette(pg, query)
        pg.screenshot(path=str(OUT / f'{name}.png'))
        pg.close()

    pg = ctx.new_page()
    pg.add_init_script(SHIM)
    pg.set_viewport_size({'width': 420, 'height': 400})
    pg.goto((ROOT / 'src/popup/popup.html').as_uri())
    pg.evaluate("""() => { __area['cr:meta'] = {lastSync: Date.now()-420000, status:'done', done:12, total:12, errors:0, auto:true};
      for (let i=0;i<12;i++) __area['cr:c:'+i] = {}; }""")
    pg.wait_for_timeout(1200)
    pg.screenshot(path=str(OUT / '5-popup.png'), full_page=True)
    b.close()
print('done')

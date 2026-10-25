// Tenner TV's check before every deploy (node tv/test.mjs): the Worker runs against stand-in listings and must give
// complete programmes, pick up logos, cover an outage with the last good copy, and warm up on its schedule.
// Any failure stops the deploy, so what's live keeps working.
import assert from 'node:assert/strict';
const store = new Map(), kvs = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res.clone()); } } };
let up = true;
const at = (m) => new Date(Date.now() + m * 60e3).toISOString();
globalThis.fetch = async (u) => {
  u = String(u);
  if (u.includes('tvmaze')) return up ? new Response(JSON.stringify([
    { id: 1, name: 'The Final', season: 3, number: 9, airstamp: at(-10), runtime: 60, summary: '<p>Who wins &amp; who goes</p>', image: { original: 'https://x/still.jpg' },
      show: { id: 9, name: 'A Show', genres: ['Drama'], network: { name: 'BBC One', country: { code: 'GB' } }, image: { original: 'https://x/poster.jpg' }, externals: { imdb: 'tt1' }, rating: { average: 8 } } },
    { id: 2, name: 'Episode 4', airstamp: at(50), runtime: 30, summary: null, image: null,
      show: { id: 10, name: 'Another', genres: [], network: { name: 'ITV', country: { code: 'GB' } }, image: null, externals: {} } },
    { id: 3, name: 'Elsewhere', airstamp: at(0), show: { id: 11, name: 'Not UK', network: { name: 'NBC', country: { code: 'US' } } } },
  ])) : new Response('down', { status: 503 });
  if (u.includes('/find/')) return new Response(JSON.stringify({ tv_results: [{ id: 5 }] }));
  if (u.includes('/tv/5')) return new Response(JSON.stringify({ networks: [{ name: 'BBC One', logo_path: '/bbc1.svg' }] }));
  return new Response('?', { status: 404 });
};
const kv = { async get(k) { const v = kvs.get(k); return v ? JSON.parse(v.v) : null; }, async getWithMetadata(k) { const v = kvs.get(k); return v ? { value: JSON.parse(v.v), metadata: v.m } : { value: null }; }, async put(k, v, o) { kvs.set(k, { v, m: o?.metadata }); } };
const { default: worker } = await import(new URL('./src/index.js', import.meta.url));
const files = new Map();   // stand-ins for public/data/*.json
const waits = [], ctx = { waitUntil: (p) => waits.push(p) }, env = { TV: kv, TMDB_TOKEN: 'x', ASSETS: { fetch: (r) => {
  const f = files.get(new URL(r.url).pathname); return f ? new Response(f, { headers: { 'content-type': 'application/json' } }) : new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }); } } };
const get = async (q = '') => { const r = await worker.fetch(new Request(`https://tv.tenner.stream/api/day${q}`), env, ctx); await Promise.all(waits.splice(0)); return [r.status, await r.json()]; };

let [s, d] = await get();
assert.equal(s, 200);
assert.deepEqual(d.channels.map((c) => c.name), ['BBC One', 'ITV1'], 'UK channels only, in remote-control order, ITV named ITV1');
const x = d.channels[0].items[0];
for (const f of ['id', 't', 'at', 'g', 'sum', 'wide', 'poster']) assert.ok(f in x, `programmes have ${f}`);
assert.equal(x.sum, 'Who wins & who goes', 'descriptions are plain text');
assert.ok(Array.isArray(x.g), 'genres are a list');
assert.equal(d.channels[1].items[0].ep, null, '"Episode 4" is not shown as a title');
store.clear(); [, d] = await get();
assert.match(d.logos['BBC One'] || '', /^https:\/\/image\.tmdb\.org\/t\/p\/original\//, 'logos arrive from TMDB');
store.clear(); kvs.get([...kvs.keys()].find((k) => k.startsWith('day:'))).m.at = 0; up = false;
[s, d] = await get(); assert.equal(s, 200); assert.equal(d.channels.length, 2, 'an outage serves the last good copy');
up = true; kvs.clear(); await worker.scheduled({}, env, ctx); await Promise.all(waits.splice(0));
assert.equal([...kvs.keys()].filter((k) => k.startsWith('day:')).length, 2, 'the schedule fetches today and tomorrow');
[s] = await get('?d=1999-01-01'); assert.equal(s, 400, 'days outside the week are refused');
assert.equal(await (await worker.fetch(new Request('https://tv.tenner.stream/'), env, ctx)).text(), '<!doctype html>', 'the page is served');
// the Freeview listings, when that day's been built, come before TVmaze
const d0 = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
files.set(`/data/${d0}.json`, JSON.stringify({ date: d0, source: 'freeview', logos: { 'BBC One': '/logos/bbc-one.webp' }, channels: [{ name: 'BBC One', items: [{ id: 'x', t: 'Freeview', at: Date.now(), rt: 60, g: [] }] }] }));
store.clear(); [s, d] = await get(); assert.equal(d.source, 'freeview', 'the Freeview listings are used first');
// the builder: the real XMLTV shape becomes days of channels
const { build } = await import(new URL('../scripts/fetch-tv.mjs', import.meta.url));
const xml = `<tv><programme channel="BBCOneLondonHD.uk" start="20261024203500 +0100" stop="20261024212000 +0100"><title lang="en">The Voice &amp; Friends</title><desc lang="en">Blind auditions.</desc><icon src="https://images.example/x/cover"/><episode-num system="onscreen">S1E6</episode-num><premiere/></programme>
  <programme channel="Nope.uk" start="20261024203500 +0100" stop="20261024212000 +0100"><title>Other</title></programme></tv>`;
const built = build(xml, [{ name: 'BBC One', id: 'BBCOneLondonHD.uk', logo: '/logos/bbc-one.webp' }], Date.parse('2026-10-24T12:00:00Z'));
const p = built['2026-10-24'].channels[0].items[0];
assert.deepEqual([p.t, p.s, p.n, p.rt, p.sum, p.isNew, new Date(p.at).toISOString()], ['The Voice & Friends', 1, 6, 45, 'Blind auditions.', true, '2026-10-24T19:35:00.000Z'], 'XMLTV is read correctly (times in UK time)');
assert.equal(built['2026-10-24'].channels.length, 1, 'only the chosen channels');
const sky = build(xml.replace('https://images.example/x/cover', 'https://images.metadata.sky.com/pd-image/2fe55478-24f6-48ef-a5fe-458345bbb469/cover'), [{ name: 'BBC One', id: 'BBCOneLondonHD.uk' }], Date.parse('2026-10-24T12:00:00Z'))['2026-10-24'].channels[0].items[0];
assert.equal(sky.sky, '2fe55478-24f6-48ef-a5fe-458345bbb469', "Sky's pictures are kept as their id");
assert.ok(!('wide' in sky) && !('show' in sky) && !Object.values(sky).includes(null), 'no empty or repeated fields');
assert.equal(p.wide, 'https://images.example/x/cover', 'other pictures keep their address');
console.log('Tenner TV checks passed');

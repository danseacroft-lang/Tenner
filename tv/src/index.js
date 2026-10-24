// Tenner TV's endpoint: GET /api/day?d=YYYY-MM-DD → that day's UK TV, channel by channel, from TVmaze (CC BY-SA 4.0,
// credited on the page), with each channel's logo from TMDB where it has one. Anything else is the page itself (public/).
// Days from yesterday to a week ahead.
const TVMAZE = 'https://api.tvmaze.com';
// the channels people look for first, in the order of a remote control; anything else follows, busiest first
const ORDER = ['BBC One', 'BBC Two', 'ITV1', 'Channel 4', 'Channel 5', 'Sky Atlantic', 'Sky Max', 'Sky Showcase', 'BBC Three', 'BBC Four',
  'ITV2', 'ITV3', 'ITV4', 'ITVBe', 'E4', 'More4', 'Film4', '5Star', 'Dave', 'Gold', 'W', 'Alibi', 'Yesterday', 'Comedy Central', 'Sky Arts', 'Sky Comedy', 'Sky Crime', 'Sky Witness'];
const NAMES = { ITV: 'ITV1', 'ITV 1': 'ITV1', 'BBC 1': 'BBC One', 'BBC 2': 'BBC Two', 'BBC 3': 'BBC Three', 'BBC 4': 'BBC Four', 'Channel 5 (UK)': 'Channel 5', 'Sky One': 'Sky Max' };
const text = (h) => (h || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '’').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const ukDay = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

function shape(list, date) {
  const by = new Map(), imdb = {};
  for (const e of list || []) {
    const s = e.show || {}, ch = s.network?.country?.code === 'GB' ? s.network.name : s.webChannel?.country?.code === 'GB' ? s.webChannel.name : null;
    if (!ch || !e.airstamp) continue;
    const name = NAMES[ch] || ch;
    if (s.externals?.imdb) (imdb[name] ||= new Set()).add(s.externals.imdb);
    const item = {
      id: e.id, show: s.id, t: s.name, ep: e.name && e.name !== s.name && !/^Episode \d+$/i.test(e.name) ? e.name : null,
      s: e.season || null, n: e.number || null, at: Date.parse(e.airstamp), rt: e.runtime || s.runtime || null,
      wide: e.image?.original || null, poster: s.image?.original || null,   // the full-size originals: landscape still, portrait poster sum: text(e.summary) || text(s.summary) || null, g: (s.genres || []).slice(0, 3),
      r: s.rating?.average || null, type: s.type || null, url: e.url || s.url || null,
    };
    if (item.sum && item.sum.length > 420) item.sum = item.sum.slice(0, 400).replace(/\s+\S*$/, '') + '…';
    by.set(name, [...(by.get(name) || []), item]);
  }
  const rank = (n) => { const i = ORDER.indexOf(n); return i < 0 ? 1000 : i; };
  const channels = [...by].map(([name, items]) => ({ name, items: items.sort((a, b) => a.at - b.at) }))
    .sort((a, b) => rank(a.name) - rank(b.name) || b.items.length - a.items.length);
  return { date, channels, imdb };
}

// ---------- channel logos, from TMDB: a show on each channel (by its IMDb id) → that show's networks → the matching one ----------
const TMDB = 'https://api.themoviedb.org/3', IMG = 'https://image.tmdb.org/t/p/original';
const norm = (n) => n.toLowerCase().replace(/\b(hd|uk)\b/g, '').replace(/\bone\b/g, '1').replace(/\btwo\b/g, '2').replace(/[^a-z0-9]+/g, '');
const SAME = { itv1: ['itv', 'itv1'], skymax: ['skymax', 'sky1', 'skyone'], channel5: ['channel5', '5'] };
async function buildLogos(env, imdb, names) {
  const out = {}, tmdb = (p) => fetch(`${TMDB}${p}`, { headers: { authorization: `Bearer ${env.TMDB_TOKEN}`, accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null));
  // a subrequest budget: two calls a channel, the busiest twenty channels
  for (const name of names.slice(0, 22)) {
    const id = [...(imdb[name] || [])][0]; if (!id) continue;
    try {
      const f = await tmdb(`/find/${id}?external_source=imdb_id`), tv = f?.tv_results?.[0]; if (!tv) continue;
      const d = await tmdb(`/tv/${tv.id}`), want = SAME[norm(name)] || [norm(name)];
      const n = (d?.networks || []).find((x) => x.logo_path && want.includes(norm(x.name)));
      if (n) out[name] = IMG + n.logo_path;
    } catch {}
  }
  return out;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname !== '/api/day') return env.ASSETS.fetch(req);
    const json = (b, status = 200, age = 1800) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${age}` } });
    const d = url.searchParams.get('d') || ukDay();
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= ukDay(Date.now() - 864e5) && d <= ukDay(Date.now() + 7 * 864e5);
    if (!ok) return json({ error: 'Pick a day from yesterday to a week ahead' }, 400, 60);
    const cache = caches.default, key = new Request(`https://tenner-tv-cache/v2/day/${d}`);
    let hit = await cache.match(key);
    if (!hit) {
      const r = await fetch(`${TVMAZE}/schedule?country=GB&date=${d}`, { headers: { accept: 'application/json', 'user-agent': 'TennerTV/1.0 (+https://tv.tenner.stream)' } });
      if (!r.ok) return json({ error: `The listings didn't load (${r.status})` }, 502, 60);
      const { imdb, ...day } = shape(await r.json(), d);
      // the logos are kept for a week; the first time, the listings go out without them while they're found
      const lkey = new Request('https://tenner-tv-cache/v1/logos'), lhit = await cache.match(lkey);
      if (lhit) day.logos = await lhit.json();
      else if (env.TMDB_TOKEN) ctx.waitUntil(buildLogos(env, imdb, day.channels.map((c) => c.name)).then((l) =>
        cache.put(lkey, new Response(JSON.stringify(l), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${Object.keys(l).length > 4 ? 604800 : 3600}` } }))));
      hit = json(day, 200, day.logos ? 1800 : 300);
      ctx.waitUntil(cache.put(key, hit.clone()));
    }
    return hit;
  },
};

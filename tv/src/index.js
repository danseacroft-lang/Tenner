// Tenner TV's endpoint: GET /api/day?d=YYYY-MM-DD → that day's UK TV, channel by channel, from TVmaze (CC BY-SA 4.0,
// credited on the page). Anything else is the page itself (public/). Days from yesterday to a week ahead.
const TVMAZE = 'https://api.tvmaze.com';
// the channels people look for first, in the order of a remote control; anything else follows, busiest first
const ORDER = ['BBC One', 'BBC Two', 'ITV1', 'Channel 4', 'Channel 5', 'Sky Atlantic', 'Sky Max', 'Sky Showcase', 'BBC Three', 'BBC Four',
  'ITV2', 'ITV3', 'ITV4', 'ITVBe', 'E4', 'More4', 'Film4', '5Star', 'Dave', 'Gold', 'W', 'Alibi', 'Yesterday', 'Comedy Central', 'Sky Arts', 'Sky Comedy', 'Sky Crime', 'Sky Witness'];
const NAMES = { ITV: 'ITV1', 'ITV 1': 'ITV1', 'BBC 1': 'BBC One', 'BBC 2': 'BBC Two', 'BBC 3': 'BBC Three', 'BBC 4': 'BBC Four', 'Channel 5 (UK)': 'Channel 5', 'Sky One': 'Sky Max' };
const text = (h) => (h || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '’').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const ukDay = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

function shape(list, date) {
  const by = new Map();
  for (const e of list || []) {
    const s = e.show || {}, ch = s.network?.country?.code === 'GB' ? s.network.name : s.webChannel?.country?.code === 'GB' ? s.webChannel.name : null;
    if (!ch || !e.airstamp) continue;
    const name = NAMES[ch] || ch;
    const img = e.image?.medium || s.image?.medium || null;
    const item = {
      id: e.id, show: s.id, t: s.name, ep: e.name && e.name !== s.name && !/^Episode \d+$/i.test(e.name) ? e.name : null,
      s: e.season || null, n: e.number || null, at: Date.parse(e.airstamp), rt: e.runtime || s.runtime || null,
      img, wide: e.image?.original || null, sum: text(e.summary) || text(s.summary) || null, g: (s.genres || []).slice(0, 3),
      r: s.rating?.average || null, type: s.type || null, url: e.url || s.url || null,
    };
    if (item.sum && item.sum.length > 420) item.sum = item.sum.slice(0, 400).replace(/\s+\S*$/, '') + '…';
    by.set(name, [...(by.get(name) || []), item]);
  }
  const rank = (n) => { const i = ORDER.indexOf(n); return i < 0 ? 1000 : i; };
  const channels = [...by].map(([name, items]) => ({ name, items: items.sort((a, b) => a.at - b.at) }))
    .sort((a, b) => rank(a.name) - rank(b.name) || b.items.length - a.items.length);
  return { date, channels };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname !== '/api/day') return env.ASSETS.fetch(req);
    const json = (b, status = 200, age = 1800) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${age}` } });
    const d = url.searchParams.get('d') || ukDay();
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= ukDay(Date.now() - 864e5) && d <= ukDay(Date.now() + 7 * 864e5);
    if (!ok) return json({ error: 'Pick a day from yesterday to a week ahead' }, 400, 60);
    const cache = caches.default, key = new Request(`https://tenner-tv-cache/v1/day/${d}`);
    let hit = await cache.match(key);
    if (!hit) {
      const r = await fetch(`${TVMAZE}/schedule?country=GB&date=${d}`, { headers: { accept: 'application/json', 'user-agent': 'TennerTV/1.0 (+https://tv.tenner.stream)' } });
      if (!r.ok) return json({ error: `The listings didn't load (${r.status})` }, 502, 60);
      hit = json(shape(await r.json(), d));
      ctx.waitUntil(cache.put(key, hit.clone()));
    }
    return hit;
  },
};

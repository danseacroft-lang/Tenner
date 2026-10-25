// Tenner TV's endpoint: GET /api/day?d=YYYY-MM-DD → that day's UK TV, channel by channel. First choice: the Freeview
// listings built every three hours into public/data/ (scripts/fetch-tv.mjs: the 35 main channels, complete schedules,
// our own logos). Only a day those don't cover falls back to TVmaze (CC BY-SA 4.0), with logos from TMDB.
// GET /api/warnings → the Met Office's weather warnings in force or coming up (wind, rain, snow… can knock out a
// satellite dish or an aerial's signal). Anything else is the page itself (public/). Days from yesterday to a week ahead.
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
      wide: e.image?.original || null, poster: s.image?.original || null,   // the full-size originals: landscape still, portrait poster
      sum: text(e.summary) || text(s.summary) || null, g: (s.genres || []).slice(0, 3),
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

// one day's listings, freshest first: the edge cache; else the shared copy in KV (kept fresh every half hour by the
// schedule below); else TVmaze itself. If TVmaze is down, the shared copy stands in, however old (up to three days).
// Without the KV store (if the deploy couldn't make it), the edge cache alone does the job.
const FRESH = 35 * 60e3;
async function day(env, ctx, d, force) {
  const cache = caches.default, key = new Request(`https://tenner-tv-cache/v3/day/${d}`), kv = env.TV;
  if (!force) {
    const hit = await cache.match(key); if (hit) return hit;
    const kept = kv ? await kv.getWithMetadata(`day:${d}`, 'json') : null;
    if (kept?.value && Date.now() - (kept.metadata?.at || 0) < FRESH) {
      if (!Object.keys(kept.value.logos || {}).length) kept.value.logos = (await kv.get('logos', 'json')) || {};
      const res = json(kept.value, 200, 600); ctx.waitUntil(cache.put(key, res.clone())); return res;
    }
  }
  let r = null; try { r = await fetch(`${TVMAZE}/schedule?country=GB&date=${d}`, { headers: { accept: 'application/json', 'user-agent': 'TennerTV/1.0 (+https://tv.tenner.stream)' } }); } catch {}
  if (!r?.ok) {
    const old = kv ? await kv.get(`day:${d}`, 'json') : null;
    return old ? json(old, 200, 120) : json({ error: `The listings didn't load (${r?.status || 'no answer'})` }, 502, 60);
  }
  const { imdb, ...out } = shape(await r.json(), d);
  out.logos = await logos(env, ctx, imdb, out.channels.map((c) => c.name));
  const res = json(out, 200, Object.keys(out.logos).length ? 1800 : 300);
  if (out.channels.length) {
    ctx.waitUntil(cache.put(key, res.clone()));
    if (kv) ctx.waitUntil(kv.put(`day:${d}`, JSON.stringify(out), { expirationTtl: 3 * 86400, metadata: { at: Date.now() } }));
  }
  return res;
}
// the channels' logos: kept for a week (in KV, or the edge cache), found again when they run out
async function logos(env, ctx, imdb, names) {
  const kv = env.TV, ck = new Request('https://tenner-tv-cache/v1/logos');
  const have = kv ? await kv.get('logos', 'json') : await caches.default.match(ck).then((r) => r?.json());
  if (have) return have;
  if (!env.TMDB_TOKEN) return {};
  const work = buildLogos(env, imdb, names).then((l) => {
    const ttl = Object.keys(l).length > 4 ? 604800 : 3600;   // too few found: try again in an hour
    return kv ? kv.put('logos', JSON.stringify(l), { expirationTtl: ttl })
      : caches.default.put(ck, new Response(JSON.stringify(l), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } }));
  });
  ctx.waitUntil(work);   // the listings go out now; the logos follow on the next load
  return {};
}
// ---------- the Met Office's weather warnings (its public RSS feed for the whole UK; no key). Each warning keeps the
// Met Office's link straight to it, as their terms ask. Kept 10 minutes at the edge; the last good copy (KV) stands in
// for up to a day if the feed can't be read, and a feed that's down just means no box on the page. ----------
const MO = ['https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/UK', 'https://weather.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/UK'];
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1') : ''; };
// "1200 Sun 25 Oct" in UK time → a timestamp, in the year that puts it nearest the warning's issue time
function ukTime(s, near) {
  const m = s.match(/(\d{2})(\d{2})\s+\w{3}\s+(\d{1,2})\s+(\w{3})/); if (!m || !(m[4].toLowerCase() in MON)) return null;
  const y0 = new Date(near).getUTCFullYear();
  const at = (y) => {
    const t = Date.UTC(y, MON[m[4].toLowerCase()], +m[3], +m[1], +m[2]);
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'shortOffset' }).formatToParts(t).find((x) => x.type === 'timeZoneName')?.value || '';
    return t - (+(p.match(/[+-]\d+/)?.[0] || 0)) * 36e5;   // GMT+1 in summer
  };
  return [y0 - 1, y0, y0 + 1].map(at).sort((a, b) => Math.abs(a - near) - Math.abs(b - near))[0];
}
export function warnings(xml, now = Date.now()) {
  const out = [];
  for (const [, it] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = text(tag(it, 'title')), body = text(text(tag(it, 'description'))), link = text(tag(it, 'link'));
    const head = title.match(/\b(yellow|amber|red)\b[^,:]*?\bwarnings?\s+of\s+(.+?)(?:\s+affecting\s+(.+))?$/i);
    if (!head) continue;
    const issued = Date.parse(text(tag(it, 'pubDate'))) || now;
    const v = body.match(/valid\s+from\s+(.+?)\s+to\s+(.+?)(?:\s*$|\.)/i);
    const from = v ? ukTime(v[1], issued) : null, to = v ? ukTime(v[2], issued) : null;
    if (to && to < now) continue;   // over
    const areas = body.replace(/\s*valid\s+from[\s\S]*$/i, '').replace(/^[^:]*:\s*/, '').trim();
    out.push({
      id: text(tag(it, 'guid')) || link || title, level: head[1].toLowerCase(), type: head[2].trim().toLowerCase(), where: head[3]?.trim() || null,
      title, areas: areas && areas !== title ? areas : null, from, to,
      link: /^https:\/\/(www|weather)\.metoffice\.gov\.uk\//.test(link) ? link : 'https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings',
    });
  }
  const rank = { red: 0, amber: 1, yellow: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || (a.from || 0) - (b.from || 0));
}
async function warned(env, ctx, force) {
  const cache = caches.default, key = new Request('https://tenner-tv-cache/v1/warnings'), kv = env.TV;
  if (!force) { const hit = await cache.match(key); if (hit) return hit; }
  for (const u of MO) {
    let r = null; try { r = await fetch(u, { headers: { accept: 'application/rss+xml, application/xml, text/xml', 'user-agent': 'TennerTV/1.0 (+https://tv.tenner.stream)' } }); } catch {}
    if (!r?.ok) continue;
    const xml = await r.text(); if (!/<rss|<channel/i.test(xml)) continue;
    const out = { at: Date.now(), source: 'Met Office', warnings: warnings(xml) }, res = json(out, 200, 600);
    ctx.waitUntil(cache.put(key, res.clone()));
    if (kv) ctx.waitUntil(kv.put('warnings', JSON.stringify(out), { expirationTtl: 86400 }));
    return res;
  }
  const old = kv ? await kv.get('warnings', 'json') : null;
  if (old) { old.warnings = (old.warnings || []).filter((w) => !w.to || w.to > Date.now()); return json(old, 200, 120); }
  return json({ at: Date.now(), source: 'Met Office', warnings: [], error: "The Met Office's warnings didn't load" }, 200, 120);
}
const json = (b, status = 200, age = 1800) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${age}` } });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/api/warnings') return warned(env, ctx);
    if (url.pathname !== '/api/day') return env.ASSETS.fetch(req);
    const d = url.searchParams.get('d') || ukDay();
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= ukDay(Date.now() - 864e5) && d <= ukDay(Date.now() + 7 * 864e5);
    if (!ok) return json({ error: 'Pick a day from yesterday to a week ahead' }, 400, 60);
    // the Freeview listings, if that day's been built (a missing file would come back as the page, hence the type check)
    const a = await env.ASSETS.fetch(new Request(new URL(`/data/${d}.json`, url.origin)));
    if (a.ok && (a.headers.get('content-type') || '').includes('json')) return new Response(a.body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=900' } });
    return day(env, ctx, d);
  },
  // every half hour, on its own: today's and tomorrow's listings (and the logos) fetched ahead of anyone asking, so the
  // page is always quick and the fallback copy is always fresh; the weather warnings too
  async scheduled(event, env, ctx) {
    for (const d of [ukDay(), ukDay(Date.now() + 864e5)]) { try { await day(env, ctx, d, true); } catch {} }
    try { await warned(env, ctx, true); } catch {}
  },
};

// Tenner's go-between for searching every film and show on TMDB, without putting the TMDB key in the website.
//   GET /search?q=…   up to 20 films and shows, best match first
//   GET /title/m123   one title's details and UK where-to-watch, in the same shape as data/titles.json
// Only Tenner's own pages may call it (CORS), and answers are cached at Cloudflare's edge, so popular searches and
// titles barely touch TMDB: searches for a day, titles for six hours.
const TMDB = 'https://api.themoviedb.org/3', IMG = 'https://image.tmdb.org/t/p', REGION = 'GB';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), origin = req.headers.get('origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ok = allowed.includes(origin);
    const cors = ok ? { 'access-control-allow-origin': origin, vary: 'origin' } : {};
    if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: { ...cors, 'access-control-allow-methods': 'GET', 'access-control-max-age': '86400' } });
    if (req.method !== 'GET') return json({ error: 'GET only' }, 405, cors);
    if (!ok) return json({ error: 'Not allowed from this site' }, 403, cors);
    if (!env.TMDB_TOKEN) return json({ error: 'Not set up yet' }, 503, cors);

    let path, params, shape, ttl;
    if (url.pathname === '/search') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
      if (q.length < 2) return json({ results: [] }, 200, cors);
      path = '/search/multi'; params = { query: q, language: 'en-GB', region: REGION, include_adult: 'false' }; shape = searchShape; ttl = 86400;
    } else {
      const m = url.pathname.match(/^\/title\/([mt])(\d{1,9})$/);
      if (!m) return json({ error: 'Not found' }, 404, cors);
      const type = m[1] === 'm' ? 'movie' : 'tv';
      path = `/${type}/${m[2]}`; params = { language: 'en-GB', append_to_response: `watch/providers,videos,${type === 'movie' ? 'release_dates' : 'content_ratings'}` };
      shape = (d) => titleShape(d, type, m[1] + m[2]); ttl = 21600;
    }

    // the edge cache, keyed on the request without its origin
    const cache = caches.default, key = new Request(`https://tenner-cache${url.pathname}?${new URLSearchParams(params)}`);
    let hit = await cache.match(key);
    if (!hit) {
      const r = await fetch(`${TMDB}${path}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${env.TMDB_TOKEN}`, accept: 'application/json' } });
      if (!r.ok) return json({ error: `TMDB ${r.status}` }, r.status === 404 ? 404 : 502, cors);
      hit = new Response(JSON.stringify(shape(await r.json())), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } });
      ctx.waitUntil(cache.put(key, hit.clone()));
    }
    const out = new Response(hit.body, hit);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};

const json = (o, status, headers) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });

function searchShape(d) {
  return {
    img: `${IMG}/w342`, bd: `${IMG}/w780`,
    results: (d.results || []).filter((x) => x.media_type === 'movie' || x.media_type === 'tv').slice(0, 20).map((x) => ({
      k: `${x.media_type === 'movie' ? 'm' : 't'}${x.id}`, type: x.media_type, title: x.title || x.name,
      year: (x.release_date || x.first_air_date || '').slice(0, 4) || null, rating: x.vote_count >= 20 ? Math.round(x.vote_average * 10) / 10 : null,
      poster: x.poster_path || null, backdrop: x.backdrop_path || null, overview: (x.overview || '').slice(0, 400),
    })),
  };
}

// the same fields as data/titles.json (see buildTitles in scripts/fetch-data.mjs), plus the basics for the sheet
function titleShape(d, type, k) {
  const providers = {}, gb = d['watch/providers']?.results?.[REGION] || {};
  const ids = (list) => (list || []).sort((a, b) => a.display_priority - b.display_priority).map((p) => { providers[p.provider_id] = [p.provider_name, p.logo_path || '']; return p.provider_id; });
  const cert = type === 'movie'
    ? (d.release_dates?.results || []).find((r) => r.iso_3166_1 === REGION)?.release_dates?.map((x) => x.certification).find(Boolean)
    : (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === REGION)?.rating;
  const vids = (d.videos?.results || []).filter((v) => v.site === 'YouTube' && /Trailer|Teaser/.test(v.type));
  const trailer = (vids.find((v) => v.type === 'Trailer' && v.official) || vids.find((v) => v.type === 'Trailer') || vids[0])?.key;
  const runtime = type === 'movie' ? d.runtime : (d.episode_run_time?.[0] || d.last_episode_to_air?.runtime || null);
  const nx = d.next_episode_to_air;
  const item = Object.fromEntries(Object.entries({
    nx: type === 'tv' && nx?.air_date ? [nx.air_date, nx.season_number, nx.episode_number] : undefined,
    sz: type === 'tv' ? (d.seasons || []).filter((s) => s.season_number > 0 && s.episode_count > 0).map((s) => s.episode_count) : undefined,
    en: type === 'tv' && /Ended|Canceled/.test(d.status || '') ? 1 : undefined,
    at: Date.now(), rt: runtime || undefined, se: type === 'tv' ? d.number_of_seasons || undefined : undefined, c: cert || undefined,
    g: (d.genres || []).map((g) => g.name).slice(0, 3), tl: d.tagline || undefined,
    f: ids(gb.flatrate), fr: ids([...(gb.free || []), ...(gb.ads || [])]), re: ids(gb.rent), bu: ids(gb.buy), tr: trailer,
  }).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));
  return {
    logo: `${IMG}/w92`, providers, items: { [k]: item },
    info: { k, type, title: d.title || d.name, year: (d.release_date || d.first_air_date || '').slice(0, 4) || null,
      rating: d.vote_count >= 20 ? Math.round(d.vote_average * 10) / 10 : null, overview: d.overview || '',
      poster: d.poster_path ? `${IMG}/w342${d.poster_path}` : null, backdrop: d.backdrop_path ? `${IMG}/w1280${d.backdrop_path}` : null },
  };
}

// Tenner's go-between for searching every film and show on TMDB, without putting the TMDB key in the website.
//   GET /search?q=…   up to 20 films and shows, best match first
//   GET /title/m123   one title's details and UK where-to-watch, in the same shape as data/titles.json
//   GET /people?q=…   people (cast and crew) matching a name; without q, this week's most talked-about people
//   GET /person/123   one person: biography, and everything they've been in or made
//   GET /credits/m123 a title's main cast and key crew
//   /push/…           Watchlist alerts (push.js)
//   POST /contact     the Contact page's form: emailed to Tenner's inbox (Cloudflare Email Routing). The inbox's
//                     address is a Worker secret (SUPPORT_EMAIL), so it's never in the website or this code
// Only Tenner's own pages may call it (CORS), and answers are cached at Cloudflare's edge, so popular searches and
// titles barely touch TMDB: searches for a day, titles for six hours.
import { EmailMessage } from 'cloudflare:email';
import { pushRoute, pushRun, pushSend } from './push.js';

const TMDB = 'https://api.themoviedb.org/3', IMG = 'https://image.tmdb.org/t/p', REGION = 'GB';

export default {
  // every hour: Watchlist alerts for anything new (push.js)
  async scheduled(event, env, ctx) { ctx.waitUntil(pushRun(env)); },
  async fetch(req, env, ctx) {
    const url = new URL(req.url), origin = req.headers.get('origin') || '';
    if (url.pathname === '/push/send' && req.method === 'POST') return pushSend(req, env);   // the hourly run's batches (signed)
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ok = allowed.includes(origin);
    const cors = ok ? { 'access-control-allow-origin': origin, vary: 'origin' } : {};
    if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: { ...cors, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } });
    if (!ok) return json({ error: 'Not allowed from this site' }, 403, cors);
    if (url.pathname.startsWith('/push/')) return pushRoute(req, env, ctx, url, json, cors);
    if (url.pathname === '/contact') return req.method === 'POST' ? contact(req, env, cors) : json({ error: 'POST only' }, 405, cors);
    if (req.method !== 'GET') return json({ error: 'GET only' }, 405, cors);
    if (!env.TMDB_TOKEN) return json({ error: 'Not set up yet' }, 503, cors);

    let path, params, shape, ttl;
    if (url.pathname === '/search') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
      if (q.length < 2) return json({ results: [] }, 200, cors);
      path = '/search/multi'; params = { query: q, language: 'en-GB', region: REGION, include_adult: 'false' }; shape = searchShape; ttl = 86400;
    } else if (url.pathname === '/people') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
      if (q.length === 1) return json({ results: [] }, 200, cors);
      path = q ? '/search/person' : '/trending/person/week'; params = q ? { query: q, language: 'en-GB', include_adult: 'false' } : { language: 'en-GB' };
      shape = peopleShape; ttl = q ? 86400 : 21600;
    } else if (/^\/person\/\d{1,9}$/.test(url.pathname)) {
      path = url.pathname; params = { language: 'en-GB', append_to_response: 'combined_credits' }; shape = personShape; ttl = 86400;
    } else if (/^\/credits\/[mt]\d{1,9}$/.test(url.pathname)) {
      const k = url.pathname.split('/')[2], type = k[0] === 'm' ? 'movie' : 'tv';
      path = `/${type}/${k.slice(1)}/${type === 'tv' ? 'aggregate_credits' : 'credits'}`; params = { language: 'en-GB' }; shape = (d) => creditsShape(d, type); ttl = 86400;
    } else {
      const m = url.pathname.match(/^\/title\/([mt])(\d{1,9})$/);
      if (!m) return json({ error: 'Not found' }, 404, cors);
      const type = m[1] === 'm' ? 'movie' : 'tv';
      path = `/${type}/${m[2]}`; params = { language: 'en-GB', append_to_response: `watch/providers,videos,${type === 'movie' ? 'release_dates' : 'content_ratings'}` };
      shape = (d) => titleShape(d, type, m[1] + m[2]); ttl = 21600;
    }

    // the edge cache, keyed on the request without its origin
    const cache = caches.default, key = new Request(`https://tenner-cache/v3${url.pathname}?${new URLSearchParams(params)}`);   // bump v when a shape changes
    let hit = await cache.match(key);
    if (!hit) {
      const r = await fetch(`${TMDB}${path}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${env.TMDB_TOKEN}`, accept: 'application/json' } });
      if (!r.ok) return json({ error: `TMDB ${r.status}` }, r.status === 404 ? 404 : 502, cors);
      const body = shape(await r.json());
      if (body.items) await addLinks(body);   // the title's own page on each service, from Wikidata
      hit = new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } });
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

// Each title's own page on Netflix, Disney+, Prime Video, HBO Max and Apple TV, from Wikidata (as the hourly job does)
async function addLinks(body) {
  const k = Object.keys(body.items)[0], type = k[0] === 'm' ? 'movie' : 'tv', id = k.slice(1);
  const P = { nf: 'P1874', dpm: 'P7595', dps: 'P7596', pv: 'P8055', pv2: 'P14440', hb: 'P8298', atm: 'P9586', ats: 'P9751' };
  const q = `SELECT ${Object.keys(P).map((v) => `?${v}`).join(' ')} WHERE { ?i wdt:${type === 'movie' ? 'P4947' : 'P4983'} "${id}" . ${Object.entries(P).map(([v, p]) => `OPTIONAL { ?i wdt:${p} ?${v} }`).join(' ')} } LIMIT 1`;
  try {
    const r = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`,
      { headers: { accept: 'application/sparql-results+json', 'user-agent': 'Tenner/1.0 (https://github.com/danseacroft-lang/Tenner)' }, signal: AbortSignal.timeout(4000) });
    const b = r.ok ? (await r.json()).results?.bindings?.[0] : null; if (!b) return;
    const v = (n) => b[n]?.value;
    const ln = Object.fromEntries(Object.entries({ nf: v('nf'), dp: v('dpm') ? `movies/wd/${v('dpm')}` : v('dps') ? `series/wp/${v('dps')}` : undefined,
      pv: v('pv2') || v('pv'), hb: v('hb'), ap: v('atm') ? `movie/${v('atm')}` : v('ats') ? `show/${v('ats')}` : undefined }).filter(([, x]) => x));
    if (Object.keys(ln).length) body.items[k].ln = ln;
  } catch { /* no links: the sheet uses each service's search */ }
}

// ---------- people ----------
const yearOf = (x) => (x.release_date || x.first_air_date || '').slice(0, 4) || null;
const pic = (p) => (p ? `${IMG}/w185${p}` : null);
function peopleShape(d) {
  return {
    results: (d.results || []).filter((p) => !p.adult).slice(0, 24).map((p) => ({
      id: p.id, name: p.name, dept: p.known_for_department || null, photo: pic(p.profile_path), pop: Math.round(p.popularity || 0),
      known: (p.known_for || []).filter((x) => x.media_type === 'movie' || x.media_type === 'tv').slice(0, 3).map((x) => x.title || x.name),
    })),
  };
}
function personShape(p) {
  // how big a part each credit was, so Known For leads with what they're actually known for (a star turn), not a
  // one-episode guest voice on a giant show: billing order for films, episodes for shows, the job behind the camera
  const KEYJOB = /^(Director|Creator|Writer|Screenplay|Novel|Story)$/;
  const weight = (x, role) => {
    if (role === 'crew') return KEYJOB.test(x.job) ? 1 : /Producer/.test(x.job || '') ? 0.3 : 0.15;
    if (x.media_type === 'movie') { const o = x.order ?? 99; return o <= 2 ? 1 : o <= 5 ? 0.7 : o <= 12 ? 0.35 : 0.12; }
    const e = x.episode_count || 1; return e >= 20 ? 1 : e >= 8 ? 0.75 : e >= 3 ? 0.35 : 0.05;
  };
  const NOT_KNOWN = new Set([10767, 10763, 10764]);   // talk shows, news, reality: appearances, not work
  const all = (list, role) => (list || []).filter((x) => x.media_type === 'movie' || x.media_type === 'tv').map((x) => ({
    k: `${x.media_type === 'movie' ? 'm' : 't'}${x.id}`, type: x.media_type, title: x.title || x.name, year: yearOf(x),
    poster: x.poster_path ? `${IMG}/w342${x.poster_path}` : null, bd: x.backdrop_path ? `${IMG}/w1280${x.backdrop_path}` : null, pop: Math.round(x.popularity || 0), votes: x.vote_count || 0,
    role: role === 'cast' ? x.character || '' : x.job || '', eps: x.episode_count || null,
    w: weight(x, role), avg: x.vote_average || 0, talk: (x.genre_ids || []).some((g) => NOT_KNOWN.has(g)),
  }));
  const merge = (list) => {   // one row per title (several jobs on one title become "Writer, Director")
    const m = new Map();
    for (const x of list) {
      const y = m.get(x.k);
      if (y) { if (x.role && !y.role.includes(x.role)) y.role = [y.role, x.role].filter(Boolean).join(', '); y.w = Math.max(y.w, x.w); } else m.set(x.k, { ...x });
    }
    return [...m.values()];
  };
  const self = (x) => /^(himself|herself|self|themselves)\b/i.test(x.role);
  const cast = merge(all(p.combined_credits?.cast, 'cast')).filter((x) => !self(x) || x.votes > 50);
  const crew = merge(all(p.combined_credits?.crew, 'crew'));
  // the score: how widely seen (votes) × how big their part was × how well liked
  const score = (x) => x.votes * x.w * Math.min(1.25, Math.max(0.6, x.avg / 7));
  const known = [...cast, ...crew].filter((x) => x.poster && x.votes > 20 && !x.talk && !self(x)).sort((a, b) => score(b) - score(a))
    .filter((x, i, l) => l.findIndex((y) => y.k === x.k) === i).slice(0, 12).map(({ w, avg, talk, ...x }) => x);
  const slim = ({ bd, w, avg, talk, ...x }) => x;
  const byYear = (l) => l.sort((a, b) => (b.year || '9999').localeCompare(a.year || '9999'));
  return {
    id: p.id, name: p.name, dept: p.known_for_department || null, photo: p.profile_path ? `${IMG}/h632${p.profile_path}` : null,
    born: p.birthday || null, died: p.deathday || null, place: p.place_of_birth || null, bio: (p.biography || '').trim(),
    known, acting: byYear(cast).map(slim), crew: byYear(crew).map(slim),   // only Known For needs the wide artwork (the splash)
  };
}
function creditsShape(d, type) {
  const cast = (d.cast || []).slice(0, 16).map((c) => ({ id: c.id, name: c.name, photo: pic(c.profile_path),
    role: type === 'tv' ? (c.roles || []).map((r) => r.character).filter(Boolean)[0] || '' : c.character || '' }));
  const KEY = /^(Director|Creator|Screenplay|Writer|Novel|Executive Producer|Producer|Original Music Composer)$/;
  const seen = new Set(), crew = [];
  for (const c of d.crew || []) {
    const jobs = type === 'tv' ? (c.jobs || []).map((j) => j.job) : [c.job];
    const job = jobs.find((j) => KEY.test(j)); if (!job || seen.has(c.id)) continue;
    seen.add(c.id); crew.push({ id: c.id, name: c.name, photo: pic(c.profile_path), role: job });
  }
  const order = ['Creator', 'Director', 'Screenplay', 'Writer', 'Novel', 'Original Music Composer', 'Executive Producer', 'Producer'];
  return { cast, crew: crew.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)).slice(0, 6) };
}

// ---------- the Contact form ----------
// Checked, then sent on as a plain email to Tenner's inbox, with Reply-To set to the sender (if they gave an address),
// so replying is just pressing Reply. Nothing is kept here. One message a minute from each connection, and a hidden
// field that people never fill in but spam robots do.
const TOPICS = ['Feedback', 'Suggestions', 'Support', 'Legal'];
async function contact(req, env, cors) {
  if (!env.MAILER || !env.SUPPORT_EMAIL) return json({ error: 'Not set up yet' }, 503, cors);
  if (Number(req.headers.get('content-length') || 0) > 20000) return json({ error: 'Too long' }, 413, cors);
  let f; try { f = await req.json(); } catch { return json({ error: 'Bad form' }, 400, cors); }
  const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
  const msg = clean(f.msg, 5000), name = clean(f.name, 80).replace(/[\r\n<>"]/g, ''), email = clean(f.email, 200);
  const topic = TOPICS.includes(f.topic) ? f.topic : 'Feedback';
  if (f.website) return json({ ok: true }, 200, cors);   // the hidden field: a robot, quietly ignored
  if (msg.length < 2) return json({ error: 'Write a message first' }, 400, cors);
  if (!email) return json({ error: 'Add your email, so we can reply' }, 400, cors);
  if (email && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return json({ error: 'That email address doesn’t look right' }, 400, cors);
  // one a minute from each connection (the edge cache remembers it briefly; nothing else is kept)
  const ip = req.headers.get('cf-connecting-ip') || 'x', slot = new Request(`https://tenner-cache/contact/${encodeURIComponent(ip)}`);
  if (await caches.default.match(slot)) return json({ error: 'You’ve just sent one. Please wait a minute before sending another.' }, 429, cors);
  await caches.default.put(slot, new Response('1', { headers: { 'cache-control': 'max-age=60' } }));

  const from = 'contact@tenner.stream', to = env.SUPPORT_EMAIL;
  const word = (t) => (/^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${b64(t)}?=`);   // headers: plain ASCII or encoded
  const body = [`${topic}${name ? ` from ${name}` : ''}${email ? ` <${email}>` : ''}`, '', msg, '', '—', 'Sent from the Contact page on tenner.stream'].join('\r\n');
  const raw = [
    `From: ${word('Tenner')} <${from}>`, `To: <${to}>`,
    email ? `Reply-To: ${name ? `${word(name)} ` : ''}<${email}>` : null,
    `Subject: ${word(`Tenner: ${topic}${name ? ` from ${name}` : ''}`)}`,
    `Message-ID: <${crypto.randomUUID()}@tenner.stream>`, `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
    b64(body).replace(/.{76}/g, '$&\r\n'),
  ].filter((l) => l !== null).join('\r\n');
  try { await env.MAILER.send(new EmailMessage(from, to, raw)); }
  catch (e) { await caches.default.delete(slot); return json({ error: 'Couldn’t send right now. Please try again in a little while.' }, 502, cors); }
  return json({ ok: true }, 200, cors);
}
function b64(t) { let s = ''; for (const b of new TextEncoder().encode(t)) s += String.fromCharCode(b); return btoa(s); }

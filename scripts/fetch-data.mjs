#!/usr/bin/env node
// Builds site/data/trending.json (TMDB, every run) and site/data/new.json (Watchmode, at most once a day).
// Also site/data/cinema.json: films in UK cinemas now and coming soon (TMDB, twice a day).
//
// Env:
//   TMDB_TOKEN          TMDB "API Read Access Token" (v4). Or TMDB_API_KEY (v3 key) instead.
//   WATCHMODE_API_KEY   optional. Used for "New this week" (about 1 credit per day).
//   SITE_URL            optional. Your live Pages URL. Used to reuse the day's new.json (saving credits) and, if a
//                       partner API has a bad hour, to keep serving the last good data instead of failing.
//
// Built to run unattended: every request times out and retries, the data is sanity-checked before it's published,
// and any step that fails falls back to the copy already live on the site, so a bad hour never takes the site down.
//
// Usage:
//   node scripts/fetch-data.mjs           fetch real data
//   node scripts/fetch-data.mjs --sample  write fictional sample data (no keys needed)

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site', 'data');
const REGION = 'GB';
const PER_LIST = 10;

// Each service matches TMDB / Watchmode provider names (normalised: lowercase, "+" -> "plus").
// Edit the regexes if a provider gets renamed; data/providers.json shows what matched on each run.
export const SERVICES = [
  { key: 'netflix',   label: 'Netflix',     match: /^netflix/ },
  { key: 'disney',    label: 'Disney+',     match: /^disney plus/ },
  { key: 'prime',     label: 'Prime Video', match: /^(amazon prime( video)?|prime video)/ },
  { key: 'hbomax',    label: 'HBO Max',     match: /^(hbo max|max)( with ads)?$/ },
  { key: 'paramount', label: 'Paramount+',  match: /^paramount plus/ },
  // TMDB's 350 is the subscription (Apple TV+ until Apple renamed it "Apple TV"); its 2, also "Apple TV", is the store
  { key: 'appletv',   label: 'Apple TV',    match: /^apple ?tv plus/, ids: [350] },
];
// Stores: services where you buy or rent one title at a time. Each gets its own chart of shows and films (shop: true),
// stays out of the combined chart and My services, and can be picked in Browse.
export const SHOPS = [
  { key: 'skystore', label: 'Sky Store', match: /^sky store/ },
];
const RESELLER = /\b(amazon|apple tv|roku premium|roku) channel\b/;

const norm = (s) => s.toLowerCase().replace(/\+/g, ' plus').replace(/[^a-z0-9]+/g, ' ').trim();
export const serviceFor = (name, id) => {
  const n = norm(name);
  if (RESELLER.test(n)) return null;
  return SERVICES.find((s) => s.match.test(n) || s.ids?.includes(id)) || null;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, headers = {}, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      // a request that hangs gives up after 20 seconds and is retried, so a slow partner can't stall the run
      const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20000) });
      if (res.ok) return res.json();
      if (res.status < 500 && res.status !== 429) {
        throw Object.assign(new Error(`${res.status} ${res.statusText} for ${redact(url)}`), { fatal: true });
      }
      throw new Error(`${res.status} for ${redact(url)}`);
    } catch (err) {
      if (err.fatal || i >= tries) throw err;
      await sleep(1000 * 2 ** i);   // 2s, 4s, 8s
    }
  }
}
const redact = (u) => String(u).replace(/(api_key|apiKey)=[^&]+/g, '$1=***');
const warn = (title, msg) => console.warn(process.env.GITHUB_ACTIONS ? `::warning title=${title}::${msg}` : `${title}: ${msg}`);

// The copy of a data file that's live on the site right now (null if there isn't one, or it's sample data).
async function liveCopy(name) {
  if (!process.env.SITE_URL) return null;
  try {
    const json = await getJSON(new URL(`data/${name}`, process.env.SITE_URL.replace(/\/?$/, '/')), {}, 2);
    return json && !json.sample ? json : null;
  } catch { return null; }
}
const hoursOld = (json) => (Date.now() - Date.parse(json?.generatedAt)) / 3600e3;

// A chart is only published if it looks right: most services have a full top 10 of shows and of films.
function checkTrending(d) {
  const full = d.services.filter((s) => !s.store && !s.shop && s.tv.length >= 5 && s.movie.length >= 5).length;
  if (full < 3 || d.overall.tv.length < 5 || d.overall.movie.length < 5) throw new Error(`only ${full} of ${SERVICES.length} services came back with a chart`);
}

// ---------- TMDB ----------
const TMDB = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

function tmdb(path, params = {}) {
  const url = new URL(TMDB + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = {};
  if (process.env.TMDB_TOKEN) headers.authorization = `Bearer ${process.env.TMDB_TOKEN}`;
  else url.searchParams.set('api_key', process.env.TMDB_API_KEY);
  return getJSON(url, headers);
}

function toItem(r, type) {
  const title = type === 'movie' ? r.title : r.name;
  const date = type === 'movie' ? r.release_date : r.first_air_date;
  return {
    id: r.id,
    type,
    title,
    year: date ? Number(date.slice(0, 4)) : null,
    overview: r.overview || '',
    rating: r.vote_count >= 20 ? Math.round(r.vote_average * 10) / 10 : null,
    popularity: Math.round(r.popularity * 10) / 10,
    poster: r.poster_path ? `${IMG}/w342${r.poster_path}` : null,
    backdrop: r.backdrop_path ? `${IMG}/w1280${r.backdrop_path}` : null,
    url: `https://www.themoviedb.org/${type}/${r.id}/watch?locale=${REGION}`,
  };
}

async function buildTrending() {
  // 1. Find this region's provider IDs for each service (movie and TV lists differ slightly).
  const [pm, pt] = await Promise.all([
    tmdb('/watch/providers/movie', { watch_region: REGION }),
    tmdb('/watch/providers/tv', { watch_region: REGION }),
  ]);
  const ids = Object.fromEntries(SERVICES.map((s) => [s.key, new Set()]));
  const logos = {}; // the service's main plan has the best (lowest) display priority
  const seen = {};
  for (const s of SHOPS) ids[s.key] = new Set();
  for (const p of [...pm.results, ...pt.results]) {
    const s = serviceFor(p.provider_name, p.provider_id) || SHOPS.find((x) => x.match.test(norm(p.provider_name)));
    if (!s) continue;
    ids[s.key].add(p.provider_id); seen[p.provider_id] = p.provider_name;
    const prio = p.display_priorities?.[REGION] ?? p.display_priority ?? 999;
    if (p.logo_path && (!logos[s.key] || prio < logos[s.key].prio)) logos[s.key] = { prio, url: `${IMG}/w154${p.logo_path}` };
  }

  // 2. Most popular titles currently streaming on each service in the UK.
  const services = await Promise.all(SERVICES.map(async (s) => {
    const providerIds = [...ids[s.key]];
    if (!providerIds.length) {
      console.warn(`! No TMDB provider matched ${s.label}. Check the regex in SERVICES.`);
      return { key: s.key, label: s.label, logo: logos[s.key]?.url || null, providerIds, movie: [], tv: [] };
    }
    const q = {
      watch_region: REGION,
      with_watch_providers: providerIds.join('|'),
      with_watch_monetization_types: 'flatrate|free|ads',
      sort_by: 'popularity.desc',
      include_adult: 'false',
      language: 'en-GB',
      'vote_count.gte': '5',
    };
    const [m, t] = await Promise.all([tmdb('/discover/movie', q), tmdb('/discover/tv', q)]);
    return {
      key: s.key, label: s.label, logo: logos[s.key]?.url || null, providerIds,
      movie: m.results.slice(0, PER_LIST).map((r) => toItem(r, 'movie')),
      tv: t.results.slice(0, PER_LIST).map((r) => toItem(r, 'tv')),
    };
  }));

  // 3. Buy or rent: the most popular new releases you pay for one at a time (Apple TV, Prime Video Store, Sky Store…).
  //    Films with a UK digital release in the last six months.
  const ago = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
  const shop = { watch_region: REGION, with_watch_monetization_types: 'rent|buy', sort_by: 'popularity.desc', include_adult: 'false', language: 'en-GB' };
  // Films only: almost every show is on a subscription, so a TV buy-or-rent chart would just repeat the others.
  const sm = await tmdb('/discover/movie', { ...shop, region: REGION, with_release_type: '4', 'release_date.gte': ago(180), 'release_date.lte': ago(-1) });
  const store = {
    key: 'store', label: 'Buy or rent', store: true, logo: null, providerIds: [],
    movie: sm.results.slice(0, PER_LIST).map((r) => toItem(r, 'movie')),
    tv: [],
  };

  // 4. Each store (Sky Store): its most popular shows and films to buy or rent
  const shops = await Promise.all(SHOPS.map(async (s) => {
    const providerIds = [...ids[s.key]];
    if (!providerIds.length) { warn('Stores', `no TMDB provider matched ${s.label}`); return null; }
    const q = { ...shop, with_watch_providers: providerIds.join('|'), 'vote_count.gte': '5' };
    const [m, t] = await Promise.all([tmdb('/discover/movie', q), tmdb('/discover/tv', q)]);
    return { key: s.key, label: s.label, shop: true, logo: logos[s.key]?.url || null, providerIds,
      movie: m.results.slice(0, PER_LIST).map((r) => toItem(r, 'movie')), tv: t.results.slice(0, PER_LIST).map((r) => toItem(r, 'tv')) };
  }));

  return {
    // the combined chart stays subscription-only; Buy or rent and the stores are charts of their own
    data: { generatedAt: new Date().toISOString(), region: REGION, sample: false, services: [...services, ...shops.filter(Boolean), store], overall: overall(services) },
    providers: Object.fromEntries(SERVICES.map((s) => [s.label, [...ids[s.key]].map((id) => `${id} ${seen[id]}`)])),
    ids,
  };
}

// Combined chart: every title from every service, deduped, ranked by popularity.
function overall(services) {
  const out = {};
  for (const kind of ['tv', 'movie']) {
    const map = new Map();
    for (const s of services) for (const it of s[kind]) {
      const prev = map.get(it.id) || { ...it, on: [] };
      prev.on.push(s.key);
      map.set(it.id, prev);
    }
    out[kind] = [...map.values()].sort((a, b) => b.popularity - a.popularity).slice(0, PER_LIST);
  }
  return out;
}

// ---------- Netflix's own UK Top 10 (official, published weekly on Tuesdays) ----------
// Netflix publishes every country's weekly Top 10 as a data file. The Netflix tab uses it instead of TMDB's
// popularity ranking, so it matches the Top 10 people see in the app (weekly rather than daily). Each title is
// matched to TMDB for its poster, year and rating. Downloaded at most twice a day; otherwise the live copy is reused.
const NETFLIX_V = 4;   // bump when the reader changes, so the next run re-reads instead of reusing the live copy
const NETFLIX_TSV = 'https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv';
async function getText(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Tenner/1.0; +https://tenner.stream/)', accept: 'text/tab-separated-values,text/plain,*/*' }, signal: AbortSignal.timeout(90000) });
      if (res.ok) return res.text();
      if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(`${res.status} ${res.statusText}`), { fatal: true });
      throw new Error(`${res.status}`);
    } catch (err) { if (err.fatal || i >= tries) throw err; await sleep(1000 * 2 ** i); }
  }
}
const same = (a, b) => norm(a || '') === norm(b || '');
async function matchTmdb(title, type, year) {
  const r = await tmdb(`/search/${type}`, { query: title, language: 'en-GB', include_adult: 'false' });
  const list = r.results || [];
  const yearOf = (x) => Number(String((type === 'movie' ? x.release_date : x.first_air_date) || '').slice(0, 4)) || null;
  // an exact title match (from the right year, when Netflix says which), the most popular if several; else TMDB's best guess
  const exact = list.filter((x) => same(type === 'movie' ? x.title : x.name, title) || same(type === 'movie' ? x.original_title : x.original_name, title));
  // the same name can belong to several titles: take the one closest to Netflix's year (it can't have started after it)
  const gap = (x) => !year || !yearOf(x) ? 50 : yearOf(x) > year + 1 ? 99 : year - yearOf(x);
  const best = exact.sort((a, b) => gap(a) - gap(b) || b.popularity - a.popularity)[0];
  // a show can have started years before the season Netflix is counting (WWE Raw: 1993), so the most popular show of
  // that exact name wins;
  // a film must be from the right year, or it's probably a remake's namesake, so Netflix's own details are kept instead
  if (type === 'tv') return exact.sort((a, b) => b.popularity - a.popularity)[0] || list[0] || null;
  if (best && gap(best) <= 1) return best;
  return year ? null : best || list[0] || null;
}
// Netflix's Top 10 page is a week ahead of the data file, so it's read first. Its chart is embedded in the page as
// (escaped) JSON: one "PulseTop10ItemEntity" per entry, with weekEndDate, category (MOVIES or SERIES), weeklyRank,
// cumulativeWeeksInTop10, videoId, then the video's title and releaseYear (for a series: "Show: Season 2", then the
// parent show's title). If the page ever changes shape, the data file stands in.
const NETFLIX_PAGE = { movie: 'https://www.netflix.com/tudum/top10/united-kingdom', tv: 'https://www.netflix.com/tudum/top10/united-kingdom/tv' };
function readNetflixPage(html, type) {
  const want = type === 'tv' ? 'SERIES' : 'MOVIES';
  const str = (chunk, key) => [...chunk.matchAll(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`, 'g'))].map((m) => { try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; } });
  const num = (chunk, key) => { const m = chunk.match(new RegExp(`"${key}":(-?\\d+)`)); return m ? Number(m[1]) : null; };
  const rows = [];
  for (const raw of html.split('PulseTop10ItemEntity:top10-').slice(1)) {
    const chunk = raw.slice(0, 20000).replace(/\\"/g, '"');   // the page escapes its JSON inside a string
    if (str(chunk, 'category')[0] !== want) continue;
    const rank = num(chunk, 'weeklyRank'), week = str(chunk, 'weekEndDate')[0], titles = str(chunk, 'title');
    if (!rank || !week || !titles.length) continue;
    let title = titles[0], season = '';
    if (type === 'tv') {
      const show = titles[1] && titles[0].startsWith(`${titles[1]}: `) ? titles[1] : titles[0].split(': ')[0];
      season = titles[0].startsWith(`${show}: `) ? titles[0].slice(show.length + 2) : '';
      title = show;
    }
    rows.push({ week, rank, title, season, weeks: num(chunk, 'cumulativeWeeksInTop10'), year: num(chunk, 'releaseYear'), videoId: num(chunk, 'videoId') });
  }
  if (!rows.length) throw new Error(`no ${want} entries found on Netflix's page`);
  const week = rows.map((r) => r.week).sort().at(-1);
  const byRank = new Map();
  for (const r of rows) if (r.week === week && !byRank.has(r.rank)) byRank.set(r.rank, r);
  return { week, rows: [...byRank.values()].sort((a, b) => a.rank - b.rank).slice(0, PER_LIST) };
}
async function readNetflixFile() {
  const tsv = await getText(NETFLIX_TSV);
  const lines = tsv.split(/\r?\n/), head = lines[0].split('\t').map((h) => h.trim().toLowerCase());
  const col = (name) => { const i = head.indexOf(name); if (i < 0) throw new Error(`the Netflix file has no "${name}" column (has: ${head.join(', ')})`); return i; };
  const cIso = col('country_iso2'), cWeek = col('week'), cCat = col('category'), cRank = col('weekly_rank'), cShow = col('show_title');
  const cSeason = head.indexOf('season_title'), cWeeks = head.indexOf('cumulative_weeks_in_top_10');
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line.includes(`\t${REGION}\t`)) continue;
    const f = line.split('\t'); if (f[cIso] !== REGION) continue;
    const season = cSeason >= 0 && f[cSeason] && f[cSeason] !== 'N/A' ? f[cSeason].replace(/^.*?:\s*/, '') : '';
    rows.push({ week: f[cWeek], tv: /tv/i.test(f[cCat]), rank: Number(f[cRank]), title: f[cShow], season, weeks: cWeeks >= 0 ? Number(f[cWeeks]) || null : null, year: null, videoId: null });
  }
  if (!rows.length) throw new Error('no United Kingdom rows in the Netflix file');
  const week = rows.map((r) => r.week).sort().at(-1);
  const pick = (tv) => rows.filter((r) => r.week === week && r.tv === tv).sort((a, b) => a.rank - b.rank).slice(0, PER_LIST);
  return { week, tv: pick(true), movie: pick(false) };
}
export async function buildNetflixOfficial() {
  let src, from;
  try {
    const [m, t] = await Promise.all([getText(NETFLIX_PAGE.movie, 2), getText(NETFLIX_PAGE.tv, 2)]);
    const pm = readNetflixPage(m, 'movie'), pt = readNetflixPage(t, 'tv');
    if (pm.rows.length < 5 || pt.rows.length < 5) throw new Error(`the page had ${pt.rows.length} shows and ${pm.rows.length} films`);
    src = { week: [pm.week, pt.week].sort().at(-1), tv: pt.rows, movie: pm.rows }; from = 'page';
  } catch (err) {
    warn('Netflix Top 10', `couldn't read Netflix's Top 10 page (${err.message}), using its data file`);
    src = await readNetflixFile(); from = 'file';
  }
  const out = { week: src.week, from, tv: [], movie: [] };
  for (const type of ['tv', 'movie']) {
    out[type] = await Promise.all(src[type].map(async (r) => {
      let hit = null; try { hit = await matchTmdb(r.title, type, r.year); } catch { /* keep the bare title */ }
      const it = hit ? toItem(hit, type) : { id: `nf-${norm(r.title)}`, type, title: r.title, year: r.year, overview: '', rating: null, popularity: 0, poster: null, backdrop: null };
      it.title = r.title;   // Netflix's own name for it
      // seasons as Netflix names them, minus its date prefixes ("2026 - October 5, 2026" -> "October 5, 2026")
      const season = String(r.season || '').replace(/^\d{4}\s*-\s*/, '').trim();
      if (season && season !== r.title && !season.includes(r.title)) it.season = season;
      if (r.year && (!hit || type === 'movie')) it.year = r.year;   // a film's year as Netflix gives it
      if (r.weeks) it.weeks = r.weeks;
      // straight to it on Netflix when we know its Netflix ID
      it.url = r.videoId ? `https://www.netflix.com/title/${r.videoId}` : it.url || `https://www.netflix.com/search?q=${encodeURIComponent(r.title)}`;
      return it;
    }));
  }
  if (out.tv.length < 5 || out.movie.length < 5) throw new Error(`the latest week (${out.week}) has only ${out.tv.length} shows and ${out.movie.length} films`);
  return out;
}

// ---------- Chart movement: up, down or new since about a day ago, and days at No. 1 ----------
// Every run saves a small snapshot of each chart (data/history.json: the last 30 hours by the hour, and the last 30
// days), plus each title's life on the charts so far (h.life, see trackLife). Each title is compared with the snapshot nearest 24 hours ago (or, in a chart's first day, the oldest one at
// least 3 hours old), and a No. 1 counts the days it has held the top spot.
export function addMovement(data, prev, now = new Date()) {
  const h = prev?.v === 1 ? prev : { v: 1, hours: {}, days: {} };
  const keyOf = (it) => (/^\d+$/.test(String(it.id)) ? `${it.type === 'movie' ? 'm' : 't'}${it.id}` : `x${it.title}`);
  const charts = {};
  for (const sv of data.services) for (const t of ['tv', 'movie']) if (sv[t]?.length) charts[`${sv.key}:${t}`] = sv[t];
  for (const t of ['tv', 'movie']) if (data.overall?.[t]?.length) charts[`all:${t}`] = data.overall[t];
  const snap = Object.fromEntries(Object.entries(charts).map(([c, list]) => [c, list.map(keyOf)]));
  const hour = now.toISOString().slice(0, 13), day = now.toISOString().slice(0, 10), age = (k) => (now - Date.parse(k.length === 13 ? `${k}:00:00Z` : `${k}T12:00:00Z`)) / 3600e3;
  h.hours[hour] = snap; h.days[day] = snap;
  for (const k of Object.keys(h.hours)) if (age(k) > 30) delete h.hours[k];
  for (const k of Object.keys(h.days)) if (age(k) > 24 * 30) delete h.days[k];
  trackLife(h, data, day, keyOf);
  // the reference: nearest to 24 hours ago, or the oldest at least 3 hours old
  const past = Object.keys(h.hours).filter((k) => age(k) >= 3).sort();
  const ref = past.filter((k) => age(k) >= 20).sort((a, b) => Math.abs(age(a) - 24) - Math.abs(age(b) - 24))[0] || past[0];
  data.moveSince = ref ? new Date(`${ref}:00:00Z`).toISOString() : null;
  const days = Object.keys(h.days).sort().reverse();
  for (const [c, list] of Object.entries(charts)) {
    const before = ref && h.hours[ref][c];
    list.forEach((it, i) => {
      delete it.mv; delete it.top;
      if (before) { const was = before.indexOf(keyOf(it)); it.mv = was < 0 ? 'new' : was - i; }   // positive: up
      if (i === 0) { let n = 0; for (const d of days) { if (h.days[d][c]?.[0] === keyOf(it)) n++; else break; } if (n > 1) it.top = n; }
    });
  }
  return h;
}

// ---------- Each title's life on the charts: kept for a year after it was last in one ----------
// life[k] = { f: first day in a chart, l: last day, n: days in a chart, u: best UK rank, b: [best rank, service] on a
// service's own chart, o: days at No. 1 }. Streaming charts only (not buy or rent). The first time, it's filled in from
// the days already kept.
function lifeDay(life, snap, day, svcs) {
  const seen = new Map();   // key -> { u, b: [rank, svc] }
  for (const [c, list] of Object.entries(snap)) {
    const [sv] = c.split(':'); if (sv !== 'all' && !svcs.has(sv)) continue;
    list.forEach((k, i) => {
      if (k[0] === 'x') return;
      const x = seen.get(k) || {}; if (sv === 'all') x.u = Math.min(x.u || 99, i + 1); else if (!x.b || i + 1 < x.b[0]) x.b = [i + 1, sv];
      seen.set(k, x);
    });
  }
  for (const [k, x] of seen) {
    const e = life[k] || (life[k] = { f: day, l: '', n: 0, o: 0 });
    if (e.l === day) { if (x.u && x.u < (e.u || 99)) e.u = x.u; if (x.b && (!e.b || x.b[0] < e.b[0])) e.b = x.b; continue; }
    e.l = day; e.n++; if (x.u === 1 || x.b?.[0] === 1) e.o++;
    if (x.u && x.u < (e.u || 99)) e.u = x.u; if (x.b && (!e.b || x.b[0] < e.b[0])) e.b = x.b;
  }
}
function trackLife(h, data, day, keyOf) {
  const svcs = new Set((data.services || []).filter((s) => !s.store && !s.shop).map((s) => s.key));
  if (!h.life) { h.life = {}; for (const d of Object.keys(h.days).sort()) if (d !== day) lifeDay(h.life, h.days[d], d, svcs); }
  lifeDay(h.life, h.days[day], day, svcs);
  const cut = new Date(Date.parse(`${day}T12:00:00Z`) - 400 * 864e5).toISOString().slice(0, 10);
  for (const [k, e] of Object.entries(h.life)) if (e.l < cut) delete h.life[k];
}

// ---------- Trackers from the same history: each title's recent ranks, and the week's round-up ----------
// trail.json: for every charted title, its rank in its main chart (the UK chart if it's there, else its service's)
//   by day for the last 30 days and by hour for the last 24, for the line in the title sheet (0 = not in it), and its
//   life on the charts so far (p, from trackLife).
// week.json: "This week on Tenner": the biggest climbers, new arrivals and each chart's No. 1, against a week ago
//   (or the oldest day kept, while the history is still building up).
export function buildTrackers(data, h, now = new Date()) {
  const keyOf = (it) => (/^\d+$/.test(String(it.id)) ? `${it.type === 'movie' ? 'm' : 't'}${it.id}` : `x${it.title}`);
  const days = Object.keys(h.days).sort(), hours = Object.keys(h.hours).sort().slice(-24);
  const label = Object.fromEntries((data.services || []).map((s) => [s.key, s.label]));
  const charts = {}, info = {};
  for (const sv of data.services || []) if (!sv.store) for (const t of ['tv', 'movie']) if (sv[t]?.length) charts[`${sv.key}:${t}`] = sv[t];   // streaming charts (not buy or rent)
  for (const t of ['tv', 'movie']) if (data.overall?.[t]?.length) charts[`all:${t}`] = data.overall[t];
  for (const list of Object.values(charts)) for (const it of list) {
    const k = keyOf(it); if (info[k] || k[0] === 'x') continue;
    info[k] = { title: it.title, type: it.type, id: it.id, year: it.year || null, poster: it.poster || null, on: it.on || [] };
  }
  // ---- trail
  const rank = (snap, c, k) => (snap?.[c] ? snap[c].indexOf(k) + 1 : 0);
  const trail = { generatedAt: data.generatedAt, days, hours: hours.map((x) => `${x}:00:00Z`), items: {} };
  for (const k of Object.keys(info)) {
    const t = info[k].type, seen = (c) => days.filter((d) => rank(h.days[d], c, k)).length + hours.filter((x) => rank(h.hours[x], c, k)).length;
    const cands = [`all:${t}`, ...Object.keys(label).map((s) => `${s}:${t}`)].filter((c) => seen(c));
    if (!cands.length) continue;
    const c = cands.includes(`all:${t}`) ? `all:${t}` : cands.sort((a, b) => seen(b) - seen(a))[0];
    trail.items[k] = { c, d: days.map((d) => rank(h.days[d], c, k)), h: hours.map((x) => rank(h.hours[x], c, k)), ...(h.life?.[k] ? { p: h.life[k] } : {}) };
  }
  // ---- the week
  const today = now.toISOString().slice(0, 10);
  const back = days.filter((d) => d < today && (now - Date.parse(`${d}T12:00:00Z`)) / 864e5 <= 7.5);
  const refDay = back[0] || null;   // a week ago, or the oldest day we have
  const oldHour = Object.keys(h.hours).sort()[0];
  const was = refDay ? h.days[refDay] : h.hours[oldHour];
  const since = refDay ? `${refDay}T12:00:00Z` : oldHour ? `${oldHour}:00:00Z` : null;
  const nowSnap = Object.fromEntries(Object.entries(charts).map(([c, l]) => [c, l.map(keyOf)]));
  const climbers = [], arrivals = [], ones = [];
  for (const [c, list] of Object.entries(nowSnap)) {
    list.forEach((k, i) => {
      if (!info[k]) return;
      const j = was?.[c]?.indexOf(k) ?? -1;
      if (j > i) climbers.push({ k, c, from: j + 1, to: i + 1, by: j - i });
      if (c.startsWith('all:') && was && !Object.values(was).some((l) => l.includes(k))) arrivals.push({ k, c, to: i + 1 });   // nowhere in the charts a week ago
    });
    if (list[0] && info[list[0]]) {
      let n = 0; for (const d of [...days].reverse()) { if (h.days[d]?.[c]?.[0] === list[0]) n++; else break; }
      ones.push({ k: list[0], c, days: Math.max(1, n), fresh: !!was?.[c] && was[c][0] !== list[0] });
    }
  }
  const best = new Map(); for (const x of climbers.sort((a, b) => b.by - a.by || a.to - b.to)) if (!best.has(x.k)) best.set(x.k, x);
  const used = new Set([...[...best.keys()].slice(0, 8), ...arrivals.map((x) => x.k), ...ones.map((x) => x.k)]);
  const week = {
    generatedAt: data.generatedAt, since, days: refDay ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${refDay}T12:00:00Z`)) / 864e5) : 0,
    labels: { all: 'the UK', ...label },
    climbers: [...best.values()].slice(0, 8), arrivals: arrivals.sort((a, b) => a.to - b.to).slice(0, 8),
    ones: ones.sort((a, b) => (a.c.startsWith('all:') ? -1 : 0) - (b.c.startsWith('all:') ? -1 : 0) || b.days - a.days),
    items: Object.fromEntries([...used].filter((k) => info[k]).map((k) => [k, info[k]])),
  };
  return { trail, week };
}

// ---------- Each title's own page on each service, from Wikidata (free, no key) ----------
// TMDB says where a title is on, but not the link to it there. Wikidata keeps each title's Netflix, Disney+, Prime
// Video, HBO Max and Apple TV IDs, so the title sheet can open the title itself (and on phones, the app). Looked up by
// TMDB ID in a few batched queries; new titles straight away, then re-checked daily until found (every three days after),
// and titles without IDs fall back to the service's own search. Kept inside titles.json as each item's `ln`: { at, nf?, dp?, pv?, hb?, ap? }.
const WD_PROPS = { nf: 'P1874', dpm: 'P7595', dps: 'P7596', pv: 'P8055', pv2: 'P14440', hb: 'P8298', atm: 'P9586', ats: 'P9751' };
export async function buildLinks(keys, old) {
  // new titles straight away; ones Wikidata hasn't got yet every day (volunteers usually add new releases within days);
  // ones with links every three days
  const due = keys.filter((k) => !old?.[k] || hoursAgo(old[k].at) > (Object.keys(old[k]).length > 1 ? 72 : 24)).slice(0, 600);
  const out = Object.fromEntries(keys.filter((k) => old?.[k]).map((k) => [k, old[k]]));
  for (const type of ['movie', 'tv']) {
    const p = type === 'movie' ? 'm' : 't';
    const ids = due.filter((k) => k[0] === p).map((k) => k.slice(1));
    for (let i = 0; i < ids.length; i += 150) {
      const batch = ids.slice(i, i + 150);
      const vars = Object.keys(WD_PROPS).map((v) => `?${v}`).join(' ');
      const q = `SELECT ?t ${vars} WHERE { VALUES ?t { ${batch.map((x) => `"${x}"`).join(' ')} } ?i wdt:${type === 'movie' ? 'P4947' : 'P4983'} ?t . `
        + Object.entries(WD_PROPS).map(([v, prop]) => `OPTIONAL { ?i wdt:${prop} ?${v} }`).join(' ') + ' }';
      try {
        const res = await getJSON(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`,
          { 'user-agent': 'Tenner/1.0 (https://github.com/danseacroft-lang/Tenner)', accept: 'application/sparql-results+json' }, 2);
        const found = {};
        for (const b of res.results?.bindings || []) {
          const k = `${p}${b.t.value}`, v = (n) => b[n]?.value, f = (found[k] ||= {});
          const got = { nf: v('nf'), dp: v('dpm') ? `movies/wd/${v('dpm')}` : v('dps') ? `series/wp/${v('dps')}` : undefined,
            pv: v('pv2') || v('pv'), hb: v('hb'), ap: v('atm') ? `movie/${v('atm')}` : v('ats') ? `show/${v('ats')}` : undefined };
          for (const [n, x] of Object.entries(got)) if (x && !f[n]) f[n] = x;   // the first ID of each kind
        }
        for (const id of batch) out[`${p}${id}`] = { at: Date.now(), ...(found[`${p}${id}`] || {}) };
      } catch (err) { warn('Links', `Wikidata didn't answer (${err.message}); keeping the last links`); }
    }
  }
  return out;
}

// ---------- Title details: where to watch in the UK, runtime, age rating, trailer ----------
// One TMDB request per title (details plus watch providers, videos and UK certification), so Tenner can show where to
// watch without sending people elsewhere. Charted titles refresh every hour; the rest of the Browse catalogue at most
// once a day, a slice per run, reusing the live copy in between. Providers are stored once in a shared table.
const TITLE_V = 1;
const hoursAgo = (t) => (Date.now() - t) / 3600e3;
export async function buildTitles(chartKeys, catalogueKeys, prev) {
  const old = prev?.v === TITLE_V ? prev : null;
  const providers = { ...(old?.providers || {}) }, items = {};
  const want = [...new Set([...chartKeys, ...catalogueKeys])];
  const due = want.filter((k) => chartKeys.has(k) || !old?.items?.[k] || hoursAgo(old.items[k].at) > 24);
  // charted titles first, then the catalogue's oldest, up to 350 requests a run
  const order = due.sort((a, b) => (chartKeys.has(b) - chartKeys.has(a)) || ((old?.items?.[a]?.at || 0) - (old?.items?.[b]?.at || 0))).slice(0, 350);
  const fetched = await pool(order.map((k) => async () => {
    const type = k[0] === 'm' ? 'movie' : 'tv', id = k.slice(1);
    try { return [k, await tmdb(`/${type}/${id}`, { language: 'en-GB', append_to_response: `watch/providers,videos,${type === 'movie' ? 'release_dates' : 'content_ratings'}` })]; }
    catch { return [k, null]; }
  }));
  for (const [k, d] of fetched) {
    if (!d) { if (old?.items?.[k]) items[k] = old.items[k]; continue; }
    const type = k[0] === 'm' ? 'movie' : 'tv', gb = d['watch/providers']?.results?.[REGION] || {};
    const ids = (list) => (list || []).sort((a, b) => a.display_priority - b.display_priority).map((p) => {
      providers[p.provider_id] = [p.provider_name, p.logo_path || '']; return p.provider_id; });
    const cert = type === 'movie'
      ? (d.release_dates?.results || []).find((r) => r.iso_3166_1 === REGION)?.release_dates?.map((x) => x.certification).find(Boolean)
      : (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === REGION)?.rating;
    const vids = (d.videos?.results || []).filter((v) => v.site === 'YouTube' && /Trailer|Teaser/.test(v.type));
    const trailer = (vids.find((v) => v.type === 'Trailer' && v.official) || vids.find((v) => v.type === 'Trailer') || vids[0])?.key;
    const runtime = type === 'movie' ? d.runtime : (d.episode_run_time?.[0] || d.last_episode_to_air?.runtime || null);
    const nx = d.next_episode_to_air;   // shows: the next episode's date, for the countdown
    items[k] = Object.fromEntries(Object.entries({
      nx: type === 'tv' && nx?.air_date ? [nx.air_date, nx.season_number, nx.episode_number] : undefined,
      sz: type === 'tv' ? (d.seasons || []).filter((s) => s.season_number > 0 && s.episode_count > 0).map((s) => s.episode_count) : undefined,
      en: type === 'tv' && /Ended|Canceled/.test(d.status || '') ? 1 : undefined,
      at: Date.now(), rt: runtime || undefined, se: type === 'tv' ? d.number_of_seasons || undefined : undefined, c: cert || undefined,
      g: (d.genres || []).map((g) => g.name).slice(0, 3), tl: d.tagline || undefined,
      f: ids(gb.flatrate), fr: ids([...(gb.free || []), ...(gb.ads || [])]), re: ids(gb.rent), bu: ids(gb.buy), tr: trailer,
    }).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));
  }
  // everything else we still want and already had carries over untouched
  for (const k of want) if (!items[k] && old?.items?.[k]) items[k] = old.items[k];
  // keep only the services something still uses
  const used = new Set(Object.values(items).flatMap((x) => [...(x.f || []), ...(x.fr || []), ...(x.re || []), ...(x.bu || [])]));
  for (const id of Object.keys(providers)) if (!used.has(+id)) delete providers[id];
  return { v: TITLE_V, generatedAt: new Date().toISOString(), logo: `${IMG}/w92`, providers, items, refreshed: fetched.filter(([, d]) => d).length };
}

// ---------- Watchmode (daily) ----------
const realNew = (j) => !!j && Array.isArray(j.items) && !j.disabled && !j.error && !j.sample;
export async function buildNew() {
  const key = process.env.WATCHMODE_API_KEY;
  if (!key) {
    const msg = 'No WATCHMODE_API_KEY secret, so "New this week" is switched off. Add it under Settings > Secrets and variables > Actions.';
    console.warn(process.env.GITHUB_ACTIONS ? `::notice title=New this week is off::${msg}` : msg);
    return null;
  }

  // Reuse the copy already live on the site if it's less than 20 hours old.
  const prev = await liveCopy('new.json');
  if (realNew(prev) && prev.leaving && hoursOld(prev) < 20) {   // (an older copy without Coming soon or Leaving soon is fetched afresh)
    console.log('Reusing live new.json from', prev.generatedAt);
    return prev;
  }

  // Safety cap: ask Watchmode how much of this month's allowance is left (this check is free) and stop well short of it.
  // The free plan is 2,500 credits a month, needs no card and can't charge; Tenner normally spends about 30.
  const status = await getJSON('https://api.watchmode.com/v1/status/', { 'X-API-Key': key }, 2);
  const left = (status.quota ?? 0) - (status.quotaUsed ?? 0);
  console.log(`Watchmode credits this month: ${status.quotaUsed} used of ${status.quota}`);
  if (left < 200) throw new Error(`only ${left} Watchmode credits left this month, so skipping until it resets`);

  const day = (d) => Number(d.toISOString().slice(0, 10).replace(/-/g, ''));
  const now = new Date();
  // two asks of up to 250 each: the last week, and what's coming over the next month (the list's Coming soon)
  const ask = (a, b) => getJSON(`https://api.watchmode.com/v1/releases/?start_date=${day(a)}&end_date=${day(b)}&limit=250`, { 'X-API-Key': key });
  const [past, next] = await Promise.all([ask(new Date(now - 7 * 864e5), now), ask(new Date(+now + 864e5), new Date(+now + 31 * 864e5)).catch(() => ({ releases: [] }))]);
  const seenRel = new Set();
  const releases = [...(past.releases || []), ...(next.releases || [])].filter((r) => { const k = `${r.id}:${r.source_id}:${r.season_number}`; if (seenRel.has(k)) return false; seenRel.add(k); return true; });

  const items = releases
    .map((r) => ({ r, s: serviceFor(r.source_name || '') }))
    .filter(({ s }) => s)
    .map(({ r, s }) => ({
      title: r.title,
      type: r.tmdb_type === 'movie' ? 'movie' : 'tv',
      season: r.season_number || null,
      date: r.source_release_date,
      service: s.key,
      original: r.is_original === 1,
      poster: r.poster_url || null,
      id: r.tmdb_id || null,
      url: r.tmdb_id ? `https://www.themoviedb.org/${r.tmdb_type}/${r.tmdb_id}/watch?locale=${REGION}` : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { generatedAt: new Date().toISOString(), note: 'Release dates are mostly US dates from Watchmode.', items, leaving: await buildLeaving(key) };
}

// Leaving soon: Watchmode's calendar of titles about to leave a service (the free plan shows the next ten). The dates
// are mostly American, so the page says so. A missing or changed answer just means no Leaving soon section.
async function buildLeaving(key) {
  try {
    const json = await getJSON('https://api.watchmode.com/v1/title-leaving-dates/', { 'X-API-Key': key }, 2);
    const list = Array.isArray(json) ? json : json.titles || json.results || json.leaving || json.releases || json.data || [];
    if (list[0]) console.log('Leaving dates fields:', Object.keys(list[0]).join(', '));
    const dateOf = (r) => { for (const [f, v] of Object.entries(r)) if (/date|leav|expir|end/i.test(f) && /^\d{4}-?\d{2}-?\d{2}/.test(String(v))) return String(v).replace(/^(\d{4})-?(\d{2})-?(\d{2}).*/, '$1-$2-$3'); return null; };
    const today = new Date().toISOString().slice(0, 10);
    return list.map((r) => ({ r, s: serviceFor(r.source_name || r.source || r.service || '') })).filter(({ s }) => s).map(({ r, s }) => ({
      title: r.title || r.name, type: (r.tmdb_type || r.type) === 'movie' ? 'movie' : 'tv', date: dateOf(r), service: s.key,
      poster: r.poster_url || r.poster || null, id: r.tmdb_id || null,
      url: r.tmdb_id ? `https://www.themoviedb.org/${(r.tmdb_type || r.type) === 'movie' ? 'movie' : 'tv'}/${r.tmdb_id}/watch?locale=${REGION}` : null,
    })).filter((x) => x.title && x.date && x.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  } catch (err) { console.log('Leaving soon skipped:', err.message); return []; }
}

// ---------- What it costs to rent or buy: the buy-or-rent chart's films and shows, from Watchmode ----------
// Watchmode lists each title's rental and purchase offers with prices. Each title costs two credits (one to look it up by
// its TMDB number), so prices are kept for three days and only the buy-or-rent chart is priced: about 15 credits a day,
// well inside the free 2,500 a month. prices.json: { k: { at, o: [[service, 'rent'|'buy', price, quality, link]] } }.
export async function buildPrices(data, prev) {
  const key = process.env.WATCHMODE_API_KEY; if (!key) return null;
  const out = { generatedAt: new Date().toISOString(), items: {} }, now = Date.now();
  const want = new Map();
  for (const sv of data.services || []) if (sv.store || sv.shop) for (const t of ['tv', 'movie']) for (const it of sv[t] || []) if (/^\d+$/.test(String(it.id))) want.set(`${t === 'movie' ? 'm' : 't'}${it.id}`, t);
  let asked = 0;
  for (const [k, t] of want) {
    const old = prev?.items?.[k];
    if (old && now - old.at < 3 * 864e5) { out.items[k] = old; continue; }
    if (asked >= 12) { if (old) out.items[k] = old; continue; }   // a dozen new lookups a run at most
    asked++;
    try {
      const list = await getJSON(`https://api.watchmode.com/v1/title/${t === 'movie' ? 'movie' : 'tv'}-${k.slice(1)}/sources/?regions=${REGION}`, { 'X-API-Key': key }, 2);
      const o = (Array.isArray(list) ? list : []).filter((x) => (x.type === 'rent' || x.type === 'buy') && x.price > 0 && (!x.region || x.region === REGION))
        .map((x) => [x.name, x.type, +x.price, x.format || '', x.web_url || '']).sort((a, b) => a[2] - b[2]);
      out.items[k] = { at: now, o };
    } catch (err) { if (old) out.items[k] = old; if (/40[13]/.test(err.message)) break; }
  }
  console.log(`Prices: ${Object.values(out.items).filter((x) => x.o.length).length} of ${want.size} buy-or-rent titles priced (${asked} looked up)`);
  return out;
}

// ---------- Browse catalogue ----------
// The most popular ~100 shows and ~100 films on each service, plus new films to buy or rent, merged into one
// compact list the Browse page filters and sorts in the browser. Short keys keep the file small:
// i id, t 'tv'|'movie', n title, d first date, r rating (when 20+ votes), v votes, p popularity, img poster path,
// g genre ids, s services it was found on, b 1 if it's a buy-or-rent title.
const PAGES = 5;
async function pool(tasks, limit = 8) {
  const out = []; let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => { while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); } }));
  return out;
}
export async function buildCatalogue(ids) {
  const base = { watch_region: REGION, sort_by: 'popularity.desc', include_adult: 'false', language: 'en-GB', 'vote_count.gte': '5' };
  const jobs = [];
  for (const s of SERVICES) {
    const providerIds = [...(ids[s.key] || [])]; if (!providerIds.length) continue;
    for (const type of ['tv', 'movie']) for (let page = 1; page <= PAGES; page++)
      jobs.push(async () => ({ type, key: s.key, res: await tmdb(`/discover/${type}`, { ...base, page, with_watch_providers: providerIds.join('|'), with_watch_monetization_types: 'flatrate|free|ads' }) }));
  }
  for (const s of SHOPS) {   // the stores' catalogues, so Browse can filter to them
    const providerIds = [...(ids[s.key] || [])]; if (!providerIds.length) continue;
    for (const type of ['tv', 'movie']) for (let page = 1; page <= 3; page++)
      jobs.push(async () => ({ type, key: s.key, res: await tmdb(`/discover/${type}`, { ...base, page, with_watch_providers: providerIds.join('|'), with_watch_monetization_types: 'rent|buy' }) }));
  }
  const since = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
  for (let page = 1; page <= 3; page++)
    jobs.push(async () => ({ type: 'movie', key: 'store', res: await tmdb('/discover/movie', { ...base, page, with_watch_monetization_types: 'rent|buy', region: REGION, with_release_type: '4', 'release_date.gte': since }) }));
  const [results, gm, gt] = await Promise.all([pool(jobs), tmdb('/genre/movie/list', { language: 'en-GB' }), tmdb('/genre/tv/list', { language: 'en-GB' })]);

  const byId = new Map(), more = {};
  for (const { type, key, res } of results) for (const r of res.results || []) {
    if (!r.poster_path) continue;
    const id = `${type[0]}${r.id}`;
    let it = byId.get(id);
    if (!it) {
      // the details Browse shows when you hover a poster (description and artwork), kept in their own file so the
      // catalogue stays small; Browse fetches them only when someone first hovers
      more[id] = [clip(r.overview), r.backdrop_path || ''];
      it = { i: r.id, t: type, n: type === 'movie' ? r.title : r.name, d: (type === 'movie' ? r.release_date : r.first_air_date) || '',
        r: r.vote_count >= 20 ? Math.round(r.vote_average * 10) / 10 : 0, v: r.vote_count, p: Math.round(r.popularity), img: r.poster_path, g: r.genre_ids || [], s: [] };
      byId.set(id, it);
    }
    if (key === 'store') it.b = 1; else if (!it.s.includes(key)) it.s.push(key);
  }
  const genres = {};
  for (const g of [...gm.genres, ...gt.genres]) genres[g.id] = g.name;
  const cat = { generatedAt: new Date().toISOString(), region: REGION, img: `${IMG}/w342`, genres, items: [...byId.values()] };
  return { cat, more: { generatedAt: cat.generatedAt, img: `${IMG}/w780`, items: more } };
}
// a description cut to its first sentences, about 320 characters at most, ending cleanly
function clip(t) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 320) return t;
  const cut = t.slice(0, 320), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 120 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

// ---------- Sample data ----------
function sample() {
  const names = [
    'The Lighthouse Keepers', 'Marrow Lane', 'Low Tide at Kessock', 'Signal Box', 'The Allotment',
    'Northern Line', 'Ferryman', 'Brass Monkeys', 'Quiet Carriage', 'The Long Weekend', 'Fenland',
    'Second Post', 'Dog and Duck', 'Ivy House', 'The Night Bus', 'Kiln', 'Cobble Street',
    'Saltmarsh', 'The Grammar School', 'Overcast', 'Weatherfield Close', 'Pier Pressure',
  ];
  const blurb = 'Fictional sample title. Add your TMDB key and run the workflow to see what is really popular.';
  let n = 1;
  const make = (type, i, s) => {
    const title = names[(i * 7 + s * 3 + (type === 'tv' ? 0 : 11)) % names.length];
    return {
      id: n++, type, title, year: 2026 - ((i + s) % 4), overview: blurb,
      rating: Math.round((6 + ((i * 13 + s * 5) % 30) / 10) * 10) / 10,
      popularity: Math.round((400 - i * 31 - s * 7) * 10) / 10,
      poster: null, backdrop: null, url: 'https://www.themoviedb.org/',
    };
  };
  const services = SERVICES.map((s, si) => ({
    key: s.key, label: s.label, providerIds: [],
    tv: Array.from({ length: PER_LIST }, (_, i) => make('tv', i, si)),
    movie: Array.from({ length: PER_LIST }, (_, i) => make('movie', i, si)),
  }));
  const storeChart = { key: 'store', label: 'Buy or rent', store: true, logo: null, providerIds: [],
    tv: [], movie: Array.from({ length: PER_LIST }, (_, i) => make('movie', i, 7)) };
  const shopCharts = SHOPS.map((s, si) => ({ key: s.key, label: s.label, shop: true, logo: null, providerIds: [],
    tv: Array.from({ length: PER_LIST }, (_, i) => make('tv', i, 9 + si)), movie: Array.from({ length: PER_LIST }, (_, i) => make('movie', i, 9 + si)) }));
  const today = new Date();
  const iso = (d) => new Date(+today + d * 864e5).toISOString().slice(0, 10);
  const fresh = {
    generatedAt: today.toISOString(), note: 'Sample data.',
    items: [-5, -3, -1, 0, 2, 4, 6, 9, 13, 18, 24].map((d, i) => ({
      title: names[(i * 5 + 2) % names.length], type: i % 3 ? 'tv' : 'movie', season: i % 3 ? (i % 4) + 1 : null,
      date: iso(d), service: SERVICES[(i * 3) % SERVICES.length].key, original: i % 2 === 0, poster: null, url: null,
    })),
    leaving: [3, 5, 11].map((d, i) => ({ title: names[(i * 7 + 4) % names.length], type: i % 2 ? 'tv' : 'movie', date: iso(d),
      service: SERVICES[(i * 2 + 1) % SERVICES.length].key, poster: null, id: null, url: null })),
  };
  return {
    trending: { generatedAt: today.toISOString(), region: REGION, sample: true, services: [...services, ...shopCharts, storeChart], overall: overall(services) },
    fresh,
  };
}

function sampleCatalogue() {
  const words = ['Lighthouse', 'Marrow', 'Kessock', 'Signal', 'Allotment', 'Northern', 'Ferryman', 'Brass', 'Carriage', 'Weekend', 'Fenland', 'Post', 'Duck', 'Ivy', 'Night Bus', 'Kiln', 'Cobble', 'Saltmarsh', 'Grammar', 'Overcast', 'Weatherfield', 'Pier'];
  const genres = { 18: 'Drama', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 10751: 'Family', 16: 'Animation', 10765: 'Sci-Fi & Fantasy', 28: 'Action', 53: 'Thriller', 10749: 'Romance' };
  const gids = Object.keys(genres).map(Number);
  const items = Array.from({ length: 180 }, (_, k) => {
    const type = k % 2 ? 'movie' : 'tv', y = 2026 - (k % 9), m = String(1 + (k * 5) % 12).padStart(2, '0');
    return { i: 9000 + k, t: type, n: `The ${words[k % words.length]}${k > 21 ? ' ' + (Math.floor(k / 22) + 1) : ''}`, d: `${y}-${m}-1${k % 9}`,
      r: Math.round((5.5 + ((k * 37) % 40) / 10) * 10) / 10, v: 30 + (k * 97) % 4000, p: 900 - k * 4, img: null,
      g: [gids[k % gids.length], gids[(k * 3) % gids.length]], s: SERVICES.filter((_, j) => (k + j) % 4 === 0).map((s) => s.key), ...(k % 11 === 0 ? { b: 1 } : {}) };
  });
  return { generatedAt: new Date().toISOString(), region: REGION, img: '', genres, items, sample: true };
}

// ---------- At the cinema (TMDB): what's showing in UK cinemas, and what's coming in the next three months ----------
// UK release dates and certificates come from each film's own release list (theatrical first, then limited).
const CINEMA_V = 1;
export async function buildCinema() {
  const prev = await liveCopy('cinema.json');
  if (prev?.v === CINEMA_V && hoursOld(prev) < 12) { console.log('Reusing live cinema.json from', prev.generatedAt); return prev; }
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10), today = day(0);
  const list = async (gte, lte, sort) => {
    const pages = await Promise.all([1, 2].map((page) => tmdb('/discover/movie', { region: REGION, language: 'en-GB', with_release_type: '2|3',
      'release_date.gte': gte, 'release_date.lte': lte, sort_by: sort, include_adult: 'false', page: String(page) })));
    return pages.flatMap((p) => p.results || []).filter((r) => r.poster_path && !r.adult);
  };
  const [now, soon] = await Promise.all([list(day(-42), today, 'popularity.desc'), list(day(1), day(90), 'popularity.desc')]);
  const shape = async (r) => {
    let date = null, cert = null;
    try {
      const gb = (await tmdb(`/movie/${r.id}/release_dates`)).results?.find((x) => x.iso_3166_1 === REGION)?.release_dates || [];
      const pick = gb.filter((x) => x.type === 3).sort((a, b) => a.release_date.localeCompare(b.release_date))[0]
        || gb.filter((x) => x.type === 2).sort((a, b) => a.release_date.localeCompare(b.release_date))[0];
      date = pick?.release_date?.slice(0, 10) || null; cert = gb.map((x) => x.certification).find(Boolean) || null;
    } catch {}
    const it = toItem(r, 'movie');
    return { id: it.id, title: it.title, year: it.year, date: date || r.release_date || null, cert, overview: it.overview, rating: it.rating,
      popularity: it.popularity, poster: it.poster, backdrop: it.backdrop };
  };
  const seen = new Set(), uniq = (l) => l.filter((r) => !seen.has(r.id) && seen.add(r.id));
  const nowItems = (await pool(uniq(now).slice(0, 24).map((r) => () => shape(r)), 6)).filter((x) => x.date && x.date <= today).slice(0, 20);
  const soonItems = (await pool(uniq(soon).slice(0, 30).map((r) => () => shape(r)), 6)).filter((x) => x.date && x.date > today)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 24);
  if (nowItems.length < 4) throw new Error(`only ${nowItems.length} films in cinemas came back`);
  return { v: CINEMA_V, generatedAt: new Date().toISOString(), now: nowItems, soon: soonItems };
}

// ---------- A page for each title, for link previews ----------
// t/m123/index.html for every title Tenner has details for: its name, artwork and where it streams in the tags that
// Messages, WhatsApp, Slack and the rest read when a link is shared, and straight on to the title's sheet for people.
// Built from the data files just written, so it follows the hour's chart, Browse and New.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BRAND = (n) => { const s = serviceFor(n); return s ? s.label : n.replace(/ (Standard|Basic|Premium)? ?with Ads$/i, '').replace(/^Amazon Prime Video$/, 'Prime Video').replace(/^Disney Plus$/, 'Disney+'); };
export async function buildTitlePages() {
  const read = async (n) => { try { return JSON.parse(await readFile(join(OUT, n), 'utf8')); } catch { return null; } };
  const [trending, browse, more, fresh, titles] = await Promise.all(['trending.json', 'browse.json', 'browse-more.json', 'new.json', 'titles.json'].map(read));
  if (!titles?.items) return 0;
  const info = new Map();   // k → { title, year, overview, art }
  const put = (k, x) => { const o = info.get(k) || {}; for (const [f, v] of Object.entries(x)) if (v && !o[f]) o[f] = v; info.set(k, o); };
  const fromChart = (it, t) => /^\d+$/.test(String(it.id)) && put(`${t[0]}${it.id}`, { title: it.title, year: it.year, overview: it.overview, art: it.backdrop || it.poster });
  for (const sv of trending?.services || []) for (const t of ['tv', 'movie']) for (const it of sv[t] || []) fromChart(it, t);
  for (const t of ['tv', 'movie']) for (const it of trending?.overall?.[t] || []) fromChart(it, t);
  for (const it of fresh?.items || []) if (it.id) put(`${it.type === 'movie' ? 'm' : 't'}${it.id}`, { title: it.title, art: it.poster });
  for (const x of browse?.items || []) {
    const k = `${x.t[0]}${x.i}`, m = more?.items?.[k];
    put(k, { title: x.n, year: (x.d || '').slice(0, 4), overview: m?.[0], art: m?.[1] && more.img ? more.img + m[1] : x.img && browse.img ? browse.img + x.img : null });
  }
  await rm(join(ROOT, 'site', 't'), { recursive: true, force: true });
  let n = 0;
  for (const [k, x] of Object.entries(titles.items)) {
    const t = info.get(k); if (!t?.title) continue;
    const seen = new Set(), on = (x.f || []).map((id) => titles.providers?.[id]?.[0]).filter(Boolean).map(BRAND).filter((b) => !seen.has(b) && seen.add(b)).slice(0, 3);
    const where = on.length ? `On ${on.length > 1 ? `${on.slice(0, -1).join(', ')} and ${on.at(-1)}` : on[0]} in the UK` : (x.re?.length || x.bu?.length) ? 'To rent or buy in the UK' : 'Where to watch it in the UK';
    const kind = k[0] === 'm' ? 'Film' : 'Series', year = t.year ? ` · ${t.year}` : '';
    const ov = String(t.overview || '').replace(/\s+/g, ' ').trim(), desc = `${kind}${year} · ${where}.${ov ? ` ${ov.length > 160 ? `${ov.slice(0, 157).replace(/\s+\S*$/, '')}…` : ov}` : ''}`;
    const url = `https://tenner.stream/t/${k}/`, img = /^https:\/\/image\.tmdb\.org\//.test(t.art || '') ? t.art : 'https://tenner.stream/og.jpg';
    const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.title)} | Tenner</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#000000">
<link rel="icon" href="../../favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="../../apple-touch-icon.png">
<meta property="og:type" content="${k[0] === 'm' ? 'video.movie' : 'video.tv_show'}"><meta property="og:site_name" content="Tenner">
<meta property="og:title" content="${esc(t.title)}${t.year ? ` (${esc(t.year)})` : ''}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}"><meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image">
<style>html{background:#000;color-scheme:dark}</style>
<script>location.replace('../../?t=${k}')</script>
<noscript><meta http-equiv="refresh" content="0; url=../../?t=${k}"></noscript>
</head><body></body></html>
`;
    await mkdir(join(ROOT, 'site', 't', k), { recursive: true });
    await writeFile(join(ROOT, 'site', 't', k, 'index.html'), html); n++;
  }
  console.log(`Title pages: ${n}`);
  return n;
}

// ---------- main ----------
async function write(name, obj) {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, name), JSON.stringify(obj));   // compact: smaller downloads for every visitor
  console.log('wrote', join('site/data', name));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--sample')) {
    const { trending, fresh } = sample();
    await write('trending.json', trending);
    await write('new.json', fresh);
    const sd = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10), sf = (i, n) => ({ id: 9000 + i, title: `Sample Film ${i + 1}`, year: Number(sd(n).slice(0, 4)),
      date: sd(n), cert: ['PG', '12A', '15', 'U'][i % 4], overview: 'Fictional sample film.', rating: null, popularity: 100 - i, poster: null, backdrop: null });
    await write('cinema.json', { v: 1, generatedAt: new Date().toISOString(), sample: true, now: Array.from({ length: 8 }, (_, i) => sf(i, -3 * i - 1)), soon: Array.from({ length: 8 }, (_, i) => sf(i + 8, 4 * i + 2)) });
    // sample title details: a few made-up services and runtimes, so the title sheet can be tried without keys
    const sp = { 8: ['Netflix', ''], 337: ['Disney Plus', ''], 9: ['Amazon Prime Video', ''], 2: ['Apple TV', ''], 130: ['Sky Store', ''], 1899: ['HBO Max', ''] };
    const sItems = {};
    for (const sv of trending.services) for (const t of ['tv', 'movie']) for (const it of sv[t] || []) {
      const n = it.id; sItems[`${t[0]}${n}`] = { at: Date.now(), rt: t === 'movie' ? 88 + (n * 7) % 60 : 40 + (n * 3) % 25, se: t === 'tv' ? 1 + n % 4 : undefined,
        c: ['U', 'PG', '12', '15', '18'][n % 5], g: ['Drama', 'Comedy', 'Crime'].slice(0, 1 + n % 3), tl: n % 2 ? 'A fictional tagline for a sample title.' : undefined,
        f: sv.store ? [] : [[8, 337, 9, 1899][n % 4]], fr: n % 5 === 0 ? [9] : [], re: [2, 130].slice(0, 1 + n % 2), bu: [2], tr: undefined,
        nx: t === 'tv' && n % 3 === 0 ? [new Date(Date.now() + (1 + n % 9) * 864e5).toISOString().slice(0, 10), 1 + n % 4, 3 + n % 6] : undefined,
        sz: t === 'tv' ? Array.from({ length: 1 + n % 4 }, (_, s) => 6 + ((n + s) % 5)) : undefined,
        ln: n % 2 ? { at: Date.now(), nf: String(80000000 + n), ap: `${t === 'movie' ? 'movie' : 'show'}/umc.cmc.sample${n}` } : undefined };
    }
    // sample trackers: a made-up week of charts (each day nudged a little), so the history and round-up can be tried
    let sh = { v: 1, hours: {}, days: {} };
    const keyOf = (it) => `${it.type === 'movie' ? 'm' : 't'}${it.id}`;
    for (let i = 7; i >= 0; i--) {
      const when = new Date(Date.now() - i * 864e5), snap = {};
      const jig = (k) => [...k].reduce((n, ch) => n + ch.charCodeAt(0), 0);
      const nudge = (list) => { const k = list.map(keyOf).map((key, j) => [key, j + (i ? ((jig(key) + i * 7) % 7) - 3 : 0)]).sort((p, q) => p[1] - q[1]).map((p) => p[0]); return i > 4 ? k.slice(0, -2) : k; };
      for (const sv of trending.services) for (const t of ['tv', 'movie']) if (sv[t]?.length) snap[`${sv.key}:${t}`] = nudge(sv[t]);
      for (const t of ['tv', 'movie']) snap[`all:${t}`] = nudge(trending.overall[t]);
      sh.days[when.toISOString().slice(0, 10)] = snap;
      if (i === 0) for (let x = 23; x >= 1; x--) sh.hours[new Date(Date.now() - x * 3600e3).toISOString().slice(0, 13)] = x > 12 ? sh.days[new Date(Date.now() - 864e5).toISOString().slice(0, 10)] : snap;
    }
    sh = addMovement(trending, sh);
    const st = buildTrackers(trending, sh);
    await write('trending.json', trending); await write('trail.json', st.trail); await write('week.json', st.week);
    await write('titles.json', { v: 1, generatedAt: trending.generatedAt, logo: '', providers: sp, items: sItems, sample: true });
    const pItems = {};   // sample prices for the buy-or-rent chart
    for (const it of trending.services.find((x) => x.store).movie) pItems[`m${it.id}`] = { at: Date.now(), o: [['Apple TV', 'rent', 3.99 + (it.id % 3), 'HD', ''], ['Sky Store', 'rent', 4.99, 'HD', ''], ['Apple TV', 'buy', 9.99 + (it.id % 5), '4K', '']].sort((x, y) => x[2] - y[2]) };
    await write('prices.json', { generatedAt: trending.generatedAt, items: pItems, sample: true });
    const sc = sampleCatalogue();
    await write('browse.json', sc);
    await write('browse-more.json', { generatedAt: sc.generatedAt, img: '', sample: true,
      items: Object.fromEntries(sc.items.map((x) => [`${x.t[0]}${x.i}`, ['Fictional sample title. Add your TMDB key and run the workflow to see real descriptions and artwork.', '']])) });
    await buildTitlePages();
  } else if (!process.env.TMDB_TOKEN && !process.env.TMDB_API_KEY) {
    const msg = 'No TMDB_TOKEN secret found, so the site is still showing sample data. Add it under Settings > Secrets and variables > Actions.';
    console.warn(process.env.GITHUB_ACTIONS ? `::warning title=Sample data::${msg}` : msg);
  } else {
    // 1. The chart. If TMDB has a bad hour, keep the chart that's live (it says how old it is); with nothing live to
    //    fall back on, the run fails and GitHub keeps the last deployment up.
    let built = null;
    try { built = await buildTrending(); checkTrending(built.data); }
    catch (err) { warn('Chart', `TMDB failed (${err.message}), so keeping the live chart`); built = null; }
    const live = built ? null : await liveCopy('trending.json');
    if (!built && !live) throw new Error('No chart from TMDB and no live chart to fall back on');
    const data = built ? built.data : live;

    // Netflix's own UK Top 10 for the Netflix tab (the "All" chart stays TMDB's, so it ranks every service alike).
    if (built) {
      const nf = data.services.find((x) => x.key === 'netflix');
      const prevNf = (await liveCopy('trending.json'))?.services?.find((x) => x.key === 'netflix');
      // re-read twice a day; if last time only the (week-behind) file worked, try the page again sooner
      const fresh = prevNf?.official?.v === NETFLIX_V && hoursOld({ generatedAt: prevNf.official.fetchedAt }) < (prevNf.official.from === 'page' ? 12 : 3);
      let status;
      try {
        let off;
        if (fresh) { off = prevNf.official; Object.assign(nf, { tv: prevNf.tv, movie: prevNf.movie }); console.log('Reusing Netflix official Top 10 for', off.week); }
        else {
          const o = await buildNetflixOfficial();
          Object.assign(nf, { tv: o.tv, movie: o.movie }); off = { source: 'netflix', v: NETFLIX_V, week: o.week, from: o.from, fetchedAt: new Date().toISOString() };
          console.log('Netflix official UK Top 10, week ending', o.week);
        }
        nf.official = off; status = { ok: true, week: off.week, from: off.from, fetchedAt: off.fetchedAt };
      } catch (err) {
        // keep last week's official chart for up to ten days; otherwise TMDB's ranking stands in
        if (prevNf?.official && hoursOld({ generatedAt: prevNf.official.fetchedAt }) < 240) {
          Object.assign(nf, { tv: prevNf.tv, movie: prevNf.movie, official: prevNf.official });
        }
        warn('Netflix Top 10', `couldn't read Netflix's chart (${err.message})${nf.official ? ', keeping the last one' : ', using TMDB for now'}`);
        status = { ok: false, error: String(err.message).slice(0, 300), at: new Date().toISOString(), kept: !!nf.official };
      }
      await write('netflix-status.json', status);
    }
    // chart movement, only when the chart is fresh (a kept chart has nothing new to compare)
    if (built) {
      try {
        const h = addMovement(data, await liveCopy('history.json'));
        await write('history.json', h);
        const { trail, week } = buildTrackers(data, h);
        await write('trail.json', trail); await write('week.json', week);
      }
      catch (err) { warn('Movement', `couldn't work out chart movement (${err.message})`); }
    }
    await write('trending.json', data);
    if (built) await write('providers.json', built.providers);

    // 2. The Browse catalogue, rebuilt with the chart; otherwise the live one carries on.
    let catalogue = null, newList = null;
    try {
      if (!built) throw new Error('the chart was not rebuilt this hour');
      const { cat, more } = await buildCatalogue(built.ids);
      if (cat.items.length < 100) throw new Error(`only ${cat.items.length} titles came back`);
      await write('browse.json', cat);
      await write('browse-more.json', more);
      catalogue = cat;
      console.log(`Browse catalogue: ${cat.items.length} titles`);
    } catch (err) {
      const prev = await liveCopy('browse.json'), prevMore = await liveCopy('browse-more.json');
      warn('Browse', `catalogue not rebuilt (${err.message}), ${prev ? 'keeping the live one' : 'and there is no live one yet'}`);
      if (prev) await write('browse.json', prev);
      if (prevMore) await write('browse-more.json', prevMore);
      catalogue = prev;
    }

    // 3. New this week (Watchmode, once a day). If it fails, the live list carries on for up to three days.
    try {
      const fresh = await buildNew();
      await write('new.json', fresh || { generatedAt: data.generatedAt, disabled: true, items: [] });
      newList = fresh;
    } catch (err) {
      const prev = await liveCopy('new.json');
      const keep = realNew(prev) && hoursOld(prev) < 72;
      warn('New this week', `Watchmode step failed (${err.message})${keep ? ', keeping the live list' : ''}`);
      await write('new.json', keep ? prev : { generatedAt: data.generatedAt, error: true, items: [] });
      if (keep) newList = prev;
    }

    // 3a. At the cinema; the live copy carries on for up to three days if TMDB has a bad moment.
    try { await write('cinema.json', await buildCinema()); }
    catch (err) {
      const prev = await liveCopy('cinema.json');
      warn('Cinema', `not rebuilt (${err.message})${prev && hoursOld(prev) < 72 ? ', keeping the live list' : ''}`);
      if (prev && hoursOld(prev) < 72) await write('cinema.json', prev);
    }

    // 3b. Rent and buy prices for the buy-or-rent chart (Watchmode); the live copy carries on if it fails.
    if (built) {
      const prevP = await liveCopy('prices.json');
      try { const pr = await buildPrices(data, prevP); if (pr) await write('prices.json', pr); else if (prevP) await write('prices.json', prevP); }
      catch (err) { warn('Prices', err.message); if (prevP) await write('prices.json', prevP); }
    }

    // 4. Title details (where to watch, runtime, age rating, trailer) for everything Tenner shows.
    try {
      const key = (type, id) => (typeof id === 'number' || /^\d+$/.test(String(id)) ? `${type === 'movie' ? 'm' : 't'}${id}` : null);
      const chartKeys = new Set();
      for (const sv of data.services) for (const t of ['tv', 'movie']) for (const it of sv[t] || []) { const k = key(t, it.id); if (k) chartKeys.add(k); }
      for (const t of ['tv', 'movie']) for (const it of data.overall?.[t] || []) { const k = key(t, it.id); if (k) chartKeys.add(k); }
      for (const it of newList?.items || []) { const k = it.id && key(it.type, it.id); if (k) chartKeys.add(k); }
      const catalogueKeys = new Set((catalogue?.items || []).map((x) => `${x.t[0]}${x.i}`));
      const prevTitles = await liveCopy('titles.json');
      const titles = await buildTitles(chartKeys, catalogueKeys, prevTitles);
      try {   // each title's own link on each service (see buildLinks); kept from the last run if Wikidata is down
        const oldLn = Object.fromEntries(Object.entries(prevTitles?.items || {}).filter(([, x]) => x.ln).map(([k, x]) => [k, x.ln]));
        const ln = await buildLinks(Object.keys(titles.items), oldLn);
        for (const [k, x] of Object.entries(titles.items)) if (ln[k]) x.ln = ln[k];
        const msg = `${Object.values(ln).filter((x) => Object.keys(x).length > 1).length} of ${Object.keys(titles.items).length} titles have direct links`;
        console.log(process.env.GITHUB_ACTIONS ? `::notice title=Links::${msg}` : `Links: ${msg}`);
      } catch (err) { warn('Links', err.message); }
      await write('titles.json', titles);
      console.log(`Title details: ${Object.keys(titles.items).length} titles (${titles.refreshed} refreshed this run)`);
    } catch (err) {
      const prev = await liveCopy('titles.json');
      warn('Title details', `not rebuilt (${err.message})${prev ? ', keeping the live copy' : ''}`);
      if (prev) await write('titles.json', prev);
    }

    // 5. A page for each title, so a shared link shows its artwork (never a reason for the run to fail)
    try { await buildTitlePages(); } catch (err) { warn('Title pages', err.message); }
  }
}

#!/usr/bin/env node
// Builds site/data/trending.json (TMDB, every run) and site/data/new.json (Watchmode, at most once a day).
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

import { mkdir, writeFile } from 'node:fs/promises';
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
];
const RESELLER = /\b(amazon|apple tv|roku premium|roku) channel\b/;

const norm = (s) => s.toLowerCase().replace(/\+/g, ' plus').replace(/[^a-z0-9]+/g, ' ').trim();
export const serviceFor = (name) => {
  const n = norm(name);
  if (RESELLER.test(n)) return null;
  return SERVICES.find((s) => s.match.test(n)) || null;
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
  const full = d.services.filter((s) => !s.store && s.tv.length >= 5 && s.movie.length >= 5).length;
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
  for (const p of [...pm.results, ...pt.results]) {
    const s = serviceFor(p.provider_name);
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

  return {
    // the combined chart stays subscription-only; Buy or rent is its own chart
    data: { generatedAt: new Date().toISOString(), region: REGION, sample: false, services: [...services, store], overall: overall(services) },
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
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Tenner/1.0; +https://danseacroft-lang.github.io/Tenner/)', accept: 'text/tab-separated-values,text/plain,*/*' }, signal: AbortSignal.timeout(90000) });
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
    items[k] = Object.fromEntries(Object.entries({
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
  if (realNew(prev) && hoursOld(prev) < 20) {
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
  const start = day(new Date(now - 7 * 864e5));
  const end = day(new Date(+now + 7 * 864e5));
  const url = `https://api.watchmode.com/v1/releases/?start_date=${start}&end_date=${end}&limit=250`;
  const json = await getJSON(url, { 'X-API-Key': key });

  const items = (json.releases || [])
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

  return { generatedAt: new Date().toISOString(), note: 'Release dates are mostly US dates from Watchmode.', items };
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
  const today = new Date();
  const iso = (d) => new Date(+today + d * 864e5).toISOString().slice(0, 10);
  const fresh = {
    generatedAt: today.toISOString(), note: 'Sample data.',
    items: [-5, -3, -1, 0, 2, 4, 6].map((d, i) => ({
      title: names[(i * 5 + 2) % names.length], type: i % 3 ? 'tv' : 'movie', season: i % 3 ? (i % 4) + 1 : null,
      date: iso(d), service: SERVICES[(i * 3) % SERVICES.length].key, original: i % 2 === 0, poster: null, url: null,
    })),
  };
  return {
    trending: { generatedAt: today.toISOString(), region: REGION, sample: true, services: [...services, storeChart], overall: overall(services) },
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

// ---------- main ----------
async function write(name, obj) {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, name), JSON.stringify(obj, null, 1));
  console.log('wrote', join('site/data', name));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--sample')) {
    const { trending, fresh } = sample();
    await write('trending.json', trending);
    await write('new.json', fresh);
    // sample title details: a few made-up services and runtimes, so the title sheet can be tried without keys
    const sp = { 8: ['Netflix', ''], 337: ['Disney Plus', ''], 9: ['Amazon Prime Video', ''], 2: ['Apple TV', ''], 130: ['Sky Store', ''], 1899: ['HBO Max', ''] };
    const sItems = {};
    for (const sv of trending.services) for (const t of ['tv', 'movie']) for (const it of sv[t] || []) {
      const n = it.id; sItems[`${t[0]}${n}`] = { at: Date.now(), rt: t === 'movie' ? 88 + (n * 7) % 60 : 40 + (n * 3) % 25, se: t === 'tv' ? 1 + n % 4 : undefined,
        c: ['U', 'PG', '12', '15', '18'][n % 5], g: ['Drama', 'Comedy', 'Crime'].slice(0, 1 + n % 3), tl: n % 2 ? 'A fictional tagline for a sample title.' : undefined,
        f: sv.store ? [] : [[8, 337, 9, 1899][n % 4]], fr: n % 5 === 0 ? [9] : [], re: [2, 130].slice(0, 1 + n % 2), bu: [2], tr: undefined };
    }
    await write('titles.json', { v: 1, generatedAt: trending.generatedAt, logo: '', providers: sp, items: sItems, sample: true });
    const sc = sampleCatalogue();
    await write('browse.json', sc);
    await write('browse-more.json', { generatedAt: sc.generatedAt, img: '', sample: true,
      items: Object.fromEntries(sc.items.map((x) => [`${x.t[0]}${x.i}`, ['Fictional sample title. Add your TMDB key and run the workflow to see real descriptions and artwork.', '']])) });
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

    // 4. Title details (where to watch, runtime, age rating, trailer) for everything Tenner shows.
    try {
      const key = (type, id) => (typeof id === 'number' || /^\d+$/.test(String(id)) ? `${type === 'movie' ? 'm' : 't'}${id}` : null);
      const chartKeys = new Set();
      for (const sv of data.services) for (const t of ['tv', 'movie']) for (const it of sv[t] || []) { const k = key(t, it.id); if (k) chartKeys.add(k); }
      for (const t of ['tv', 'movie']) for (const it of data.overall?.[t] || []) { const k = key(t, it.id); if (k) chartKeys.add(k); }
      for (const it of newList?.items || []) { const k = it.id && key(it.type, it.id); if (k) chartKeys.add(k); }
      const catalogueKeys = new Set((catalogue?.items || []).map((x) => `${x.t[0]}${x.i}`));
      const titles = await buildTitles(chartKeys, catalogueKeys, await liveCopy('titles.json'));
      await write('titles.json', titles);
      console.log(`Title details: ${Object.keys(titles.items).length} titles (${titles.refreshed} refreshed this run)`);
    } catch (err) {
      const prev = await liveCopy('titles.json');
      warn('Title details', `not rebuilt (${err.message})${prev ? ', keeping the live copy' : ''}`);
      if (prev) await write('titles.json', prev);
    }
  }
}

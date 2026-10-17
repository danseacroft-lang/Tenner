#!/usr/bin/env node
// Builds site/data/trending.json (TMDB, every run) and site/data/new.json (Watchmode, at most once a day).
//
// Env:
//   TMDB_TOKEN          TMDB "API Read Access Token" (v4). Or TMDB_API_KEY (v3 key) instead.
//   WATCHMODE_API_KEY   optional. Used for "New this week" (about 1 credit per day).
//   SITE_URL            optional. Your live Pages URL, used to reuse yesterday's new.json and save credits.
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
async function getJSON(url, headers = {}, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json', ...headers } });
      if (res.ok) return res.json();
      if (res.status < 500 && res.status !== 429) {
        throw Object.assign(new Error(`${res.status} ${res.statusText} for ${redact(url)}`), { fatal: true });
      }
      throw new Error(`${res.status} for ${redact(url)}`);
    } catch (err) {
      if (err.fatal || i >= tries) throw err;
      await sleep(800 * i);
    }
  }
}
const redact = (u) => String(u).replace(/(api_key|apiKey)=[^&]+/g, '$1=***');

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
  //    Films: a UK digital release in the last 120 days. Shows: an episode in the last 90 days, sold by the episode or season.
  const ago = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
  const shop = { watch_region: REGION, with_watch_monetization_types: 'rent|buy', sort_by: 'popularity.desc', include_adult: 'false', language: 'en-GB' };
  const [sm, st] = await Promise.all([
    tmdb('/discover/movie', { ...shop, region: REGION, with_release_type: '4', 'release_date.gte': ago(120), 'release_date.lte': ago(-1) }),
    tmdb('/discover/tv', { ...shop, 'air_date.gte': ago(90), 'vote_count.gte': '5' }),
  ]);
  const store = {
    key: 'store', label: 'Buy or rent', store: true, logo: null, providerIds: [],
    movie: sm.results.slice(0, PER_LIST).map((r) => toItem(r, 'movie')),
    tv: st.results.slice(0, PER_LIST).map((r) => toItem(r, 'tv')),
  };

  return {
    // the combined chart stays subscription-only; Buy or rent is its own chart
    data: { generatedAt: new Date().toISOString(), region: REGION, sample: false, services: [...services, store], overall: overall(services) },
    providers: Object.fromEntries(SERVICES.map((s) => [s.label, [...ids[s.key]].map((id) => `${id} ${seen[id]}`)])),
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

// ---------- Watchmode (daily) ----------
export async function buildNew() {
  const key = process.env.WATCHMODE_API_KEY;
  if (!key) {
    const msg = 'No WATCHMODE_API_KEY secret, so "New this week" is switched off. Add it under Settings > Secrets and variables > Actions.';
    console.warn(process.env.GITHUB_ACTIONS ? `::notice title=New this week is off::${msg}` : msg);
    return null;
  }

  // Reuse the copy already live on the site if it's less than 20 hours old.
  if (process.env.SITE_URL) {
    try {
      const prev = await getJSON(new URL('data/new.json', process.env.SITE_URL.replace(/\/?$/, '/')), {}, 1);
      const real = prev && Array.isArray(prev.items) && !prev.disabled && !prev.error && !prev.sample;
      if (real && Date.now() - Date.parse(prev.generatedAt) < 20 * 3600e3) {
        console.log('Reusing live new.json from', prev.generatedAt);
        return prev;
      }
    } catch { /* first deploy, or site not reachable */ }
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
      url: r.tmdb_id ? `https://www.themoviedb.org/${r.tmdb_type}/${r.tmdb_id}/watch?locale=${REGION}` : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { generatedAt: new Date().toISOString(), note: 'Release dates are mostly US dates from Watchmode.', items };
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
    tv: Array.from({ length: PER_LIST }, (_, i) => make('tv', i, 7)), movie: Array.from({ length: PER_LIST }, (_, i) => make('movie', i, 7)) };
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
  } else if (!process.env.TMDB_TOKEN && !process.env.TMDB_API_KEY) {
    const msg = 'No TMDB_TOKEN secret found, so the site is still showing sample data. Add it under Settings > Secrets and variables > Actions.';
    console.warn(process.env.GITHUB_ACTIONS ? `::warning title=Sample data::${msg}` : msg);
  } else {
    const { data, providers } = await buildTrending();
    await write('trending.json', data);
    await write('providers.json', providers);
    try {
      const fresh = await buildNew();
      await write('new.json', fresh || { generatedAt: data.generatedAt, disabled: true, items: [] });
    } catch (err) {
      const msg = `Watchmode step failed: ${err.message}`;
      console.warn(process.env.GITHUB_ACTIONS ? `::warning title=New this week::${msg}` : msg);
      await write('new.json', { generatedAt: data.generatedAt, error: true, items: [] });
    }
  }
}

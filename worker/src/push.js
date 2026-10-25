// Watchlist alerts: a notification when something on your Watchlist arrives on a service, or gets a new season; and each
// morning, when a show on it has a new episode out that day, a title on it is about to leave its service, is on Freeview
// later that day, or has got cheaper to rent or buy.
// No accounts: each phone or computer that turns alerts on hands over its push address (from the browser) and the
// titles on its Watchlist, kept in Workers KV (PUSH) under a hash of that address. Every hour the Worker reads the
// site's New list; when it has changed, each subscriber with a match gets one notification, sent with the Web Push
// standard (VAPID-signed, end-to-end encrypted, RFC 8291). The signing key is a Worker secret (VAPID_JWK) made by the
// deploy workflow; the public half is worked out from it and handed to the site at /push/key.
//   GET  /push/key          { key }: the public key the browser subscribes with
//   POST /push/subscribe    { sub, watch: ['t123', 'm456', …] }: turn alerts on, or update the Watchlist
//   POST /push/unsubscribe  { endpoint }
// The hourly run works through subscribers in batches of ten; with a SELF service binding (optional) each batch runs
// as its own request (POST /push/send), so a long list never makes one run too long.

import { linkAlerts } from './auth.js';

const SITE = 'https://tenner.stream';
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { out.set(x, i); i += x.length; } return out; };
const sha = async (s) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s)));
// the browsers' own push services only: nothing else can be handed to us as an address
const PUSH_HOSTS = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com|push\.services\.mozilla\.com)$/;

const vapid = (env) => { try { const j = JSON.parse(env.VAPID_JWK || ''); return j.d && j.x && j.y ? j : null; } catch { return null; } };
const publicKey = (j) => b64u(cat(new Uint8Array([4]), unb64u(j.x), unb64u(j.y)));
const ready = (env) => !!(env.PUSH && vapid(env));

export async function pushRoute(req, env, ctx, url, json, cors) {
  if (!ready(env)) return json({ error: 'Alerts aren’t set up yet' }, 503, cors);
  const j = vapid(env);
  if (url.pathname === '/push/key') return json({ key: publicKey(j) }, 200, { ...cors, 'cache-control': 'public, max-age=3600' });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
  let body; try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400, cors); }
  if (url.pathname === '/push/unsubscribe') {
    if (typeof body?.endpoint === 'string') await env.PUSH.delete(`sub:${await sha(body.endpoint)}`);
    return json({ ok: true }, 200, cors);
  }
  if (url.pathname === '/push/subscribe') {
    const sub = body?.sub, ep = sub?.endpoint;
    let host = ''; try { host = new URL(ep).hostname; } catch {}
    if (!/^https:\/\//.test(ep || '') || !PUSH_HOSTS.test(host) || !sub.keys?.p256dh || !sub.keys?.auth) return json({ error: 'Not a push address' }, 400, cors);
    let watch = [...new Set((Array.isArray(body.watch) ? body.watch : []).filter((k) => /^[mt]\d{1,9}$/.test(k)))].slice(0, 500);
    const id = `sub:${await sha(ep)}`, old = await env.PUSH.get(id, 'json');
    const acct = await linkAlerts(req, env, id).catch(() => null);   // signed in: this device's alerts follow the account's Watchlist
    if (acct) watch = acct;
    await env.PUSH.put(id, JSON.stringify({ sub: { endpoint: ep, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, watch, seen: old?.seen || [], at: Date.now() }));
    if (!old) ctx.waitUntil(send(sub, { title: 'Alerts are on', body: 'Tenner will tell you when something on your Watchlist arrives, has a new episode or is about to leave.', url: '/#watchlist', tag: 'tenner-hello' }, env).catch(() => {}));
    return json({ ok: true, watching: watch.length }, 200, cors);
  }
  return json({ error: 'Not found' }, 404, cors);
}

// ---------- the hourly run ----------
export async function pushRun(env, force = false) {
  if (!ready(env)) return;
  const r = await fetch(`${SITE}/data/new.json?v=${Date.now()}`, { cf: { cacheTtl: 0 } });
  if (!r.ok) return;
  const fresh = await r.json();
  if (!force && fresh.generatedAt && (await env.PUSH.get('meta:new')) === fresh.generatedAt) return;   // nothing new since last time
  await env.PUSH.put('meta:new', fresh.generatedAt || String(Date.now()));
  let cursor; const ids = [];
  do { const page = await env.PUSH.list({ prefix: 'sub:', cursor }); ids.push(...page.keys.map((k) => k.name)); cursor = page.list_complete ? null : page.cursor; } while (cursor);
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    if (env.SELF) await env.SELF.fetch('https://self/push/send', { method: 'POST', headers: { 'x-tenner-run': await sha(env.VAPID_JWK) }, body: JSON.stringify({ ids: batch, generatedAt: fresh.generatedAt }) });
    else await sendBatch(env, batch, fresh);
  }
}
// one batch: each subscriber's matches, as one notification each
export async function pushSend(req, env) {
  if (req.headers.get('x-tenner-run') !== await sha(env.VAPID_JWK || '')) return new Response('No', { status: 403 });
  const { ids, kind } = await req.json();
  const r = await fetch(`${SITE}/data/new.json`); if (!r.ok) return new Response('No list', { status: 502 });
  await (kind === 'morning' ? morningBatch : sendBatch)(env, ids, await r.json());
  return new Response('OK');
}

// ---------- the morning run (once a day, from 9am UK time) ----------
// New episodes out today of the shows on each Watchlist (TMDB's next episode, looked up once a day per show and shared by
// everyone through the edge cache), and Watchlist titles leaving their service in the next three days (the site's
// Leaving soon list). Each is told once, remembered in the subscriber's seen list like the arrivals.
export const ukNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour };
};
export async function pushMorning(env, force = false) {
  if (!ready(env) || !env.TMDB_TOKEN) return;
  const { day, hour } = ukNow();
  if (!force && (hour < 9 || (await env.PUSH.get('meta:morning')) === day)) return;
  await env.PUSH.put('meta:morning', day);
  const r = await fetch(`${SITE}/data/new.json?v=${Date.now()}`, { cf: { cacheTtl: 0 } });
  const fresh = r.ok ? await r.json() : {};
  await priceDrops(env, day).catch(() => {});
  let cursor; const ids = [];
  do { const page = await env.PUSH.list({ prefix: 'sub:', cursor }); ids.push(...page.keys.map((k) => k.name)); cursor = page.list_complete ? null : page.cursor; } while (cursor);
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    if (env.SELF) await env.SELF.fetch('https://self/push/send', { method: 'POST', headers: { 'x-tenner-run': await sha(env.VAPID_JWK) }, body: JSON.stringify({ ids: batch, kind: 'morning' }) });
    else await morningBatch(env, batch, fresh);
  }
}
// Cheaper to rent or buy: the site's prices (data/prices.json, the buy-or-rent chart's films and shows) against the
// day before's. A drop of a tenth or more is kept for the day's batches (meta:drops); today's prices are remembered.
async function priceDrops(env, day) {
  const r = await fetch(`${SITE}/data/prices.json?v=${Date.now()}`, { cf: { cacheTtl: 0 } });
  if (!r.ok) return;
  const items = (await r.json())?.items || {}, was = (await env.PUSH.get('meta:prices', 'json')) || {}, now = {}, drops = [];
  for (const [k, x] of Object.entries(items)) {
    for (const [i, kind] of ['rent', 'buy'].entries()) {
      const best = (x.o || []).filter((o) => o[1] === kind && o[2] > 0).sort((a, b) => a[2] - b[2])[0];
      if (!best) continue;
      (now[k] ||= [0, 0])[i] = best[2];
      const before = was[k]?.[i];
      if (before && best[2] <= before * 0.9) drops.push({ k, kind, price: best[2], was: before, on: best[0] });
    }
  }
  await env.PUSH.put('meta:prices', JSON.stringify(now));
  await env.PUSH.put('meta:drops', JSON.stringify({ day, drops }));
}
// a film's name (for matching it in the TV listings), looked up once a week and shared through the edge cache
async function filmName(env, id) {
  const key = new Request(`https://tenner-cache/film/${id}`), hit = await caches.default.match(key);
  if (hit) return hit.text();
  const r = await fetch(`https://api.themoviedb.org/3/movie/${id}?language=en-GB`, { headers: { authorization: `Bearer ${env.TMDB_TOKEN}`, accept: 'application/json' } });
  if (!r.ok) return '';
  const t = (await r.json()).title || '';
  await caches.default.put(key, new Response(t, { headers: { 'cache-control': 'public, max-age=604800' } }));
  return t;
}
// names folded the way Tenner TV's On TV this week list folds them (scripts/fetch-tv.mjs)
const fold = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
const ukTime = (t) => {
  const [h, m] = new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
};
export async function nextEpisode(env, id) {
  const key = new Request(`https://tenner-cache/next/${id}`), hit = await caches.default.match(key);
  if (hit) return hit.json();
  const r = await fetch(`https://api.themoviedb.org/3/tv/${id}?language=en-GB`, { headers: { authorization: `Bearer ${env.TMDB_TOKEN}`, accept: 'application/json' } });
  if (!r.ok) return null;
  const d = await r.json(), n = d.next_episode_to_air;
  const out = { title: d.name || '', nx: n?.air_date ? [n.air_date, n.season_number, n.episode_number] : null };
  await caches.default.put(key, new Response(JSON.stringify(out), { headers: { 'cache-control': 'public, max-age=43200' } }));
  return out;
}
const ukDayOf = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const dayName = (iso, today) => {
  const gap = Math.round((Date.parse(iso) - Date.parse(today)) / 864e5);
  return gap <= 0 ? 'today' : gap === 1 ? 'tomorrow' : `on ${new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}`;
};
async function morningBatch(env, ids, fresh) {
  const { day } = ukNow(), last = new Date(Date.parse(day) + 3 * 864e5).toISOString().slice(0, 10);
  const label = { netflix: 'Netflix', disney: 'Disney+', prime: 'Prime Video', hbomax: 'HBO Max', paramount: 'Paramount+', appletv: 'Apple TV' };
  const leaving = (fresh.leaving || []).filter((x) => x.id && x.date >= day && x.date <= last);
  // On Freeview today (Tenner TV's list, rebuilt every three hours), and what's got cheaper (pushMorning)
  const air = await fetch('https://tenner-tv.danseacroft.workers.dev/api/onair', { cf: { cacheTtl: 900 } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const drops = await env.PUSH.get('meta:drops', 'json').then((d) => (d?.day === day ? d.drops : [])).catch(() => []);
  const money = (n) => `£${n.toFixed(2)}`;
  for (const id of ids) {
    const s = await env.PUSH.get(id, 'json'); if (!s) continue;
    const want = new Set(s.watch), seen = new Set(s.seen || []), hits = [];
    for (const x of leaving) {
      const k = `${x.type === 'movie' ? 'm' : 't'}${x.id}`, tag = `l${k}:${x.date}`;
      if (want.has(k) && !seen.has(tag)) hits.push({ tag, k, short: `${x.title} (leaving ${dayName(x.date, day)})`,
        title: `${x.title} leaves ${label[x.service] || 'its service'} ${dayName(x.date, day)}`, body: 'From your Watchlist. There’s still time to watch it.' });
    }
    const names = {};
    for (const k of [...want].filter((k) => k[0] === 't').slice(0, 60)) {
      const e = await nextEpisode(env, k.slice(1)).catch(() => null);
      if (e?.title) names[k] = e.title;
      if (!e?.nx || e.nx[0] !== day) continue;
      const tag = `e${k}:${e.nx[1]}:${e.nx[2]}`;
      if (!seen.has(tag)) hits.push({ tag, k, ep: 1, short: `${e.title} S${e.nx[1]} E${e.nx[2]}`,
        title: `New episode of ${e.title} today`, body: `Season ${e.nx[1]}, episode ${e.nx[2]} is out today.` });
    }
    if (air?.titles) {
      for (const k of [...want].filter((k) => k[0] === 'm').slice(0, 60)) names[k] = await filmName(env, k.slice(1)).catch(() => '');
      const later = Date.now();
      for (const [k, name] of Object.entries(names)) {
        const x = (air.titles[fold(name)] || []).find((s) => s[2] === (k[0] === 'm' ? 1 : 0) && s[1] > later && ukDayOf(s[1]) === day);
        const tag = `v${k}:${day}`;
        if (x && !seen.has(tag)) hits.push({ tag, k, short: `${name} (${x[0]}, ${ukTime(x[1])})`,
          title: `${name} is on ${x[0]} at ${ukTime(x[1])}`, body: 'From your Watchlist, on Freeview today.' });
      }
    }
    for (const x of drops) {
      const tag = `p${x.k}:${x.kind}:${x.price}`;
      if (!want.has(x.k) || seen.has(tag)) continue;
      const name = names[x.k] || (x.k[0] === 'm' ? await filmName(env, x.k.slice(1)).catch(() => '') : '');
      if (name) hits.push({ tag, k: x.k, short: `${name} (${money(x.price)} to ${x.kind})`,
        title: `${name} is cheaper to ${x.kind}`, body: `${money(x.price)} on ${x.on}, down from ${money(x.was)}.` });
    }
    if (!hits.length) continue;
    const msg = hits.length === 1 ? { title: hits[0].title, body: hits[0].body, url: `/?t=${hits[0].k}` }
      : { title: `${hits.length} things from your Watchlist today`, body: hits.slice(0, 4).map((h) => h.short).join(', '), url: '/#watchlist' };
    const res = await send(s.sub, { ...msg, tag: 'tenner-morning', badge: hits.filter((h) => h.ep).length }, env).catch(() => null);
    if (res && (res.status === 404 || res.status === 410)) { await env.PUSH.delete(id); continue; }
    if (res?.ok) { for (const h of hits) seen.add(h.tag); await env.PUSH.put(id, JSON.stringify({ ...s, seen: [...seen].slice(-300) })); }
  }
}
async function sendBatch(env, ids, fresh) {
  const today = new Date().toISOString().slice(0, 10), since = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  const label = { netflix: 'Netflix', disney: 'Disney+', prime: 'Prime Video', hbomax: 'HBO Max', paramount: 'Paramount+', appletv: 'Apple TV' };
  const arrived = (fresh.items || []).filter((x) => x.id && x.date <= today && x.date >= since);
  for (const id of ids) {
    const s = await env.PUSH.get(id, 'json'); if (!s) continue;
    const want = new Set(s.watch), seen = new Set(s.seen || []);
    const hits = arrived.filter((x) => want.has(`${x.type === 'movie' ? 'm' : 't'}${x.id}`) && !seen.has(`${x.type[0]}${x.id}:${x.season || 0}`));
    if (!hits.length) continue;
    const what = (x) => `${x.title}${x.season ? ` season ${x.season}` : ''}`;
    const msg = hits.length === 1
      ? { title: `${what(hits[0])} is on ${label[hits[0].service] || 'streaming'}`, body: hits[0].season > 1 ? 'A new season from your Watchlist has landed.' : 'From your Watchlist, ready to watch now.', url: `/?t=${hits[0].type === 'movie' ? 'm' : 't'}${hits[0].id}` }
      : { title: `${hits.length} from your Watchlist are on now`, body: hits.slice(0, 4).map((x) => `${what(x)} (${label[x.service] || 'streaming'})`).join(', '), url: '/#watchlist' };
    const res = await send(s.sub, { ...msg, tag: 'tenner-watchlist' }, env).catch(() => null);
    if (res && (res.status === 404 || res.status === 410)) { await env.PUSH.delete(id); continue; }   // that browser turned alerts off
    if (res?.ok) { for (const x of hits) seen.add(`${x.type[0]}${x.id}:${x.season || 0}`); await env.PUSH.put(id, JSON.stringify({ ...s, seen: [...seen].slice(-300) })); }
  }
}

// ---------- Web Push: sign (VAPID, RFC 8292) and encrypt (aes128gcm, RFC 8291) ----------
async function send(sub, payload, env) {
  const j = vapid(env), aud = new URL(sub.endpoint).origin;
  const jwt = await sign({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:support@tenner.stream' }, j);
  const body = await encrypt(sub.keys, enc.encode(JSON.stringify(payload)));
  return fetch(sub.endpoint, { method: 'POST', body, headers: {
    TTL: '172800', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    Authorization: `vapid t=${jwt}, k=${publicKey(j)}`, Topic: (payload.tag || 'tenner').slice(0, 32) } });
}
async function sign(claims, j) {
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: j.d, x: j.x, y: j.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const data = `${b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))}.${b64u(enc.encode(JSON.stringify(claims)))}`;
  return `${data}.${b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(data)))}`;
}
const hmac = async (key, data) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data));
export async function encrypt(keys, plain) {
  const ua = unb64u(keys.p256dh), auth = unb64u(keys.auth);
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const as = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hmac(await hmac(auth, shared), cat(enc.encode('WebPush: info\0'), ua, as, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(plain, new Uint8Array([2]))));
  const head = new Uint8Array(21); head.set(salt); new DataView(head.buffer).setUint32(16, 4096); head[20] = 65;
  return cat(head, as, ct);
}

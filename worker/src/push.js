// Watchlist alerts: a notification when something on your Watchlist arrives on a service, or gets a new season.
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
    if (!old) ctx.waitUntil(send(sub, { title: 'Alerts are on', body: 'Tenner will tell you when something on your Watchlist arrives or gets a new season.', url: '/#watchlist', tag: 'tenner-hello' }, env).catch(() => {}));
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
  const { ids } = await req.json();
  const r = await fetch(`${SITE}/data/new.json`); if (!r.ok) return new Response('No list', { status: 502 });
  await sendBatch(env, ids, await r.json());
  return new Response('OK');
}
async function sendBatch(env, ids, fresh) {
  const today = new Date().toISOString().slice(0, 10), since = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  const label = { netflix: 'Netflix', disney: 'Disney+', prime: 'Prime Video', hbomax: 'HBO Max', paramount: 'Paramount+' };
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

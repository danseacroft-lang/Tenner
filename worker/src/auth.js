// Tenner accounts: optional. Sign in with a passkey (Face ID, Touch ID or a security key; WebAuthn, verified here) or
// with Google (an ID token from Google's own button, checked against Google's public keys). Then everything you keep
// on a device (Watchlist, progress, services, settings) is merged with what's in your account and kept in step on
// every device you sign in on. Stored in Cloudflare D1 (DB); see ../schema.sql.
//   POST /auth/passkey/start      { name? } (new account) or with a session (add a passkey) → options for the browser
//   POST /auth/passkey/finish     { id, credential } → { token, user }
//   POST /auth/login/start        → options for the browser (any passkey for this site)
//   POST /auth/login/finish       { id, credential } → { token, user }
//   POST /auth/google             { credential } → { token, user } (links Google if you're signed in already)
//   POST /auth/logout
//   GET  /me                      → { user, data, passkeys, sessions }
//   PATCH /me                     { name?, hue? }
//   PUT  /me/data                 { data } → { data } (merged with what's stored, and the result for this device)
//   POST /me/share                { on } → { share_id }
//   DELETE /me/passkeys/:id, DELETE /me/google, DELETE /me (the account and everything in it)
//   GET  /share/:id               a shared Watchlist: { name, picture, hue, list }
// A session is a random token kept on the device (no cookies); only a hash of it is stored here.

const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const rand = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (data) => new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
const hashToken = async (t) => b64u(await sha(`tenner:${t}`));
const now = () => Date.now();
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// the site's own name for passkeys: tenner.stream (also for www.), or whichever allowed address it's opened on
function rpFor(origin) {
  const host = new URL(origin).hostname;
  return host === 'www.tenner.stream' ? 'tenner.stream' : host;
}

// ---------- a small CBOR reader (enough for WebAuthn) ----------
function cbor(buf, at = 0) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const read = () => {
    const ib = buf[at++], mt = ib >> 5, ai = ib & 31;
    let len = ai;
    if (ai === 24) len = buf[at++]; else if (ai === 25) { len = dv.getUint16(at); at += 2; } else if (ai === 26) { len = dv.getUint32(at); at += 4; } else if (ai === 27) { len = Number(dv.getBigUint64(at)); at += 8; }
    if (mt === 0) return len;
    if (mt === 1) return -1 - len;
    if (mt === 2) { const v = buf.slice(at, at + len); at += len; return v; }
    if (mt === 3) { const v = dec.decode(buf.slice(at, at + len)); at += len; return v; }
    if (mt === 4) { const a = []; for (let i = 0; i < len; i++) a.push(read()); return a; }
    if (mt === 5) { const m = new Map(); for (let i = 0; i < len; i++) { const k = read(); m.set(k, read()); } return m; }
    if (mt === 7) return ai === 20 ? false : ai === 21 ? true : null;
    throw new Error('CBOR');
  };
  const value = read();
  return { value, end: at };
}
function parseAuthData(ad) {
  const flags = ad[32], counter = new DataView(ad.buffer, ad.byteOffset + 33, 4).getUint32(0);
  const out = { rpIdHash: ad.slice(0, 32), up: !!(flags & 1), uv: !!(flags & 4), counter };
  if (flags & 64) {
    const len = (ad[53] << 8) | ad[54];
    out.credId = ad.slice(55, 55 + len);
    out.cose = cbor(ad, 55 + len).value;
  }
  return out;
}
// a COSE public key → a JWK WebCrypto can use (ES256 on Apple devices and most keys; RS256 on some Windows ones)
function coseToJwk(m) {
  const alg = m.get(3);
  if (m.get(1) === 2 && alg === -7 && m.get(-1) === 1) return { alg, jwk: { kty: 'EC', crv: 'P-256', x: b64u(m.get(-2)), y: b64u(m.get(-3)) } };
  if (m.get(1) === 3 && alg === -257) return { alg, jwk: { kty: 'RSA', n: b64u(m.get(-1)), e: b64u(m.get(-2)), alg: 'RS256' } };
  throw new Error('That kind of passkey isn’t supported');
}
// WebAuthn's ECDSA signatures are DER; WebCrypto wants the two numbers side by side
function derToRaw(der) {
  let i = 2; const part = () => { i++; let len = der[i++]; let v = der.slice(i, i + len); i += len; while (v.length > 32 && v[0] === 0) v = v.slice(1); const out = new Uint8Array(32); out.set(v, 32 - v.length); return out; };
  const r = part(), s = part(); const out = new Uint8Array(64); out.set(r); out.set(s, 32); return out;
}
async function verifySig(alg, jwk, data, sig) {
  if (alg === -7) {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(sig), data);
  }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
}
async function checkClient(cdjB64, type, challenge, origin) {
  const cd = JSON.parse(dec.decode(unb64u(cdjB64)));
  if (cd.type !== type) throw new Error('Wrong kind of answer');
  if (cd.challenge !== challenge) throw new Error('That took too long. Try again');
  if (cd.origin !== origin) throw new Error('Wrong site');
  return sha(unb64u(cdjB64));
}

// ---------- sessions ----------
async function sessionUser(req, env) {
  const t = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!t || t.length < 20) return null;
  const h = await hashToken(t);
  const row = await env.DB.prepare('SELECT s.user_id, s.seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').bind(h).first();
  if (!row) return null;
  if (now() - row.seen > 864e5) await env.DB.prepare('UPDATE sessions SET seen = ? WHERE token = ?').bind(now(), h).run();
  return { ...row, token: h };
}
async function newSession(env, userId, req) {
  const t = rand(32), ua = req.headers.get('user-agent') || '';
  const label = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Browser';
  await env.DB.prepare('INSERT INTO sessions (token, user_id, label, created, seen) VALUES (?, ?, ?, ?, ?)').bind(await hashToken(t), userId, label, now(), now()).run();
  return t;
}
const publicUser = (u) => ({ name: u.name, picture: u.picture || null, hue: u.hue, google: !!u.google_sub, email: u.email || null, share_id: u.share_id || null, created: u.created });

// ---------- merging what a device has with what the account has ----------
// watchlist: [{ k, type, title, year, poster, at }], removed: { k: when }, progress: { k: [s, e] | null }, pat: { k: when },
// services: [..] with sat (when), settings: {..} with pfat (when). The newest change wins, item by item.
export function merge(a = {}, b = {}) {
  const removed = { ...(a.removed || {}) };
  for (const [k, t] of Object.entries(b.removed || {})) if (!(removed[k] >= t)) removed[k] = t;
  const byK = new Map();
  for (const x of [...(a.watchlist || []), ...(b.watchlist || [])]) if (x?.k && (!byK.has(x.k) || (x.at || 0) > (byK.get(x.k).at || 0))) byK.set(x.k, x);
  const watchlist = [...byK.values()].filter((x) => !(removed[x.k] >= (x.at || 0))).sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, 500);
  const cut = now() - 120 * 864e5; for (const k of Object.keys(removed)) if (removed[k] < cut) delete removed[k];
  const progress = {}, pat = {};
  for (const k of new Set([...Object.keys(a.progress || {}), ...Object.keys(b.progress || {}), ...Object.keys(a.pat || {}), ...Object.keys(b.pat || {})])) {
    const ta = a.pat?.[k] || 0, tb = b.pat?.[k] || 0, pick = tb > ta ? b : ta > tb ? a : null;
    let v = pick ? pick.progress?.[k] ?? null : (() => { const x = a.progress?.[k], y = b.progress?.[k]; if (!x) return y || null; if (!y) return x; return (y[0] > x[0] || (y[0] === x[0] && y[1] > x[1])) ? y : x; })();
    if (Array.isArray(v) && v.length === 2) progress[k] = v.map((n) => Math.max(0, Math.min(999, n | 0)));
    pat[k] = Math.max(ta, tb);
  }
  const newer = (f, t) => ((b[t] || 0) > (a[t] || 0) ? b[f] : a[f] ?? b[f]);
  return { v: 1, watchlist, removed, progress, pat, services: newer('services', 'sat') || [], sat: Math.max(a.sat || 0, b.sat || 0), settings: newer('settings', 'pfat') || {}, pfat: Math.max(a.pfat || 0, b.pfat || 0) };
}
// keep what a device sends to the shape and size we expect
function clean(d) {
  const str = (s, n) => (typeof s === 'string' ? s.slice(0, n) : null);
  return {
    watchlist: (Array.isArray(d?.watchlist) ? d.watchlist : []).filter((x) => /^[mt]\d{1,9}$/.test(x?.k)).slice(0, 600)
      .map((x) => ({ k: x.k, type: x.type === 'movie' ? 'movie' : 'tv', title: str(x.title, 200) || '', year: str(String(x.year ?? ''), 4) || null, poster: /^https:\/\/image\.tmdb\.org\//.test(x.poster || '') ? x.poster.slice(0, 200) : null, at: +x.at || 0 })),
    removed: Object.fromEntries(Object.entries(d?.removed || {}).filter(([k, t]) => /^[mt]\d{1,9}$/.test(k) && +t).slice(0, 1000).map(([k, t]) => [k, +t])),
    progress: Object.fromEntries(Object.entries(d?.progress || {}).filter(([k]) => /^t\d{1,9}$/.test(k)).slice(0, 600).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 2).map((n) => n | 0) : null])),
    pat: Object.fromEntries(Object.entries(d?.pat || {}).filter(([k, t]) => /^t\d{1,9}$/.test(k) && +t).slice(0, 600).map(([k, t]) => [k, +t])),
    services: (Array.isArray(d?.services) ? d.services : []).filter((k) => /^[a-z+]{2,20}$/.test(k)).slice(0, 10), sat: +d?.sat || 0,
    settings: Object.fromEntries(Object.entries(d?.settings && typeof d.settings === 'object' ? d.settings : {}).filter(([k, v]) => /^[a-z0-9]{1,20}$/i.test(k) && ['string', 'boolean', 'number'].includes(typeof v)).slice(0, 30)), pfat: +d?.pfat || 0,
  };
}

// ---------- Google: check the ID token Google's button gave the page ----------
async function googleKeys() {
  const cache = caches.default, key = new Request('https://tenner-cache/google-jwks');
  let r = await cache.match(key);
  if (!r) { r = await fetch('https://www.googleapis.com/oauth2/v3/certs'); r = new Response(await r.text(), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } }); await cache.put(key, r.clone()); }
  return (await r.json()).keys || [];
}
async function verifyGoogle(token, env) {
  const [h, p, s] = String(token).split('.');
  if (!s) throw new Error('Not a Google sign-in');
  const head = JSON.parse(dec.decode(unb64u(h))), claims = JSON.parse(dec.decode(unb64u(p)));
  const jwk = (await googleKeys()).find((k) => k.kid === head.kid);
  if (!jwk || head.alg !== 'RS256') throw new Error('Google sign-in couldn’t be checked');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(s), enc.encode(`${h}.${p}`))) throw new Error('Google sign-in couldn’t be checked');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.aud !== env.GOOGLE_CLIENT_ID) throw new Error('Google sign-in couldn’t be checked');
  if (claims.exp * 1000 < now()) throw new Error('Google sign-in has expired. Try again');
  return claims;
}

// ---------- the routes ----------
export async function authRoute(req, env, ctx, url, json, cors, origin) {
  if (!env.DB) return json({ error: 'Accounts aren’t set up yet' }, 503, cors);
  const p = url.pathname, m = req.method;
  const body = ['POST', 'PUT', 'PATCH'].includes(m) ? await req.json().catch(() => ({})) : {};
  const ok = (o, status = 200) => json(o, status, cors);
  const fail = (msg, status = 400) => json({ error: msg }, status, cors);
  const rpId = rpFor(origin), rpHash = await sha(rpId);
  try {
    // a shared Watchlist: anyone with the link
    let mm = p.match(/^\/share\/([\w-]{8,24})$/);
    if (mm && m === 'GET') {
      const u = await env.DB.prepare('SELECT u.name, u.picture, u.hue, d.data FROM users u LEFT JOIN userdata d ON d.user_id = u.id WHERE u.share_id = ?').bind(mm[1]).first();
      if (!u) return fail('This list isn’t shared any more', 404);
      const d = JSON.parse(u.data || '{}');
      return ok({ name: u.name, picture: u.picture, hue: u.hue, list: (d.watchlist || []).map(({ k, type, title, year, poster }) => ({ k, type, title, year, poster })) });
    }

    // ---- passkeys: a new account, or another passkey for yours
    if (p === '/auth/passkey/start' && m === 'POST') {
      const me = await sessionUser(req, env);
      const userId = me?.id || rand(16), id = rand(16), challenge = rand(32);
      const name = me ? me.name : String(body.name || '').trim().slice(0, 40);
      if (!me && !name) return fail('Add your name first');
      await env.DB.prepare('INSERT INTO challenges (id, challenge, user_id, name, expires) VALUES (?, ?, ?, ?, ?)').bind(id, challenge, userId, name, now() + 5 * 60e3).run();
      const existing = me ? (await env.DB.prepare('SELECT id FROM passkeys WHERE user_id = ?').bind(me.id).all()).results.map((r) => ({ type: 'public-key', id: r.id })) : [];
      return ok({ id, options: { challenge, rp: { id: rpId, name: 'Tenner' }, user: { id: b64u(enc.encode(userId)), name: name || 'Tenner', displayName: name || 'Tenner' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 120000, attestation: 'none', excludeCredentials: existing,
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' } } });
    }
    if (p === '/auth/passkey/finish' && m === 'POST') {
      const ch = await takeChallenge(env, body.id); const c = body.credential?.response; if (!c) return fail('Something went wrong');
      await checkClient(c.clientDataJSON, 'webauthn.create', ch.challenge, origin);
      const att = cbor(unb64u(c.attestationObject)).value, ad = parseAuthData(att.get('authData'));
      if (!same([...ad.rpIdHash], [...rpHash]) || !ad.up || !ad.credId) throw new Error('That passkey isn’t for Tenner');
      const { alg, jwk } = coseToJwk(ad.cose), credId = b64u(ad.credId);
      const me = await sessionUser(req, env);
      if (me && me.id !== ch.user_id) throw new Error('Something went wrong');
      if (!me) await env.DB.prepare('INSERT INTO users (id, name, hue, created) VALUES (?, ?, ?, ?)').bind(ch.user_id, ch.name, Math.floor(Math.random() * 360), now()).run();
      const ua = req.headers.get('user-agent') || '', label = /iPhone|iPad|Mac/.test(ua) ? 'iCloud Keychain' : /Android/.test(ua) ? 'Google Password Manager' : /Windows/.test(ua) ? 'Windows Hello' : 'Passkey';
      await env.DB.prepare('INSERT INTO passkeys (id, user_id, jwk, alg, counter, label, created) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(credId, ch.user_id, JSON.stringify(jwk), alg, ad.counter, label, now()).run();
      if (me) return ok({ ok: true });
      const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(ch.user_id).first();
      return ok({ token: await newSession(env, ch.user_id, req), user: publicUser(u) });
    }
    if (p === '/auth/login/start' && m === 'POST') {
      const id = rand(16), challenge = rand(32);
      await env.DB.prepare('INSERT INTO challenges (id, challenge, expires) VALUES (?, ?, ?)').bind(id, challenge, now() + 5 * 60e3).run();
      return ok({ id, options: { challenge, rpId, timeout: 120000, userVerification: 'preferred', allowCredentials: [] } });
    }
    if (p === '/auth/login/finish' && m === 'POST') {
      const ch = await takeChallenge(env, body.id), cred = body.credential, c = cred?.response; if (!c) return fail('Something went wrong');
      const pk = await env.DB.prepare('SELECT * FROM passkeys WHERE id = ?').bind(cred.id).first();
      if (!pk) return fail('That passkey isn’t linked to a Tenner account any more', 404);
      const cdHash = await checkClient(c.clientDataJSON, 'webauthn.get', ch.challenge, origin);
      const adBytes = unb64u(c.authenticatorData), ad = parseAuthData(adBytes);
      if (!same([...ad.rpIdHash], [...rpHash]) || !ad.up) throw new Error('That passkey isn’t for Tenner');
      const data = new Uint8Array(adBytes.length + 32); data.set(adBytes); data.set(cdHash, adBytes.length);
      if (!await verifySig(pk.alg, JSON.parse(pk.jwk), data, unb64u(c.signature))) throw new Error('That passkey didn’t check out');
      if (ad.counter && pk.counter && ad.counter <= pk.counter) throw new Error('That passkey looks copied');
      await env.DB.prepare('UPDATE passkeys SET counter = ?, used = ? WHERE id = ?').bind(ad.counter, now(), pk.id).run();
      const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(pk.user_id).first();
      return ok({ token: await newSession(env, pk.user_id, req), user: publicUser(u) });
    }

    // ---- Google
    if (p === '/auth/google' && m === 'POST') {
      if (!env.GOOGLE_CLIENT_ID) return fail('Google sign-in isn’t set up yet', 503);
      const g = await verifyGoogle(body.credential, env), me = await sessionUser(req, env);
      const owner = await env.DB.prepare('SELECT * FROM users WHERE google_sub = ?').bind(g.sub).first();
      if (me) {   // linking Google to the account you're signed in to
        if (owner && owner.id !== me.id) return fail('That Google account is already linked to another Tenner account', 409);
        await env.DB.prepare('UPDATE users SET google_sub = ?, email = ?, picture = COALESCE(picture, ?) WHERE id = ?').bind(g.sub, g.email || null, g.picture || null, me.id).run();
        return ok({ ok: true });
      }
      let u = owner;
      if (!u) {
        const id = rand(16);
        await env.DB.prepare('INSERT INTO users (id, name, picture, hue, google_sub, email, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(id, String(g.given_name || g.name || 'You').slice(0, 40), g.picture || null, Math.floor(Math.random() * 360), g.sub, g.email || null, now()).run();
        u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
      }
      return ok({ token: await newSession(env, u.id, req), user: publicUser(u) });
    }

    // ---- everything else needs you signed in
    const me = await sessionUser(req, env);
    if (!me) return fail('Signed out', 401);
    if (p === '/auth/logout' && m === 'POST') { await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(me.token).run(); return ok({ ok: true }); }
    if (p === '/me' && m === 'GET') {
      const [d, pks, ss] = await Promise.all([
        env.DB.prepare('SELECT data, updated FROM userdata WHERE user_id = ?').bind(me.id).first(),
        env.DB.prepare('SELECT id, label, created, used FROM passkeys WHERE user_id = ? ORDER BY created').bind(me.id).all(),
        env.DB.prepare('SELECT label, created, seen, token FROM sessions WHERE user_id = ? ORDER BY seen DESC LIMIT 20').bind(me.id).all()]);
      return ok({ user: publicUser(me), data: d ? JSON.parse(d.data) : null, updated: d?.updated || 0,
        passkeys: pks.results.map((x) => ({ id: x.id, label: x.label, created: x.created, used: x.used })),
        sessions: ss.results.map((x) => ({ label: x.label, created: x.created, seen: x.seen, here: x.token === me.token })) });
    }
    if (p === '/me' && m === 'PATCH') {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : null, hue = Number.isFinite(+body.hue) ? ((+body.hue % 360) + 360) % 360 : null;
      if (name !== null && !name) return fail('Your name can’t be empty');
      await env.DB.prepare('UPDATE users SET name = COALESCE(?, name), hue = COALESCE(?, hue) WHERE id = ?').bind(name, hue, me.id).run();
      return ok({ user: publicUser(await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(me.id).first()) });
    }
    if (p === '/me/data' && m === 'PUT') {
      const row = await env.DB.prepare('SELECT data FROM userdata WHERE user_id = ?').bind(me.id).first();
      const merged = merge(row ? JSON.parse(row.data) : {}, clean(body.data));
      const text = JSON.stringify(merged);
      if (text.length > 400000) return fail('That’s too much to keep', 413);
      await env.DB.prepare('INSERT INTO userdata (user_id, data, updated) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated = excluded.updated').bind(me.id, text, now()).run();
      ctx.waitUntil(syncAlerts(env, me.id, merged.watchlist.map((x) => x.k)));   // alerts on all your devices watch the same list
      return ok({ data: merged });
    }
    if (p === '/me/share' && m === 'POST') {
      const sid = body.on ? (me.share_id || rand(9)) : null;
      await env.DB.prepare('UPDATE users SET share_id = ? WHERE id = ?').bind(sid, me.id).run();
      return ok({ share_id: sid });
    }
    if ((mm = p.match(/^\/me\/passkeys\/([\w-]{8,400})$/)) && m === 'DELETE') {
      const left = (await env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').bind(me.id).first()).n;
      if (left <= 1 && !me.google_sub) return fail('This is your only way to sign in. Add another passkey or link Google first');
      await env.DB.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').bind(mm[1], me.id).run();
      return ok({ ok: true });
    }
    if (p === '/me/google' && m === 'DELETE') {
      const left = (await env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').bind(me.id).first()).n;
      if (!left) return fail('Google is your only way to sign in. Add a passkey first');
      await env.DB.prepare('UPDATE users SET google_sub = NULL, email = NULL WHERE id = ?').bind(me.id).run();
      return ok({ ok: true });
    }
    if (p === '/me/sessions' && m === 'DELETE') {   // sign out everywhere else
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(me.id, me.token).run();
      return ok({ ok: true });
    }
    if (p === '/me' && m === 'DELETE') {
      const subs = (await env.DB.prepare('SELECT sub_key FROM pushsubs WHERE user_id = ?').bind(me.id).all()).results;
      await env.DB.batch(['DELETE FROM passkeys WHERE user_id = ?', 'DELETE FROM sessions WHERE user_id = ?', 'DELETE FROM userdata WHERE user_id = ?', 'DELETE FROM pushsubs WHERE user_id = ?', 'DELETE FROM users WHERE id = ?']
        .map((q) => env.DB.prepare(q).bind(me.id)));
      if (env.PUSH) for (const s of subs) { const v = await env.PUSH.get(s.sub_key, 'json'); if (v) { delete v.user; await env.PUSH.put(s.sub_key, JSON.stringify(v)); } }
      return ok({ ok: true });
    }
    return fail('Not found', 404);
  } catch (err) {
    return fail(err.message || 'Something went wrong');
  }
}
async function takeChallenge(env, id) {
  const ch = await env.DB.prepare('SELECT * FROM challenges WHERE id = ?').bind(String(id || '')).first();
  await env.DB.prepare('DELETE FROM challenges WHERE id = ? OR expires < ?').bind(String(id || ''), now()).run();
  if (!ch || ch.expires < now()) throw new Error('That took too long. Try again');
  return ch;
}
// the alerts on every device signed in to this account follow the account's Watchlist
async function syncAlerts(env, userId, watch) {
  if (!env.PUSH) return;
  const subs = (await env.DB.prepare('SELECT sub_key FROM pushsubs WHERE user_id = ?').bind(userId).all()).results;
  for (const { sub_key } of subs) {
    const v = await env.PUSH.get(sub_key, 'json');
    if (!v) { await env.DB.prepare('DELETE FROM pushsubs WHERE sub_key = ?').bind(sub_key).run(); continue; }
    if (v.watch?.length === watch.length && v.watch.every((k, i) => k === watch[i])) continue;
    await env.PUSH.put(sub_key, JSON.stringify({ ...v, watch, user: userId }));
  }
}
// a device turning alerts on while signed in: remember whose it is
export async function linkAlerts(req, env, subKey) {
  if (!env.DB) return null;
  const me = await sessionUser(req, env).catch(() => null);
  if (!me) return null;
  await env.DB.prepare('INSERT INTO pushsubs (sub_key, user_id) VALUES (?, ?) ON CONFLICT(sub_key) DO UPDATE SET user_id = excluded.user_id').bind(subKey, me.id).run();
  const d = await env.DB.prepare('SELECT data FROM userdata WHERE user_id = ?').bind(me.id).first();
  return d ? (JSON.parse(d.data).watchlist || []).map((x) => x.k) : null;
}

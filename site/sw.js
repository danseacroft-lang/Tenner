// Tenner's service worker: lets the installed app open instantly and still work with no connection.
// Pages, scripts, styles and the hourly data: the network first (so a new deploy or a new hour always wins), with the
// last copy kept for when there's no connection, or when the network is too slow to answer within a few seconds. Fonts and icons: from the cache. TMDB's posters: from the cache, the most recent
// 60 or so. A title's details and cast from the search API, and On TV this week: the network first, the last 150 kept
// for offline. Everything on your Watchlist (its details and poster) is kept too, so its sheets open on a plane.
const SHELL = 'tenner-shell-1.63.0', IMGS = 'tenner-img-v1', FONTS = 'tenner-font-v1', API = 'tenner-api-v1', KEEP = 'tenner-keep-v1';   // the shell cache follows the version; fonts never change
const APIS = 'https://tenner-api.danseacroft.workers.dev', ONAIR = 'https://tenner-tv.danseacroft.workers.dev/api/onair';
// the hourly data every page reads, fetched when the app is installed (and refreshed in the background where the device
// allows), so each page opens offline even if it's never been visited
const DATA = ['trending', 'titles', 'trail', 'week', 'new', 'prices', 'cinema', 'browse', 'browse-more'].map((n) => `data/${n}.json`);
const CORE = ['./', 'index.html', 'browse.html', 'about.html', 'settings.html', 'settings.css', 'settings.js', 'legal.html', 'legal.css', 'people.html', 'discover.html', 'account.html', 'account.css', 'account.js', 'styles.css', 'browse.css', 'about.css', 'people.css', 'discover.css', 'contact.html', 'contact.js', 'list.html', 'list.js', 'shell.js', 'links.js', 'sheet.js', 'app.js', 'browse.js', 'cards.js', 'people.js', 'discover.js',
  'logo.svg', 'favicon.svg', 'favicon.ico'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' }))))
    .catch(() => {}).then(() => Promise.race([freshData(), new Promise((r) => setTimeout(r, 8000))])).then(() => self.skipWaiting()));   // 'reload': past the browser's cache, so this version's own files
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, IMGS, FONTS, API, KEEP].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// the hourly data, each file on its own (one that's missing never stops the rest), kept under its plain address
async function freshData() {
  const c = await caches.open(SHELL);
  await Promise.allSettled(DATA.map((u) => fetch(`${u}?v=${Date.now()}`).then((r) => { if (r.ok) return c.put(new URL(u, self.location.href).href, r); })));
}

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.endsWith('.woff2')) { e.respondWith(cacheFirst(e, FONTS)); return; }   // only off Apple devices
    if (/\.(png|svg|jpg)$/.test(url.pathname)) { e.respondWith(cacheFirst(e, SHELL)); return; }
    e.respondWith(networkFirst(e)); return;
  }
  if (url.hostname === 'image.tmdb.org') { e.respondWith(caches.match(req, { cacheName: KEEP }).then((hit) => hit || cacheFirst(e, IMGS, 60))); return; }
  if ((url.origin === APIS && /^\/(title|credits)\/[mt]\d+$/.test(url.pathname)) || url.href.startsWith(ONAIR)) e.respondWith(apiFirst(e));
});
// the search API: the network first; with no connection, the copy kept from last time (or the Watchlist's own copy)
async function apiFirst(e) {
  const req = e.request, key = req.url.split('?')[0], c = await caches.open(API);
  try {
    const res = await fetch(req);
    if (res.ok) { const copy = res.clone(); e.waitUntil(c.put(key, copy).then(() => trim(c, 150))); }
    return res;
  } catch (err) {
    return (await c.match(key)) || (await caches.match(key, { cacheName: KEEP })) || Response.error();
  }
}
const trim = (c, max) => c.keys().then((keys) => Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => c.delete(k))));

async function networkFirst(e) {
  const req = e.request, c = await caches.open(SHELL);
  // scripts and styles carry the version (?v=1.2.3) and the hourly data a time stamp: one copy of each, whatever the stamp
  const key = new URL(req.url); key.searchParams.delete('v'); if (key.pathname.includes('/data/')) key.search = '';
  const fromCache = async () => (await c.match(key.toString(), { ignoreSearch: req.mode === 'navigate' })) || (req.mode === 'navigate' ? c.match('./') : null);
  // pages always ask the server whether there's a newer copy (a quick "not changed" if not), so a new version's page
  // arrives at once, and with it that version's own scripts and styles
  const net = fetch(req, req.mode === 'navigate' ? { cache: 'no-cache' } : undefined).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); e.waitUntil(c.put(key.toString(), copy)); }
    return res;
  });
  // a slow connection (a train, a lift): after 4 seconds show the last copy, if there is one, rather than a blank page
  const slow = new Promise((r) => setTimeout(r, 4000)).then(fromCache);
  try {
    return await Promise.race([net, slow.then((hit) => hit || net)]);
  } catch (err) {
    return (await fromCache()) || Response.error();
  }
}
async function cacheFirst(e, name, max) {
  const req = e.request, c = await caches.open(name), hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {   // straight to the page; the copy is saved alongside
    const copy = res.clone();
    e.waitUntil(c.put(req, copy).then(() => max && trim(c, max)));
  }
  return res;
}

// ---------- Watchlist alerts (the Worker's push.js sends them): show it, and open the title when it's tapped ----------
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data?.json() || {}; } catch { d = { title: 'Tenner', body: e.data?.text() || '' }; }
  // the morning's alert carries how many Watchlist shows have a new episode today: the Home Screen icon shows it too
  if (Number.isInteger(d.badge) && self.navigator.setAppBadge) (d.badge ? self.navigator.setAppBadge(d.badge) : Promise.resolve()).catch(() => {});
  e.waitUntil(self.registration.showNotification(d.title || 'Tenner', { body: d.body || '', icon: 'icon-192.png', badge: 'icon-96.png', tag: d.tag || 'tenner', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).origin === self.location.origin);
    return open ? open.focus().then((c) => c.navigate(url)) : self.clients.openWindow(url);
  }));
});

// ---------- the Watchlist, kept for offline: each page tells this worker what's on it (shell.js) ----------
// Each title's details from the search API and its poster, fetched once and kept while it's on the Watchlist; anything
// taken off is let go. A few at a time, so it never gets in the way.
self.addEventListener('message', (e) => {
  if (e.data?.type === 'keep' && Array.isArray(e.data.items)) e.waitUntil(keep(e.data.items.slice(0, 500)));
});
async function keep(items) {
  const c = await caches.open(KEEP), want = new Map();
  for (const x of items) {
    if (!/^[mt]\d{1,9}$/.test(x?.k || '')) continue;
    want.set(`${APIS}/title/${x.k}`, 1);
    if (/^https:\/\/image\.tmdb\.org\//.test(x.poster || '')) want.set(x.poster, 0);
  }
  const have = new Set((await c.keys()).map((r) => r.url));
  await Promise.all([...have].filter((u) => !want.has(u)).map((u) => c.delete(u)));
  const todo = [...want].filter(([u]) => !have.has(u));
  const one = async () => { for (let x; (x = todo.shift());) { try { const [u, api] = x, r = await fetch(u, api ? {} : { mode: 'no-cors' }); if (r.ok || r.type === 'opaque') await c.put(u, r); } catch {} } };
  await Promise.all([one(), one(), one()]);
}

// ---------- the installed app, in the background (Chrome and Edge): this hour's charts are waiting when it opens ----------
self.addEventListener('periodicsync', (e) => { if (e.tag === 'tenner-charts') e.waitUntil(freshData()); });

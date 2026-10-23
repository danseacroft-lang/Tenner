// Tenner's service worker: lets the installed app open instantly and still show the last chart when offline.
// Pages, scripts, styles and the hourly data: the network first (so a new deploy or a new hour always wins), with the
// last copy kept for when there's no connection, or when the network is too slow to answer within a few seconds. Fonts and icons: from the cache. TMDB's posters: from the cache, the most recent
// 60 or so. The search API is never cached here (Cloudflare caches it).
const SHELL = 'tenner-shell-1.26.0', IMGS = 'tenner-img-v1';   // the shell cache follows the version
const CORE = ['./', 'index.html', 'browse.html', 'about.html', 'settings.html', 'people.html', 'account.html', 'account.css', 'account.js', 'styles.css', 'browse.css', 'about.css', 'people.css', 'shell.js', 'links.js', 'sheet.js', 'app.js', 'browse.js', 'people.js',
  'fonts/inter-latin.woff2', 'fonts/inter-tight-latin.woff2', 'logo.svg', 'favicon.svg', 'favicon.ico'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' }))))
    .catch(() => {}).then(() => self.skipWaiting()));   // 'reload': past the browser's cache, so this version's own files
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== IMGS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (/\.(woff2|png|svg|jpg)$/.test(url.pathname)) { e.respondWith(cacheFirst(e, SHELL)); return; }
    e.respondWith(networkFirst(e)); return;
  }
  if (url.hostname === 'image.tmdb.org') e.respondWith(cacheFirst(e, IMGS, 60));
});

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
    e.waitUntil(c.put(req, copy).then(() => max && c.keys().then((keys) => Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => c.delete(k))))));
  }
  return res;
}

// ---------- Watchlist alerts (the Worker's push.js sends them): show it, and open the title when it's tapped ----------
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data?.json() || {}; } catch { d = { title: 'Tenner', body: e.data?.text() || '' }; }
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

// Tenner's service worker: lets the installed app open instantly and still show the last chart when offline.
// Pages, scripts, styles and the hourly data: the network first (so a new deploy or a new hour always wins), with the
// last copy kept for when there's no connection. Fonts and icons: from the cache. TMDB's posters: from the cache, the most recent
// 60 or so. The search API is never cached here (Cloudflare caches it).
const SHELL = 'tenner-shell-1.4.0', IMGS = 'tenner-img-v1';   // the shell cache follows the version
const CORE = ['./', 'index.html', 'browse.html', 'about.html', 'settings.html', 'styles.css', 'browse.css', 'about.css', 'shell.js', 'sheet.js', 'app.js', 'browse.js',
  'fonts/inter-latin.woff2', 'fonts/inter-tight-latin.woff2', 'logo.svg', 'favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== IMGS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (/\.(woff2|png|svg|jpg)$/.test(url.pathname)) { e.respondWith(cacheFirst(req, SHELL)); return; }
    e.respondWith(networkFirst(req)); return;
  }
  if (url.hostname === 'image.tmdb.org') e.respondWith(cacheFirst(req, IMGS, 60));
});

async function networkFirst(req) {
  const c = await caches.open(SHELL);
  // the hourly data files carry a ?v= stamp; keep one copy of each, whatever the stamp
  const key = new URL(req.url); if (key.pathname.includes('/data/')) key.search = '';
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') c.put(key.toString(), res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(key.toString(), { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') return (await c.match('./')) || Response.error();
    throw err;
  }
}
async function cacheFirst(req, name, max) {
  const c = await caches.open(name), hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    await c.put(req, res.clone());
    if (max) c.keys().then((keys) => keys.slice(0, Math.max(0, keys.length - max)).forEach((k) => c.delete(k)));
  }
  return res;
}

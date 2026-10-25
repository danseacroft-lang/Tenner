// Tenner TV's service worker: the page opens instantly and still works with a weak signal or none.
// - the page: from the network (so a new version always arrives), the last good copy if the network fails or takes over 3s
// - listings: the same, with a 4s wait; old days are cleared away
// - the page's own files (versioned), logos and icons: kept on the device, as they never change under the same name
// Sky's programme pictures are left to the browser's own cache. The version below changes with every update.
const V = 'tenner-tv?v=2.9.1';
const SHELL = ['/', '/tv.css?v=2.9.1', '/tv.js?v=2.9.1', '/logo.svg'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(Date.now());
async function fresh(req, ms, key = req) {
  const c = await caches.open(V);
  const net = fetch(req).then((r) => { if (r.ok) c.put(key, r.clone()); return r; });
  let timer;
  const slow = new Promise((_, no) => { timer = setTimeout(() => no(new Error('slow')), ms); });
  try { return await Promise.race([net, slow]); }
  catch { return (await c.match(key)) || net; }
  finally { clearTimeout(timer); }
}
async function kept(req) {
  const c = await caches.open(V), hit = await c.match(req); if (hit) return hit;
  const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r;
}
async function tidy() {   // listings for days gone by
  const c = await caches.open(V), t = today();
  for (const r of await c.keys()) { const d = new URL(r.url).searchParams.get('d'); if (d && d < t) c.delete(r); }
}

self.addEventListener('fetch', (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  if (req.mode === 'navigate') return e.respondWith(fresh(req, 3000, '/'));
  if (u.pathname === '/api/day') { e.waitUntil(tidy()); return e.respondWith(fresh(req, 4000)); }
  if (u.pathname === '/data/meta.json') return e.respondWith(fresh(req, 4000));
  if (u.searchParams.has('v') || u.pathname.startsWith('/logos/') || /\.(svg|png|ico|webp)$/.test(u.pathname)) return e.respondWith(kept(req));
});

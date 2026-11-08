// Tenner's New This Week (#new) and Watchlist (#watchlist) pages. The Top 10 lives on the home page (home.js), and
// anything else here goes there. Reads data/trending.json and data/new.json (rebuilt hourly by GitHub Actions).
// Shared helpers (esc, hue) come from shell.js, which loads first.

const { esc, hue } = window.tn;
const reduceMotion = () => document.documentElement.classList.contains('still');   // Animations off (or Reduce Motion): read live, so a change in Settings or another tab applies at once
const state = { trending: null, fresh: null, route: 'new' };
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const fmtDate = (d, opts) => d.toLocaleDateString('en-GB', opts);
const pad = (n) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };   // today's date where you are

// ---------- data ----------
async function fetchData(bust) {
  const v = `?v=${bust ? Date.now() : Math.floor(Date.now() / 600000)}`;
  const [trending, fresh, cat, week, cinema, trail] = await Promise.all([
    fetch('data/trending.json' + v, { cache: bust ? 'no-store' : 'default' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    fetch('data/new.json' + v).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch('data/browse.json' + v).then((r) => (r.ok ? r.json() : null)).catch(() => null),   // for "Top rated at a glance"
    fetch('data/week.json' + v).then((r) => (r.ok ? r.json() : null)).catch(() => null),     // for "This Week"
    fetch('data/cinema.json' + v).then((r) => (r.ok ? r.json() : null)).catch(() => null),   // New: at the cinema
    fetch('data/trail.json' + v).then((r) => (r.ok ? r.json() : null)).catch(() => null),    // New: the week on the charts
  ]);
  return { trending, fresh, cat, week, cinema, trail };
}

async function load() {
  try {
    Object.assign(state, await window.tn.loading.wrap(fetchData(false)));
  } catch (err) {
    view.innerHTML = `<div class="wrap"><h1 class="large-title">The chart didn't load</h1>
      <p class="lede">${esc(err.message)}. If you've just set the site up, run the "Update and deploy" workflow once, then refresh.</p></div>`;
    return;
  }
  if (window.tn.prefs.get().no18) state.titles = await window.tnSheet?.details();   // certificates, before the first chart
  addEventListener('tn:prefs', () => { if (window.tn.prefs.get().no18 && !state.titles) window.tnSheet?.details().then((d) => { state.titles = d; render(); }); else render(); });

  route();
}

const services = () => state.trending.services;
window.tnTonight?.use({ cat: () => state.cat, services: () => state.trending?.services, titles: () => state.titles });   // tonight.js borrows what's loaded
const svc = (k) => services().find((s) => s.key === k);

// Fetch the latest data and, if it's new, redraw in place (with the usual crossfade), keeping your scroll position.
// The background check (from shell.js) does it quietly, and holds back while a menu is open, trying again next time.
async function refresh() {
  if (!state.trending || refreshing) return;
  refreshing = true;
  try {
    const d = await fetchData(true);
    const changed = d.trending.generatedAt !== state.trending.generatedAt || d.fresh?.generatedAt !== state.fresh?.generatedAt;
    if (changed) { const y = scrollY; Object.assign(state, d, { cat: d.cat || state.cat, week: d.week || state.week, trail: d.trail || state.trail }); render(); requestAnimationFrame(() => scrollTo(0, y)); }
  } catch {}   // quietly: the next check catches up
  refreshing = false;
}
let refreshing = false;
addEventListener('tn:check', () => refresh());

// ---------- routing ----------
function route() {
  const first = location.hash.slice(1);
  if (first === 'week') { history.replaceState(null, '', '#new'); return route(); }   // This Week now lives on New
  if (!['new', 'watchlist'].includes(first)) { location.replace(`./${location.search}`); return; }   // the Top 10 lives on Home now
  state.route = first;
  render();
}

function render() {
  morph(draw);
}
// Swap the page through a View Transition where the browser has one, so changes crossfade instead of jumping.
function morph(fn) {
  if (!document.startViewTransition || reduceMotion() || !view.firstElementChild || view.querySelector('.loading')) { fn(); return; }
  document.startViewTransition(fn).ready.catch(() => {});   // a newer change can cut one short: that's fine
}
function draw() {
  selectTab(state.route);
  if (state.route === 'watchlist') { shown = new Map(); hideBanners(); view.innerHTML = `<div class="wrap">${pageWatchlist()}</div>`; document.title = 'Watchlist | Tenner'; wlKindInit(); wlHero(); openFromUrl(); wantTitles(); alertCard(); return; }
  wlHero(true);
  shown = new Map(); view.innerHTML = `<div class="wrap">${pageNew()}</div>`; newBanners((state.fresh?.items || []).filter((x) => x.date <= todayIso())); document.title = 'New This Week | Tenner'; nwMount(); openFromUrl();
}

// ---------- phones: New This Week's arrivals as wide banners, swiped one at a time, neighbours peeking in at the sides ----------
const phone = matchMedia('(max-width: 560px)');
phone.addEventListener('change', () => state.trending && render());
const mBan = $('#mBan');
const hideBanners = () => { mBan.hidden = true; mBan.innerHTML = ''; };
// New This Week on phones: the new arrivals as banners too. Watchmode gives a poster but no wide artwork, so each is laid
// out like Rakuten's own: the words on the left, the poster crisp on the right, its colours blurred behind
function newBanners(items) {
  if (!phone.matches) { mBan.hidden = true; mBan.innerHTML = ''; return; }
  const today = todayIso();
  const list = items.filter((x) => x.poster).sort((a, b) => (b.original - a.original) || Math.abs(Date.parse(a.date) - Date.parse(today)) - Math.abs(Date.parse(b.date) - Date.parse(today))).slice(0, 6);
  if (!list.length) { mBan.hidden = true; mBan.innerHTML = ''; return; }
  mountBanners(list.map((x, i) => {
    const s = svc(x.service), when = x.date === today ? 'Today' : fmtDate(new Date(x.date + 'T12:00:00'), { weekday: 'short', day: 'numeric', month: 'short' });
    const badge = `New on ${s?.label || 'streaming'} · ${when}`, what = x.type === 'movie' ? 'Film' : x.season ? `Season ${x.season}` : 'Series';
    const attrs = x.url ? `href="${esc(x.url)}" target="_blank" rel="noopener" ${reg(infoFor(x, x.type, badge, s ? [s] : []))}` : 'href="#new"';
    return `<a class="mb-card mb-pc" ${attrs} aria-label="${esc(`${badge}: ${x.title}`)}">
      <img class="mb-glow" src="${esc(x.poster)}" alt="" ${i ? 'loading="lazy"' : ''}><img class="mb-poster" src="${esc(x.poster)}" alt="" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">
      <span class="mb-copy"><span class="mb-badge">${esc(badge)}</span><b class="mb-title">${esc(x.title)}</b><span class="mb-meta">${esc([what, x.original && s ? `${s.label} original` : ''].filter(Boolean).join(' · '))}</span></span></a>`;
  }));
}
function mountBanners(cards) {
  mBan.innerHTML = `<div class="mb-track" id="mbTrack">${cards.join('')}</div>
    <div class="mb-dots" aria-hidden="true">${cards.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</div>`;
  mBan.hidden = false;
  const track = $('#mbTrack'), dots = [...mBan.querySelectorAll('.mb-dots i')];
  let raf = 0;
  track.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
    const c = track.firstElementChild; if (!c) return;
    const i = Math.round(track.scrollLeft / (c.offsetWidth + 10)); dots.forEach((d, k) => d.classList.toggle('on', k === i));
  }); }, { passive: true });
}
mBan.addEventListener('click', (e) => {
  const a = e.target.closest('[data-sheet]'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
  e.preventDefault(); window.tnSheet?.open(shown.get(a.dataset.sheet));
});


// ---------- the title sheet (sheet.js): every title on the page opens where-to-watch in Tenner ----------
// Each drawn title is registered with what the sheet needs; links carry data-sheet="<n>" and keep their TMDB href,
// so Cmd/Ctrl-click still opens TMDB in a new tab.
let shown = new Map();
const tmdbUrl = (type, id) => `https://www.themoviedb.org/${type}/${id}`;
function infoFor(it, type, eye, svcs) {
  const id = it.id, k = /^\d+$/.test(String(id ?? '')) ? `${type === 'movie' ? 'm' : 't'}${id}` : null;
  return {
    k, type, eye, title: it.title, year: it.year || (it.date || '').slice(0, 4) || null, rating: it.rating, poster: it.poster, backdrop: it.backdrop, overview: it.overview,
    netflix: /netflix\.com\/title\//.test(it.url || '') ? it.url : null, tmdb: k ? tmdbUrl(type, id) : null,
    services: (svcs || (it.on || []).map(svc)).filter(Boolean).map((s) => ({ label: s.label, logo: s.logo })),
  };
}
function reg(info) { const n = String(shown.size); shown.set(n, info); return `data-sheet="${n}"`; }
view.addEventListener('click', (e) => {
  const a = e.target.closest('[data-sheet]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;   // modified clicks open TMDB as usual
  e.preventDefault(); window.tnSheet?.open(shown.get(a.dataset.sheet));
});
// on computers, resting the pointer on a poster opens it up into a hover card (sheet.js)
window.tnSheet?.hover?.('a[data-sheet]:not(.mb-card)', (a) => shown.get(a.dataset.sheet));   // every title, bar the phone banners
// a shared link (?t=m123) opens that title's sheet once the chart has loaded
function openFromUrl() {
  const k = new URL(location.href).searchParams.get('t'); if (!k || window.tnSheet?.isOpen()) return;
  for (const info of shown.values()) if (info.k === k) { window.tnSheet.open(info, true); return; }
  const type = k[0] === 'm' ? 'movie' : 'tv', all = [...services().flatMap((s) => [...(s.tv || []), ...(s.movie || [])]), ...(state.fresh?.items || [])];
  const it = all.find((x) => `${(x.type || type) === 'movie' ? 'm' : 't'}${x.id}` === k);
  if (it) window.tnSheet.open(infoFor(it, it.type || type), true);
  else window.tnSheet.openKey?.(k);   // something Tenner doesn't follow: the search API has it
}


// ---------- pieces ----------
const thumb = (u) => String(u).replace('/t/p/w342/', '/t/p/w154/');   // small spots (lists) take TMDB's smaller poster
function placeholder(it) {
  const h = hue(it.title);
  return `<span class="ph" style="background:linear-gradient(160deg,hsl(${h} 45% 42%),hsl(${(h + 40) % 360} 55% 18%))">${esc(it.title)}</span>`;
}

// ---------- the Watchlist: titles you've saved from a title sheet (on this device, and in your account if you sign in) ----------
const wlKey = (it, type) => (/^\d+$/.test(String(it.id ?? '')) ? `${type === 'movie' ? 'm' : 't'}${it.id}` : null);
// where each saved title sits in today's charts, e.g. "No. 3 on Netflix"
function chartSpots() {
  const spots = new Map(), t = state.trending; if (!t) return spots;
  const add = (list, type, where) => (list || []).forEach((it, i) => { const k = wlKey(it, type); if (k && !spots.has(k)) spots.set(k, `No. ${i + 1} ${where}`); });
  ['tv', 'movie'].forEach((type) => add(t.overall?.[type], type, 'in the UK'));
  services().forEach((s) => ['tv', 'movie'].forEach((type) => add(s[type], type, `on ${s.label}`)));
  return spots;
}
const wlInfo = (x, eye) => ({ k: x.k, type: x.type, eye, title: x.title, year: x.year, poster: x.poster, tmdb: tmdbUrl(x.type, x.k.slice(1)), services: [] });
// The list's details (where to watch, next episode, season sizes) come from data/titles.json; saved shows Tenner
// doesn't follow are looked up once each through the search API.
const det = (k) => state.titles?.items?.[k] || state.extra?.[k];
function wantTitles() {
  if (!window.tnSheet?.details) return;
  const more = () => {
    const api = window.tn.api; if (!api) return;
    const miss = window.tn.saved.all().filter((x) => x.type === 'tv' && !det(x.k) && !(state.asked ||= new Set()).has(x.k)).slice(0, 30);
    if (!miss.length) return;
    miss.forEach((x) => state.asked.add(x.k));
    Promise.all(miss.map((x) => fetch(`${api}/title/${x.k}`).then((r) => (r.ok ? r.json() : null)).catch(() => null))).then((rs) => {
      state.extra ||= {};
      rs.forEach((r) => { if (r?.items) Object.assign(state.extra, r.items); });
      if (rs.some(Boolean) && state.route === 'watchlist') render();
    });
  };
  if (state.titles) return more();
  window.tnSheet.details().then((d) => { if (d && !state.titles) { state.titles = d; if (state.route === 'watchlist') render(); } more(); });
}
// on the Watchlist: an offer to turn on alerts (or, on an iPhone in Safari, how to get them), until they're on
const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M10 20.5a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
async function alertCard() {
  const box = $('#wlAlert'); if (!box) return;
  try { if (localStorage.getItem('tenner-alerts-hidden')) return; } catch {}   // closed with its ×: it stays closed (Settings still has alerts)
  const st = await window.tn.alerts.state();
  if (st === 'on' || st === 'unsupported' || st === 'blocked' || !box.isConnected) return;
  const X = '<button type="button" class="wl-al-x" id="wlAlertX" aria-label="Close" title="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>';
  box.innerHTML = st === 'install'
    ? `<span class="wl-al-ic">${BELL}</span><p><b>Get an alert when these arrive.</b> Add Tenner to your Home Screen (Share, then Add to Home Screen) and open it from there. You can turn alerts on in Settings later too.</p>${X}`
    : `<span class="wl-al-ic">${BELL}</span><p><b>Get an alert when these arrive.</b> A notification when something here lands on a service, or gets a new season.</p><button type="button" class="btn btn-tinted" id="wlAlertOn">Turn on</button>${X}`;
  box.hidden = false;
  $('#wlAlertX').addEventListener('click', () => {
    try { localStorage.setItem('tenner-alerts-hidden', '1'); } catch {}
    const done = () => { box.hidden = true; };
    if (reduceMotion() || !box.animate) return done();
    box.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.97)' }], { duration: 220, easing: 'ease-in' }).finished.then(done, done);
  });
  $('#wlAlertOn')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await window.tn.alerts.enable(); if (r === 'on') { box.hidden = true; toast('Alerts on. Change it any time in Settings'); } else { e.target.disabled = false; toast(r === 'blocked' ? 'Notifications are off for Tenner in your browser’s settings' : 'Alerts stay off'); } }
    catch { e.target.disabled = false; toast('Alerts aren’t available right now'); }
  });
}
function pageWatchlist() {
  const list = window.tn.saved.all(), spots = chartSpots(), d = state.titles, kind = state.wlKind || 'both';
  const onLogos = (k) => {
    const x = d?.items?.[k]; if (!x?.f?.length || !d.logo) return '';
    const seen = new Set();
    return x.f.map((id) => d.providers[id]).filter((p) => p?.[1] && !seen.has(p[0].split(' ')[0]) && seen.add(p[0].split(' ')[0])).slice(0, 3)
      .map(([n, logo]) => `<img class="nw-logo" src="${esc(d.logo + logo)}" alt="${esc(n)}" data-tip="${esc(n)}">`).join('');
  };
  const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  // the homepage's chart list: poster, title, what it is (and where it charts), where it's streaming, then remove
  const rows = list.map((x) => {
    const spot = spots.get(x.k), sh = reg(wlInfo(x, spot || 'In your Watchlist')), on = onLogos(x.k);
    const what = [x.type === 'movie' ? 'Film' : 'Series', x.year, spot].filter(Boolean).join(' · ');
    const art = x.poster ? `<img src="${esc(thumb(x.poster))}" alt="" loading="lazy" decoding="async">` : `<span class="cl-ph" style="background:hsl(${hue(x.title)} 45% 35%)"></span>`;
    return `<li data-type="${x.type === 'movie' ? 'movie' : 'tv'}"><a href="${esc(tmdbUrl(x.type, x.k.slice(1)))}" target="_blank" rel="noopener" ${sh}>
        ${art}<span class="cl-t"><b>${esc(x.title)}</b><small>${esc(what)}</small>${showLine(x)}${noteLine(x.k)}</span>${on ? `<span class="wl-on">${on}</span>` : ''}</a>
      <button type="button" class="wl-x" data-unsave="${esc(x.k)}" aria-label="Remove ${esc(x.title)} from your Watchlist" title="Remove">${X}</button></li>`;
  }).join('');
  const both = list.some((x) => x.type === 'movie') && list.some((x) => x.type !== 'movie');
  const body = !list.length
    ? `<div class="empty"><span class="empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h12v18.4l-6-4.2-6 4.2z" fill="currentColor"/></svg></span>
        <h2>Nothing saved yet</h2><p>Open any title and press Watchlist to keep it here, with where to watch it.</p>
        <a class="btn btn-tinted" href="./"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.4 12 4l8 6.4V20h-5v-5.6H9V20H4z" fill="currentColor"/></svg>See the top 10</a></div>`
    : `<section class="wk" aria-labelledby="wl-saved"><div class="row-hd wl-hd"><h2 class="row-h" id="wl-saved">Saved</h2>${both ? `<label class="dd dd-kind"><span class="dd-l" id="wlKindL">${{ tv: 'Shows', movie: 'Films', both: 'Shows and films' }[kind]}</span><span class="dd-chev" aria-hidden="true"></span>
        <select id="wlKind" aria-label="Shows, films or both">${[['tv', 'Shows'], ['movie', 'Films'], ['both', 'Shows and films']].map(([k, l]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}</div>
      <ol class="cl nw-cl wl-cl" data-kind="${both ? kind : 'both'}">${rows}</ol></section>`;
  return `<h1 class="large-title page-title"><em class="grad">Watchlist</em></h1>
    <p class="lede">${list.length ? `You have <b>${list.length} title${list.length === 1 ? '' : 's'}</b> on your Watchlist. ` : ''}${window.tn.account.user() ? 'Your Watchlist will be anywhere you’re signed in.' : 'It’s saved on this device. <a href="account.html">Sign in</a> to have it anywhere you’re signed in.'}</p>
    ${list.length ? '<div class="wl-alert" id="wlAlert" hidden></div>' : ''}${body}${comingUp(list)}${watchedList()}`;
}
// your note on a title (signed in, and Settings → Notes on my Watchlist), in grey under it
function noteLine(k) {
  const tn = window.tn, n = tn.member() && tn.prefs.get().notewl !== false && tn.notes.get(k)?.[0];
  return n ? `<small class="wl-note">“${esc(n)}”</small>` : '';
}
// Watched (signed in): what you've marked as watched in a title's sheet, newest first, in the same list
function watchedList() {
  if (!window.tn.member()) return '';
  const all = window.tn.seen.list(), list = all.slice(0, state.seenAll ? 1000 : 20); if (!list.length) return '';
  const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const rows = list.map((x) => {
    const art = x.poster ? `<img src="${esc(thumb(x.poster))}" alt="" loading="lazy" decoding="async">` : `<span class="cl-ph" style="background:hsl(${hue(x.title)} 45% 35%)"></span>`;
    const what = [x.type === 'movie' ? 'Film' : 'Series', x.year, `Watched ${fmtDate(new Date(x.at), { day: 'numeric', month: 'short' })}`].filter(Boolean).join(' · ');
    return `<li><a href="${esc(tmdbUrl(x.type, x.k.slice(1)))}" target="_blank" rel="noopener" ${reg(wlInfo(x, 'Watched'))}>
        ${art}<span class="cl-t"><b>${esc(x.title)}</b><small>${esc(what)}</small>${noteLine(x.k)}</span></a>
      <button type="button" class="wl-x" data-unseen="${esc(x.k)}" aria-label="Take ${esc(x.title)} off your Watched list" title="Take off Watched">${X}</button></li>`;
  }).join('');
  return `<section class="wk wl-seen" aria-labelledby="wl-seen"><div class="wk-hd"><h2 class="row-h" id="wl-seen">Watched</h2><p>${all.length} title${all.length === 1 ? '' : 's'} you’ve marked as watched</p></div>
    <ol class="cl nw-cl wl-cl">${rows}</ol>${all.length > list.length ? '<button type="button" class="btn btn-tinted wl-more" data-seen-all>Show all</button>' : ''}</section>`;
}
// ---------- the Watchlist's trailer (signed in): a random title from your list at the top, its trailer playing with the
// sound off over its artwork, blended into the page like the homepage's featured title (its colours glow behind the
// page and run on under the sidebar). The same title stays while you're here; the shuffle button picks another.
// It plays by itself unless Reduce Motion, Data Saver or Settings → Start trailers by themselves says not to; then
// the artwork stays still and the play button starts it. Paused while it's scrolled away, the tab's hidden or a sheet is open.
const WLI = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.4-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" fill="currentColor"/></svg>',
  mark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18.4l-6-4.2-6 4.2z" fill="currentColor"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7h3.2c2 0 3.2.9 4.3 2.6l2 3c1.1 1.7 2.3 2.6 4.3 2.6h3.2M3.5 17h3.2c1.6 0 2.7-.6 3.6-1.7M14.2 8.7c.9-1.1 2-1.7 3.6-1.7h2.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="m17.8 4.4 2.8 2.6-2.8 2.6M17.8 14.6l2.8 2.6-2.8 2.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path class="off" d="m16 9.5 5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path class="on" d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.7 7.7 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};
const WL_LOGO = 'https://image.tmdb.org/t/p/w500', YT = 'https://www.youtube-nocookie.com';
const wlh = { k: null, info: null, tries: new Set(), seen: true, playing: false, sound: false, run: 0 };
const wlApi = new Map();
const wlFetch = (k) => { const api = window.tn.api; if (!api) return Promise.resolve(null);
  if (!wlApi.has(k)) wlApi.set(k, fetch(`${api}/title/${k}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)); return wlApi.get(k); };
const wlAuto = () => { const p = window.tn.prefs.get(); return p.autoplay !== false && p.trailers !== 'youtube' && !matchMedia('(prefers-reduced-motion: reduce)').matches && !navigator.connection?.saveData; };
function wlHide() {
  const top = $('#wlTop'); if (!top || top.hidden) return;
  top.hidden = true; $('#wlHero').replaceChildren(); $('#bxAmb').replaceChildren(); $('#bdExt').replaceChildren(); wlh.k = null; wlh.playing = false;
}
async function wlHero(off, again) {
  const list = window.tn.saved.all();
  if (off || state.route !== 'watchlist' || !window.tn.account.user() || !list.length) return wlHide();
  if (!again && wlh.k && list.some((x) => x.k === wlh.k)) return;   // already showing one from your list: it stays
  const run = ++wlh.run;
  const d = state.titles || await window.tnSheet?.details?.();
  if (run !== wlh.run) return;
  // the candidates: titles with a trailer first, in a random order, leaving out the one just shown
  const has = (x) => det(x.k)?.tr, mix = (a) => a.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const pool = mix(list.filter((x) => x.k !== wlh.k && !wlh.tries.has(x.k)));
  const order = [...pool.filter(has), ...pool.filter((x) => !has(x))].slice(0, 5);
  if (!order.length && wlh.k) { wlh.tries.clear(); return list.length > 1 ? wlHero(false, true) : undefined; }
  for (const x of order) {
    const a = await wlFetch(x.k); if (run !== wlh.run) return;
    const it = { ...(d?.items?.[x.k] || {}), ...(a?.items?.[x.k] || {}) }, info = a?.info || {};
    if (!it.tr) { wlh.tries.add(x.k); continue; }
    wlh.tries.add(x.k);
    return wlDraw(x, it, info);
  }
  if (!wlh.k) wlHide();   // nothing on your list has a trailer yet
}
function wlDraw(x, it, info) {
  const top = $('#wlTop'), box = $('#wlHero'); if (!top) return;
  wlh.k = x.k; wlh.playing = false; wlh.sound = false;
  wlh.info = { ...wlInfo(x, 'From your Watchlist'), backdrop: info.backdrop || null };
  const art = info.backdrop || x.poster, title = info.title || x.title;
  const meta = [x.type === 'movie' ? 'Film' : it.se ? `${it.se} season${it.se === 1 ? '' : 's'}` : 'Series', info.year || x.year, x.type === 'movie' && it.rt ? `${Math.floor(it.rt / 60) ? `${Math.floor(it.rt / 60)}h ` : ''}${it.rt % 60}m` : ''].filter(Boolean);
  const auto = wlAuto();
  box.innerHTML = `<div class="bx-h-art wl-art${info.backdrop ? '' : ' wl-soft'}" id="wlArt"><div class="bx-h-l in">${art ? `<img src="${esc(art)}" alt="" decoding="async">` : ''}</div></div>
    <div class="bx-h-copy wl-copy">
      <p class="bx-eye">${WLI.mark}<span>From your Watchlist</span></p>
      ${it.g?.length ? `<p class="bx-pills">${it.g.slice(0, 3).map((g) => `<span>${esc(g)}</span>`).join('')}</p>` : ''}
      <h2 class="bx-h-t">${it.lg ? `<img class="bx-h-logo" src="${esc(WL_LOGO + it.lg)}" alt="${esc(title)}">` : esc(title)}</h2>
      <p class="bx-h-meta"><span>${meta.map(esc).join(' · ')}</span>${it.c ? `<b class="bx-cert">${esc(it.c)}</b>` : ''}</p>
      ${info.overview ? `<p class="bx-h-ov">${esc(info.overview)}</p>` : ''}
      <div class="bx-h-acts"><a class="btn btn-tinted bx-cta" href="${esc(tmdbUrl(x.type, x.k.slice(1)))}" target="_blank" rel="noopener" data-wl="open">${WLI.play}Where to watch</a>
        <button type="button" class="bx-r bx-r-l wl-snd" data-wl="sound" aria-pressed="false" aria-label="${auto ? 'Turn the trailer’s sound on' : 'Play the trailer'}" title="${auto ? 'Sound' : 'Play the trailer'}">${auto ? WLI.sound : WLI.play}</button>
        ${window.tn.saved.all().length > 1 ? `<button type="button" class="bx-r bx-r-l" id="wlShuffle" data-wl="shuffle" aria-label="Show another trailer from your Watchlist" title="Another trailer">${WLI.shuffle}</button>` : ''}</div>
    </div>`;
  const lg = box.querySelector('.bx-h-logo'); if (lg) lg.onerror = () => lg.replaceWith(document.createTextNode(title));
  // the colours: a soft glow behind the page, and under the sidebar's frost
  const glow = info.backdrop ? info.backdrop.replace('/w1280/', '/w780/') : x.poster;
  $('#bxAmb').innerHTML = glow ? `<img src="${esc(glow)}" alt="">` : ''; $('#bdExt').innerHTML = glow ? `<img class="bd-l in" src="${esc(glow)}" alt="">` : '';
  top.hidden = false;
  wlh.tr = it.tr;
  if (auto) setTimeout(() => wlh.k === x.k && wlPlay(false), 900);
  window.tn.tip({ id: 'watchlist-trailer', for: box.querySelector('#wlShuffle') || box.querySelector('.wl-snd'), title: 'Trailers from your Watchlist',
    text: 'When you’re signed in, the top of your Watchlist plays the trailer of something you’ve saved. Tap the speaker for sound, or shuffle for another.' });
}
// the trailer, from YouTube's privacy-enhanced player, filling the artwork; it fades in once it's ready, over the picture
function wlPlay(sound) {
  const art = $('#wlArt'); if (!art || !wlh.tr) return;
  art.querySelector('iframe')?.remove(); art.classList.remove('on');
  const k = encodeURIComponent(wlh.tr), f = document.createElement('iframe');
  f.src = `${YT}/embed/${k}?autoplay=1&mute=${sound ? 0 : 1}&controls=0&disablekb=1&fs=0&iv_load_policy=3&loop=1&playlist=${k}&modestbranding=1&rel=0&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
  f.title = `Trailer: ${wlh.info.title}`; f.tabIndex = -1; f.allow = 'autoplay; encrypted-media; picture-in-picture';
  // YouTube writes the title over the first seconds; the artwork stays until it's gone
  f.addEventListener('load', () => setTimeout(() => { if (f.isConnected) { art.classList.add('on'); wlh.playing = true; wlSync(); } }, 2400), { once: true });
  art.append(f);
  wlh.sound = sound; wlSoundBtn();
}
const wlCmd = (func, args = []) => $('#wlArt iframe')?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), YT);
function wlSoundBtn() {
  const b = $('#wlHero .wl-snd'); if (!b || !$('#wlArt iframe')) return;
  b.innerHTML = WLI.sound; b.title = 'Sound';
  b.setAttribute('aria-pressed', String(wlh.sound)); b.setAttribute('aria-label', wlh.sound ? 'Turn the trailer’s sound off' : 'Turn the trailer’s sound on');
}
// paused while it's out of sight (scrolled away, another tab, a title's sheet over it), carrying on when it's back
function wlSync() {
  if (!wlh.playing) return;
  wlCmd(wlh.seen && !document.hidden && !window.tnSheet?.isOpen?.() ? 'playVideo' : 'pauseVideo');
}
new IntersectionObserver(([e]) => { wlh.seen = e.isIntersecting; wlSync(); }, { threshold: .25 }).observe($('#wlHero'));
document.addEventListener('visibilitychange', wlSync);
addEventListener('tn:sheet-closed', wlSync);
addEventListener('tn:prefs', () => state.route === 'watchlist' && wlh.k && !wlAuto() && $('#wlArt iframe') && !wlh.sound && (wlCmd('pauseVideo'), wlh.playing = false));
$('#wlHero').addEventListener('click', (e) => {
  const b = e.target.closest('[data-wl]'); if (!b) return;
  const act = b.dataset.wl;
  if (act === 'open') {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault(); window.tnSheet?.open({ ...wlh.info }); setTimeout(wlSync, 60); return;
  }
  window.tn.haptic?.();
  if (act === 'shuffle') { wlHero(false, true); return; }
  if (act === 'sound') {
    if (window.tn.prefs.get().trailers === 'youtube') { window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(wlh.tr)}`, '_blank', 'noopener'); return; }
    if (!$('#wlArt iframe')) return wlPlay(true);   // not playing yet (it waits to be asked): start it, with the sound on
    wlh.sound = !wlh.sound; wlCmd(wlh.sound ? 'unMute' : 'mute'); if (wlh.sound) wlCmd('setVolume', [100]); wlSoundBtn();
  }
});
// Shows, Films or both, without redrawing
function wlKindInit() {
  $('#wlKind')?.addEventListener('change', (e) => {
    state.wlKind = e.target.value; $('.wl-cl').dataset.kind = e.target.value;
    $('#wlKindL').textContent = { tv: 'Shows', movie: 'Films', both: 'Shows and films' }[e.target.value];
  });
}
// shows: where you're up to, and when the next episode lands
function showLine(x) {
  if (x.type !== 'tv') return '';
  const d = det(x.k), p = window.tn.progress.get(x.k), up = p && window.tn.nextUp(p, d?.sz);
  const bits = [p ? (up ? `<b class="wl-go">Continue S${up[0]} E${up[1]}</b>` : '<b class="wl-go">All caught up</b>') : '',
    d?.nx ? `New episode ${esc(window.tn.whenText(d.nx[0]))}` : d?.en ? 'Ended' : ''].filter(Boolean);
  return bits.length ? `<small class="wl-next">${bits.join(' · ')}</small>` : '';
}
// Coming up: new episodes of your saved shows over the next month, soonest first
function comingUp(list) {
  const today = todayIso(), soon = new Date(Date.now() + 31 * 864e5).toLocaleDateString('en-CA');
  const items = list.filter((x) => x.type === 'tv' && det(x.k)?.nx && det(x.k).nx[0] >= today && det(x.k).nx[0] <= soon)
    .sort((a, b) => det(a.k).nx[0].localeCompare(det(b.k).nx[0]));
  if (!items.length) return '';
  return `<section class="nrow wl-soon" aria-labelledby="cu-h"><div class="wk-hd"><h2 class="row-h" id="cu-h">Coming Up</h2><p>New episodes of your shows this month</p></div>
    <ul class="nr">${items.map((x) => { const n = det(x.k).nx; return `<li><a href="${esc(tmdbUrl('tv', x.k.slice(1)))}" target="_blank" rel="noopener" ${reg(wlInfo(x, `New episode ${window.tn.whenText(n[0])}`))}>
      <span class="nr-art">${x.poster ? `<img src="${esc(x.poster)}" alt="" loading="lazy">` : placeholder({ title: x.title })}<span class="cu-when">${esc(window.tn.whenText(n[0]))}</span></span>
      <b>${esc(x.title)}</b><small>Season ${n[1]}, episode ${n[2]}</small></a></li>`; }).join('')}</ul></section>`;
}
view.addEventListener('click', (e) => {
  if (e.target.closest('[data-seen-all]')) { state.seenAll = true; const y = scrollY; draw(); scrollTo(0, y); return; }
  const u = e.target.closest('[data-unseen]');
  if (u) { const x = window.tn.seen.list().find((s) => s.k === u.dataset.unseen); if (x) window.tn.seen.set(x, 0); return; }
  const b = e.target.closest('[data-unsave]'); if (!b) return;
  const li = b.closest('li'), next = li.nextElementSibling || li.previousElementSibling, k = b.dataset.unsave;
  const done = () => { window.tn.saved.remove(k); requestAnimationFrame(() => $(`[data-unsave="${CSS.escape(next?.querySelector('[data-unsave]')?.dataset.unsave || '')}"]`)?.focus({ preventScroll: true })); };
  if (reduceMotion() || !li.animate) return done();
  b.disabled = true;
  li.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.9)', filter: 'blur(6px)' }], { duration: 260, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' }).finished.then(done, done);
});
// saving or removing (here, in a sheet or in another tab) redraws the Watchlist and the row
addEventListener('tn:sheet-closed', () => { if (state.savedDirty) { state.savedDirty = false; const y = scrollY; draw(); scrollTo(0, y); } });
for (const ev of ['tn:marks', 'tn:account']) addEventListener(ev, () => { if (state.trending && !window.tnSheet?.isOpen?.()) { const y = scrollY; draw(); scrollTo(0, y); } else state.savedDirty = true; });
addEventListener('tn:saved', () => { if (state.trending && !window.tnSheet?.isOpen?.()) { const y = scrollY; draw(); scrollTo(0, y); } else state.savedDirty = true; });

// ---------- This Week: the round-up (data/week.json, rebuilt hourly from the chart history) ----------
const chartName = (c, w = state.week) => { const [s, t] = c.split(':'); return `${t === 'movie' ? 'film' : 'show'} ${s === 'all' ? 'in the UK' : `on ${w?.labels?.[s] || s}`}`; };
const weekInfo = (x, eye) => { const it = state.week.items[x.k]; return it ? infoFor(it, it.type, eye) : null; };
const sinceText = (w) => !w?.since ? '' : w.days >= 6 ? 'over the last week' : w.days >= 1 ? `since ${new Date(w.since).toLocaleDateString('en-GB', { weekday: 'long' })}` : 'since yesterday';
function weekCard(x, sub) {
  const it = state.week.items[x.k]; if (!it) return '';
  return `<li><a href="${esc(tmdbUrl(it.type, it.id))}" target="_blank" rel="noopener" ${reg(weekInfo(x, sub))}>
    <span class="nr-art">${it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy">` : placeholder(it)}</span>
    <b>${esc(it.title)}</b><small>${esc(sub)}</small></a></li>`;
}

// New This Week, newest first; then Coming soon (the next month, each with Add to Calendar) and Leaving soon
let calItems = [];
function newItem(x, mode) {
  const s = svc(x.service), i = mode === 'soon' ? calItems.push(x) - 1 : -1;
  const kind = x.type === 'movie' ? 'Film' : x.season ? `Season ${x.season}` : 'Series';
  const what = [kind, s ? `${s.label}${x.original ? ' original' : ''}` : ''].filter(Boolean).join(' · ');
  const eye = mode === 'soon' ? `Coming to ${s?.label || 'streaming'}` : mode === 'leaving' ? `Leaving ${s?.label || 'streaming'}` : `New on ${s?.label || 'streaming'}`;
  const art = x.poster ? `<img src="${esc(thumb(x.poster))}" alt="" loading="lazy" decoding="async">` : `<span class="cl-ph" style="background:hsl(${hue(x.title)} 45% 35%)"></span>`;
  const cal = i >= 0 ? `<button type="button" class="cal-add" data-cal="${i}" aria-label="${esc(`Add ${x.title} to your calendar`)}" title="Add to Calendar"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 12.6v5M9.5 15.1h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>` : '';
  const row = `${art}<span class="cl-t"><b>${esc(x.title)}</b><small>${esc(what)}</small></span>${s?.logo ? `<img class="nw-logo" src="${esc(s.logo)}" alt="" data-tip="${esc(s.label)}">` : ''}`;
  return `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener" ${reg(infoFor(x, x.type, eye, s ? [s] : []))}>${row}</a>` : `<span class="nw-row">${row}</span>`}${cal}</li>`;
}
// ---------- New, redesigned: the week in numbers, Day by day (a ribbon of days), the week on the charts (each of the UK's
// top 10 traced as a line over the last week), the chart lists, Last chance and the cinema ----------
const NW = { day: null, days: new Map(), today: null, race: 'tv', ro: null, io: null };
const isoAdd = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dayName = (d, today) => d === today ? 'Today' : d === isoAdd(today, 1) ? 'Tomorrow' : d === isoAdd(today, -1) ? 'Yesterday'
  : fmtDate(new Date(d + 'T12:00:00'), { weekday: 'long', day: 'numeric', month: 'long' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const IC = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  today: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="15.2" r="2" fill="currentColor"/></svg>',
};

// The week in numbers: four counts in one frosted box, each a way into its part of the page
function nwStats(f, w, today, leaving) {
  const past = f ? f.items.filter((x) => x.date <= today && x.date > isoAdd(today, -7)) : [], ahead = f ? f.items.filter((x) => x.date > today && x.date <= isoAdd(today, 30)) : [];
  const ones = (w?.ones || []).filter((x, i, all) => x.fresh && all.findIndex((y) => y.k === x.k) === i).length;
  const cells = [
    [past.length, past.length === 1 ? 'New arrival' : 'New arrivals', 'in the last seven days', 'nwDays', '#0a84ff', past.length ? today : null],
    [ahead.length, 'On the way', 'over the next month', 'nwDays', '#bf5af2', ahead[0]?.date],
    [ones, ones === 1 ? 'New No. 1' : 'New No. 1s', 'at the top of a chart', 'wk-1', '#30d158', null],
    [leaving.length, 'Leaving soon', 'catch them before they go', 'leaving', '#ff375f', null],
  ].filter((c) => c[0]);
  if (cells.length < 2) return '';
  return `<nav class="nw-stats" aria-label="This week in numbers">${cells.map(([n, label, sub, to, c, day]) => `<a class="nw-stat" href="#${to}" data-jump="${to}"${day ? ` data-day="${day}"` : ''} style="--c:${c}">
    <b data-count="${n}">${n}</b><span>${esc(label)}<small>${esc(sub)}</small></span></a>`).join('')}</nav>`;
}

// Day by day: a ribbon of days, last week's arrivals and the month ahead, today in the middle. Pick a day and its titles
// show underneath in the chart list (with Add to Calendar for days ahead).
function nwRibbon(f, today) {
  if (!f || f.disabled || f.error) return '';
  const from = isoAdd(today, -7), to = isoAdd(today, 30), by = new Map();
  for (const x of f.items) if (x.date > from && x.date <= to) by.set(x.date, [...(by.get(x.date) || []), x]);
  if (!by.size) return '';
  if (!by.has(today)) by.set(today, []);
  const days = [...by.keys()].sort(), full = days.filter((d) => by.get(d).length);
  NW.days = by; NW.today = today;
  if (!by.has(NW.day)) NW.day = by.get(today).length ? today : full.find((d) => d > today) || full.at(-1);
  let month = '';
  const cols = days.map((d) => {
    const l = by.get(d), dt = new Date(d + 'T12:00:00'), on = d === NW.day, mo = fmtDate(dt, { month: 'short' });
    const stack = l.slice(0, 3).map((x, i) => x.poster ? `<img src="${esc(thumb(x.poster))}" alt="" loading="lazy" decoding="async" style="--i:${i}">`
      : `<i class="rb-ph" style="--i:${i};background:hsl(${hue(x.title)} 45% 35%)"></i>`).join('');
    const showMo = mo !== month; month = mo;
    return `<button type="button" role="tab" class="rb-day${d < today ? ' past' : ''}${d === today ? ' today' : ''}${l.length ? '' : ' none'}" id="rb-${d}" data-day="${d}" aria-selected="${on}" tabindex="${on ? 0 : -1}" aria-controls="rbPanel"
      aria-label="${esc(`${dayName(d, today)}: ${l.length ? plural(l.length, 'title', 'titles') : 'nothing new'}`)}">
      <span class="rb-wd">${d === today ? 'Today' : esc(fmtDate(dt, { weekday: 'short' }))}</span><b class="rb-n">${dt.getDate()}</b><span class="rb-mo">${showMo ? esc(mo) : '&nbsp;'}</span>
      <span class="rb-stack" style="--n:${Math.min(3, l.length)}">${stack || '<i class="rb-quiet"></i>'}</span>
      <span class="rb-c">${l.length ? plural(l.length, 'title', 'titles') : 'Quiet day'}</span></button>`;
  }).join('');
  return `<section class="wk rb" id="nwDays" aria-labelledby="rbH">
    <div class="wk-hd rb-hd"><h2 class="row-h" id="rbH">Day by Day</h2><p>Last week's arrivals and the month ahead</p>
      <div class="rb-ctl"><button type="button" class="btn btn-tinted rb-today" data-rb="today">${IC.today}Today</button>
        <button type="button" class="rb-arw" data-rb="-1" aria-label="Earlier days">${IC.prev}</button><button type="button" class="rb-arw" data-rb="1" aria-label="Later days">${IC.next}</button></div></div>
    <div class="rb-track" id="rbTrack" role="tablist" aria-label="Days">${cols}</div>
    <div class="rb-panel" id="rbPanel" role="tabpanel" aria-labelledby="rb-${NW.day}" aria-live="polite">${nwPanel()}</div></section>`;
}
function nwPanel() {
  const d = NW.day, l = NW.days.get(d) || [], today = NW.today, ahead = d > today;
  const say = l.length ? `${plural(l.length, 'title', 'titles')} ${ahead ? 'on the way' : d === today ? 'out today' : 'arrived'}${ahead ? '. Tap the calendar to be reminded on the day' : ''}` : 'Nothing new on the services';
  return `<div class="rb-pd"><h3 class="${d === today ? 'today' : ''}">${esc(dayName(d, today))}</h3><p>${esc(say)}</p></div>
    ${l.length ? `<ul class="cl nw-cl">${l.map((x) => newItem(x, ahead ? 'soon' : 'new')).join('')}</ul>` : ''}`;
}
function pickDay(d, how = 'smooth') {
  if (!NW.days.has(d)) return;
  const track = $('#rbTrack'), panel = $('#rbPanel'); if (!track || !panel) return;
  const changed = d !== NW.day; NW.day = d;
  track.querySelectorAll('.rb-day').forEach((b) => { const on = b.dataset.day === d; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
  const col = $(`#rb-${d}`);
  track.scrollTo({ left: col.offsetLeft - (track.clientWidth - col.offsetWidth) / 2, behavior: reduceMotion() ? 'auto' : how });
  if (!changed) return;
  window.tn.haptic?.();
  panel.setAttribute('aria-labelledby', `rb-${d}`);
  panel.innerHTML = nwPanel(); panel.classList.remove('swap'); void panel.offsetWidth; panel.classList.add('swap');
}

// The week on the charts: each of the UK's top 10 shows (or films) as a line through its place each day of the last
// week (trail.json), ending at its poster. Point at a title or its line to follow it; a title opens its sheet.
const RACE_C = ['#0a84ff', '#ff375f', '#30d158', '#bf5af2', '#ff9f0a', '#00c7be', '#5e5ce6', '#ff453a', '#32ade6', '#ffcc00'];
function raceRows(type) {
  const t = state.trail, top = (state.trending?.overall?.[type] || []).slice(0, 10);
  if (!t?.days || t.days.length < 3 || top.length < 3) return null;
  const n = Math.min(8, t.days.length), since = fmtDate(new Date(t.days.at(-n) + 'T12:00:00'), { weekday: 'long' });
  return { days: t.days.slice(-n), rows: top.map((it, i) => {
    const k = `${type === 'movie' ? 'm' : 't'}${it.id}`, tr = t.items?.[k], d = tr?.c === `all:${type}` ? tr.d.slice(-n) : Array(n).fill(0);
    d[n - 1] = i + 1;
    const was = d[0], dir = !was ? 'new' : was > i + 1 ? 'up' : was < i + 1 ? 'down' : 'same';
    const move = { new: 'New this week', up: `Up ${was - i - 1} since ${since}`, down: `Down ${i + 1 - was} since ${since}`, same: 'Steady all week' }[dir];
    return { k, it, d, rank: i + 1, move, dir };
  }) };
}
function nwRace() {
  const r = raceRows(NW.race) || raceRows(NW.race = NW.race === 'tv' ? 'movie' : 'tv'); if (!r) return '';
  return `<section class="wk race" id="nwRace" aria-labelledby="raceH">
    <div class="wk-hd race-hd"><h2 class="row-h" id="raceH">The Week on the Charts</h2><p>How the UK's top 10 moved, day by day</p>
      <label class="dd dd-kind race-dd"><span class="dd-l" id="raceL">${NW.race === 'movie' ? 'Films' : 'Shows'}</span><span class="dd-chev" aria-hidden="true"></span>
        <select id="raceKind" aria-label="Shows or films"><option value="tv"${NW.race === 'tv' ? ' selected' : ''}>Shows</option><option value="movie"${NW.race === 'movie' ? ' selected' : ''}>Films</option></select></label></div>
    <div class="race-box" id="raceBox">${raceInner(r)}</div></section>`;
}
function raceInner(r) {
  const last = r.days.length - 1;
  return `<div class="race-g" id="raceG">
    <ol class="race-ranks" aria-hidden="true">${r.rows.map((x) => `<li>${x.rank}</li>`).join('')}</ol>
    <div class="race-plot" id="racePlot"><svg class="race-svg" id="raceSvg" aria-hidden="true"></svg>
      <div class="race-days" aria-hidden="true">${r.days.map((d, i) => `<span>${i === last ? 'Today' : `<b>${esc(fmtDate(new Date(d + 'T12:00:00'), { weekday: 'short' }))}</b><i>${esc(fmtDate(new Date(d + 'T12:00:00'), { weekday: 'narrow' }))}</i>`}</span>`).join('')}</div></div>
    <ol class="race-list">${r.rows.map((x, i) => `<li style="--c:${RACE_C[i]};--i:${i}" data-k="${x.k}"><a href="${esc(tmdbUrl(x.it.type, x.it.id))}" target="_blank" rel="noopener" ${reg(infoFor(x.it, x.it.type, `No. ${x.rank} ${x.it.type === 'movie' ? 'film' : 'show'} in the UK`))}
      aria-label="${esc(`No. ${x.rank}, ${x.it.title}. ${x.move}`)}">
      ${x.it.poster ? `<img src="${esc(thumb(x.it.poster))}" alt="" loading="lazy" decoding="async">` : `<span class="cl-ph" style="background:hsl(${hue(x.it.title)} 45% 35%)"></span>`}
      <span class="race-t"><b>${esc(x.it.title)}</b><small class="mv-${x.dir}">${esc(x.move)}</small></span></a></li>`).join('')}</ol></div>`;
}
// the lines themselves, drawn to the plot's real size (and again whenever it changes)
function raceDraw() {
  const plot = $('#racePlot'), svg = $('#raceSvg'), r = raceRows(NW.race); if (!plot || !svg || !r) return;
  const W = plot.clientWidth, rh = $('#raceG .race-list li')?.offsetHeight || 52, H = rh * 10.8, n = r.days.length;
  const x = (i) => 8 + i * (W - 14) / (n - 1), y = (v) => (v ? (v - .5) * rh : H).toFixed(1);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.innerHTML = `<g class="race-grid">${r.rows.map((_, i) => `<line x1="0" x2="${W}" y1="${(i + .5) * rh}" y2="${(i + .5) * rh}"/>`).join('')}</g>`
    + r.rows.map((row, i) => {
      const first = Math.max(0, row.d.findIndex((v) => v) - 1);
      let d = `M${x(first).toFixed(1)} ${y(row.d[first])}`;
      for (let j = first + 1; j < n; j++) { const mx = ((x(j - 1) + x(j)) / 2).toFixed(1); d += ` C${mx} ${y(row.d[j - 1])} ${mx} ${y(row.d[j])} ${x(j).toFixed(1)} ${y(row.d[j])}`; }
      const dots = row.d.map((v, j) => v && j < n - 1 ? `<circle class="race-dot" cx="${x(j).toFixed(1)}" cy="${y(v)}" r="3.5"/>` : '').join('');
      return `<g class="race-ln" data-k="${row.k}" style="--c:${RACE_C[i]};--i:${i}"><path class="race-hit" d="${d}"/><path class="race-line" d="${d}" pathLength="1"/>${dots}<circle class="race-end" cx="${x(n - 1).toFixed(1)}" cy="${y(row.d[n - 1])}" r="5"/></g>`;
    }).reverse().join('');   // No. 1 drawn last, so it sits on top
}
function raceHl(k) {
  const g = $('#raceG'); if (!g) return;
  g.classList.toggle('hl', !!k);
  g.querySelectorAll('[data-k]').forEach((el) => el.classList.toggle('on', el.dataset.k === k));
}
function raceMount() {
  NW.ro?.disconnect(); const plot = $('#racePlot'); if (!plot) return;
  raceDraw(); NW.ro = new ResizeObserver(() => raceDraw()); NW.ro.observe(plot);
}

// Last chance: what's leaving the services soon, a row of posters, each counting down
function nwLeaving(leaving, today) {
  if (!leaving.length) return '';
  const left = (d) => { const n = Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 864e5); return n <= 0 ? 'Last day' : n === 1 ? '1 day left' : `${n} days left`; };
  return `<section class="wk" id="leaving" aria-labelledby="lvH"><div class="wk-hd"><h2 class="row-h" id="lvH">Last Chance</h2><p>Leaving the services soon</p></div>
    <ul class="nr">${leaving.map((x) => {
      const s = svc(x.service), on = fmtDate(new Date(x.date + 'T12:00:00'), { weekday: 'short', day: 'numeric', month: 'short' });
      const inner = `<span class="nr-art">${x.poster ? `<img src="${esc(x.poster)}" alt="" loading="lazy" decoding="async">` : placeholder(x)}<span class="cu-when lv-when">${esc(left(x.date))}</span></span>
        <b>${esc(x.title)}</b><small>${esc(`${s?.label || 'Streaming'} · ${on}`)}</small>`;
      return `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener" ${reg(infoFor(x, x.type, `Leaving ${s?.label || 'streaming'} ${on}`, s ? [s] : []))}>${inner}</a>` : `<span>${inner}</span>`}</li>`;
    }).join('')}</ul></section>`;
}

// once the page is drawn: the chosen day in the middle of the ribbon, the chart's lines drawing in as it comes into
// view, the numbers counting up, and each new part introducing itself once
function nwMount() {
  NW.io?.disconnect();
  if ($('#rbTrack')) pickDay(NW.day, 'auto');
  raceMount();
  const g = $('#raceG'), counts = view.querySelectorAll('[data-count]');
  if (reduceMotion()) g?.classList.add('in');
  else {
    NW.io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return; NW.io.unobserve(e.target);
      if (e.target === g) g.classList.add('in'); else countUp(e.target);
    }), { threshold: .25 });
    if (g) NW.io.observe(g); counts.forEach((b) => NW.io.observe(b));
  }
  const tip = window.tn.tip;
  if ($('.nw-stats')) tip({ id: 'new-week-numbers', for: '.nw-stats', title: 'The week in numbers', text: 'What arrived, what’s on the way, the new No. 1s and what’s about to leave. Tap a number to jump straight to it.' });
  if ($('#rbTrack')) tip({ id: 'new-day-by-day', for: '#rbTrack', title: 'Day by day', text: 'Swipe along the days, or use the arrows. Pick one to see what landed on the services that day, or what’s on the way, with a calendar reminder for anything ahead.' });
  if (g) tip({ id: 'new-chart-race', for: '#raceBox', title: 'The week on the charts', text: 'Each line is one of the UK’s top 10, traced through its place each day this week. Point at a title or its line to follow it, and tap a title to see where to watch.' });
}
function countUp(b) {
  const to = +b.dataset.count, t0 = performance.now(), dur = 900 + Math.min(600, to * 20);
  const step = (t) => { const p = Math.min(1, (t - t0) / dur); b.textContent = Math.round(to * (1 - Math.pow(1 - p, 4))); if (p < 1) requestAnimationFrame(step); };
  b.textContent = '0'; requestAnimationFrame(step);
}
view.addEventListener('click', (e) => {
  const day = e.target.closest('.rb-day'); if (day) { pickDay(day.dataset.day); return; }
  const c = e.target.closest('[data-rb]'); if (!c) return;
  if (c.dataset.rb === 'today') { const t = NW.today; pickDay(NW.days.get(t)?.length ? t : [...NW.days.keys()].sort().find((d) => d > t && NW.days.get(d).length) || t); return; }
  const track = $('#rbTrack'); track?.scrollBy({ left: +c.dataset.rb * track.clientWidth * .7, behavior: reduceMotion() ? 'auto' : 'smooth' });
});
view.addEventListener('keydown', (e) => {
  const b = e.target.closest?.('.rb-day'); if (!b) return;
  const all = [...view.querySelectorAll('.rb-day')], i = all.indexOf(b);
  const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key]; if (k === undefined) return;
  e.preventDefault(); const n = all[Math.max(0, Math.min(all.length - 1, k))]; n.focus({ preventScroll: true }); pickDay(n.dataset.day);
});
view.addEventListener('change', (e) => {
  if (e.target.id !== 'raceKind') return;
  NW.race = e.target.value; $('#raceL').textContent = NW.race === 'movie' ? 'Films' : 'Shows';
  const r = raceRows(NW.race), box = $('#raceBox'); if (!r || !box) return;
  box.innerHTML = raceInner(r); raceMount();
  const g = $('#raceG'); if (reduceMotion()) g.classList.add('in'); else requestAnimationFrame(() => requestAnimationFrame(() => g.classList.add('in')));
});
view.addEventListener('pointerover', (e) => { const k = e.target.closest?.('#raceG [data-k]')?.dataset.k; if (k) raceHl(k); });
view.addEventListener('pointerout', (e) => { if (e.target.closest?.('#raceG') && !e.relatedTarget?.closest?.('#raceG [data-k]')) raceHl(null); });
view.addEventListener('focusin', (e) => { if (e.target.closest?.('#raceG')) raceHl(e.target.closest('[data-k]')?.dataset.k || null); });
// New: the week on the charts (the No. 1s, the biggest climbers, new arrivals), then new on the services, coming soon
// and leaving soon. All in the homepage's styles: rows of posters and the chart list.
function pageNew() {
  const f = state.fresh, w = state.week, today = todayIso();
  calItems = [];
  const sec = (id, title, sub, inner) => inner ? `<section class="wk" aria-labelledby="${id}"><div class="wk-hd"><h2 class="row-h" id="${id}">${title}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${inner}</section>` : '';
  let charts = '';
  if (w && (w.climbers?.length || w.ones?.length)) {
    const ones = (w.ones || []).filter((x, i, all) => w.items[x.k] && all.findIndex((y) => y.k === x.k) === i);   // once each, its biggest chart first
    const climbers = (w.climbers || []).filter((x) => w.items[x.k]);
    charts = sec('wk-1', 'The No. 1s', 'Top of each chart right now, and for how long', ones.length ? `<ul class="nr">${ones.map((x) => weekCard(x, `${x.fresh ? 'New No. 1 ' : 'No. 1 '}${chartName(x.c)}${x.days > 1 ? ` · ${x.days} days` : ''}`)).join('')}</ul>` : '')
      + sec('wk-2', 'Biggest Climbers', `Up the most places ${sinceText(w)}`, climbers.length ? `<ol class="cl nw-cl">${climbers.map((x) => {
        const it = w.items[x.k];
        return `<li><a href="${esc(tmdbUrl(it.type, it.id))}" target="_blank" rel="noopener" ${reg(weekInfo(x, `Up ${x.by} to No. ${x.to} ${chartName(x.c)}`))}>
          ${it.poster ? `<img src="${esc(thumb(it.poster))}" alt="" loading="lazy" decoding="async">` : `<span class="cl-ph" style="background:hsl(${hue(it.title)} 45% 35%)"></span>`}
          <span class="cl-t"><b>${esc(it.title)}</b><small>No. ${x.from} → No. ${x.to} ${esc(chartName(x.c))}</small></span>
          ${window.tn.climb(x.by)}</a></li>`; }).join('')}</ol>` : '')
      + sec('wk-3', 'New Arrivals', `In the UK's top 10 now, nowhere in the charts ${w.days >= 6 ? 'a week ago' : 'before'}`, w.arrivals?.length ? `<ul class="nr">${w.arrivals.map((x) => weekCard(x, `New at No. ${x.to} ${chartName(x.c)}`)).join('')}</ul>` : '');
  }
  // At the cinema: what's showing in UK cinemas, then what's coming (each with its UK date and certificate)
  const c = state.cinema, inCinemas = (c?.now || []).filter((x) => x.date <= today), toCinemas = (c?.soon || []).filter((x) => x.date > today);
  const out = (x) => fmtDate(new Date(x.date + 'T12:00:00'), { day: 'numeric', month: 'short' });
  const filmCard = (x, sub, badge) => `<li><a href="${esc(tmdbUrl('movie', x.id))}" target="_blank" rel="noopener" ${reg(infoFor(x, 'movie', badge ? `In cinemas ${out(x)}` : 'In cinemas now'))}>
    <span class="nr-art">${x.poster ? `<img src="${esc(x.poster)}" alt="" loading="lazy" decoding="async">` : placeholder(x)}${badge ? `<span class="cu-when">${esc(badge)}</span>` : ''}</span>
    <b>${esc(x.title)}</b><small>${esc(sub)}</small></a></li>`;
  const cinema = sec('cinema', 'At the Cinema', 'Showing in UK cinemas now', inCinemas.length ? `<ul class="nr">${inCinemas.map((x) => filmCard(x, [x.cert, `Out ${out(x)}`].filter(Boolean).join(' · '))).join('')}</ul>` : '')
    + sec('cinema-soon', 'Coming to Cinemas', 'Out in the UK over the next three months', toCinemas.length ? `<ul class="nr">${toCinemas.map((x) => filmCard(x, [x.cert, out(x)].filter(Boolean).join(' · '), window.tn.whenText(x.date))).join('')}</ul>` : '');
  const leaving = f && !f.disabled && !f.error ? (f.leaving || []).filter((x) => x.date >= today) : [];
  const ribbon = nwRibbon(f, today), race = nwRace();
  if (!charts && !ribbon && !cinema && !race) return `<h1 class="large-title page-title">New <em class="grad">This Week</em></h1>
    <div class="empty"><span class="empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10.5 3.5l1.8 4.9 4.9 1.8-4.9 1.8-1.8 4.9-1.8-4.9-4.9-1.8 4.9-1.8z" fill="currentColor"/><path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" fill="currentColor"/></svg></span>
      <h2>${f?.error ? 'Back shortly' : 'Building up'}</h2><p>${f?.error ? "This week's round-up didn't load this time. It'll be back after the next hourly update." : 'The week fills in as Tenner keeps an eye on the charts and the services. Check back tomorrow.'}</p>
      <a class="btn btn-tinted" href="./"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.4 12 4l8 6.4V20h-5v-5.6H9V20H4z" fill="currentColor"/></svg>See the top 10</a></div>`;
  return `<h1 class="large-title page-title">New <em class="grad">This Week</em></h1>
    <p class="lede">${w?.climbers?.length ? `What moved on the UK's charts ${esc(sinceText(w))}, and what's new on the services.` : 'What’s new on the services.'} Rebuilt every hour; a few UK dates may differ from the US listings they come from.</p>
    ${state.trending.sample ? `<p class="notice"><strong>Sample data.</strong> These titles are made up.</p>` : ''}
    ${nwStats(f, w, today, leaving)}${ribbon}${race}${charts}${nwLeaving(leaving, today)}${cinema}`;
}
// Add to Calendar: an all-day event on the day it arrives, as a calendar file (the iPhone and Mac open it in Calendar)
function calendarFile(x) {
  const s = svc(x.service), d = x.date.replace(/-/g, ''), end = new Date(Date.parse(x.date + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  const k = x.id ? `${x.type === 'movie' ? 'm' : 't'}${x.id}` : x.title.replace(/\W+/g, '-').toLowerCase();
  const what = `${x.title}${x.season ? ` season ${x.season}` : ''}`, on = s?.label || 'streaming';
  const link = x.id ? `https://tenner.stream/?t=${k}` : 'https://tenner.stream/#new';
  const fold = (line) => line.replace(/(.{72})/g, '$1\r\n ').replace(/\r\n $/, '');
  const txt = (t) => t.replace(/[\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tenner//Coming soon//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${k}-${d}@tenner.stream`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${end}`,
    fold(`SUMMARY:${txt(`${what} on ${on}`)}`), fold(`DESCRIPTION:${txt(`${what} arrives on ${on} today. Where to watch: ${link}`)}`), `URL:${link}`,
    'TRANSP:TRANSPARENT', 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${txt(`${what} is on ${on} today`)}`, 'TRIGGER:PT9H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
view.addEventListener('click', (e) => {
  const j = e.target.closest('[data-jump]');
  if (j) { e.preventDefault(); if (j.dataset.day) pickDay(j.dataset.day); $(`#${j.dataset.jump}`)?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }); return; }
  const b = e.target.closest('[data-cal]'); if (!b) return;
  const x = calItems[+b.dataset.cal]; if (!x) return;
  const url = `data:text/calendar;charset=utf-8,${encodeURIComponent(calendarFile(x))}`, a = document.createElement('a');
  a.href = url;
  if (!/iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) a.download = `${x.title.replace(/[^\w ]+/g, '').trim() || 'Tenner'}.ics`;   // iPhone and iPad: Safari opens it straight into Calendar
  document.body.append(a); a.click(); a.remove();
  toast(a.download ? `Downloaded: open it to put ${x.title} in your calendar` : `Opening Calendar for ${x.title}`);
});

let toastTimer;
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- tabs (pages): Home, New, Browse, Discover (phones), Watchlist, About. The bar itself lives in shell.js ----------
const selectTab = (name) => window.tnShell.select(name);
function openTab(name) {
  if (['home', 'about', 'browse', 'discover'].includes(name)) window.tn.loading.show('nav');   // another page: the ring, should it be slow
  if (name === 'home') { location.href = './'; return; }
  if (name === 'about') { location.href = 'about.html'; return; }
  if (name === 'browse') { location.href = 'browse.html'; return; }
  if (name === 'discover') { location.href = 'discover.html'; return; }   // Discover (phones)
  if (name === state.route) { scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); return; } // tap the open tab: back to the top
  if (name === 'new' || name === 'watchlist') location.hash = name; else location.href = './';
}
window.tnOnTab = openTab;

addEventListener('hashchange', () => { route(); scrollTo(0, 0); });
addEventListener('popstate', () => state.trending && openFromUrl());   // Forward to a title you'd closed opens it again
load();

// a link shared to Tenner from another app (the manifest's share_target, once it's on the Home Screen): an IMDb,
// Letterboxd, JustWatch or TMDB link, or just a name. Tenner finds the title and opens its sheet, ready to save
{
  const p = new URL(location.href).searchParams;
  if (!p.get('t') && (p.get('url') || p.get('text') || p.get('title'))) {
    const u = new URL(location.href); for (const k of ['url', 'text', 'title']) u.searchParams.delete(k); history.replaceState(null, '', u);
    window.tn.sharedTitle(p).then((x) => {
      if (!x?.k) { toast('Tenner couldn’t find that title'); return; }
      const v = new URL(location.href); v.searchParams.set('t', x.k); history.replaceState(null, '', v);
      if (state.trending) openFromUrl();
    });
  }
}

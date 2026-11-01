// Tenner's New This Week (#new) and Watchlist (#watchlist) pages. The Top 10 lives on the home page (home.js), and
// anything else here goes there. Reads data/trending.json and data/new.json (rebuilt hourly by GitHub Actions).
// Shared helpers (esc, hue) come from shell.js, which loads first.

const { esc, hue, reduce: reduceMotion } = window.tn;
const state = { trending: null, fresh: null, route: 'new' };
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const fmtDate = (d, opts) => d.toLocaleDateString('en-GB', opts);
const pad = (n) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };   // today's date where you are

// ---------- data ----------
async function fetchData(bust) {
  const v = `?v=${bust ? Date.now() : Math.floor(Date.now() / 600000)}`;
  const [trending, fresh, cat, week, cinema] = await Promise.all([
    fetch('data/trending.json' + v, { cache: bust ? 'no-store' : 'default' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    fetch('data/new.json' + v).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch('data/browse.json' + v).then((r) => (r.ok ? r.json() : null)).catch(() => null),   // for "Top rated at a glance"
    fetch('data/week.json' + v).then((r) => (r.ok ? r.json() : null)).catch(() => null),     // for "This Week"
    fetch('data/cinema.json' + v).then((r) => (r.ok ? r.json() : null)).catch(() => null),   // New: at the cinema
  ]);
  return { trending, fresh, cat, week, cinema };
}

async function load() {
  try {
    Object.assign(state, await fetchData(false));
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
    if (changed) { const y = scrollY; Object.assign(state, d, { cat: d.cat || state.cat, week: d.week || state.week }); render(); requestAnimationFrame(() => scrollTo(0, y)); }
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
  if (!document.startViewTransition || reduceMotion || !view.firstElementChild || view.querySelector('.loading')) { fn(); return; }
  document.startViewTransition(fn).ready.catch(() => {});   // a newer change can cut one short: that's fine
}
function draw() {
  selectTab(state.route);
  if (state.route === 'watchlist') { shown = new Map(); hideBanners(); view.innerHTML = `<div class="wrap">${pageWatchlist()}</div>`; document.title = 'Watchlist | Tenner'; wlKindInit(); openFromUrl(); wantTitles(); alertCard(); return; }
  shown = new Map(); view.innerHTML = `<div class="wrap">${pageNew()}</div>`; newBanners((state.fresh?.items || []).filter((x) => x.date <= todayIso())); document.title = 'New This Week | Tenner'; openFromUrl();
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
      <span class="mb-copy"><span class="mb-badge">${esc(badge)}</span><b class="mb-title">${esc(x.title)}</b><span class="mb-meta">${esc([what, x.original ? `${s?.label} original` : ''].filter(Boolean).join(' · '))}</span></span></a>`;
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
window.tnSheet?.hover?.('a[data-sheet]:not(.h-cta, .mb-card)', (a) => shown.get(a.dataset.sheet));   // every title, bar the hero's own button
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
    if (reduceMotion || !box.animate) return done();
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
        ${art}<span class="cl-t"><b>${esc(x.title)}</b><small>${esc(what)}</small>${showLine(x)}</span>${on ? `<span class="wl-on">${on}</span>` : ''}</a>
      <button type="button" class="wl-x" data-unsave="${esc(x.k)}" aria-label="Remove ${esc(x.title)} from your Watchlist" title="Remove">${X}</button></li>`;
  }).join('');
  const both = list.some((x) => x.type === 'movie') && list.some((x) => x.type !== 'movie');
  const body = !list.length
    ? `<div class="empty"><span class="empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h12v18.4l-6-4.2-6 4.2z" fill="currentColor"/></svg></span>
        <h2>Nothing saved yet</h2><p>Open any title and press Watchlist to keep it here, with where to watch it.</p>
        <a class="btn btn-tinted" href="#top">See the top 10</a></div>`
    : `<section class="wk" aria-labelledby="wl-saved"><div class="row-hd wl-hd"><h2 class="row-h" id="wl-saved">Saved</h2>${both ? `<label class="dd dd-kind"><span class="dd-l" id="wlKindL">${{ tv: 'Shows', movie: 'Films', both: 'Shows and films' }[kind]}</span><span class="dd-chev" aria-hidden="true"></span>
        <select id="wlKind" aria-label="Shows, films or both">${[['tv', 'Shows'], ['movie', 'Films'], ['both', 'Shows and films']].map(([k, l]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}</div>
      <ol class="cl nw-cl wl-cl" data-kind="${both ? kind : 'both'}">${rows}</ol></section>`;
  return `<h1 class="large-title page-title"><em class="grad">Watchlist</em></h1>
    <p class="lede">${list.length ? `You have <b>${list.length} title${list.length === 1 ? '' : 's'}</b> on your Watchlist. ` : ''}${window.tn.account.user() ? 'Your Watchlist will be anywhere you’re signed in.' : 'It’s saved on this device. <a href="account.html">Sign in</a> to have it anywhere you’re signed in.'}</p>
    ${list.length ? '<div class="wl-alert" id="wlAlert" hidden></div>' : ''}${body}${comingUp(list)}`;
}
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
  const b = e.target.closest('[data-unsave]'); if (!b) return;
  const li = b.closest('li'), next = li.nextElementSibling || li.previousElementSibling, k = b.dataset.unsave;
  const done = () => { window.tn.saved.remove(k); requestAnimationFrame(() => $(`[data-unsave="${CSS.escape(next?.querySelector('[data-unsave]')?.dataset.unsave || '')}"]`)?.focus({ preventScroll: true })); };
  if (reduceMotion || !li.animate) return done();
  b.disabled = true;
  li.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.9)', filter: 'blur(6px)' }], { duration: 260, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' }).finished.then(done, done);
});
// saving or removing (here, in a sheet or in another tab) redraws the Watchlist and the row
addEventListener('tn:sheet-closed', () => { if (state.savedDirty) { state.savedDirty = false; const y = scrollY; draw(); scrollTo(0, y); } });
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
function dayGroups(list, mode, today) {
  const days = new Map();
  for (const x of list) days.set(x.date, [...(days.get(x.date) || []), x]);
  const tomorrow = new Date(Date.parse(today + 'T12:00:00') + 864e5).toISOString().slice(0, 10);
  return [...days].map(([d, items]) => `<section class="group">
    <h2 class="${d === today ? 'today' : ''}">${d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : esc(fmtDate(new Date(d + 'T12:00:00'), { weekday: 'long', day: 'numeric', month: 'long' }))}</h2>
    <ul class="cl nw-cl">${items.map((x) => newItem(x, mode)).join('')}</ul></section>`).join('');
}
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
          <span class="mv up">▲${x.by}</span></a></li>`; }).join('')}</ol>` : '')
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
  let releases = '', soon = [], leaving = [];
  if (f && !f.disabled && !f.error) {
    const past = f.items.filter((x) => x.date <= today).reverse();   // newest first
    soon = f.items.filter((x) => x.date > today);
    leaving = (f.leaving || []).filter((x) => x.date >= today);
    releases = sec('released', 'New on the Services', 'Arriving over the last seven days', past.length ? dayGroups(past, 'new', today) : '<p class="nw-none">Nothing new on these services this week.</p>')
      + sec('soon', 'Coming Soon', 'The next month. Tap the calendar to be reminded on the day', soon.length ? dayGroups(soon, 'soon', today) : '')
      + sec('leaving', 'Leaving Soon', 'Catch them before they go', leaving.length ? dayGroups(leaving, 'leaving', today) : '');
  }
  if (!charts && !releases && !cinema) return `<h1 class="large-title page-title">New <em class="grad">This Week</em></h1>
    <div class="empty"><span class="empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10.5 3.5l1.8 4.9 4.9 1.8-4.9 1.8-1.8 4.9-1.8-4.9-4.9-1.8 4.9-1.8z" fill="currentColor"/><path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" fill="currentColor"/></svg></span>
      <h2>${f?.error ? 'Back shortly' : 'Building up'}</h2><p>${f?.error ? "This week's round-up didn't load this time. It'll be back after the next hourly update." : 'The week fills in as Tenner keeps an eye on the charts and the services. Check back tomorrow.'}</p>
      <a class="btn btn-tinted" href="#top">See the top 10</a></div>`;
  const jumps = [['cinema', 'At the cinema', inCinemas.length || toCinemas.length], ['released', 'New on the services', releases.includes('id="released"')], ['soon', 'Coming soon', soon.length], ['leaving', 'Leaving soon', leaving.length]]
    .filter((j) => j[2] && charts).map(([id, label]) => `<a class="nw-jump" href="#${id}" data-jump="${id}">${label}<span class="chev" aria-hidden="true"></span></a>`).join('');
  return `<h1 class="large-title page-title">New <em class="grad">This Week</em></h1>
    <p class="lede">${w?.climbers?.length ? `What moved on the UK's charts ${esc(sinceText(w))}, and what's new on the services. Rebuilt every hour.` : 'What’s new on the services, rebuilt every hour.'} Release dates come from US listings, so a few UK dates may differ.</p>
    ${jumps ? `<div class="nw-jumps">${jumps}</div>` : ''}
    ${state.trending.sample ? `<p class="notice"><strong>Sample data.</strong> These titles are made up.</p>` : ''}
    ${charts}${cinema}${releases}`;
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
  if (j) { e.preventDefault(); $(`#${j.dataset.jump}`)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); return; }
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

// ---------- tabs (pages): Home, New, Browse, Discover (phones), Cast & Crew, Watchlist, About. The bar itself lives in shell.js ----------
const selectTab = (name) => window.tnShell.select(name);
function openTab(name) {
  if (name === 'home') { location.href = './'; return; }
  if (name === 'about') { location.href = 'about.html'; return; }
  if (name === 'browse') { location.href = 'browse.html'; return; }
  if (name === 'people') { location.href = 'people.html'; return; }   // Cast & Crew
  if (name === 'discover') { location.href = 'discover.html'; return; }   // Discover (phones)
  if (name === state.route) { scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); return; } // tap the open tab: back to the top
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

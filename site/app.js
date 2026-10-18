// Tenner's chart pages. Reads data/trending.json and data/new.json (rebuilt hourly by GitHub Actions).
// Routes: #top (all services), #netflix, #disney … (one service), #store (buy or rent), #new (new releases).
// Shared helpers (esc, hue, glide, arrows) come from shell.js, which loads first.

const { esc, hue, glide, arrows, reduce: reduceMotion } = window.tn;
const state = { trending: null, fresh: null, kind: 'tv', route: 'top' };
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const KIND_WORDS = { tv: 'Shows', movie: 'Films', both: 'Shows and Films' };
const words = (k = state.kind) => KIND_WORDS[k] || 'Shows';
const fmtDate = (d, opts) => d.toLocaleDateString('en-GB', opts);
const fmtTime = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const pad = (n) => String(n).padStart(2, '0');

// ---------- data ----------
async function fetchData(bust) {
  const v = `?v=${bust ? Date.now() : Math.floor(Date.now() / 600000)}`;
  const [trending, fresh, cat] = await Promise.all([
    fetch('data/trending.json' + v, { cache: bust ? 'no-store' : 'default' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    fetch('data/new.json' + v).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch('data/browse.json' + v).then((r) => (r.ok ? r.json() : null)).catch(() => null),   // for "Top rated at a glance"
  ]);
  return { trending, fresh, cat };
}

async function load() {
  try {
    Object.assign(state, await fetchData(false));
  } catch (err) {
    view.innerHTML = `<div class="wrap"><h1 class="large-title">The chart didn't load</h1>
      <p class="lede">${esc(err.message)}. If you've just set the site up, run the "Update and deploy" workflow once, then refresh.</p></div>`;
    return;
  }
  try { const k = localStorage.getItem('tenner-kind'); if (k in KIND_WORDS) state.kind = k; } catch {}

  buildServiceBar();
  showUpdated();
  route();
}

const services = () => state.trending.services;
const svc = (k) => services().find((s) => s.key === k);

// ---------- the service bar: each service as its own app icon in a glass capsule, a pill gliding to the chosen one ----------
const ICON_STORE = '<span class="svc-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 8h12l-1 12.5H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>';
function buildServiceBar() {
  const bar = $('#svc');
  const item = (key, label, icon, extra = '') =>
    `<button type="button" role="radio" class="svc-b${extra}${icon ? '' : ' txt'}" data-svc="${key}" aria-checked="false" tabindex="-1">${icon ? `<span class="svc-ic">${icon}</span>` : ''}<span class="svc-l">${esc(label)}</span></button>`;
  const iconFor = (s) => s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy">` : `<span class="svc-glyph">${esc(s.label[0])}</span>`;
  bar.insertAdjacentHTML('beforeend',
    item('top', 'All', '') +   // just the word, to keep the bar clean
    services().filter((s) => !s.store).map((s) => item(s.key, s.label, iconFor(s))).join('') +
    services().filter((s) => s.store).map((s) => `<span class="svc-sep" aria-hidden="true"></span>` + item(s.key, s.label, ICON_STORE, ' store')).join(''));
  bar.addEventListener('click', (e) => { const b = e.target.closest('.svc-b'); if (b) location.hash = b.dataset.svc; });
  arrows(bar, () => [...bar.querySelectorAll('.svc-b')], (n) => { location.hash = n.dataset.svc; });
  // fade whichever end has more to scroll to
  const edges = () => { const w = bar.parentElement;
    w.classList.toggle('at-start', bar.scrollLeft < 4); w.classList.toggle('at-end', bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 4); };
  bar.addEventListener('scroll', edges, { passive: true });
  addEventListener('resize', () => { placeSvc(false); edges(); });
  requestAnimationFrame(edges);
}
let svcPlaced = false;
const placeSvc = (animate) => glide($('#svcInd'), $('.svc-b[aria-checked="true"]'), animate);
function markService(key) {
  document.querySelectorAll('.svc-b.store, .svc-sep').forEach((el) => { el.hidden = state.kind !== 'movie'; });
  let chosen;
  document.querySelectorAll('.svc-b').forEach((b) => { const on = b.dataset.svc === key; b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; if (on) chosen = b; });
  placeSvc(svcPlaced);
  // keep the chosen one in view if the bar scrolls (narrow windows)
  const bar = $('#svc');
  if (chosen && bar.scrollWidth > bar.clientWidth) {
    const target = chosen.offsetLeft - (bar.clientWidth - chosen.offsetWidth) / 2;
    bar.scrollTo({ left: Math.max(0, target), behavior: !svcPlaced || reduceMotion ? 'auto' : 'smooth' });
  }
  svcPlaced = true;
}

// ---------- phones: the service bar as a pull-down menu ----------
const ddPop = $('#ddPop'), ddList = $('#ddList');
let ddBtn = null;
const iconOf = (key) => key === 'top' ? '' : key === 'store' ? ICON_STORE
  : svc(key)?.logo ? `<img src="${esc(svc(key).logo)}" alt="">` : `<span class="svc-glyph">${esc(svc(key)?.label[0] || '')}</span>`;
function ddItems() {
  const keys = ['top', ...services().filter((x) => !x.store).map((x) => x.key), ...(state.kind === 'movie' ? services().filter((x) => x.store).map((x) => x.key) : [])];
  return keys.map((k) => ({ act: () => { location.hash = k; }, on: state.route === k, label: k === 'top' ? 'All services' : svc(k).label, icon: iconOf(k), sep: k === 'store' }));
}
function ddClose(focus) {
  if (!ddBtn) return;
  const btn = ddBtn; ddBtn = null; btn.setAttribute('aria-expanded', 'false');
  if (focus) btn.focus({ preventScroll: true });
  if (reduceMotion) { ddPop.hidden = true; return; }
  ddPop.classList.add('out');
  setTimeout(() => { if (!ddBtn) { ddPop.hidden = true; ddPop.classList.remove('out'); } }, 190);
}
function ddOpen(btn) {
  if (ddBtn === btn) { ddClose(); return; }
  ddBtn = btn; btn.setAttribute('aria-expanded', 'true');
  const items = ddItems();
  ddList.innerHTML = items.map((it, i) => `${it.sep ? '<div class="dd-sep" role="separator"></div>' : ''}<button type="button" role="menuitemradio" aria-checked="${it.on}" data-i="${i}">${it.icon ? `<i>${it.icon}</i>` : ''}<span><b>${esc(it.label)}</b></span><em aria-hidden="true"></em></button>`).join('');
  ddList.onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; ddClose(); items[b.dataset.i].act(); };
  ddPop.classList.remove('out'); ddPop.hidden = false;
  const r = btn.getBoundingClientRect(), w = ddPop.offsetWidth, left = Math.max(12, Math.min(r.left, innerWidth - w - 12));
  ddPop.style.left = left + 'px'; ddPop.style.top = r.bottom + 8 + 'px';
  ddPop.style.maxHeight = Math.max(200, innerHeight - r.bottom - 120) + 'px';   // clear of the tab bar
  ddPop.style.setProperty('--tb-o', `${r.left + r.width / 2 - left}px -14px`);    // it grows out of its own button
  ddList.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
}
document.querySelectorAll('.dd').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ddOpen(b); }));
document.addEventListener('click', (e) => { if (ddBtn && !ddPop.contains(e.target)) ddClose(); });
addEventListener('keydown', (e) => { if (ddBtn && e.key === 'Escape') ddClose(true); });
arrows(ddList, () => [...ddList.querySelectorAll('button')]);   // arrow keys move through the menu
addEventListener('resize', () => ddClose());
addEventListener('scroll', () => ddClose(), { passive: true });
function markDropdowns() {
  $('#svcDD .dd-l').textContent = state.route === 'top' ? 'All services' : svc(state.route)?.label || 'All services';
  const ic = iconOf(state.route); $('#svcDD .dd-ic').innerHTML = ic; $('#svcDD .dd-ic').hidden = !ic;
}

// ---------- "Updated … ago" ----------
const narrow = matchMedia('(max-width: 560px)');
function agoText(iso) {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000), h = Math.floor(mins / 60);
  if (narrow.matches) { // phones: the short form, so the line stays on one row
    if (mins < 3) return 'Just updated';
    return mins < 60 ? `${mins} min ago` : `${h} hr ago`;
  }
  if (mins < 3) return 'Updated a few moments ago';
  if (mins < 60) return `Updated ${mins} minutes ago`;
  return `Updated ${h} hour${h === 1 ? '' : 's'} ago`;
}
narrow.addEventListener('change', () => state.trending && showUpdated());
function showUpdated() {
  const d = new Date(state.trending.generatedAt);
  const ago = $('#ago'), txt = agoText(state.trending.generatedAt);
  if (ago.textContent !== txt) { ago.textContent = txt; ago.classList.remove('swap'); void ago.offsetWidth; ago.classList.add('swap'); }
  $('#refresh').title = `Last update ${fmtTime(d)}. Tap to check for a newer chart.`;
  $('#updated').textContent = `Chart updated ${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })} at ${fmtTime(d)}. Refreshes every hour.`;
}
setInterval(() => state.trending && showUpdated(), 30000);

// Fetch the latest data and, if it's new, redraw in place (with the usual crossfade), keeping your scroll position.
// Tapping "Updated …" does it with a word of feedback; the background check (from shell.js) does it quietly, and holds
// back while a menu is open or a row is being dragged, trying again next time.
async function refresh(quiet) {
  const btn = $('#refresh');
  if (!state.trending || btn.classList.contains('busy')) return;
  if (quiet && (ddBtn || $('.posters.dragging'))) return;
  if (!quiet) { btn.classList.add('busy'); $('#ago').textContent = 'Checking…'; }
  try {
    const d = await fetchData(true);
    const changed = d.trending.generatedAt !== state.trending.generatedAt || d.fresh?.generatedAt !== state.fresh?.generatedAt;
    if (changed) { const y = scrollY; Object.assign(state, d, { cat: d.cat || state.cat }); render(); requestAnimationFrame(() => scrollTo(0, y)); }
    if (!quiet) toast(changed ? 'New chart loaded' : "You're up to date");
  } catch {
    if (!quiet) toast("Couldn't check right now. Try again in a moment.");   // quietly: the next check catches up
  }
  btn.classList.remove('busy'); showUpdated();
}
$('#refresh').addEventListener('click', () => refresh(false));
addEventListener('tn:check', () => refresh(true));

// ---------- routing ----------
function route() {
  const h = location.hash.slice(1);
  state.route = h === 'new' || h === 'watchlist' || svc(h) ? h : 'top';
  if (svc(state.route)?.store) state.kind = 'movie';
  if (state.route !== 'new' && state.route !== 'watchlist') state.lastChart = state.route;
  render();
}

function render() {
  morph(draw);
}
// Swap the page through a View Transition where the browser has one, so changes crossfade instead of jumping.
function morph(fn) {
  if (!document.startViewTransition || reduceMotion || !view.firstElementChild || view.querySelector('.loading')) { fn(); return; }
  document.startViewTransition(fn);
}
function draw() {
  selectTab(state.route === 'new' || state.route === 'watchlist' ? state.route : 'top');
  document.querySelectorAll('.kind [data-kind]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === state.kind)));
  const isNew = state.route === 'new';
  $('#controls').hidden = isNew || state.route === 'watchlist';
  if (state.route === 'watchlist') { shown = new Map(); setBackdrop(null); view.innerHTML = `<div class="wrap">${pageWatchlist()}</div>`; document.title = 'Watchlist | Tenner'; openFromUrl(); wantTitles(); return; }
  if (isNew) { shown = new Map(); setBackdrop(null); view.innerHTML = `<div class="wrap">${pageNew()}</div>`; document.title = 'New This Week | Tenner'; openFromUrl(); return; }

  markService(state.route); markDropdowns();
  shown = new Map();

  const s = state.route === 'top' ? null : svc(state.route);
  const listOf = (k) => (s ? s[k] : state.trending.overall[k]) || [];
  // "Both" shows the two charts one after the other; the hero takes turns between them
  const kinds = state.kind === 'both' ? ['tv', 'movie'] : [state.kind];
  const zip = (a, b) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a[i], b[i]]).flat().filter(Boolean);
  const ranked = (k) => listOf(k).map((it, i) => ({ it, n: i + 1 }));
  const picks = state.kind === 'both' ? zip(ranked('tv'), ranked('movie')) : ranked(state.kind);
  const list = picks.map((p) => p.it);
  const where = s ? s.label : 'UK streaming';
  $('#heading').textContent = s?.store ? `Top 10 ${words()} to buy or rent` : `Top 10 ${words()}`;
  $('#lede').innerHTML = s?.store ? 'New releases from Apple TV, Sky Store and others'
    : s ? `On ${s.logo ? `<img class="sub-logo" src="${esc(s.logo)}" alt="">` : ''}${esc(s.label)}${s.official ? ` · ${esc(officialLine(s.official))}` : ''}` : 'On all five services in the UK';
  document.title = s ? `${s.label} Top 10 | Tenner` : 'Tenner';

  const chart = list.length
    ? `${state.trending.sample ? `<p class="notice"><strong>Sample data.</strong> These titles are made up. Add your TMDB key and run the workflow to see the real chart.</p>` : ''}
       ${hero(picks, s)}${s?.store ? '' : features(s)}
       ${kinds.map((k, r) => `${kinds.length > 1 ? `<h2 class="row-h kind-h">Top 10 ${words(k)}</h2>` : ''}${posterRow(listOf(k), k, r === 0)}${chartList(listOf(k), s, k)}`).join('')}
       ${s?.store ? '' : savedRow()}${s?.store ? '' : newRow(s)}`
    : `<div class="empty"><h2>Nothing here right now</h2><p>The chart for ${esc(where)} will be back after the next hourly update.</p><a class="btn btn-tinted" href="#top">See all five services</a></div>`;
  view.innerHTML = `<div class="wrap chart">${chart}</div>`;
  openFromUrl();
  setBackdrop(heroOn() && list.length ? list[0] : null);   // the hero's first pick
  wireScroller(); wireRanks();
}

// ---------- computers: the hero, the Sky / Apple TV way ----------
// The chart's top five take turns as a big backdrop on the right that fades into the page on its left and bottom;
// the title, a line about it and a button sit on the faded part, with dots to flip between them. Nothing moves on
// its own, so an idle page still costs nothing. Phones and tablets skip it (and never download the artwork).
const wide = matchMedia('(min-width: 1000px)');
wide.addEventListener('change', () => state.trending && state.route !== 'new' && render());
const heroOn = () => wide.matches;
let heroList = [], heroAt = 0, heroScope = null;
function heroCopy({ it, n }) {
  // on a service's page it's that service's chart; on All it's the UK-wide chart, and the details say where to find it
  const s = heroScope, kind = it.type === 'tv' ? 'show' : 'film';
  const eye = [s?.store ? `No. ${n} to buy or rent` : s ? `No. ${n} ${kind} on ${s.label}` : `No. ${n} ${kind} in the UK`, n === 1 ? topText(it) : ''].filter(Boolean).join(' · ');
  const where = s ? '' : onText(it);
  const bits = [it.season || (it.type === 'tv' ? 'Series' : 'Film'), it.year, it.rating ? `★ ${it.rating.toFixed(1)}` : '', weeksText(it), where ? `On ${where}` : ''].filter(Boolean);
  return `<p class="h-eye">${s?.logo ? `<img src="${esc(s.logo)}" alt="">` : ''}${esc(eye)}</p>
    <h2 class="h-title">${esc(it.title)}</h2>
    <p class="h-meta">${bits.map(esc).join(' · ')}</p>
    ${it.overview ? `<p class="h-blurb">${esc(firstSentence(it.overview))}</p>` : ''}
    <a class="h-cta" href="${esc(it.url)}" target="_blank" rel="noopener" ${reg(infoFor(it, it.type, eye, s && !s.store ? [s] : null))}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>Where to watch</a>`;
}
function hero(picks, s) {   // picks: [{ it, n }] where n is the title's rank in its own chart
  if (!heroOn() || !picks.length) return '';
  heroList = picks.slice(0, 5); heroAt = 0; heroScope = s;
  return `<section class="hero" aria-label="Top of the chart">
    <div class="h-copy" id="heroCopy" aria-live="polite">${heroCopy(heroList[0])}</div>
    ${heroList.length > 1 ? `<div class="h-dots">${heroList.map((p, i) => `<button type="button" data-hero="${i}" aria-label="Number ${p.n}: ${esc(p.it.title)}" title="${esc(p.it.title)}" aria-current="${i === 0}"></button>`).join('')}</div>` : ''}
  </section>`;
}
// The backdrop crossfades: the new picture decodes first, then fades in over the old one, which is then dropped.
let bdKey = null;
function setBackdrop(it) {
  const bd = $('#backdrop'), key = it ? it.backdrop || `ph:${it.title}` : null;
  if (key === bdKey) return; bdKey = key;
  if (!it) { bd.replaceChildren(); $('#bdExt')?.replaceChildren(); return; }
  let layer;
  if (it.backdrop) { layer = new Image(); layer.alt = ''; layer.src = it.backdrop; }
  else { const h = hue(it.title); layer = document.createElement('span'); layer.style.background = `linear-gradient(120deg,hsl(${h} 45% 30%),hsl(${(h + 40) % 360} 55% 12%))`; }
  layer.className = 'bd-l';
  const show = () => {
    if (bdKey !== key) return;   // a newer one was asked for meanwhile
    // the sidebar picks up the artwork's colours through its glass: a mirrored copy sits beneath it
    const ext = $('#bdExt'), mirror = layer.cloneNode(true); mirror.classList.add('in'); ext?.replaceChildren(mirror);
    bd.append(layer);
    if (reduceMotion || bd.children.length === 1) { layer.classList.add('in'); [...bd.children].slice(0, -1).forEach((c) => c.remove()); return; }
    requestAnimationFrame(() => layer.classList.add('in'));
    setTimeout(() => [...bd.children].slice(0, -1).forEach((c) => c.remove()), 700);
  };
  layer.decode ? layer.decode().then(show, show) : show();
}
function showHero(i) {
  if (i === heroAt || !heroList[i]) return;
  heroAt = i;
  document.querySelectorAll('[data-hero]').forEach((b) => b.setAttribute('aria-current', String(Number(b.dataset.hero) === i)));
  const copy = $('#heroCopy');
  const swap = () => { copy.innerHTML = heroCopy(heroList[i]); copy.classList.remove('out'); };
  if (reduceMotion) swap(); else { copy.classList.add('out'); setTimeout(swap, 180); }
  setBackdrop(heroList[i].it);
}
view.addEventListener('click', (e) => { const d = e.target.closest('[data-hero]'); if (d) showHero(Number(d.dataset.hero)); });
view.addEventListener('keydown', (e) => {   // ← → move between the hero's titles when a dot has focus
  const d = e.target.closest?.('[data-hero]'); if (!d || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault(); const i = (heroAt + (e.key === 'ArrowRight' ? 1 : -1) + heroList.length) % heroList.length;
  showHero(i); $(`[data-hero="${i}"]`)?.focus();
});

// Netflix's own chart is weekly (Monday to Sunday); "week" is the Sunday it ends on.
function officialLine(o) {
  const end = new Date(o.week + 'T12:00:00Z'), start = new Date(+end - 6 * 864e5);
  const d = (x, m) => x.toLocaleDateString('en-GB', m ? { day: 'numeric', month: 'short' } : { day: 'numeric' });
  return `Official UK Top 10, ${start.getMonth() === end.getMonth() ? d(start) : d(start, 1)}–${d(end, 1)}`;
}
const weeksText = (it) => it.weeks > 1 ? `${it.weeks} weeks in the Top 10` : it.weeks === 1 ? 'New to the Top 10' : '';

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
// a shared link (?t=m123) opens that title's sheet once the chart has loaded
function openFromUrl() {
  const k = new URL(location.href).searchParams.get('t'); if (!k || window.tnSheet?.isOpen()) return;
  for (const info of shown.values()) if (info.k === k) { window.tnSheet.open(info, true); return; }
  const type = k[0] === 'm' ? 'movie' : 'tv', all = [...services().flatMap((s) => [...(s.tv || []), ...(s.movie || [])]), ...(state.fresh?.items || [])];
  const it = all.find((x) => `${(x.type || type) === 'movie' ? 'm' : 't'}${x.id}` === k);
  if (it) window.tnSheet.open(infoFor(it, it.type || type), true);
}

// ---------- chart movement: ▲ up, ▼ down or NEW since about a day ago (worked out hourly, see fetch-data.mjs) ----------
function since() {
  const t = state.trending?.moveSince; if (!t) return '';
  const h = (Date.now() - Date.parse(t)) / 3600e3;
  return h >= 20 ? 'since yesterday' : `since ${new Date(t).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}`;
}
function moveBadge(it, quietSame) {
  const m = it.mv; if (m === undefined || m === null) return '';
  if (m === 'new') return `<span class="mv new" title="New to this chart ${since()}">NEW</span>`;
  if (m === 0) return quietSame ? '' : `<span class="mv same" title="No change ${since()}" aria-label="No change">–</span>`;
  const up = m > 0, n = Math.abs(m);
  return `<span class="mv ${up ? 'up' : 'down'}" title="${up ? 'Up' : 'Down'} ${n} place${n === 1 ? '' : 's'} ${since()}" aria-label="${up ? 'Up' : 'Down'} ${n}">${up ? '▲' : '▼'}${n}</span>`;
}
const topText = (it) => (it.top > 1 ? `No. 1 for ${it.top} days` : '');

// ---------- pieces ----------
function placeholder(it) {
  const h = hue(it.title);
  return `<span class="ph" style="background:linear-gradient(160deg,hsl(${h} 45% 42%),hsl(${(h + 40) % 360} 55% 18%))">${esc(it.title)}</span>`;
}
const meta = (it) => [
  moveBadge(it, true),
  it.season ? `<span>${esc(it.season)}</span>` : '',
  it.year ? `<span>${it.year}</span>` : '',
  it.rating ? `<span class="star" aria-label="Rated ${it.rating} out of 10">★ ${it.rating.toFixed(1)}</span>` : '',
].join('');

const RAINBOW = ['#ff375f', '#ff9f0a', '#ffd60a', '#30d158', '#40c8e0', '#5e5ce6', '#bf5af2', '#ff375f'];
const RB_STOPS = RAINBOW.map((c, k) => `<stop offset="${(k / (RAINBOW.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join('');
// Each rank is a neon tube, drawn in four layers: a soft aura, a tinted glass body (lighter at the top),
// the rainbow tube with a two-step bloom, and a white-hot core that fades towards the bottom like a lit tube.
// The rainbow sweeps through each number once as the row arrives (rippling along) and again on hover; otherwise
// the numbers are still, so an idle page costs nothing.
function rankSvg(i, row = '') {
  const id = `rk${row}${i}`, n = pad(i + 1);
  const t = (cls, extra = '') => `<text class="${cls}" x="0" y="80" ${extra}>${n}</text>`;
  return `<svg class="num" viewBox="-16 -14 156 112" aria-hidden="true">
    <defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="-30" y1="0" x2="150" y2="30" spreadMethod="repeat">${RB_STOPS}
      <animateTransform attributeName="gradientTransform" type="translate" from="-180 -30" to="0 0" dur="2.4s" begin="${(0.15 + i * 0.08).toFixed(2)}s" calcMode="spline" keyTimes="0;1" keySplines=".45 0 .2 1" fill="freeze"/>
    </linearGradient></defs>
    ${t('aura', `fill="url(#${id})" filter="url(#aura)"`)}
    ${t('glass')}
    ${t('tube', `stroke="url(#${id})" filter="url(#bloom)"`)}
    ${t('core')}
  </svg>`;
}

// Hovering (or focusing) a card replays its rainbow sweep. Nothing loops.
function wireRanks() {
  if (reduceMotion) { document.querySelectorAll('svg.num').forEach((s) => s.pauseAnimations?.()); return; }
  const replay = (e) => {
    const t = e.target.closest?.('.pcard'); if (!t || t.contains(e.relatedTarget)) return;
    const a = t.querySelector('svg.num animateTransform'); try { a?.beginElement(); } catch {}
  };
  document.querySelectorAll('.posters').forEach((row) => {
    row.addEventListener('pointerover', replay, { signal: rowAbort?.signal });
    row.addEventListener('focusin', replay, { signal: rowAbort?.signal });
  });
}

const scope = () => (state.route === 'top' ? null : svc(state.route));
const eyeFor = (n, type) => { const s = scope(), what = type === 'tv' ? 'show' : 'film';
  return s?.store ? `No. ${n} to buy or rent` : s ? `No. ${n} ${what} on ${s.label}` : `No. ${n} ${what} in the UK`; };
const chartInfo = (it, i, type) => infoFor(it, type, [eyeFor(i + 1, type), i === 0 ? topText(it) : ''].filter(Boolean).join(' · '), scope() && !scope().store ? [scope()] : null);
function posterRow(list, kind = state.kind, first = true) {
  const edge = (side) => `<div class="edge ${side}" aria-hidden="true">${'<i></i>'.repeat(6)}</div>`;
  return `<div class="row-wrap at-start">
    ${edge('l')}${edge('r')}
    <button type="button" class="btn btn-icon scroller prev" aria-label="Previous titles" title="Previous" disabled>
      <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><path d="M8 2L2 8l6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <ol class="posters" aria-label="Top 10 ${words(kind)}">
      ${list.map((it, i) => { const sh = reg(chartInfo(it, i, kind)); return `<li class="pcard" style="--d:${i}">
        ${rankSvg(i, kind)}
        <a class="cover" href="${esc(it.url)}" target="_blank" rel="noopener" ${sh} aria-label="Number ${i + 1}: ${esc(it.title)}, where to watch">
          ${it.poster ? `<img src="${esc(it.poster)}" alt="" ${first && i < 4 ? `loading="eager"${i === 0 ? ' fetchpriority="high"' : ''}` : 'loading="lazy"'} decoding="async" width="342" height="513">` : placeholder(it)}
        </a>
        <h3><a href="${esc(it.url)}" target="_blank" rel="noopener" tabindex="-1" ${sh}>${esc(it.title)}</a></h3>
        <p class="sub">${meta(it)}</p>
      </li>`; }).join('')}
    </ol>
    <button type="button" class="btn btn-icon scroller next" aria-label="Next titles" title="Next">
      <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  </div>`;
}

// ---------- the Apple Music "New" layout ----------
// Three wide feature cards (eyebrow, title, subtitle, then the artwork with a caption and the poster in the corner).
const firstSentence = (t) => { const m = String(t || '').match(/^.{20,140}?[.!?](\s|$)/); return m ? m[0].trim() : String(t || '').slice(0, 120); };
const onText = (it, fallback) => (it.on || []).map((k) => svc(k)?.label).filter(Boolean).slice(0, 2).join(', ') || fallback || '';
function features(s) {
  const shows = s ? s.tv : state.trending.overall.tv, films = s ? s.movie : state.trending.overall.movie;
  const store = services().find((x) => x.store)?.movie || [];
  const picks = [
    shows[0] && { eye: s ? `No. 1 show on ${s.label}` : 'No. 1 show', it: shows[0], type: 'tv', sub: s ? `${shows[0].year || ''}` : `On ${onText(shows[0], 'UK streaming')}` },
    films[0] && { eye: s ? `No. 1 film on ${s.label}` : 'No. 1 film', it: films[0], type: 'movie', sub: s ? `${films[0].year || ''}` : `On ${onText(films[0], 'UK streaming')}` },
    s ? shows[1] && { eye: `No. 2 show on ${s.label}`, it: shows[1], type: 'tv', sub: `${shows[1].year || ''}` }
      : store[0] && { eye: 'No. 1 to buy or rent', it: store[0], type: 'movie', sub: 'Apple TV, Sky Store and others', href: '#store' },
  ].filter(Boolean);
  if (!picks.length) return '';
  return `<section class="feats" aria-label="Highlights"><div class="feat-row">${picks.map((p) => {
    const it = p.it, wide = it.backdrop ? it.backdrop.replace('/w1280/', '/w780/') : null;
    return `<a class="feat" href="${esc(p.href || it.url)}" ${p.href ? '' : `target="_blank" rel="noopener" ${reg(infoFor(it, p.type, p.eye, s ? [s] : null))}`}>
      <span class="f-eye">${esc(p.eye)}</span>
      <span class="f-title">${esc(it.title)}</span>
      <span class="f-sub">${esc(p.sub)}</span>
      <span class="f-img">
        ${wide ? `<img src="${esc(wide)}" alt="" loading="lazy" decoding="async">` : it.poster ? `<img class="blur" src="${esc(it.poster)}" alt="" loading="lazy">` : placeholder(it)}
        ${it.overview ? `<span class="f-cap">${esc(firstSentence(it.overview))}</span>` : ''}
        ${it.poster ? `<img class="f-thumb" src="${esc(it.poster)}" alt="" loading="lazy">` : ''}
      </span></a>`;
  }).join('')}</div></section>`;
}

// The best-rated ten on the service (or all five), as a tidy list in columns like "Best New Songs": rank, a small
// poster, title and where it's on. The posters above already show the chart, so this list shows something else:
// the catalogue's highest-rated titles with enough votes to trust (the same test as Browse's Top rated).
// The buy-or-rent chart has no catalogue behind it, so there it stays a list of that chart.
function topRated(k, s) {
  const c = state.cat; if (!c?.items) return [];
  const pass = (min) => c.items.filter((x) => x.t === k && x.r && x.v >= min && (s ? x.s.includes(s.key) : x.s.length));
  let l = pass(300); if (l.length < 10) l = pass(100);   // a smaller service may need a lower bar to fill ten
  return l.sort((a, b) => b.r - a.r || b.v - a.v).slice(0, 10).map((x) => ({
    id: x.i, title: x.n, year: (x.d || '').slice(0, 4), rating: x.r, on: x.s, url: tmdbUrl(k, x.i),
    poster: x.img ? (x.img.startsWith('/') ? c.img + x.img : x.img) : null,
  }));
}
function chartList(list, s, k = state.kind) {
  const rated = !s?.store;
  if (rated) list = topRated(k, s);
  if (!list.length) return '';
  const q = rated ? { c: 'top', ...(k === 'movie' ? { k: 'movie' } : {}), ...(s ? { s: s.key } : {}) } : { c: 'store', k: 'movie' };
  const browse = `browse.html#${new URLSearchParams(q)}`;
  return `<section class="clist" aria-labelledby="cl-h-${k}">
    <div class="row-hd"><h2 class="row-h" id="cl-h-${k}">${rated ? `Top rated ${words(k).toLowerCase()} at a glance` : 'Films to buy or rent: at a glance'}</h2>
      <a class="see-all" href="${esc(browse)}">See more in Browse<span class="chev" aria-hidden="true"></span></a></div>
    <ol class="cl">${list.map((it, i) => `<li><a href="${esc(it.url)}" target="_blank" rel="noopener" ${reg(rated ? infoFor(it, k, `No. ${i + 1} top rated${s ? ` on ${s.label}` : ''}`) : chartInfo(it, i, k))}>
      <span class="cl-n">${i + 1}${rated ? '' : moveBadge(it)}</span>
      ${it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy" decoding="async">` : `<span class="cl-ph" style="background:hsl(${hue(it.title)} 45% 35%)"></span>`}
      <span class="cl-t"><b>${esc(it.title)}</b><small>${esc([s ? '' : onText(it), it.season, it.year].filter(Boolean).join(' · '))}</small></span>
      ${it.rating ? `<span class="cl-r">★ ${it.rating.toFixed(1)}</span>` : ''}
    </a></li>`).join('')}</ol>
  </section>`;
}

// New this week, as a row of posters (from Watchmode), filtered to the service you're looking at.
function newRow(s) {
  const f = state.fresh; if (!f?.items?.length) return '';
  const today = new Date().toISOString().slice(0, 10);
  let items = f.items.filter((x) => !s || x.service === s.key);
  items = [...items.filter((x) => x.date <= today).reverse(), ...items.filter((x) => x.date > today)].slice(0, 14);
  if (!items.length) return '';
  const when = (d) => d === today ? 'Today' : new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `<section class="nrow" aria-labelledby="nr-h">
    <h2 class="row-h" id="nr-h"><a href="#new">New This Week<span class="chev" aria-hidden="true"></span></a></h2>
    <ul class="nr">${items.map((x) => {
      const sv = svc(x.service), what = x.type === 'movie' ? 'Film' : x.season ? `Season ${x.season}` : 'Series';
      const body = `<span class="nr-art">${x.poster ? `<img src="${esc(x.poster)}" alt="" loading="lazy">` : placeholder({ title: x.title })}${sv?.logo ? `<img class="nr-svc" src="${esc(sv.logo)}" alt="${esc(sv.label)}">` : ''}</span>
        <b>${esc(x.title)}</b><small>${esc(what)} · ${esc(when(x.date))}</small>`;
      return `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener" ${reg(infoFor(x, x.type, `New on ${sv?.label || 'streaming'}: ${when(x.date)}`, sv ? [sv] : []))}>${body}</a>` : `<span>${body}</span>`}</li>`;
    }).join('')}</ul>
  </section>`;
}

// ---------- the Watchlist: titles you've saved from a title sheet, kept on this device only ----------
const wlKey = (it, type) => (/^\d+$/.test(String(it.id ?? '')) ? `${type === 'movie' ? 'm' : 't'}${it.id}` : null);
// where each saved title sits in today's charts, e.g. "No. 3 on Netflix"
function chartSpots() {
  const spots = new Map(), t = state.trending; if (!t) return spots;
  const add = (list, type, where) => (list || []).forEach((it, i) => { const k = wlKey(it, type); if (k && !spots.has(k)) spots.set(k, `No. ${i + 1} ${where}`); });
  ['tv', 'movie'].forEach((type) => add(t.overall?.[type], type, 'in the UK'));
  services().filter((s) => !s.store).forEach((s) => ['tv', 'movie'].forEach((type) => add(s[type], type, `on ${s.label}`)));
  return spots;
}
const wlInfo = (x, eye) => ({ k: x.k, type: x.type, eye, title: x.title, year: x.year, poster: x.poster, tmdb: tmdbUrl(x.type, x.k.slice(1)), services: [] });
function wantTitles() {   // where-to-watch for the list comes from the title details, loaded once
  if (state.titles || !window.tnSheet?.details) return;
  window.tnSheet.details().then((d) => { if (d && !state.titles) { state.titles = d; if (state.route === 'watchlist') render(); } });
}
function pageWatchlist() {
  const list = window.tn.saved.all(), spots = chartSpots(), d = state.titles;
  const onLogos = (k) => {
    const x = d?.items?.[k]; if (!x?.f?.length) return '';
    const seen = new Set();
    return x.f.map((id) => d.providers[id]).filter((p) => p && !seen.has(p[0].split(' ')[0]) && seen.add(p[0].split(' ')[0])).slice(0, 3)
      .map(([n, logo]) => (logo && d.logo ? `<img src="${esc(d.logo + logo)}" alt="${esc(n)}" title="${esc(n)}">` : '')).join('');
  };
  const body = !list.length
    ? `<div class="empty"><span class="empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h12v18.4l-6-4.2-6 4.2z" fill="currentColor"/></svg></span>
        <h2>Nothing saved yet</h2><p>Open any title and press Watchlist to keep it here, with where to watch it.</p>
        <a class="btn btn-tinted" href="#top">See the top 10</a></div>`
    : `<ul class="list wl">${list.map((x) => {
        const spot = spots.get(x.k), sh = reg(wlInfo(x, spot || 'In your Watchlist'));
        const what = [x.type === 'movie' ? 'Film' : 'Series', x.year].filter(Boolean).join(' · ');
        const thumb = x.poster ? `<img class="nl-art" src="${esc(x.poster)}" alt="" loading="lazy">` : `<span class="nl-art" style="background:hsl(${hue(x.title)} 45% 35%)"></span>`;
        return `<li>${thumb}<div class="grow">
          <a class="title" href="${esc(tmdbUrl(x.type, x.k.slice(1)))}" target="_blank" rel="noopener" ${sh}>${esc(x.title)}</a>
          <span class="what">${esc(what)}${spot ? ` · <b class="wl-spot">${esc(spot)}</b>` : ''}</span></div>
          <span class="wl-on">${onLogos(x.k)}</span>
          <button type="button" class="btn btn-icon wl-x" data-unsave="${esc(x.k)}" aria-label="Remove ${esc(x.title)} from your Watchlist" title="Remove">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></li>`;
      }).join('')}</ul>`;
  return `<h1 class="large-title page-title">Watchlist</h1>
    <p class="lede">${list.length ? `${list.length} title${list.length === 1 ? '' : 's'}, newest first. ` : ''}Saved on this device only: no account, nothing sent anywhere.</p>
    ${body}`;
}
// On the Top 10: your saved titles as a row of posters, the way into the Watchlist on phones
function savedRow() {
  const list = window.tn.saved.all().slice(0, 14); if (!list.length) return '';
  const spots = chartSpots();
  return `<section class="nrow" aria-labelledby="wl-h">
    <h2 class="row-h" id="wl-h"><a href="#watchlist">Your Watchlist<span class="chev" aria-hidden="true"></span></a></h2>
    <ul class="nr">${list.map((x) => `<li><a href="${esc(tmdbUrl(x.type, x.k.slice(1)))}" target="_blank" rel="noopener" ${reg(wlInfo(x, spots.get(x.k) || 'In your Watchlist'))}>
      <span class="nr-art">${x.poster ? `<img src="${esc(x.poster)}" alt="" loading="lazy">` : placeholder({ title: x.title })}</span>
      <b>${esc(x.title)}</b><small>${esc(spots.get(x.k) || [x.type === 'movie' ? 'Film' : 'Series', x.year].filter(Boolean).join(' · '))}</small></a></li>`).join('')}</ul>
  </section>`;
}
view.addEventListener('click', (e) => {
  const b = e.target.closest('[data-unsave]'); if (!b) return;
  const li = b.closest('li'), next = li.nextElementSibling || li.previousElementSibling;
  window.tn.saved.remove(b.dataset.unsave);
  requestAnimationFrame(() => next?.querySelector('[data-unsave]')?.focus({ preventScroll: true }));
});
// saving or removing (here, in a sheet or in another tab) redraws the Watchlist and the row
addEventListener('tn:sheet-closed', () => { if (state.savedDirty) { state.savedDirty = false; const y = scrollY; draw(); scrollTo(0, y); } });
addEventListener('tn:saved', () => { if (state.trending && !window.tnSheet?.isOpen?.()) { const y = scrollY; draw(); scrollTo(0, y); } else state.savedDirty = true; });

function pageNew() {
  const f = state.fresh;
  let body;
  if (!f || f.disabled || f.error) {
    body = `<div class="empty"><span class="empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10.5 3.5l1.8 4.9 4.9 1.8-4.9 1.8-1.8 4.9-1.8-4.9-4.9-1.8 4.9-1.8z" fill="currentColor"/><path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" fill="currentColor"/></svg></span>
      <h2>${f?.error ? 'Back shortly' : 'Coming soon'}</h2>
      <p>${f?.error ? "The latest releases didn't load this time. They'll be back after the next hourly update." : "New releases from all five services will appear here soon. In the meantime, the top 10 is live."}</p>
      <a class="btn btn-tinted" href="#top">See the top 10</a></div>`;
  } else if (!f.items.length) {
    body = `<p class="lede">Nothing new on these services this week.</p>`;
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const days = new Map();
    for (const x of f.items) days.set(x.date, [...(days.get(x.date) || []), x]);
    body = [...days].map(([d, items]) => `<section class="group">
      <h2 class="${d === today ? 'today' : ''}">${d === today ? 'Today' : esc(fmtDate(new Date(d + 'T12:00:00'), { weekday: 'long', day: 'numeric', month: 'long' }))}</h2>
      <ul class="list">${items.map((x) => {
        const s = svc(x.service);
        const what = [x.type === 'movie' ? 'Film' : x.season ? `Season ${x.season}` : 'Series', x.original ? `${s?.label} original` : ''].filter(Boolean).join(', ');
        const thumb = x.poster ? `<img class="nl-art" src="${esc(x.poster)}" alt="" loading="lazy">` : `<span class="nl-art" style="background:hsl(${hue(x.title)} 45% 35%)"></span>`;
        return `<li>${thumb}<div class="grow">
          ${x.url ? `<a class="title" href="${esc(x.url)}" target="_blank" rel="noopener" ${reg(infoFor(x, x.type, `New on ${s?.label || 'streaming'}`, s ? [s] : []))}>${esc(x.title)}</a>` : `<span class="title">${esc(x.title)}</span>`}
          <span class="what">${esc(what)}</span></div>
          ${s ? `<a class="btn btn-tinted chip" href="#${s.key}">${esc(s.label)}</a>` : ''}</li>`;
      }).join('')}</ul></section>`).join('');
  }
  return `<h1 class="large-title page-title">New This Week</h1>
    <p class="lede">Arriving over the last and next seven days. Dates come from US listings, so a few UK dates may differ.</p>
    ${state.trending.sample ? `<p class="notice"><strong>Sample data.</strong> These titles are made up.</p>` : ''}
    ${body}`;
}

let toastTimer;
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- poster row arrows ----------
let rowAbort; // each render gets fresh listeners; the old row's are dropped with it
function wireScroller() {
  rowAbort?.abort(); rowAbort = new AbortController();
  const sig = { signal: rowAbort.signal, passive: true };
  document.querySelectorAll('.row-wrap').forEach((wrap) => wireRow(wrap, sig));
}
function wireRow(wrap, sig) {   // one poster row: its arrows, its frosted edges and dragging
  const row = wrap.querySelector('.posters'), prev = wrap.querySelector('.scroller.prev'), next = wrap.querySelector('.scroller.next');
  const update = () => {
    const start = row.scrollLeft < 8, end = row.scrollLeft + row.clientWidth >= row.scrollWidth - 8;
    prev.disabled = start; next.disabled = end;
    wrap.classList.toggle('at-start', start); wrap.classList.toggle('at-end', end); // each frosted edge glides away at its end
  };
  const by = (dir) => row.scrollBy({ left: dir * row.clientWidth * 0.75, behavior: reduceMotion ? 'auto' : 'smooth' });
  prev.addEventListener('click', () => by(-1), sig);
  next.addEventListener('click', () => by(1), sig);
  row.addEventListener('scroll', update, sig);
  addEventListener('resize', update, sig);
  update();
  wireDrag(row, sig);
}

// Drag the row with a mouse: it follows the hand, keeps the fling's momentum, then settles onto the nearest card.
// Mouse only; touch screens scroll the row natively.
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
function wireDrag(row, sig) {
  if (!finePointer) return;
  let down = false, dragging = false, startX = 0, startLeft = 0, lastX = 0, lastT = 0, v = 0, raf = 0, moved = 0;
  const snapStops = () => [...row.children].map((li) => li.offsetLeft - parseFloat(getComputedStyle(row).scrollPaddingLeft || 0));
  const settle = () => {
    const stops = snapStops(), at = row.scrollLeft;
    const target = stops.reduce((best, x) => (Math.abs(x - at) < Math.abs(best - at) ? x : best), stops[0] ?? 0);
    row.scrollTo({ left: Math.max(0, target), behavior: reduceMotion ? 'auto' : 'smooth' });
    setTimeout(() => row.classList.remove('dragging'), reduceMotion ? 0 : 420);
  };
  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    cancelAnimationFrame(raf);
    down = true; dragging = false; moved = 0; v = 0;
    startX = lastX = e.clientX; startLeft = row.scrollLeft; lastT = performance.now();
  }, sig);
  addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (!dragging && Math.abs(dx) > 5) { dragging = true; row.classList.add('dragging'); }
    if (!dragging) return;
    moved = Math.abs(dx);
    row.scrollLeft = startLeft - dx;
    const now = performance.now(), dt = Math.max(1, now - lastT);
    v = 0.75 * v + 0.25 * ((lastX - e.clientX) / dt); // px per ms, smoothed
    lastX = e.clientX; lastT = now;
  }, sig);
  const release = () => {
    if (!down) return; down = false;
    if (!dragging) return;
    if (reduceMotion) { settle(); return; }
    let vel = v * 16; // px per frame
    const glide = () => {
      vel *= 0.935; row.scrollLeft += vel;
      const atEdge = row.scrollLeft <= 0 || row.scrollLeft + row.clientWidth >= row.scrollWidth - 1;
      if (Math.abs(vel) > 0.6 && !atEdge) raf = requestAnimationFrame(glide); else settle();
    };
    raf = requestAnimationFrame(glide);
  };
  addEventListener('pointerup', release, sig);
  addEventListener('pointercancel', release, sig);
  row.addEventListener('click', (e) => { if (moved > 5) { e.preventDefault(); e.stopPropagation(); moved = 0; } }, { signal: sig.signal, capture: true });
  row.addEventListener('dragstart', (e) => e.preventDefault(), { signal: sig.signal });
}

// ---------- tabs (pages): Search, Top 10, New, Browse, About. The bar itself lives in shell.js ----------
const selectTab = (name) => window.tnShell.select(name);
function openTab(name) {
  if (name === 'about') { location.href = 'about.html'; return; }
  if (name === 'browse') { location.href = 'browse.html'; return; }
  if (name === 'search') { location.href = 'browse.html#search'; return; }
  const at = state.route === 'new' || state.route === 'watchlist' ? state.route : 'top';
  if (name === at) { scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); return; } // tap the open tab: back to the top
  location.hash = name === 'new' || name === 'watchlist' ? name : (state.lastChart || 'top');
}
window.tnOnTab = openTab;

// ---------- Shows | Films | Both: one switch, the same as on Browse ----------
function setKind(k) {
  if (k === state.kind) return;
  state.kind = k;
  try { localStorage.setItem('tenner-kind', k); } catch {}
  // Buy or rent is films only, so switching to shows takes you back to all services
  if (k !== 'movie' && svc(state.route)?.store) { location.hash = 'top'; return; }
  render();
}
document.querySelectorAll('.kind [data-kind]').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)));
arrows($('.kind'), () => [...document.querySelectorAll('.kind [data-kind]')], (b) => setKind(b.dataset.kind));
window.tn.segment($('.kind'), (b) => setKind(b.dataset.kind));   // the thumb slides and can be dragged, like an iOS switch

addEventListener('hashchange', () => { route(); scrollTo(0, 0); });
load();

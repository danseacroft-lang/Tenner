// Tenner's chart pages. Reads data/trending.json and data/new.json (rebuilt hourly by GitHub Actions).
// Routes: #top (all services), #netflix, #disney … (one service), #store (buy or rent), #new (new releases).
// Shared helpers (esc, hue) come from shell.js, which loads first.

const { esc, hue, reduce: reduceMotion } = window.tn;
const state = { trending: null, fresh: null, kind: 'tv', route: 'top' };
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const KIND_WORDS = { tv: 'Shows', movie: 'Films', both: 'Shows and Films' };
const words = (k = state.kind) => KIND_WORDS[k] || 'Shows';
const fmtDate = (d, opts) => d.toLocaleDateString('en-GB', opts);
const fmtTime = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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
  try { const k = localStorage.getItem('tenner-kind'); if (k in KIND_WORDS) state.kind = k; } catch {}
  if (window.tn.prefs.get().no18) state.titles = await window.tnSheet?.details();   // certificates, before the first chart
  addEventListener('tn:prefs', () => { if (window.tn.prefs.get().no18 && !state.titles) window.tnSheet?.details().then((d) => { state.titles = d; render(); }); else render(); });

  showUpdated();
  route();
}

const services = () => state.trending.services;
const svc = (k) => (k === 'mine' ? mineScope() : services().find((s) => s.key === k));
// My services as a chart of its own: the UK chart kept to titles on your services, topped up from your services' own
// charts (best ranks first) until there are ten. Movement arrows are left off, since it isn't a chart anyone else sees.
function mineScope() {
  const keys = window.tn.mine.get(); if (!keys.length) return null;
  const mine = services().filter((s) => keys.includes(s.key));
  const build = (k) => {
    const out = [], seen = new Set(), add = (it) => { const id = `${it.type}${it.id}`; if (!seen.has(id) && out.length < 10) { seen.add(id); out.push({ ...it, mv: undefined, top: undefined }); } };
    (state.trending.overall[k] || []).filter((it) => (it.on || []).some((s) => keys.includes(s))).forEach(add);
    for (let i = 0; i < 10 && out.length < 10; i++) mine.forEach((s) => s[k]?.[i] && add(s[k][i]));
    return out;
  };
  const names = mine.map((s) => s.label);
  return { key: 'mine', mine: true, keys, label: 'your services', names: names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join(' and '), tv: build('tv'), movie: build('movie') };
}

// ---------- the services: "Choose your services" opens the picker; once you've chosen, it reads "Your Services" ----------
const pickMine = () => window.tn.pickMine(services().filter((s) => !s.store && !s.shop).map((s) => ({ key: s.key, label: s.label, logo: s.logo })));
const svcLink = $('#svcLink');
svcLink.addEventListener('click', pickMine);
function markSvcLink() {
  svcLink.firstChild.textContent = window.tn.mine.get().length ? 'Your Services' : 'Choose your services';
}

// ---------- "Updated … ago" ----------
const narrow = matchMedia('(max-width: 560px)');
function agoText(iso) {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000), h = Math.floor(mins / 60);
  if (narrow.matches) { // phones: the short form, so the line stays on one row
    if (mins < 3) return 'Just updated';
    return mins < 60 ? `${mins} min ago` : h < 48 ? `${h} hr ago` : `${Math.floor(h / 24)} days ago`;
  }
  if (mins < 3) return 'Updated a few moments ago';
  if (mins < 60) return `Updated ${mins} minutes ago`;
  return h < 48 ? `Updated ${h} hour${h === 1 ? '' : 's'} ago` : `Updated ${Math.floor(h / 24)} days ago`;   // a long outage reads plainly
}
narrow.addEventListener('change', () => state.trending && showUpdated());
function showUpdated() {
  const d = new Date(state.trending.generatedAt);
  const ago = $('#ago'), txt = agoText(state.trending.generatedAt);
  if (ago.textContent !== txt) { ago.textContent = txt; ago.classList.remove('swap'); void ago.offsetWidth; ago.classList.add('swap'); }
  $('#refresh').title = `Last update ${fmtTime(d)}. Tap to check for a newer chart.`;
}
setInterval(() => state.trending && showUpdated(), 30000);

// Fetch the latest data and, if it's new, redraw in place (with the usual crossfade), keeping your scroll position.
// Tapping "Updated …" does it with a word of feedback; the background check (from shell.js) does it quietly, and holds
// back while a menu is open or a row is being dragged, trying again next time.
async function refresh(quiet) {
  const btn = $('#refresh');
  if (!state.trending || btn.classList.contains('busy')) return;
  if (quiet && ($('.posters.dragging'))) return;
  if (!quiet) { btn.classList.add('busy'); $('#ago').textContent = 'Checking…'; }
  try {
    const d = await fetchData(true);
    const changed = d.trending.generatedAt !== state.trending.generatedAt || d.fresh?.generatedAt !== state.fresh?.generatedAt;
    if (changed) { const y = scrollY; Object.assign(state, d, { cat: d.cat || state.cat, week: d.week || state.week }); render(); requestAnimationFrame(() => scrollTo(0, y)); }
    if (!quiet) toast(changed ? 'New chart loaded' : "You're up to date");
  } catch {
    if (!quiet) toast("Couldn't check right now. Try again in a moment.");   // quietly: the next check catches up
  }
  btn.classList.remove('busy'); showUpdated();
}
$('#refresh').addEventListener('click', () => refresh(false));

// ---------- share a chart: the phone's share sheet, or the share card on computers (shell.js), with this Top 10 as a
// picture (made here, in the browser) as well as a link back ----------
$('#shareChart').addEventListener('click', () => {
  const s = state.route === 'top' ? null : svc(state.route);
  const kind = state.kind === 'both' ? 'tv' : state.kind;
  const list = ((s ? s[kind] : state.trending.overall[kind]) || []).slice(0, 10);
  if (!list.length) return;
  const title = s?.store ? 'Top 10 to buy or rent' : `Top 10 ${words(kind)}`;
  const where = s?.mine ? 'On my services' : s?.store ? 'Apple TV, Sky Store and others' : s ? `On ${s.label}` : 'In the UK, on all six services';
  const url = new URL(location.href); url.search = ''; url.hash = s && !s.mine ? s.key : '';
  const top3 = list.slice(0, 3).map((it, i) => `${i + 1}. ${it.title}`).join(', ');
  window.tn.share({
    heading: `Share this ${title} with someone looking for something to watch`,
    title: 'Tenner', url: url.toString(),
    text: `${title} ${s && !s.mine && !s.store ? `on ${s.label}` : 'in the UK'} right now: ${top3}`,
    picture: async () => ({ blob: await chartImage(list, title, where), name: `tenner-${(s?.key || 'uk')}-${kind}.png` }),
  });
});
// The picture: 1080×1350 (a portrait post), night colours, ranks, posters where they'll load, titles and where they're on
async function chartImage(list, title, where) {
  const W = 1080, H = 1350, c = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = c.getContext('2d');
  await document.fonts?.ready;
  const font = (w, px, fam = 'Inter') => `${w} ${px}px "${fam}", -apple-system, system-ui, sans-serif`;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  [['#0a84ff', 180, 120, 620], ['#bf5af2', 960, 200, 560], ['#ff375f', 860, 1300, 520]].forEach(([col, x, y, r]) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, col + '55'); rg.addColorStop(1, col + '00'); g.fillStyle = rg; g.fillRect(0, 0, W, H); });
  const logo = await loadImg('logo.svg'); if (logo) g.drawImage(logo, 72, 64, 64, 64);
  g.fillStyle = '#fff'; g.font = font(700, 40, 'Inter Tight'); g.textBaseline = 'middle'; g.fillText('Tenner', 152, 98);
  g.font = font(500, 26); g.fillStyle = 'rgba(235,235,245,.6)'; g.textAlign = 'right';
  g.fillText(new Date(state.trending.generatedAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' }), W - 72, 98); g.textAlign = 'left';
  g.fillStyle = '#fff'; g.font = font(800, 76, 'Inter Tight'); g.fillText(title, 72, 210);
  g.font = font(500, 30); g.fillStyle = 'rgba(235,235,245,.7)'; g.fillText(where, 72, 272);
  const grad = g.createLinearGradient(0, 0, 160, 0); ['#ff375f', '#ff9f0a', '#ffd60a', '#30d158', '#0a84ff', '#bf5af2'].forEach((col, i) => grad.addColorStop(i / 5, col));
  const posters = await Promise.all(list.map((it) => (it.poster ? loadImg(it.poster.replace('/w342/', '/w154/'), true) : null)));
  const top = 330, rowH = 92;
  list.forEach((it, i) => {
    const y = top + i * rowH;
    g.font = font(800, 54, 'Inter Tight'); g.lineWidth = 2.4; g.strokeStyle = grad; g.textBaseline = 'middle';
    g.strokeText(String(i + 1).padStart(2, '0'), 72, y + rowH / 2 - 4);
    const px = 190;
    if (posters[i]) { g.save(); roundRect(g, px, y + 6, 52, 78, 8); g.clip(); g.drawImage(posters[i], px, y + 6, 52, 78); g.restore(); }
    else { g.fillStyle = `hsl(${hue(it.title)} 45% 35%)`; roundRect(g, px, y + 6, 52, 78, 8); g.fill(); }
    g.fillStyle = '#fff'; g.font = font(600, 34); g.fillText(clip(g, it.title, W - 72 - (px + 76)), px + 76, y + 32);
    g.fillStyle = 'rgba(235,235,245,.6)'; g.font = font(500, 24);
    g.fillText([onText(it), it.season, it.year].filter(Boolean).join(' · '), px + 76, y + 66);
    if (i < list.length - 1) { g.fillStyle = 'rgba(84,84,88,.6)'; g.fillRect(px + 76, y + rowH - 1, W - 72 - px - 76, 1); }
  });
  g.font = font(500, 24); g.fillStyle = 'rgba(235,235,245,.55)'; g.textBaseline = 'alphabetic';
  g.fillText('Updated every hour · ' + location.host + location.pathname.replace(/index\.html$/, ''), 72, H - 56);
  return new Promise((res) => { try { c.toBlob((b) => res(b), 'image/png'); } catch { res(null); } });   // a poster that blocks the picture: no picture, just the link
}
function loadImg(src, cors) {
  return new Promise((res) => { const im = new Image(); if (cors) im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; setTimeout(() => res(null), 4000); });
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function clip(g, t, max) { if (g.measureText(t).width <= max) return t; while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1); return t.trimEnd() + '…'; }
// choosing your services: rebuild the bar and show your own chart (or the UK's, if you went back to all six)
addEventListener('tn:mine', () => {
  if (!state.trending) return;
  const has = window.tn.mine.get().length;
  if (has && location.hash !== '#mine') location.hash = 'mine';
  else if (!has && state.route === 'mine') location.hash = 'top';
  else route();
});
addEventListener('tn:check', () => refresh(true));

// ---------- routing ----------
function route() {
  const h = location.hash.slice(1);
  const mine = window.tn.mine.get(), start = window.tn.prefs.get().start;   // Settings: "Open Tenner on"
  const first = !h ? (start === 'auto' || start === 'mine' ? (mine.length ? 'mine' : 'top') : start) : h;
  if (first === 'week') { history.replaceState(null, '', '#new'); return route(); }   // This Week now lives on New
  state.route = ['new', 'watchlist'].includes(first) || (first !== 'mine' && svc(first)) ? first : first === 'mine' && mine.length ? 'mine' : 'top';
  if (svc(state.route)?.store) state.kind = 'movie';
  if (!['new', 'watchlist'].includes(state.route)) state.lastChart = state.route;
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
// Settings: "Hide titles rated 18" (UK certificates come from the title details)
function adult(list, k) {
  if (!window.tn.prefs.get().no18 || !state.titles) return list;
  return list.filter((it) => det(wlKey(it, it.type || k))?.c !== '18');
}
function draw() {
  selectTab(state.route === 'new' || state.route === 'watchlist' ? state.route : 'top');
  $('#kindSel').value = state.kind; $('#kindL').textContent = { tv: 'Shows', movie: 'Films', both: 'Shows and films' }[state.kind];
  const isNew = state.route === 'new';
  $('#controls').hidden = isNew || state.route === 'watchlist';
  if (state.route === 'watchlist') { shown = new Map(); banners([]); setBackdrop(null); view.innerHTML = `<div class="wrap">${pageWatchlist()}</div>`; document.title = 'Watchlist | Tenner'; wlKindInit(); openFromUrl(); wantTitles(); alertCard(); return; }
  if (isNew) { shown = new Map(); setBackdrop(null); view.innerHTML = `<div class="wrap">${pageNew()}</div>`; newBanners((state.fresh?.items || []).filter((x) => x.date <= todayIso())); document.title = 'New This Week | Tenner'; openFromUrl(); return; }

  markSvcLink();
  shown = new Map();

  const s = state.route === 'top' ? null : svc(state.route);
  const listOf = (k) => adult((s ? s[k] : state.trending.overall[k]) || [], k);
  // "Both" shows the two charts one after the other; the hero takes turns between them
  const kinds = state.kind === 'both' ? ['tv', 'movie'] : [state.kind];
  const zip = (a, b) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a[i], b[i]]).flat().filter(Boolean);
  const ranked = (k) => listOf(k).map((it, i) => ({ it, n: i + 1 }));
  const picks = state.kind === 'both' ? zip(ranked('tv'), ranked('movie')) : ranked(state.kind);
  const list = picks.map((p) => p.it);
  const where = s ? s.label : 'UK streaming';
  $('#heading').innerHTML = `Top 10 <em class="grad">${esc(words())}</em>${s?.store ? ' to buy or rent' : ''}`;
  $('#lede').innerHTML = s?.mine ? `On your services: ${esc(s.names)}`
    : s?.store ? 'New releases from Apple TV, Sky Store and others'
    : s ? `${s.shop ? 'To buy or rent on' : 'On'} ${s.logo ? `<img class="sub-logo" src="${esc(s.logo)}" alt="">` : ''}${esc(s.label)}${s.official ? ` · ${esc(officialLine(s.official))}` : ''}` : 'On all six services in the UK';
  document.title = s?.mine ? 'My Top 10 | Tenner' : s ? `${s.label} Top 10 | Tenner` : 'Tenner';

  const feat = s ? picks : withEvery(picks, kinds);
  banners(feat, s);
  const chart = list.length
    ? `${state.trending.sample ? `<p class="notice"><strong>Sample data.</strong> These titles are made up. Add your TMDB key and run the workflow to see the real chart.</p>` : ''}
       ${hero(feat, s)}
       ${kinds.map((k, r) => `${kinds.length > 1 ? `<h2 class="row-h kind-h">Top 10 ${words(k)}</h2>` : ''}${posterRow(listOf(k), k, r === 0)}`).join('')}
       ${s?.store ? '' : tonightCard()}
       ${s?.store ? '' : features(s)}
       ${kinds.map((k) => chartList(s, k)).join('')}
       ${s?.store ? '' : savedRow()}${s && !s.mine ? '' : weekRow()}${s?.store ? '' : newRow(s)}`
    : `<div class="empty"><h2>Nothing here right now</h2><p>The chart for ${esc(where)} will be back after the next hourly update.</p><a class="btn btn-tinted" href="#top">See all six services</a></div>`;
  view.innerHTML = `<div class="wrap chart">${chart}</div>`;
  openFromUrl();
  setBackdrop(heroOn() && list.length ? heroList[heroAt]?.it || list[0] : null);   // the hero's pick
  wireScroller();
}

// ---------- computers: the hero, the Apple TV way ----------
// The chart's top titles take turns as a big backdrop on the right that melts into the page on its left and bottom
// (the fade is the backdrop's own mask, below). Over the faded part: a badge, the title, a line of details with the
// service and age rating, a sentence about it, Where to watch and + (Watchlist), with arrows either side, dots and a
// pause button. It moves on by itself every few seconds, the TV way, unless Animations are off, it's paused, or you're
// pointing at it or tabbing through it. Phones and tablets skip it (and never download the artwork).
const wide = matchMedia('(min-width: 1000px)');
wide.addEventListener('change', () => state.trending && state.route !== 'new' && render());
const heroOn = () => wide.matches && window.tn.prefs.get().hero;   // Settings: "Featured artwork"
const HERO_N = 8, HERO_MS = 8000;
let heroList = [], heroAt = 0, heroScope = null, heroSig = '';
const heroKey = (it) => wlKey(it, it.type) || `${it.type}:${it.title}`;
const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4.2 4.2 8.8-9.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// On All, the UK-wide chart can miss a service altogether (Apple TV's titles are rarely the UK's most popular), so each
// service that isn't in it adds its own No. 1, badged with that service; the hero and the banners always show those
function withEvery(picks, kinds) {
  const have = new Set(picks.map((p) => heroKey(p.it))), extra = [];
  for (const k of kinds) for (const sv of services().filter((x) => !x.store && !x.shop)) {
    if (picks.some((p) => p.it.type === k && (p.it.on || []).includes(sv.key))) continue;
    const i = adult(sv[k] || [], k).findIndex((it) => it.backdrop && !have.has(heroKey(it)));
    if (i < 0) continue;
    const it = sv[k][i]; have.add(heroKey(it)); extra.push({ it: { ...it, type: it.type || k }, n: i + 1, sv });
  }
  return [...picks, ...extra];
}
// featured.pick chooses n of the pool; a service's own No. 1 always gets a place, spread through the line-up
function pickFeatured(pool, n) {
  const own = pool.filter((p) => p.sv), list = window.tn.featured.pick(pool.filter((p) => !p.sv), (p) => heroKey(p.it), Math.max(1, n - own.length), (p) => p.it.backdrop);
  own.forEach((p, i) => list.splice(Math.min(list.length, i * 2 + 1), 0, p));
  return list.slice(0, Math.max(n, own.length + 1));
}
function heroCopy({ it, n, sv }) {
  // on a service's page it's that service's chart; on All it's the UK-wide chart, and the details say where to find it
  const s = sv || heroScope, kind = it.type === 'tv' ? 'show' : 'film', k = wlKey(it, it.type), x = (k && det(k)) || {};
  const badge = s?.store ? `No. ${n} to buy or rent` : s ? `No. ${n} ${kind} on ${s.label}` : `No. ${n} ${kind} in the UK`;
  const on = s && !s.mine ? s : svc((it.on || [])[0]);
  const bits = [it.type === 'tv' ? (it.season || 'Series') : 'Film', ...(x.g || []).slice(0, 2), it.year,
    it.rating && window.tn.prefs.get().ratings ? `★ ${it.rating.toFixed(1)}` : '', n === 1 ? topText(it) : weeksText(it)].filter(Boolean);
  const info = infoFor(it, it.type, badge, s && !s.store && !s.mine ? [s] : null), mark = window.tn.saved.has(k);
  return `<p class="h-badge">${esc(badge)}</p>
    <h2 class="h-title">${esc(it.title)}</h2>
    <p class="h-meta">${on?.logo ? `<img class="h-svc" src="${esc(on.logo)}" alt="${esc(on.label)}" title="${esc(on.label)}">` : ''}<span>${bits.map(esc).join(' · ')}</span>${x.c ? `<b class="h-cert" data-c="${esc(String(x.c).toUpperCase())}" title="Rated ${esc(x.c)}">${esc(x.c)}</b>` : ''}</p>
    ${it.overview ? `<p class="h-blurb">${esc(firstSentence(it.overview))}</p>` : ''}
    <div class="h-btns">
      <a class="h-cta" href="${esc(it.url)}" target="_blank" rel="noopener" ${reg(info)}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.6v10.8L13.2 8z" fill="currentColor"/></svg>Where to watch</a>
      ${k ? `<button type="button" class="h-add" data-hero-save="${esc(k)}" aria-pressed="${mark}" aria-label="${mark ? 'Saved to' : 'Add to'} Watchlist" title="${mark ? 'In your Watchlist' : 'Add to Watchlist'}">${mark ? TICK : PLUS}</button>` : ''}
    </div>`;
}
function hero(picks, s) {   // picks: [{ it, n }] where n is the title's rank in its own chart
  if (!heroOn() || !picks.length) { stopHero(); return ''; }
  // the whole chart takes turns, led by the ones you haven't seen up here lately (not the same No. 1 every visit);
  // a redraw (a new hour, a save to the Watchlist) keeps the line-up and the title that's showing, if it's still in the chart
  const sig = `${s?.key}|${picks.map((p) => heroKey(p.it)).join(',')}`, was = heroScope?.key === s?.key && heroList[heroAt]?.it;
  const byKey = new Map(picks.map((p) => [heroKey(p.it), p]));
  let list = sig === heroSig ? heroList.map((p) => byKey.get(heroKey(p.it))).filter(Boolean)
    : pickFeatured(picks, HERO_N);
  const now = was && byKey.get(heroKey(was));
  if (now && !list.includes(now)) list = [now, ...list].slice(0, HERO_N);
  heroList = list; heroAt = Math.max(0, now ? list.indexOf(now) : 0); heroScope = s; heroSig = sig;
  window.tn.featured.saw(heroKey(heroList[heroAt].it));
  if (!state.titles) window.tnSheet?.details().then((d) => { if (d && !state.titles) { state.titles = d; redrawHeroCopy(); } });   // genres and age ratings
  const many = heroList.length > 1, arrow = (dir, d) => `<button type="button" class="h-arrow ${dir}" data-hero-step="${dir === 'prev' ? -1 : 1}" aria-label="${dir === 'prev' ? 'Previous' : 'Next'} title"><svg viewBox="0 0 24 40" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  queueMicrotask(startHero);
  return `<section class="hero" id="hero" aria-roledescription="carousel" aria-label="Top of the chart">
    ${many ? arrow('prev', 'M16 6 6 20l10 14') : ''}
    <div class="h-copy" id="heroCopy" aria-live="polite">${heroCopy(heroList[heroAt])}</div>
    ${many ? `<div class="h-dots">${heroList.map((p, i) => `<button type="button" data-hero="${i}" aria-label="Number ${p.n}${p.sv ? ` on ${esc(p.sv.label)}` : ''}: ${esc(p.it.title)}" title="${esc(p.it.title)}" aria-current="${i === heroAt}"></button>`).join('')}</div>
    <button type="button" class="h-pause" id="heroPause" aria-pressed="${heroPaused}" aria-label="${heroPaused ? 'Play' : 'Pause'}" title="${heroPaused ? 'Play' : 'Pause'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="i-pause" d="M8.5 6.5v11M15.5 6.5v11" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path class="i-play" d="M8.5 5.8v12.4L18.6 12z" fill="currentColor"/></svg></button>` : ''}
    ${many ? arrow('next', 'M8 6l10 14L8 34') : ''}
  </section>`;
}
function redrawHeroCopy() { const c = $('#heroCopy'); if (c && heroList[heroAt]) c.innerHTML = heroCopy(heroList[heroAt]); }
addEventListener('tn:saved', () => $('#heroCopy') && redrawHeroCopy());
// The backdrop crossfades: the new picture decodes first, then fades in over the old one, which is then dropped.
let bdKey = null;
function setBackdrop(it) {
  const bd = $('#backdrop'), key = it ? it.backdrop || `ph:${it.title}` : null;
  if (key === bdKey) return; bdKey = key;
  if (!it) { bd.replaceChildren(); $('#bdExt')?.replaceChildren(); return; }
  let layer;
  if (it.backdrop) { layer = new Image(); layer.alt = ''; layer.src = it.backdrop.replace('/w1280/', '/original/'); layer.srcset = `${it.backdrop} 1280w, ${it.backdrop.replace('/w1280/', '/original/')} 1920w`; layer.sizes = '80vw'; }
  else { const h = hue(it.title); layer = document.createElement('span'); layer.style.background = `linear-gradient(120deg,hsl(${h} 45% 30%),hsl(${(h + 40) % 360} 55% 12%))`; }
  layer.className = 'bd-l';
  const show = () => {
    if (bdKey !== key) return;   // a newer one was asked for meanwhile
    // the sidebar picks up the artwork's colours through its glass: a mirrored copy sits beneath it
    const ext = $('#bdExt'), mirror = layer.cloneNode(true); mirror.classList.add('in'); ext?.replaceChildren(mirror);
    bd.append(layer);
    if (reduceMotion || bd.children.length === 1) { layer.classList.add('in'); [...bd.children].slice(0, -1).forEach((c) => c.remove()); return; }
    requestAnimationFrame(() => layer.classList.add('in'));
    setTimeout(() => [...bd.children].slice(0, -1).forEach((c) => c.remove()), 900);
  };
  layer.decode ? layer.decode().then(show, show) : show();
  // the next one's artwork loads quietly in the background, so it's ready when its turn comes
  const nx = heroList[(heroList.findIndex((p) => p.it === it) + 1) % (heroList.length || 1)]?.it;
  if (nx?.backdrop && nx !== it) { const pre = new Image(); pre.srcset = `${nx.backdrop} 1280w, ${nx.backdrop.replace('/w1280/', '/original/')} 1920w`; pre.sizes = '80vw'; }
}
function showHero(i) {
  if (i === heroAt || !heroList[i]) return;
  heroAt = i; window.tn.featured.saw(heroKey(heroList[i].it));
  document.querySelectorAll('[data-hero]').forEach((b) => b.setAttribute('aria-current', String(Number(b.dataset.hero) === i)));
  const copy = $('#heroCopy');
  const swap = () => { copy.innerHTML = heroCopy(heroList[i]); copy.classList.remove('out'); };
  if (reduceMotion) swap(); else { copy.classList.add('out'); setTimeout(swap, 220); }
  setBackdrop(heroList[i].it);
  startHero();   // a fresh count after every change, by hand or by itself
}
// the turns: paused by the button, while you point at it or tab through it, while a sheet is open or the tab is hidden
let heroTimer = 0, heroPaused = false;
const heroHeld = () => heroPaused || document.hidden || window.tnSheet?.isOpen() || $('#hero')?.matches(':hover, :focus-within') || document.documentElement.classList.contains('still') || reduceMotion;
function stopHero() { clearTimeout(heroTimer); heroTimer = 0; }
function startHero() {
  stopHero();
  const h = $('#hero'); if (!h || heroList.length < 2) return;
  h.classList.toggle('auto', !document.documentElement.classList.contains('still') && !reduceMotion);
  heroTimer = setTimeout(function tick() {
    if (!$('#hero')) return;
    if (heroHeld()) { heroTimer = setTimeout(tick, 1500); return; }
    showHero((heroAt + 1) % heroList.length);
  }, HERO_MS);
}
document.addEventListener('visibilitychange', () => document.hidden || startHero());
view.addEventListener('click', (e) => {
  const d = e.target.closest('[data-hero]'); if (d) { showHero(Number(d.dataset.hero)); return; }
  const st = e.target.closest('[data-hero-step]'); if (st) { showHero((heroAt + Number(st.dataset.heroStep) + heroList.length) % heroList.length); return; }
  if (e.target.closest('#heroPause')) {
    heroPaused = !heroPaused; const b = $('#heroPause');
    b.setAttribute('aria-pressed', heroPaused); b.setAttribute('aria-label', heroPaused ? 'Play' : 'Pause'); b.title = heroPaused ? 'Play' : 'Pause';
    if (!heroPaused) startHero(); return;
  }
  const add = e.target.closest('[data-hero-save]');
  if (add) { const it = heroList[heroAt].it; window.tn.saved.toggle(infoFor(it, it.type)); $('[data-hero-save]')?.focus({ preventScroll: true }); }
});
view.addEventListener('keydown', (e) => {   // ← → move between the hero's titles when a dot or arrow has focus
  const d = e.target.closest?.('[data-hero], [data-hero-step]'); if (!d || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault(); const i = (heroAt + (e.key === 'ArrowRight' ? 1 : -1) + heroList.length) % heroList.length;
  showHero(i); if (d.dataset.hero) $(`[data-hero="${i}"]`)?.focus();
});

// ---------- phones: the top titles as wide artwork banners, swiped one at a time, neighbours peeking in at the sides ----------
const phone = matchMedia('(max-width: 560px)');
phone.addEventListener('change', () => state.trending && render());
const mBan = $('#mBan');
let banSig = '', banKeys = [];
function banners(picks, scope) {
  if (!phone.matches || !picks.length) { mBan.hidden = true; mBan.innerHTML = ''; return; }
  // six of the chart, led by the ones you haven't seen up top lately; the same line-up while the chart's the same
  const sig = `${scope?.key}|${picks.map((p) => heroKey(p.it)).join(',')}`;
  if (sig !== banSig) { banSig = sig; banKeys = pickFeatured(picks, 6).map((p) => heroKey(p.it)); window.tn.featured.saw(banKeys[0]); }
  const byKey = new Map(picks.map((p) => [heroKey(p.it), p])), list = banKeys.map((k) => byKey.get(k)), wide = (u) => u && u.replace('/w1280/', '/w780/');
  mountBanners(list.map(({ it, n, sv }, i) => {
    const s = sv || scope;   // a service's own No. 1 (on All) is badged and linked as that service's
    const kind = it.type === 'tv' ? 'show' : 'film', badge = s?.store ? `No. ${n} to buy or rent` : s ? `No. ${n} on ${s.label}` : `No. ${n} ${kind} in the UK`;
    const art = it.backdrop ? `<img src="${esc(wide(it.backdrop))}" alt="" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">`
      : it.poster ? `<img class="soft" src="${esc(it.poster)}" alt="" loading="lazy">` : `<span class="mb-ph" style="--h:${hue(it.title)}"></span>`;
    return `<a class="mb-card" href="${esc(it.url)}" target="_blank" rel="noopener" aria-label="${esc(`${badge}: ${it.title}`)}" ${reg(infoFor(it, it.type, badge, s && !s.store && !s.mine ? [s] : null))}>
      ${art}<span class="mb-copy"><span class="mb-badge">${esc(badge)}</span><b class="mb-title">${esc(it.title)}</b><span class="mb-meta">${esc([it.type === 'tv' ? (it.season || 'Series') : 'Film', it.year].filter(Boolean).join(' · '))}</span></span></a>`;
  }));
}
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
  else window.tnSheet.openKey?.(k);   // something Tenner doesn't follow: the search API has it
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
const thumb = (u) => String(u).replace('/t/p/w342/', '/t/p/w154/');   // small spots (lists) take TMDB's smaller poster
function placeholder(it) {
  const h = hue(it.title);
  return `<span class="ph" style="background:linear-gradient(160deg,hsl(${h} 45% 42%),hsl(${(h + 40) % 360} 55% 18%))">${esc(it.title)}</span>`;
}
const meta = (it) => [
  moveBadge(it, true),
  it.season ? `<span>${esc(it.season)}</span>` : '',
  it.year ? `<span>${esc(it.year)}</span>` : '',
  it.rating ? `<span class="star" aria-label="Rated ${it.rating} out of 10">★ ${it.rating.toFixed(1)}</span>` : '',
].join('');

const RAINBOW = ['#ff375f', '#ff9f0a', '#ffd60a', '#30d158', '#40c8e0', '#5e5ce6', '#bf5af2', '#ff375f'];
const RB_STOPS = RAINBOW.map((c, k) => `<stop offset="${(k / (RAINBOW.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join('');
// Each rank is a neon tube, drawn in four layers: a soft aura, a tinted glass body (lighter at the top),
// the rainbow tube with a two-step bloom, and a white-hot core that fades towards the bottom like a lit tube.
// The number is drawn once and stays still: no shine or colour turn (styles.css says why).
function rankSvg(i, row = '') {
  const id = `rk${row}${i}`, n = pad(i + 1);
  const t = (cls, extra = '') => `<text class="${cls}" x="0" y="80" ${extra}>${n}</text>`;
  return `<svg class="num" viewBox="-16 -14 156 112" aria-hidden="true">
    <defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="-30" y1="0" x2="150" y2="30" spreadMethod="repeat">${RB_STOPS}</linearGradient></defs>
    ${t('aura', `fill="url(#${id})" filter="url(#aura)"`)}
    ${t('glass')}
    ${t('tube', `stroke="url(#${id})" filter="url(#bloom)"`)}
    ${t('core')}
  </svg>`;
}


const scope = () => (state.route === 'top' ? null : svc(state.route));
const eyeFor = (n, type) => { const s = scope(), what = type === 'tv' ? 'show' : 'film';
  return s?.store ? `No. ${n} to buy or rent` : s ? `No. ${n} ${what} on ${s.label}` : `No. ${n} ${what} in the UK`; };
const chartInfo = (it, i, type) => infoFor(it, type, [eyeFor(i + 1, type), i === 0 ? topText(it) : ''].filter(Boolean).join(' · '), scope() && !scope().store && !scope().mine ? [scope()] : null);
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

const firstSentence = (t) => { const m = String(t || '').match(/^.{20,140}?[.!?](\s|$)/); return m ? m[0].trim() : String(t || '').slice(0, 120); };
const onText = (it, fallback) => (it.on || []).map((k) => svc(k)?.label).filter(Boolean).slice(0, 2).join(', ') || fallback || '';
// ---------- "What should I watch tonight?": three taps, three picks from your services ----------
// How long you've got (an episode or two, a film, either), the mood, and who's watching; then the best-rated, most-watched
// matches from the Browse catalogue on your services (or all six), a few at random from the top so it's never the same.
// Every answer has its own icon: a white glyph on an Apple-style gradient tile. Each step opens on a little scene of them.
const TN_GLYPH = {
  tv: '<rect x="3" y="4.5" width="18" height="12.5" rx="3"/><path d="M8.5 20.5h7"/><path d="M10.3 8.3v5.4l4.5-2.7z" fill="currentColor"/>',
  movie: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8.5 3v18M15.5 3v18M4 7.5h4.5M4 12h4.5M4 16.5h4.5M15.5 7.5H20M15.5 12H20M15.5 16.5H20"/>',
  any: '<path d="M3 7h3.2c2 0 3.2 1 4.2 2.7l2.6 4.6c1 1.7 2.2 2.7 4.2 2.7H21M3 17h3.2c1.4 0 2.4-.5 3.2-1.4M14.4 8.4c.8-.9 1.8-1.4 3.2-1.4H21M18.2 4.2 21 7l-2.8 2.8M18.2 14.2 21 17l-2.8 2.8"/>',
  laugh: '<circle cx="12" cy="12" r="9"/><path d="M7.8 13.6c.9 2 2.4 3 4.2 3s3.3-1 4.2-3z" fill="currentColor"/><circle cx="9" cy="9.8" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="9.8" r="1.3" fill="currentColor" stroke="none"/>',
  edge: '<path d="M13.5 2.5 4.8 13.4h6.4l-1 8.1 8.9-11.3h-6.6z" fill="currentColor"/>',
  feel: '<path d="M12 20.3s-8-4.7-8-10.6a4.4 4.4 0 0 1 8-2.6 4.4 4.4 0 0 1 8 2.6c0 5.9-8 10.6-8 10.6z" fill="currentColor"/>',
  mind: '<circle cx="12" cy="12" r="5.2"/><path d="M6.8 14.6c-3 2.3-4.4 4.3-3.6 5.1 1.2 1.2 6.4-1.4 11-6s7.3-9.7 6-11c-.8-.7-2.8.6-5.1 3.6"/>',
  real: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z"/>',
  scare: '<path d="M5 20.5V11a7 7 0 0 1 14 0v9.5l-2.3-1.6-2.4 1.6-2.3-1.6-2.3 1.6-2.4-1.6z"/><circle cx="9.6" cy="11" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.4" cy="11" r="1.3" fill="currentColor" stroke="none"/>',
  me: '<circle cx="12" cy="8" r="3.8"/><path d="M4.8 20.3c.9-3.8 3.7-5.9 7.2-5.9s6.3 2.1 7.2 5.9"/>',
  two: '<circle cx="8.8" cy="8.6" r="3.3"/><path d="M2.8 19.8c.7-3.3 3-5.1 6-5.1s5.3 1.8 6 5.1"/><circle cx="16.6" cy="7.4" r="2.8"/><path d="M16.8 12.6c2.4.1 4 1.6 4.6 4.3"/>',
  family: '<path d="M3.2 11.2 12 4l8.8 7.2"/><path d="M5.6 9.3V20h12.8V9.3"/><path d="M12 17.6s-3.1-1.8-3.1-4a1.6 1.6 0 0 1 3.1-.9 1.6 1.6 0 0 1 3.1.9c0 2.2-3.1 4-3.1 4z" fill="currentColor" stroke="none"/>',
  pop: '<path d="M5.6 9.2h12.8l-1.7 11.1a1.5 1.5 0 0 1-1.5 1.3H8.8a1.5 1.5 0 0 1-1.5-1.3z"/><path d="M10 9.6l.5 11.9M14 9.6l-.5 11.9"/><path d="M6.2 9a2.6 2.6 0 0 1 2.1-4.1 2.9 2.9 0 0 1 5.1-1 2.6 2.6 0 0 1 4.1 2.6A2 2 0 0 1 17.8 9"/>',
};
// each icon's two colours, from Apple's system palette
const TN_TINT = { tv: ['#64d2ff', '#0a84ff'], movie: ['#ffb340', '#ff375f'], any: ['#da8fff', '#5e5ce6'], laugh: ['#ffd60a', '#ff9f0a'],
  edge: ['#ff7a45', '#ff2d55'], feel: ['#ff8fab', '#ff375f'], mind: ['#a78bfa', '#5e5ce6'], real: ['#66e08a', '#00b5a8'],
  scare: ['#8e8cf0', '#3a2f8f'], me: ['#64d2ff', '#0a84ff'], two: ['#ff8fab', '#bf5af2'], family: ['#ffd60a', '#ff8a00'], pop: ['#ff6b6b', '#ff375f'] };
const tnIc = (k, cls = 'tn-ic', style = '') => `<span class="${cls}" style="--a:${TN_TINT[k][0]};--b:${TN_TINT[k][1]};${style}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${TN_GLYPH[k]}</svg></span>`;
// a scene: icons floating at angles over a soft glow of their colours, with a few sparkles. [icon, x offset, top, size, tilt]
const tnSpark = (x, y, s) => `<svg class="tn-sp" style="left:calc(50% + ${x}px);top:${y}px;width:${s}px" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0c.6 6.4 5.6 11.4 12 12-6.4.6-11.4 5.6-12 12-.6-6.4-5.6-11.4-12-12 6.4-.6 11.4-5.6 12-12z" fill="currentColor"/></svg>`;
const tnScene = (tiles) => `<div class="tn-hero" style="--g1:${TN_TINT[tiles[0][0]][1]};--g2:${TN_TINT[tiles[tiles.length - 1][0]][1]}" aria-hidden="true">
  ${tiles.map(([k, x, y, s, r], i) => tnIc(k, 'tn-fl', `left:calc(50% + ${x}px);top:${y}px;width:${s}px;--r:${r}deg;--i:${i}`)).join('')}
  ${tnSpark(-118, 26, 12)}${tnSpark(112, 18, 15)}${tnSpark(92, 92, 9)}${tnSpark(-96, 98, 8)}</div>`;
const TN_SCENES = [
  [['movie', -66, 44, 54, -12], ['any', 66, 46, 54, 12], ['tv', 0, 22, 78, 0]],
  [['scare', -112, 62, 38, -14], ['laugh', -64, 30, 52, -8], ['mind', 112, 64, 38, 14], ['edge', 64, 32, 52, 8], ['feel', 0, 20, 74, 0]],
  [['me', -66, 44, 54, -12], ['family', 66, 46, 54, 12], ['two', 0, 22, 78, 0]],
];
function tonightCard() {
  return `<section class="tn-card"><div class="tn-c-art" aria-hidden="true">${tnIc('tv', 'tn-fl tn-c1')}${tnIc('feel', 'tn-fl tn-c2')}${tnIc('pop', 'tn-fl tn-c3')}</div>
    <div class="tn-c-copy"><h2>What should I watch tonight?</h2><p>Three quick taps and Tenner picks from ${window.tn.mine.get().length ? 'your services' : 'all six services'}.</p></div>
    <button type="button" class="btn btn-tinted" data-tonight>Help me choose</button></section>`;
}
const MOODS = [
  ['laugh', 'A laugh', 'Comedy, sitcoms, animation', [35, 16]],
  ['edge', 'Edge of my seat', 'Thrillers, crime, action', [53, 80, 28, 10759, 9648]],
  ['feel', 'Something feel‑good', 'Family, romance, heart-warming', [10751, 10749, 10762, 35]],
  ['mind', 'Mind-bending', 'Sci-fi, fantasy, mystery', [878, 10765, 14, 9648]],
  ['real', 'Something real', 'Documentaries and true stories', [99, 36, 10764]],
  ['scare', 'A scare', 'Horror', [27]],
];
const DARK = [27, 80, 53, 10752];   // left out when the family's watching
let tnCat = null;
const tonight = { step: 0, len: null, mood: null, who: null, seen: new Set(), dir: 1 };
function tonightDialog() {
  let d = $('#tnDlg');
  if (!d) {
    document.body.insertAdjacentHTML('beforeend', `<dialog class="mine-dlg tn-dlg" id="tnDlg" aria-labelledby="tnH"><form method="dialog">
      <span class="tn-grab" aria-hidden="true"></span>
      <button class="tn-x" value="x" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
      <div id="tnBody"></div></form></dialog>`);
    d = $('#tnDlg');
    d.addEventListener('click', (e) => {
      if (e.target === d) { d.close(); return; }
      const o = e.target.closest('[data-tn]'); if (!o) return;
      e.preventDefault();
      const [f, v] = o.dataset.tn.split(':');
      tonight.dir = f === 'back' ? -1 : 1;
      if (f === 'again') { tonight.step = 0; tonight.seen.clear(); }
      else if (f === 'more') { /* same answers, the next few */ }
      else if (f === 'back') tonight.step = Math.max(0, tonight.step - 1);
      else { tonight[f] = v; tonight.step++; navigator.vibrate?.(8); }
      drawTonight();
    });
    d.addEventListener('click', (e) => {   // a pick opens its title card
      const a = e.target.closest('[data-sheet]'); if (!a || e.metaKey || e.ctrlKey) return;
      e.preventDefault(); d.close(); window.tnSheet?.open(shown.get(a.dataset.sheet));
    });
    // on a phone it's a sheet from the bottom: pull it down by its top to put it away
    let y0 = null, dy = 0;
    d.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !matchMedia('(max-width: 600px)').matches || !e.target.closest('.tn-grab, .tn-hero, .tn-top') || d.scrollTop > 0) return;
      y0 = e.clientY; dy = 0; d.classList.add('tn-drag');
    });
    d.addEventListener('pointermove', (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); d.style.translate = `0 ${dy}px`; });
    const end = () => { if (y0 == null) return; y0 = null; d.classList.remove('tn-drag'); d.style.translate = ''; if (dy > 90) d.close(); };
    d.addEventListener('pointerup', end); d.addEventListener('pointercancel', end);
  }
  return d;
}
function drawTonight() {
  const b = $('#tnBody'), s = tonight.step;
  const opt = (f, v, label, sub) => `<button type="button" class="tn-opt" data-tn="${f}:${v}">${tnIc(v)}<span class="tn-ol"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
    <svg class="tn-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  const head = (n, q, sub) => `${tnScene(TN_SCENES[n - 1])}<div class="tn-pane"><div class="tn-top"><div class="tn-prog" role="img" aria-label="Step ${n} of 3">${[1, 2, 3].map((i) => `<i${i <= n ? ' class="on"' : ''}></i>`).join('')}</div><span class="tn-step">${n} of 3</span></div>
    <h2 id="tnH">${q}</h2><p class="tn-sub">${sub}</p>`;
  const back = '<button type="button" class="tn-back" data-tn="back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>Back</button>';
  const svcs = window.tn.mine.get().length ? 'your services' : 'all six services';
  let h;
  if (s === 0) h = head(1, 'How long have you got?', `Three quick taps, then three picks from ${svcs}.`) + `<div class="tn-opts tn-row">${opt('len', 'tv', 'An episode or two', 'Shows')}${opt('len', 'movie', 'A film', 'Films')}${opt('len', 'any', 'Either', 'Surprise me')}</div></div>`;
  else if (s === 1) h = head(2, 'What are you in the mood for?', 'Pick the feeling you’re after.') + `<div class="tn-opts tn-grid">${MOODS.map(([v, l, sub]) => opt('mood', v, l, sub)).join('')}</div>${back}</div>`;
  else if (s === 2) h = head(3, 'Who’s watching?', 'So we get the tone just right.') + `<div class="tn-opts tn-row">${opt('who', 'me', 'Just me', 'All yours')}${opt('who', 'two', 'Me and someone else', 'Something you’ll both like')}${opt('who', 'family', 'The family', 'Nothing too scary or grown-up')}</div>${back}</div>`;
  else {
    h = `${tnPicksScene()}<div class="tn-pane"><p class="tn-step">Picking…</p><h2 id="tnH">Finding tonight’s three</h2><ul class="tn-picks tn-sk">${'<li><a><span class="tn-ph"></span><span class="tn-t"><i></i><i></i></span></a></li>'.repeat(3)}</ul></div>`;
    tonightPicks().then((r) => { if (tonight.step === 3) { b.innerHTML = tnPicksScene() + `<div class="tn-pane tn-in">${r}</div>`; } });
  }
  b.innerHTML = h;
  b.querySelector('.tn-pane')?.classList.add(tonight.dir < 0 ? 'tn-bk' : 'tn-fw');
  if (document.activeElement?.closest?.('#tnDlg') || document.activeElement === document.body) b.querySelector('.tn-opt')?.focus({ preventScroll: true });
}
// the answers you gave, floating round a bucket of popcorn
const tnPicksScene = () => tnScene([[tonight.len === 'any' ? 'any' : tonight.len, -112, 62, 38, -14], [tonight.mood, -64, 32, 52, -8], [tonight.who, 64, 32, 52, 8], ['pop', 0, 20, 76, 0]].filter((t) => TN_TINT[t[0]]));
async function tonightPicks() {
  tnCat ||= state.cat ? Promise.resolve(state.cat) : fetch('data/browse.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);   // the page has it already, usually
  const cat = await tnCat; if (!cat?.items) return `<h2 id="tnH">Couldn’t load the picks</h2><p class="tn-sub">Try again in a moment.</p><div class="tn-acts"><button type="button" class="btn btn-tinted" data-tn="again">Start again</button></div>`;
  const mineSvcs = window.tn.mine.get(), want = new Set(mineSvcs.length ? mineSvcs : services().filter((x) => !x.store && !x.shop).map((x) => x.key));
  const genres = new Set(MOODS.find((m) => m[0] === tonight.mood)?.[3] || []), no18 = window.tn.prefs.get().no18;
  const pool = cat.items.filter((x) => (tonight.len === 'any' || x.t === tonight.len) && x.s?.some((k) => want.has(k)) && x.g?.some((g) => genres.has(g))
      && (tonight.who !== 'family' || !x.g.some((g) => DARK.includes(g))) && (x.r || 0) >= 6.4 && (x.v || 0) >= 40 && !(no18 && state.titles?.items?.[`${x.t === 'movie' ? 'm' : 't'}${x.i}`]?.c === '18'))
    .map((x) => ({ x, score: (x.r || 0) * Math.log10(10 + (x.v || 0)) + Math.log10(1 + (x.p || 0)) }))
    .sort((a, b) => b.score - a.score).slice(0, 30).filter(({ x }) => !tonight.seen.has(`${x.t}${x.i}`));
  if (!pool.length) return `<h2 id="tnH">${tonight.seen.size ? 'That’s all for those answers' : 'Nothing quite fits'}</h2><p class="tn-sub">Try a different mood${mineSvcs.length ? ', or add more of your services in Settings' : ''}.</p><div class="tn-acts"><button type="button" class="btn btn-tinted" data-tn="again">Start again</button></div>`;
  // three, each from a different part of the best thirty, so the very best one usually shows and the others vary
  const picks = []; const bag = [...pool];
  while (picks.length < 3 && bag.length) { const i = Math.floor(Math.pow(Math.random(), 1.6) * bag.length); picks.push(bag.splice(i, 1)[0].x); }
  picks.forEach((x) => tonight.seen.add(`${x.t}${x.i}`));
  const why = MOODS.find((m) => m[0] === tonight.mood)?.[1].toLowerCase();
  return `<p class="tn-step">For ${tonight.who === 'family' ? 'the family' : tonight.who === 'two' ? 'the two of you' : 'you'}, in the mood for ${esc(why)}</p><h2 id="tnH">Tonight, try…</h2>
    <ul class="tn-picks">${picks.map((x) => {
      const poster = x.img ? (x.img.startsWith('/') ? cat.img + x.img : x.img) : null;
      const svcs = x.s.filter((k) => want.has(k)).map(svc).filter(Boolean);
      const info = { k: `${x.t === 'movie' ? 'm' : 't'}${x.i}`, type: x.t, title: x.n, year: (x.d || '').slice(0, 4) || null, rating: x.r, poster, eye: 'Tenner’s pick for tonight',
        tmdb: tmdbUrl(x.t, x.i), services: svcs.map((s) => ({ label: s.label, logo: s.logo })), genres: (x.g || []).map((g) => cat.genres?.[g]).filter(Boolean).slice(0, 3) };
      return `<li><a href="${esc(info.tmdb)}" target="_blank" rel="noopener" ${reg(info)}>
        ${poster ? `<img src="${esc(thumb(poster))}" alt="" loading="lazy">` : `<span class="tn-ph" style="background:hsl(${hue(x.n)} 45% 35%)"></span>`}
        <span class="tn-t"><b>${esc(x.n)}</b><small>${esc([x.t === 'movie' ? 'Film' : 'Series', info.year, x.r ? `★ ${x.r.toFixed(1)}` : ''].filter(Boolean).join(' · '))}</small>
        <small>On ${esc(svcs.map((s) => s.label).join(', '))}</small></span></a></li>`;
    }).join('')}</ul>
    <div class="tn-acts"><button type="button" class="btn btn-tinted" data-tn="again">Start again</button><button type="button" class="btn btn-tinted mine-done" data-tn="more">Show me others</button></div>`;
}
view.addEventListener('click', (e) => {
  if (!e.target.closest('[data-tonight]')) return;
  Object.assign(tonight, { step: 0, len: null, mood: null, who: null, dir: 1 }); tonight.seen.clear();
  const d = tonightDialog(); drawTonight(); d.showModal();
});

// ---------- the Apple Music "New" layout ----------
// Three wide feature cards (eyebrow, title, subtitle, then the artwork with a caption and the poster in the corner).
function features(s) {
  const shows = s ? s.tv : state.trending.overall.tv, films = s ? s.movie : state.trending.overall.movie;
  const store = services().find((x) => x.store)?.movie || [];
  // Elsewhere on the charts: what the chart you're looking at doesn't already show (the other kind's No. 1, the No. 1 to
  // buy or rent, this week's biggest climber), never the No. 1 that's already in the hero and the posters
  const showing = state.kind === 'both' ? ['tv', 'movie'] : [state.kind];
  // this week's biggest climber, in the UK chart if there's one there, else on any service (with its full details)
  const lists = [...['tv', 'movie'].map((t) => state.trending.overall[t] || []), ...services().filter((x) => !x.store).flatMap((x) => [x.tv || [], x.movie || []])];
  const findIt = (k) => lists.flat().find((it) => wlKey(it, it.type) === k);
  const climbs = (state.week?.climbers || []).filter((x) => !s || s.mine ? true : x.c.startsWith(`${s.key}:`)).sort((a, b) => b.c.startsWith('all:') - a.c.startsWith('all:'));
  const climb = climbs.find((x) => findIt(x.k)), climbIt = climb && findIt(climb.k);
  const fresh = (state.fresh?.items || []).filter((x) => !s || (s.mine ? s.keys.includes(x.service) : x.service === s.key))
    .filter((x) => x.date <= todayIso()).reverse()[0];
  const where = s ? `on ${s.label}` : 'in the UK';
  // always three: the best of these, never one that's already the No. 1 above
  const cands = [
    !showing.includes('tv') && shows[0] && { eye: `No. 1 show ${where}`, it: shows[0], type: 'tv', sub: s ? `${shows[0].year || ''}` : `On ${onText(shows[0], 'UK streaming')}` },
    !showing.includes('movie') && films[0] && { eye: `No. 1 film ${where}`, it: films[0], type: 'movie', sub: s ? `${films[0].year || ''}` : `On ${onText(films[0], 'UK streaming')}` },
    !s && store[0] && { eye: 'No. 1 to buy or rent', it: store[0], type: 'movie', sub: 'Apple TV, Sky Store and others', href: '#store' },
    climbIt && { eye: 'Biggest climber this week', it: climbIt, type: climbIt.type, sub: `Up ${climb.by} to No. ${climb.to} ${chartName(climb.c).replace(/^(show|film) /, '')}` },
    fresh && { eye: `New on ${svc(fresh.service)?.label || 'streaming'}`, it: fresh, type: fresh.type, sub: [fresh.type === 'movie' ? 'Film' : fresh.season ? `Season ${fresh.season}` : 'Series', fresh.date === todayIso() ? 'Today' : ''].filter(Boolean).join(' · '), svcs: svc(fresh.service) ? [svc(fresh.service)] : [] },
    showing.includes('tv') && shows[1] && { eye: `No. 2 show ${where}`, it: shows[1], type: 'tv', sub: s ? `${shows[1].year || ''}` : `On ${onText(shows[1], 'UK streaming')}` },
    showing.includes('movie') && films[1] && { eye: `No. 2 film ${where}`, it: films[1], type: 'movie', sub: s ? `${films[1].year || ''}` : `On ${onText(films[1], 'UK streaming')}` },
    shows[2] && { eye: `No. 3 show ${where}`, it: shows[2], type: 'tv', sub: s ? `${shows[2].year || ''}` : `On ${onText(shows[2], 'UK streaming')}` },
  ].filter(Boolean);
  const seen = new Set(), picks = [];
  for (const p of cands) { const id = p.it.title.toLowerCase(); if (!seen.has(id) && picks.length < 3) { seen.add(id); picks.push(p); } }
  if (!picks.length) return '';
  return `<section class="feats" aria-label="Highlights"><div class="feat-row">${picks.map((p) => {
    const it = p.it, wide = it.backdrop ? it.backdrop.replace('/w1280/', '/w780/') : null;
    return `<a class="feat" href="${esc(p.href || it.url || "#new")}" ${p.href ? '' : `target="_blank" rel="noopener" ${reg(infoFor(it, p.type, p.eye, p.svcs || (s && !s.mine ? [s] : null)))}`}>
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

// The best-rated ten on the service (or all six), as a tidy list in columns like "Best New Songs": rank, a small
// poster, title and where it's on. The posters above already show the chart, so this list shows something else:
// the catalogue's highest-rated titles with enough votes to trust (the same test as Browse's Top rated).
// The buy-or-rent chart has no catalogue behind it, so there it stays a list of that chart.
function topRated(k, s) {
  const c = state.cat; if (!c?.items) return [];
  const pass = (min) => c.items.filter((x) => x.t === k && x.r && x.v >= min && (s?.store ? x.b : s?.mine ? x.s.some((k) => s.keys.includes(k)) : s ? x.s.includes(s.key) : x.s.length));
  let l = pass(300); if (l.length < 10) l = pass(100);   // a smaller service may need a lower bar to fill ten
  return l.sort((a, b) => b.r - a.r || b.v - a.v).slice(0, 10).map((x) => ({
    id: x.i, title: x.n, year: (x.d || '').slice(0, 4), rating: x.r, on: x.s, url: tmdbUrl(k, x.i),
    poster: x.img ? (x.img.startsWith('/') ? c.img + x.img : x.img) : null,
  }));
}
function chartList(s, k = state.kind) {
  // the buy-or-rent chart's list is the best-rated films to buy or rent; if the catalogue has too few, it's left out
  // rather than repeating the posters above
  const list = topRated(k, s);
  if (!list.length) return '';
  const q = s?.store ? { c: 'store', k: 'movie', sort: 'rating' } : { c: 'top', ...(k === 'movie' ? { k: 'movie' } : {}), ...(s ? { s: s.mine ? s.keys.join(',') : s.key } : {}) };
  const browse = `browse.html#${new URLSearchParams(q)}`;
  return `<section class="clist" aria-labelledby="cl-h-${k}">
    <div class="row-hd"><h2 class="row-h" id="cl-h-${k}">${s?.store ? 'Top rated to buy or rent' : `Top rated ${words(k).toLowerCase()} at a glance`}</h2>
      <a class="see-all" href="${esc(browse)}">See more in Browse<span class="chev" aria-hidden="true"></span></a></div>
    <ol class="cl">${list.map((it, i) => `<li><a href="${esc(it.url)}" target="_blank" rel="noopener" ${reg(infoFor(it, k, `No. ${i + 1} top rated${s?.store ? ' to buy or rent' : s ? ` on ${s.label}` : ''}`))}>
      <span class="cl-n">${i + 1}</span>
      ${it.poster ? `<img src="${esc(thumb(it.poster))}" alt="" loading="lazy" decoding="async">` : `<span class="cl-ph" style="background:hsl(${hue(it.title)} 45% 35%)"></span>`}
      <span class="cl-t"><b>${esc(it.title)}</b><small>${esc([s && !s.mine ? '' : onText(it), it.season, it.year].filter(Boolean).join(' · '))}</small></span>
      ${it.rating ? `<span class="cl-r">★ ${it.rating.toFixed(1)}</span>` : ''}
    </a></li>`).join('')}</ol>
  </section>`;
}

// New this week, as a row of posters (from Watchmode), filtered to the service you're looking at.
function newRow(s) {
  const f = state.fresh; if (!f?.items?.length) return '';
  const today = todayIso();
  let items = f.items.filter((x) => !s || (s.mine ? s.keys.includes(x.service) : x.service === s.key));
  const wk = new Date(Date.parse(today + 'T12:00:00Z') + 7 * 864e5).toISOString().slice(0, 10);   // the next week's arrivals after them (the rest are in Coming soon)
  items = [...items.filter((x) => x.date <= today).reverse(), ...items.filter((x) => x.date > today && x.date <= wk)].slice(0, 14);
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

// ---------- the Watchlist: titles you've saved from a title sheet (on this device, and in your account if you sign in) ----------
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
      .map(([n, logo]) => `<img class="nw-logo" src="${esc(d.logo + logo)}" alt="${esc(n)}" title="${esc(n)}">`).join('');
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
// On the Top 10: a taste of the week, the way in
function weekRow() {
  const w = state.week; if (!w?.climbers?.length) return '';
  return `<section class="nrow" aria-labelledby="wk-h">
    <h2 class="row-h" id="wk-h"><a href="#new">This Week<span class="chev" aria-hidden="true"></span></a></h2>
    <ul class="nr">${w.climbers.slice(0, 8).map((x) => weekCard(x, `▲${x.by} to No. ${x.to} ${chartName(x.c)}`)).join('')}</ul>
  </section>`;
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
  const row = `${art}<span class="cl-t"><b>${esc(x.title)}</b><small>${esc(what)}</small></span>${s?.logo ? `<img class="nw-logo" src="${esc(s.logo)}" alt="">` : ''}`;
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

// ---------- tabs (pages): Top 10, New, Browse, Discover (phones), Cast & Crew, Watchlist, About. The bar itself lives in shell.js ----------
const selectTab = (name) => window.tnShell.select(name);
function openTab(name) {
  if (name === 'about') { location.href = 'about.html'; return; }
  if (name === 'browse') { location.href = 'browse.html'; return; }
  if (name === 'people') { location.href = 'people.html'; return; }   // Cast & Crew
  if (name === 'discover') { location.href = 'discover.html'; return; }   // Discover (phones)
  const at = state.route === 'new' || state.route === 'watchlist' ? state.route : 'top';
  if (name === at) { scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); return; } // tap the open tab: back to the top
  location.hash = name === 'new' || name === 'watchlist' ? name : (state.lastChart || 'top');
}
window.tnOnTab = openTab;

// ---------- Shows, Films or both: the menu under the heading ----------
function setKind(k) {
  if (k === state.kind) return;
  state.kind = k;
  try { localStorage.setItem('tenner-kind', k); } catch {}
  // Buy or rent is films only, so switching to shows takes you back to all services
  if (k !== 'movie' && svc(state.route)?.store) { location.hash = 'top'; return; }
  render();
}
$('#kindSel').addEventListener('change', (e) => setKind(e.target.value));

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

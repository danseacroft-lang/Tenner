// Tenner front end. Reads data/trending.json and data/new.json (rebuilt hourly by GitHub Actions).
// Routes: #top (all services), #netflix, #disney … (one service), #new (new releases).

const state = { trending: null, fresh: null, kind: 'tv', route: 'top' };
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const words = () => (state.kind === 'tv' ? 'Shows' : 'Films');
const fmtDate = (d, opts) => d.toLocaleDateString('en-GB', opts);
const fmtTime = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const pad = (n) => String(n).padStart(2, '0');

// ---------- data ----------
async function fetchData(bust) {
  if (window.__TENNER__) return window.__TENNER__;
  const v = `?v=${bust ? Date.now() : Math.floor(Date.now() / 600000)}`;
  const [trending, fresh] = await Promise.all([
    fetch('data/trending.json' + v, { cache: bust ? 'no-store' : 'default' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    fetch('data/new.json' + v).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  return { trending, fresh };
}

async function load() {
  try {
    Object.assign(state, await fetchData(false));
  } catch (err) {
    view.innerHTML = `<div class="wrap"><h1 class="large-title">The chart didn't load</h1>
      <p class="lede">${esc(err.message)}. If you've just set the site up, run the "Update and deploy" workflow once, then refresh.</p></div>`;
    return;
  }
  try { const k = localStorage.getItem('tenner-kind'); if (k === 'tv' || k === 'movie') state.kind = k; } catch {}

  const sel = $('#service');
  sel.innerHTML = `<option value="top">All five services</option>` +
    services().map((s) => `<option value="${s.key}">${esc(s.label)}</option>`).join('');
  sel.addEventListener('change', () => { location.hash = sel.value; });
  showUpdated();
  route();
}

const services = () => state.trending.services;
const svc = (k) => services().find((s) => s.key === k);

// ---------- "Updated … ago" ----------
const narrow = matchMedia('(max-width: 560px)');
function agoText(iso) {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000), h = Math.floor(mins / 60);
  if (narrow.matches) { // phones: the short form, so the pill sits beside the service picker
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

$('#refresh').addEventListener('click', async () => {
  const btn = $('#refresh');
  if (btn.classList.contains('busy')) return;
  btn.classList.add('busy'); $('#ago').textContent = 'Checking…';
  const before = state.trending.generatedAt;
  try {
    Object.assign(state, await fetchData(true));
    showUpdated(); render();
    toast(state.trending.generatedAt === before ? "You're up to date" : 'New chart loaded');
  } catch {
    showUpdated(); toast("Couldn't check right now. Try again in a moment.");
  }
  btn.classList.remove('busy');
});

// ---------- routing ----------
function route() {
  const h = location.hash.slice(1);
  state.route = h === 'new' || svc(h) ? h : 'top';
  if (state.route !== 'new') state.lastChart = state.route;
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
  selectTab(state.route === 'new' ? 'new' : state.kind);
  const isNew = state.route === 'new';
  $('#controls').hidden = isNew;
  if (isNew) { view.innerHTML = `<div class="wrap">${pageNew()}</div>`; document.title = 'New this week | Tenner'; return; }

  $('#service').value = state.route;

  const s = state.route === 'top' ? null : svc(state.route);
  const list = s ? s[state.kind] : state.trending.overall[state.kind];
  const where = s ? s.label : 'UK streaming';
  $('#heading').innerHTML = `Top 10 ${words()} on ${s ? brand(s) : allBrands()}`;
  $('#lede').textContent = `What the UK is watching right now on ${s ? s.label : 'Netflix, Disney+, Prime Video, HBO Max and Paramount+'}.`;
  document.title = s ? `${s.label} Top 10 | Tenner` : 'Tenner';

  const chart = list.length
    ? `${state.trending.sample ? `<p class="notice"><strong>Sample data.</strong> These titles are made up. Add your TMDB key and run the workflow to see the real chart.</p>` : ''}
       ${posterRow(list)}${overview(list, !s, where)}`
    : `<p class="lede" style="margin-top:24px">No ${words().toLowerCase()} found for ${esc(where)} yet. The provider name may have changed; check data/providers.json after the next update.</p>`;
  view.innerHTML = `<div class="wrap chart">${chart}</div>`;
  wireScroller(); wireRanks();
}

// The platform's own logo (supplied by TMDB) in place of its name; the name stays for screen readers and as a fallback.
const brand = (s, cls = 'brand-logo') => s.logo
  ? `<img class="${cls}" src="${esc(s.logo)}" alt="${esc(s.label)}" title="${esc(s.label)}">`
  : esc(s.label);
const allBrands = () => services().every((s) => s.logo)
  ? `<span class="brand-stack" role="img" aria-label="UK streaming">${services().map((s) => `<img src="${esc(s.logo)}" alt="" title="${esc(s.label)}">`).join('')}</span>`
  : 'UK streaming';

// ---------- pieces ----------
function hue(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function placeholder(it) {
  const h = hue(it.title);
  return `<span class="ph" style="background:linear-gradient(160deg,hsl(${h} 45% 42%),hsl(${(h + 40) % 360} 55% 18%))">${esc(it.title)}</span>`;
}
const meta = (it) => [
  it.year ? `<span>${it.year}</span>` : '',
  it.rating ? `<span class="star" aria-label="Rated ${it.rating} out of 10">★ ${it.rating.toFixed(1)}</span>` : '',
].join('');

// Each rank is a little neon sign: a soft aura, a glassy fill, a rainbow tube with bloom and a white-hot core.
// The rainbow flows along every number, offset per card so it ripples across the row.
const RAINBOW = ['#ff375f', '#ff9f0a', '#ffd60a', '#30d158', '#40c8e0', '#5e5ce6', '#bf5af2', '#ff375f'];
function rankSvg(i) {
  const id = `rk${i}`, n = pad(i + 1);
  const stops = RAINBOW.map((c, k) => `<stop offset="${(k / (RAINBOW.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join('');
  const t = (cls, extra = '') => `<text class="${cls}" x="0" y="104" ${extra}>${n}</text>`;
  return `<svg class="num" viewBox="-24 -24 200 152" aria-hidden="true">
    <defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="-40" y1="0" x2="200" y2="40" spreadMethod="repeat">${stops}
      <animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="240 40" dur="7s" begin="${(-i * 0.45).toFixed(2)}s" repeatCount="indefinite"/>
    </linearGradient></defs>
    ${t('aura', `fill="url(#${id})" filter="url(#aura)"`)}
    ${t('glass')}
    ${t('tube', `stroke="url(#${id})" filter="url(#bloom)"`)}
    ${t('core')}
  </svg>`;
}

// Only animate the numbers you can see, and none at all for reduced motion.
let rankObserver;
function wireRanks() {
  const svgs = [...document.querySelectorAll('svg.num')];
  if (reduceMotion) { svgs.forEach((s) => s.pauseAnimations?.()); return; }
  rankObserver?.disconnect();
  rankObserver = new IntersectionObserver((entries) => entries.forEach((e) =>
    e.isIntersecting ? e.target.unpauseAnimations?.() : e.target.pauseAnimations?.()), { rootMargin: '80px' });
  svgs.forEach((s) => rankObserver.observe(s));
}

function posterRow(list) {
  return `<div class="row-wrap">
    <button type="button" class="btn btn-icon scroller prev" aria-label="Previous titles" disabled>
      <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><path d="M8 2L2 8l6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <ol class="posters" aria-label="Top 10">
      ${list.map((it, i) => `<li class="pcard" style="--d:${i}">
        ${rankSvg(i)}
        <a class="cover" href="${esc(it.url)}" target="_blank" rel="noopener" aria-label="Number ${i + 1}: ${esc(it.title)}">
          ${it.poster ? `<img src="${esc(it.poster)}" alt="" loading="${i < 4 ? 'eager' : 'lazy'}" width="342" height="513">` : placeholder(it)}
        </a>
        <h3><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
        <p class="sub">${meta(it)}</p>
      </li>`).join('')}
    </ol>
    <button type="button" class="btn btn-icon scroller next" aria-label="Next titles">
      <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  </div>`;
}

function overview(list, showWhere, where) {
  const d = new Date(state.trending.generatedAt);
  return `<section class="overview" aria-labelledby="ov-h">
    <h2 id="ov-h" class="large-title">Top 10 ${words()} Overview</h2>
    <p class="lede">${esc(where)}, ${fmtDate(d, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <div class="table-scroll"><table>
      <thead><tr>
        <th scope="col">Ranking</th><th scope="col">Title</th>
        <th scope="col" class="num-col hide-sm">Year</th><th scope="col" class="num-col">Rating</th>
        <th scope="col" class="${showWhere ? 'hide-sm' : 'num-col hide-sm'}">${showWhere ? 'Where to watch' : 'Popularity'}</th>
      </tr></thead>
      <tbody>${list.map((it, i) => `<tr style="--d:${i}">
        <td class="rank"><span>${pad(i + 1)}</span></td>
        <td><div class="tcell">
          ${it.backdrop ? `<img src="${esc(it.backdrop.replace('/w1280/', '/w300/'))}" alt="" loading="lazy">` : it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy">` : placeholder(it)}
          <div style="min-width:0"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
          ${it.overview ? `<p class="ov">${esc(it.overview)}</p>` : ''}
          ${showWhere ? `<span class="chips show-sm">${chips(it)}</span>` : ''}</div>
        </div></td>
        <td class="num-col hide-sm">${it.year ?? '–'}</td>
        <td class="num-col">${it.rating ? `<span class="star">★</span> ${it.rating.toFixed(1)}` : '–'}</td>
        ${showWhere
          ? `<td class="hide-sm"><span class="chips">${chips(it)}</span></td>`
          : `<td class="num-col hide-sm">${Math.round(it.popularity).toLocaleString('en-GB')}</td>`}
      </tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

const chips = (it) => (it.on || []).map((k) => svc(k)).filter(Boolean)
  .map((s) => `<a class="btn btn-tinted chip" href="#${s.key}">${esc(s.label)}</a>`).join('');

function pageNew() {
  const f = state.fresh;
  let body;
  if (!f || f.disabled || f.error) {
    body = `<p class="lede">${f?.error ? 'The new-releases feed failed on the last update. It will try again next hour.' : 'Add a WATCHMODE_API_KEY secret to switch this page on.'}</p>`;
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
        return `<li><div class="grow">
          ${x.url ? `<a class="title" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : `<span class="title">${esc(x.title)}</span>`}
          <span class="what">${esc(what)}</span></div>
          ${s ? `<a class="btn btn-tinted chip" href="#${s.key}">${esc(s.label)}</a>` : ''}</li>`;
      }).join('')}</ul></section>`).join('');
  }
  return `<h1 class="large-title" style="margin-top:24px">New This Week</h1>
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
function wireScroller() {
  const row = $('.posters'); if (!row) return;
  const wrap = row.parentElement, prev = $('.scroller.prev'), next = $('.scroller.next');
  const update = () => {
    const start = row.scrollLeft < 8, end = row.scrollLeft + row.clientWidth >= row.scrollWidth - 8;
    prev.disabled = start; next.disabled = end;
    wrap.classList.toggle('at-start', start); wrap.classList.toggle('at-end', end); // the frosted edges fade away at either end
  };
  const by = (dir) => row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: reduceMotion ? 'auto' : 'smooth' });
  prev.onclick = () => by(-1); next.onclick = () => by(1);
  row.addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();
  wireTilt(row);
}

// Cards lean towards the mouse with a soft sheen where it points. Mouse only, never with reduced motion.
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
function wireTilt(row) {
  if (!finePointer || reduceMotion) return;
  let card = null, raf = 0, ev = null;
  const paint = () => {
    raf = 0; if (!card || !ev) return;
    const r = card.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    card.style.setProperty('--rx', ((0.5 - y) * 9).toFixed(2) + 'deg');
    card.style.setProperty('--ry', ((x - 0.5) * 11).toFixed(2) + 'deg');
    card.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
    card.style.setProperty('--my', (y * 100).toFixed(1) + '%');
  };
  row.addEventListener('pointermove', (e) => {
    const c = e.target.closest('.cover');
    if (c !== card) { card?.classList.remove('tilting'); card = c; card?.classList.add('tilting'); }
    ev = e; if (!raf) raf = requestAnimationFrame(paint);
  });
  row.addEventListener('pointerleave', () => { card?.classList.remove('tilting'); card = null; });
}

// ---------- controls ----------

// ---------- tabs: Shows, Films, New (ported from Channel Crossings) ----------
const tabs = [...document.querySelectorAll('#tabs [role=tab]')], ind = $('#tabInd'), tabNames = tabs.map((t) => t.dataset.tab);
let curTab = null, indX = null;
// the pill under the chosen tab: glides across, stretching a little on the way and settling with a small spring
function placeInd(animate) {
  const b = tabs[tabNames.indexOf(curTab)]; if (!b || !b.offsetWidth) return;
  const x = b.offsetLeft, w = b.offsetWidth;
  if (indX === null || !animate || reduceMotion || !ind.animate) { ind.style.width = w + 'px'; ind.style.transform = `translateX(${x}px)`; indX = x; return; }
  const from = ind.style.transform, fw = ind.style.width, mid = (indX + x) / 2, mw = Math.max(parseFloat(fw), w) * 1.18;
  ind.style.width = w + 'px'; ind.style.transform = `translateX(${x}px)`;
  ind.animate([{ transform: from, width: fw }, { transform: `translateX(${mid - (mw - w) / 2}px)`, width: mw + 'px', offset: 0.45 }, { transform: `translateX(${x}px)`, width: w + 'px' }],
    { duration: 520, easing: 'cubic-bezier(.3,1.15,.4,1)' });
  indX = x;
}
function selectTab(name) {
  const first = curTab === null;
  curTab = name;
  tabs.forEach((t) => { const on = t.dataset.tab === name; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
  placeInd(!first);
}
function openTab(name) {
  if (name === curTab) { scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); return; } // tap the open tab: back to the top
  if (name === 'new') { location.hash = 'new'; return; }
  state.kind = name;
  try { localStorage.setItem('tenner-kind', state.kind); } catch {}
  if (state.route === 'new') location.hash = state.lastChart || 'top'; else render();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => openTab(t.dataset.tab));
  t.addEventListener('keydown', (e) => { // arrow keys move along the tabs, Home and End to the first and last
    const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key]; if (k === undefined) return;
    e.preventDefault(); const n = tabs[(k + tabs.length) % tabs.length]; n.focus(); openTab(n.dataset.tab);
  });
});
addEventListener('resize', () => placeInd(false));
document.fonts?.ready.then(() => placeInd(false));

// ---------- appearance: Auto, Day or Night (ported from Channel Crossings; Night by default) ----------
const root = document.documentElement, modeBtns = document.querySelectorAll('.th-list button');
const mode = () => root.getAttribute('data-theme') || 'auto';
function showTheme() {
  const m = mode();
  modeBtns.forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === m));
  const dark = m === 'dark' || (m === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#thIc').innerHTML = $(`.th-list [data-mode="${dark ? 'dark' : 'light'}"] i`).innerHTML; // the round button: a moon by night, a sun by day
}
// the round button opens a card just under it, lined up with its right edge
function tbMenu(btn, pop, onOpen) {
  const place = () => {
    const r = btn.getBoundingClientRect(), w = pop.offsetWidth, left = Math.max(12, Math.min(r.right - w, innerWidth - w - 12));
    pop.style.top = (r.bottom + 8) + 'px';
    pop.style.maxHeight = Math.max(200, innerHeight - r.bottom - 20) + 'px';
    pop.style.left = left + 'px';
    pop.style.setProperty('--tb-o', `${r.left + r.width / 2 - left}px -14px`); // it grows out of its own button
  };
  const set = (on) => {
    if (on === !pop.hidden && !pop.classList.contains('out')) return;
    btn.setAttribute('aria-expanded', on);
    if (on) {
      pop.classList.remove('out'); pop.hidden = false;
      [...pop.children].forEach((c, i) => c.style.setProperty('--i', i));
      place(); onOpen?.();
    } else if (reduceMotion) pop.hidden = true;
    else { pop.classList.add('out'); setTimeout(() => { if (pop.classList.contains('out')) { pop.hidden = true; pop.classList.remove('out'); } }, 190); }
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); set(pop.hidden || pop.classList.contains('out')); });
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target.isConnected) set(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { set(false); btn.focus({ preventScroll: true }); } });
  addEventListener('resize', () => { if (!pop.hidden) place(); });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', showTheme); // Auto: the icon follows the device
tbMenu($('#thBtn'), $('#thPop'), () => $('#thPop [aria-checked="true"]')?.focus({ preventScroll: true }));
modeBtns.forEach((b) => b.addEventListener('click', () => {
  const n = b.dataset.mode;
  window.tnTheme?.(n);
  try { localStorage.setItem('tenner-theme', n); } catch {}
  showTheme();
}));
showTheme();

// a fade behind the floating bar once the page has scrolled
const onScroll = () => root.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true }); onScroll();

addEventListener('hashchange', () => { route(); scrollTo(0, 0); });
load();

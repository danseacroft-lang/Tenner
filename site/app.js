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

  buildServiceBar();
  showUpdated();
  route();
}

const services = () => state.trending.services;
const svc = (k) => services().find((s) => s.key === k);

// ---------- the service bar: each service as its own app icon in a glass capsule, a pill gliding to the chosen one ----------
const ICON_ALL = '<img src="logo.svg" alt="">';
const ICON_STORE = '<span class="svc-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 8h12l-1 12.5H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>';
function buildServiceBar() {
  const bar = $('#svc');
  const item = (key, label, icon, extra = '') =>
    `<button type="button" role="radio" class="svc-b${extra}" data-svc="${key}" aria-checked="false" tabindex="-1"><span class="svc-ic">${icon}</span><span class="svc-l">${esc(label)}</span></button>`;
  const iconFor = (s) => s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy">` : `<span class="svc-glyph">${esc(s.label[0])}</span>`;
  bar.insertAdjacentHTML('beforeend',
    item('top', 'All', ICON_ALL) +
    services().filter((s) => !s.store).map((s) => item(s.key, s.label, iconFor(s))).join('') +
    services().filter((s) => s.store).map((s) => `<span class="svc-sep" aria-hidden="true"></span>` + item(s.key, s.label, ICON_STORE, ' store')).join(''));
  const btns = () => [...bar.querySelectorAll('.svc-b')];
  bar.addEventListener('click', (e) => { const b = e.target.closest('.svc-b'); if (b) location.hash = b.dataset.svc; });
  bar.addEventListener('keydown', (e) => { // arrow keys move along, like the tabs
    const list = btns(), i = list.indexOf(document.activeElement);
    const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key]; if (k === undefined || i < 0) return;
    e.preventDefault(); const n = list[(k + list.length) % list.length]; n.focus(); location.hash = n.dataset.svc;
  });
  // fade whichever end has more to scroll to
  const edges = () => { const w = bar.parentElement;
    w.classList.toggle('at-start', bar.scrollLeft < 4); w.classList.toggle('at-end', bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 4); };
  bar.addEventListener('scroll', edges, { passive: true });
  addEventListener('resize', () => { placeSvc(false); edges(); });
  requestAnimationFrame(edges);
}
let svcX = null;
function placeSvc(animate) {
  const b = $('.svc-b[aria-checked="true"]'), ind = $('#svcInd'); if (!b || !b.offsetWidth) return;
  const x = b.offsetLeft, w = b.offsetWidth;
  if (svcX === null || !animate || reduceMotion || !ind.animate) { ind.style.width = w + 'px'; ind.style.transform = `translateX(${x}px)`; svcX = x; return; }
  const from = ind.style.transform, fw = ind.style.width, mid = (svcX + x) / 2, mw = Math.max(parseFloat(fw), w) * 1.14;
  ind.style.width = w + 'px'; ind.style.transform = `translateX(${x}px)`;
  ind.animate([{ transform: from, width: fw }, { transform: `translateX(${mid - (mw - w) / 2}px)`, width: mw + 'px', offset: .45 }, { transform: `translateX(${x}px)`, width: w + 'px' }],
    { duration: 520, easing: 'cubic-bezier(.3,1.15,.4,1)' });
  svcX = x;
}
function markService(key) {
  document.querySelectorAll('.svc-b.store, .svc-sep').forEach((el) => { el.hidden = state.kind !== 'movie'; });
  let chosen;
  document.querySelectorAll('.svc-b').forEach((b) => { const on = b.dataset.svc === key; b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; if (on) chosen = b; });
  placeSvc(svcX !== null);
  // keep the chosen one in view when the bar scrolls (phones)
  const bar = $('#svc');
  if (chosen && bar.scrollWidth > bar.clientWidth) {
    const target = chosen.offsetLeft - (bar.clientWidth - chosen.offsetWidth) / 2;
    bar.scrollTo({ left: Math.max(0, target), behavior: svcX === null || reduceMotion ? 'auto' : 'smooth' });
  }
}

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
  if (svc(state.route)?.store) state.kind = 'movie';
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
  selectTab(state.route === 'new' ? 'new' : 'top');
  document.querySelectorAll('.kind [data-kind]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === state.kind)));
  const isNew = state.route === 'new';
  $('#controls').hidden = isNew;
  if (isNew) { view.innerHTML = `<div class="wrap">${pageNew()}</div>`; document.title = 'New this week | Tenner'; return; }

  markService(state.route);

  const s = state.route === 'top' ? null : svc(state.route);
  const list = s ? s[state.kind] : state.trending.overall[state.kind];
  const where = s ? s.label : 'UK streaming';
  $('#heading').textContent = s?.store ? `Top 10 ${words()} to buy or rent` : `Top 10 ${words()}`;
  $('#lede').innerHTML = s?.store ? 'New releases from Apple TV, Sky Store and others'
    : s ? `On ${s.logo ? `<img class="sub-logo" src="${esc(s.logo)}" alt="">` : ''}${esc(s.label)}` : 'On all five services in the UK';
  document.title = s ? `${s.label} Top 10 | Tenner` : 'Tenner';

  const chart = list.length
    ? `${state.trending.sample ? `<p class="notice"><strong>Sample data.</strong> These titles are made up. Add your TMDB key and run the workflow to see the real chart.</p>` : ''}
       ${posterRow(list)}${overview(list, !s, where)}`
    : s?.store
      ? `<div class="empty"><span class="empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 3.5v17M16 3.5v17" stroke="currentColor" stroke-width="2"/></svg></span>
          <h2>Buy or rent is for films</h2><p>Almost every show is already on a subscription, so you'll find them on the five services.</p>
          <button type="button" class="btn btn-tinted" data-go="movie">See films to buy or rent</button></div>`
      : `<div class="empty"><h2>Nothing here right now</h2><p>The chart for ${esc(where)} will be back after the next hourly update.</p><a class="btn btn-tinted" href="#top">See all five services</a></div>`;
  view.innerHTML = `<div class="wrap chart">${chart}</div>`;
  wireScroller(); wireRanks();
}

// The platform's own logo (supplied by TMDB) in place of its name; the name stays for screen readers and as a fallback.
const brand = (s, cls = 'brand-logo') => s.logo
  ? `<img class="${cls}" src="${esc(s.logo)}" alt="${esc(s.label)}" title="${esc(s.label)}">`
  : esc(s.label);
const streaming = () => services().filter((s) => !s.store);
const allBrands = () => streaming().every((s) => s.logo)
  ? `<span class="brand-stack" role="img" aria-label="UK streaming">${streaming().map((s) => `<img src="${esc(s.logo)}" alt="" title="${esc(s.label)}">`).join('')}</span>`
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
// The rainbow sweeps through each number once as the row arrives (rippling along), and again when you hover a card;
// otherwise the numbers are still, so an idle page costs nothing.
const RAINBOW = ['#ff375f', '#ff9f0a', '#ffd60a', '#30d158', '#40c8e0', '#5e5ce6', '#bf5af2', '#ff375f'];
function rankSvg(i) {
  const id = `rk${i}`, n = pad(i + 1);
  const stops = RAINBOW.map((c, k) => `<stop offset="${(k / (RAINBOW.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join('');
  const t = (cls, extra = '') => `<text class="${cls}" x="0" y="104" ${extra}>${n}</text>`;
  return `<svg class="num" viewBox="-24 -24 200 152" aria-hidden="true">
    <defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="-40" y1="0" x2="200" y2="40" spreadMethod="repeat">${stops}
      <animateTransform attributeName="gradientTransform" type="translate" from="-240 -40" to="0 0" dur="2.6s" begin="${(0.15 + i * 0.09).toFixed(2)}s" calcMode="spline" keyTimes="0;1" keySplines=".45 0 .2 1" fill="freeze"/>
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
  const row = $('.posters'); if (!row) return;
  row.addEventListener('pointerover', replay, { signal: rowAbort?.signal });
  row.addEventListener('focusin', replay, { signal: rowAbort?.signal });
}

function posterRow(list) {
  const edge = (side) => `<div class="edge ${side}" aria-hidden="true">${'<i></i>'.repeat(6)}</div>`;
  return `<div class="row-wrap at-start">
    ${edge('l')}${edge('r')}
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
          ${it.backdrop ? `<img src="${esc(it.backdrop.replace('/w1280/', '/w300/'))}" alt="" loading="lazy">` : it.poster ? `<img class="tall" src="${esc(it.poster)}" alt="" loading="lazy">` : placeholder(it)}
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
let rowAbort; // each render gets fresh listeners; the old row's are dropped with it
function wireScroller() {
  rowAbort?.abort(); rowAbort = new AbortController();
  const sig = { signal: rowAbort.signal, passive: true };
  const row = $('.posters'); if (!row) return;
  const wrap = row.parentElement, prev = $('.scroller.prev'), next = $('.scroller.next');
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
  wireTilt(row, sig);
  wireDrag(row, sig);
}

// Drag the row with a mouse: it follows the hand, keeps the fling's momentum, then settles onto the nearest card.
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

// Cards lean towards the mouse with a soft sheen where it points. Mouse only, never with reduced motion.
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
function wireTilt(row, sig) {
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
    if (row.classList.contains('dragging')) return;
    const c = e.target.closest('.cover');
    if (c !== card) { card?.classList.remove('tilting'); card = c; card?.classList.add('tilting'); }
    ev = e; if (!raf) raf = requestAnimationFrame(paint);
  }, sig);
  row.addEventListener('pointerleave', () => { card?.classList.remove('tilting'); card = null; }, sig);
}

// ---------- controls ----------

// ---------- tabs (pages): Top 10, New, Browse, About. The bar itself lives in shell.js ----------
const selectTab = (name) => window.tnShell.select(name);
function openTab(name) {
  if (name === 'about') { location.href = 'about.html'; return; }
  if (name === 'browse') { location.href = 'browse.html'; return; }
  const onNew = state.route === 'new';
  if ((name === 'new') === onNew) { scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); return; } // tap the open tab: back to the top
  location.hash = name === 'new' ? 'new' : (state.lastChart || 'top');
}
window.tnOnTab = openTab;

// ---------- Shows or Films: one switch, the same as on Browse ----------
function setKind(k) {
  if (k === state.kind) return;
  state.kind = k;
  try { localStorage.setItem('tenner-kind', k); } catch {}
  // Buy or rent is films only, so switching to shows takes you back to all services
  if (k === 'tv' && svc(state.route)?.store) { location.hash = 'top'; return; }
  buildServiceBar.refresh?.(); render();
}
document.querySelectorAll('.kind [data-kind]').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)));
view.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) setKind(g.dataset.go); });

addEventListener('hashchange', () => { route(); scrollTo(0, 0); });
load();

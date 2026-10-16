// Tenner front end. Reads data/trending.json and data/new.json (rebuilt hourly by GitHub Actions).
// Routes: #top (all services), #netflix, #disney … (one service), #new (new releases).

const SITE_URL = 'https://danseacroft-lang.github.io/Tenner/';
const SHARE_TEXT = "Tenner: the UK's top 10 shows and films on Netflix, Disney+, Prime Video, HBO Max and Paramount+, updated every hour.";

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
function agoText(iso) {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 3) return 'Updated a few moments ago';
  if (mins < 60) return `Updated ${mins} minutes ago`;
  const h = Math.floor(mins / 60);
  return `Updated ${h} hour${h === 1 ? '' : 's'} ago`;
}
function showUpdated() {
  const d = new Date(state.trending.generatedAt);
  $('#ago').textContent = agoText(state.trending.generatedAt);
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
  document.querySelectorAll('[data-section]').forEach((a) => {
    const on = a.dataset.section === (state.route === 'new' ? 'new' : 'top');
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
  render();
}

function render() {
  const isNew = state.route === 'new';
  $('#controls').hidden = isNew;
  if (isNew) { view.innerHTML = layout(pageNew()); document.title = 'New this week | Tenner'; wireShare(); return; }

  $('#service').value = state.route;
  document.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === state.kind)));

  const s = state.route === 'top' ? null : svc(state.route);
  const list = s ? s[state.kind] : state.trending.overall[state.kind];
  const where = s ? s.label : 'UK streaming';
  $('#heading').textContent = `Top 10 ${words()} on ${where}`;
  document.title = s ? `${s.label} Top 10 | Tenner` : 'Tenner';

  const chart = list.length
    ? `${state.trending.sample ? `<p class="notice"><strong>Sample data.</strong> These titles are made up. Add your TMDB key and run the workflow to see the real chart.</p>` : ''}
       ${posterRow(list)}${overview(list, !s, where)}`
    : `<p class="lede" style="margin-top:24px">No ${words().toLowerCase()} found for ${esc(where)} yet. The provider name may have changed; check data/providers.json after the next update.</p>`;
  view.innerHTML = layout(chart);
  wireScroller(); wireShare();
}

const layout = (chart) => `<div class="wrap layout"><div class="chart">${chart}</div>${shareCard()}</div>`;

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

// Each rank is an SVG so its outline can take the rainbow gradient and glow.
const rankSvg = (i) => `<svg class="num" viewBox="-14 -14 176 124" aria-hidden="true" style="animation-delay:${-i * 1.1}s">
  <text x="0" y="96">${pad(i + 1)}</text></svg>`;

function posterRow(list) {
  return `<div class="row-wrap">
    <button type="button" class="btn btn-icon scroller prev" aria-label="Previous titles" disabled>
      <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><path d="M8 2L2 8l6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <ol class="posters" aria-label="Top 10">
      ${list.map((it, i) => `<li class="pcard">
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
      <tbody>${list.map((it, i) => `<tr>
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

// ---------- share card ----------
const ICONS = {
  // Simple generic glyphs (white on each colour circle).
  wa: '<path d="M12 3.5a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.4-1.1A8.5 8.5 0 1 0 12 3.5z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M9.2 8.6c.3-.5.7-.4.9 0l.6 1.4c.1.3 0 .6-.2.8l-.5.5c.6 1.2 1.6 2.2 2.8 2.8l.5-.5c.2-.2.5-.3.8-.2l1.4.6c.4.2.5.6 0 .9-1.2 1.2-3.2.6-5.1-1.3S8 9.8 9.2 8.6z" fill="#fff"/>',
  im: '<path d="M12 4C7.3 4 3.5 7.1 3.5 11c0 2.1 1.1 4 2.9 5.3-.2 1.4-.9 2.6-1.9 3.4 2 0 3.7-.7 4.9-1.7.8.2 1.7.3 2.6.3 4.7 0 8.5-3.1 8.5-7S16.7 4 12 4z" fill="#fff"/>',
  ms: '<path d="M12 3.5c-4.8 0-8.5 3.5-8.5 8.1 0 2.4 1 4.5 2.7 6v3l2.7-1.5c1 .3 2 .4 3.1.4 4.8 0 8.5-3.5 8.5-8.1S16.8 3.5 12 3.5z" fill="#fff"/><path d="M7 14l3.4-3.6 2 2L16.9 10l-3.4 3.6-2-2z" fill="#0a7cff"/>',
  em: '<rect x="3.5" y="6" width="17" height="12.5" rx="2.5" fill="none" stroke="#fff" stroke-width="2"/><path d="M4.5 7.5 12 13l7.5-5.5" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>',
  cp: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
  mo: '<path d="M12 3.5v11M8 7.5l4-4 4 4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 10.5H6.5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
};
const icon = (k) => `<span class="ico ${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg></span>`;

function shareCard() {
  const msg = encodeURIComponent(`${SHARE_TEXT} ${SITE_URL}`);
  const touch = matchMedia('(pointer: coarse)').matches;
  return `<aside class="share" aria-labelledby="share-h">
    <img src="logo.svg" alt="" width="52" height="52">
    <h2 id="share-h">Do us a favour, pal</h2>
    <p>Share Tenner with your mates. One link, the whole UK top ten, fresh every hour.</p>
    <div class="share-list">
      <a class="btn btn-glass" href="https://wa.me/?text=${msg}" target="_blank" rel="noopener">${icon('wa')}WhatsApp</a>
      <a class="btn btn-glass" href="sms:&body=${msg}">${icon('im')}iMessage</a>
      <a class="btn btn-glass" data-share="messenger" href="${touch ? `fb-messenger://share/?link=${encodeURIComponent(SITE_URL)}` : 'https://www.messenger.com/'}" target="_blank" rel="noopener">${icon('ms')}Messenger</a>
      <a class="btn btn-glass" href="mailto:?subject=${encodeURIComponent('Have you seen Tenner?')}&body=${msg}">${icon('em')}Email</a>
      <button type="button" class="btn btn-glass" data-share="copy">${icon('cp')}<span>Copy link</span></button>
      ${navigator.share ? `<button type="button" class="btn btn-glass" data-share="more">${icon('mo')}More…</button>` : ''}
    </div>
  </aside>`;
}

async function copyLink() {
  try { await navigator.clipboard.writeText(SITE_URL); return true; } catch { return false; }
}
function wireShare() {
  const card = $('.share'); if (!card) return;
  card.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-share]'); if (!el) return;
    const kind = el.dataset.share;
    if (kind === 'copy') {
      e.preventDefault();
      const ok = await copyLink();
      toast(ok ? 'Link copied' : SITE_URL);
      if (ok) { const label = el.querySelector('span:last-child'); label.textContent = 'Copied'; setTimeout(() => (label.textContent = 'Copy link'), 2000); }
    } else if (kind === 'more') {
      e.preventDefault();
      try { await navigator.share({ title: 'Tenner', text: SHARE_TEXT, url: SITE_URL }); } catch {}
    } else if (kind === 'messenger' && !matchMedia('(pointer: coarse)').matches) {
      // Messenger on desktop can't take a pre-filled link, so copy it first.
      if (await copyLink()) toast('Link copied. Paste it into Messenger.');
    }
  });
}

let toastTimer;
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- poster row arrows ----------
function wireScroller() {
  const row = $('.posters'); if (!row) return;
  const prev = $('.scroller.prev'), next = $('.scroller.next');
  const update = () => {
    prev.disabled = row.scrollLeft < 8;
    next.disabled = row.scrollLeft + row.clientWidth >= row.scrollWidth - 8;
  };
  const by = (dir) => row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: reduceMotion ? 'auto' : 'smooth' });
  prev.onclick = () => by(-1); next.onclick = () => by(1);
  row.addEventListener('scroll', update, { passive: true });
  update();
}

// ---------- controls ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-kind]');
  if (!b || !state.trending) return;
  state.kind = b.dataset.kind;
  try { localStorage.setItem('tenner-kind', state.kind); } catch {}
  render();
});
$('.segmented').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const other = $(`.segmented [data-kind="${state.kind === 'tv' ? 'movie' : 'tv'}"]`);
  other.click(); other.focus();
});

addEventListener('hashchange', () => { route(); scrollTo(0, 0); });
load();

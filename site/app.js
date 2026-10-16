// Telly Top front end. Reads data/trending.json and data/new.json (rebuilt hourly by GitHub Actions).
// Routes: #top (all services), #netflix, #bbc … (one service), #new (new releases).

const state = { trending: null, fresh: null, kind: 'tv', route: 'top' };
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const words = () => (state.kind === 'tv' ? 'Shows' : 'Films');
const fmtDate = (d, opts) => d.toLocaleDateString('en-GB', opts);
const fmtTime = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// ---------- data ----------
async function load() {
  try {
    if (window.__TELLY__) {
      ({ trending: state.trending, fresh: state.fresh } = window.__TELLY__);
    } else {
      const v = `?v=${Math.floor(Date.now() / 600000)}`; // fresh copy every 10 minutes
      const [t, f] = await Promise.all([
        fetch('data/trending.json' + v).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
        fetch('data/new.json' + v).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      state.trending = t; state.fresh = f;
    }
  } catch (err) {
    view.innerHTML = `<div class="wrap"><h1 class="large-title">The chart didn't load</h1>
      <p class="when">${esc(err.message)}. If you've just set the site up, run the "Update and deploy" workflow once, then refresh.</p></div>`;
    return;
  }
  try { const k = localStorage.getItem('telly-kind'); if (k === 'tv' || k === 'movie') state.kind = k; } catch {}

  const sel = $('#service');
  sel.innerHTML = `<option value="top">All five services</option>` +
    state.trending.services.map((s) => `<option value="${s.key}">${esc(s.label)}</option>`).join('');
  sel.addEventListener('change', () => { location.hash = sel.value; });

  const d = new Date(state.trending.generatedAt);
  $('#updated').textContent = `Updated ${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })} at ${fmtTime(d)}. Refreshes every hour.`;
  route();
}

const services = () => state.trending.services;
const svc = (k) => services().find((s) => s.key === k);

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
  if (isNew) { view.innerHTML = pageNew(); document.title = 'New this week | Telly Top'; return; }

  $('#service').value = state.route;
  document.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === state.kind)));

  const s = state.route === 'top' ? null : svc(state.route);
  const list = s ? s[state.kind] : state.trending.overall[state.kind];
  const where = s ? s.label : 'UK streaming';
  $('#heading').textContent = `Top 10 ${words()} on ${where}`;
  const d = new Date(state.trending.generatedAt);
  $('#when').textContent = `${fmtDate(d, { day: 'numeric', month: 'long', year: 'numeric' })}, ${fmtTime(d)}`;
  document.title = s ? `${s.label} Top 10 | Telly Top` : 'Telly Top';

  view.innerHTML = list.length ? `
    ${state.trending.sample ? `<div class="wrap"><p class="notice"><strong>Sample data.</strong> These titles are made up. Add your TMDB key and run the workflow to see the real chart.</p></div>` : ''}
    ${posterRow(list)}
    ${overview(list, !s, where)}`
    : `<div class="wrap"><p class="when" style="margin-top:24px">No ${words().toLowerCase()} found for ${esc(where)} yet. The provider name may have changed; check data/providers.json after the next update.</p></div>`;
  wireScroller();
}

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

function posterRow(list) {
  return `<div class="row-wrap">
    <button type="button" class="scroller prev" aria-label="Previous titles" disabled>
      <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><path d="M8 2L2 8l6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <ol class="posters" aria-label="Top 10">
      ${list.map((it, i) => `<li class="pcard">
        <span class="num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
        <a class="cover" href="${esc(it.url)}" target="_blank" rel="noopener" aria-label="Number ${i + 1}: ${esc(it.title)}">
          ${it.poster ? `<img src="${esc(it.poster)}" alt="" loading="${i < 4 ? 'eager' : 'lazy'}" width="342" height="513">` : placeholder(it)}
        </a>
        <h3><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
        <p class="sub">${meta(it)}</p>
      </li>`).join('')}
    </ol>
    <button type="button" class="scroller next" aria-label="Next titles">
      <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  </div>`;
}

function overview(list, showWhere, where) {
  const d = new Date(state.trending.generatedAt);
  return `<section class="overview" aria-labelledby="ov-h"><div class="wrap">
    <h2 id="ov-h">Top 10 ${words()} Overview</h2>
    <p class="when">${esc(where)}, ${fmtDate(d, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <div class="table-scroll"><table>
      <thead><tr>
        <th scope="col">Ranking</th><th scope="col">Title</th>
        <th scope="col" class="num hide-sm">Year</th><th scope="col" class="num">Rating</th>
        <th scope="col" class="${showWhere ? '' : 'num hide-sm'}">${showWhere ? 'Where to watch' : 'Popularity'}</th>
      </tr></thead>
      <tbody>${list.map((it, i) => `<tr>
        <td class="rank">${String(i + 1).padStart(2, '0')}</td>
        <td><div class="tcell">
          ${it.backdrop ? `<img src="${esc(it.backdrop.replace('/w1280/', '/w300/'))}" alt="" loading="lazy">` : it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy">` : placeholder(it)}
          <div style="min-width:0"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
          ${it.overview ? `<p class="ov">${esc(it.overview)}</p>` : ''}</div>
        </div></td>
        <td class="num hide-sm">${it.year ?? '–'}</td>
        <td class="num">${it.rating ? `<span class="star">★</span> ${it.rating.toFixed(1)}` : '–'}</td>
        ${showWhere
          ? `<td><span class="chips">${(it.on || []).map((k) => svc(k)).filter(Boolean).map((s) => `<a class="chip" href="#${s.key}">${esc(s.label)}</a>`).join('')}</span></td>`
          : `<td class="num hide-sm">${Math.round(it.popularity).toLocaleString('en-GB')}</td>`}
      </tr>`).join('')}</tbody>
    </table></div>
  </div></section>`;
}

function pageNew() {
  const f = state.fresh;
  let body;
  if (!f || f.disabled || f.error) {
    body = `<p class="when">${f?.error ? 'The new-releases feed failed on the last update. It will try again next hour.' : 'Add a WATCHMODE_API_KEY secret to switch this page on.'}</p>`;
  } else if (!f.items.length) {
    body = `<p class="when">Nothing new on these services this week.</p>`;
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
          ${s ? `<a class="chip" href="#${s.key}">${esc(s.label)}</a>` : ''}</li>`;
      }).join('')}</ul></section>`).join('');
  }
  return `<div class="wrap" style="padding-top:24px">
    <h1 class="large-title">New This Week</h1>
    <p class="when">Arriving over the last and next seven days. Dates come from US listings, so a few UK dates may differ.</p>
    ${state.trending.sample ? `<p class="notice"><strong>Sample data.</strong> These titles are made up.</p>` : ''}
    ${body}</div>`;
}

// Arrow buttons for the poster row (hidden on touch screens).
function wireScroller() {
  const row = $('.posters'); if (!row) return;
  const prev = $('.scroller.prev'), next = $('.scroller.next');
  const update = () => {
    prev.disabled = row.scrollLeft < 8;
    next.disabled = row.scrollLeft + row.clientWidth >= row.scrollWidth - 8;
  };
  const by = (dir) => row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  prev.onclick = () => by(-1); next.onclick = () => by(1);
  row.addEventListener('scroll', update, { passive: true });
  update();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-kind]');
  if (!b || !state.trending) return;
  state.kind = b.dataset.kind;
  try { localStorage.setItem('telly-kind', state.kind); } catch {}
  render();
});
// Arrow keys move between the two segments, like a native segmented control.
$('.segmented').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const other = $(`.segmented [data-kind="${state.kind === 'tv' ? 'movie' : 'tv'}"]`);
  other.click(); other.focus();
});

addEventListener('hashchange', () => { route(); scrollTo(0, 0); });
load();

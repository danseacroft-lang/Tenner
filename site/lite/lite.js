// Tenner, experimental: the Top 10, Search, a title's details and where to watch it, and the Watchlist. Nothing else.
// Reads the same hourly data as the standard Tenner (../data) and shares its Watchlist and theme on this device.
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    raw(k) { try { return localStorage.getItem(k); } catch { return null; } },
    put(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const stamp = Math.floor(Date.now() / 600000);
  const get = (f) => fetch(`../data/${f}?v=${stamp}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const API = 'https://tenner-api.danseacroft.workers.dev';
  const keyOf = (id, type) => (/^\d+$/.test(String(id ?? '')) ? `${type === 'movie' ? 'm' : 't'}${id}` : null);
  const info = new Map();   // every title on screen, by key, with what the sheet needs
  const remember = (x) => { if (x.k) info.set(x.k, { ...info.get(x.k), ...x }); return x.k; };

  // ---------- the Top 10 ----------
  let trending = null, labels = {};
  let kind = store.raw('tenner-kind') === 'movie' ? 'movie' : 'tv', svc = store.get('tenner-lite-svc', 'all');
  const svcSel = $('#svc');
  function row(it, i, type, sub) {
    const k = remember({ k: keyOf(it.id, type), type, title: it.title, year: it.year, poster: it.poster, overview: it.overview, rating: it.rating, on: it.on });
    const m = it.mv, mv = m === 'new' ? '<span class="mv up">NEW</span>' : m > 0 ? `<span class="mv up" aria-label="Up ${m}">▲${m}</span>` : m < 0 ? `<span class="mv dn" aria-label="Down ${-m}">▼${-m}</span>` : '';
    return `<li><button type="button" class="row t" data-k="${esc(k || '')}"><span class="n">${i + 1}</span>
      ${it.poster ? `<img class="p" src="${esc(it.poster.replace('/w342/', '/w154/'))}" alt="" loading="lazy" decoding="async">` : '<span class="p"></span>'}
      <span class="grow"><span class="tt">${esc(it.title)}</span><span class="st">${[sub, mv].filter(Boolean).join(' ')}</span></span><i class="chev" aria-hidden="true"></i></button></li>`;
  }
  function drawChart() {
    if (!trending) return;
    const s = svc === 'all' ? null : trending.services.find((x) => x.key === svc);
    const list = (s ? s[kind] : trending.overall[kind]) || [];
    $('#chart').innerHTML = list.map((it, i) => row(it, i, it.type || kind,
      [it.year, s ? (it.rating ? `★ ${it.rating.toFixed(1)}` : '') : (it.on || []).map((k) => labels[k]).filter(Boolean).join(', ')].filter(Boolean).join(' · '))).join('');
    const when = new Date(trending.generatedAt);
    $('#topNote').textContent = !list.length ? `No ${kind === 'tv' ? 'shows' : 'films'} on this chart right now.`
      : `${trending.sample ? 'Sample data. ' : ''}Updated ${when.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}, ${when.toLocaleDateString('en-GB', { weekday: 'long' })}`;
  }
  document.querySelectorAll('[name="kind"]').forEach((r) => {
    r.checked = r.value === kind;
    r.addEventListener('change', () => { kind = r.value; store.put('tenner-kind', kind); drawChart(); });
  });
  svcSel.addEventListener('change', () => { svc = svcSel.value; store.set('tenner-lite-svc', svc); drawChart(); });
  get('trending.json').then((t) => {
    if (!t) { $('#topNote').textContent = 'Couldn’t load the chart. Check your connection.'; return; }
    trending = t;
    for (const s of t.services) labels[s.key] = s.label;
    svcSel.insertAdjacentHTML('beforeend', t.services.map((s) => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join(''));
    if (![...svcSel.options].some((o) => o.value === svc)) svc = 'all';
    svcSel.value = svc; drawChart(); openFromUrl();
  });

  // ---------- Search: the catalogue on this device first, then everything on TMDB ----------
  let cat = null, catP = null;
  const loadCat = () => (catP ||= get('browse.json').then((b) => {
    cat = (b?.items || []).map((x) => { const type = x.t === 'movie' ? 'movie' : 'tv';
      return { k: keyOf(x.i, type), type, title: x.n, year: x.d ? +x.d.slice(0, 4) : null, poster: x.img ? (b.img || '') + x.img : null, rating: x.r, on: x.s, pop: x.p || 0 }; })
      .filter((x) => x.k);
  }));
  // the catalogue's descriptions, by key ([description, backdrop]), for sheets opened from Search or the Watchlist
  let moreP = null;
  const more = () => (moreP ||= get('browse-more.json').then((m) => m?.items || {}));
  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const q = $('#q');
  let web = null, webT = 0;
  const resultRow = (x) => {
    remember(x);
    return `<li><button type="button" class="row t" data-k="${esc(x.k)}">${x.poster ? `<img class="p" src="${esc(x.poster.replace('/w342/', '/w154/'))}" alt="" loading="lazy" decoding="async">` : '<span class="p"></span>'}
      <span class="grow"><span class="tt">${esc(x.title)}</span><span class="st">${esc([x.type === 'movie' ? 'Film' : 'Show', x.year].filter(Boolean).join(' · '))}</span></span><i class="chev" aria-hidden="true"></i></button></li>`;
  };
  async function search() {
    const term = fold(q.value);
    clearTimeout(webT); web?.abort();
    if (!term) { $('#results').innerHTML = ''; $('#searchNote').textContent = ''; return; }
    await loadCat(); if (fold(q.value) !== term) return;
    const words = term.split(' ');
    const local = cat.filter((x) => { const n = fold(x.title); return words.every((w) => n.includes(w)); })
      .sort((a, b) => (fold(b.title).startsWith(term) - fold(a.title).startsWith(term)) || b.pop - a.pop).slice(0, 30);
    $('#results').innerHTML = local.map(resultRow).join('');
    $('#searchNote').textContent = term.length < 2 ? '' : 'Searching everything…';
    if (term.length < 2) return;
    webT = setTimeout(async () => {
      web = new AbortController();
      try {
        const r = await fetch(`${API}/search?q=${encodeURIComponent(q.value.trim())}`, { signal: web.signal });
        const d = r.ok ? await r.json() : null; if (fold(q.value) !== term) return;
        const have = new Set(local.map((x) => x.k));
        const more = (d?.results || []).filter((x) => !have.has(x.k)).map((x) => ({ ...x, year: x.year ? +x.year : null, poster: x.poster ? d.img + x.poster : null }));
        $('#results').insertAdjacentHTML('beforeend', more.map(resultRow).join(''));
        $('#searchNote').textContent = !d ? 'Couldn’t search everything right now.' : local.length + more.length ? '' : `Nothing found for “${q.value.trim()}”.`;
      } catch (e) { if (e.name !== 'AbortError') $('#searchNote').textContent = 'Couldn’t search everything right now.'; }
    }, 300);
  }
  q.addEventListener('input', search);
  q.addEventListener('focus', loadCat, { once: true });

  // ---------- the Watchlist (the same one the standard Tenner keeps) ----------
  const WL = 'tenner-watchlist';
  const saved = () => { const l = store.get(WL, []); return Array.isArray(l) ? l.filter((x) => x?.k) : []; };
  const isSaved = (k) => saved().some((x) => x.k === k);
  function toggleSaved(x) {
    const l = saved(), on = l.some((s) => s.k === x.k);
    store.set(WL, on ? l.filter((s) => s.k !== x.k)
      : [{ k: x.k, type: x.type, title: x.title, year: x.year || null, poster: x.poster || null, at: Date.now() }, ...l].slice(0, 500));
    drawSaved(); return !on;
  }
  function drawSaved() {
    const l = saved();
    $('#saved').innerHTML = l.map(resultRow).join('');
    $('#wlNote').textContent = l.length ? `${l.length} title${l.length === 1 ? '' : 's'}` : 'Nothing here yet. Open a show or film and choose Add to Watchlist.';
  }
  addEventListener('storage', (e) => { if (e.key === WL) drawSaved(); });

  // ---------- a title's sheet ----------
  const sheet = $('#sheet'), body = $('#shBody');
  let current = null, detP = null;
  const details = () => (detP ||= get('titles.json'));
  const { brand, link } = window.tnLinks;   // ../links.js: every service's tested link, shared with Tenner
  const runtime = (m) => !m ? '' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
  const tmdb = (x) => `https://www.themoviedb.org/${x.type}/${x.k.slice(1)}`;

  function whereHtml(x, d) {
    const it = d?.items?.[x.k];
    if (!it) return `<p class="foot">${d ? 'No where-to-watch details for this one yet.' : 'Loading where to watch…'}</p>`;
    const seen = new Set();
    const group = (label, ids) => {
      const rows = (ids || []).map((id) => [id, ...(d.providers[id] || [])]).filter(([, n]) => n && !seen.has(brand(n)) && seen.add(brand(n))).map(([, n, logo]) => {
        const b = brand(n), href = link(n, x.title, it.ln || {}, { watch: `${tmdb(x)}/watch?locale=GB` });
        return `<a class="row" href="${esc(href)}" target="_blank" rel="noopener">${logo && d.logo ? `<img class="lg" src="${esc(d.logo + logo)}" alt="">` : `<span class="lg">${esc(b[0])}</span>`}<span class="grow">${esc(b)}</span><i class="chev" aria-hidden="true"></i></a>`;
      }).join('');
      return rows ? `<h3 class="head">${label}</h3><div class="list">${rows}</div>` : '';
    };
    return [group('Included with', it.f), group('Free', it.fr), group('Rent', it.re), group('Buy', it.bu)].join('')
      || '<p class="foot">Not available to stream, rent or buy in the UK right now.</p>';
  }
  function draw(x, d) {
    const it = d?.items?.[x.k] || {}, on = isSaved(x.k);
    const meta = [x.type === 'movie' ? 'Film' : it.se ? `${it.se} season${it.se === 1 ? '' : 's'}` : 'Show', x.year, runtime(it.rt), it.c, x.rating ? `★ ${Number(x.rating).toFixed(1)}` : ''].filter(Boolean).join(' · ');
    body.innerHTML = `<div class="sh-top">${x.poster ? `<img class="p" src="${esc(x.poster)}" alt="">` : '<span class="p"></span>'}
        <div><h2 id="shT">${esc(x.title)}</h2><p>${esc(meta)}</p>${it.g?.length ? `<p>${esc(it.g.join(', '))}</p>` : ''}</div></div>
      <div class="sh-acts"><button type="button" class="btn${on ? ' on' : ''}" data-act="save" aria-pressed="${on}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11v17L12 16.6 6.5 20.5z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>${on ? 'In Watchlist' : 'Add to Watchlist'}</button></div>
      ${x.overview ? `<p class="ov">${esc(x.overview)}</p>` : ''}
      ${whereHtml(x, d)}
      <p class="foot">Where-to-watch information from JustWatch, via TMDB. <a href="${esc(tmdb(x))}" target="_blank" rel="noopener">More on TMDB</a></p>`;
  }
  async function open(k) {
    const x = info.get(k); if (!x) return;
    current = x; draw(x, null);
    if (!sheet.open) sheet.showModal();
    body.scrollTop = 0;
    if (!x.overview) { const o = (await more())[k]?.[0]; if (o) remember({ k, overview: o }); }
    let d = await details();
    if (!d?.items?.[k]) {   // a title Tenner doesn't follow: straight from TMDB, through Tenner's search API
      const a = await fetch(`${API}/title/${k}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (a) { if (a.info) remember({ ...a.info, ...Object.fromEntries(Object.entries(x).filter(([, v]) => v)) }); d = a; }
    }
    if (current?.k === k) draw(info.get(k), d || {});
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]'); if (b?.dataset.k) { open(b.dataset.k); return; }
    if (e.target.closest('[data-act="save"]') && current) { toggleSaved(current); details().then((d) => current && draw(current, d)); }
  });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });   // tap outside the sheet to close it
  sheet.addEventListener('close', () => { current = null; if (new URLSearchParams(location.search).has('t')) history.replaceState(null, '', location.pathname + location.hash); });
  // a shared link (?t=…) opens that title
  async function openFromUrl() {
    const k = new URLSearchParams(location.search).get('t'); if (!k || !/^[mt]\d+$/.test(k)) return;
    if (!info.has(k)) {
      const a = await fetch(`${API}/title/${k}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!a?.info) return; remember(a.info);
    }
    open(k);
  }

  // ---------- Settings ----------
  const theme = $('#theme');
  const applyTheme = (t) => { if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  theme.value = ['light', 'dark'].includes(store.raw('tenner-theme')) ? store.raw('tenner-theme') : 'auto';
  theme.addEventListener('change', () => { store.put('tenner-theme', theme.value); applyTheme(theme.value); });
  $('#classic').addEventListener('click', () => { store.set('tenner-build'); location.href = '../'; });   // back to the standard Tenner

  // ---------- tabs ----------
  const PAGES = ['top', 'search', 'watchlist', 'settings'];
  function route() {
    const p = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'top';
    for (const id of PAGES) $(`#${id}`).hidden = id !== p;
    document.querySelectorAll('[data-tab]').forEach((a) => (a.dataset.tab === p ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    if (p === 'watchlist') drawSaved();
    document.title = p === 'top' ? 'Tenner' : `${$(`#${p} h1`).textContent} | Tenner`;
    scrollTo(0, 0);
  }
  addEventListener('hashchange', route); route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(() => {});
})();

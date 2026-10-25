// Tenner Browse: the hour's catalogue (data/browse.json), filtered and sorted in the browser.
// State lives in the URL (#c=top&k=movie&s=netflix,disney&g=18&sort=rating&r=7&y=1990-2010&a=12&rt=60), so any view can be
// shared or bookmarked.
(() => {
  const { esc, hue, arrows, reduce } = window.tn;   // from shell.js
  const $ = (s) => document.querySelector(s);
  const PAGE = 48;
  const daysAgo = (n) => new Date(Date.now() - n * 864e5).toLocaleDateString('en-CA');   // your own date (YYYY-MM-DD), worked out each time, so it's right past midnight

  // Collections: a filter plus the sort that suits it. New this week and Leaving soon come from data/new.json (the services'
  // own arrivals and departures), in order of the day; titles there that the catalogue doesn't have are added just for them.
  const COLLECTIONS = [
    { key: 'popular', label: 'Popular', sort: 'pop', test: (x) => x.s.length },
    { key: 'week', label: 'New this week', extra: true, order: (a, b) => b._new.localeCompare(a._new) || b.p - a.p, test: (x) => x._new },
    { key: 'new', label: 'New releases', sort: 'new', test: (x) => x.s.length && x.d >= daysAgo(150) && x.d <= daysAgo(0) },
    { key: 'top', label: 'Top rated', sort: 'rating', test: (x) => x.s.length && x.r >= 7.6 && x.v >= 300 },
    { key: 'gems', label: 'Hidden gems', sort: 'rating', test: (x) => x.s.length && x.r >= 7.2 && x.v >= 30 && x.v < 600 },
    { key: 'acclaimed', label: 'Acclaimed', sort: 'rating', test: (x) => x.s.length && x.r >= 8 && x.v >= 1500 },
    { key: 'leaving', label: 'Leaving soon', extra: true, order: (a, b) => a._gone.localeCompare(b._gone) || b.p - a.p, test: (x) => x._gone },
    { key: 'store', label: 'Buy or rent', sort: 'pop', test: (x) => x.b, films: true },
  ];
  // Filters beyond genre and rating: age rating (UK certificates), length (minutes; episodes for shows) and release years.
  // Certificates and lengths come from the title details (data/titles.json), loaded the first time either is used.
  const AGES = [['', 'Any'], ['U', 'U'], ['PG', 'PG'], ['12', '12'], ['15', '15']];
  const AGE_RANK = { U: 0, PG: 1, 12: 2, '12A': 2, 15: 3, 18: 4, R18: 5 };
  const LENS = [['', 'Any'], ['30', '30 min'], ['60', '1 hour'], ['90', '90 min'], ['120', '2 hours']];
  const THIS_YEAR = new Date().getFullYear();
  let firstYear = 1950;
  const SORTS = [
    { key: 'pop', label: 'Most popular', fn: (a, b) => b.p - a.p },
    { key: 'rating', label: 'Highest rated', fn: (a, b) => b.r - a.r || b.v - a.v },
    { key: 'new', label: 'Newest', fn: (a, b) => b.d.localeCompare(a.d) },
    { key: 'old', label: 'Oldest', fn: (a, b) => (a.d || '9').localeCompare(b.d || '9') },
    { key: 'az', label: 'A to Z', fn: (a, b) => a.n.localeCompare(b.n, 'en-GB', { sensitivity: 'base' }) },
  ];

  let cat = null, logos = {}, labels = {}, shown = 0, list = [];
  const shops = new Set();   // stores (Sky Store): in the Where to watch filter, not in My services
  const state = { c: 'popular', k: 'tv', s: [], g: [], sort: null, r: 0, q: '', y: null, a: '', rt: '' };

  // ---------- URL <-> state ----------
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    state.c = COLLECTIONS.some((c) => c.key === q.get('c')) ? q.get('c') : 'popular';
    state.k = ['movie', 'both'].includes(q.get('k')) ? q.get('k') : 'tv';
    // no services in the address: your own (My services), if you've chosen them; "all" means all six
    const mine = window.tn.mine.get().filter((k) => labels[k]);
    state.s = q.get('s') === 'all' ? [] : q.has('s') ? q.get('s').split(',').filter((k) => labels[k]) : mine;
    state.g = (q.get('g') || '').split(',').map(Number).filter((g) => cat.genres[g]);
    state.sort = SORTS.some((s) => s.key === q.get('sort')) ? q.get('sort') : null;
    state.r = Math.min(9, Math.max(0, parseFloat(q.get('r')) || 0));
    state.q = (q.get('q') || '').slice(0, 80);
    const y = (q.get('y') || '').split('-').map(Number);
    state.y = y.length === 2 && y.every((n) => n >= 1900 && n <= THIS_YEAR) && y[0] <= y[1] ? y : null;
    state.a = AGES.some(([v]) => v && v === q.get('a')) ? q.get('a') : '';
    state.rt = LENS.some(([v]) => v && v === q.get('rt')) ? q.get('rt') : '';
    if (collection().films) state.k = 'movie';
  }
  function writeHash() {
    const q = new URLSearchParams();
    if (state.c !== 'popular') q.set('c', state.c);
    if (state.k !== 'tv') q.set('k', state.k);
    const mine = window.tn.mine.get().filter((k) => labels[k]);
    const same = state.s.length === mine.length && state.s.every((k) => mine.includes(k));
    if (!same) q.set('s', state.s.length ? state.s.join(',') : 'all');
    if (state.g.length) q.set('g', state.g.join(','));
    if (state.sort) q.set('sort', state.sort);
    if (state.r) q.set('r', state.r);
    if (state.y) q.set('y', state.y.join('-'));
    if (state.a) q.set('a', state.a);
    if (state.rt) q.set('rt', state.rt);
    if (state.q) q.set('q', state.q);
    const h = q.toString();
    history.replaceState(null, '', h ? '#' + h : location.pathname);
  }
  const collection = () => COLLECTIONS.find((c) => c.key === state.c);
  const kindOk = (x) => state.k === 'both' || x.t === state.k;   // Shows, Films or Both
  const sortKey = () => state.sort || collection().sort || '';   // '' : the collection's own order (by the day)

  // ---------- data ----------
  Promise.all([
    fetch('data/browse.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    fetch('data/trending.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    window.tn.prefs.get().no18 ? window.tnSheet?.details() : null,   // Settings: "Hide titles rated 18" needs the certificates
    fetch('data/new.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([c, t, d, f]) => {
    cat = c; certs = d; fresh = f; mergeFresh();
    for (const s of t?.services || []) if (!s.store) { logos[s.key] = s.logo; labels[s.key] = s.label; if (s.shop) shops.add(s.key); }
    if (!Object.keys(labels).length) Object.assign(labels, { netflix: 'Netflix', disney: 'Disney+', prime: 'Prime Video', hbomax: 'HBO Max', paramount: 'Paramount+', appletv: 'Apple TV' });
    const wantSearch = location.hash === '#search';
    if (wantSearch) history.replaceState(null, '', location.pathname);
    readHash(); buildControls(); apply(false);
    if (wantSearch) $('#q').focus();
    const openShared = () => {   // ?t=…: a shared title, or Forward back to one
      const shared = new URL(location.href).searchParams.get('t'), sx = shared && item(shared);
      if (!shared || window.tnSheet?.isOpen()) return;
      if (sx) sheetFor(sx).then((info) => window.tnSheet?.open(info, true));
      else window.tnSheet?.openKey?.(shared);
    };
    openShared(); addEventListener('popstate', openShared);
    if (!wantSearch && !state.q && !new URL(location.href).searchParams.has('t')) setTimeout(welcome, 900);   // not over a search from the address bar
  }).catch((err) => {
    $('#count').textContent = `The catalogue didn't load (${err.message}). It's rebuilt every hour, so try again shortly.`;
  });

  // ---------- a one-time note: Browse is a work in progress, and feedback is welcome ----------
  function welcome() {
    try { if (localStorage.getItem('tenner-browse-note')) return; localStorage.setItem('tenner-browse-note', '1'); } catch { return; }
    if (window.tnSheet?.isOpen() || document.querySelector('dialog[open]')) return;
    document.body.insertAdjacentHTML('beforeend', `<dialog class="mine-dlg bn-dlg" id="bnDlg" aria-labelledby="bnH" aria-describedby="bnP"><form method="dialog">
      <span class="bn-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10.5 3.5l1.8 4.9 4.9 1.8-4.9 1.8-1.8 4.9-1.8-4.9-4.9-1.8 4.9-1.8z" fill="currentColor"/><path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" fill="currentColor"/></svg></span>
      <h2 id="bnH">Hey you!</h2>
      <p id="bnP">We’re constantly improving Browse, adding new features every day. You might see some features come and go as we test them out.</p>
      <div class="bn-acts"><button class="btn bn-ok" value="ok" autofocus>Got it</button><a class="bn-fb" href="contact.html?about=Feedback">Send us feedback</a></div>
    </form></dialog>`);
    const d = $('#bnDlg');
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });   // a tap outside closes it, as on iPhone
    d.addEventListener('close', () => d.remove());
    d.showModal();
  }

  // New catalogue while the page is open: take it in quietly. Near the top of the page the grid redraws straight
  // away; further down it waits for your next filter or search, so the posters never shift under you.
  addEventListener('tn:check', () => {
    if (!cat) return;
    fetch(`data/browse.json?v=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((c) => {
      if (!c?.items?.length || c.generatedAt === cat.generatedAt) return;
      cat = c; mergeFresh();
      if (scrollY < 400 && !document.activeElement?.matches('input')) apply(false);
    }).catch(() => {});
  });

  // New this week and Leaving soon: mark the catalogue's titles with the day, and add the ones it doesn't have
  let fresh = null;
  function mergeFresh() {
    if (!cat?.items) return;
    cat.items = cat.items.filter((x) => !x._x);
    for (const x of cat.items) { delete x._new; delete x._gone; }
    const byKey = new Map(cat.items.map((x) => [`${x.t[0]}${x.i}`, x]));
    const add = (f, field) => {
      if (!f.id || !f.date) return;
      const t = f.type === 'movie' ? 'movie' : 'tv', k = `${t[0]}${f.id}`;
      let x = byKey.get(k);
      if (!x) { x = { i: f.id, t, n: f.title, d: f.date, r: 0, v: 0, p: 0, img: f.poster || null, g: [], s: [], _x: 1 }; cat.items.push(x); byKey.set(k, x); }
      if (f.service && !x.s.includes(f.service)) x.s.push(f.service);
      if (!x[field] || (field === '_new' ? f.date > x[field] : f.date < x[field])) x[field] = f.date;
    };
    const today = daysAgo(0), weekAgo = daysAgo(7);
    for (const f of fresh?.items || []) if (f.date >= weekAgo && f.date <= today) add(f, '_new');
    for (const f of fresh?.leaving || []) if (f.date >= today) add(f, '_gone');
    firstYear = Math.max(1920, Math.floor(Math.min(...cat.items.map((x) => +x.d.slice(0, 4) || THIS_YEAR)) / 10) * 10);
  }
  // the title details (certificates, lengths), the first time they're wanted
  let detailsP = null;
  const needDetails = () => { if (!certs && !detailsP && window.tnSheet?.details) detailsP = window.tnSheet.details().then((d) => { certs = d; apply(false); }); };

  // ---------- controls ----------
  function buildControls() {
    // collections: a row of big words, the chosen one underlined in rainbow
    $('#coll').insertAdjacentHTML('beforeend', COLLECTIONS.map((c) =>
      `<button type="button" role="radio" class="coll-b" data-c="${c.key}" aria-checked="false">${esc(c.label)}</button>`).join(''));
    $('#coll').addEventListener('click', (e) => { const b = e.target.closest('.coll-b'); if (!b) return;
      state.c = b.dataset.c; state.sort = null; if (collection().films) state.k = 'movie'; apply(true); });
    // the words as big as they can be with every collection on one line (22px down to 14px); on phones they scroll sideways
    const track = $('#coll'), fitColl = () => {
      const bs = [...track.querySelectorAll('.coll-b')]; if (!bs.length || !track.clientWidth) return;
      track.style.setProperty('--cfs', '22px');
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0, words = bs.reduce((n, b) => n + b.offsetWidth, 0);
      const fs = Math.min(22, Math.floor(22 * (track.clientWidth - 4 - gap * (bs.length - 1)) / words * 10) / 10);
      track.style.setProperty('--cfs', `${Math.max(14, fs)}px`);
    };
    new ResizeObserver(fitColl).observe(track); document.fonts?.ready.then(fitColl);

    const setKind = (k) => {
      if (collection().films && k !== 'movie') state.c = 'popular';
      state.k = k; state.g = state.g.filter((g) => genreSet().has(g)); apply(true);
    };
    document.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)));
    arrows($('.cmd .segmented'), () => [...document.querySelectorAll('[data-kind]')], (b) => setKind(b.dataset.kind));
    window.tn.segment($('.cmd .segmented'), (b) => setKind(b.dataset.kind));
    arrows($('#coll'), () => [...document.querySelectorAll('.coll-b')], (b) => b.click());
    arrows($('#sort'), () => [...document.querySelectorAll('.s-b')], (b) => b.click());
    $('#grid').addEventListener('click', (e) => {   // the empty state's button clears whatever is hiding the results
      const c = e.target.closest('[data-clear]'); if (!c) return;
      if (c.dataset.clear === 'q') { state.q = ''; apply(true); $('#q').focus(); } else $('#clear').click();
    });

    $('#where').innerHTML = Object.keys(labels).map((k) => `<button type="button" class="w-b" data-s="${k}" aria-pressed="false" title="${esc(labels[k])}">
      <span class="w-ic">${logos[k] ? `<img src="${esc(logos[k])}" alt="">` : esc(labels[k][0])}</span><span>${esc(labels[k])}</span></button>`).join('');
    $('#mineLink').addEventListener('click', () => window.tn.pickMine(Object.keys(labels).filter((k) => !shops.has(k)).map((k) => ({ key: k, label: labels[k], logo: logos[k] }))));
    addEventListener('tn:mine', () => { readHash(); apply(false); });
    $('#where').addEventListener('click', (e) => { const b = e.target.closest('.w-b'); if (!b) return;
      const k = b.dataset.s; state.s = state.s.includes(k) ? state.s.filter((x) => x !== k) : [...state.s, k]; apply(true); });

    $('#sort').innerHTML = SORTS.map((s) => `<button type="button" role="radio" class="s-b" data-sort="${s.key}" aria-checked="false">${esc(s.label)}<i aria-hidden="true"></i></button>`).join('');
    $('#sort').addEventListener('click', (e) => { const b = e.target.closest('.s-b'); if (!b) return; state.sort = b.dataset.sort; apply(true); });

    $('#genres').addEventListener('click', (e) => { const b = e.target.closest('.g-b'); if (!b) return;
      const g = +b.dataset.g; state.g = state.g.includes(g) ? state.g.filter((x) => x !== g) : [...state.g, g]; apply(true); });

    const rating = $('#rating');
    rating.addEventListener('input', () => { state.r = +rating.value; paintRating(); apply(true, true); });

    // age rating and length: one choice each (tap it again for Any)
    const chips = (box, opts, key) => {
      $(box).innerHTML = opts.map(([v, l]) => `<button type="button" role="radio" class="g-b" data-v="${v}" aria-checked="false">${esc(l)}</button>`).join('');
      $(box).addEventListener('click', (e) => { const b = e.target.closest('.g-b'); if (!b) return; state[key] = state[key] === b.dataset.v ? '' : b.dataset.v; apply(true); });
      arrows($(box), () => [...$(box).querySelectorAll('.g-b')], (b) => b.click());
    };
    chips('#ages', AGES, 'a'); chips('#lens', LENS, 'rt');
    // released: two thumbs on one track
    const lo = $('#yLo'), hi = $('#yHi');
    for (const r of [lo, hi]) { r.min = firstYear; r.max = THIS_YEAR; }
    $('#yScale').innerHTML = [firstYear, Math.round((firstYear + THIS_YEAR) / 2 / 10) * 10, THIS_YEAR].map((y) => `<span>${y}</span>`).join('');
    const years = (e) => {
      let a = +lo.value, b = +hi.value;
      if (a > b) { if (e.target === lo) a = b; else b = a; }
      state.y = a <= firstYear && b >= THIS_YEAR ? null : [a, b]; apply(true, true);
    };
    lo.addEventListener('input', years); hi.addEventListener('input', years);

    $('#clear').addEventListener('click', () => { Object.assign(state, { s: [], g: [], sort: null, r: 0, y: null, a: '', rt: '' }); apply(true); });

    // posters or a list (remembered on this device)
    const sw = $('#viewSw'), setView = (v) => {
      sw.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', b.dataset.view === v));
      for (const g of [$('#grid'), $('#webGrid')]) g.classList.toggle('as-list', v === 'list');
      try { localStorage.setItem('tenner-browse-view', v); } catch {}
    };
    sw.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });
    arrows(sw, () => [...sw.querySelectorAll('button')], (b) => setView(b.dataset.view));
    let view = 'grid'; try { view = localStorage.getItem('tenner-browse-view') === 'list' ? 'list' : 'grid'; } catch {}
    setView(view);

    $('#surprise').addEventListener('click', surprise);

    // search: results as you type; / or ⌘K jumps to the box (shell.js); Escape clears it
    const qi = $('#q');
    qi.addEventListener('input', () => { state.q = qi.value; apply(true, true); if (scrollY > 300) scrollTo({ top: 0, behavior: 'auto' }); });
    qi.addEventListener('keydown', (e) => { if (e.key === 'Escape' && qi.value) { e.preventDefault(); state.q = ''; apply(true); } if (e.key === 'Enter') qi.blur(); });
    $('#qClear').addEventListener('click', () => { state.q = ''; apply(true); qi.focus(); });

    // phones: the filters open as a sheet from the bottom
    const sheet = $('#filters'), scrim = $('#scrim'), openBtn = $('#openFilters');
    const setSheet = (on) => {
      sheet.classList.toggle('open', on); scrim.hidden = !on; openBtn.setAttribute('aria-expanded', on);
      document.documentElement.classList.toggle('sheet-open', on);
      // the rest of the page goes inert (the browser's own way to keep taps, focus and screen readers in the sheet)
      for (let el = sheet; el && el !== document.body; el = el.parentElement)
        for (const sib of el.parentElement.children) if (sib !== el && sib !== scrim && !sib.contains(scrim)) sib.inert = on;
      if (on) sheet.querySelector('button')?.focus({ preventScroll: true });
    };
    openBtn.addEventListener('click', () => setSheet(true));
    $('#done').addEventListener('click', () => { setSheet(false); openBtn.focus(); });
    scrim.addEventListener('click', () => setSheet(false));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.classList.contains('open')) setSheet(false); });

    new IntersectionObserver((es) => { if (es[0].isIntersecting) more(); }, { rootMargin: '600px 0px' }).observe($('#more'));
    addEventListener('hashchange', () => { readHash(); apply(false); });
  }

  const genreSet = () => new Set(cat.items.filter(kindOk).flatMap((x) => x.g));
  function paintRating() {
    const r = $('#rating'); r.value = state.r;
    $('#ratingOut').textContent = state.r ? `${state.r}+` : 'Any';
    r.style.setProperty('--fill', `${(state.r / 9) * 100}%`);
  }

  try { localStorage.removeItem('tenner-searches'); localStorage.removeItem('tenner-recent'); } catch {}   // recent searches and Recently Viewed were tried and taken out: tidy away what they kept

  // ---------- search ----------
  // Accents, case and punctuation don't matter: 'Amelie' finds 'Amélie', 'spiderman' finds 'Spider-Man'.
  const fold = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const tight = (t) => t.replace(/ /g, '');
  function score(x, q) {           // higher is better; 0 means no match
    if (!x._f) { x._f = fold(x.n); x._t = tight(x._f); x._a = x._f.replace(/^(the|a|an) /, ''); x._i = x._f.split(' ').map((w) => w[0]).join(''); }
    const tq = tight(q);
    if (x._f === q || x._a === q) return 100;
    if (x._f.startsWith(q) || x._a.startsWith(q)) return 80;
    if ((' ' + x._f).includes(' ' + q)) return 60;            // a word starts with it
    if (x._t.includes(tq)) return 40;                          // ignoring spaces and dashes
    const words = q.split(' ');
    if (words.length > 1 && words.every((w) => x._f.includes(w) || (w.length > 1 && x._i.includes(w)))) return 30;   // initials count: 'svu'
    if (q.length > 1 && !q.includes(' ') && x._i === q) return 50;
    return 0;
  }

  // ---------- filtering ----------
  let certs = null;
  const det = (x) => certs?.items?.[`${x.t[0]}${x.i}`];
  const no18 = window.tn.prefs.get().no18;
  const ok18 = (x) => !no18 || !certs || det(x)?.c !== '18';
  // released, age rating and length (the last two wait for the details, then filter)
  const okMore = (x) => (!state.y || ((+x.d.slice(0, 4) || 0) >= state.y[0] && (+x.d.slice(0, 4) || 0) <= state.y[1]))
    && (!state.a || !certs || (det(x)?.c in AGE_RANK && AGE_RANK[det(x).c] <= AGE_RANK[state.a]))
    && (!state.rt || !certs || (det(x)?.rt && det(x).rt <= +state.rt));
  function apply(user, quiet) {
    const col = collection();
    if (state.a || state.rt) needDetails();
    const sortFn = state.sort ? SORTS.find((s) => s.key === state.sort).fn : col.order || SORTS.find((s) => s.key === col.sort).fn;
    const q = fold(state.q);
    if (q) {
      // searching looks across shows and films and every collection, closest matches first
      list = cat.items.map((x) => [x, score(x, q)]).filter(([x, sc]) => sc && ok18(x) && okMore(x)
        && (!state.g.length || x.g.some((g) => state.g.includes(g)))
        && (!state.r || x.r >= state.r))
        .sort((a, b) => (state.sort ? sortFn(a[0], b[0]) : (b[1] - a[1] || b[0].p - a[0].p))).map(([x]) => x);
    } else list = cat.items.filter((x) => kindOk(x) && (col.extra || !x._x) && col.test(x) && ok18(x) && okMore(x)
      && (!state.s.length || col.key === 'store' || x.s.some((k) => state.s.includes(k)))
      && (!state.g.length || x.g.some((g) => state.g.includes(g)))
      && (!state.r || x.r >= state.r)).sort(sortFn);

    // controls reflect state
    document.querySelectorAll('.coll-b').forEach((b) => b.setAttribute('aria-checked', b.dataset.c === state.c));
    { const tr = $('#coll'), on = tr.querySelector('[aria-checked="true"]');   // phones: the chosen one slides into view
      if (on && tr.scrollWidth > tr.clientWidth + 1) tr.scrollTo({ left: Math.max(0, on.offsetLeft - tr.clientWidth / 2 + on.offsetWidth / 2), behavior: reduce ? 'auto' : 'smooth' }); }
    document.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-checked', b.dataset.kind === state.k));
    document.querySelectorAll('.w-b').forEach((b) => b.setAttribute('aria-pressed', state.s.includes(b.dataset.s)));
    $('#pWhere').hidden = col.key === 'store';
    document.querySelectorAll('.s-b').forEach((b) => b.setAttribute('aria-checked', b.dataset.sort === (q && !state.sort ? '' : sortKey())));   // searching: best match first unless you pick a sort
    const gs = [...genreSet()].filter((g) => cat.genres[g]).sort((a, b) => cat.genres[a].localeCompare(cat.genres[b]));
    $('#genres').innerHTML = gs.map((g) => `<button type="button" class="g-b" data-g="${g}" aria-pressed="${state.g.includes(g)}">${esc(cat.genres[g])}</button>`).join('');
    paintRating();
    document.querySelectorAll('#ages .g-b').forEach((b) => b.setAttribute('aria-checked', b.dataset.v === state.a));
    document.querySelectorAll('#lens .g-b').forEach((b) => b.setAttribute('aria-checked', b.dataset.v === state.rt));
    $('#yLo').value = state.y ? state.y[0] : firstYear; $('#yHi').value = state.y ? state.y[1] : THIS_YEAR;
    $('#yearOut').textContent = !state.y ? 'Any time' : state.y[0] === state.y[1] ? state.y[0] : `${state.y[0]} to ${state.y[1]}`;
    const span = THIS_YEAR - firstYear || 1;
    $('#yLo').parentElement.style.setProperty('--a', `${((+$('#yLo').value - firstYear) / span) * 100}%`);
    $('#yLo').parentElement.style.setProperty('--b', `${((+$('#yHi').value - firstYear) / span) * 100}%`);
    const n = (state.s.length ? 1 : 0) + state.g.length + (state.r ? 1 : 0) + (state.sort ? 1 : 0) + (state.y ? 1 : 0) + (state.a ? 1 : 0) + (state.rt ? 1 : 0);   // services count once, however many
    $('#fCount').hidden = !n; $('#fCount').textContent = n;
    $('#clear').disabled = !n;

    // nothing on the services: no "0 results" line; the full catalogue's results below say it
    $('#count').textContent = !q || (!list.length && window.tn.api) ? '' : `${list.length.toLocaleString('en-GB')} on the six services`;
    document.body.classList.toggle('searching', !!q);

    document.body.classList.toggle('mixed', !!q || state.k === 'both');   // show/film labels on the tiles when both are listed
    $('#qClear').hidden = !state.q;
    if ($('#q').value !== state.q) $('#q').value = state.q;
    if (!quiet) writeHash(); else clearTimeout(apply.t), (apply.t = setTimeout(writeHash, 250));

    // swap the grid (a quick crossfade where the browser can)
    const draw = () => { shown = 0; $('#grid').innerHTML = ''; more(); empty(); };
    webSearch();
    if (user && !quiet && document.startViewTransition && !reduce) document.startViewTransition(draw).ready.catch(() => {}); else draw();
    if (!q) { spotlight(); moods(); } else $('#moods').hidden = true;
    rows();
  }

  // ---------- the spotlight: five of the best of whatever you're browsing, each a full-width picture for a few seconds ----------
  // The wide artwork comes from browse-more.json (fetched once, after the grid); just the pictures, no card over them.
  // It moves on by itself unless Animations are off, you're pointing at it, or a sheet is open.
  const still = () => reduce || document.documentElement.classList.contains('still');
  const spot = { key: '', picks: [], at: 0, timer: 0 }, fk = (x) => `${x.t[0]}${x.i}`;
  const kindWord = () => (state.k === 'movie' ? 'Films' : state.k === 'both' ? 'Shows and films' : 'Shows');
  async function spotlight() {
    const col = collection();
    $('#spotEye').textContent = `${col.label} · ${col.films ? 'Films' : kindWord()}${state.s.length && col.key !== 'store' ? ` · ${state.s.length === 1 ? labels[state.s[0]] : `${state.s.length} services`}` : ''}`;
    const m = await moreData(); if (!m?.items) return;
    // five of the top 24 with wide artwork, led by the ones you haven't seen in the spotlight lately (each title once)
    const pool = list.slice(0, 24).filter((x) => m.items[fk(x)]?.[1]), key = pool.map(fk).join(',');
    if (key === spot.key) return;
    const picks = window.tn.featured.pick(pool, fk, 5);
    spot.key = key; spot.picks = picks; spot.at = 0; clearInterval(spot.timer);
    const art = $('#spotArt');
    if (!picks.length) { art.innerHTML = ''; $('#spot').classList.remove('has-art'); return; }
    art.innerHTML = picks.map((x, i) => `<img ${i ? 'data-' : 'fetchpriority="high" '}src="${esc(m.img.replace('/w780', '/w1280') + m.items[`${x.t[0]}${x.i}`][1])}" alt="" decoding="async">`).join('');
    $('#spot').classList.add('has-art');
    showSpot(0);
    if (!still() && picks.length > 1) spot.timer = setInterval(() => { if (!document.hidden && !window.tnSheet?.isOpen() && !$('#spot').matches(':hover')) showSpot(spot.at + 1); }, 7000);
  }
  function showSpot(n) {
    const imgs = [...$('#spotArt').children], picks = spot.picks; if (!picks.length) return;
    spot.at = (n + picks.length) % picks.length; window.tn.featured.saw(fk(picks[spot.at]));
    const want = (img) => { if (img?.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; } };
    want(imgs[spot.at]); want(imgs[(spot.at + 1) % imgs.length]);
    imgs.forEach((img, i) => img.classList.toggle('on', i === spot.at));
  }
  // swipe the spotlight on a phone or tablet
  let spX = null;
  $('#spot').addEventListener('touchstart', (e) => { spX = [e.touches[0].clientX, e.touches[0].clientY]; }, { passive: true });
  $('#spot').addEventListener('touchend', (e) => {
    if (!spX || spot.picks.length < 2) return; const t = e.changedTouches[0], dx = t.clientX - spX[0], dy = t.clientY - spX[1]; spX = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) { showSpot(spot.at + (dx < 0 ? 1 : -1)); clearInterval(spot.timer); }
  }, { passive: true });

  // ---------- explore by genre: a tile for each of the biggest genres, three of its best posters fanned out ----------
  function moods() {
    const box = $('#moods');
    if (state.g.length || collection().key === 'store') { box.hidden = true; return; }
    const pool = cat.items.filter((x) => !x._x && kindOk(x) && x.img && x.s.length && ok18(x) && (!state.s.length || x.s.some((k) => state.s.includes(k))));
    const count = new Map(); for (const x of pool) for (const g of new Set(x.g)) count.set(g, (count.get(g) || 0) + 1);
    // Animation is left out; Sci-Fi (TV's "Sci-Fi & Fantasy", films' "Science Fiction") always gets a tile if there's enough of it
    const SCIFI = [10765, 878], ok = ([g, n]) => cat.genres[g] && g !== 16 && n >= 6;
    const ranked = [...count].filter(ok).sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, 8), sci = [...count].filter(([g, n]) => SCIFI.includes(g) && cat.genres[g] && n >= 3).sort((a, b) => b[1] - a[1])[0];
    if (sci && !top.some(([g]) => g === sci[0])) top.splice(Math.min(top.length, 7), 1, sci);
    if (top.length < 3) { box.hidden = true; return; }
    box.innerHTML = `<h2 class="moods-h">Explore by genre</h2><div class="moods-row">${top.map(([g, n]) => {
      const best = pool.filter((x) => x.g.includes(g)).sort((a, b) => b.p - a.p).slice(0, 3);
      return `<button type="button" class="mood" data-g="${g}">
        <img class="mood-bg" src="${esc(best[0].img.startsWith('/') ? cat.img + best[0].img : best[0].img)}" alt="" loading="lazy" aria-hidden="true">
        <span class="mood-fan" aria-hidden="true">${best.map((x, j) => `<img src="${esc(x.img.startsWith('/') ? cat.img + x.img : x.img)}" alt="" loading="lazy" style="--j:${j}">`).join('')}</span>
        <span class="mood-l"><b>${esc(cat.genres[g])}</b><small>${n} ${state.k === 'movie' ? 'films' : state.k === 'both' ? 'titles' : 'shows'}</small></span></button>`;
    }).join('')}</div>`;
    box.hidden = false;
  }
  $('#moods').addEventListener('click', (e) => {
    const b = e.target.closest('.mood'); if (!b) return;
    state.g = [+b.dataset.g]; apply(true);
    $('#cmdMark').scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'start' });
  });

  // ---------- the command bar: glass that firms up once it's holding on at the top ----------
  new IntersectionObserver(([e]) => $('#cmd').classList.toggle('stuck', !e.isIntersecting && e.boundingClientRect.top < 200), { rootMargin: '-90px 0px 0px 0px' }).observe($('#cmdMark'));

  // ---------- posters lean towards the pointer, with a sheen of light across them (computers) ----------
  const tiltOk = () => fine.matches && !still();
  let tiltEl = null, tiltRaf = 0;
  function tilt(e) {
    const art = e.target?.closest?.('.tile .art');
    if (art !== tiltEl) { if (tiltEl) { tiltEl.style.removeProperty('--rx'); tiltEl.style.removeProperty('--ry'); tiltEl.classList.remove('tilt'); } tiltEl = art; }
    if (!art || !tiltOk()) return;
    cancelAnimationFrame(tiltRaf);
    tiltRaf = requestAnimationFrame(() => {
      const r = art.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      art.classList.add('tilt');
      art.style.setProperty('--rx', `${((0.5 - py) * 14).toFixed(2)}deg`); art.style.setProperty('--ry', `${((px - 0.5) * 16).toFixed(2)}deg`);
      art.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`); art.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
    });
  }
  for (const g of [$('#grid'), $('#webGrid')]) { g.addEventListener('pointermove', tilt, { passive: true }); g.addEventListener('pointerleave', () => tilt({ target: null }), { passive: true }); }

  function empty() {
    if (list.length) return;
    if (web.on) { $('#grid').innerHTML = ''; return; }   // searching everything: the results below say it
    $('#grid').innerHTML = `<li class="none"><h2>No matches</h2><p>${state.q ? 'Nothing in this hour\'s catalogue matches that. Try a shorter search, or fewer filters.' : 'Try fewer filters, or a different collection.'}</p>
      <button type="button" class="btn btn-tinted" data-clear="${state.q ? 'q' : 'filters'}">${state.q ? 'Clear search' : 'Clear filters'}</button></li>`;
  }

  // ---------- hover preview (computers): rest the pointer on a poster and its details pop up beside it ----------
  // Title, show or film, year, rating, genres, the description and where to watch, without leaving Browse. The
  // descriptions and artwork live in data/browse-more.json, fetched the first time someone hovers.
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  let moreP = null, pvTimer = 0, pvFor = null;
  const moreData = () => (moreP ||= fetch('data/browse-more.json').then((r) => (r.ok ? r.json() : null)).catch(() => null));
  const pv = Object.assign(document.createElement('div'), { className: 'pv', id: 'pv', hidden: true });
  pv.setAttribute('role', 'tooltip'); document.body.append(pv);
  const item = (k) => cat?.items.find((x) => `${x.t[0]}${x.i}` === k);
  function pvHtml(x, extra) {
    const [ov, bd] = extra || [];
    const art = bd && extra.base ? `<img src="${esc(extra.base + bd)}" alt="" decoding="async">`
      : x.img ? `<img class="soft" src="${esc(x.img.startsWith('/') ? cat.img + x.img : x.img)}" alt="" decoding="async">`
      : `<span class="ph" style="background:linear-gradient(160deg,hsl(${hue(x.n)} 45% 42%),hsl(${(hue(x.n) + 40) % 360} 55% 18%))"></span>`;
    const meta = [x.t === 'tv' ? 'Show' : 'Film', (x.d || '').slice(0, 4), x.r ? `★ ${x.r.toFixed(1)}${x.v ? ` (${x.v.toLocaleString('en-GB')})` : ''}` : ''].filter(Boolean);
    const genres = [...new Set(x.g.map((g) => cat.genres[g]).filter(Boolean))].slice(0, 3).join(' · ');
    const where = x.s.map((k) => `<span class="pv-svc">${logos[k] ? `<img src="${esc(logos[k])}" alt="">` : ''}${esc(labels[k] || k)}</span>`).join('')
      + (x.b ? '<span class="pv-svc buy">Buy or rent</span>' : '');
    return `<div class="pv-art">${art}</div>
      <div class="pv-body">
        <h3>${esc(x.n)}</h3>
        <p class="pv-meta">${meta.map(esc).join(' · ')}</p>
        ${genres ? `<p class="pv-genres">${esc(genres)}</p>` : ''}
        <p class="pv-ov">${extra ? esc(ov || 'No description yet.') : '<span class="pv-wait"></span><span class="pv-wait short"></span>'}</p>
        ${where ? `<div class="pv-where"><span class="pv-l">Where to watch</span><div>${where}</div></div>` : ''}
        <p class="pv-hint">Click for where to watch</p>
      </div>`;
  }
  function placePv(tile) {
    const r = tile.querySelector('.art').getBoundingClientRect(), w = pv.offsetWidth, h = pv.offsetHeight, gap = 14;
    const right = r.right + gap + w <= innerWidth - 12;
    const left = right ? r.right + gap : Math.max(12, r.left - gap - w);
    pv.style.left = left + 'px';
    pv.style.top = Math.min(Math.max(12, r.top - 8), innerHeight - h - 12) + 'px';
    pv.style.transformOrigin = right ? 'left center' : 'right center';
  }
  async function showPv(tile) {
    const x = item(tile.dataset.k); if (!x) return;
    pvFor = tile; tile.querySelector('a')?.setAttribute('aria-describedby', 'pv');
    const m = moreP && await Promise.race([moreData(), Promise.resolve(undefined)]);   // already here? use it now
    pv.innerHTML = pvHtml(x, m?.items?.[tile.dataset.k] && Object.assign([...m.items[tile.dataset.k]], { base: m.img }));
    pv.hidden = false; pv.classList.remove('in'); placePv(tile); requestAnimationFrame(() => pv.classList.add('in'));
    if (!m) moreData().then((d) => {   // the first time: fill in the description and artwork as soon as they arrive
      if (pvFor !== tile) return;
      const e = d?.items?.[tile.dataset.k];
      pv.innerHTML = pvHtml(x, Object.assign([...(e || ['', ''])], { base: d?.img })); placePv(tile);
    });
  }
  function hidePv() {
    clearTimeout(pvTimer); if (!pvFor) return;
    pvFor.querySelector('a')?.removeAttribute('aria-describedby'); pvFor = null; pv.hidden = true; pv.classList.remove('in');
  }
  const grid = $('#grid');
  // click a poster: where to watch, in Tenner (sheet.js); Cmd/Ctrl-click still opens TMDB in a new tab
  async function sheetFor(x) {
    const k = `${x.t[0]}${x.i}`, m = await moreData(), e = m?.items?.[k] || [];
    return {
      k, type: x.t, title: x.n, year: (x.d || '').slice(0, 4) || null, rating: x.r || null,
      poster: x.img ? (x.img.startsWith('/') ? cat.img + x.img : x.img) : null, backdrop: e[1] && m?.img ? m.img + e[1] : null, overview: e[0] || '',
      genres: [...new Set(x.g.map((g) => cat.genres[g]).filter(Boolean))].slice(0, 3),
      tmdb: `https://www.themoviedb.org/${x.t}/${x.i}`, services: x.s.map((s) => ({ label: labels[s] || s, logo: logos[s] })),
    };
  }
  grid.addEventListener('click', async (e) => {
    const a = e.target.closest('.tile a'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault(); hidePv();
    const x = item(a.closest('.tile').dataset.k); if (x) window.tnSheet?.open(await sheetFor(x));
  });
  grid.addEventListener('mouseover', (e) => {
    const t = e.target.closest('.tile'); if (!fine.matches || !t || t === pvFor) return;
    clearTimeout(pvTimer); if (pvFor) hidePv();
    pvTimer = setTimeout(() => showPv(t), pvFor === null && !pv.dataset.warm ? 420 : 120);   // quicker once one is open
  });
  grid.addEventListener('mouseout', (e) => { const t = e.target.closest('.tile'); if (t && !t.contains(e.relatedTarget)) { hidePv(); pv.dataset.warm = '1'; clearTimeout(pv.coolT); pv.coolT = setTimeout(() => delete pv.dataset.warm, 600); } });
  grid.addEventListener('focusin', (e) => { const t = e.target.closest('.tile'); if (t && e.target.matches(':focus-visible')) showPv(t); });
  grid.addEventListener('focusout', hidePv);
  addEventListener('scroll', hidePv, { passive: true });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePv(); });

  // ---------- searching everything: films and shows Tenner doesn't follow, from TMDB via the search API ----------
  // Below this hour's catalogue matches, as you type (after a short pause). Each opens the same title sheet.
  const web = { on: false, q: '', t: 0, ctl: null, items: new Map() };
  function webSearch() {
    const q = state.q.trim(), box = $('#web');
    web.on = !!window.tn.api && q.length >= 2;
    if (!web.on) { box.hidden = true; web.q = ''; web.ctl?.abort(); return; }
    box.classList.add('merged');   // one list: the services' matches first, then every other film and show (TMDB)
    $('#webH').textContent = list.length ? 'Every other film and show' : `Results for “${q}”`;
    if (q === web.q) return;
    web.q = q; web.page = 0; web.pages = 1; clearTimeout(web.t); web.ctl?.abort();
    web.items = new Map(); $('#webGrid').innerHTML = '';
    box.hidden = false; $('#webNote').textContent = 'Searching…';
    web.t = setTimeout(() => webMore(), 280);
  }
  async function webMore() {
    const q = web.q; if (!q || web.busy || web.page >= web.pages) return;
    web.busy = true; web.ctl = new AbortController();
    try {
      const r = await fetch(`${window.tn.api}/search?q=${encodeURIComponent(q)}${web.page ? `&page=${web.page + 1}` : ''}`, { signal: web.ctl.signal });
      const d = r.ok ? await r.json() : null; if (web.q !== q) return;
      web.page = d?.page || web.page + 1; web.pages = d?.pages || web.page;
      const have = new Set([...list.map((x) => `${x.t[0]}${x.i}`), ...web.items.keys()]);
      const res = (d?.results || []).filter((x) => !have.has(x.k));
      for (const x of res) web.items.set(x.k, { ...x, poster: x.poster ? d.img + x.poster : null, backdrop: x.backdrop ? d.bd + x.backdrop : null });
      $('#webGrid').insertAdjacentHTML('beforeend', res.map((x, i) => webCard(web.items.get(x.k), i)).join(''));
      $('#web').classList.toggle('solo', !list.length);   // nothing in the catalogue: these are the results
      const n = web.items.size;
      $('#webNote').textContent = !d ? 'Couldn’t search everything right now.' : n ? `${n.toLocaleString('en-GB')}${web.page < web.pages ? '+' : ''}${list.length ? '' : ' · not on the six services right now'}` : list.length ? '' : `Nothing found for “${q}”. Try another spelling.`;
      if (!list.length && !n) { web.on = false; $('#web').hidden = true; empty(); }
    } catch (e) { if (e.name !== 'AbortError') $('#webNote').textContent = 'Couldn’t search everything right now.'; }
    finally { web.busy = false; }
  }
  // the next page of every other film and show as you near the end
  new IntersectionObserver((es) => { if (es[0].isIntersecting && web.on) webMore(); }, { rootMargin: '800px 0px' }).observe($('#webEnd'));
  function webCard(x, i) {
    const h = hue(x.title);
    const art = x.poster ? `<img src="${esc(x.poster)}" alt="" loading="lazy" decoding="async" width="342" height="513">`
      : `<span class="ph" style="background:linear-gradient(160deg,hsl(${h} 45% 42%),hsl(${(h + 40) % 360} 55% 18%))">${esc(x.title)}</span>`;
    return `<li class="tile" style="--d:${i}" data-wk="${esc(x.k)}">
      <a href="https://www.themoviedb.org/${x.type}/${x.k.slice(1)}" target="_blank" rel="noopener">
        <span class="art">${art}${x.rating ? `<span class="score" aria-label="Rated ${x.rating} out of 10"><b>${x.rating.toFixed(1)}</b></span>` : ''}</span>
        <span class="t">${esc(x.title)}</span>
        <span class="kind-l">${x.type === 'tv' ? 'Show' : 'Film'}</span>
        <span class="m"><span>${esc(x.year || '')}</span></span>
        ${x.rating ? `<span class="l-r">★ ${x.rating.toFixed(1)}</span>` : ''}
      </a>${saveBtn(x.k, x.title)}</li>`;
  }
  $('#webGrid').addEventListener('click', (e) => {
    const a = e.target.closest('.tile a'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    const x = web.items.get(a.closest('.tile').dataset.wk); if (!x) return;
    e.preventDefault();
    window.tnSheet?.open({ k: x.k, type: x.type, title: x.title, year: x.year, rating: x.rating, poster: x.poster, backdrop: x.backdrop, overview: x.overview,
      tmdb: `https://www.themoviedb.org/${x.type}/${x.k.slice(1)}`, services: [] });
  });

  // ---------- + to save, from the grid, the list or the rows ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-save]'); if (!b || !b.closest('.bwrap')) return;
    e.preventDefault(); e.stopPropagation();
    const k = b.dataset.save, x = item(k), w = web.items.get(k);
    const info = x ? { k, type: x.t, title: x.n, year: (x.d || '').slice(0, 4) || null, poster: x.img ? (x.img.startsWith('/') ? cat.img + x.img : x.img) : null }
      : w ? { k, type: w.type, title: w.title, year: w.year, poster: w.poster } : null;
    if (!info) return;
    const on = window.tn.saved.toggle(info);
    if (on && !reduce && b.animate) b.animate([{ scale: 1 }, { scale: 1.25 }, { scale: 1 }], { duration: 360, easing: 'cubic-bezier(.3,1.5,.5,1)' });
  }, true);
  addEventListener('tn:saved', () => document.querySelectorAll('[data-save]').forEach((b) => {
    const on = window.tn.saved.has(b.dataset.save);
    if (String(on) === b.getAttribute('aria-pressed')) return;
    b.setAttribute('aria-pressed', on); b.innerHTML = on ? TICK : PLUS;
    b.title = on ? 'In your Watchlist' : 'Add to Watchlist';
    b.setAttribute('aria-label', b.getAttribute('aria-label').replace(/^[^:]+/, b.title));
  }));

  // ---------- Surprise me: a good one at random from whatever you're looking at ----------
  async function surprise() {
    const good = list.filter((x) => x.img && x.r >= 6.8 && !x._x);
    const pool = (good.length >= 5 ? good : list).slice(0, 80);
    if (!pool.length) return;
    const x = pool[Math.floor(Math.pow(Math.random(), 1.4) * pool.length)];   // the better ones a little more often
    const b = $('#surprise'); if (!reduce && b.animate) b.querySelector('svg').animate([{ rotate: '0deg' }, { rotate: '360deg' }], { duration: 500, easing: 'cubic-bezier(.3,.9,.3,1)' });
    window.tnSheet?.open({ ...(await sheetFor(x)), eye: 'Tenner’s surprise pick' });
  }

  // ---------- For You (from your Watchlist and your stars): a row of posters above the genres ----------
  // the genres of what you've starred count double, what you've saved once; nothing you've saved or starred is suggested
  function forYou() {
    const saved = window.tn.saved.all(), starred = window.tn.stars.all();
    const liked = starred.map((k) => item(k)).filter((x) => x && !x._x), have = saved.map((s) => item(s.k)).filter((x) => x && !x._x);
    if (!liked.length && !have.length) return null;
    const w = new Map(), add = (x, n) => { for (const g of new Set(x.g)) w.set(g, (w.get(g) || 0) + n); };
    for (const x of have) add(x, 1); for (const x of liked) add(x, 2);
    const skip = new Set([...saved.map((s) => s.k), ...starred]);
    const picks = cat.items.filter((x) => !x._x && x.img && kindOk(x) && ok18(x) && x.r >= 6.5 && x.v >= 50 && !skip.has(`${x.t[0]}${x.i}`)
        && (state.s.length ? x.s.some((k) => state.s.includes(k)) : x.s.length))
      .map((x) => [x, x.g.reduce((n, g) => n + (w.get(g) || 0), 0) * x.r * Math.log10(10 + x.v)]).filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, 14).map(([x]) => x);
    if (picks.length < 4) return null;
    const near = (l) => l.find((h) => h.g.some((g) => picks[0].g.includes(g)));
    const star = near(liked), because = star || near(have) || liked[0] || have[0];
    return { picks, because, how: star || (!near(have) && liked[0]) ? 'liked' : 'saved' };
  }
  function rows() {
    const box = $('#bRows');
    if (state.q || state.g.length || state.c !== 'popular') { box.hidden = true; return; }
    const poster = (x) => x.img ? (x.img.startsWith('/') ? cat.img + x.img : x.img) : null;
    const art = (src, title) => src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : `<span class="ph" style="background:linear-gradient(160deg,hsl(${hue(title)} 45% 42%),hsl(${(hue(title) + 40) % 360} 55% 18%))">${esc(title)}</span>`;
    const fy = forYou();
    box.innerHTML = (fy ? `<section class="b-row" aria-labelledby="fyH"><div class="b-row-hd"><h2 id="fyH">For You</h2><p>Because you ${fy.how} ${esc(fy.because.n)}</p></div>
        <ul class="nr">${fy.picks.map((x) => `<li><a href="https://www.themoviedb.org/${x.t}/${x.i}" target="_blank" rel="noopener" data-row="${x.t[0]}${x.i}">
          <span class="nr-art">${art(poster(x), x.n)}</span><b>${esc(x.n)}</b><small>${esc([x.t === 'tv' ? 'Show' : 'Film', (x.d || '').slice(0, 4), x.r ? `★ ${x.r.toFixed(1)}` : ''].filter(Boolean).join(' · '))}</small></a></li>`).join('')}</ul></section>` : '');
    box.hidden = !box.innerHTML;
  }
  $('#bRows').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-row]'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault();
    const x = item(a.dataset.row); if (x) window.tnSheet?.open(await sheetFor(x));
  });
  // saving or starring changes For You (once the sheet has closed, so nothing moves under it)
  addEventListener('tn:saved', () => cat && !window.tnSheet?.isOpen() && rows());
  addEventListener('tn:sheet-closed', () => cat && rows());

  // ---------- the grid ----------
  const fmt = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const day = (d) => d === daysAgo(0) ? 'today' : new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  const TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 12.5l3.6 3.6 7.4-8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // + on a poster: straight into the Watchlist, without opening it (a tick once it's in)
  const saveBtn = (k, title) => { const on = window.tn.saved.has(k);
    return `<button type="button" class="t-add" data-save="${esc(k)}" aria-pressed="${on}" aria-label="${on ? 'In your Watchlist' : 'Add to Watchlist'}: ${esc(title)}" title="${on ? 'In your Watchlist' : 'Add to Watchlist'}">${on ? TICK : PLUS}</button>`; };
  function card(x, i) {
    const url = `https://www.themoviedb.org/${x.t}/${x.i}/watch?locale=GB`;
    const h = hue(x.n);
    const art = x.img
      ? `<img src="${esc(x.img.startsWith('/') ? cat.img + x.img : x.img)}" alt="" loading="lazy" decoding="async" width="342" height="513">`
      : `<span class="ph" style="background:linear-gradient(160deg,hsl(${h} 45% 42%),hsl(${(h + 40) % 360} 55% 18%))">${esc(x.n)}</span>`;
    const where = x.s.slice(0, 3).map((k) => logos[k] ? `<img src="${esc(logos[k])}" alt="${esc(labels[k])}" title="${esc(labels[k])}">` : '').join('');
    return `<li class="tile" style="--d:${i % PAGE}" data-k="${x.t[0]}${x.i}">
      <a href="${esc(url)}" target="_blank" rel="noopener">
        <span class="art">${art}${x.r ? `<span class="score" aria-label="Rated ${x.r} out of 10"><b>${x.r.toFixed(1)}</b></span>` : ''}</span>
        <span class="t">${esc(x.n)}</span>
        <span class="kind-l">${x.t === 'tv' ? 'Show' : 'Film'}</span>
        <span class="m"><span>${esc(state.c === 'week' && x._new ? `Arrived ${day(x._new)}` : state.c === 'leaving' && x._gone ? `Leaves ${day(x._gone)}` : fmt(x.d))}</span>${where ? `<span class="on">${where}</span>` : x.b ? '<span class="buy">Buy or rent</span>' : ''}</span>
        ${x.r ? `<span class="l-r">★ ${x.r.toFixed(1)}</span>` : ''}
      </a>${saveBtn(`${x.t[0]}${x.i}`, x.n)}</li>`;
  }
  function more() {
    if (shown >= list.length) return;
    const next = list.slice(shown, shown + PAGE);
    $('#grid').insertAdjacentHTML('beforeend', next.map((x, i) => card(x, shown + i)).join(''));
    shown += next.length;
  }

})();

// Tenner Browse: the hour's catalogue (data/browse.json), filtered and sorted in the browser.
// State lives in the URL (#c=top&k=movie&s=netflix,disney&g=18&sort=rating&r=7&y=1990-2010&a=12&rt=60), so any view can be
// shared or bookmarked.
(() => {
  const { esc, hue, arrows } = window.tn;   // from shell.js
  const reduce = () => document.documentElement.classList.contains('still');   // Animations off, or Reduce Motion (read live)
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
    { key: 'new', label: 'Newest', fn: (a, b) => (b.d || '').localeCompare(a.d || '') },
    { key: 'old', label: 'Oldest', fn: (a, b) => (a.d || '9').localeCompare(b.d || '9') },
    { key: 'az', label: 'A to Z', fn: (a, b) => a.n.localeCompare(b.n, 'en-GB', { sensitivity: 'base' }) },
  ];

  let cat = null, logos = {}, labels = {}, shown = 0, list = [];
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
  window.tn.loading.wrap(Promise.all([
    fetch('data/browse.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    fetch('data/trending.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    window.tn.prefs.get().no18 ? window.tnSheet?.details() : null,   // Settings: "Hide titles rated 18" needs the certificates
    fetch('data/new.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ])).then(([c, t, d, f]) => {
    cat = c; certs = d; fresh = f; mergeFresh();
    for (const s of t?.services || []) { logos[s.key] = s.logo; labels[s.key] = s.label; }
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
  }).catch((err) => {
    $('#count').textContent = `The catalogue didn't load (${err.message}). It's rebuilt every hour, so try again shortly.`;
  });

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
    firstYear = Math.max(1920, Math.floor(Math.min(...cat.items.map((x) => +(x.d || '').slice(0, 4) || THIS_YEAR)) / 10) * 10);
  }
  // the title details (certificates, lengths), the first time they're wanted
  let detailsP = null;
  const needDetails = () => { if (!certs && !detailsP && window.tnSheet?.details) detailsP = window.tnSheet.details().then((d) => { certs = d; apply(false); }); };

  // ---------- controls ----------
  const sheet = $('#filters');
  function buildControls() {
    // collections: one frosted bar of words, the chosen one lit and underlined in rainbow (it scrolls sideways when narrow)
    $('#coll').insertAdjacentHTML('beforeend', COLLECTIONS.map((c) =>
      `<button type="button" role="radio" class="coll-b" data-c="${c.key}" aria-checked="false">${esc(c.label)}</button>`).join(''));
    $('#coll').addEventListener('click', (e) => { const b = e.target.closest('.coll-b'); if (!b) return;
      state.c = b.dataset.c; state.sort = null; apply(true); });
    arrows($('#coll'), () => [...document.querySelectorAll('.coll-b')], (b) => b.click());

    // Shows, Films or both, and the sort: the system's own pop-up menus
    $('#kindSel').addEventListener('change', (e) => { state.k = e.target.value; state.g = state.g.filter((g) => genreSet().has(g)); apply(true); });
    $('#sortSel').innerHTML = `<option value="">Best match</option>${SORTS.map((s) => `<option value="${s.key}">${esc(s.label)}</option>`).join('')}`;
    $('#sortSel').addEventListener('change', (e) => { const col = collection();
      state.sort = !e.target.value || (!state.q && e.target.value === (col.sort || '')) ? null : e.target.value; apply(true); });

    $('#grid').addEventListener('click', (e) => {   // the empty state's button clears whatever is hiding the results
      const c = e.target.closest('[data-clear]'); if (!c) return;
      if (c.dataset.clear === 'q') { state.q = ''; apply(true); $('#q').focus(); } else clearAll();
    });

    // where to watch: a row per service with its logo and a switch (Safari's own iOS switch where it has one)
    $('#where').innerHTML = Object.keys(labels).map((k) => `<label class="w-b">
      <span class="w-ic">${logos[k] ? `<img src="${esc(logos[k])}" alt="">` : esc(labels[k][0])}</span><span class="w-l">${esc(labels[k])}</span>
      <input type="checkbox" switch role="switch" data-s="${k}"><i class="sw" aria-hidden="true"></i></label>`).join('');
    sheet.classList.toggle('native-sw', 'switch' in HTMLInputElement.prototype);
    $('#mineLink').addEventListener('click', () => window.tn.pickMine(Object.keys(labels).map((k) => ({ key: k, label: labels[k], logo: logos[k] }))));
    addEventListener('tn:mine', () => { readHash(); apply(false); });
    $('#where').addEventListener('change', (e) => { const k = e.target.dataset.s; if (!k) return;
      state.s = e.target.checked ? [...new Set([...state.s, k])] : state.s.filter((x) => x !== k); apply(true, true); });

    $('#genres').addEventListener('click', (e) => { const b = e.target.closest('.g-b'); if (!b) return;
      const g = +b.dataset.g; state.g = state.g.includes(g) ? state.g.filter((x) => x !== g) : [...state.g, g]; apply(true, true); });

    const rating = $('#rating');
    rating.addEventListener('input', () => { state.r = +rating.value; paintRating(); apply(true, true); });

    // age rating and length: one choice each (tap it again for Any)
    const chips = (box, opts, key) => {
      $(box).innerHTML = opts.map(([v, l]) => `<button type="button" role="radio" class="g-b" data-v="${v}" aria-checked="false">${esc(l)}</button>`).join('');
      $(box).addEventListener('click', (e) => { const b = e.target.closest('.g-b'); if (!b) return; state[key] = state[key] === b.dataset.v ? '' : b.dataset.v; apply(true, true); });
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

    $('#clear').addEventListener('click', clearAll);

    // what's in use, as a row of buttons under the collections: each one takes its filter away
    $('#chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-chip]'); if (!b) return;
      const [k, v] = b.dataset.chip.split(':');
      if (k === 'all') return clearAll();
      if (k === 's') state.s = []; else if (k === 'g') state.g = state.g.filter((g) => g !== +v);
      else if (k === 'r') state.r = 0; else if (k === 'y') state.y = null; else if (k === 'a') state.a = ''; else if (k === 'rt') state.rt = '';
      apply(true);
      ($('#chips [data-chip]') || $('#openFilters')).focus({ preventScroll: true });
    });

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

    document.querySelectorAll('.b-dice').forEach((b) => b.addEventListener('click', surprise));

    // search: results as you type; / or ⌘K jumps to the box (shell.js); Escape clears it
    const qi = $('#q');
    qi.addEventListener('input', () => { state.q = qi.value; apply(true, true); if (scrollY > 300) $('#cmdMark').scrollIntoView({ block: 'start' }); });
    qi.addEventListener('keydown', (e) => { if (e.key === 'Escape' && qi.value) { e.preventDefault(); state.q = ''; apply(true); } if (e.key === 'Enter') qi.blur(); });
    $('#qClear').addEventListener('click', () => { state.q = ''; apply(true); qi.focus(); });

    // the hint in the box: "Search shows and films", then, now and then, one of what's popular right now gliding up in its place
    const hint = $('#qHint'); let hintAt = 0;
    const base = matchMedia('(max-width: 560px)').matches ? 'Search' : 'Search shows and films';   // phones: the short word
    hint.firstElementChild.textContent = base;
    const sayHint = (text) => {
      const old = hint.lastElementChild, nu = document.createElement('span');
      nu.className = 'hs-hint-t in'; nu.textContent = text; hint.append(nu);
      old?.classList.add('out'); setTimeout(() => old?.remove(), 700);
    };
    setInterval(() => {
      if (still() || document.hidden || qi.value || window.tnSheet?.isOpen() || sheet.open) return;
      const picks = list.filter((x) => !x._x).slice(0, 12);
      hintAt = (hintAt + 1) % (picks.length + 1);
      sayHint(hintAt && picks[hintAt - 1] ? `Try “${picks[hintAt - 1].n}”` : base);
    }, 4200);

    // the filters: a native <dialog> (it keeps focus, Escape and screen readers inside, and the page inert behind it)
    const openBtn = $('#openFilters');
    openBtn.addEventListener('click', () => { sheet.showModal(); document.documentElement.classList.add('sheet-open'); });
    $('#done').addEventListener('click', () => sheet.close());
    $('#showN').addEventListener('click', () => { sheet.close(); $('#cmdMark').scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'start' }); });
    sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });   // a tap outside it (where closedby="any" isn't known yet)
    sheet.addEventListener('close', () => { document.documentElement.classList.remove('sheet-open'); openBtn.focus({ preventScroll: true }); writeHash(); });

    new IntersectionObserver((es) => { if (es[0].isIntersecting) more(); }, { rootMargin: '600px 0px' }).observe($('#more'));
    addEventListener('hashchange', () => { readHash(); apply(false); });

    // new here: the filters sheet and the row of what's in use (once, the owner's rule)
    window.tn.tip({ id: 'browse-filter-sheet', for: '#openFilters', title: 'Filters, in one place',
      text: 'Services, genres, ratings, years, age and length all live here now. Whatever you pick shows as a button under the collections: tap one to take it away.' });
  }
  function clearAll() { Object.assign(state, { s: [], g: [], sort: null, r: 0, y: null, a: '', rt: '' }); apply(true); }

  const genreSet = () => new Set(cat.items.filter(kindOk).flatMap((x) => x.g));
  function paintRating() {
    const r = $('#rating'); r.value = state.r;
    $('#ratingOut').textContent = state.r ? `${state.r}+` : 'Any';
    r.style.setProperty('--fill', `${(state.r / 9) * 100}%`);
  }

  try { ['tenner-searches', 'tenner-recent', 'tenner-browse-note'].forEach((k) => localStorage.removeItem(k)); } catch {}   // recent searches, Recently Viewed and the welcome note were tried and taken out: tidy away what they kept

  // ---------- search: matched as the menu's search box matches (shell.js) ----------
  const { fold, score } = window.tn;

  // ---------- filtering ----------
  let certs = null;
  const det = (x) => certs?.items?.[`${x.t[0]}${x.i}`];
  const no18 = window.tn.prefs.get().no18;
  let hid = window.tn.hidden.keys();   // Not interested (signed in): left out, like titles rated 18 when that's on
  addEventListener('tn:marks', () => { hid = window.tn.hidden.keys(); hidDirty = true; });
  let hidDirty = false;
  addEventListener('tn:sheet-closed', () => { if (hidDirty && cat) { hidDirty = false; apply(false, true); } });
  const ok18 = (x) => !hid.has(`${x.t[0]}${x.i}`) && (!no18 || !certs || det(x)?.c !== '18');
  // released, age rating and length (the last two wait for the details, then filter)
  const okMore = (x) => (!state.y || ((+(x.d || '').slice(0, 4) || 0) >= state.y[0] && (+(x.d || '').slice(0, 4) || 0) <= state.y[1]))
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
      && (!state.s.length || x.s.some((k) => state.s.includes(k)))
      && (!state.g.length || x.g.some((g) => state.g.includes(g)))
      && (!state.r || x.r >= state.r)).sort(sortFn);

    // controls reflect state
    document.querySelectorAll('.coll-b').forEach((b) => b.setAttribute('aria-checked', b.dataset.c === state.c));
    { const tr = $('#coll'), on = tr.querySelector('[aria-checked="true"]');   // phones: the chosen one slides into view
      if (on && tr.scrollWidth > tr.clientWidth + 1) tr.scrollTo({ left: Math.max(0, on.offsetLeft - tr.clientWidth / 2 + on.offsetWidth / 2), behavior: reduce() ? 'auto' : 'smooth' }); }
    $('#kindSel').value = state.k; $('#kindL').textContent = { tv: 'Shows', movie: 'Films', both: 'Both' }[state.k];
    document.querySelectorAll('#where input').forEach((i) => { i.checked = state.s.includes(i.dataset.s); });
    const sk = q && !state.sort ? '' : sortKey();   // searching: best match first unless you pick a sort
    const o0 = $('#sortSel').options[0]; o0.textContent = q ? 'Best match' : 'By day'; o0.hidden = !q && !collection().order;
    $('#sortSel').value = sk; $('#sortL').textContent = sk ? SORTS.find((s) => s.key === sk).label : o0.textContent;
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
    const n = (state.s.length ? 1 : 0) + state.g.length + (state.r ? 1 : 0) + (state.y ? 1 : 0) + (state.a ? 1 : 0) + (state.rt ? 1 : 0);   // services count once, however many
    $('#fCount').hidden = !n; $('#fCount').textContent = n;
    $('#openFilters').setAttribute('aria-label', n ? `Filters, ${n} on` : 'Filters');
    $('#clear').disabled = !n;
    paintChips();

    const many = list.length.toLocaleString('en-GB'), what = q || state.k === 'both' ? (list.length === 1 ? 'title' : 'titles') : state.k === 'movie' ? (list.length === 1 ? 'film' : 'films') : (list.length === 1 ? 'show' : 'shows');
    // nothing on the services: no "0 results" line; the full catalogue's results below say it
    $('#count').textContent = q ? (!list.length && window.tn.api ? '' : `${many} on the six services`) : `${many} ${what}`;
    $('#showN').firstElementChild.textContent = list.length ? `Show ${many} ${what}` : 'No matches';
    document.body.classList.toggle('searching', !!q);

    document.body.classList.toggle('mixed', !!q || state.k === 'both');   // show/film labels on the tiles when both are listed
    $('#qClear').hidden = !state.q;
    if ($('#q').value !== state.q) $('#q').value = state.q;
    if (!quiet) writeHash(); else clearTimeout(apply.t), (apply.t = setTimeout(writeHash, 250));

    // swap the grid (a quick crossfade where the browser can)
    const draw = () => { shown = 0; $('#grid').innerHTML = ''; more(); empty(); };
    webSearch();
    if (user && !quiet && document.startViewTransition && !reduce()) document.startViewTransition(draw).ready.catch(() => {}); else draw();
    if (!q) { spotlight(); moods(); } else $('#moods').hidden = true;
    rows();
  }

  // ---------- what's filtering the list: one button for each, with a cross, and Clear all once there are two ----------
  const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 7.5l9 9M16.5 7.5l-9 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  function paintChips() {
    const c = [];
    if (state.s.length) c.push(['s', state.s.length === 1 ? labels[state.s[0]] : `${state.s.length} services`, state.s.slice(0, 3).map((k) => logos[k] ? `<img src="${esc(logos[k])}" alt="">` : '').join('')]);
    for (const g of state.g) if (cat.genres[g]) c.push([`g:${g}`, cat.genres[g]]);
    if (state.r) c.push(['r', `Rated ${state.r}+`]);
    if (state.y) c.push(['y', state.y[0] === state.y[1] ? `${state.y[0]}` : `${state.y[0]} to ${state.y[1]}`]);
    if (state.a) c.push(['a', `Up to ${state.a}`]);
    if (state.rt) c.push(['rt', `Up to ${LENS.find(([v]) => v === state.rt)[1]}`]);
    if (c.length > 1) c.push(['all', 'Clear all']);
    const box = $('#chips');
    box.innerHTML = c.map(([k, l, ic]) => `<button type="button" class="btn btn-tinted chip${k === 'all' ? ' chip-all' : ''}" data-chip="${esc(k)}" aria-label="${k === 'all' ? 'Clear all filters' : `Remove ${esc(l)}`}">${ic ? `<span class="chip-ic">${ic}</span>` : ''}<span>${esc(l)}</span>${k === 'all' ? '' : X}</button>`).join('');
    box.hidden = !c.length;
  }

  // ---------- the featured hero: five of the best of whatever you're browsing, one at a time ----------
  // Its wide artwork (browse-more.json, fetched once) fills the top of the page and runs on, blurred, under the sidebar's
  // glass; without one, the poster blurred big does the same, so the hero is never empty. A thin bar for each pick fills
  // while it's showing (CSS), and when it's full the next one glides in; pointing at the hero, an open sheet or Animations
  // off hold it still. Swipe on touch, the arrows or ← → on the bars elsewhere.
  const still = reduce;
  const spot = { key: '', picks: [], at: 0 }, fk = (x) => `${x.t[0]}${x.i}`;
  const kindWord = () => (state.k === 'movie' ? 'Films' : state.k === 'both' ? 'Shows and films' : 'Shows');
  const posterOf = (x) => x.img ? (x.img.startsWith('/') ? cat.img + x.img : x.img) : null;
  async function spotlight() {
    const col = collection();
    $('#spotEye').textContent = `${col.label} · ${kindWord()}${state.s.length ? ` · ${state.s.length === 1 ? labels[state.s[0]] : `${state.s.length} services`}` : ''}`;
    const m = await moreData();
    // five of the top 24, those with wide artwork first, led by the ones you haven't seen featured lately (each title once)
    const wide = (x) => !!m?.items?.[fk(x)]?.[1];
    const pool = list.filter((x) => !x._x || x.img).slice(0, 24).filter((x) => wide(x) || x.img), key = pool.map(fk).join(',');
    if (key === spot.key) return;
    const picks = window.tn.featured.pick(pool, fk, 5, wide);
    spot.key = key; spot.picks = picks; spot.at = 0;
    const art = $('#spotArt'), ext = $('#spotExt');
    $('#spot').classList.toggle('has-feat', !!picks.length); $('#spotFeat').hidden = !picks.length; $('#spotNav').hidden = picks.length < 2;
    if (!picks.length) { art.innerHTML = ext.innerHTML = ''; return; }
    const src = (x) => (wide(x) ? m.img.replace('/w780', '/w1280') + m.items[fk(x)][1] : posterOf(x));
    art.innerHTML = picks.map((x, i) => `<img class="${wide(x) ? 'wide' : 'blur'}" ${i ? 'data-' : 'fetchpriority="high" '}src="${esc(src(x))}" alt="" decoding="async">`).join('');
    ext.innerHTML = picks.map((x, i) => `<img ${i ? 'data-' : ''}src="${esc(src(x))}" alt="" decoding="async">`).join('');
    $('#spotDots').innerHTML = picks.map((x, i) => `<button type="button" role="tab" aria-selected="false" aria-label="${esc(x.n)}" data-i="${i}"><i></i></button>`).join('');
    showSpot(0);
  }
  function showSpot(n) {
    const picks = spot.picks; if (!picks.length) return;
    spot.at = (n + picks.length) % picks.length; const x = picks[spot.at];
    window.tn.featured.saw(fk(x));
    const want = (img) => { if (img?.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; } };
    for (const box of [$('#spotArt'), $('#spotExt')]) {
      const imgs = [...box.children]; want(imgs[spot.at]); want(imgs[(spot.at + 1) % imgs.length]);
      imgs.forEach((img, i) => img.classList.toggle('on', i === spot.at));
    }
    const words = () => {
      $('#spotT').textContent = x.n;
      const g = x.g.map((id) => cat.genres[id]).find(Boolean);
      $('#spotM').innerHTML = [x.t === 'tv' ? 'Show' : 'Film', g, (x.d || '').slice(0, 4), x.r ? `★ ${x.r.toFixed(1)}` : ''].filter(Boolean).map(esc).join(' · ')
        + (x.s.length ? `<span class="on">${x.s.slice(0, 3).map((k) => logos[k] ? `<img src="${esc(logos[k])}" alt="${esc(labels[k])}" data-tip="${esc(labels[k])}">` : '').join('')}</span>` : '');
      moreData().then((m) => { if (spot.picks[spot.at] === x) $('#spotO').textContent = m?.sample ? '' : m?.items?.[fk(x)]?.[0] || ''; });
      const add = $('#spotAdd'), on = window.tn.saved.has(fk(x));
      add.dataset.save = fk(x); add.setAttribute('aria-pressed', on); add.innerHTML = on ? TICK : PLUS;
      add.title = on ? 'In your Watchlist' : 'Add to Watchlist'; add.setAttribute('aria-label', `${add.title}: ${x.n}`);
    };
    // the words glide across with the picture, where the browser can
    const feat = $('#spotFeat');
    if (!still() && feat.animate && feat.dataset.k) feat.animate([{ opacity: 1 }, { opacity: 0, translate: '0 6px' }], { duration: 180, easing: 'ease-in' }).finished.then(() => {
      words(); feat.animate([{ opacity: 0, translate: '0 -6px', filter: 'blur(4px)' }, { opacity: 1, translate: '0 0', filter: 'blur(0)' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }); else words();
    feat.dataset.k = fk(x);
    // the bars: the ones before full, this one filling (its animation's end moves things on), the rest empty
    $('#spotDots').querySelectorAll('button').forEach((b, i) => {
      b.setAttribute('aria-selected', i === spot.at); b.tabIndex = i === spot.at ? 0 : -1;
      b.classList.toggle('done', i < spot.at); b.classList.remove('run'); if (i === spot.at) { void b.offsetWidth; b.classList.add('run'); }
    });
  }
  $('#spotDots').addEventListener('animationend', (e) => {
    if (e.animationName !== 'spotFill') return;
    if (document.hidden || window.tnSheet?.isOpen() || sheet.open) { const b = e.target.closest('button'); b.classList.remove('run'); void b.offsetWidth; b.classList.add('run'); return; }
    showSpot(spot.at + 1);
  });
  $('#spotDots').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showSpot(+b.dataset.i); });
  arrows($('#spotDots'), () => [...$('#spotDots').children], (b) => showSpot(+b.dataset.i));
  $('#spotNav').addEventListener('click', (e) => { const b = e.target.closest('[data-step]'); if (b) showSpot(spot.at + +b.dataset.step); });
  // its name, Where to watch, or the picture itself: the title's sheet
  const openSpot = async () => { const x = spot.picks[spot.at]; if (x) window.tnSheet?.open(await sheetFor(x)); };
  $('#spotT').addEventListener('click', openSpot); $('#spotGo').addEventListener('click', openSpot);
  $('#spot').addEventListener('click', (e) => { if (!e.target.closest('button, a, select, input') && !getSelection().toString()) openSpot(); });
  // swipe it on a phone or tablet
  let spX = null;
  $('#spot').addEventListener('touchstart', (e) => { spX = [e.touches[0].clientX, e.touches[0].clientY]; }, { passive: true });
  $('#spot').addEventListener('touchend', (e) => {
    if (!spX || spot.picks.length < 2) return; const t = e.changedTouches[0], dx = t.clientX - spX[0], dy = t.clientY - spX[1]; spX = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) showSpot(spot.at + (dx < 0 ? 1 : -1));
  }, { passive: true });

  // ---------- explore by genre: a tile for each of the biggest genres, three of its best posters fanned out ----------
  function moods() {
    const box = $('#moods');
    if (state.g.length) { box.hidden = true; return; }
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

  // ---------- hover cards (computers, sheet.js): rest the pointer on a poster and it opens up with the title's details ----------
  // The descriptions and artwork live in data/browse-more.json, fetched the first time a title is opened.
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  let moreP = null;
  const moreData = () => (moreP ||= fetch('data/browse-more.json').then((r) => (r.ok ? r.json() : null)).catch(() => null));
  const item = (k) => cat?.items.find((x) => `${x.t[0]}${x.i}` === k);
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
    e.preventDefault();
    const x = item(a.closest('.tile').dataset.k); if (x) window.tnSheet?.open(await sheetFor(x));
  });
  window.tnSheet?.hover?.('#grid .tile a', (a) => { const x = item(a.closest('.tile').dataset.k); return x && sheetFor(x); });
  window.tnSheet?.hover?.('#bRows a[data-row]', (a) => { const x = item(a.dataset.row); return x && sheetFor(x); });

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
    e.preventDefault(); window.tnSheet?.open(webInfo(x));
  });
  const webInfo = (x) => ({ k: x.k, type: x.type, title: x.title, year: x.year, rating: x.rating, poster: x.poster, backdrop: x.backdrop, overview: x.overview,
    tmdb: `https://www.themoviedb.org/${x.type}/${x.k.slice(1)}`, services: [] });
  window.tnSheet?.hover?.('#webGrid .tile a', (a) => { const x = web.items.get(a.closest('.tile').dataset.wk); return x && webInfo(x); });

  // ---------- + to save, from the grid, the list or the rows ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-save]'); if (!b || !b.closest('.bwrap')) return;
    e.preventDefault(); e.stopPropagation();
    const k = b.dataset.save, x = item(k), w = web.items.get(k);
    const info = x ? { k, type: x.t, title: x.n, year: (x.d || '').slice(0, 4) || null, poster: x.img ? (x.img.startsWith('/') ? cat.img + x.img : x.img) : null }
      : w ? { k, type: w.type, title: w.title, year: w.year, poster: w.poster } : null;
    if (!info) return;
    const on = window.tn.saved.toggle(info);
    if (on && !reduce() && b.animate) b.animate([{ scale: 1 }, { scale: 1.25 }, { scale: 1 }], { duration: 360, easing: 'cubic-bezier(.3,1.5,.5,1)' });
  }, true);
  addEventListener('tn:saved', () => document.querySelectorAll('[data-save]').forEach((b) => {
    const on = window.tn.saved.has(b.dataset.save);
    if (String(on) === b.getAttribute('aria-pressed')) return;
    b.setAttribute('aria-pressed', on); b.innerHTML = on ? TICK : PLUS;
    b.title = on ? 'In your Watchlist' : 'Add to Watchlist';
    b.setAttribute('aria-label', b.getAttribute('aria-label').replace(/^[^:]+/, b.title));
  }));

  // ---------- Surprise me: a good one at random from whatever you're looking at ----------
  async function surprise(e) {
    const good = list.filter((x) => x.img && x.r >= 6.8 && !x._x);
    const pool = (good.length >= 5 ? good : list).slice(0, 80);
    if (!pool.length) return;
    const x = pool[Math.floor(Math.pow(Math.random(), 1.4) * pool.length)];   // the better ones a little more often
    const b = e?.currentTarget || $('.b-dice'); if (!reduce() && b.animate) b.querySelector('svg').animate([{ rotate: '0deg' }, { rotate: '360deg' }], { duration: 500, easing: 'cubic-bezier(.3,.9,.3,1)' });
    window.tnSheet?.open({ ...(await sheetFor(x)), eye: 'Tenner’s surprise pick' });
  }

  // ---------- For You (from your Discover swipes, stars and Watchlist; shell.js's forYou): a row of posters above the genres ----------
  const forYou = () => window.tn.forYou(cat.items, (x) => !x._x && kindOk(x) && ok18(x) && (state.s.length ? x.s.some((k) => state.s.includes(k)) : x.s.length));
  function rows() {
    const box = $('#bRows');
    if (state.q || state.g.length || state.c !== 'popular') { box.hidden = true; return; }
    const poster = (x) => x.img ? (x.img.startsWith('/') ? cat.img + x.img : x.img) : null;
    const art = (src, title) => src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : `<span class="ph" style="background:linear-gradient(160deg,hsl(${hue(title)} 45% 42%),hsl(${(hue(title) + 40) % 360} 55% 18%))">${esc(title)}</span>`;
    const fy = forYou();
    box.innerHTML = (fy ? `<section class="b-row" aria-labelledby="fyH"><div class="b-row-hd"><h2 id="fyH">For You</h2><p>${fy.because ? `Because you ${fy.how} ${esc(fy.because.n)}${fy.how === 'liked' ? ' in Discover' : ''}` : 'From what you’ve liked'}</p></div>
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
  let rowsDirty = false;
  ['tn:saved', 'tn:swiped'].forEach((ev) => addEventListener(ev, () => { if (!cat) return; if (window.tnSheet?.isOpen()) rowsDirty = true; else rows(); }));
  addEventListener('tn:sheet-closed', () => { if (rowsDirty && cat) { rowsDirty = false; rows(); } });

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
    const where = x.s.slice(0, 3).map((k) => logos[k] ? `<img src="${esc(logos[k])}" alt="${esc(labels[k])}" data-tip="${esc(labels[k])}">` : '').join('');
    return `<li class="tile" style="--d:${i % PAGE}" data-k="${x.t[0]}${x.i}">
      <a href="${esc(url)}" target="_blank" rel="noopener">
        <span class="art">${art}${x.r ? `<span class="score" aria-label="Rated ${x.r} out of 10"><b>${x.r.toFixed(1)}</b></span>` : ''}</span>
        <span class="t">${esc(x.n)}</span>
        <span class="kind-l">${x.t === 'tv' ? 'Show' : 'Film'}</span>
        <span class="m"><span>${esc(state.c === 'week' && x._new ? `Arrived ${day(x._new)}` : state.c === 'leaving' && x._gone ? `Leaves ${day(x._gone)}` : fmt(x.d))}</span>${where ? `<span class="on">${where}</span>` : ''}</span>
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

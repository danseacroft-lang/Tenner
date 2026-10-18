// Tenner Browse: the hour's catalogue (data/browse.json), filtered and sorted in the browser.
// State lives in the URL (#c=top&k=movie&s=netflix,disney&g=18&sort=rating&r=7), so any view can be shared or bookmarked.
(() => {
  const { esc, hue, glide, arrows, reduce } = window.tn;   // from shell.js
  const $ = (s) => document.querySelector(s);
  const PAGE = 48;
  const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);   // worked out each time, so it's right past midnight

  // Collections: a filter plus the sort that suits it.
  const COLLECTIONS = [
    { key: 'popular', label: 'Popular', sort: 'pop', test: (x) => x.s.length },
    { key: 'new', label: 'New releases', sort: 'new', test: (x) => x.s.length && x.d >= daysAgo(150) && x.d <= daysAgo(0) },
    { key: 'top', label: 'Top rated', sort: 'rating', test: (x) => x.s.length && x.r >= 7.6 && x.v >= 300 },
    { key: 'gems', label: 'Hidden gems', sort: 'rating', test: (x) => x.s.length && x.r >= 7.2 && x.v >= 30 && x.v < 600 },
    { key: 'acclaimed', label: 'Acclaimed', sort: 'rating', test: (x) => x.s.length && x.r >= 8 && x.v >= 1500 },
    { key: 'store', label: 'Buy or rent', sort: 'pop', test: (x) => x.b, films: true },
  ];
  const SORTS = [
    { key: 'pop', label: 'Most popular', fn: (a, b) => b.p - a.p },
    { key: 'rating', label: 'Highest rated', fn: (a, b) => b.r - a.r || b.v - a.v },
    { key: 'new', label: 'Newest', fn: (a, b) => b.d.localeCompare(a.d) },
    { key: 'old', label: 'Oldest', fn: (a, b) => (a.d || '9').localeCompare(b.d || '9') },
    { key: 'az', label: 'A to Z', fn: (a, b) => a.n.localeCompare(b.n, 'en-GB', { sensitivity: 'base' }) },
  ];

  let cat = null, logos = {}, labels = {}, shown = 0, list = [];
  const state = { c: 'popular', k: 'tv', s: [], g: [], sort: null, r: 0, q: '' };

  // ---------- URL <-> state ----------
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    state.c = COLLECTIONS.some((c) => c.key === q.get('c')) ? q.get('c') : 'popular';
    state.k = ['movie', 'both'].includes(q.get('k')) ? q.get('k') : 'tv';
    state.s = (q.get('s') || '').split(',').filter((k) => labels[k]);
    state.g = (q.get('g') || '').split(',').map(Number).filter((g) => cat.genres[g]);
    state.sort = SORTS.some((s) => s.key === q.get('sort')) ? q.get('sort') : null;
    state.r = Math.min(9, Math.max(0, parseFloat(q.get('r')) || 0));
    state.q = (q.get('q') || '').slice(0, 80);
    if (collection().films) state.k = 'movie';
  }
  function writeHash() {
    const q = new URLSearchParams();
    if (state.c !== 'popular') q.set('c', state.c);
    if (state.k !== 'tv') q.set('k', state.k);
    if (state.s.length) q.set('s', state.s.join(','));
    if (state.g.length) q.set('g', state.g.join(','));
    if (state.sort) q.set('sort', state.sort);
    if (state.r) q.set('r', state.r);
    if (state.q) q.set('q', state.q);
    const h = q.toString();
    history.replaceState(null, '', h ? '#' + h : location.pathname);
  }
  const collection = () => COLLECTIONS.find((c) => c.key === state.c);
  const kindOk = (x) => state.k === 'both' || x.t === state.k;   // Shows, Films or Both
  const sortKey = () => state.sort || collection().sort;

  // ---------- data ----------
  Promise.all([
    fetch('data/browse.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    fetch('data/trending.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([c, t]) => {
    cat = c;
    for (const s of t?.services || []) if (!s.store) { logos[s.key] = s.logo; labels[s.key] = s.label; }
    if (!Object.keys(labels).length) Object.assign(labels, { netflix: 'Netflix', disney: 'Disney+', prime: 'Prime Video', hbomax: 'HBO Max', paramount: 'Paramount+' });
    const wantSearch = location.hash === '#search';
    if (wantSearch) history.replaceState(null, '', location.pathname);
    readHash(); buildControls(); apply(false);
    if (wantSearch) $('#q').focus();
  }).catch((err) => {
    $('#count').textContent = `The catalogue didn't load (${err.message}). It's rebuilt every hour, so try again shortly.`;
  });

  // New catalogue while the page is open: take it in quietly. Near the top of the page the grid redraws straight
  // away; further down it waits for your next filter or search, so the posters never shift under you.
  addEventListener('tn:check', () => {
    if (!cat) return;
    fetch(`data/browse.json?v=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((c) => {
      if (!c?.items?.length || c.generatedAt === cat.generatedAt) return;
      cat = c;
      if (scrollY < 400 && !document.activeElement?.matches('input')) apply(false);
    }).catch(() => {});
  });

  // ---------- controls ----------
  function buildControls() {
    // collections: a glass capsule with a gliding pill, like the service bar
    $('#coll').insertAdjacentHTML('beforeend', COLLECTIONS.map((c) =>
      `<button type="button" role="radio" class="coll-b" data-c="${c.key}" aria-checked="false">${esc(c.label)}</button>`).join(''));
    $('#coll').addEventListener('click', (e) => { const b = e.target.closest('.coll-b'); if (!b) return;
      state.c = b.dataset.c; state.sort = null; if (collection().films) state.k = 'movie'; apply(true); });

    const setKind = (k) => {
      if (collection().films && k !== 'movie') state.c = 'popular';
      state.k = k; state.g = state.g.filter((g) => genreSet().has(g)); apply(true);
    };
    document.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)));
    arrows($('.b-head .segmented'), () => [...document.querySelectorAll('[data-kind]')], (b) => setKind(b.dataset.kind));
    window.tn.segment($('.b-head .segmented'), (b) => setKind(b.dataset.kind));
    arrows($('#coll'), () => [...document.querySelectorAll('.coll-b')], (b) => b.click());
    arrows($('#sort'), () => [...document.querySelectorAll('.s-b')], (b) => b.click());
    $('#grid').addEventListener('click', (e) => {   // the empty state's button clears whatever is hiding the results
      const c = e.target.closest('[data-clear]'); if (!c) return;
      if (c.dataset.clear === 'q') { state.q = ''; apply(true); $('#q').focus(); } else $('#clear').click();
    });

    $('#where').innerHTML = Object.keys(labels).map((k) => `<button type="button" class="w-b" data-s="${k}" aria-pressed="false" title="${esc(labels[k])}">
      <span class="w-ic">${logos[k] ? `<img src="${esc(logos[k])}" alt="">` : esc(labels[k][0])}</span><span>${esc(labels[k])}</span></button>`).join('');
    $('#where').addEventListener('click', (e) => { const b = e.target.closest('.w-b'); if (!b) return;
      const k = b.dataset.s; state.s = state.s.includes(k) ? state.s.filter((x) => x !== k) : [...state.s, k]; apply(true); });

    $('#sort').innerHTML = SORTS.map((s) => `<button type="button" role="radio" class="s-b" data-sort="${s.key}" aria-checked="false">${esc(s.label)}<i aria-hidden="true"></i></button>`).join('');
    $('#sort').addEventListener('click', (e) => { const b = e.target.closest('.s-b'); if (!b) return; state.sort = b.dataset.sort; apply(true); });

    $('#genres').addEventListener('click', (e) => { const b = e.target.closest('.g-b'); if (!b) return;
      const g = +b.dataset.g; state.g = state.g.includes(g) ? state.g.filter((x) => x !== g) : [...state.g, g]; apply(true); });

    const rating = $('#rating');
    rating.addEventListener('input', () => { state.r = +rating.value; paintRating(); apply(true, true); });

    $('#clear').addEventListener('click', () => { Object.assign(state, { s: [], g: [], sort: null, r: 0 }); apply(true); });

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
      if (on) sheet.querySelector('button')?.focus({ preventScroll: true });
    };
    openBtn.addEventListener('click', () => setSheet(true));
    $('#done').addEventListener('click', () => { setSheet(false); openBtn.focus(); });
    scrim.addEventListener('click', () => setSheet(false));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.classList.contains('open')) setSheet(false); });

    const track = $('#coll'), edges = () => { track.parentElement.classList.toggle('at-start', track.scrollLeft < 4);
      track.parentElement.classList.toggle('at-end', track.scrollLeft + track.clientWidth >= track.scrollWidth - 4); };
    track.addEventListener('scroll', edges, { passive: true });
    addEventListener('resize', () => { placeColl(false); edges(); }); requestAnimationFrame(edges);
    new IntersectionObserver((es) => { if (es[0].isIntersecting) more(); }, { rootMargin: '600px 0px' }).observe($('#more'));
    addEventListener('hashchange', () => { readHash(); apply(false); });
  }

  const genreSet = () => new Set(cat.items.filter(kindOk).flatMap((x) => x.g));
  function paintRating() {
    const r = $('#rating'); r.value = state.r;
    $('#ratingOut').textContent = state.r ? `${state.r}+` : 'Any';
    r.style.setProperty('--fill', `${(state.r / 9) * 100}%`);
  }

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
  function apply(user, quiet) {
    const col = collection();
    const sortFn = SORTS.find((s) => s.key === sortKey()).fn;
    const q = fold(state.q);
    if (q) {
      // searching looks across shows and films and every collection, closest matches first
      list = cat.items.map((x) => [x, score(x, q)]).filter(([x, sc]) => sc
        && (!state.s.length || x.s.some((k) => state.s.includes(k)))
        && (!state.g.length || x.g.some((g) => state.g.includes(g)))
        && (!state.r || x.r >= state.r))
        .sort((a, b) => (state.sort ? sortFn(a[0], b[0]) : (b[1] - a[1] || b[0].p - a[0].p))).map(([x]) => x);
    } else list = cat.items.filter((x) => kindOk(x) && col.test(x)
      && (!state.s.length || col.key === 'store' || x.s.some((k) => state.s.includes(k)))
      && (!state.g.length || x.g.some((g) => state.g.includes(g)))
      && (!state.r || x.r >= state.r)).sort(sortFn);

    // controls reflect state
    document.querySelectorAll('.coll-b').forEach((b) => b.setAttribute('aria-checked', b.dataset.c === state.c));
    placeColl(user);
    document.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-checked', b.dataset.kind === state.k));
    document.querySelectorAll('.w-b').forEach((b) => b.setAttribute('aria-pressed', state.s.includes(b.dataset.s)));
    $('#pWhere').hidden = col.key === 'store';
    document.querySelectorAll('.s-b').forEach((b) => b.setAttribute('aria-checked', b.dataset.sort === (q && !state.sort ? '' : sortKey())));   // searching: best match first unless you pick a sort
    const gs = [...genreSet()].filter((g) => cat.genres[g]).sort((a, b) => cat.genres[a].localeCompare(cat.genres[b]));
    $('#genres').innerHTML = gs.map((g) => `<button type="button" class="g-b" data-g="${g}" aria-pressed="${state.g.includes(g)}">${esc(cat.genres[g])}</button>`).join('');
    paintRating();
    const n = state.s.length + state.g.length + (state.r ? 1 : 0) + (state.sort ? 1 : 0);
    $('#fCount').hidden = !n; $('#fCount').textContent = n;
    $('#clear').disabled = !n;

    const noun = { tv: ['show', 'shows'], movie: ['film', 'films'], both: ['title', 'titles'] }[state.k][list.length === 1 ? 0 : 1];
    $('#count').textContent = q ? `${list.length.toLocaleString('en-GB')} ${list.length === 1 ? 'result' : 'results'} for “${state.q.trim()}”` : `${list.length.toLocaleString('en-GB')} ${noun}`;
    document.body.classList.toggle('searching', !!q);
    document.body.classList.toggle('mixed', !!q || state.k === 'both');   // show/film labels on the tiles when both are listed
    $('#qClear').hidden = !state.q;
    if ($('#q').value !== state.q) $('#q').value = state.q;
    if (!quiet) writeHash(); else clearTimeout(apply.t), (apply.t = setTimeout(writeHash, 250));

    // swap the grid (a quick crossfade where the browser can)
    const draw = () => { shown = 0; $('#grid').innerHTML = ''; more(); empty(); };
    if (user && !quiet && document.startViewTransition && !reduce) document.startViewTransition(draw); else draw();
  }

  function empty() {
    if (list.length) return;
    $('#grid').innerHTML = `<li class="none"><h2>No matches</h2><p>${state.q ? 'Nothing in this hour\'s catalogue matches that. Try a shorter search, or fewer filters.' : 'Try fewer filters, or a different collection.'}</p>
      <button type="button" class="btn btn-tinted" data-clear="${state.q ? 'q' : 'filters'}">${state.q ? 'Clear search' : 'Clear filters'}</button></li>`;
  }

  // ---------- the grid ----------
  const fmt = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  function card(x, i) {
    const url = `https://www.themoviedb.org/${x.t}/${x.i}/watch?locale=GB`;
    const h = hue(x.n);
    const art = x.img
      ? `<img src="${esc(x.img.startsWith('/') ? cat.img + x.img : x.img)}" alt="" loading="lazy" decoding="async" width="342" height="513">`
      : `<span class="ph" style="background:linear-gradient(160deg,hsl(${h} 45% 42%),hsl(${(h + 40) % 360} 55% 18%))">${esc(x.n)}</span>`;
    const where = x.s.slice(0, 3).map((k) => logos[k] ? `<img src="${esc(logos[k])}" alt="${esc(labels[k])}" title="${esc(labels[k])}">` : '').join('');
    return `<li class="tile" style="--d:${i % PAGE}">
      <a href="${esc(url)}" target="_blank" rel="noopener">
        <span class="art">${art}${x.r ? `<span class="score" aria-label="Rated ${x.r} out of 10"><b>${x.r.toFixed(1)}</b></span>` : ''}</span>
        <span class="t">${esc(x.n)}</span>
        <span class="kind-l">${x.t === 'tv' ? 'Show' : 'Film'}</span>
        <span class="m"><span>${esc(fmt(x.d))}</span>${where ? `<span class="on">${where}</span>` : x.b ? '<span class="buy">Buy or rent</span>' : ''}</span>
      </a></li>`;
  }
  function more() {
    if (shown >= list.length) return;
    const next = list.slice(shown, shown + PAGE);
    $('#grid').insertAdjacentHTML('beforeend', next.map((x, i) => card(x, shown + i)).join(''));
    shown += next.length;
  }

  // the gliding pill under the chosen collection, kept in view if the capsule scrolls
  function placeColl(animate) {
    const b = $('.coll-b[aria-checked="true"]'); if (!b) return;
    glide($('#collInd'), b, animate);
    const track = $('#coll');
    if (track.scrollWidth > track.clientWidth) track.scrollTo({ left: Math.max(0, b.offsetLeft - (track.clientWidth - b.offsetWidth) / 2), behavior: animate && !reduce ? 'smooth' : 'auto' });
  }
})();

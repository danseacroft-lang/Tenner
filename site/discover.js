// Tenner Discover: a deck of shows and films, one card at a time: Tenner's catalogue (all six services), and films from
// TMDB's whole catalogue (through the search service) mixed in, streaming or not; those open the usual sheet, which says
// where they are, if anywhere. Swipe right to add it to
// your Watchlist, left to skip it, down (or tap) for the details sheet. The buttons and arrow keys do the same.
// Skipped titles are remembered on this device so they don't come round again; Undo takes back the last swipe.
(() => {
  const { esc, hue, saved, swipes } = window.tn;   // from shell.js
  const reduce = () => document.documentElement.classList.contains('still');   // Animations off, or Reduce Motion (read live)
  const $ = (s) => document.querySelector(s);
  const SKIP = 'tenner-skipped', KIND = 'tenner-discover-kind', HINTED = 'tenner-discover-hinted', WIDE = 'tenner-discover-page';
  const TMDB_IMG = 'https://image.tmdb.org/t/p';
  const stage = $('#dStage'), mouse = matchMedia('(hover: hover) and (pointer: fine)');


  // ---------- what's been skipped (this device only) ----------
  const skipped = {
    all() { try { return JSON.parse(localStorage.getItem(SKIP) || '{}') || {}; } catch { return {}; } },
    set(o) { const ks = Object.keys(o); if (ks.length > 3000) ks.sort((a, b) => o[a] - o[b]).slice(0, ks.length - 3000).forEach((k) => delete o[k]); try { localStorage.setItem(SKIP, JSON.stringify(o)); } catch {} },
    add(k) { const o = skipped.all(); o[k] = Date.now(); skipped.set(o); },
    drop(k) { const o = skipped.all(); delete o[k]; skipped.set(o); },
  };

  // ---------- data ----------
  let known = new Set(), cat = null, more = null, certs = null, labels = {}, logos = {}, deck = [], cards = [], hist = [], added = 0;
  let kind = (() => { try { const k = localStorage.getItem(KIND); return ['tv', 'movie', 'both'].includes(k) ? k : 'both'; } catch { return 'both'; } })();
  const keyOf = (x) => `${x.t[0]}${x.i}`;
  const img = (x, w) => (!x.img ? null : x.wide ? `${TMDB_IMG}/${w}${x.img}` : x.img.startsWith('/') ? cat.img.replace(/\/w\d+$/, `/${w}`) + x.img : x.img);
  const year = (x) => (x.d || '').slice(0, 4) || null;
  const extra = (x) => (x.wide ? [x.ov || '', x.bd] : more?.items?.[keyOf(x)] || []);
  const backdrop = (x, e) => (!e[1] ? null : x.wide ? `${TMDB_IMG}/w1280${e[1]}` : more?.img ? more.img + e[1] : null);
  // TMDB's film genres, for the cards from its whole catalogue (Tenner's own list covers only what's on the services)
  const FILM_GENRES = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
    14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV film', 53: 'Thriller',
    10752: 'War', 37: 'Western' };
  const genresOf = (x, n) => [...new Set(x.g.map((g) => cat.genres[g] || FILM_GENRES[g]).filter(Boolean))].slice(0, n);

  window.tn.loading.wrap(Promise.all([
    fetch('data/browse.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    fetch('data/trending.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    window.tn.prefs.get().no18 ? window.tnSheet?.details() : null,   // Settings: "Hide titles rated 18"
  ])).then(([c, t, d]) => {
    cat = c; certs = d; known = new Set(cat.items.map(keyOf));
    for (const s of t?.services || []) { logos[s.key] = s.logo; labels[s.key] = s.label; }
    if (!Object.keys(labels).length) Object.assign(labels, { netflix: 'Netflix', disney: 'Disney+', prime: 'Prime Video', hbomax: 'HBO Max', paramount: 'Paramount+', appletv: 'Apple TV' });
    build();
    // the overviews and wide artwork come a moment later, for the cards' blurb and the sheet
    fetch('data/browse-more.json').then((r) => (r.ok ? r.json() : null)).then((m) => { more = m; cards.forEach((el) => fillBlurb(el)); }).catch(() => {});
  }).catch(() => { stage.innerHTML = '<div class="d-end"><h2>The titles didn’t load</h2><p>They’re rebuilt every hour, so try again shortly.</p></div>'; });

  // the deck: everything on the six services not already saved or skipped, popular first but shuffled a little in small
  // batches so it feels fresh
  function build() {
    const skip = skipped.all(), hid = window.tn.hidden.keys(), withArt = cat.items.some((x) => x.img);
    const pool = cat.items.filter((x) => (kind === 'both' || x.t === kind) && x.s.length && (!withArt || x.img)
      && !skip[keyOf(x)] && !saved.has(keyOf(x)) && !hid.has(keyOf(x)) && (!certs || certs.items?.[keyOf(x)]?.c !== '18'))
      .sort((a, b) => (b.p * (0.6 + (b.r || 6) / 20)) - (a.p * (0.6 + (a.r || 6) / 20)));
    deck = [];
    for (let i = 0; i < pool.length; i += 10) deck.push(...pool.slice(i, i + 10).sort(() => Math.random() - 0.5));
    hist = []; $('#dUndo').disabled = true; dealt = 0;
    wide.q = []; wide.gen++; wide.busy = null; wide.end = false;
    stage.replaceChildren(); cards = [];
    fill(); hint(); pkSoon(0);
    if (kind !== 'tv') wideMore().then(() => { if (cards.length < 3) fill(); });
  }

  // ---------- the whole film catalogue: TMDB's films, most popular first, a page (20) at a time from the search service.
  // Pages are taken in a shuffled order within each run of ten, so the mix feels fresh; where you'd got to is kept on
  // this device so a return visit doesn't wade back through films already seen. Anything on the six services is left
  // to Tenner's own deck (which knows the services); if the service is down, the deck is just Tenner's catalogue. ----------
  const wide = { q: [], gen: 0, busy: null, end: false, order: [], down: 0 };
  let dealt = 0;
  const wideAt = (v) => { try { if (v == null) return Math.max(0, parseInt(localStorage.getItem(WIDE), 10) || 0); localStorage.setItem(WIDE, String(v)); } catch {} return 0; };
  const wideFresh = (x) => { const k = keyOf(x); return !known.has(k) && !skipped.all()[k] && !saved.has(k) && !window.tn.hidden.keys().has(k) && !cards.some((el) => el.dataset.k === k); };
  function wideMore() {
    if (!window.tn.api || wide.end || wide.q.length >= 8 || Date.now() < wide.down) return Promise.resolve();
    if (wide.busy) return wide.busy;
    const gen = wide.gen, no18 = window.tn.prefs.get().no18;
    wide.busy = (async () => {
      for (let tries = 0; tries < 4 && wide.q.length < 8; tries++) {
        let at = wideAt();
        if (!wide.order.length) { const b = Math.floor(at / 10) * 10; wide.order = Array.from({ length: 10 }, (_, i) => b + i + 1).filter((n) => n > at).sort(() => Math.random() - 0.5); }
        const page = wide.order.shift();
        if (!page || page > 500) { wide.end = true; break; }
        const d = await fetch(`${window.tn.api}/discover?page=${page}${no18 ? '&no18=1' : ''}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (gen !== wide.gen) return;
        if (!d) { wide.order.unshift(page); wide.down = Date.now() + 60000; break; }   // the service is down: Tenner's own deck for a minute
        if (!wide.order.length) wideAt(Math.floor(at / 10) * 10 + 10);   // that run of ten is done
        if (page > (d.pages || 500)) { wide.end = true; break; }
        wide.q.push(...(d.items || []).map((x) => ({ ...x, wide: 1, s: [] })).filter(wideFresh).sort(() => Math.random() - 0.5));
      }
    })().finally(() => { if (gen === wide.gen) wide.busy = null; });
    return wide.busy;
  }
  // the next card: Tenner's own deck, with a film from the whole catalogue every other card (Films) or every third (both)
  function next() {
    const every = kind === 'movie' ? 2 : kind === 'both' ? 3 : 0;
    while (wide.q.length && !wideFresh(wide.q[0])) wide.q.shift();
    const takeWide = every && wide.q.length && (!deck.length || dealt % every === every - 1);
    if (every && wide.q.length < 8 && !wide.busy) wideMore().then(() => { if (cards.length < 3) fill(); });
    const x = takeWide ? wide.q.shift() : deck.shift();
    if (x) dealt++;
    return x;
  }

  // ---------- cards ----------
  const SAVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18.4l-6-4.2-6 4.2z" fill="currentColor"/></svg>';
  const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>';
  function cardFor(x) {
    const el = document.createElement('article'), h = hue(x.n), src = img(x, 'w500');
    el.className = 'dc'; el.dataset.k = keyOf(x); el._x = x;
    const genres = genresOf(x, 2);
    const meta = [x.t === 'movie' ? 'Film' : 'Series', year(x), ...genres].filter(Boolean).map(esc).join(' · ');
    const svc = x.s.filter((s) => labels[s]).slice(0, 3).map((s) => (logos[s] ? `<img src="${esc(logos[s])}" alt="${esc(labels[s])}" data-tip="${esc(labels[s])}">` : `<span>${esc(labels[s])}</span>`)).join('');
    el.innerHTML = `${src ? `<img class="dc-img" src="${esc(src)}" srcset="${esc(src)} 500w, ${esc(img(x, 'w780'))} 780w" sizes="380px" alt="" decoding="async" draggable="false">`
      : `<span class="dc-img dc-ph" style="background:linear-gradient(160deg,hsl(${h} 50% 42%),hsl(${(h + 40) % 360} 55% 16%))"></span>`}
      <span class="dc-tag dc-tag-yes" aria-hidden="true">${SAVE}Watchlist</span><span class="dc-tag dc-tag-no" aria-hidden="true">${X}Skip</span>
      <div class="dc-info">${x.r ? `<span class="dc-r">★ ${x.r.toFixed(1)}</span>` : ''}<h2>${esc(x.n)}</h2><p class="dc-meta">${meta}</p><p class="dc-ov"></p>${svc ? `<div class="dc-on">${svc}</div>` : ''}</div>`;
    el.setAttribute('aria-label', `${x.n}, ${x.t === 'movie' ? 'film' : 'series'}${year(x) ? `, ${year(x)}` : ''}`);
    fillBlurb(el);
    return el;
  }
  function fillBlurb(el) { const ov = extra(el._x)[0]; if (ov) el.querySelector('.dc-ov').textContent = ov; }
  // keep three cards on the table: the top one and two waiting behind
  function fill() {
    let x;
    while (cards.length < 3 && (x = next())) { const el = cardFor(x); el.style.setProperty('--d', cards.length); cards.push(el); stage.prepend(el); }
    depths(); ambient();
    const empty = !cards.length;
    $('#dActs').classList.toggle('off', empty);
    if (empty && wide.busy) return;   // more films are on their way
    if (empty && !stage.querySelector('.d-end')) {
      stage.insertAdjacentHTML('beforeend', `<div class="d-end"><span class="d-end-ic" aria-hidden="true">${SAVE}</span><h2>You’ve seen them all</h2>
        <p>That’s everything${kind === 'tv' ? ' in shows' : kind === 'movie' ? ' in films' : ''} in the catalogue for now. New titles arrive every hour.</p>
        <div class="d-end-b"><button type="button" class="btn btn-tinted" id="dAgain"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>Show skipped again</button><a class="btn btn-tinted" href="charts.html#watchlist"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18.4l-6-4.2-6 4.2z" fill="currentColor"/></svg>Your Watchlist</a></div></div>`);
      $('#dAgain').addEventListener('click', () => {
        const o = skipped.all(); for (const x of cat.items) if (kind === 'both' || x.t === kind) delete o[keyOf(x)];
        if (kind !== 'tv') { for (const k of Object.keys(o)) if (k[0] === 'm' && !known.has(k)) delete o[k]; wideAt(0); wide.order = []; }   // the whole catalogue's films too, from the top
        skipped.set(o); build();
      });
    }
  }
  function depths() {
    cards.forEach((el, i) => { el.style.setProperty('--d', i); el.classList.toggle('top', i === 0); el.inert = i > 0; el.tabIndex = i ? -1 : 0; });
  }
  // the top card's colours glow softly behind the deck
  function ambient() {
    const a = $('#dAmb'), src = cards[0] && img(cards[0]._x, 'w185');
    if (!src) { a.hidden = true; return; }
    if (a.getAttribute('src') === src) return;
    a.classList.remove('in'); a.onload = () => a.classList.add('in'); a.src = src; a.hidden = false;
  }

  // ---------- swiping ----------
  const say = (t) => { $('#dSay').textContent = t; };
  const infoFor = (x) => {
    const e = extra(x);
    return { k: keyOf(x), type: x.t, title: x.n, year: year(x), rating: x.r || null, poster: img(x, 'w342'), backdrop: backdrop(x, e), overview: e[0] || '',
      genres: genresOf(x, 3), tmdb: `https://www.themoviedb.org/${x.t}/${x.i}`,
      services: x.s.map((s) => ({ label: labels[s] || s, logo: logos[s] })) };
  };
  function counter() {
    const c = $('#dCount'); c.hidden = !added;
    c.innerHTML = `${SAVE}<span><b>${added}</b> added to your Watchlist</span>`;
  }
  // a decision: the top card leaves (to the right, or the left), and the next comes forward
  function decide(yes, from) {
    const el = cards[0]; if (!el || el.leaving) return;
    el.leaving = true; const x = el._x, k = keyOf(x);
    if (yes) { if (!saved.has(k)) saved.toggle(infoFor(x)); added++; counter(); }
    else skipped.add(k);
    swipes.set(k, yes);   // For You learns from it
    hist.push({ x, yes }); if (hist.length > 30) hist.shift(); $('#dUndo').disabled = false;
    say(`${x.n}: ${yes ? 'added to your Watchlist' : 'skipped'}`);
    navigator.vibrate?.(8);
    cards.shift(); fill();
    const w = innerWidth, sx = from?.x || 0, sy = from?.y || 0, dir = yes ? 1 : -1;
    el.classList.add(yes ? 'yes' : 'no'); el.classList.remove('top'); el.style.setProperty('--d', 0);
    const done = () => el.remove();
    if (reduce() || !el.animate) return done();
    const vy = from?.vy || 0, ex = dir * (w + 200), ey = sy + vy * 260, rot = dir * 22 + sx / 30;
    el.animate([{ transform: `translate(${sx}px,${sy}px) rotate(${sx / 18}deg)` }, { transform: `translate(${ex}px,${ey}px) rotate(${rot}deg)` }],
      { duration: from ? 300 : 420, easing: from ? 'cubic-bezier(.25,.6,.4,1)' : 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' }).finished.then(done, done);
  }
  function undo() {
    const h = hist.pop(); if (!h) return;
    $('#dUndo').disabled = !hist.length;
    const k = keyOf(h.x);
    if (h.yes) { saved.remove(k); added = Math.max(0, added - 1); counter(); } else skipped.drop(k);
    swipes.set(k, null);
    stage.querySelector('.d-end')?.remove();
    // the third card goes back in the pile; the undone one returns on top
    if (cards.length >= 3) { const last = cards.pop(); (last._x.wide ? wide.q : deck).unshift(last._x); last.remove(); }
    const el = cardFor(h.x); cards.unshift(el); stage.append(el); depths(); ambient(); $('#dActs').classList.remove('off');
    say(`${h.x.n} is back`);
    if (!reduce() && el.animate) { const dir = h.yes ? 1 : -1; el.animate([{ transform: `translate(${dir * (innerWidth + 100)}px,40px) rotate(${dir * 20}deg)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.9,.25,1.05)' }); }
  }
  function details() {
    const el = cards[0]; if (!el) return;
    window.tnSheet?.open(infoFor(el._x));
  }
  // the details sheet's own Watchlist button counts as a swipe right once it closes
  addEventListener('tn:sheet-closed', () => {
    const el = cards[0]; if (el && saved.has(el.dataset.k)) decide(true);
  });

  // the finger (or mouse): the card follows it and tilts from the bottom; past a point (or flicked) it goes, otherwise it
  // springs back. The point is a fifth of the card's width, and a quick flick is enough, so a mouse needn't drag far.
  let drag = null;
  const reach = () => (cards[0]?.offsetWidth || 340) * 0.2;
  const lean = (el, x, y = 0) => {
    const r = reach(), down = y > 0 && y > Math.abs(x) * 1.2;
    el.style.transform = `translate(${x}px,${down ? y * 0.55 : y * 0.35}px) rotate(${down ? 0 : x / 18}deg)`;
    el.style.setProperty('--yes', Math.max(0, Math.min(1, x / r)));
    el.style.setProperty('--no', Math.max(0, Math.min(1, -x / r)));
    el.classList.toggle('armed', Math.abs(x) >= r);   // past the point: the label settles, so you know letting go will send it
    stage.style.setProperty('--p', Math.min(1, Math.abs(x) / (r * 1.5)));
  };
  const springBack = (el) => {
    el.style.removeProperty('--yes'); el.style.removeProperty('--no'); el.classList.remove('armed'); stage.style.removeProperty('--p');
    const from = el.style.transform; el.style.transform = '';
    if (!reduce() && el.animate && from) el.animate([{ transform: from }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,1.4,.4,1)' });
  };
  stage.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.dc.top'); if (!el || e.button || el.leaving) return;
    drag = { el, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0, t: performance.now(), vx: 0, vy: 0, moved: false };
    el.setPointerCapture(e.pointerId); el.classList.add('held'); stage.classList.add('dragging');
    el.getAnimations().forEach((a) => a.cancel());
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const x = e.clientX - drag.x0, y = e.clientY - drag.y0, now = performance.now(), dt = Math.max(1, now - drag.t);
    drag.vx = 0.7 * ((x - drag.x) / dt) + 0.3 * drag.vx; drag.vy = 0.7 * ((y - drag.y) / dt) + 0.3 * drag.vy;
    drag.x = x; drag.y = y; drag.t = now; if (Math.hypot(x, y) > 8) drag.moved = true;   // a little wobble is still a tap
    lean(drag.el, x, y);
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { el, x, y, vx, vy, moved } = drag; drag = null;
    el.classList.remove('held'); stage.classList.remove('dragging');
    const back = () => springBack(el);
    if (!moved) { back(); details(); return; }   // a tap: the details
    if (Math.abs(x) >= reach() || (Math.abs(vx) > 0.35 && Math.abs(x) > 24)) { el.classList.remove('armed'); stage.style.removeProperty('--p'); el.style.transform = ''; decide(x > 0, { x, y: y * 0.35, vy }); return; }
    if (y > 100 && y > Math.abs(x) * 1.2) { back(); details(); return; }
    back();
  };

  // a trackpad: swipe sideways with two fingers, as through photos. The card follows; past the point it goes straight away
  // (the trackpad's own glide afterwards is ignored), short of it the card springs back once the fingers stop
  const wheel = { x: 0, t: 0, rest: 0 };
  stage.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;   // up and down: the page scrolls as usual
    e.preventDefault();                                      // sideways: ours (not the browser's back and forward)
    const el = cards[0]; if (!el || el.leaving || drag) return;
    if (performance.now() < wheel.rest) return;              // the glide after a card went
    wheel.x -= e.deltaX; lean(el, wheel.x);
    clearTimeout(wheel.t);
    if (Math.abs(wheel.x) >= reach() * 1.4) {
      const x = wheel.x; wheel.x = 0; wheel.rest = performance.now() + 450;
      el.classList.remove('armed'); stage.style.removeProperty('--p'); el.style.transform = '';
      decide(x > 0, { x, y: 0, vy: 0 }); return;
    }
    wheel.t = setTimeout(() => { wheel.x = 0; springBack(el); }, 140);
  }, { passive: false });
  stage.addEventListener('pointerup', release); stage.addEventListener('pointercancel', release);

  $('#dYes').addEventListener('click', () => decide(true));
  $('#dNo').addEventListener('click', () => decide(false));
  $('#dUndo').addEventListener('click', undo);
  $('#dInfo').addEventListener('click', details);
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || window.tnSheet?.isOpen() || e.target.closest('input, textarea, [role="radiogroup"], dialog')) return;
    const act = { ArrowRight: () => decide(true), ArrowLeft: () => decide(false), ArrowDown: details, Backspace: undo }[e.key]
      || ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.dc.top') ? details : null);
    if (act) { e.preventDefault(); act(); }
  });

  // ---------- Your picks: ten titles ranked from your swipes (shell.js's forYou, as the home page's For you does), redrawn
  // a moment after each swipe. Rows keep their place in the DOM so a title glides to its new rank; one that climbs gets a
  // small green arrow under its number for a moment, as on the Top 10. Nothing on the table now (the three cards) is listed. ----------
  const pk = { like: {}, want: null, rows: new Map(), t: 0 };
  const UP = '<svg class="d-pk-up" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.2 10.4 8.6H1.6z" fill="currentColor"/></svg>';
  const still = () => document.documentElement.classList.contains('still');
  function pkSoon(wait = 140) { clearTimeout(pk.t); pk.t = setTimeout(pkLike, wait); }
  // TMDB's "more like this" for your latest right swipes lifts the closest matches (fetched when signed in, kept three days)
  function pkLike() {
    const want = swipes.liked().slice(0, 4).join() + !!window.tn.account?.token();
    if (want !== pk.want) { pk.want = want; window.tn.moreLike(!!window.tn.account?.token()).then((l) => { pk.like = l; pkDraw(); }); }
    pkDraw();
  }
  function pkRow(x) {
    const li = document.createElement('li'), src = img(x, 'w92'), h = hue(x.n);
    li._x = x;
    li.innerHTML = `<button type="button"><span class="d-pk-n"><i></i>${UP}</span><span class="d-pk-art">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : `<span style="background:hsl(${h} 45% 35%)"></span>`}</span>
      <span class="d-pk-copy"><b>${esc(x.n)}</b><small>${esc([x.t === 'movie' ? 'Film' : 'Series', year(x)].filter(Boolean).join(' · '))}</small></span></button>`;
    return li;
  }
  function pkDraw() {
    if (!cat) return;
    const list = $('#dPkL'), sub = $('#dPkSub'), table = new Set(cards.map((el) => el.dataset.k));
    const r = window.tn.forYou(cat.items, (x) => (kind === 'both' || x.t === kind) && !table.has(keyOf(x)) && (!certs || certs.items?.[keyOf(x)]?.c !== '18'), pk.like, 10);
    if (!r) {
      pk.rows.clear(); list.className = 'd-pk-l sk'; list.setAttribute('aria-hidden', 'true'); list.innerHTML = '<li><i></i><em></em></li>'.repeat(5);
      sub.textContent = 'Swipe right on a few titles and ten you’ll like line up here'; return;
    }
    const b = r.because;
    sub.textContent = !b ? 'From what you’ve liked so far' : r.how === 'liked' ? `Because you liked ${b.n}` : `Because you ${r.how} ${b.n}`;
    const had = list.classList.contains('sk') ? new Map() : pk.rows;
    const top = new Map([...had].map(([k, li]) => [k, li.getBoundingClientRect().top]));
    const next = new Map();
    r.picks.forEach((x, i) => {
      const k = keyOf(x), li = had.get(k) || pkRow(x), was = had.get(k) ? +li.dataset.n : null;
      li.dataset.n = i; li.querySelector('.d-pk-n i').textContent = i + 1;
      if (was != null && i < was) { li.classList.add('up'); clearTimeout(li._up); li._up = setTimeout(() => li.classList.remove('up'), 2400); }
      next.set(k, li);
    });
    list.className = 'd-pk-l'; list.removeAttribute('aria-hidden');
    list.replaceChildren(...next.values()); pk.rows = next;
    if (still() || !had.size) return;
    // the glide: each row from where it was to its new place, on a spring; newcomers grow in
    for (const [k, li] of next) {
      if (!li.animate) break;
      if (top.has(k)) { const dy = top.get(k) - li.getBoundingClientRect().top; if (Math.abs(dy) > 1) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,1.15,.35,1)' }); }
      else li.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.9,.25,1)' });
    }
  }
  $('#dPkL').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li?._x) window.tnSheet?.open(infoFor(li._x)); });
  ['tn:swiped', 'tn:saved', 'tn:account', 'tn:synced'].forEach((n) => addEventListener(n, () => pkSoon()));
  window.tn.tip?.({ id: 'discover-every-film', for: $('#dKindDD').offsetParent ? '#dKindDD' : '#dInfo',   // the menu on computers; on phones it's tucked away, so Details
    title: 'Every film', text: 'Discover now deals films from the whole film catalogue, not just what’s on your services. Tap one to see where it’s on, if it’s anywhere.' });
  window.tn.tip?.({ id: 'your-picks', for: '#dPkH', title: 'Your picks', text: 'Every swipe re-ranks this list. Swipe right on what you like and ten titles you’ll probably enjoy line up here, best first. Tap one for details.' });

  // the first time: the top card leans right, then left, to show it moves
  function hint() {
    let seen = false; try { seen = !!localStorage.getItem(HINTED); localStorage.setItem(HINTED, '1'); } catch {}
    const el = cards[0]; if (seen || reduce() || !el?.animate) return;
    setTimeout(() => el.isConnected && !el.leaving && el.animate([{ transform: 'none' }, { transform: 'translateX(46px) rotate(3deg)' }, { transform: 'translateX(-46px) rotate(-3deg)' }, { transform: 'none' }],
      { duration: 1400, easing: 'cubic-bezier(.45,0,.3,1)' }), 700);
  }

  // with a mouse and keyboard, the hint says how
  if (mouse.matches) $('#dHint').textContent = 'Drag or swipe with two fingers: right to save, left to skip · or use ← →, and ↓ for details';

  // ---------- Shows, Films or Both: a native menu, as on the Top 10 ----------
  const NAMES = { tv: 'Shows', movie: 'Films', both: 'Shows and films' };
  $('#dKind').value = kind; $('#dKindL').textContent = NAMES[kind];
  $('#dKind').addEventListener('change', (e) => {
    kind = e.target.value; $('#dKindL').textContent = NAMES[kind];
    try { localStorage.setItem(KIND, kind); } catch {}
    if (cat) build();
  });
})();

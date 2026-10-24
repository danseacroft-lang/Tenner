// Tenner Discover: a deck of shows and films on your services, one card at a time. Swipe right to add it to
// your Watchlist, left to skip it, down (or tap) for the details sheet. The buttons and arrow keys do the same.
// Skipped titles are remembered on this device so they don't come round again; Undo takes back the last swipe.
(() => {
  const { esc, hue, reduce, saved } = window.tn;   // from shell.js
  const $ = (s) => document.querySelector(s);
  const SKIP = 'tenner-skipped', KIND = 'tenner-discover-kind', HINTED = 'tenner-discover-hinted';
  const stage = $('#dStage'), mouse = matchMedia('(hover: hover) and (pointer: fine)');


  // ---------- what's been skipped (this device only) ----------
  const skipped = {
    all() { try { return JSON.parse(localStorage.getItem(SKIP) || '{}') || {}; } catch { return {}; } },
    set(o) { const ks = Object.keys(o); if (ks.length > 3000) ks.sort((a, b) => o[a] - o[b]).slice(0, ks.length - 3000).forEach((k) => delete o[k]); try { localStorage.setItem(SKIP, JSON.stringify(o)); } catch {} },
    add(k) { const o = skipped.all(); o[k] = Date.now(); skipped.set(o); },
    drop(k) { const o = skipped.all(); delete o[k]; skipped.set(o); },
  };

  // ---------- data ----------
  let cat = null, more = null, certs = null, labels = {}, logos = {}, deck = [], cards = [], hist = [], added = 0;
  let kind = (() => { try { const k = localStorage.getItem(KIND); return ['tv', 'movie', 'both'].includes(k) ? k : 'both'; } catch { return 'both'; } })();
  const keyOf = (x) => `${x.t[0]}${x.i}`;
  const img = (x, w) => (!x.img ? null : x.img.startsWith('/') ? cat.img.replace(/\/w\d+$/, `/${w}`) + x.img : x.img);
  const year = (x) => (x.d || '').slice(0, 4) || null;
  const extra = (x) => more?.items?.[keyOf(x)] || [];

  Promise.all([
    fetch('data/browse.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    fetch('data/trending.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    window.tn.prefs.get().no18 ? window.tnSheet?.details() : null,   // Settings: "Hide titles rated 18"
  ]).then(([c, t, d]) => {
    cat = c; certs = d;
    for (const s of t?.services || []) if (!s.store) { logos[s.key] = s.logo; labels[s.key] = s.label; }
    if (!Object.keys(labels).length) Object.assign(labels, { netflix: 'Netflix', disney: 'Disney+', prime: 'Prime Video', hbomax: 'HBO Max', paramount: 'Paramount+' });
    build();
    // the overviews and wide artwork come a moment later, for the cards' blurb and the sheet
    fetch('data/browse-more.json').then((r) => (r.ok ? r.json() : null)).then((m) => { more = m; cards.forEach((el) => fillBlurb(el)); }).catch(() => {});
  }).catch(() => { stage.innerHTML = '<div class="d-end"><h2>The titles didn’t load</h2><p>They’re rebuilt every hour, so try again shortly.</p></div>'; });

  // the deck: your services (all five if you haven't chosen), not already saved or skipped, popular first but shuffled a
  // little in small batches so it feels fresh each time
  function build() {
    const mine = window.tn.mine.get().filter((k) => labels[k]), on = new Set(mine.length ? mine : Object.keys(labels));
    const skip = skipped.all(), withArt = cat.items.some((x) => x.img);
    const pool = cat.items.filter((x) => (kind === 'both' || x.t === kind) && x.s.some((s) => on.has(s)) && (!withArt || x.img)
      && !skip[keyOf(x)] && !saved.has(keyOf(x)) && (!certs || certs.items?.[keyOf(x)]?.c !== '18'))
      .sort((a, b) => (b.p * (0.6 + (b.r || 6) / 20)) - (a.p * (0.6 + (a.r || 6) / 20)));
    deck = [];
    for (let i = 0; i < pool.length; i += 10) deck.push(...pool.slice(i, i + 10).sort(() => Math.random() - 0.5));
    hist = []; $('#dUndo').disabled = true;
    stage.replaceChildren(); cards = [];
    fill(); hint();
  }

  // ---------- cards ----------
  const SAVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18.4l-6-4.2-6 4.2z" fill="currentColor"/></svg>';
  const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>';
  function cardFor(x) {
    const el = document.createElement('article'), h = hue(x.n), src = img(x, 'w500');
    el.className = 'dc'; el.dataset.k = keyOf(x); el._x = x;
    const genres = [...new Set(x.g.map((g) => cat.genres[g]).filter(Boolean))].slice(0, 2);
    const meta = [x.t === 'movie' ? 'Film' : 'Series', year(x), ...genres].filter(Boolean).map(esc).join(' · ');
    const svc = x.s.filter((s) => labels[s]).slice(0, 3).map((s) => (logos[s] ? `<img src="${esc(logos[s])}" alt="${esc(labels[s])}" title="${esc(labels[s])}">` : `<span>${esc(labels[s])}</span>`)).join('');
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
    while (cards.length < 3 && deck.length) { const el = cardFor(deck.shift()); el.style.setProperty('--d', cards.length); cards.push(el); stage.prepend(el); }
    depths(); ambient();
    const empty = !cards.length;
    $('#dActs').classList.toggle('off', empty);
    if (empty && !stage.querySelector('.d-end')) {
      stage.insertAdjacentHTML('beforeend', `<div class="d-end"><span class="d-end-ic" aria-hidden="true">${SAVE}</span><h2>You’ve seen them all</h2>
        <p>That’s everything ${kind === 'tv' ? 'in shows' : kind === 'movie' ? 'in films' : ''} on your services for now. New titles arrive every hour.</p>
        <div class="d-end-b"><button type="button" class="btn btn-tinted" id="dAgain">Show skipped again</button><a class="btn" href="./#watchlist">Your Watchlist</a></div></div>`);
      $('#dAgain').addEventListener('click', () => { const o = skipped.all(); for (const x of cat.items) if (kind === 'both' || x.t === kind) delete o[keyOf(x)]; skipped.set(o); build(); });
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
    return { k: keyOf(x), type: x.t, title: x.n, year: year(x), rating: x.r || null, poster: img(x, 'w342'), backdrop: e[1] && more?.img ? more.img + e[1] : null, overview: e[0] || '',
      genres: [...new Set(x.g.map((g) => cat.genres[g]).filter(Boolean))].slice(0, 3), tmdb: `https://www.themoviedb.org/${x.t}/${x.i}`,
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
    hist.push({ x, yes }); if (hist.length > 30) hist.shift(); $('#dUndo').disabled = false;
    say(`${x.n}: ${yes ? 'added to your Watchlist' : 'skipped'}`);
    navigator.vibrate?.(8);
    cards.shift(); fill();
    const w = innerWidth, sx = from?.x || 0, sy = from?.y || 0, dir = yes ? 1 : -1;
    el.classList.add(yes ? 'yes' : 'no'); el.classList.remove('top'); el.style.setProperty('--d', 0);
    const done = () => el.remove();
    if (reduce || !el.animate) return done();
    const vy = from?.vy || 0, ex = dir * (w + 200), ey = sy + vy * 260, rot = dir * 22 + sx / 30;
    el.animate([{ transform: `translate(${sx}px,${sy}px) rotate(${sx / 18}deg)` }, { transform: `translate(${ex}px,${ey}px) rotate(${rot}deg)` }],
      { duration: from ? 300 : 420, easing: from ? 'cubic-bezier(.25,.6,.4,1)' : 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' }).finished.then(done, done);
  }
  function undo() {
    const h = hist.pop(); if (!h) return;
    $('#dUndo').disabled = !hist.length;
    const k = keyOf(h.x);
    if (h.yes) { saved.remove(k); added = Math.max(0, added - 1); counter(); } else skipped.drop(k);
    stage.querySelector('.d-end')?.remove();
    // the third card goes back in the pile; the undone one returns on top
    if (cards.length >= 3) { const last = cards.pop(); deck.unshift(last._x); last.remove(); }
    const el = cardFor(h.x); cards.unshift(el); stage.append(el); depths(); ambient(); $('#dActs').classList.remove('off');
    say(`${h.x.n} is back`);
    if (!reduce && el.animate) { const dir = h.yes ? 1 : -1; el.animate([{ transform: `translate(${dir * (innerWidth + 100)}px,40px) rotate(${dir * 20}deg)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.9,.25,1.05)' }); }
  }
  function details() {
    const el = cards[0]; if (!el) return;
    window.tnSheet?.open(infoFor(el._x));
  }
  // the details sheet's own Watchlist button counts as a swipe right once it closes
  addEventListener('tn:sheet-closed', () => {
    const el = cards[0]; if (el && saved.has(el.dataset.k)) decide(true);
  });

  // the finger: the card follows it and tilts from the bottom; past a point (or flicked) it goes, otherwise it springs back
  let drag = null;
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
    drag.x = x; drag.y = y; drag.t = now; if (Math.hypot(x, y) > 6) drag.moved = true;
    const down = y > 0 && y > Math.abs(x) * 1.2;
    drag.el.style.transform = `translate(${x}px,${down ? y * 0.55 : y * 0.35}px) rotate(${down ? 0 : x / 18}deg)`;
    drag.el.style.setProperty('--yes', Math.max(0, Math.min(1, x / 110)));
    drag.el.style.setProperty('--no', Math.max(0, Math.min(1, -x / 110)));
    stage.style.setProperty('--p', Math.min(1, Math.abs(x) / 160));
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { el, x, y, vx, vy, moved } = drag; drag = null;
    el.classList.remove('held'); stage.classList.remove('dragging'); stage.style.removeProperty('--p');
    const back = () => {
      el.style.removeProperty('--yes'); el.style.removeProperty('--no');
      const from = el.style.transform; el.style.transform = '';
      if (!reduce && el.animate && from) el.animate([{ transform: from }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,1.4,.4,1)' });
    };
    if (!moved) { back(); details(); return; }   // a tap: the details
    if (Math.abs(x) > 110 || (Math.abs(vx) > 0.6 && Math.abs(x) > 30)) { el.style.transform = ''; decide(x > 0, { x, y: y * 0.35, vy }); return; }
    if (y > 100 && y > Math.abs(x) * 1.2) { back(); details(); return; }
    back();
  };
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

  // the first time: the top card leans right, then left, to show it moves
  function hint() {
    let seen = false; try { seen = !!localStorage.getItem(HINTED); localStorage.setItem(HINTED, '1'); } catch {}
    const el = cards[0]; if (seen || reduce || !el?.animate) return;
    setTimeout(() => el.isConnected && !el.leaving && el.animate([{ transform: 'none' }, { transform: 'translateX(46px) rotate(3deg)' }, { transform: 'translateX(-46px) rotate(-3deg)' }, { transform: 'none' }],
      { duration: 1400, easing: 'cubic-bezier(.45,0,.3,1)' }), 700);
  }

  // with a mouse and keyboard, the hint says how
  // on a computer Discover isn't in the sidebar (it's found on Browse), so Browse stays highlighted there
  const tab = document.querySelector('[data-tab="discover"]');
  if (tab && !tab.offsetWidth) window.tnShell?.select('browse');
  if (mouse.matches) $('#dHint').textContent = 'Drag right to save, left to skip · or use ← → and ↓ for details';

  // ---------- Shows, Films or Both: a native menu, as on the Top 10 ----------
  const NAMES = { tv: 'Shows', movie: 'Films', both: 'Shows and films' };
  $('#dKind').value = kind; $('#dKindL').textContent = NAMES[kind];
  $('#dKind').addEventListener('change', (e) => {
    kind = e.target.value; $('#dKindL').textContent = NAMES[kind];
    try { localStorage.setItem(KIND, kind); } catch {}
    if (cat) build();
  });
  // your services changed (in another tab, or the menu): a fresh deck
  addEventListener('tn:mine', () => cat && build());
})();

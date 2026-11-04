// Tenner's home page: a streaming dashboard built from Tenner's own data.
// The six services as a rail of app icons that filter everything (tap several to pick them together) (with Shows, films or both and a genre beside them), a big featured
// title from what's popular (its scores in a frosted box, its genres as pills, where to watch and a Watchlist button),
// rows of the most popular and newest, and the top rated at a glance; beside them a column of boxes: Discover's swipe deck,
// the Top 10 itself, What should I watch tonight?, this week's biggest climbers and Tenner TV.
// Reads data/trending.json, browse.json and week.json (rebuilt hourly), and titles.json through the title sheet.
// The Top 10 lives here (its own page is gone); New and Watchlist live on charts.html, and old links to them here are sent on.

(() => {
  // links from before the charts had their own page (bookmarks, alerts, emails, the Home Screen) and Settings' "Open
  // Tenner on" go straight to the charts
  {
    const h = location.hash.slice(1), start = window.tn.prefs.get().start;
    const chart = /^(new|watchlist|week)$/.test(h);
    let first = true; try { first = !sessionStorage.getItem('tenner-opened'); sessionStorage.setItem('tenner-opened', '1'); } catch {}
    const opener = first && !h && !location.search && ['new', 'watchlist'].includes(start);
    if (chart || opener) { location.replace(`charts.html${location.search}#${chart ? h : start}`); return; }
  }
  const { esc, hue, reduce } = window.tn;
  const $ = (s, el = document) => el.querySelector(s);
  const LOGO = 'https://image.tmdb.org/t/p/w500';
  const KINDS = { both: 'Shows and films', tv: 'Shows', movie: 'Films' };
  const state = { kind: 'both', picks: [], genre: null, hero: 0, data: null, cat: null, week: null, titles: null };
  // the services you've picked in the rail (none means all six): your last choice here, or else My services
  const PICKS = 'tenner-home-svc';
  try { const l = JSON.parse(localStorage.getItem(PICKS) || 'null'); state.picks = Array.isArray(l) ? l : window.tn.mine.get(); } catch {}
  // this visit's choice, or else Settings' "Show"
  try { const k = sessionStorage.getItem('tenner-home-kind') || localStorage.getItem('tenner-kind'); if (KINDS[k]) state.kind = k; } catch {}

  // ---------- icons ----------
  const I = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.4-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" fill="currentColor"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    tick: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5.5 12.5 4.2 4.2 8.8-9.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.2 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="currentColor"/></svg>',
    flame: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.4 2.8c.4 3-1.3 4.6-2.8 6.2C8.2 10.5 7 12 7 14.6A5 5 0 0 0 12 19.8a5 5 0 0 0 5-5.1c0-2.4-1.2-4-2.3-5.3-.2 1.3-.8 2.2-1.8 2.7.6-3.2-.1-6.6-.5-9.3z" fill="currentColor"/></svg>',
    left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5.5 6.5 6.5-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="2" fill="currentColor"/><rect x="13.5" y="3.5" width="7" height="7" rx="2" fill="currentColor"/><rect x="3.5" y="13.5" width="7" height="7" rx="2" fill="currentColor"/><rect x="13.5" y="13.5" width="7" height="7" rx="2" fill="currentColor"/></svg>',
    tv: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.8" y="5.5" width="18.4" height="12.5" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M8.5 21h7M9 2.8l3 2.7 3-2.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cross: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 10.5v7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="6.4" r="1.6" fill="currentColor"/></svg>',
    mark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18.4l-6-4.2-6 4.2z" fill="currentColor"/></svg>',
  };

  // ---------- data ----------
  const get = (n, bust) => fetch(`data/${n}.json${bust ? `?v=${Date.now()}` : ''}`, bust ? { cache: 'no-store' } : {}).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  async function load(bust) {
    const [data, cat, week] = await Promise.all([get('trending', bust), get('browse', bust), get('week', bust)]);
    if (!data) { if (!state.data) $('#bxRows').innerHTML = '<p class="bx-empty">The charts didn’t load. Check your connection and try again.</p>'; return; }
    Object.assign(state, { data, cat: cat || state.cat, week: week || state.week });
    state.picks = state.picks.filter((k) => services().some((s) => s.key === k));
    if (state.picks.length >= services().length) state.picks = [];
    draw(); refreshFy();
    window.tnSheet?.details().then((d) => { if (d) { state.titles = d; drawHeroCopy(); drawSide(); } });   // genres, age ratings, logos, episodes
    openFromUrl();
  }
  addEventListener('tn:check', () => load(true));

  const services = () => (state.data?.services || []).filter((s) => !s.shop && !s.store);
  window.tnTonight?.use({ cat: () => state.cat, services: () => state.data?.services, titles: () => state.titles });   // What should I watch tonight? borrows what's loaded
  const svcOf = (k) => (state.data?.services || []).find((s) => s.key === k);
  const kinds = () => (state.kind === 'both' ? ['tv', 'movie'] : [state.kind]);
  const det = (k) => state.titles?.items?.[k] || null;
  const keyOf = (it, type) => (/^\d+$/.test(String(it.id ?? '')) ? `${(it.type || type) === 'movie' ? 'm' : 't'}${it.id}` : null);
  const tmdbUrl = (type, id) => `https://www.themoviedb.org/${type}/${id}`;
  // phones show just the Top 10 and Top rated as rows of poster cards, for the whole of the UK (the services rail is a
  // computer-sized control, so it's put away there and doesn't quietly narrow the rows)
  const PHONE = matchMedia('(max-width: 719px)');
  const all = () => PHONE.matches || !state.picks.length;
  const picked = (k) => all() || state.picks.includes(k);
  const pickedAny = (l) => all() || (l || []).some(picked);
  const and = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}` : l[0] || '');
  const where = () => (all() ? 'in the UK' : `on ${and(state.picks.map((k) => svcOf(k)?.label).filter(Boolean))}`);
  // what's popular: every chart's titles (they come with artwork), kept to the kind and service you've picked, most popular first
  function popular() {
    const lists = all() ? [state.data.overall, ...(state.data.services || [])] : state.picks.map(svcOf).filter(Boolean);
    const seen = new Set(), out = [];
    for (const s of lists) for (const k of kinds()) for (const it of s[k] || []) {
      const x = { ...it, type: it.type || k, on: it.on || (s.key ? [s.key] : undefined) }, id = keyOf(x, x.type) || x.title;
      if (!seen.has(id)) { seen.add(id); out.push(x); }
    }
    return out.sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).map((it) => ({ it }));
  }
  // the catalogue (Browse's), kept to the kind, service and genre you've picked
  function catalogue() {
    const c = state.cat; if (!c?.items) return [];
    const ks = kinds(), hid = window.tn.hidden.keys();   // Not interested (signed in): left out
    return c.items.filter((x) => !hid.has(`${x.t[0]}${x.i}`) && ks.includes(x.t) && x.s?.length && pickedAny(x.s) && (state.genre == null || (x.g || []).includes(+state.genre)));
  }
  const fromCat = (x) => ({ id: x.i, type: x.t, title: x.n, year: (x.d || '').slice(0, 4), date: x.d, rating: x.r, on: x.s, url: tmdbUrl(x.t, x.i),
    poster: x.img ? (x.img.startsWith('/') ? state.cat.img + x.img : x.img) : null });

  // ---------- the title sheet: every title opens where-to-watch in Tenner ----------
  const shown = new Map();
  function infoFor(it, eye) {
    const type = it.type, k = keyOf(it, type);
    return { k, type, eye, title: it.title, year: it.year || (it.date || '').slice(0, 4) || null, rating: it.rating, poster: it.poster, backdrop: it.backdrop, overview: it.overview,
      netflix: /netflix\.com\/title\//.test(it.url || '') ? it.url : null, tmdb: k ? tmdbUrl(type, it.id) : null,
      services: (it.on || []).map(svcOf).filter(Boolean).map((s) => ({ label: s.label, logo: s.logo })) };
  }
  const regN = (info) => { const n = String(shown.size); shown.set(n, info); return n; };
  const reg = (info) => `data-sheet="${regN(info)}"`;
  const main = $('#main');
  main.addEventListener('click', (e) => {
    const save = e.target.closest('[data-save]');
    if (save) { e.preventDefault(); const info = shown.get(save.dataset.save), on = window.tn.saved.toggle(info); toast(on ? `${info.title} is on your Watchlist` : `${info.title} is off your Watchlist`); window.tn.haptic?.(); return; }
    const a = e.target.closest('[data-sheet]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;   // modified clicks open TMDB as usual
    e.preventDefault(); window.tnSheet?.open(shown.get(a.dataset.sheet));
  });
  window.tnSheet?.hover?.('a[data-sheet]:not(.bx-cta, .bx-dc-card)', (a) => shown.get(a.dataset.sheet));
  function openFromUrl() {
    const k = new URL(location.href).searchParams.get('t'); if (!k || window.tnSheet?.isOpen()) return;
    for (const info of shown.values()) if (info.k === k) { window.tnSheet.open(info, true); return; }
    window.tnSheet?.openKey?.(k);
  }
  addEventListener('tn:saved', () => { markSaved(); drawSide(); });
  // Not interested (signed in) changed: the rows and lists without it, once the sheet is closed
  let marksDirty = false;
  addEventListener('tn:marks', () => { marksDirty = true; if (!window.tnSheet?.isOpen?.() && state.cat) { marksDirty = false; drawRows(); drawSide(); } });
  addEventListener('tn:sheet-closed', () => { if (marksDirty && state.cat) { marksDirty = false; drawRows(); drawSide(); } });
  function markSaved() {
    for (const b of main.querySelectorAll('[data-save]')) {
      const info = shown.get(b.dataset.save), on = window.tn.saved.has(info?.k);
      b.setAttribute('aria-pressed', on); b.innerHTML = on ? I.tick : I.plus;
      b.setAttribute('aria-label', `${on ? 'Remove' : 'Add'} ${info?.title || ''} ${on ? 'from' : 'to'} your Watchlist`);
    }
  }
  const saveBtn = (info, cls = '') => `<button type="button" class="bx-r${cls}" data-save="${regN(info)}" aria-pressed="false">${I.plus}</button>`;

  let toastTimer;
  function toast(text) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600); }

  // ---------- pictures ----------
  const ph = (t, cls = '') => { const h = hue(t); return `<span class="bx-ph${cls}" style="background:linear-gradient(160deg,hsl(${h} 45% 40%),hsl(${(h + 40) % 360} 55% 16%))"><span>${esc(t)}</span></span>`; };
  const poster = (it) => (it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy" decoding="async">` : ph(it.title));
  const wide = (it, size = 'w780') => (it.backdrop ? `<img src="${esc(it.backdrop.replace('/w1280/', `/${size}/`))}" alt="" loading="lazy" decoding="async">` : it.poster ? `<img class="bx-blurfill" src="${esc(it.poster)}" alt="" loading="lazy">` : ph(it.title, ' wide'));
  const svcIcon = (s, cls = 'bx-svc') => (s?.logo ? `<img class="${cls}" src="${esc(s.logo)}" alt="${esc(s.label)}" title="${esc(s.label)}">` : '');
  const runtime = (m) => (!m ? '' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`);
  const rating = (r) => (r ? `<span class="bx-star">${I.star}${r.toFixed(1)}</span>` : '');

  // ---------- draw ----------
  function draw() {
    shown.clear();
    $('#bxKindL').textContent = KINDS[state.kind]; $('#bxKind').value = state.kind;
    drawRail(); drawGenres(); drawHero(); drawRows(); drawSide(); markSaved();
  }

  // the services as a rail of app icons (the first reference's left-hand rail, laid across the top of the rows)
  function drawRail() {
    const first = `<button type="button" class="bx-svc-b" data-svc="all" aria-pressed="${all()}"><span class="bx-app bx-app-all"><img src="logo.svg" alt=""></span><small>All six</small></button>`;
    $('#bxRail').innerHTML = first + services().map((s) => `<button type="button" class="bx-svc-b" data-svc="${esc(s.key)}" aria-pressed="${state.picks.includes(s.key)}">
      <span class="bx-app"${s.logo ? '' : ` style="--h:${hue(s.label)}"`}>${s.logo ? `<img src="${esc(s.logo)}" alt="">` : `<b>${esc(s.label.slice(0, 1))}</b>`}</span><small>${esc(s.label)}</small></button>`).join('');
  }
  $('#bxRail').addEventListener('click', (e) => {
    // a tap turns a service on or off, so you can pick several; All six clears them (and picking all six is the same)
    const b = e.target.closest('[data-svc]'), k = b?.dataset.svc; if (!b || (k === 'all' && all())) return;
    const l = k === 'all' ? [] : state.picks.includes(k) ? state.picks.filter((x) => x !== k) : [...state.picks, k];
    state.picks = l.length >= services().length ? [] : l; state.hero = 0;
    try { localStorage.setItem(PICKS, JSON.stringify(state.picks)); } catch {}
    window.tn.haptic?.(); morph(draw);
    $(`#bxRail [data-svc="${CSS.escape(k)}"]`)?.focus({ preventScroll: true });
  });
  window.tn.arrows($('#bxRail'), () => [...$('#bxRail').querySelectorAll('button')]);

  $('#bxKind').addEventListener('change', (e) => {
    state.kind = e.target.value; state.hero = 0;
    try { sessionStorage.setItem('tenner-home-kind', state.kind); } catch {}
    morph(draw);
  });
  // genres: a pop-up button beside Shows and films, listing the genres there are titles for (with the kind and services
  // you've picked), A to Z; a genre with nothing left after you change those goes back to All genres
  function genreList() {
    const c = state.cat; if (!c?.genres) return [];
    const ks = kinds(), have = new Set();
    for (const x of c.items) if (ks.includes(x.t) && pickedAny(x.s)) for (const g of x.g || []) if (c.genres[g]) have.add(String(g));
    return [...have].sort((a, b) => c.genres[a].localeCompare(c.genres[b], 'en-GB'));
  }
  function drawGenres() {
    const sel = $('#bxGen'), c = state.cat, list = genreList();
    if (state.genre != null && c?.genres && !list.includes(String(state.genre))) state.genre = null;
    const name = state.genre != null ? c?.genres?.[state.genre] : null;
    sel.innerHTML = '<option value="">All genres</option>' + genreList().map((g) => `<option value="${esc(g)}">${esc(c.genres[g])}</option>`).join('');
    sel.value = state.genre ?? '';
    $('#bxGenL').textContent = name || 'All genres';
    $('#bxGenDD').classList.toggle('on', state.genre != null);
  }
  $('#bxGen').addEventListener('change', (e) => {
    state.genre = e.target.value || null;
    $('#bxGenL').textContent = state.genre != null ? state.cat?.genres?.[state.genre] : 'All genres';
    $('#bxGenDD').classList.toggle('on', state.genre != null);
    morph(() => { drawRows(); drawSide(); markSaved(); });
  });
  const morph = (fn) => (document.startViewTransition && !document.documentElement.classList.contains('still') ? document.startViewTransition(fn) : fn());

  // ---------- the featured title ----------
  let heroList = [], heroTimer = 0;
  function drawHero() {
    const picks = popular(), withArt = picks.filter((p) => p.it.backdrop);
    heroList = (withArt.length >= 3 ? withArt : picks).slice(0, 10);
    const box = $('#bxHero'); box.classList.remove('sk');
    if (!heroList.length) { box.hidden = true; return; }
    box.hidden = false; state.hero = Math.min(state.hero, heroList.length - 1);
    box.innerHTML = `<div class="bx-h-art" id="bxArt"></div>
      <div class="bx-h-copy" id="bxCopy" aria-live="polite"></div>
      <div class="bx-h-next"><button type="button" class="bx-r bx-h-arr" data-harr="-1" aria-label="Back to the first featured titles" hidden>${I.left}</button>
        <div class="bx-h-strip" id="bxStrip" role="tablist" aria-label="Featured titles">${heroList.map((p, i) => `<button type="button" role="tab" data-hero="${i}" aria-selected="${i === state.hero}" aria-label="${esc(p.it.title)}" tabindex="${i === state.hero ? 0 : -1}">
        <span class="bx-h-thumb">${poster(p.it)}</span><span class="bx-h-bar" aria-hidden="true"></span></button>`).join('')}</div>
        <button type="button" class="bx-r bx-h-arr" data-harr="1" aria-label="See more featured titles" hidden>${I.right}</button></div>`;
    $('#bxStrip').addEventListener('scroll', stripArrows, { passive: true });
    showHero(state.hero, true);
    requestAnimationFrame(stripArrows);
  }
  function showHero(i, first) {
    state.hero = i; const { it } = heroList[i];
    const art = $('#bxArt'), layer = document.createElement('div');
    layer.className = 'bx-h-l'; layer.innerHTML = it.backdrop ? `<img src="${esc(it.backdrop.replace('/w1280/', '/original/'))}" srcset="${esc(it.backdrop)} 1280w, ${esc(it.backdrop.replace('/w1280/', '/original/'))} 1920w" sizes="(min-width: 1000px) 70vw, 100vw" alt="">` : wide(it);
    const put = () => {
      art.append(layer); requestAnimationFrame(() => layer.classList.add('in'));
      setTimeout(() => [...art.children].slice(0, -1).forEach((c) => c.remove()), first || reduce ? 0 : 900);
    };
    const img = layer.querySelector('img'); img?.decode ? img.decode().then(put, put) : put();
    ambient(it);
    drawHeroCopy();
    for (const b of $('#bxHero').querySelectorAll('[data-hero]')) { const on = +b.dataset.hero === i; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; }
    // keep the chosen poster in view in the strip
    const strip = $('#bxStrip'), b = strip?.querySelector(`[data-hero="${i}"]`);
    if (b && strip.scrollWidth > strip.clientWidth + 2 && (b.offsetLeft < strip.scrollLeft || b.offsetLeft + b.offsetWidth > strip.scrollLeft + strip.clientWidth))
      strip.scrollTo({ left: b.offsetLeft - 4, behavior: first || still() ? 'auto' : 'smooth' });
    startHero();
  }
  function drawHeroCopy() {
    const p = heroList[state.hero], c = $('#bxCopy'); if (!p || !c) return;
    const { it } = p, x = det(keyOf(it)) || {}, info = infoFor(it, 'Popular');
    const on = (it.on || state.picks).filter(picked).concat(it.on || []).map(svcOf).filter(Boolean)[0];   // one you picked first
    // the scores, in a frosted box (the second reference): TMDB's rating, the year, and the running time or seasons
    const cells = [
      it.rating ? [`${I.star}${it.rating.toFixed(1)}`, 'TMDB score'] : null,
      it.year ? [`${it.year}`, it.type === 'movie' ? 'released' : 'first aired'] : null,
      x.rt ? [runtime(x.rt), it.type === 'tv' ? 'an episode' : 'running time'] : x.se ? [`${x.se}`, x.se === 1 ? 'season' : 'seasons'] : null,
    ].filter(Boolean);
    const meta = [it.type === 'tv' ? (x.se ? `${x.se} season${x.se === 1 ? '' : 's'}` : 'Series') : 'Film', it.year, x.rt && it.type === 'movie' ? runtime(x.rt) : ''].filter(Boolean);
    const genres = (x.g || []).slice(0, 3);
    c.innerHTML = `<dl class="bx-score">${cells.map(([v, l]) => `<div><dt>${v}</dt><dd>${esc(l)}</dd></div>`).join('')}</dl>
      <p class="bx-eye">${I.flame}<span>Popular ${esc(where())} right now</span></p>
      ${genres.length ? `<p class="bx-pills">${genres.map((g) => `<span>${esc(g)}</span>`).join('')}</p>` : ''}
      <h2 class="bx-h-t">${x.lg ? `<img class="bx-h-logo" src="${esc(LOGO + x.lg)}" alt="${esc(it.title)}">` : esc(it.title)}</h2>
      <p class="bx-h-meta">${svcIcon(on)}<span>${meta.map(esc).join(' · ')}</span>${x.c ? `<b class="bx-cert">${esc(x.c)}</b>` : ''}</p>
      ${it.overview ? `<p class="bx-h-ov">${esc(it.overview)}</p>` : ''}
      <div class="bx-h-acts"><a class="btn btn-tinted bx-cta" href="${esc(it.url || '#')}" target="_blank" rel="noopener" ${reg(info)}>${I.play}Where to watch</a>${saveBtn(info, ' bx-r-l')}</div>`;
    const lg = c.querySelector('.bx-h-logo'); if (lg) lg.onerror = () => { lg.replaceWith(document.createTextNode(it.title)); };
    markSaved();
  }
  // the artwork's colours: a soft glow behind the page, and under the sidebar's frost
  function ambient(it) {
    const src = it.backdrop ? it.backdrop.replace('/w1280/', '/w780/') : it.poster;
    const glow = $('#bxAmb'), ext = $('#bdExt');
    if (!src) { glow.replaceChildren(); ext.replaceChildren(); return; }
    glow.innerHTML = `<img src="${esc(src)}" alt="">`; ext.innerHTML = `<img class="bd-l in" src="${esc(src)}" alt="">`;
  }
  $('#bxHero').addEventListener('click', (e) => {
    const a = e.target.closest('[data-harr]');
    if (a) { const s = $('#bxStrip'); s.scrollBy({ left: +a.dataset.harr * s.clientWidth, behavior: still() ? 'auto' : 'smooth' }); return; }
    const b = e.target.closest('[data-hero]'); if (b) { showHero(+b.dataset.hero); }
  });
  // the little arrows beside the posters: shown only when there are more to see that way
  function stripArrows() {
    const s = $('#bxStrip'); if (!s) return;
    const [back, more] = $('#bxHero').querySelectorAll('[data-harr]'), over = s.scrollWidth > s.clientWidth + 2;
    back.hidden = !over || s.scrollLeft < 4; more.hidden = !over || s.scrollLeft + s.clientWidth > s.scrollWidth - 4;
    s.classList.toggle('at-start', s.scrollLeft < 4); s.classList.toggle('at-end', s.scrollLeft + s.clientWidth > s.scrollWidth - 4);
  }
  addEventListener('resize', () => requestAnimationFrame(stripArrows));
  const still = () => reduce || document.documentElement.classList.contains('still');
  // swipe the featured title on phones
  let sx = null;
  $('#bxHero').addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') sx = [e.clientX, e.clientY]; }, { passive: true });
  $('#bxHero').addEventListener('pointerup', (e) => {
    if (!sx || heroList.length < 2) return; const dx = e.clientX - sx[0], dy = e.clientY - sx[1]; sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) showHero((state.hero + (dx < 0 ? 1 : heroList.length - 1)) % heroList.length);
  });
  window.tn.arrows($('#bxHero'), () => [...$('#bxHero').querySelectorAll('[data-hero]')], (b) => showHero(+b.dataset.hero));
  // it moves on by itself only with Settings → Animations on, and waits while you're reading or looking at a title
  const held = () => PHONE.matches || document.hidden || window.tnSheet?.isOpen() || $('#bxHero').matches(':hover, :focus-within') || document.documentElement.classList.contains('still') || reduce;
  function startHero() {
    clearTimeout(heroTimer); if (heroList.length < 2) return;
    heroTimer = setTimeout(function tick() { if (held()) { heroTimer = setTimeout(tick, 2000); return; } showHero((state.hero + 1) % heroList.length); }, 9000);
  }

  // ---------- the rows ----------
  const row = (id, title, sub, items, cls, more) => !items.length ? '' : `<section class="bx-sec" aria-labelledby="${id}">
      <header class="bx-sec-hd"><div><h2 id="${id}">${title}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
        <span class="bx-sec-acts">${more ? `<a class="bx-more" href="${more}">See all</a>` : ''}<button type="button" class="bx-r bx-r-s" data-scroll="-1" aria-label="Back">${I.left}</button><button type="button" class="bx-r bx-r-s" data-scroll="1" aria-label="More">${I.right}</button></span></header>
      <ul class="bx-row ${cls}">${items.join('')}</ul></section>`;
  // a poster card: the artwork, its score in a chip, the title and a second line, and a Watchlist button
  const card = (it, info, sub, n) => `<li class="bx-pc${n ? ' bx-pc-ranked' : ''}"><a href="${esc(it.url || '#')}" target="_blank" rel="noopener" ${reg(info)}><span class="bx-pc-art">${poster(it)}</span>${n ? `<span class="bx-pc-n" aria-label="No. ${n}">${n}</span>` : ''}${rating(it.rating).replace('bx-star', 'bx-star bx-chip')}
        <span class="bx-pc-copy"><b>${esc(it.title)}</b><small>${esc(sub)}</small></span></a>${saveBtn(info, ' bx-pc-add')}</li>`;
  // phones: the UK's Top 10 (numbered 1 to 10), For you, then the top rated, each a row of ten cards to swipe through
  // (one of each chart for shows and films)
  function phoneRows() {
    const word = (k) => (k === 'movie' ? 'films' : 'shows');
    const top = kinds().map((k) => row(`bxP10-${k}`, `Top 10 ${word(k)} in the UK`, 'Updated every hour', (state.data?.overall?.[k] || []).slice(0, 10).map((it0, i) => {
      const it = { ...it0, type: it0.type || k };
      return card(it, infoFor(it, `No. ${i + 1} ${word(k).slice(0, -1)} in the UK`), it.year, i + 1);
    }), 'bx-row-p'));
    const g = state.genre != null ? state.cat?.genres?.[state.genre] : null;
    const best = kinds().map((k) => row(`bxPTr-${k}`, `Top rated ${word(k)}${g ? ` in ${esc(g)}` : ''}`, 'The highest scores from viewers', topRated(k).map((it, i) => card(it, infoFor(it, `No. ${i + 1} top rated`), it.year)),
      'bx-row-p', `browse.html#${esc(String(new URLSearchParams({ c: 'top', ...(k === 'movie' ? { k: 'movie' } : {}) })))}`));
    return top.join('') + forYouRow() + best.join('');
  }
  function drawRows() {
    if (PHONE.matches) {
      $('#bxRows').innerHTML = phoneRows() || '<p class="bx-empty">Nothing matches. Try another genre.</p>';
      for (const r of main.querySelectorAll('.bx-row')) edges(r);
      return;
    }
    const cat = catalogue(), g = state.genre != null ? state.cat?.genres?.[state.genre] : null;
    const words = { both: 'shows and films', tv: 'shows', movie: 'films' }[state.kind];
    // most popular: posters with their score in a chip (the first and third references)
    const top = cat.slice().sort((a, b) => b.p - a.p).slice(0, 14).map(fromCat).map((it) => card(it, infoFor(it, 'Popular'), it.year));
    // newest: posters with the title and score beneath (the second reference)
    const today = new Date().toISOString().slice(0, 10);
    const fresh = cat.filter((x) => x.d && x.d <= today).sort((a, b) => (b.d > a.d) - (b.d < a.d) || b.p - a.p).slice(0, 14).map(fromCat).map((it) => {
      const info = infoFor(it, 'New');
      return `<li class="bx-lp"><a href="${esc(it.url)}" target="_blank" rel="noopener" ${reg(info)}><span class="bx-lp-art">${poster(it)}</span>
        <span class="bx-lp-copy"><b>${esc(it.title)}</b>${rating(it.rating)}</span><small>${esc(new Date(it.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: it.year === today.slice(0, 4) ? undefined : 'numeric' }))}</small></a></li>`;
    });
    $('#bxRows').innerHTML = forYouRow() + row('bxTop', `Most popular${g ? ` in ${esc(g)}` : ''}`, `The ${words} everyone’s looking at${all() ? '' : ` ${where()}`}`, top, 'bx-row-p', 'browse.html')
      + row('bxNew', `Latest releases${g ? ` in ${esc(g)}` : ''}`, 'The newest arrivals, most recent first', fresh, 'bx-row-p', 'charts.html#new')
      + kinds().map(topList).join('')
      || '<p class="bx-empty">Nothing matches. Try another service or genre.</p>';
    for (const r of main.querySelectorAll('.bx-row')) edges(r);
  }
  // ---------- For you (signed in): picks from what you swiped right on in Discover (and loved and saved) ----------
  // shell.js's forYou weighs the genres; TMDB's More Like This for your latest right swipes (shell.js's moreLike) lifts
  // the closest matches. While those load, the row holds its place with skeletons.
  const fy = { like: {}, ready: false, want: '' };
  const signedIn = () => !!window.tn.account.token();
  const loadLike = () => window.tn.moreLike(signedIn()).then((l) => { fy.like = l; });
  function forYouRow() {
    fy.sig = ''; if (!signedIn() || !state.cat?.items) return '';
    const head = (sub, acts = '') => `<header class="bx-sec-hd"><div><h2 id="bxFy">For you</h2><p>${sub}</p></div>${acts}</header>`;
    if (!window.tn.swipes.liked().length && !window.tn.stars.all().length) return `<section class="bx-sec bx-fy-none" aria-labelledby="bxFy">
      ${head('Swipe right on a few titles in Discover and Tenner will find more you’ll like.', `<a class="btn btn-tinted bx-fy-go" href="discover.html">${I.mark}Open Discover</a>`)}</section>`;
    if (!fy.ready) return `<section class="bx-sec" aria-labelledby="bxFy" aria-busy="true">${head('Finding picks from what you’ve liked in Discover')}
      <ul class="bx-row bx-row-p bx-fy-sk" aria-hidden="true">${'<li><span class="bx-pc-art"></span></li>'.repeat(8)}</ul></section>`;
    const ks = kinds(), r = window.tn.forYou(state.cat.items, (x) => ks.includes(x.t) && pickedAny(x.s) && (state.genre == null || (x.g || []).includes(+state.genre)), fy.like);
    if (!r) return '';
    const b = r.because, sub = !b ? 'From what you’ve liked in Discover' : r.how === 'liked' ? `Because you liked ${b.n} in Discover` : `Because you ${r.how} ${b.n}`;
    fy.sig = sub + r.picks.map((x) => x.i).join();
    const items = r.picks.map(fromCat).map((it) => {
      const info = infoFor(it, 'For you');
      return card(it, info, [it.type === 'movie' ? 'Film' : 'Series', it.year].filter(Boolean).join(' · '));
    });
    return row('bxFy', 'For you', sub, items, 'bx-row-p');
  }
  // redraw just the row (once you've stopped swiping, and never under your pointer or an open sheet)
  let fyT = 0;
  function drawFy() {
    const box = $('#bxRows'), el = box?.querySelector('[aria-labelledby="bxFy"]');
    if (!state.data || !box) return;
    if (el?.matches(':hover, :focus-within') || window.tnSheet?.isOpen()) { clearTimeout(fyT); fyT = setTimeout(drawFy, 1500); return; }
    const was = fy.sig, html = forYouRow();
    if (el && was && was === fy.sig) return;   // nothing new: leave it (and where you've scrolled it to) alone
    if (el) { if (html) el.outerHTML = html; else el.remove(); } else if (html) {   // phones: after the Top 10s, before Top rated; bigger screens: first
      const at = PHONE.matches && box.querySelector('[aria-labelledby^="bxPTr"]');
      if (at) at.insertAdjacentHTML('beforebegin', html); else box.insertAdjacentHTML(PHONE.matches ? 'beforeend' : 'afterbegin', html);
    }
    const r = box.querySelector('[aria-labelledby="bxFy"] .bx-row'); if (r) edges(r);
    markSaved();
  }
  function refreshFy(wait = 0) {
    const want = window.tn.swipes.liked().slice(0, 4).join() + signedIn();
    clearTimeout(fyT);
    fyT = setTimeout(() => { if (want !== fy.want) { fy.want = want; loadLike().then(() => { fy.ready = true; drawFy(); }); } else drawFy(); }, wait);
  }
  ['tn:swiped', 'tn:account', 'tn:synced'].forEach((e) => addEventListener(e, () => refreshFy(1200)));

  // top rated at a glance: the home page's chart list (.cl in styles.css), ten each of the best-reviewed shows and films
  // with enough votes to trust (the same test as Browse's Top rated), kept to the service and genre you've picked
  function topRated(k) {
    const pool = catalogue().filter((x) => x.t === k && x.r), pass = (min) => pool.filter((x) => x.v >= min);
    let l = pass(300); if (l.length < 10) l = pass(100);
    return l.sort((a, b) => b.r - a.r || b.v - a.v).slice(0, 10).map(fromCat);
  }
  function topList(k) {
    const g = state.genre != null ? state.cat?.genres?.[state.genre] : null;
    const l = topRated(k);
    if (!l.length) return '';
    const q = new URLSearchParams({ c: 'top', ...(k === 'movie' ? { k: 'movie' } : {}), ...(all() ? {} : { s: state.picks.join(',') }) });
    const label = (it) => (it.on || []).filter(picked).map((x) => svcOf(x)?.label).filter(Boolean).slice(0, 2).join(', ');
    return `<section class="clist bx-clist" aria-labelledby="bxCl-${k}">
      <div class="row-hd"><h2 class="row-h" id="bxCl-${k}">Top rated ${k === 'movie' ? 'films' : 'shows'}${g ? ` in ${esc(g)}` : ''} at a glance</h2>
        <a class="see-all" href="browse.html#${esc(String(q))}">See more in Browse<span class="chev" aria-hidden="true"></span></a></div>
      <ol class="cl">${l.map((it, i) => `<li><a href="${esc(it.url)}" target="_blank" rel="noopener" ${reg(infoFor(it, `No. ${i + 1} top rated${all() ? '' : ` ${where()}`}`))}>
        <span class="cl-n">${i + 1}</span>
        ${it.poster ? `<img src="${esc(it.poster.replace('/t/p/w342/', '/t/p/w154/'))}" alt="" loading="lazy" decoding="async">` : `<span class="cl-ph" style="background:hsl(${hue(it.title)} 45% 35%)"></span>`}
        <span class="cl-t"><b>${esc(it.title)}</b><small>${esc([state.picks.length === 1 ? '' : label(it), it.year].filter(Boolean).join(' · '))}</small></span>
        ${it.rating ? `<span class="cl-r">★ ${it.rating.toFixed(1)}</span>` : ''}
      </a></li>`).join('')}</ol></section>`;
  }
  // each row's arrows, and its edges frosting away when there's more to scroll
  function edges(r) {
    const set = () => { r.classList.toggle('at-start', r.scrollLeft < 8); r.classList.toggle('at-end', r.scrollLeft + r.clientWidth > r.scrollWidth - 8); };
    r.addEventListener('scroll', set, { passive: true }); set();
  }
  main.addEventListener('click', (e) => {
    const b = e.target.closest('[data-scroll]'); if (!b) return;
    const r = b.closest('.bx-sec').querySelector('.bx-row');
    r.scrollBy({ left: +b.dataset.scroll * r.clientWidth * 0.85, behavior: reduce || document.documentElement.classList.contains('still') ? 'auto' : 'smooth' });
  });

  // ---------- the side column: yours ----------
  function drawSide() {
    if (!state.data) return;
    $('#bxSide').innerHTML = discover() + topTen() + (window.tnTonight?.box() || '') + climbers() + tvGuide();
    markSaved();
  }
  // Tenner TV: its own box here instead of a place in the menu, while it's in beta
  function tvGuide() {
    return `<section class="bx-panel panel bx-tv" aria-labelledby="bxTv">
      <div class="bx-tv-hd"><span class="bx-tv-ic" aria-hidden="true">${I.tv}</span><div><h2 id="bxTv">TV Guide</h2><span class="bx-tag">Beta</span></div></div>
      <p class="bx-panel-say">What’s on Freeview tonight and all week, with reminders for the shows you love. It’s new, so give it a try and tell us what you think.</p>
      <a class="btn btn-tinted bx-wide" href="https://tv.tenner.stream/">${I.tv}Try the TV Guide</a></section>`;
  }
  // Discover, in a box: Tenner's swipe deck from Discover, one card at a time. Swipe right (or the bookmark) to add it to
  // your Watchlist, left (or the cross) to skip it, tap for its details. Skips are shared with the Discover page.
  const SKIP = 'tenner-skipped';
  const skips = { all() { try { return JSON.parse(localStorage.getItem(SKIP) || '{}') || {}; } catch { return {}; } },
    add(k) { const o = skips.all(); o[k] = Date.now(); try { localStorage.setItem(SKIP, JSON.stringify(o)); } catch {} } };
  let dk = { sig: '', list: [], at: 0 };
  function deck() {
    const sig = [state.kind, state.picks.join(), state.genre, state.cat?.generatedAt].join('|');
    if (sig !== dk.sig) {
      const skip = skips.all(), have = new Set(window.tn.saved.all().map((x) => x.k));
      const pool = catalogue().filter((x) => x.img && !skip[`${x.t[0]}${x.i}`] && !have.has(`${x.t[0]}${x.i}`)).sort((a, b) => b.p - a.p).slice(0, 120);
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.max(0, i - 1 - Math.floor(Math.random() * 6)); [pool[i], pool[j]] = [pool[j], pool[i]]; }   // popular first, shuffled a little
      dk = { sig, list: pool, at: 0 };
    }
    return dk.list[dk.at] ? fromCat(dk.list[dk.at]) : null;
  }
  function discover() {
    const it = deck();
    const head = `<header class="bx-panel-hd"><h2 id="bxDc">Discover</h2><a class="bx-more" href="discover.html">Open</a></header>`;
    if (!it) return `<section class="bx-panel panel" aria-labelledby="bxDc">${head}<p class="bx-panel-say">You’ve seen everything here for now. Try another service or genre, or come back after the next update.</p></section>`;
    const info = infoFor(it, 'Discover'), labels = (it.on || []).map((k) => svcOf(k)?.label).filter(Boolean).slice(0, 2).join(', ');
    return `<section class="bx-panel panel bx-dc" aria-labelledby="bxDc">${head}
      <p class="bx-panel-say bx-dc-say">Right to save, left to skip</p>
      <a class="bx-dc-card" id="bxDcCard" href="${esc(it.url)}" target="_blank" rel="noopener" ${reg(info)} draggable="false">
        <span class="bx-dc-art">${it.poster ? `<img src="${esc(it.poster.replace('/t/p/w342/', '/t/p/w500/'))}" alt="" draggable="false">` : ph(it.title)}</span>
        <span class="bx-dc-stamp yes" aria-hidden="true">Save</span><span class="bx-dc-stamp no" aria-hidden="true">Skip</span>
        <span class="bx-dc-copy"><b>${esc(it.title)}</b><small>${[it.type === 'movie' ? 'Film' : 'Series', it.year, labels].filter(Boolean).map(esc).join(' · ')}${rating(it.rating)}</small></span></a>
      <div class="bx-dc-acts">
        <button type="button" class="bx-r bx-r-l bx-dc-no" data-dc="no" aria-label="Skip ${esc(it.title)}">${I.cross}</button>
        <button type="button" class="bx-r bx-dc-info" data-dc="info" aria-label="Details">${I.info}</button>
        <button type="button" class="bx-r bx-r-l bx-dc-yes" data-dc="yes" aria-label="Add ${esc(it.title)} to your Watchlist">${I.mark}</button>
      </div></section>`;
  }
  // a choice: the card flies off that way, then the next one comes up
  function decide(yes) {
    const it = dk.list[dk.at] ? fromCat(dk.list[dk.at]) : null; if (!it) return;
    const card = $('#bxDcCard'), k = keyOf(it);
    dk.at++;
    // the choice lands once the card has gone (a save redraws the side column itself)
    const next = () => {
      if (yes) { if (!window.tn.saved.has(k)) window.tn.saved.toggle(infoFor(it)); toast(`${it.title} is on your Watchlist`); } else skips.add(k);
      window.tn.swipes.set(k, yes);   // For You learns from it
      const box = $('#bxSide [aria-labelledby="bxDc"]'); if (box && !yes) box.outerHTML = discover();
    };
    if (card && !still()) { card.style.transition = 'transform .35s cubic-bezier(.3,.7,.4,1), opacity .35s ease'; card.style.transform = `translateX(${yes ? 130 : -130}%) rotate(${yes ? 14 : -14}deg)`; card.style.opacity = '0'; setTimeout(next, 300); } else next();
  }
  $('#bxSide').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dc]'); if (!b) return;
    if (b.dataset.dc === 'info') { const a = $('#bxDcCard'); if (a) window.tnSheet?.open(shown.get(a.dataset.sheet)); return; }
    decide(b.dataset.dc === 'yes');
  });
  // swiping the card: it follows your finger (or mouse), tilting a little; let go far enough and it's decided
  let drag = null;
  $('#bxSide').addEventListener('pointerdown', (e) => {
    const card = e.target.closest('#bxDcCard'); if (!card || e.button) return;
    drag = { card, x: e.clientX, y: e.clientY, dx: 0, moved: false, id: e.pointerId };
  });
  addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(drag.dx) > 8 && Math.abs(drag.dx) > Math.abs(dy)) { drag.moved = true; drag.card.setPointerCapture?.(e.pointerId); drag.card.classList.add('held'); }
    if (!drag.moved) return;
    drag.card.style.transform = `translateX(${drag.dx}px) rotate(${drag.dx / 18}deg)`;
    drag.card.style.setProperty('--yes', Math.max(0, Math.min(1, drag.dx / 90))); drag.card.style.setProperty('--no', Math.max(0, Math.min(1, -drag.dx / 90)));
  });
  addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { card, dx, moved } = drag; drag = null; card.classList.remove('held');
    if (!moved) return;
    card.addEventListener('click', (c) => { c.preventDefault(); c.stopPropagation(); }, { once: true, capture: true });   // a swipe isn't a tap
    if (Math.abs(dx) > 90) decide(dx > 0);
    else { card.style.transform = ''; card.style.setProperty('--yes', 0); card.style.setProperty('--no', 0); }
  });
  $('#bxSide').addEventListener('keydown', (e) => {
    if (!e.target.closest?.('.bx-dc')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); decide(true); $('#bxSide [data-dc="yes"]')?.focus(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); decide(false); $('#bxSide [data-dc="no"]')?.focus(); }
  });
  // the Top 10 itself, numbered and compact, for the kind and service you've picked (with both, the shows then the films):
  // all ten for shows or films; with both, the first five of each, and See more opens the box out to show six to ten
  let ttOpen = false;
  function topTen() {
    // all six: the UK chart; one service: its chart; several: their charts together, most popular first
    const merge = (k) => { const seen = new Set(); return state.picks.flatMap((p) => (svcOf(p)?.[k] || []).map((it) => ({ ...it, on: it.on || [p] })))
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).filter((it) => { const id = keyOf(it, it.type || k) || it.title; return !seen.has(id) && seen.add(id); }); };
    const s = all() ? state.data.overall : state.picks.length === 1 ? svcOf(state.picks[0]) : { tv: merge('tv'), movie: merge('movie') }; if (!s) return '';
    const ks = kinds();
    const part = (k) => {
      const l = (s[k] || []).slice(0, 10); if (!l.length) return '';
      const word = k === 'movie' ? 'film' : 'show';
      return `${ks.length > 1 ? `<h3 class="bx-tt-sub">${k === 'movie' ? 'Films' : 'Shows'}</h3>` : ''}<ol class="bx-ups bx-tt">${l.map((it0, i) => {
        const it = { ...it0, type: it0.type || k, on: it0.on || (s.key ? [s.key] : undefined) }, info = infoFor(it, `No. ${i + 1} ${word} ${where()}`);
        const sub = [it.type === 'movie' ? 'Film' : 'Series', it.year].filter(Boolean).join(' · ');
        return `<li${i >= 5 && ks.length > 1 ? ' class="bx-tt-x"' : ''}><a href="${esc(it.url || '#')}" target="_blank" rel="noopener" ${reg(info)}><span class="bx-tt-n">${i + 1}</span><span class="bx-up-art">${poster(it)}</span>
          <span class="bx-up-copy"><b>${esc(it.title)}</b><small>${esc(sub)}</small></span></a></li>`;
      }).join('')}</ol>`;
    };
    const body = ks.map(part).join(''); if (!body) return '';
    const more = ks.length > 1 && ks.some((k) => (s[k] || []).length > 5);
    const words = { both: 'Top 10', tv: 'Top 10 shows', movie: 'Top 10 films' }[state.kind];
    // behind the heading: a scene from the chart's leading films (shows when it's shows only), in grey, melting into the box;
    // a different one each hour, and with Animations on they take turns
    const scenes = [...ks].sort((a, b) => (b === 'movie') - (a === 'movie')).flatMap((k) => (s[k] || []).slice(0, 10)).filter((it) => it.backdrop).slice(0, 4);
    const bg = scenes.length ? `<div class="bx-tt-bg" aria-hidden="true">${scenes.map((it, i) => { const on = i === Math.floor(Date.now() / 36e5) % scenes.length; return `<img${on ? ' class="on"' : ''} src="${esc(it.backdrop.replace('/w1280/', '/w780/'))}" alt="" loading="${on ? 'eager' : 'lazy'}" decoding="async">`; }).join('')}</div>` : '';
    return `<section class="bx-panel panel bx-tt-box${ttOpen ? ' open' : ''}${bg ? ' has-bg' : ''}" aria-labelledby="bxTt">${bg}<header class="bx-panel-hd"><h2 id="bxTt">${words} ${esc(where())}</h2></header>${body}
      ${more ? `<button type="button" class="bx-more bx-tt-more" data-tt aria-expanded="${ttOpen}">${ttOpen ? 'Show less' : 'See more'}</button>` : ''}</section>`;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tt]'); if (!b) return;
    ttOpen = !ttOpen; const box = b.closest('.bx-tt-box');
    box.classList.toggle('open', ttOpen); b.setAttribute('aria-expanded', ttOpen); b.textContent = ttOpen ? 'Show less' : 'See more';
    if (!ttOpen && box.getBoundingClientRect().top < 0) box.scrollIntoView({ block: 'start', behavior: still() ? 'auto' : 'smooth' });
  });
  // the scenes behind the Top 10 and Top rated move on to the next film every so often (with Animations on and the page in view)
  setInterval(() => {
    if (still() || document.hidden) return;
    for (const bg of document.querySelectorAll('.bx-tt-bg')) {
      const imgs = [...bg.children]; if (imgs.length < 2) continue;
      const at = imgs.findIndex((im) => im.classList.contains('on')), next = imgs[(at + 1) % imgs.length];
      if (!next.complete || !next.naturalWidth) { next.loading = 'eager'; continue; }
      imgs[at]?.classList.remove('on'); next.classList.add('on');
    }
  }, 9000);
  // this week's biggest climbers, as a list (the third reference's activity panel)
  function climbers() {
    const w = state.week; if (!w?.climbers?.length) return '';
    const lists = [...['tv', 'movie'].flatMap((t) => (state.data.overall[t] || []).map((it) => ({ ...it, type: it.type || t }))),
      ...(state.data.services || []).flatMap((s) => ['tv', 'movie'].flatMap((t) => (s[t] || []).map((it) => ({ ...it, type: it.type || t, on: it.on || [s.key] }))))];
    const find = (k) => lists.find((it) => keyOf(it) === k);
    const ks = kinds(), seen = new Set();
    const items = w.climbers.filter((c) => (all() || state.picks.some((p) => c.c.startsWith(`${p}:`)) || c.c.startsWith('all:')) && ks.includes(c.c.split(':')[1]))
      .map((c) => ({ c, it: find(c.k) })).filter(({ it }) => it && !seen.has(it.title) && seen.add(it.title)).slice(0, 5);
    if (!items.length) return '';
    return `<section class="bx-panel panel" aria-labelledby="bxUp"><header class="bx-panel-hd"><h2 id="bxUp">Climbing this week</h2></header><ul class="bx-ups">${items.map(({ c, it }) => {
      const label = w.labels?.[c.c.split(':')[0]] || '', info = infoFor(it, 'Climbing this week');
      return `<li><a href="${esc(it.url || '#')}" target="_blank" rel="noopener" ${reg(info)}><span class="bx-up-art">${poster(it)}</span>
        <span class="bx-up-copy"><b>${esc(it.title)}</b><small>Up ${c.by} to No. ${c.to} ${label === 'the UK' ? 'in the UK' : `on ${esc(label)}`}</small></span><span class="bx-up-by" aria-hidden="true">${I.up}${c.by}</span></a></li>`;
    }).join('')}</ul></section>`;
  }

  // a link shared to Tenner from another app (the manifest's share_target): Tenner finds the title and opens its sheet
  {
    const p = new URL(location.href).searchParams;
    if (!p.get('t') && (p.get('url') || p.get('text') || p.get('title'))) {
      const u = new URL(location.href); for (const k of ['url', 'text', 'title']) u.searchParams.delete(k); history.replaceState(null, '', u);
      window.tn.sharedTitle(p).then((x) => {
        if (!x?.k) { toast('Tenner couldn’t find that title'); return; }
        const v = new URL(location.href); v.searchParams.set('t', x.k); history.replaceState(null, '', v);
        if (state.data) openFromUrl();
      });
    }
  }
  PHONE.addEventListener('change', () => state.data && draw());   // turning a tablet round, or a narrowed window
  addEventListener('popstate', () => state.data && openFromUrl());   // Forward to a title you'd closed opens it again
  load();
})();

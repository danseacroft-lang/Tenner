// Tenner's beta home page: a preview of a redesigned home, a streaming dashboard built from Tenner's own data.
// A big featured title (its scores in a frosted box, its genres as pills, where to watch and a Watchlist button), the six
// services as a rail of app icons that filter everything below, rows of what's trending, top rated and newest, and a
// side column of your own things: shows you're watching, genres to narrow the rows, and this week's biggest climbers.
// Reads data/trending.json, browse.json and week.json (rebuilt hourly), and titles.json through the title sheet.
// Hidden: not in the menu or the sitemap, and marked noindex. The About page links to it at the very bottom.

(() => {
  const { esc, hue, reduce } = window.tn;
  const $ = (s, el = document) => el.querySelector(s);
  const LOGO = 'https://image.tmdb.org/t/p/w500';
  const KINDS = { both: 'Shows and films', tv: 'Shows', movie: 'Films' };
  const state = { kind: 'both', svc: 'all', genre: null, hero: 0, data: null, cat: null, week: null, titles: null };
  try { const k = sessionStorage.getItem('tenner-beta-kind'); if (KINDS[k]) state.kind = k; } catch {}

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
    if (state.svc !== 'all' && !services().some((s) => s.key === state.svc)) state.svc = 'all';
    draw();
    window.tnSheet?.details().then((d) => { if (d) { state.titles = d; drawHeroCopy(); drawSide(); } });   // genres, age ratings, logos, episodes
    openFromUrl();
  }
  addEventListener('tn:check', () => load(true));

  const services = () => (state.data?.services || []).filter((s) => !s.shop && !s.store);
  const svcOf = (k) => (state.data?.services || []).find((s) => s.key === k);
  const kinds = () => (state.kind === 'both' ? ['tv', 'movie'] : [state.kind]);
  const det = (k) => state.titles?.items?.[k] || null;
  const keyOf = (it, type) => (/^\d+$/.test(String(it.id ?? '')) ? `${(it.type || type) === 'movie' ? 'm' : 't'}${it.id}` : null);
  const tmdbUrl = (type, id) => `https://www.themoviedb.org/${type}/${id}`;
  const where = () => (state.svc === 'all' ? 'in the UK' : `on ${svcOf(state.svc)?.label || ''}`);
  // the chart you're looking at: the UK's, or one service's; with both kinds, shows and films take turns
  function chart() {
    const s = state.svc === 'all' ? state.data.overall : svcOf(state.svc) || state.data.overall;
    const lists = kinds().map((k) => (s[k] || []).map((it, i) => ({ it: { ...it, type: it.type || k }, n: i + 1 })));
    const out = []; for (let i = 0; i < 10; i++) for (const l of lists) if (l[i]) out.push(l[i]);
    return out;
  }
  // the catalogue (Browse's), kept to the kind, service and genre you've picked
  function catalogue() {
    const c = state.cat; if (!c?.items) return [];
    const ks = kinds();
    return c.items.filter((x) => ks.includes(x.t) && x.s?.length && (state.svc === 'all' || x.s.includes(state.svc)) && (state.genre == null || (x.g || []).includes(+state.genre)));
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
  window.tnSheet?.hover?.('a[data-sheet]:not(.bx-cta)', (a) => shown.get(a.dataset.sheet));
  function openFromUrl() {
    const k = new URL(location.href).searchParams.get('t'); if (!k || window.tnSheet?.isOpen()) return;
    for (const info of shown.values()) if (info.k === k) { window.tnSheet.open(info, true); return; }
    window.tnSheet?.openKey?.(k);
  }
  addEventListener('tn:saved', () => { markSaved(); drawSide(); });
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
    drawRail(); drawHero(); drawRows(); drawSide(); markSaved();
  }

  // the services as a rail of app icons (the first reference's left-hand rail, laid across the top of the rows)
  function drawRail() {
    const all = `<button type="button" class="bx-svc-b" data-svc="all" aria-pressed="${state.svc === 'all'}"><span class="bx-app bx-app-all"><img src="logo.svg" alt=""></span><small>All six</small></button>`;
    $('#bxRail').innerHTML = all + services().map((s) => `<button type="button" class="bx-svc-b" data-svc="${esc(s.key)}" aria-pressed="${state.svc === s.key}">
      <span class="bx-app"${s.logo ? '' : ` style="--h:${hue(s.label)}"`}>${s.logo ? `<img src="${esc(s.logo)}" alt="">` : `<b>${esc(s.label.slice(0, 1))}</b>`}</span><small>${esc(s.label)}</small></button>`).join('');
  }
  $('#bxRail').addEventListener('click', (e) => {
    const b = e.target.closest('[data-svc]'); if (!b || b.dataset.svc === state.svc) return;
    state.svc = b.dataset.svc; state.hero = 0; morph(draw);
  });
  window.tn.arrows($('#bxRail'), () => [...$('#bxRail').querySelectorAll('button')]);

  $('#bxKind').addEventListener('change', (e) => {
    state.kind = e.target.value; state.hero = 0; state.genre = null;
    try { sessionStorage.setItem('tenner-beta-kind', state.kind); } catch {}
    morph(draw);
  });
  const morph = (fn) => (document.startViewTransition && !document.documentElement.classList.contains('still') ? document.startViewTransition(fn) : fn());

  // ---------- the featured title ----------
  let heroList = [], heroTimer = 0;
  function drawHero() {
    const picks = chart(), withArt = picks.filter((p) => p.it.backdrop);
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
    const { it, n } = p, x = det(keyOf(it)) || {}, info = infoFor(it, `No. ${n} ${it.type === 'movie' ? 'film' : 'show'} ${where()}`);
    const on = (it.on || [state.svc]).map(svcOf).filter(Boolean)[0];
    // the scores, in a frosted box (the second reference): TMDB's rating, the rank, and weeks on the chart or the running time
    const cells = [
      it.rating ? [`${I.star}${it.rating.toFixed(1)}`, 'TMDB score'] : null,
      [`No. ${n}`, where()],
      it.weeks > 1 ? [`${it.weeks} wks`, 'in the Top 10'] : x.rt ? [runtime(x.rt), it.type === 'tv' ? 'an episode' : 'running time'] : x.se ? [`${x.se}`, x.se === 1 ? 'season' : 'seasons'] : null,
    ].filter(Boolean);
    const meta = [it.type === 'tv' ? (x.se ? `${x.se} season${x.se === 1 ? '' : 's'}` : 'Series') : 'Film', it.year, x.rt && it.type === 'movie' ? runtime(x.rt) : ''].filter(Boolean);
    const genres = (x.g || []).slice(0, 3);
    c.innerHTML = `<dl class="bx-score">${cells.map(([v, l]) => `<div><dt>${v}</dt><dd>${esc(l)}</dd></div>`).join('')}</dl>
      <p class="bx-eye">${I.flame}<span>${n === 1 ? 'Number one' : `No. ${n}`} ${esc(where())} right now</span></p>
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
  const held = () => document.hidden || window.tnSheet?.isOpen() || $('#bxHero').matches(':hover, :focus-within') || document.documentElement.classList.contains('still') || reduce;
  function startHero() {
    clearTimeout(heroTimer); if (heroList.length < 2) return;
    heroTimer = setTimeout(function tick() { if (held()) { heroTimer = setTimeout(tick, 2000); return; } showHero((state.hero + 1) % heroList.length); }, 9000);
  }

  // ---------- the rows ----------
  const row = (id, title, sub, items, cls, more) => !items.length ? '' : `<section class="bx-sec" aria-labelledby="${id}">
      <header class="bx-sec-hd"><div><h2 id="${id}">${title}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
        <span class="bx-sec-acts">${more ? `<a class="bx-more" href="${more}">See all</a>` : ''}<button type="button" class="bx-r bx-r-s" data-scroll="-1" aria-label="Back">${I.left}</button><button type="button" class="bx-r bx-r-s" data-scroll="1" aria-label="More">${I.right}</button></span></header>
      <ul class="bx-row ${cls}">${items.join('')}</ul></section>`;
  function drawRows() {
    const picks = chart(), cat = catalogue(), g = state.genre != null ? state.cat?.genres?.[state.genre] : null;
    const words = { both: 'shows and films', tv: 'shows', movie: 'films' }[state.kind];
    // trending: wide cards, artwork first (the first reference's top row)
    const trend = picks.map(({ it, n }) => {
      const info = infoFor(it, `No. ${n} ${it.type === 'movie' ? 'film' : 'show'} ${where()}`), on = (it.on || [state.svc]).map(svcOf).filter(Boolean)[0];
      return `<li class="bx-wc"><a href="${esc(it.url || '#')}" target="_blank" rel="noopener" ${reg(info)}>
        <span class="bx-wc-art">${wide(it)}</span><span class="bx-rank">No. ${n}${state.kind === 'both' ? (it.type === 'movie' ? ' film' : ' show') : ''}</span>
        <span class="bx-wc-copy"><b>${esc(it.title)}</b><small>${[it.type === 'movie' ? 'Film' : 'Series', it.year].filter(Boolean).map(esc).join(' · ')}${rating(it.rating)}</small></span></a>
        <span class="bx-wc-acts">${svcIcon(on)}${saveBtn(info)}</span></li>`;
    });
    // most popular: posters with their score in a chip (the first and third references)
    const top = cat.slice().sort((a, b) => b.p - a.p).slice(0, 14).map(fromCat).map((it) => {
      const info = infoFor(it, 'Popular');
      return `<li class="bx-pc"><a href="${esc(it.url)}" target="_blank" rel="noopener" ${reg(info)}><span class="bx-pc-art">${poster(it)}</span>${rating(it.rating).replace('bx-star', 'bx-star bx-chip')}
        <span class="bx-pc-copy"><b>${esc(it.title)}</b><small>${esc(it.year)}</small></span></a>${saveBtn(info, ' bx-pc-add')}</li>`;
    });
    // newest: posters with the title and score beneath (the second reference)
    const today = new Date().toISOString().slice(0, 10);
    const fresh = cat.filter((x) => x.d && x.d <= today).sort((a, b) => (b.d > a.d) - (b.d < a.d) || b.p - a.p).slice(0, 14).map(fromCat).map((it) => {
      const info = infoFor(it, 'New');
      return `<li class="bx-lp"><a href="${esc(it.url)}" target="_blank" rel="noopener" ${reg(info)}><span class="bx-lp-art">${poster(it)}</span>
        <span class="bx-lp-copy"><b>${esc(it.title)}</b>${rating(it.rating)}</span><small>${esc(new Date(it.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: it.year === today.slice(0, 4) ? undefined : 'numeric' }))}</small></a></li>`;
    });
    $('#bxRows').innerHTML = row('bxTrend', `Trending ${esc(where())}`, `The top ${words} this hour`, trend, 'bx-row-w', './#top')
      + row('bxTop', `Most popular${g ? ` in ${esc(g)}` : ''}`, `The ${words} most people are looking at${state.svc === 'all' ? ' on all six' : ` ${where()}`}`, top, 'bx-row-p', 'browse.html')
      + row('bxNew', `Latest releases${g ? ` in ${esc(g)}` : ''}`, 'The newest arrivals, most recent first', fresh, 'bx-row-p', './#new')
      + kinds().map(topList).join('')
      || '<p class="bx-empty">Nothing matches. Try another service or genre.</p>';
    for (const r of main.querySelectorAll('.bx-row')) edges(r);
  }
  // top rated at a glance: the home page's chart list (.cl in styles.css), ten each of the best-reviewed shows and films
  // with enough votes to trust (the same test as Browse's Top rated), kept to the service and genre you've picked
  function topList(k) {
    const g = state.genre != null ? state.cat?.genres?.[state.genre] : null;
    const pool = catalogue().filter((x) => x.t === k && x.r), pass = (min) => pool.filter((x) => x.v >= min);
    let l = pass(300); if (l.length < 10) l = pass(100);
    l = l.sort((a, b) => b.r - a.r || b.v - a.v).slice(0, 10).map(fromCat);
    if (!l.length) return '';
    const q = new URLSearchParams({ c: 'top', ...(k === 'movie' ? { k: 'movie' } : {}), ...(state.svc !== 'all' ? { s: state.svc } : {}) });
    const label = (it) => (it.on || []).map((x) => svcOf(x)?.label).filter(Boolean).slice(0, 2).join(', ');
    return `<section class="clist bx-clist" aria-labelledby="bxCl-${k}">
      <div class="row-hd"><h2 class="row-h" id="bxCl-${k}">Top rated ${k === 'movie' ? 'films' : 'shows'}${g ? ` in ${esc(g)}` : ''} at a glance</h2>
        <a class="see-all" href="browse.html#${esc(String(q))}">See more in Browse<span class="chev" aria-hidden="true"></span></a></div>
      <ol class="cl">${l.map((it, i) => `<li><a href="${esc(it.url)}" target="_blank" rel="noopener" ${reg(infoFor(it, `No. ${i + 1} top rated${state.svc === 'all' ? '' : ` ${where()}`}`))}>
        <span class="cl-n">${i + 1}</span>
        ${it.poster ? `<img src="${esc(it.poster.replace('/t/p/w342/', '/t/p/w154/'))}" alt="" loading="lazy" decoding="async">` : `<span class="cl-ph" style="background:hsl(${hue(it.title)} 45% 35%)"></span>`}
        <span class="cl-t"><b>${esc(it.title)}</b><small>${esc([state.svc === 'all' ? label(it) : '', it.year].filter(Boolean).join(' · '))}</small></span>
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
    $('#bxSide').innerHTML = discover() + genres() + climbers() + tvGuide();
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
    const sig = [state.kind, state.svc, state.genre, state.cat?.generatedAt].join('|');
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
  // genres: pills that narrow the rows (the first reference's genre panel); the chosen one gets Tenner's rainbow underline
  function genres() {
    const c = state.cat; if (!c?.genres) return '';
    const ks = kinds(), count = new Map();
    for (const x of c.items) if (ks.includes(x.t) && (state.svc === 'all' || x.s?.includes(state.svc))) for (const g of new Set(x.g || [])) count.set(g, (count.get(g) || 0) + 1);
    const list = [...count].filter(([g]) => c.genres[g]).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([g]) => g);
    if (state.genre != null && !list.includes(+state.genre)) list.unshift(+state.genre);
    return `<section class="bx-panel panel" aria-labelledby="bxGen"><header class="bx-panel-hd"><h2 id="bxGen">Genres</h2>${state.genre != null ? '<button type="button" class="bx-more" data-genre="">Clear</button>' : ''}</header>
      <div class="bx-gens">${list.map((g) => { const on = String(g) === String(state.genre); return `<button type="button" class="bx-gen" data-genre="${g}" aria-pressed="${on}"><span>${esc(c.genres[g])}</span>${on ? I.tick : I.plus}</button>`; }).join('')}</div></section>`;
  }
  $('#bxSide').addEventListener('click', (e) => {
    const b = e.target.closest('[data-genre]'); if (!b) return;
    state.genre = b.dataset.genre === '' || b.dataset.genre === String(state.genre) ? null : b.dataset.genre;
    morph(() => { drawRows(); drawSide(); markSaved(); });
    $(`#bxSide [data-genre="${state.genre ?? ''}"]`)?.focus({ preventScroll: true });
  });
  // this week's biggest climbers, as a list (the third reference's activity panel)
  function climbers() {
    const w = state.week; if (!w?.climbers?.length) return '';
    const lists = [...['tv', 'movie'].flatMap((t) => (state.data.overall[t] || []).map((it) => ({ ...it, type: it.type || t }))),
      ...(state.data.services || []).flatMap((s) => ['tv', 'movie'].flatMap((t) => (s[t] || []).map((it) => ({ ...it, type: it.type || t, on: it.on || [s.key] }))))];
    const find = (k) => lists.find((it) => keyOf(it) === k);
    const ks = kinds(), seen = new Set();
    const items = w.climbers.filter((c) => (state.svc === 'all' || c.c.startsWith(`${state.svc}:`) || c.c.startsWith('all:')) && ks.includes(c.c.split(':')[1]))
      .map((c) => ({ c, it: find(c.k) })).filter(({ it }) => it && !seen.has(it.title) && seen.add(it.title)).slice(0, 5);
    if (!items.length) return '';
    return `<section class="bx-panel panel" aria-labelledby="bxUp"><header class="bx-panel-hd"><h2 id="bxUp">Climbing this week</h2></header><ul class="bx-ups">${items.map(({ c, it }) => {
      const label = w.labels?.[c.c.split(':')[0]] || '', info = infoFor(it, 'Climbing this week');
      return `<li><a href="${esc(it.url || '#')}" target="_blank" rel="noopener" ${reg(info)}><span class="bx-up-art">${poster(it)}</span>
        <span class="bx-up-copy"><b>${esc(it.title)}</b><small>Up ${c.by} to No. ${c.to} ${label === 'the UK' ? 'in the UK' : `on ${esc(label)}`}</small></span><span class="bx-up-by" aria-hidden="true">${I.up}${c.by}</span></a></li>`;
    }).join('')}</ul></section>`;
  }

  load();
})();

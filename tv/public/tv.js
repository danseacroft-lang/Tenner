// Tenner TV: the week on the main Freeview channels, as a TV guide. A preview of whatever you point at; then every
// channel as its own strip of programmes, sized by length, that runs on through the week (each scrolls on its own, as
// Pluto TV's do); then the evening's picks. Any programme opens a sheet with what it's about. Listings: /api/day (the
// Freeview files built every three hours, TVmaze only for a day they don't cover).
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  // a light tap where the device can give one (Android; iPhones' Safari gives none to web pages)
  const buzz = (ms = 8) => { try { navigator.vibrate?.(ms); } catch {} };
  // a small confirmation, as a capsule of glass that rises from the bottom and goes by itself
  let toastT = 0;
  function toast(html) {
    const t = $('#toast'); t.innerHTML = html; t.classList.remove('in');
    try { t.hidePopover(); t.showPopover(); } catch {}   // in the top layer, so it shows above an open sheet too
    void t.offsetWidth; t.classList.add('in');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('in'), 4200);
  }
  // a glass selector's thumb glides to the chosen button (the days, the views)
  function thumb(box, sel) {
    const b = box.querySelector(sel), t = box.querySelector('.thumb'); if (!t) return;
    if (!b) { t.style.opacity = 0; return; }
    t.style.opacity = 1; t.style.width = `${b.offsetWidth}px`; t.style.transform = `translateX(${b.offsetLeft}px)`;
  }

  // ---------- time, in UK time. Formatters are made once: a week's guide formats tens of thousands of times ----------
  const TZ = 'Europe/London';
  const F = {
    day: new Intl.DateTimeFormat('en-CA', { timeZone: TZ }),
    hm: new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }),
  };
  const named = new Map();   // day names, per day and style
  const ukDay = (t = Date.now()) => F.day.format(t);
  const hm = (t) => F.hm.format(t);
  const hour = (t) => { const s = hm(t); return +s.slice(0, 2) + +s.slice(3, 5) / 60; };
  const dayName = (d, o) => { const k = d + JSON.stringify(o); if (!named.has(k)) named.set(k, new Date(d + 'T12:00:00').toLocaleDateString('en-GB', o)); return named.get(k); };
  const ends = (x, next) => x.at + (x.rt ? x.rt * 60e3 : next ? next.at - x.at : 30 * 60e3);
  const length = (ms) => { const m = Math.round(ms / 60e3); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`; };
  const minsLeft = (x, now) => Math.max(1, Math.round((x.end - now) / 60e3));

  const today = ukDay();
  let days = Array.from({ length: 8 }, (_, i) => ukDay(Date.now() + i * 864e5));   // until the listings say which days they cover
  const q = new URLSearchParams(location.search).get('d');
  // tenner.stream's "On TV" line opens Tenner TV with ?q=: the search, filled in, once the listings are here
  let askQ = (new URLSearchParams(location.search).get('q') || '').slice(0, 80);
  // a shared programme (?p=, with its day as ?d=): its sheet opens once the listings are here
  let askP = (new URLSearchParams(location.search).get('p') || '').slice(0, 24);
  if (askQ || askP) { const u = new URL(location.href); u.searchParams.delete('q'); u.searchParams.delete('p'); history.replaceState(null, '', u); }
  // base: the first day in the strips; loaded: every day fetched, in order; day: the one in view
  const state = { base: days.includes(q) ? q : today, day: null, data: null, loaded: new Map(), loading: null, failedAt: 0, time: 'now' };
  const label = (d) => (d === today ? 'Tonight' : d === days[1] ? 'Tomorrow' : dayName(d, { weekday: 'short', day: 'numeric' }));
  const word = (d) => (d === today ? 'tonight' : d === days[1] ? 'tomorrow' : dayName(d, { weekday: 'long' }));

  // ---------- the days ----------
  const drawDays = () => { $('#days').innerHTML = '<span class="thumb" aria-hidden="true"></span>' + days.map((d) => `<button type="button" data-d="${d}"${d === state.day ? ' aria-current="date"' : ''}>${esc(label(d))}</button>`).join(''); thumb($('#days'), '[aria-current]'); };
  drawDays();
  $('#days').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b) goDay(b.dataset.d); });

  // ---------- programmes ----------
  const shown = new Map();   // every drawn programme, by id: for the preview and the sheet
  const reg = (x, ch, next) => { shown.set(String(x.id), { ...x, ch, end: ends(x, next) }); return `data-p="${esc(x.id)}"`; };
  const epLine = (x) => [x.s && x.n ? `Series ${x.s}, episode ${x.n}` : x.n ? `Episode ${x.n}` : '', x.ep].filter(Boolean).join(' · ');
  const art = (x) => (x.wide ? `<img src="${esc(x.wide)}" alt="" loading="lazy" decoding="async">`
    : x.poster ? `<img class="bed" src="${esc(x.poster)}" alt="" loading="lazy" decoding="async"><img class="pst" src="${esc(x.poster)}" alt="" loading="lazy" decoding="async">`
    : `<span class="ph" style="background:linear-gradient(150deg,hsl(${hue(x.t)} 45% 40%),hsl(${(hue(x.t) + 50) % 360} 55% 18%))">${esc(x.t)}</span>`);

  // ---------- channels: logo tiles (our own, made for dark), or initials if a channel has none ----------
  const logo = (name) => state.data?.logos?.[name];
  const initials = (n) => {
    if (/^\S{1,4}$/.test(n)) return n.toUpperCase();          // ITV1, E4, W, Dave
    if (/^\d/.test(n)) return n.slice(0, 2).toUpperCase();    // 5Star → 5S
    const w = n.replace(/\b(One|Two|Three|Four)\b/, (x) => ({ One: '1', Two: '2', Three: '3', Four: '4' }[x])).split(/\s+/), d = w.join(' ').match(/\d+$/);
    return (d ? w[0][0] + d[0] : w.map((x) => x[0]).join('').slice(0, 3)).toUpperCase();   // BBC One → B1, Sky Atlantic → SA
  };
  const badge = (n) => (logo(n) ? `<span class="ch-badge"><img src="${esc(logo(n))}" alt="" decoding="async" width="40" height="40"></span>`
    : `<span class="ch-badge ch-mono" style="--h:${hue(n)}" aria-hidden="true">${esc(initials(n))}</span>`);
  // watching live: each channel's own official player (a TV licence is needed to watch live TV in the UK). The watchdog
  // checks these still open, every three hours.
  const LIVE = {
    'BBC One': ['BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/bbcone'], 'BBC Two': ['BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/bbctwo'],
    'BBC Three': ['BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/bbcthree'], 'BBC Four': ['BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/bbcfour'],
    'BBC News': ['BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/bbcnews'], CBBC: ['BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/cbbc'], CBeebies: ['BBC iPlayer', 'https://www.bbc.co.uk/iplayer/live/cbeebies'],
    ITV1: ['ITVX', 'https://www.itv.com/watch?channel=itv'], ITV2: ['ITVX', 'https://www.itv.com/watch?channel=itv2'], ITV3: ['ITVX', 'https://www.itv.com/watch?channel=itv3'],
    ITV4: ['ITVX', 'https://www.itv.com/watch?channel=itv4'], ITVBe: ['ITVX', 'https://www.itv.com/watch?channel=itvbe'],
    'Channel 4': ['Channel 4', 'https://www.channel4.com/now/C4'], E4: ['Channel 4', 'https://www.channel4.com/now/E4'], More4: ['Channel 4', 'https://www.channel4.com/now/M4'], Film4: ['Channel 4', 'https://www.channel4.com/now/F4'],
  };
  const isLive = (x, now = Date.now()) => x.at <= now && now < x.end;
  const liveBtn = (x) => (LIVE[x.ch] && isLive(x) ? `<a class="live-btn" href="${esc(LIVE[x.ch][1])}" target="_blank" rel="noopener"><i aria-hidden="true"></i>Watch live on ${esc(LIVE[x.ch][0])}</a>` : '');

  // ---------- loading: the first day, then each next one as the strips near their end ----------
  let ctl = null;
  // the first day was asked for by the page itself, before this script arrived (see index.html): used once, if it's the one
  const early = window.tvEarly;
  const fetchDay = (d, signal) => (early?.d === d && !early.used ? ((early.used = true), early.day) : fetch(`/api/day?d=${d}`, { signal })).then(async (r) => {
    const j = await r.json().catch(() => ({})); if (!r.ok || !Array.isArray(j.channels)) throw new Error(j.error || `HTTP ${r.status}`); return expand(j);
  });
  // the listings arrive compact (only the fields a programme has; Sky's pictures as just their id)
  function expand(j) {
    for (const c of j.channels) for (const x of c.items) { if (x.sky) x.wide = `https://images.metadata.sky.com/pd-image/${x.sky}/cover`; x.g ||= []; }
    return j;
  }
  async function load() {
    $('#epg').innerHTML = '<div class="skel" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>';
    ctl?.abort(); ctl = new AbortController(); state.day = null; state.loading = null; state.failedAt = 0;
    try {
      const d = await fetchDay(state.base, ctl.signal);
      state.data = d; state.loaded = new Map([[state.base, d]]); shown.clear();
      setDay(state.base); drawCats(); drawGuide();
      loadNext();   // the next day ready before anyone scrolls to it
      if (askQ) { fq.value = askQ; askQ = ''; openFind(); }
      else if (askP) { const x = shown.get(askP); askP = ''; if (x) openProgramme(x); }
      if (view === 'now') drawOnNow(true);
      drawShelves();
      // the rest of the week, once the page has settled: for the shelves, search and channel pages (kept by sw.js)
      setTimeout(() => idle(() => wholeWeek()), 2500);
    } catch (err) {
      if (err.name === 'AbortError') return;
      $('#picksSec').hidden = true;
      $('#epg').innerHTML = '<div class="empty"><h3>The listings didn’t load</h3><p>Check your connection, then <button type="button" class="retry" id="retry">try again</button>.</p></div>';
      $('#retry').addEventListener('click', load);
      preview(null);
    }
  }
  const extra = new Map();   // days fetched early (for search), as promises: the strips use them when they get there
  // the next day, added to the end of every strip: one at a time, nothing past the last day, and after a failure a
  // calm wait of 20 seconds before trying again (never a fetch per scroll event)
  function loadNext() {
    if (state.loading) return state.loading;
    if (Date.now() - state.failedAt < 20e3) return Promise.resolve(false);
    const last = [...state.loaded.keys()].at(-1), next = days[days.indexOf(last) + 1];
    if (!next || !state.data) return Promise.resolve(false);
    state.loading = (extra.get(next) || fetchDay(next)).then((d) => { if (!state.loaded.has(next)) { state.loaded.set(next, d); appendDay(next, d); } return true; })
      .catch(() => { state.failedAt = Date.now(); return false; }).finally(() => { state.loading = null; });
    return state.loading;
  }
  // a day pill: every strip glides to that day together (fetching up to it first, with the pill showing it's on its
  // way); a day before the first one starts afresh. Only the last tap counts, however quickly they come
  let goId = 0;
  async function goDay(d) {
    const id = ++goId;
    if (!state.data || d < state.base) { state.base = d; return load(); }
    const pill = $(`#days [data-d="${d}"]`);
    if (!state.loaded.has(d)) {
      for (const b of document.querySelectorAll('#days [aria-busy]')) b.removeAttribute('aria-busy');
      pill?.setAttribute('aria-busy', 'true');
      while (!state.loaded.has(d)) { state.failedAt = 0; const ok = await loadNext(); if (id !== goId) return; if (!ok) break; }
      pill?.removeAttribute('aria-busy');
      if (!state.loaded.has(d)) return;
    }
    setDay(d); glide(d);
  }
  // the day in view: the pills, the headline, the address and the picks follow it
  function setDay(d) {
    if (!d || d === state.day) return; state.day = d;
    for (const b of document.querySelectorAll('#days button')) b.dataset.d === d ? b.setAttribute('aria-current', 'date') : b.removeAttribute('aria-current');
    thumb($('#days'), '[aria-current]');
    // the pill into view along its own row only (never scrolling the page away from the guide)
    const row = $('#days'), pill = $(`#days [data-d="${d}"]`);
    if (pill && row.scrollWidth > row.clientWidth) {
      const l = pill.offsetLeft, pad = 24;
      if (l < row.scrollLeft + pad || l + pill.offsetWidth > row.scrollLeft + row.clientWidth - pad) row.scrollTo({ left: Math.max(0, l - pad), behavior: reduce ? 'auto' : 'smooth' });
    }
    const u = new URL(location.href); d === today ? u.searchParams.delete('d') : u.searchParams.set('d', d); history.replaceState(null, '', u);
    $('#eye').textContent = dayName(d, { weekday: 'long', day: 'numeric', month: 'long' });
    $('#h1').innerHTML = `What’s on <br class="ph-br"><em class="grad">${esc(word(d))}</em>.`;   // phones: the day on its own line, so the headline never changes height
    document.title = `What’s on UK TV ${word(d)} · Tenner TV`;
    drawTimes();
    drawPicks(d); if (view === 'now') drawOnNow();
  }

  // ---------- which channels: a category, or your own (pinned channels always come first) ----------
  const CATS = [['all', 'All channels', /./], ['mine', 'My channels', null],
    ['main', 'Main five', /^(BBC One|BBC Two|ITV1|Channel 4|Channel 5)$/],
    ['ent', 'Entertainment', /^(ITV2|E4|Sky Mix|U&Dave|Really|5Star|BBC Three|Challenge|4seven|Sky Max|Dave|W|U&W)$/],
    ['drama', 'Drama & crime', /^(U&Drama|ITV3|ITV4|5USA|Alibi|U&Alibi|Sky Atlantic|True Crime)$/],
    ['fact', 'Factual', /^(Quest|Quest Red|DMAX|Blaze|U&Yesterday|Sky Arts|More4|BBC Four|PBS America)$/],
    ['film', 'Films', /^(Film4|Talking Pictures TV|GREAT! movies|5Action|Sky Cinema.*)$/],
    ['kids', 'Kids', /^(CBBC|CBeebies|CITV|POP|Tiny Pop)$/],
    ['news', 'News', /^(BBC News|Sky News|GB News|BBC Parliament)$/]];
  // pinned channels (kept on the device, and in your Tenner account if you're signed in: see "accounts" below)
  const FAV = 'tenner-tv-fav';
  const favs = {
    all() { const l = store.get(FAV, []); return Array.isArray(l) ? l.filter((x) => typeof x === 'string') : []; },
    set(l, quiet) { store.set(FAV, l); if (!quiet) { store.set('tenner-tv-pat', Date.now()); acct.soon(); } },
  };
  let cat = 'all';
  // the channels to show: a native menu (Tenner's way for a choice like this), in a glass capsule that shows the choice
  function drawCats() {
    const names = state.data.channels.map((c) => c.name), mine = favs.all();
    const live = CATS.filter(([k, , re]) => k === 'all' || (k === 'mine' ? mine.some((n) => names.includes(n)) : names.some((n) => re.test(n))));
    if (!live.some(([k]) => k === cat)) cat = 'all';
    $('#catSel').innerHTML = live.map(([k, l]) => `<option value="${k}"${k === cat ? ' selected' : ''}>${esc(l)}</option>`).join('');
    $('#catL').textContent = CATS.find(([k]) => k === cat)[1];
    $('#catPop').classList.toggle('on', cat !== 'all');
  }
  $('#catSel').addEventListener('change', (e) => { cat = e.target.value; buzz(); drawCats(); arrange(true); if (view === 'now') drawOnNow(true); });
  const star = (on) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.5l-5.1 2.7 1-5.6-4.1-4 5.7-.8z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>`;
  // a channel: its whole week, in a sheet (pinning it to the top is in there)
  $('#epg').addEventListener('click', (e) => { const b = e.target.closest('.ch[data-ch]'); if (b) openChannel(b.dataset.ch); });
  // pin or unpin: the rows on screen glide from where they were to where they are now
  function togglePin(n) {
    const l = favs.all(), on = !l.includes(n);
    favs.set(on ? [...l, n] : l.filter((x) => x !== n)); buzz();
    const before = new Map(), vh = innerHeight;
    if (!reduce) for (const r of $('#epg').querySelectorAll('.crow')) { const t = r.getBoundingClientRect().top; if (t > -200 && t < vh + 200) before.set(r.firstElementChild.dataset.ch, t); }
    drawCats(); arrange();
    if (before.size) for (const r of $('#epg').querySelectorAll('.crow')) {
      if (r.hidden) continue;
      const k = r.firstElementChild.dataset.ch, t = r.getBoundingClientRect().top; if (t < -200 || t > vh + 200) continue;
      const was = before.get(k), dy = was == null ? null : was - t;
      if (dy) r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.3,1.25,.4,1)' });
      else if (dy == null) r.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    }
    if (view === 'now') drawOnNow();
    return on;
  }

  // ---------- the guide ----------
  const px = () => parseFloat(getComputedStyle($('#epg')).getPropertyValue('--px')) || 5;   // a minute's width
  // every channel is drawn once, when a day's listings arrive; a category or a pin only shows, hides and reorders the
  // rows (CSS order: nothing is rebuilt or moved, so each row keeps its place in the week, and it's instant)
  function drawGuide() {
    if (!state.data) return;
    const chans = state.data.channels.filter((c) => c.items.length);
    if (!chans.length) { $('#epg').innerHTML = '<div class="empty"><h3>Nothing listed yet</h3><p>Listings for this day haven’t been published. Try a nearer day.</p></div>'; preview(null); return; }
    const now = Date.now(), m = px(), loaded = [...state.loaded];
    remIds = new Set(rem.all().map((r) => r.id));
    $('#epg').innerHTML = `<div class="empty" hidden><h3>None of these channels today</h3><p>Try another category, or All channels.</p></div><div class="rows">${chans.map((c) => `<div class="crow">
      <button type="button" class="ch" data-ch="${esc(c.name)}">${badge(c.name)}<span class="ch-name">${esc(c.name)}</span><span class="ch-star"></span></button>
      <div class="strip" data-strip="${esc(c.name)}" role="group" aria-label="${esc(`${c.name}, through the week`)}">${loaded.map(([d, day], i) => dayBlocks(c.name, d, day, i > 0, now, m)).join('')}</div></div>`).join('')}</div>`;
    near.clear(); io.disconnect();
    arrange(true, true);
    for (const row of $('#epg').querySelectorAll('.crow')) io.observe(row);
  }
  // which rows show, and in what order: pinned channels first, then as they come
  const visRows = () => [...$('#epg').querySelectorAll('.crow:not([hidden])')].sort((a, b) => a.style.order - b.style.order);
  function arrange(rise, fresh) {
    const rows = $('#epg').querySelectorAll('.crow'); if (!rows.length) return;
    const mine = favs.all(), re = CATS.find(([k]) => k === cat)?.[2], names = state.data.channels.map((c) => c.name);
    for (const row of rows) {
      const ch = row.firstElementChild, n = ch.dataset.ch, pin = mine.includes(n);
      row.hidden = !(cat === 'mine' ? pin : re.test(n));
      row.style.order = names.indexOf(n) - (pin ? 1000 : 0);
      row.classList.remove('first');
      if (ch.getAttribute('aria-pressed') !== String(pin)) {
        ch.setAttribute('aria-pressed', pin);
        ch.setAttribute('aria-label', `${n}${pin ? ', pinned to the top' : ''}: press for its whole week. Arrow right for its programmes`);
        ch.lastElementChild.innerHTML = star(pin);
      }
    }
    const vis = visRows();
    $('#epg .empty').hidden = vis.length > 0;
    if (!vis.length) { preview(null); return; }
    vis[0].classList.add('first');
    const vh = innerHeight, now = Date.now();
    vis.forEach((row, i) => {
      const st = row.lastElementChild, r = row.getBoundingClientRect(), close = r.bottom > -300 && r.top < vh + 300;
      if (fresh) { if (close) jumpStrip(st, state.day || state.base); else st._want = state.day || state.base; }
      if (close) { edges(st); if (!reduce && rise && i < 14) row.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: i * 22, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }); }
    });
    // the preview: what's on now on the first channel shown (or the first thing this evening)
    const first = vis[0].firstElementChild.dataset.ch, all = [...shown.values()];
    if (fresh || rise) preview(all.find((x) => x.ch === first && isLive(x, now)) || all.find((x) => x.ch === first && hour(x.at) >= 19) || all[0], true);
  }
  // one channel's programmes for one day (with a marker first, from the second day on). Blocks aren't tab stops: the
  // channel buttons are, and the arrow keys move around the grid from there (see "keys" below)
  let remIds = new Set();
  function dayBlocks(name, d, day, mark, now, m) {
    const items = day.channels.find((c) => c.name === name)?.items || [], dn = dayName(d, { weekday: 'long' });
    return (mark ? `<span class="daymark" aria-hidden="true"><b>${esc(dayName(d, { weekday: 'short' }))}</b>${esc(dayName(d, { day: 'numeric', month: 'short' }))}</span>` : '')
      + items.map((x, j) => {
        const end = ends(x, items[j + 1]), live = x.at <= now && now < end, past = end <= now, t = hm(x.at);
        const p = live ? Math.round(((now - x.at) / (end - x.at)) * 100) : 0;
        return `<button type="button" tabindex="-1" class="blk${live ? ' live' : past ? ' past' : ''}${remIds.has(String(x.id)) ? ' rem' : ''}" style="width:${Math.max(150, Math.round(((end - x.at) / 60e3) * m))}px${live ? `;--p:${p}%` : ''}" ${reg(x, name, items[j + 1])} data-day="${d}"
          aria-label="${esc(`${name}, ${dn} ${t}: ${x.t}${x.isNew ? ', new' : ''}`)}"><span class="bi"><b>${x.isNew ? '<i class="new">New</i>' : ''}${esc(x.t)}</b><small>${live ? `Now · ${Math.max(1, Math.round((end - now) / 60e3))} min left` : t}</small></span></button>`;
      }).join('');
  }
  // a newly fetched day, added to the end of every strip without moving anything: at once in the strip being scrolled,
  // the others a few at a time in quiet moments (or the moment one comes near, or a glide needs it), so a new day never
  // stalls a frame
  const idle = window.requestIdleCallback || ((f) => setTimeout(() => f({ timeRemaining: () => 8 }), 50));
  function fill(st) {
    if (!st._pend?.length) return;
    const now = Date.now(), m = px(); remIds = new Set(rem.all().map((r) => r.id));
    st.insertAdjacentHTML('beforeend', st._pend.map(([d, day]) => dayBlocks(st.dataset.strip, d, day, true, now, m)).join('')); st._pend = null; st._b = null;
    if (st._aim != null) place(st, st._aim);
  }
  function appendDay(d, day) {
    const rest = [];
    const t = performance.now();
    for (const st of $('#epg').querySelectorAll('.strip')) { (st._pend ||= []).push([d, day]); t - (st._t || 0) < 1500 ? fill(st) : rest.push(st); }
    const more = (dl) => { while (rest.length && dl.timeRemaining() > 2) fill(rest.shift()); if (rest.length) idle(more); };
    if (rest.length) idle(more);
  }

  // ---------- scrolling a strip: keep its title readable at the edge, load the next day before the end, follow the day ----------
  // Only the block at the edge is touched (found by binary search), and the work is done once a frame
  const blocksOf = (st) => st._b || (st._b = [...st.querySelectorAll('.blk')].map((b) => ({ b, l: b.offsetLeft, w: b.offsetWidth })));
  const blockAt = (st, x) => { const l = blocksOf(st); if (!l.length) return null; let lo = 0, hi = l.length - 1; while (lo < hi) { const k = (lo + hi + 1) >> 1; if (l[k].l - l[0].l <= x) lo = k; else hi = k - 1; } return l[lo]; };
  const atEdge = new WeakMap();
  function edges(st) {
    const l = blocksOf(st); if (!l.length) return;
    const x = st.scrollLeft, k = blockAt(st, x), prev = atEdge.get(st), rel = k.l - l[0].l;
    const off = rel < x && rel + k.w > x + 60 ? Math.min(x - rel, k.w - 120) : 0;
    if (prev && prev !== k.b) prev.style.removeProperty('--off');
    if (off > 0) { k.b.style.setProperty('--off', `${off}px`); atEdge.set(st, k.b); } else { k.b.style.removeProperty('--off'); atEdge.delete(st); }
  }
  const dirty = new Set(); let frame = 0;
  $('#epg').addEventListener('scroll', (e) => {
    const st = e.target; if (!st.classList?.contains('strip') || gliding) return;
    dirty.add(st); st._t = e.timeStamp;
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      for (const s of dirty) {
        edges(s);
        if (s.scrollLeft + s.clientWidth > s.scrollWidth - 1600) loadNext();
        if (s._auto) { s._auto = false; continue; }
        s._aim = null;
        const k = blockAt(s, s.scrollLeft + 40); if (k) setDay(k.b.dataset.day);
      }
      dirty.clear();
    });
  }, { capture: true, passive: true });
  // the offsets are measured once and kept; a change of size (rotating a phone) measures again
  // (cheaply: they're only marked to be measured again, the next time each strip is used)
  let lastW = 0;
  new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w === lastW) return; lastW = w; for (const st of $('#epg').querySelectorAll('.strip')) st._b = null; }).observe($('#epg'));
  // the moment the guide is pointed at: now (today, with Now chosen), or the hour chosen on day d (7pm unless you pick)
  const atHour = (d, h) => { const t = Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00Z`); let k = hour(t) - h; if (k < -12) k += 24; return t - k * 36e5; };
  const momentOf = (d) => (state.time === 'now' && d === today ? Date.now() : atHour(d, state.time === 'now' ? 19 : state.time));
  // where a strip goes for day d: the programme on at that moment, or the next one after it
  function targetOf(st, d) {
    const at = momentOf(d), l = blocksOf(st); if (!l.length) return null;
    const pick = l.find(({ b }) => { const x = shown.get(b.dataset.p); return x && isLive(x, at); })
      || l.find(({ b }) => (shown.get(b.dataset.p)?.at || 0) > at) || l.find(({ b }) => b.dataset.day === d) || l[0];
    return { x: Math.max(0, pick.l - l[0].l), b: pick.b };
  }
  function jumpStrip(st, d = state.day) { const t = targetOf(st, d); if (t) place(st, t.x); }
  // near the end of the days loaded so far a strip can't yet scroll as far as asked (on a wide screen, late in the
  // evening): it remembers where it was going, and gets there once the next day is added (unless you've moved it)
  function place(st, x) { st._auto = true; st.scrollLeft = x; st._aim = Math.abs(st.scrollLeft - x) > 1 ? x : null; }
  // rows near the screen (the only ones worth moving smoothly); a row arriving that was waiting for a day goes straight there
  const near = new Set();
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      const st = e.target.lastElementChild; if (!st) continue;
      if (!e.isIntersecting) { near.delete(st); continue; }
      near.add(st); fill(st);
      if (st._want) { jumpStrip(st, st._want); st._want = null; edges(st); }
    }
  }, { rootMargin: '300px 0px' });
  // the glide: every strip near the screen moves together, on one clock and one curve (fast, then settling gently),
  // the rest wait to be placed as they come near. The programmes it lands on give a small bounce. A touch, a wheel or
  // a new tap takes over at once
  let gliding = false, glideId = 0;
  function glide(d) {
    const id = ++glideId, list = [];
    for (const st of $('#epg').querySelectorAll('.strip')) {
      if (!near.has(st)) { st._want = d; continue; }
      st._want = null; fill(st); const t = targetOf(st, d); if (t) list.push({ st, from: st.scrollLeft, to: t.x, b: t.b });
    }
    if (!list.length) return;
    const far = Math.max(...list.map((g) => Math.abs(g.to - g.from)));
    const dur = reduce || far < 2 ? 0 : Math.min(950, 380 + Math.sqrt(far) * 2.4), t0 = performance.now();
    gliding = true;
    const land = () => {
      // the last scroll events of the glide arrive in the next frame: they're the glide's, not a person's
      requestAnimationFrame(() => { if (id === glideId) gliding = false; });
      const top = innerHeight;
      list.forEach((g, i) => {
        g.st._aim = Math.abs(g.st.scrollLeft - g.to) > 1 ? g.to : null; edges(g.st);
        const r = g.st.getBoundingClientRect();
        if (!reduce && r.bottom > 0 && r.top < top) g.b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)', offset: .35 }, { transform: 'scale(.985)', offset: .7 }, { transform: 'none' }], { duration: 560, delay: Math.min(i, 12) * 26, easing: 'ease-out' });
      });
      const first = list.find((g) => g.st.getBoundingClientRect().bottom > 0) || list[0];
      preview(shown.get(first.b.dataset.p), true);
      const s = list[0].st; if (s.scrollLeft + s.clientWidth > s.scrollWidth - 1600) loadNext();
    };
    const step = (now) => {
      if (id !== glideId) return;
      const k = dur ? Math.min(1, (now - t0) / dur) : 1, e = k >= 1 ? 1 : 1 - Math.pow(1 - k, 4);
      for (const g of list) g.st.scrollLeft = g.from + (g.to - g.from) * e;
      if (k < 1) requestAnimationFrame(step); else land();
    };
    dur ? requestAnimationFrame(step) : step(t0);
  }
  // a person taking hold stops the glide where it is
  const takeOver = () => { if (!gliding) return; glideId++; gliding = false; };
  for (const ev of ['wheel', 'touchstart', 'pointerdown']) $('#epg').addEventListener(ev, takeOver, { passive: true, capture: true });

  // ---------- jump to a time: every channel glides to it, on the day in view (Now goes back to today) ----------
  const HOURS = [[9, '9am'], [12, 'Midday'], [15, '3pm'], [18, '6pm'], [19, '7pm'], [20, '8pm'], [21, '9pm'], [22, '10pm'], [23, '11pm']];
  const timeLabel = () => (state.time === 'now' ? (state.loaded.has(today) ? 'Now' : 'This evening') : HOURS.find(([h]) => h === state.time)?.[1] || '');
  function drawTimes() {
    $('#timeSel').innerHTML = `<option value="now"${state.time === 'now' ? ' selected' : ''}>${state.loaded.has(today) ? 'Now' : 'This evening'}</option>`
      + HOURS.map(([h, l]) => `<option value="${h}"${state.time === h ? ' selected' : ''}>${l}</option>`).join('');
    $('#timeL').textContent = timeLabel();
    $('#timePop').classList.toggle('on', state.time !== 'now');
  }
  $('#timeSel').addEventListener('change', (e) => {
    const v = e.target.value; state.time = v === 'now' ? 'now' : +v; buzz(); drawTimes();
    if (state.time === 'now') { const d = state.loaded.has(today) ? today : state.base; if (d === state.day) glide(d); else goDay(d); }
    else glide(state.day || state.base);
    if (view === 'now') drawOnNow(true);
  });

  // ---------- the keyboard: the channel buttons are the tab stops; the arrows move around the grid ----------
  // → from a channel: into its strip, at what's in view. ←/→ in a strip: the programme before or after. ↑/↓: the
  // channel above or below, at the programme on at the same time. Home/End: the strip's start or end.
  function focusBlock(b) {
    if (!b) return; const st = b.parentElement, l = blocksOf(st), first = l[0]?.l || 0, rel = b.offsetLeft - first;
    b.focus({ preventScroll: true });
    if (rel < st.scrollLeft || rel + b.offsetWidth > st.scrollLeft + st.clientWidth) st.scrollTo({ left: Math.max(0, rel - 12), behavior: reduce ? 'auto' : 'smooth' });
  }
  $('#epg').addEventListener('keydown', (e) => {
    const b = e.target.closest('.blk'), ch = e.target.closest('.ch');
    if (ch && e.key === 'ArrowRight') { e.preventDefault(); const st = ch.nextElementSibling; focusBlock(blockAt(st, st.scrollLeft + 8)?.b); return; }
    if (!b) return;
    const st = b.parentElement, row = st.closest('.crow');
    const sib = (dir) => { let n = b; do n = dir > 0 ? n.nextElementSibling : n.previousElementSibling; while (n && !n.classList.contains('blk')); return n; };
    const v = visRows(), at = v.indexOf(row);
    const same = (r) => { const s = r?.querySelector('.strip'), x = shown.get(b.dataset.p); if (!s || !x) return null; fill(s);
      const l = blocksOf(s); return (l.find(({ b: n }) => { const y = shown.get(n.dataset.p); return y && y.at <= x.at && x.at < y.end; }) || l.find(({ b: n }) => (shown.get(n.dataset.p)?.at || 0) >= x.at) || l.at(-1))?.b; };
    const go = { ArrowRight: () => sib(1), ArrowLeft: () => sib(-1) || row.querySelector('.ch'), ArrowDown: () => same(v[at + 1]), ArrowUp: () => same(v[at - 1]),
      Home: () => blocksOf(st)[0]?.b, End: () => blocksOf(st).at(-1)?.b }[e.key];
    if (!go) return; e.preventDefault();
    const n = go(); if (n?.classList.contains('ch')) n.focus(); else focusBlock(n);
  });

  // ---------- the preview: a compact card for what you point at (or move to), with a small still ----------
  // Pointing settles for a moment first, so sweeping the mouse across the grid doesn't flick through pictures
  let pvKey = null, pvT = 0;
  function preview(x, immediate) {
    clearTimeout(pvT);
    if (!immediate) { pvT = setTimeout(() => preview(x, true), 110); return; }
    if (!x) { for (const id of ['pvLive', 'pvSum', 'pvMeta', 'pvT']) $(`#${id}`).textContent = ''; $('#pvCh').innerHTML = '&nbsp;'; $('#pvImg').hidden = true; pvKey = null; return; }
    if (pvKey === x.id) return; pvKey = x.id;
    if (!reduce) $('.pv-copy').animate([{ opacity: .35, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    const t = Date.now(), started = isLive(x, t);
    $('#pvCh').innerHTML = logo(x.ch) ? `<img class="pv-logo" src="${esc(logo(x.ch))}" alt="${esc(x.ch)}">` : esc(x.ch);
    $('#pvT').textContent = x.t;
    $('#pvSum').textContent = x.sum || epLine(x) || (x.g || []).join(', ');
    $('#pvLive').innerHTML = liveBtn(x);
    $('#pvMeta').textContent = [started ? `Started at ${hm(x.at)}` : `${x.end <= t ? 'Was on' : `${x.at - t < 864e5 && ukDay(x.at) === today ? 'On' : dayName(ukDay(x.at), { weekday: 'long' })}`} at ${hm(x.at)}`,
      x.s && x.n ? `S${x.s} E${x.n}` : '', length(x.end - x.at), started ? `${minsLeft(x, t)} min left` : ''].filter(Boolean).join('  ·  ');
    const img = $('#pvImg'), src = x.wide || x.poster;
    $('#pv').classList.toggle('poster', !x.wide && !!x.poster);
    if (!src) { img.hidden = true; img.removeAttribute('src'); return; }
    if (img.getAttribute('src') === src) return;
    img.classList.remove('on'); img.hidden = false;
    img.onload = () => { if (img.getAttribute('src') === src) img.classList.add('on'); };
    img.onerror = () => { img.hidden = true; };
    img.src = src;
  }
  const over = (e) => { const b = e.target.closest?.('.blk, .pick, .tile'); if (b) preview(shown.get(b.dataset.p)); };
  document.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') over(e); });
  document.addEventListener('focusin', over);

  // ---------- the evening's picks: the best on the main channels (never news, weather or the like), one per show ----------
  function drawPicks(d = state.day) {
    const data = state.loaded.get(d); if (!data) return;
    const seen = new Set(), list = [];
    for (const c of data.channels.slice(0, 10)) c.items.forEach((x, j) => {
      const h = hour(x.at); if (h < 19 || h > 22.5) return;
      const g = (x.g || []).join(' ') + ' ' + (x.type || '');
      const score = (x.r || 6.2) + (x.wide ? 1.4 : x.poster ? .8 : 0) + (x.sum ? .3 : 0) + (x.isNew ? .8 : 0) + (x.rt >= 45 ? .5 : 0) + (/Scripted|Documentary|Drama|Comedy/.test(g) ? .6 : 0)
        - (/News|Talk Show|Weather/.test(g) || /\b(News|Weather|Lottery|Teleshopping|Party Political|Regional)\b/i.test(x.t) ? 6 : 0);
      list.push({ x, c: c.name, next: c.items[j + 1], score });
    });
    const ranked = list.sort((a, b) => b.score - a.score).filter(({ x }) => !seen.has(x.show || x.t) && seen.add(x.show || x.t));
    corner(ranked.filter(({ x, next }) => x.wide && ends(x, next) > Date.now()).slice(0, 6));
    const picks = ranked.slice(0, 10).sort((a, b) => a.x.at - b.x.at);
    $('#picksSec').hidden = picks.length < 3;
    $('#picksH').textContent = d === today ? 'Tonight’s picks' : d === days[1] ? 'Tomorrow’s picks' : `${dayName(d, { weekday: 'long' })}’s picks`;
    $('#picks').innerHTML = picks.map(({ x, c, next }) => card(x, c, next, epLine(x) || (x.g || []).join(', ') || c, true)).join('');
  }
  // ---------- the corner: the evening's most popular programmes with artwork, one at a time, melting into the page.
  // Each stays 9 seconds and cross-fades to the next (it holds still with Reduce Motion, or while the page is hidden) ----------
  let cornerL = [], cornerI = 0, cornerT = 0;
  function corner(l) {
    const key = l.map((o) => o.x.id).join();
    if (key === cornerL.map((o) => o.x.id).join()) return;
    cornerL = l; cornerI = 0; clearInterval(cornerT);
    $('#corner').hidden = !l.length; if (!l.length) return;
    showCorner();
    if (!reduce && l.length > 1) cornerT = setInterval(() => { if (!document.hidden) { cornerI = (cornerI + 1) % cornerL.length; showCorner(); } }, 9000);
  }
  function showCorner() {
    const { x, c, next } = cornerL[cornerI], b = $('#corner'), [a1, a2] = b.querySelectorAll('img');
    const back = a1.classList.contains('on') ? a2 : a1, front = back === a1 ? a2 : a1;
    b.setAttribute('data-p', x.id); reg(x, c, next);
    b.setAttribute('aria-label', `${x.t}, ${c} at ${hm(x.at)}. Tap for what it’s about`);
    back.onload = () => { back.classList.add('on'); front.classList.remove('on'); $('#cornerCap').classList.add('in'); };
    $('#cornerCap').classList.remove('in');
    $('#cornerCap').innerHTML = `<small>${esc(isLive(x) ? `On now · ${c}` : `${hm(x.at)} · ${c}`)}</small><b>${esc(x.t)}</b>`;
    back.src = x.wide;
  }
  // a card: wide artwork with the time on a frosted chip, the title and a grey line (the same in every shelf)
  const card = (x, c, next, sub, sameDay) => `<li><button type="button" class="pick" ${reg(x, c, next)}>
      <span class="pick-art">${art(x)}<span class="chip">${sameDay ? '' : `${esc(shortDay(ukDay(x.at)))} `}${hm(x.at)} · ${esc(c)}</span>${rem.has(x.id) ? `<span class="chip-bell" aria-label="Reminder on">${BELL}</span>` : ''}</span>
      <b>${esc(x.t)}</b><small>${esc(sub)}</small></button></li>`;
  const shortDay = (d) => (d === today ? 'Today' : d === days[1] ? 'Tmrw' : dayName(d, { weekday: 'short' }));

  // ---------- the week's shelves: films, new series, and (signed in) your Watchlist. From every day fetched ----------
  const FILM_CH = /^(Film4|GREAT! movies|Talking Pictures TV|Sky Cinema.*)$/;
  const yearOf = (x) => (x.sum || '').match(/^\((\d{4})\)|\[((?:19|20)\d\d)\]\s*$|^((?:19|20)\d\d)\.\s|\b(?:film|movie)\b[^.]*?,\s((?:19|20)\d\d)\./i)?.slice(1).find(Boolean);
  const notProg = /teleshop|shopping|\bnews\b|^live\b|live:|highlights|programmes start|^this is |closedown|^\.\./i;
  const isFilm = (x, c) => !x.s && !x.n && x.rt >= 70 && !notProg.test(x.t) && (!!yearOf(x) || FILM_CH.test(c));
  function weekItems() {   // every programme still to come (or just begun), on the days fetched so far
    const now = Date.now(), out = [];
    for (const [, day] of allDays()) for (const c of day.channels) c.items.forEach((x, j) => { if (x.at > now - 20 * 60e3) out.push({ x, c: c.name, next: c.items[j + 1] }); });
    return out.sort((a, b) => a.x.at - b.x.at);
  }
  const once = (l, key = (o) => fold(o.x.t)) => { const seen = new Set(); return l.filter((o) => !seen.has(key(o)) && seen.add(key(o))); };
  let shelfT = 0;
  function drawShelves() {
    clearTimeout(shelfT);
    shelfT = setTimeout(() => {
      const all = weekItems();
      const films = once(all.filter(({ x, c }) => isFilm(x, c))).slice(0, 40);
      $('#filmsSec').hidden = films.length < 3;
      $('#films').innerHTML = films.map(({ x, c, next }) => card(x, c, next, [yearOf(x), length(ends(x, next) - x.at)].filter(Boolean).join(' · '))).join('');
      const series = once(all.filter(({ x }) => x.isNew && x.n === 1)).slice(0, 30);
      $('#seriesSec').hidden = series.length < 2;
      $('#series').innerHTML = series.map(({ x, c, next }) => card(x, c, next, x.s ? `Series ${x.s} starts` : 'New series')).join('');
      const wl = new Map(acct.watchlist().map((w) => [fold(w.title).replace(/^the /, ''), w]));
      const mine = wl.size ? once(all.filter(({ x }) => wl.has(fold(x.t).replace(/^the /, '')))).slice(0, 30) : [];
      $('#mineSec').hidden = !mine.length;
      $('#mine').innerHTML = mine.map(({ x, c, next }) => card(x, c, next, epLine(x) || 'On your Watchlist')).join('');
    }, 60);
  }

  // ---------- the sheet: what a programme's about. Esc, ×, a tap outside or (on phones) a swipe down closes it ----------
  const sheet = $('#sheet'), shIn = $('#shIn');
  const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.6 2H4.4z" fill="currentColor"/><path d="M10 21h4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
  const BELL_O = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.6 2H4.4z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M10 21h4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
  const CAL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M12 13v4.5M9.75 15.25h4.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
  const SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11M8 7.2l4-3.7 4 3.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 10.5H7a2.5 2.5 0 0 0-2.5 2.5v5A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-5a2.5 2.5 0 0 0-2.5-2.5h-1.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
  const closeAll = () => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]'); if (!b || sheet.contains(b)) return;
    const x = shown.get(b.dataset.p); if (x) openProgramme(x);
  });
  function remBtn(x) { const on = rem.has(x.id); return `<button type="button" class="act${on ? ' on' : ''}" id="shRem" aria-pressed="${on}">${on ? BELL : BELL_O}<span>${on ? 'Reminder on' : 'Remind me'}</span></button>`; }
  function openProgramme(x) {
    closeAll(); preview(x, true);
    const now = Date.now(), soon = x.at > now, src = x.wide || x.poster;
    const when = `${esc(x.ch)} · ${esc(dayName(ukDay(x.at), { weekday: 'long', day: 'numeric', month: 'long' }))} · ${hm(x.at)}–${hm(x.end)} · ${length(x.end - x.at)}`;
    shIn.innerHTML = `${src ? `<div class="sh-bg" aria-hidden="true"><img src="${esc(src)}" alt=""></div>` : ''}<div class="sh-grab" aria-hidden="true"></div><div class="sh-art${!x.wide && x.poster ? ' sh-poster' : ''}">${src ? art(x) : ''}
        <button type="button" class="sh-x" id="shX" aria-label="Close">${X}</button></div>
      <div class="sh-body"><p class="sh-when">${when}</p>
        <h2 id="shT">${x.isNew ? '<i class="new">New</i>' : ''}${esc(x.t)}</h2>${epLine(x) ? `<p class="sh-ep">${esc(epLine(x))}</p>` : ''}
        ${isLive(x, now) ? `<div class="sh-prog" aria-label="${minsLeft(x, now)} minutes left"><i style="width:${Math.round(((now - x.at) / (x.end - x.at)) * 100)}%"></i></div>` : ''}
        <div class="sh-acts">${liveBtn(x)}${soon ? remBtn(x) : ''}${soon ? `<button type="button" class="act" id="shCal">${CAL}<span>Add to Calendar</span></button>` : ''}<button type="button" class="act" id="shShare">${SHARE}<span>Share</span></button></div>
        ${x.sum ? `<p class="sh-sum">${esc(x.sum)}</p>` : '<p class="sh-sum sh-none">No description yet.</p>'}
        ${x.g?.length ? `<ul class="sh-tags">${x.g.map((g) => `<li>${esc(g)}</li>`).join('')}${x.r ? `<li>★ ${x.r.toFixed(1)}</li>` : ''}</ul>` : ''}
        <p class="sh-more"><button type="button" class="sh-link" id="shCh">${esc(x.ch)}’s week</button>${x.url ? `<a class="sh-link" href="${esc(x.url)}" target="_blank" rel="noopener">More on TVmaze</a>` : ''}</p>
        ${liveBtn(x) ? '<p class="sh-note">Watch live opens the channel’s own player. You need a TV licence to watch live TV in the UK.</p>' : ''}</div>`;
    shIn.scrollTop = 0; sheet.style.removeProperty('transform');
    sheet.showModal();
    $('#shX').focus({ preventScroll: true });
    const onRem = async () => { await toggleRem(x); const b = $('#shRem'); if (!b) return; b.outerHTML = remBtn(x); $('#shRem').addEventListener('click', onRem); $('#shRem').focus({ preventScroll: true }); };
    $('#shRem')?.addEventListener('click', onRem);
    $('#shCal')?.addEventListener('click', () => { calendar([remOf(x)]); });
    $('#shShare').addEventListener('click', () => share(x));
    $('#shCh').addEventListener('click', () => openChannel(x.ch));
  }
  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('#shX')) closeSheet(); });
  sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });   // Esc: the same gentle close
  function closeSheet() {
    if (!sheet.open || sheet.classList.contains('closing')) return;
    if (reduce) { sheet.close(); return; }
    let finished = false;
    const done = () => { if (finished) return; finished = true; sheet.classList.remove('closing', 'pulled'); sheet.style.removeProperty('transform'); sheet.style.removeProperty('transition'); sheet.close(); };
    if (sheet.style.transform) {   // pulled down by a finger: carry on from there, off the bottom
      sheet.style.transition = 'transform .28s cubic-bezier(.4, 0, 1, 1)'; sheet.style.transform = 'translateY(110%)';
      sheet.classList.add('closing', 'pulled');
    } else sheet.classList.add('closing');
    setTimeout(done, 320);
  }
  // swipe down to close (phones), as an iOS sheet does: when its content is at the top, a downward drag moves the
  // sheet with the finger (and stops the page scrolling); let go far enough, or with a flick, and it goes
  let pull = null;
  sheet.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('a')) { pull = null; return; }
    pull = { y: e.touches[0].clientY, t: performance.now(), dy: 0, on: false };
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!pull) return;
    const dy = e.touches[0].clientY - pull.y;
    if (!pull.on) { if (dy > 6 && shIn.scrollTop <= 0) { pull.on = true; pull.y += 6; } else { if (Math.abs(dy) > 6) pull = null; return; } }
    e.preventDefault();
    pull.dy = Math.max(0, e.touches[0].clientY - pull.y);
    sheet.style.transition = 'none'; sheet.style.transform = `translateY(${pull.dy}px)`;
  }, { passive: false });
  const letGo = () => {
    if (!pull?.on) { pull = null; return; }
    const fast = pull.dy / Math.max(1, performance.now() - pull.t) > .5, far = pull.dy > Math.min(150, sheet.offsetHeight * .28);
    sheet.style.removeProperty('transition');
    if (far || fast) closeSheet(); else sheet.style.removeProperty('transform');
    pull = null;
  };
  sheet.addEventListener('touchend', letGo); sheet.addEventListener('touchcancel', letGo);

  // ---------- search: every channel, all week (the days not loaded yet are fetched when it opens) ----------
  // Every word you type matches the start of a word in a title ("str com" finds Strictly Come Dancing), accents
  // and capitals ignored. Titles that start with what you typed come first, then soonest first; nothing that's over.
  const find = $('#find'), fq = $('#fq'), fr = $('#fr'), fs = $('#fs');
  const fold = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const index = new Map();   // per day: every programme, with its title folded once
  function indexOf(d, day) {
    if (!index.has(d)) index.set(d, day.channels.flatMap((c) => c.items.map((x, j) => ({ x, ch: c.name, next: c.items[j + 1], f: ` ${fold(x.t)}` }))));
    return index.get(d);
  }
  const allDays = () => days.map((d) => [d, state.loaded.get(d) || extra.get(d)?.done]).filter(([, v]) => v);
  function openFind() {
    if (!state.data || find.open) return;
    find.showModal(); fq.focus(); fq.select(); search();
    wholeWeek(searchAgain);
  }
  const searchAgain = () => { if (find.open && fq.value.trim()) search(); };
  // the rest of the week, quietly (for search, the shelves and channel pages): each day once, then onDay with it
  const weekWait = new Set();
  function wholeWeek(onDay) {
    if (onDay) weekWait.add(onDay);
    for (const d of days) if (!state.loaded.has(d) && !extra.has(d)) {
      const p = fetchDay(d); extra.set(d, p);
      p.then((v) => { p.done = v; for (const f of weekWait) f(d); drawShelves(); }, () => extra.delete(d));
    }
  }
  let fqT = 0;
  function search() {
    const q = fold(fq.value), words = q.split(' ').filter(Boolean);
    if (!words.length) { fr.innerHTML = ''; fs.textContent = 'Search every channel, all week.'; return; }
    const now = Date.now(), hits = [];
    for (const [d, day] of allDays()) for (const it of indexOf(d, day)) {
      if (!words.every((w) => it.f.includes(` ${w}`))) continue;
      const end = ends(it.x, it.next); if (end <= now) continue;
      hits.push({ ...it, end, top: it.f.startsWith(` ${q}`) ? 0 : 1 });
    }
    hits.sort((a, b) => a.top - b.top || a.x.at - b.x.at);
    const list = hits.slice(0, 60), more = allDays().length < days.length;
    if (!hits.length && !more) return elsewhere(fq.value.trim());
    fs.textContent = hits.length ? `${hits.length > 60 ? 'The first 60 of ' : ''}${hits.length} programme${hits.length === 1 ? '' : 's'}${more ? ', still searching the rest of the week…' : ''}`
      : more ? 'Searching the rest of the week…' : 'Nothing this week matches that.';
    fr.innerHTML = list.map(({ x, ch, end }) => {
      shown.has(String(x.id)) || shown.set(String(x.id), { ...x, ch, end });
      const d = ukDay(x.at), live = isLive({ at: x.at, end }, now);
      return `<li><button type="button" class="fd-row" data-p="${esc(x.id)}">${badge(ch)}<span class="fd-t"><b>${x.isNew ? '<i class="new">New</i>' : ''}${esc(x.t)}</b>
        <small>${esc(`${live ? 'On now' : d === today ? 'Today' : d === days[1] ? 'Tomorrow' : `${dayName(d, { weekday: 'short' })} ${dayName(d, { day: 'numeric', month: 'short' })}`} · ${hm(x.at)} · ${ch}`)}</small></span>${live ? '<i class="fd-live">Now</i>' : ''}</button></li>`;
    }).join('');
  }
  // nothing on TV this week: the films and shows of that name on Tenner, to watch on a streaming service instead
  // (Tenner's own search, the same as tenner.stream's; each opens its page there, with where to watch it)
  const API = 'https://tenner-api.danseacroft.workers.dev', found = new Map();
  async function elsewhere(q) {
    fr.innerHTML = ''; fs.textContent = 'Nothing on TV this week. Looking for it on streaming…';
    if (!found.has(q)) found.set(q, fetch(`${API}/search?q=${encodeURIComponent(q)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    const d = await found.get(q);
    if (fq.value.trim() !== q || !find.open) return;   // typed on since
    const list = (d?.results || []).filter((x) => x.poster).slice(0, 6);
    if (!list.length) { found.delete(q); fs.textContent = 'Nothing this week matches that.'; return; }
    fs.textContent = 'Not on TV this week, but you can stream it:';
    fr.innerHTML = list.map((x) => `<li><a class="fd-row" href="https://tenner.stream/?t=${esc(x.k)}"><img class="fd-pst" src="https://image.tmdb.org/t/p/w154${esc(x.poster)}" alt="" loading="lazy" decoding="async" width="40" height="60">
      <span class="fd-t"><b>${esc(x.title)}</b><small>${esc([x.type === 'movie' ? 'Film' : 'Series', x.year, x.rating ? `★ ${x.rating}` : ''].filter(Boolean).join(' · '))}</small></span>
      <span class="fd-go">Where to watch<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span></a></li>`).join('');
  }
  fq.addEventListener('input', () => { clearTimeout(fqT); fqT = setTimeout(search, 70); });
  $('#findBtn').addEventListener('click', openFind);
  $('#fdX').addEventListener('click', () => find.close());
  find.addEventListener('click', (e) => { if (e.target === find) find.close(); });
  find.addEventListener('close', () => { fq.value = ''; fr.innerHTML = ''; });
  // the keyboard: / or ⌘K (Ctrl+K) opens it; ↓ and ↑ move through the results, Enter opens one
  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest?.('input, textarea, [contenteditable]');
    if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); openFind(); }
  });
  find.addEventListener('keydown', (e) => {
    const rows = [...fr.querySelectorAll('.fd-row')], i = rows.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = e.key === 'ArrowDown' ? (i < 0 ? 0 : i + 1) : i - 1; (n < 0 ? fq : rows[Math.min(n, rows.length - 1)])?.focus(); }
    else if (e.key === 'Enter' && e.target === fq) { e.preventDefault(); rows[0]?.click(); }
  });


  // ---------- the views: the guide, or On now (every channel at a glance, at the moment chosen) ----------
  let view = 'guide';
  $('#view').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b && b.dataset.view !== view) setView(b.dataset.view); });
  $('#view').addEventListener('keydown', (e) => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); setView(view === 'guide' ? 'now' : 'guide'); $(`[data-view="${view}"]`).focus(); } });
  function setView(v) {
    view = v; buzz();
    for (const b of document.querySelectorAll('#view [data-view]')) { const on = b.dataset.view === v; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; }
    thumb($('#view'), '[aria-selected="true"]');
    $('#epg').hidden = v !== 'guide'; $('#epgHint').hidden = v !== 'guide'; $('#onnow').hidden = v !== 'now';
    if (v === 'now') drawOnNow(true); else for (const st of near) edges(st);
  }
  // one channel's programmes across the days fetched, each with its end
  function chItems(n) {
    const l = [];
    for (const [, day] of [...state.loaded].sort()) { const c = day.channels.find((k) => k.name === n); if (c) l.push(...c.items); }
    return l.map((x, j) => ({ x, end: ends(x, l[j + 1]), next: l[j + 1] }));
  }
  function drawOnNow(rise) {
    if (!state.data) return;
    const d = state.day || state.base, at = momentOf(d), live = state.time === 'now' && d === today, mine = favs.all(), re = CATS.find(([k]) => k === cat)?.[2];
    const names = state.data.channels.map((c) => c.name).filter((n) => (cat === 'mine' ? mine.includes(n) : re.test(n)))
      .sort((a, b) => (mine.includes(b) ? 1 : 0) - (mine.includes(a) ? 1 : 0));
    $('#onH').textContent = live ? 'On now' : `On ${d === today ? 'today' : word(d) === 'tomorrow' ? 'tomorrow' : dayName(d, { weekday: 'long' })} at ${timeLabel().toLowerCase()}`;
    $('#tiles').innerHTML = names.map((n) => {
      const l = chItems(n), i = l.findIndex((o) => o.x.at <= at && at < o.end); if (i < 0) return '';
      const { x, end, next } = l[i], p = Math.round(((at - x.at) / (end - x.at)) * 100);
      return `<li><button type="button" class="tile${live ? ' live' : ''}" ${reg(x, n, next)} aria-label="${esc(`${n}: ${x.t}, ${hm(x.at)} to ${hm(end)}${next ? `. Then ${next.t}` : ''}`)}">
        <span class="tile-art">${art(x)}<span class="tile-ch">${badge(n)}</span>${rem.has(x.id) ? `<span class="chip-bell">${BELL}</span>` : ''}</span>
        <span class="tile-copy"><b>${x.isNew ? '<i class="new">New</i>' : ''}${esc(x.t)}</b>
          <small>${hm(x.at)}–${hm(end)}${live ? ` · ${minsLeft({ end }, at)} min left` : ''}</small>
          <span class="tile-bar"><i style="width:${p}%"></i></span>
          ${next ? `<small class="tile-next">Next · ${hm(next.at)} ${esc(next.t)}</small>` : ''}</span></button></li>`;
    }).join('') || '<li class="empty"><h3>Nothing on at this time</h3><p>Try another time, or All channels.</p></li>';
    if (rise && !reduce) [...$('#tiles').children].slice(0, 16).forEach((li, i) => li.animate([{ opacity: 0, transform: 'translateY(12px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 460, delay: i * 24, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
  }

  // ---------- reminders: kept on the device (and in your account, if signed in); 5 minutes before, an alert here and a
  // notification (if allowed). Add to Calendar works even with the page closed: an event with its own 5-minute alarm ----------
  const REM = 'tenner-tv-rem', GONE = 'tenner-tv-gone', FIRED = 'tenner-tv-fired';
  const remOf = (x) => ({ id: String(x.id), t: x.t, ch: x.ch, ep: epLine(x) || undefined, at: x.at, end: x.end, add: Date.now() });
  const rem = {
    all() { const l = store.get(REM, []), now = Date.now(); return Array.isArray(l) ? l.filter((r) => r?.id && r.end > now) : []; },
    has(id) { return rem.all().some((r) => r.id === String(id)); },
    add(x) { const r = remOf(x), g = store.get(GONE, {}); delete g[r.id]; store.set(GONE, g); store.set(REM, [...rem.all().filter((o) => o.id !== r.id), r].sort((a, b) => a.at - b.at)); remChanged(); },
    drop(id) { const g = store.get(GONE, {}); g[id] = Date.now(); store.set(GONE, g); store.set(REM, rem.all().filter((r) => r.id !== id)); remChanged(); },
  };
  function remChanged(quiet) {
    const l = rem.all(), ids = remIds = new Set(l.map((r) => r.id));
    $('#remN').hidden = !l.length; $('#remN').textContent = l.length;
    $('#remBtn').setAttribute('aria-label', l.length ? `Reminders: ${l.length}` : 'Reminders');
    for (const b of document.querySelectorAll('.blk[data-p]')) b.classList.toggle('rem', ids.has(b.dataset.p));
    if (remSheet.open) drawRems();
    if (!quiet) acct.soon();
  }
  async function toggleRem(x) {
    buzz(12);
    if (rem.has(x.id)) { rem.drop(String(x.id)); toast('Reminder removed'); return; }
    rem.add(x);
    if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch {} }
    const can = 'Notification' in window && Notification.permission === 'granted';
    toast(`<span><b>Reminder set</b> for ${esc(clock(x.at))} ${esc(onDay(x.at))}. ${can ? 'You’ll get a notification 5 minutes before.' : 'With Tenner TV open, you’ll get an alert 5 minutes before.'}</span><button type="button" class="toast-act" data-cal="${esc(x.id)}">Add to Calendar</button>`);
  }
  $('#toast').addEventListener('click', (e) => { const b = e.target.closest('[data-cal]'); if (!b) return; const r = rem.all().find((o) => o.id === b.dataset.cal); if (r) calendar([r]); $('#toast').classList.remove('in'); });
  // a calendar file: the programme as an event, with an alarm 5 minutes before. iPhone, iPad and Mac open it in Calendar
  const icsT = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const icsS = (v) => String(v || '').replace(/[\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  function calendar(list) {
    if (!list.length) return;
    const ev = list.map((r) => ['BEGIN:VEVENT', `UID:${r.id}@tv.tenner.stream`, `DTSTAMP:${icsT(Date.now())}`, `DTSTART:${icsT(r.at)}`, `DTEND:${icsT(r.end)}`,
      `SUMMARY:${icsS(`${r.t} (${r.ch})`)}`, r.ep ? `DESCRIPTION:${icsS(r.ep)}` : '', `LOCATION:${icsS(r.ch)}`, `URL:${location.origin}/?d=${ukDay(r.at)}&p=${encodeURIComponent(r.id)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsS(r.t)}`, 'TRIGGER:-PT5M', 'END:VALARM', 'END:VEVENT'].filter(Boolean).join('\r\n'));
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tenner//Tenner TV//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...ev, 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
    a.download = list.length === 1 ? `${list[0].t.replace(/[^\w\s-]/g, '').trim().slice(0, 40) || 'Programme'}.ics` : 'Tenner TV reminders.ics';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    buzz(); toast(list.length === 1 ? 'Opening in your calendar' : `${list.length} programmes going to your calendar`);
  }
  // when one comes round: a banner at the top, and a notification. Each reminder alerts once
  function checkRems() {
    const now = Date.now(), fired = store.get(FIRED, []);
    for (const r of rem.all()) {
      if (fired.includes(r.id) || r.at - 5 * 60e3 > now || now > r.at + 10 * 60e3) continue;
      fired.push(r.id); store.set(FIRED, fired.slice(-60)); alertRem(r);
    }
  }
  function alertRem(r) {
    const mins = Math.round((r.at - Date.now()) / 60e3), head = mins > 0 ? `Starting in ${mins} minute${mins === 1 ? '' : 's'}` : 'Starting now';
    const b = $('#banner'), live = LIVE[r.ch];
    b.innerHTML = `<span class="bn-ic">${BELL}</span><span class="bn-copy"><small>${esc(head)} · ${esc(r.ch)}</small><b>${esc(r.t)}</b></span>
      ${live ? `<a class="bn-act" href="${esc(live[1])}" target="_blank" rel="noopener">Watch live</a>` : ''}<button type="button" class="bn-x" aria-label="Close">${X}</button>`;
    b.classList.remove('in'); try { b.hidePopover(); b.showPopover(); } catch {} void b.offsetWidth; b.classList.add('in'); buzz([12, 60, 12]);
    b.querySelector('.bn-x').onclick = () => { b.classList.remove('in'); setTimeout(() => { try { b.hidePopover(); } catch {} }, reduce ? 0 : 300); };
    if ('Notification' in window && Notification.permission === 'granted') {
      const o = { body: `${head} on ${r.ch}`, tag: `rem-${r.id}`, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: `/?d=${ukDay(r.at)}&p=${encodeURIComponent(r.id)}` } };
      (navigator.serviceWorker?.ready || Promise.reject()).then((reg) => reg.showNotification(r.t, o)).catch(() => { try { new Notification(r.t, o); } catch {} });
    }
  }
  // the list of them
  const remSheet = $('#remSheet');
  function drawRems() {
    const l = rem.all(), by = new Map();
    for (const r of l) { const d = ukDay(r.at); if (!by.has(d)) by.set(d, []); by.get(d).push(r); }
    $('#remIn').innerHTML = `<div class="sh-grab" aria-hidden="true"></div><header class="sh-hd"><h2 id="remT">Reminders</h2><button type="button" class="sh-x" id="remX" aria-label="Close">${X}</button></header>
      ${l.length ? [...by].map(([d, rs]) => `<h3 class="list-h">${esc(d === today ? 'Today' : d === days[1] ? 'Tomorrow' : dayName(d, { weekday: 'long', day: 'numeric', month: 'long' }))}</h3>
        <ul class="list">${rs.map((r) => `<li><span class="li-row">${badge(r.ch)}<span class="fd-t"><b>${esc(r.t)}</b><small>${esc(`${hm(r.at)} · ${r.ch}${r.ep ? ` · ${r.ep}` : ''}`)}</small></span>
          <button type="button" class="li-x" data-drop="${esc(r.id)}" aria-label="${esc(`Remove the reminder for ${r.t}`)}">${X}</button></span></li>`).join('')}</ul>`).join('')
        + `<div class="sh-foot"><button type="button" class="act wide" id="remCal">${CAL}<span>Add all to Calendar</span></button></div>`
      : `<div class="none">${BELL_O}<h3>No reminders yet</h3><p>Tap any programme that’s still to come, then Remind me. You’ll get an alert 5 minutes before it starts.</p></div>`}
      <p class="sh-note sync-note">${acct.token() ? 'Kept in step with your Tenner account.' : '<button type="button" class="sh-link" data-acct>Sign in with Tenner</button> to keep reminders on all your devices.'}</p>`;
  }
  $('#remBtn').addEventListener('click', () => { closeAll(); drawRems(); remSheet.showModal(); $('#remX').focus({ preventScroll: true }); });
  remSheet.addEventListener('click', (e) => {
    if (e.target === remSheet || e.target.closest('#remX')) return remSheet.close();
    const d = e.target.closest('[data-drop]'); if (d) { const li = d.closest('li'); buzz(); const go = () => rem.drop(d.dataset.drop);
      if (reduce) go(); else li.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(24px)' }], { duration: 220, easing: 'ease-in' }).onfinish = go; }
    if (e.target.closest('#remCal')) calendar(rem.all());
  });

  // ---------- a channel's page: its whole week, day by day, in Tenner's list style (pin it to the top from here) ----------
  const chSheet = $('#chSheet');
  let chOpen = null;
  function openChannel(n) {
    closeAll(); chOpen = n;
    const pin = favs.all().includes(n), live = LIVE[n];
    $('#chIn').innerHTML = `<div class="sh-grab" aria-hidden="true"></div><header class="sh-hd chs-hd">${badge(n)}<span><h2 id="chT">${esc(n)}</h2><small>The week ahead</small></span><button type="button" class="sh-x" id="chX" aria-label="Close">${X}</button></header>
      <div class="sh-acts chs-acts"><button type="button" class="act${pin ? ' on' : ''}" id="chPin" aria-pressed="${pin}">${star(pin)}<span>${pin ? 'Pinned to the top' : 'Pin to the top'}</span></button>
        ${live ? `<a class="live-btn" href="${esc(live[1])}" target="_blank" rel="noopener"><i aria-hidden="true"></i>Watch live on ${esc(live[0])}</a>` : ''}</div>
      <div id="chDays"></div>`;
    drawChannel();
    chSheet.showModal(); $('#chX').focus({ preventScroll: true });
    wholeWeek(chMore);
  }
  const chMore = () => { if (chSheet.open) drawChannel(); };
  function drawChannel() {
    const n = chOpen, now = Date.now(), box = $('#chDays'); if (!box) return;
    const keep = $('#chIn').scrollTop;
    box.innerHTML = days.map((d) => {
      const day = state.loaded.get(d) || extra.get(d)?.done;
      const head = `<h3 class="list-h">${esc(d === today ? 'Today' : d === days[1] ? 'Tomorrow' : dayName(d, { weekday: 'long', day: 'numeric', month: 'long' }))}</h3>`;
      if (!day) return extra.has(d) ? `${head}<div class="skel sm" aria-hidden="true"><i></i><i></i><i></i></div>` : '';
      const items = day.channels.find((c) => c.name === n)?.items || [];
      const rows = items.map((x, j) => ({ x, next: items[j + 1], end: ends(x, items[j + 1]) })).filter((o) => o.end > now);
      if (!rows.length) return '';
      return `${head}<ul class="list">${rows.map(({ x, next, end }) => { const on = x.at <= now; return `<li><button type="button" class="li-row prog${on ? ' live' : ''}" ${reg(x, n, next)}>
        <time>${on ? '<i class="now">Now</i>' : hm(x.at)}</time><span class="fd-t"><b>${x.isNew ? '<i class="new">New</i>' : ''}${esc(x.t)}</b><small>${esc(epLine(x) || x.sum || length(end - x.at))}</small>
        ${on ? `<span class="tile-bar"><i style="width:${Math.round(((now - x.at) / (end - x.at)) * 100)}%"></i></span>` : ''}</span>${rem.has(x.id) ? `<span class="li-bell" aria-label="Reminder on">${BELL}</span>` : ''}</button></li>`; }).join('')}</ul>`;
    }).join('') || '<div class="none"><h3>Nothing listed</h3><p>This channel has nothing coming up in the listings yet.</p></div>';
    $('#chIn').scrollTop = keep;
  }
  chSheet.addEventListener('click', (e) => {
    if (e.target === chSheet || e.target.closest('#chX')) return chSheet.close();
    const p = e.target.closest('#chPin'); if (!p) return;
    const on = togglePin(chOpen); p.classList.toggle('on', on); p.setAttribute('aria-pressed', on); p.innerHTML = `${star(on)}<span>${on ? 'Pinned to the top' : 'Pin to the top'}</span>`;
    if (!reduce) p.firstElementChild.animate([{ transform: 'scale(.6)' }, { transform: 'scale(1.25)' }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
    toast(on ? `${esc(chOpen)} is pinned to the top of the guide` : `${esc(chOpen)} is back in its usual place`);
  });
  // every sheet: a swipe down closes it on phones (the programme sheet has its own, gentler close)
  for (const dlg of [chSheet, remSheet, $('#acSheet')]) {
    let y0 = null;
    dlg.addEventListener('touchstart', (e) => { y0 = dlg.firstElementChild.scrollTop <= 0 && e.touches.length === 1 && !e.target.closest('a, button') ? e.touches[0].clientY : null; }, { passive: true });
    dlg.addEventListener('touchend', (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 110) dlg.close(); y0 = null; });
  }

  // ---------- share a programme: the share sheet (or the link copied), opening that programme's sheet here ----------
  async function share(x) {
    const url = `${location.origin}/?d=${ukDay(x.at)}&p=${encodeURIComponent(x.id)}`, text = `${x.t}: ${x.ch}, ${dayName(ukDay(x.at), { weekday: 'long' })} at ${hm(x.at)}`;
    if (navigator.share) { try { await navigator.share({ title: x.t, text, url }); } catch {} return; }
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(esc(url)); }
  }

  // ---------- accounts: sign in with your Tenner account (on tenner.stream, which hands this page a session of its own),
  // and your reminders and pinned channels are kept in step on every device; your Watchlist's titles show up here when
  // they're on TV (worker/src/auth.js: /me/handoff, /me/data) ----------
  const SESS = 'tenner-tv-session', ACU = 'tenner-tv-user', AWL = 'tenner-tv-wl';
  let acctT = 0, syncing = null;
  const acct = {
    token: () => store.get(SESS, null),
    user: () => store.get(ACU, null),
    watchlist: () => (acct.token() ? store.get(AWL, []) : []),
    async call(method, path, body) {
      const t = acct.token();
      const r = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 && t) acct.forget();
      if (!r.ok) throw new Error(d.error || 'Something went wrong');
      return d;
    },
    local: () => ({ tv: { pins: favs.all(), pat: store.get('tenner-tv-pat', 0), rem: rem.all(), gone: store.get(GONE, {}) } }),
    sync() {
      if (!acct.token()) return Promise.resolve(null);
      return (syncing ||= acct.call('PUT', '/me/data', { data: acct.local() }).then(({ data }) => acct.apply(data)).catch(() => null).finally(() => { syncing = null; }));
    },
    apply(d) {
      if (!d) return;
      if (d.tv) {
        if ((d.tv.pat || 0) >= store.get('tenner-tv-pat', 0)) { favs.set(d.tv.pins || [], true); store.set('tenner-tv-pat', d.tv.pat || 0); }
        store.set(REM, d.tv.rem || []); store.set(GONE, d.tv.gone || {});
      }
      store.set(AWL, (d.watchlist || []).map((w) => ({ title: w.title, type: w.type })).filter((w) => w.title).slice(0, 500));
      if (state.data) { drawCats(); arrange(); if (view === 'now') drawOnNow(); }
      remChanged(true); drawShelves();
    },
    soon() { if (!acct.token()) return; clearTimeout(acctT); acctT = setTimeout(acct.sync, 1200); },
    forget() { [SESS, ACU, AWL].forEach((k) => store.set(k, null)); drawAcct(); drawShelves(); },
  };
  const avatar = (u) => (u?.picture ? `<img class="av" src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="av" style="--h:${u ? +u.hue || 210 : 210}" aria-hidden="true">${u ? esc((u.name || '?').trim()[0]?.toUpperCase() || '?') : '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="4" fill="currentColor"/><path d="M4.5 20c1-4 4-6 7.5-6s6.5 2 7.5 6z" fill="currentColor"/></svg>'}</span>`);
  function drawAcct() {
    const u = acct.token() ? acct.user() : null;
    $('#acctSide').innerHTML = `${avatar(u)}<span><b>${u ? esc(u.name || 'You') : 'Sign in'}</b><small>${u ? 'Your account' : 'Sync your reminders'}</small></span>`;
    $('#acctBar').innerHTML = avatar(u); $('#acctBar').setAttribute('aria-label', u ? `Your account: ${u.name || 'signed in'}` : 'Sign in');
  }
  const acSheet = $('#acSheet');
  function openAcct() {
    closeAll();
    const u = acct.token() ? acct.user() : null, n = rem.all().length, w = acct.watchlist().length;
    $('#acIn').innerHTML = `<div class="sh-grab" aria-hidden="true"></div><button type="button" class="sh-x" id="acX" aria-label="Close">${X}</button>
      <div class="ac-top">${avatar(u)}<h2 id="acT">${u ? esc(u.name || 'Your account') : 'Your Tenner account'}</h2>
      <p>${u ? 'You’re signed in. Your reminders and pinned channels are kept in step on every device you use.' : 'Sign in with the account you use on tenner.stream to keep your reminders and pinned channels on all your devices, and to see when the titles on your Watchlist are on TV.'}</p></div>
      ${u ? `<ul class="list ac-list"><li><span class="li-row"><span class="tile-ic">${BELL}</span><span class="fd-t"><b>Reminders</b><small>${n ? `${n} coming up` : 'None yet'}</small></span></span></li>
        <li><span class="li-row"><span class="tile-ic star">${star(true)}</span><span class="fd-t"><b>Pinned channels</b><small>${favs.all().length || 'None yet'}</small></span></span></li>
        <li><span class="li-row"><span class="tile-ic wl"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11v17L12 16.6 6.5 20.5z" fill="currentColor"/></svg></span><span class="fd-t"><b>Your Watchlist</b><small>${w ? `${w} title${w === 1 ? '' : 's'}, shown here when they’re on TV` : 'Add titles on tenner.stream'}</small></span></span></li></ul>
        <div class="ac-acts"><a class="act" href="https://tenner.stream/account.html">Manage account</a><button type="button" class="act" id="acOut">Sign out</button></div>`
      : `<div class="ac-acts"><a class="act primary" href="https://tenner.stream/account.html?to=tv">Sign in with Tenner</a></div><p class="sh-note">Don’t have one? You can make one there in a moment. It’s free, and Tenner TV works just the same without.</p>`}`;
    acSheet.showModal(); $('#acX').focus({ preventScroll: true });
  }
  for (const b of ['#acctSide', '#acctBar']) $(b).addEventListener('click', openAcct);
  document.addEventListener('click', (e) => { if (e.target.closest('[data-acct]')) openAcct(); });
  acSheet.addEventListener('click', async (e) => {
    if (e.target === acSheet || e.target.closest('#acX')) return acSheet.close();
    if (e.target.closest('#acOut')) { try { await acct.call('POST', '/auth/logout'); } catch {} acct.forget(); acSheet.close(); toast('Signed out. Your reminders stay on this device'); }
  });
  // arriving from tenner.stream with a session (#signin=…): kept, the address tidied, then your things merged in
  (async () => {
    const m = location.hash.match(/^#signin=([\w-]{20,80})$/);
    if (m) {
      history.replaceState(null, '', location.pathname + location.search); store.set(SESS, m[1]);
      try { const me = await acct.call('GET', '/me'); store.set(ACU, me.user); drawAcct(); await acct.sync(); toast(`<b>Signed in</b> as ${esc(me.user?.name || 'you')}. Your reminders and pins are in step`); }
      catch { acct.forget(); toast('That sign-in didn’t work. Please try again'); }
    } else if (acct.token()) acct.sync();
  })();
  drawAcct(); remChanged(true); checkRems();
  // the selectors' thumbs: placed once the type has loaded, and again when the window changes size
  const thumbs = () => { thumb($('#view'), '[aria-selected="true"]'); thumb($('#days'), '[aria-current]'); };
  thumbs(); document.fonts?.ready.then(thumbs); addEventListener('resize', () => requestAnimationFrame(thumbs));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { acct.sync(); checkRems(); } });

  // ---------- start, and keep "now" moving ----------
  // the days the Freeview listings cover (a week or so); the strips run through all of them
  (early?.meta || fetch('/data/meta.json').then((r) => (r.ok ? r.json() : null))).then((m) => {
    const have = (m?.days || []).filter((d) => /^\d{4}-\d\d-\d\d$/.test(d) && d >= today);
    if (have.length >= 5) { days = have; if (!days.includes(state.base)) state.base = today; drawDays(); }
  }).catch(() => {}).finally(load);
  // every minute: today's programmes move on (live, past, minutes left); past midnight, a new day
  setInterval(() => {
    if (ukDay() !== today) { location.reload(); return; }
    checkRems();
    if (view === 'now' && !document.hidden) drawOnNow();
    if (!state.loaded.has(today) || document.hidden) return;
    const now = Date.now();
    for (const b of $('#epg').querySelectorAll(`.blk[data-day="${today}"]`)) {
      const x = shown.get(b.dataset.p); if (!x) continue;
      const live = isLive(x, now), small = b.querySelector('small');
      b.classList.toggle('live', live); b.classList.toggle('past', x.end <= now);
      if (live) { b.style.setProperty('--p', `${Math.round(((now - x.at) / (x.end - x.at)) * 100)}%`); small.textContent = `Now · ${minsLeft(x, now)} min left`; }
      else if (small.textContent.startsWith('Now')) small.textContent = hm(x.at);
    }
  }, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ukDay() !== today) location.reload(); });
  // ---------- weather warnings: when the Met Office has one, a box in the top right says so (bad weather can knock a
  // dish or an aerial out, and live TV can still be watched online). It glides in, flashes red twice and stays until
  // closed; a closed warning stays closed, a new one shows again. Checked every quarter of an hour. ----------
  const WX = 'tv-wx-closed', LV = { red: 'Red', amber: 'Amber', yellow: 'Yellow' };
  const closedWx = { all() { try { const l = JSON.parse(localStorage.getItem(WX) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } },
    add(ids) { try { localStorage.setItem(WX, JSON.stringify([...new Set([...this.all(), ...ids])].slice(-40))); } catch {} } };
  const wxKey = (w) => `${w.id}|${w.level}|${w.to || ''}`;   // a warning raised to amber, or extended, shows again
  const TIPS = {
    wind: 'Strong wind can knock a satellite dish or an aerial out of line, so the picture may freeze or break up.',
    rain: 'Heavy rain can weaken a satellite signal, so the picture may freeze or break up.',
    thunderstorm: 'Thunderstorms can interrupt satellite and aerial signals, and lightning can cut the power.',
    snow: 'Snow building up on a satellite dish can block its signal.',
    ice: 'Ice on a satellite dish can block its signal.',
  };
  const tip = (type) => Object.entries(TIPS).find(([k]) => type.includes(k))?.[1] || 'Bad weather can interrupt satellite and aerial signals.';
  const clock = (t) => { const [h, m] = hm(t).split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`; };
  const onDay = (t) => { const d = ukDay(t); return d === ukDay() ? 'today' : d === ukDay(Date.now() + 864e5) ? 'tomorrow' : dayName(d, { weekday: 'short' }); };
  const when = (w, now = Date.now()) => {
    const to = w.to ? `${clock(w.to)} ${onDay(w.to)}` : '';
    if (!w.from || w.from <= now) return to ? `In force until ${to}` : 'In force now';
    const from = `${clock(w.from)} ${onDay(w.from)}`;
    return `From ${from}${to ? ` until ${w.to && ukDay(w.to) === ukDay(w.from) ? clock(w.to) : to}` : ''}`;
  };
  const tri = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.9 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" fill="currentColor"/><path d="M12 9v4.6" stroke="#000" stroke-opacity=".78" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.25" fill="#000" fill-opacity=".78"/></svg>';
  let wxShown = '';
  function drawWx(list) {
    const box = $('#wx'), gone = new Set(closedWx.all()), open = list.filter((w) => !gone.has(wxKey(w)));
    const sig = open.map(wxKey).join(',');
    if (!open.length) { box.hidden = true; wxShown = ''; return; }
    if (sig === wxShown) return;   // the same warnings: leave the box be
    const w = open[0], more = open.slice(1), now = Date.now();
    box.dataset.level = w.level;
    box.innerHTML = `<div class="wx-ic">${tri}</div>
      <div class="wx-copy">
        <p class="wx-k">Weather alert · Met Office</p>
        <h2 id="wxT">${esc(LV[w.level] || '')} warning of ${esc(w.type)}</h2>
        <p class="wx-where">${esc([w.where, w.areas].filter(Boolean).join(': '))}</p>
        <p class="wx-when">${esc(when(w, now))}</p>
        <p class="wx-tip">${esc(tip(w.type))} If it does, tap <b>Watch live</b> to watch online.</p>
        ${more.length ? `<ul class="wx-more">${more.slice(0, 2).map((x) => `<li><i data-level="${esc(x.level)}"></i>${esc(LV[x.level] || '')} warning of ${esc(x.type)}${x.where ? ` · ${esc(x.where)}` : ''}</li>`).join('')}${more.length > 2 ? `<li class="wx-n">and ${more.length - 2} more</li>` : ''}</ul>` : ''}
        <a class="wx-go" href="${esc(w.link)}" target="_blank" rel="noopener">Full warning at the Met Office<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
      </div>
      <button type="button" class="wx-x" aria-label="Close the weather alert"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>`;
    box.setAttribute('role', 'alert');
    box.hidden = false; box.parentElement.style.setProperty('--wxh', `${box.offsetHeight}px`); box.classList.remove('wx-out', 'wx-in'); void box.offsetWidth; box.classList.add('wx-in');   // glides in, then the two red flashes (tv.css)
    box.querySelector('.wx-x').onclick = () => {
      closedWx.add(open.map(wxKey)); wxShown = '';
      if (reduce) { box.hidden = true; return; }
      box.classList.add('wx-out'); box.addEventListener('animationend', () => { box.hidden = true; }, { once: true });
    };
    wxShown = sig;
  }
  const checkWx = () => fetch('/api/warnings').then((r) => (r.ok ? r.json() : null)).then((d) => { if (Array.isArray(d?.warnings)) drawWx(d.warnings.filter((w) => !w.to || w.to > Date.now())); }).catch(() => {});
  checkWx(); setInterval(() => { if (!document.hidden) checkWx(); }, 15 * 60e3);

  // kept on the device: opens instantly, and works with a weak signal or none (sw.js)
  if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
})();

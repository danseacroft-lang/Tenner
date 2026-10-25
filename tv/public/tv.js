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
  const mouse = matchMedia('(hover: hover) and (pointer: fine)');

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
  // base: the first day in the strips; loaded: every day fetched, in order; day: the one in view
  const state = { base: days.includes(q) ? q : today, day: null, data: null, loaded: new Map(), loading: null, failedAt: 0 };
  const label = (d) => (d === today ? 'Tonight' : d === days[1] ? 'Tomorrow' : dayName(d, { weekday: 'short', day: 'numeric' }));
  const word = (d) => (d === today ? 'tonight' : d === days[1] ? 'tomorrow' : dayName(d, { weekday: 'long' }));

  // ---------- the days ----------
  const drawDays = () => { $('#days').innerHTML = days.map((d) => `<button type="button" data-d="${d}"${d === state.day ? ' aria-current="date"' : ''}>${esc(label(d))}</button>`).join(''); };
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
  const fetchDay = (d, signal) => fetch(`/api/day?d=${d}`, { signal }).then(async (r) => {
    const j = await r.json().catch(() => ({})); if (!r.ok || !Array.isArray(j.channels)) throw new Error(j.error || `HTTP ${r.status}`); return j;
  });
  async function load() {
    $('#epg').innerHTML = '<div class="skel" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>';
    ctl?.abort(); ctl = new AbortController(); state.day = null; state.loading = null; state.failedAt = 0;
    try {
      const d = await fetchDay(state.base, ctl.signal);
      state.data = d; state.loaded = new Map([[state.base, d]]); shown.clear();
      setDay(state.base); drawCats(); drawGuide();
      loadNext();   // the next day ready before anyone scrolls to it
    } catch (err) {
      if (err.name === 'AbortError') return;
      $('#picksSec').hidden = true;
      $('#epg').innerHTML = '<div class="empty"><h3>The listings didn’t load</h3><p>Check your connection, then <button type="button" class="retry" id="retry">try again</button>.</p></div>';
      $('#retry').addEventListener('click', load);
      preview(null);
    }
  }
  // the next day, added to the end of every strip: one at a time, nothing past the last day, and after a failure a
  // calm wait of 20 seconds before trying again (never a fetch per scroll event)
  function loadNext() {
    if (state.loading) return state.loading;
    if (Date.now() - state.failedAt < 20e3) return Promise.resolve(false);
    const last = [...state.loaded.keys()].at(-1), next = days[days.indexOf(last) + 1];
    if (!next || !state.data) return Promise.resolve(false);
    state.loading = fetchDay(next).then((d) => { if (!state.loaded.has(next)) { state.loaded.set(next, d); appendDay(next, d); } return true; })
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
    // the pill into view along its own row only (never scrolling the page away from the guide)
    const row = $('#days'), pill = $(`#days [data-d="${d}"]`);
    if (pill && row.scrollWidth > row.clientWidth) {
      const l = pill.offsetLeft, pad = 24;
      if (l < row.scrollLeft + pad || l + pill.offsetWidth > row.scrollLeft + row.clientWidth - pad) row.scrollTo({ left: Math.max(0, l - pad), behavior: reduce ? 'auto' : 'smooth' });
    }
    const u = new URL(location.href); d === today ? u.searchParams.delete('d') : u.searchParams.set('d', d); history.replaceState(null, '', u);
    if (!reduce && state.data) $(`#days [data-d="${d}"]`)?.animate([{ transform: 'scale(.9)' }, { transform: 'scale(1.06)', offset: .45 }, { transform: 'scale(.99)', offset: .75 }, { transform: 'none' }], { duration: 520, easing: 'ease-out' });
    $('#eye').textContent = dayName(d, { weekday: 'long', day: 'numeric', month: 'long' });
    $('#h1').innerHTML = `What’s on <br class="ph-br"><em class="grad">${esc(word(d))}</em>.`;   // phones: the day on its own line, so the headline never changes height
    document.title = `What’s on UK TV ${word(d)} · Tenner TV`;
    $('#toNow').textContent = state.loaded.has(today) ? 'Now' : 'This evening';
    drawPicks(d);
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
  const FAV = 'tenner-tv-fav';
  const favs = {
    all() { try { const l = JSON.parse(localStorage.getItem(FAV) || '[]'); return Array.isArray(l) ? l.filter((x) => typeof x === 'string') : []; } catch { return []; } },
    set(l) { try { localStorage.setItem(FAV, JSON.stringify(l)); } catch {} },
  };
  let cat = 'all';
  function drawCats() {
    const names = state.data.channels.map((c) => c.name), mine = favs.all();
    const live = CATS.filter(([k, , re]) => k === 'all' || (k === 'mine' ? mine.some((n) => names.includes(n)) : names.some((n) => re.test(n))));
    if (!live.some(([k]) => k === cat)) cat = 'all';
    $('#cats').innerHTML = live.length > 2 ? live.map(([k, l]) => `<button type="button" role="radio" data-cat="${k}" aria-checked="${k === cat}" tabindex="${k === cat ? 0 : -1}">${esc(l)}</button>`).join('') : '';
  }
  $('#cats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b || b.dataset.cat === cat) return; cat = b.dataset.cat; drawCats(); arrange(true); $(`[data-cat="${cat}"]`)?.focus({ preventScroll: true }); });
  $('#cats').addEventListener('keydown', (e) => {   // a radio group: the arrows move between categories
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault();
    const l = [...$('#cats').children], i = l.findIndex((b) => b.dataset.cat === cat), n = l[(i + (e.key === 'ArrowRight' ? 1 : -1) + l.length) % l.length]; n?.click();
  });
  const star = (on) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.5l-5.1 2.7 1-5.6-4.1-4 5.7-.8z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>`;
  $('#epg').addEventListener('click', (e) => {
    const b = e.target.closest('.ch[data-ch]'); if (!b) return;
    const n = b.dataset.ch, l = favs.all(), on = !l.includes(n);
    favs.set(on ? [...l, n] : l.filter((x) => x !== n));
    // the rows on screen glide from where they were to where they are now (only those: it's instant, whatever the size)
    const before = new Map(), vh = innerHeight;
    if (!reduce) for (const r of $('#epg').querySelectorAll('.crow')) { const t = r.getBoundingClientRect().top; if (t > -200 && t < vh + 200) before.set(r.firstElementChild.dataset.ch, t); }
    drawCats(); arrange();
    if (before.size) for (const r of $('#epg').querySelectorAll('.crow')) {
      if (r.hidden) continue;
      const n = r.firstElementChild.dataset.ch, t = r.getBoundingClientRect().top; if (t < -200 || t > vh + 200) continue;
      const was = before.get(n), dy = was == null ? null : was - t;
      if (dy) r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.3,1.25,.4,1)' });
      else if (dy == null) r.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    }
    $(`.ch[data-ch="${CSS.escape(n)}"]`)?.focus({ preventScroll: true });
  });

  // ---------- the guide ----------
  const px = () => parseFloat(getComputedStyle($('#epg')).getPropertyValue('--px')) || 5;   // a minute's width
  // every channel is drawn once, when a day's listings arrive; a category or a pin only shows, hides and reorders the
  // rows (CSS order: nothing is rebuilt or moved, so each row keeps its place in the week, and it's instant)
  function drawGuide() {
    if (!state.data) return;
    const chans = state.data.channels.filter((c) => c.items.length);
    if (!chans.length) { $('#epg').innerHTML = '<div class="empty"><h3>Nothing listed yet</h3><p>Listings for this day haven’t been published. Try a nearer day.</p></div>'; preview(null); return; }
    const now = Date.now(), m = px(), loaded = [...state.loaded];
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
        ch.setAttribute('aria-label', `${n}: ${pin ? 'pinned to the top. Press to unpin' : 'press to pin to the top'}. Arrow right for its programmes`);
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
  function dayBlocks(name, d, day, mark, now, m) {
    const items = day.channels.find((c) => c.name === name)?.items || [], dn = dayName(d, { weekday: 'long' });
    return (mark ? `<span class="daymark" aria-hidden="true"><b>${esc(dayName(d, { weekday: 'short' }))}</b>${esc(dayName(d, { day: 'numeric', month: 'short' }))}</span>` : '')
      + items.map((x, j) => {
        const end = ends(x, items[j + 1]), live = x.at <= now && now < end, past = end <= now, t = hm(x.at);
        const p = live ? Math.round(((now - x.at) / (end - x.at)) * 100) : 0;
        return `<button type="button" tabindex="-1" class="blk${live ? ' live' : past ? ' past' : ''}" style="width:${Math.max(150, Math.round(((end - x.at) / 60e3) * m))}px${live ? `;--p:${p}%` : ''}" ${reg(x, name, items[j + 1])} data-day="${d}"
          aria-label="${esc(`${name}, ${dn} ${t}: ${x.t}${x.isNew ? ', new' : ''}`)}"><span class="bi"><b>${x.isNew ? '<i class="new">New</i>' : ''}${esc(x.t)}</b><small>${live ? `Now · ${Math.max(1, Math.round((end - now) / 60e3))} min left` : t}</small></span></button>`;
      }).join('');
  }
  // a newly fetched day, added to the end of every strip without moving anything: at once in the strip being scrolled,
  // the others a few at a time in quiet moments (or the moment one comes near, or a glide needs it), so a new day never
  // stalls a frame
  const idle = window.requestIdleCallback || ((f) => setTimeout(() => f({ timeRemaining: () => 8 }), 50));
  function fill(st) {
    if (!st._pend?.length) return;
    const now = Date.now(), m = px();
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
  // where a strip goes for day d: what's on now (today), or the programme on at 7pm
  function targetOf(st, d) {
    const at = d === today ? Date.now() : null, l = blocksOf(st); if (!l.length) return null;
    const pick = l.find(({ b }) => { const x = shown.get(b.dataset.p); return x && (at ? isLive(x, at) : b.dataset.day === d && (hour(x.at) >= 19 || hour(x.end) > 19)); })
      || (at ? l.find(({ b }) => (shown.get(b.dataset.p)?.at || 0) > at) : l.find(({ b }) => b.dataset.day === d)) || l[0];
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
  $('#toNow').addEventListener('click', () => goDay(state.loaded.has(today) ? today : state.base));

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
  const over = (e) => { const b = e.target.closest?.('.blk, .pick'); if (b) preview(shown.get(b.dataset.p)); };
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
    const picks = list.sort((a, b) => b.score - a.score).filter(({ x }) => !seen.has(x.show || x.t) && seen.add(x.show || x.t)).slice(0, 10).sort((a, b) => a.x.at - b.x.at);
    $('#picksSec').hidden = picks.length < 3;
    $('#picksH').textContent = d === today ? 'Tonight’s picks' : d === days[1] ? 'Tomorrow’s picks' : `${dayName(d, { weekday: 'long' })}’s picks`;
    $('#picks').innerHTML = picks.map(({ x, c, next }) => `<li><button type="button" class="pick" ${reg(x, c, next)}>
      <span class="pick-art">${art(x)}<span class="chip">${hm(x.at)} · ${esc(c)}</span></span>
      <b>${esc(x.t)}</b><small>${esc(epLine(x) || (x.g || []).join(', ') || c)}</small></button></li>`).join('');
  }

  // ---------- the sheet: what a programme's about. Esc, ×, a tap outside or (on phones) a swipe down closes it ----------
  const sheet = $('#sheet'), shIn = $('#shIn');
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]'); if (!b || sheet.contains(b)) return;
    const x = shown.get(b.dataset.p); if (!x) return;
    preview(x, true);
    const when = `${esc(x.ch)} · ${esc(dayName(ukDay(x.at), { weekday: 'long', day: 'numeric', month: 'long' }))} · ${hm(x.at)}–${hm(x.end)} · ${length(x.end - x.at)}`;
    shIn.innerHTML = `<div class="sh-grab" aria-hidden="true"></div><div class="sh-art${!x.wide && x.poster ? ' sh-poster' : ''}">${x.wide || x.poster ? art(x) : ''}
        <button type="button" class="sh-x" id="shX" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></div>
      <div class="sh-body"><p class="sh-when">${when}</p>
        <h2 id="shT">${x.isNew ? '<i class="new">New</i>' : ''}${esc(x.t)}</h2>${epLine(x) ? `<p class="sh-ep">${esc(epLine(x))}</p>` : ''}
        ${x.sum ? `<p class="sh-sum">${esc(x.sum)}</p>` : '<p class="sh-sum sh-none">No description yet.</p>'}
        ${x.g?.length ? `<ul class="sh-tags">${x.g.map((g) => `<li>${esc(g)}</li>`).join('')}${x.r ? `<li>★ ${x.r.toFixed(1)}</li>` : ''}</ul>` : ''}
        <div class="sh-acts">${liveBtn(x)}${x.url ? `<a class="sh-link" href="${esc(x.url)}" target="_blank" rel="noopener">More on TVmaze</a>` : ''}</div>
        ${liveBtn(x) ? '<p class="sh-note">Opens the channel’s own player. You need a TV licence to watch live TV in the UK.</p>' : ''}</div>`;
    shIn.scrollTop = 0; sheet.style.removeProperty('transform');
    if (!sheet.open) sheet.showModal();
    $('#shX').focus({ preventScroll: true });
  });
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

  // ---------- start, and keep "now" moving ----------
  // the days the Freeview listings cover (a week or so); the strips run through all of them
  fetch('/data/meta.json').then((r) => (r.ok ? r.json() : null)).then((m) => {
    const have = (m?.days || []).filter((d) => /^\d{4}-\d\d-\d\d$/.test(d) && d >= today);
    if (have.length >= 5) { days = have; if (!days.includes(state.base)) state.base = today; drawDays(); }
  }).catch(() => {}).finally(load);
  // every minute: today's programmes move on (live, past, minutes left); past midnight, a new day
  setInterval(() => {
    if (ukDay() !== today) { location.reload(); return; }
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
})();

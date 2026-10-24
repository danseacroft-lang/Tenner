// Tenner TV: a day of UK TV from /api/day (TVmaze, trimmed by the Worker), as a TV guide: a preview of whatever you
// point at, then every channel against the clock (the day scrolls sideways, a line marks now), then tonight's picks.
// Any programme opens a sheet with what it's about.
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const TZ = 'Europe/London';
  const ukDay = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
  const hm = (t) => new Date(t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const hour = (t) => { const [h, m] = hm(t).split(':').map(Number); return h + m / 60; };
  const dayName = (d, o) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', o);
  const ends = (x, next) => x.at + (x.rt ? x.rt * 60e3 : next ? next.at - x.at : 30 * 60e3);
  const length = (ms) => { const m = Math.round(ms / 60e3); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`; };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const today = ukDay(), days = Array.from({ length: 8 }, (_, i) => ukDay(Date.now() + i * 864e5));   // tonight and a week ahead
  const q = new URLSearchParams(location.search).get('d');
  // base: the first day shown; loaded: every day fetched so far, in order (the strips run on through them); day: the one in view
  const state = { base: days.includes(q) ? q : today, day: null, data: null, loaded: new Map(), loading: null };
  const label = (d) => (d === today ? 'Tonight' : d === days[1] ? 'Tomorrow' : dayName(d, { weekday: 'short', day: 'numeric' }));
  const word = (d) => (d === today ? 'tonight' : d === days[1] ? 'tomorrow' : dayName(d, { weekday: 'long' }));

  // ---------- the days ----------
  $('#days').innerHTML = days.map((d) => `<button type="button" data-d="${d}">${esc(label(d))}</button>`).join('');
  $('#days').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b) goDay(b.dataset.d); });

  const shown = new Map();   // every drawn programme, by id: for the preview and the sheet
  const reg = (x, ch, next) => { shown.set(String(x.id), { ...x, ch, end: ends(x, next) }); return `data-p="${x.id}"`; };
  const epLine = (x) => [x.s && x.n ? `Series ${x.s}, episode ${x.n}` : x.n ? `Episode ${x.n}` : '', x.ep].filter(Boolean).join(' · ');
  const art = (x) => (x.wide ? `<img src="${esc(x.wide)}" alt="" loading="lazy" decoding="async">`
    : x.poster ? `<img class="bed" src="${esc(x.poster)}" alt="" loading="lazy" decoding="async"><img class="pst" src="${esc(x.poster)}" alt="" loading="lazy" decoding="async">`
    : `<span class="ph" style="background:linear-gradient(150deg,hsl(${hue(x.t)} 45% 40%),hsl(${(hue(x.t) + 50) % 360} 55% 18%))">${esc(x.t)}</span>`);
  const logo = (name) => state.data?.logos?.[name];
  // a channel's badge: its logo in a small tile, or its initials (BBC One → B1, Channel 4 → C4) when there's no logo yet
  const initials = (n) => {
    if (/^\S{1,4}$/.test(n)) return n.toUpperCase();          // ITV1, E4, W, Dave
    if (/^\d/.test(n)) return n.slice(0, 2).toUpperCase();    // 5Star → 5S
    const w = n.replace(/\b(One|Two|Three|Four)\b/, (x) => ({ One: '1', Two: '2', Three: '3', Four: '4' }[x])).split(/\s+/), d = w.join(' ').match(/\d+$/);
    return (d ? w[0][0] + d[0] : w.map((x) => x[0]).join('').slice(0, 3)).toUpperCase();   // BBC One → B1, More4 → M4, Sky Atlantic → SA
  };
  const badge = (n) => (logo(n) ? `<span class="ch-badge"><img src="${esc(logo(n))}" alt="" decoding="async"></span>`
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
  const liveBtn = (x) => { const l = LIVE[x.ch]; if (!l || !(x.at <= Date.now() && Date.now() < x.end)) return '';
    return `<a class="live-btn" href="${esc(l[1])}" target="_blank" rel="noopener"><i aria-hidden="true"></i>Watch live on ${esc(l[0])}</a>`; };

  // ---------- loading: the first day, then each next one as the strips get near their end ----------
  let ctl = null;
  const fetchDay = (d, signal) => fetch(`/api/day?d=${d}`, { signal }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; });
  async function load() {
    $('#epg').innerHTML = '<div class="skel" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>';
    ctl?.abort(); ctl = new AbortController(); state.day = null;
    try {
      const d = await fetchDay(state.base, ctl.signal);
      state.data = d; state.loaded = new Map([[state.base, d]]); shown.clear(); kept.clear();
      setDay(state.base); drawCats(); drawGuide();
      loadNext();   // the next day ready before anyone scrolls to it
    } catch (err) {
      if (err.name === 'AbortError') return;
      $('#picksSec').hidden = true;
      $('#epg').innerHTML = '<div class="empty"><h3>The listings didn’t load</h3><p>Check your connection, then try again in a moment.</p></div>';
      preview(null);
    }
  }
  // the next day, added to the end of every strip (once at a time; nothing past a week ahead)
  function loadNext() {
    if (state.loading) return state.loading;
    const last = [...state.loaded.keys()].at(-1), next = days[days.indexOf(last) + 1];
    if (!next) return Promise.resolve(false);
    state.loading = fetchDay(next).then((d) => { state.loaded.set(next, d); appendDay(next, d); return true; })
      .catch(() => false).finally(() => { state.loading = null; });
    return state.loading;
  }
  // a day pill: scroll every strip to that day (fetching up to it first); a day before the first one starts afresh
  async function goDay(d) {
    if (!state.loaded.size || d < state.base) { state.base = d; return load(); }
    while (!state.loaded.has(d)) if (!(await loadNext())) return;
    kept.clear(); document.querySelectorAll('.strip').forEach((st) => jumpStrip(st, true, d)); setDay(d);
  }
  // the day in view: the pills, the headline, the address and the picks follow it
  function setDay(d) {
    if (!d || d === state.day) return; state.day = d;
    document.querySelectorAll('#days button').forEach((b) => (b.dataset.d === d ? b.setAttribute('aria-current', 'date') : b.removeAttribute('aria-current')));
    const u = new URL(location.href); d === today ? u.searchParams.delete('d') : u.searchParams.set('d', d); history.replaceState(null, '', u);
    $('#eye').textContent = dayName(d, { weekday: 'long', day: 'numeric', month: 'long' });
    $('#h1').innerHTML = `What’s on <em class="grad">${esc(word(d))}</em>.`;
    document.title = `What’s on UK TV ${word(d)} · Tenner TV`;
    $('#toNow').textContent = state.loaded.has(today) ? 'Now' : 'This evening';
    drawPicks(d);
  }

  // ---------- which channels: a category, or your own (pinned channels always come first) ----------
  const CATS = [['all', 'All channels', /./], ['mine', 'My channels', null],
    ['main', 'Main five', /^(BBC One|BBC Two|ITV1|Channel 4|Channel 5)$/],
    ['ent', 'Entertainment', /Sky (Max|Showcase|Comedy)|^ITV2$|^ITVBe$|^E4|^Dave|^Gold|^W$|Comedy Central|^5Star|^BBC Three|Really|Quest Red|^Pick/],
    ['drama', 'Drama & crime', /Sky Atlantic|Alibi|Sky (Crime|Witness)|^ITV3$|^ITV4$|^Drama|^5USA|U&Drama/],
    ['fact', 'Factual', /BBC Four|More4|Yesterday|Sky (Arts|History|Nature|Documentaries)|Discovery|National Geographic|^Quest$|Blaze|^PBS|Channel 5 Factual/],
    ['film', 'Films', /Film4|Sky Cinema|Talking Pictures|Great!|Movies/],
    ['kids', 'Kids', /CBBC|CBeebies|CITV|Nick|Disney|Cartoon|^POP|Boomerang|Tiny Pop/],
    ['sport', 'Sport', /Sport|Eurosport|TNT|Premier/],
    ['news', 'News', /News|GB News|Parliament/]];
  const FAV = 'tenner-tv-fav';
  const favs = { all() { try { return JSON.parse(localStorage.getItem(FAV) || '[]'); } catch { return []; } }, set(l) { try { localStorage.setItem(FAV, JSON.stringify(l)); } catch {} } };
  let cat = 'all';
  function drawCats() {
    const names = state.data.channels.map((c) => c.name), mine = favs.all();
    const live = CATS.filter(([k, , re]) => k === 'all' || (k === 'mine' ? mine.some((n) => names.includes(n)) : names.some((n) => re.test(n))));
    if (!live.some(([k]) => k === cat)) cat = 'all';
    $('#cats').innerHTML = live.length > 2 ? live.map(([k, l]) => `<button type="button" role="radio" data-cat="${k}" aria-checked="${k === cat}">${esc(l)}</button>`).join('') : '';
  }
  $('#cats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; cat = b.dataset.cat; drawCats(); drawGuide(true); });
  const star = (on) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.5l-5.1 2.7 1-5.6-4.1-4 5.7-.8z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>`;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.ch[data-ch]'); if (!b) return;
    const n = b.dataset.ch, l = favs.all(), on = !l.includes(n);
    favs.set(on ? [...l, n] : l.filter((x) => x !== n));
    drawCats(); drawGuide(true);
    $(`.ch[data-ch="${CSS.escape(n)}"]`)?.focus({ preventScroll: true });
  });

  // ---------- the guide ----------
  // each channel is its own strip of programmes, sized by length (a minute is --px pixels), scrolled on its own;
  // each starts at what's on now (today) or around 7pm (another day)
  const px = () => parseFloat(getComputedStyle($('#epg')).getPropertyValue('--px')) || 5;
  const kept = new Map();   // where you'd scrolled each channel to, kept when the guide is redrawn (a category, a pin)
  function drawGuide(keep) {
    const mine = favs.all(), re = CATS.find(([k]) => k === cat)?.[2];
    const chans = state.data.channels.filter((c) => c.items.length && (cat === 'mine' ? mine.includes(c.name) : re.test(c.name)))
      .sort((a, b) => (mine.includes(b.name) ? 1 : 0) - (mine.includes(a.name) ? 1 : 0));   // pinned first, otherwise as they come
    if (!chans.length) { $('#epg').innerHTML = cat !== 'all' ? '<div class="empty"><h3>None of these channels today</h3><p>Try another category, or All channels.</p></div>'
      : '<div class="empty"><h3>Nothing listed yet</h3><p>Listings for this day haven’t been published. Try a nearer day.</p></div>'; preview(null); return; }
    const now = Date.now();
    $('#epg').innerHTML = `<div class="rows" role="list">${chans.map((c) => `<div class="crow" role="listitem">
      <button type="button" class="ch" data-ch="${esc(c.name)}" aria-pressed="${mine.includes(c.name)}"
          aria-label="${esc(`${c.name}: ${mine.includes(c.name) ? 'pinned to the top, tap to unpin' : 'tap to pin to the top'}`)}">${badge(c.name)}<span class="ch-name">${esc(c.name)}</span>${star(mine.includes(c.name))}</button>
      <div class="strip" data-strip="${esc(c.name)}" aria-label="${esc(`${c.name}, day by day`)}">${[...state.loaded].map(([d, day], i) => dayBlocks(c.name, d, day, i > 0, now)).join('')}</div></div>`).join('')}</div>`;
    for (const st of document.querySelectorAll('.strip')) {
      st.addEventListener('scroll', () => { kept.set(st.dataset.strip, st.scrollLeft); queueEdge(st); }, { passive: true });
      if (keep && kept.has(st.dataset.strip)) st.scrollLeft = kept.get(st.dataset.strip); else jumpStrip(st, false, state.base);
      edges(st);
    }
    // the preview starts on what's on now on the first channel (or the first thing this evening)
    const start = [...shown.values()].find((x) => x.ch === chans[0].name && x.at <= now && now < x.end)
      || [...shown.values()].find((x) => x.ch === chans[0].name && hour(x.at) >= 19) || [...shown.values()][0];
    preview(start);
  }
  // one channel's programmes for one day (with a marker first, from the second day on)
  function dayBlocks(name, d, day, mark, now) {
    const items = day.channels.find((c) => c.name === name)?.items || [], m = px();
    return (mark ? `<span class="daymark" data-day="${d}" aria-hidden="true"><b>${esc(dayName(d, { weekday: 'short' }))}</b>${esc(dayName(d, { day: 'numeric', month: 'short' }))}</span>` : '')
      + items.map((x, j) => {
        const end = ends(x, items[j + 1]), live = x.at <= now && now < end, past = end <= now;
        const p = live ? Math.round(((now - x.at) / (end - x.at)) * 100) : 0;
        return `<button type="button" class="blk${live ? ' live' : past ? ' past' : ''}" style="width:${Math.max(150, ((end - x.at) / 60e3) * m)}px${live ? `;--p:${p}%` : ''}" ${reg(x, name, items[j + 1])} data-day="${d}"
          aria-label="${esc(`${name}, ${dayName(d, { weekday: 'long' })} ${hm(x.at)}: ${x.t}`)}"><span class="bi"><b>${esc(x.t)}</b><small>${live ? `Now · ${Math.max(1, Math.round((end - now) / 60e3))} min left` : hm(x.at)}</small></span></button>`;
      }).join('');
  }
  // a newly fetched day, added to the end of every strip without moving anything
  function appendDay(d, day) {
    const now = Date.now();
    for (const st of document.querySelectorAll('.strip')) { st.insertAdjacentHTML('beforeend', dayBlocks(st.dataset.strip, d, day, true, now)); edges(st); }
  }
  // as a strip scrolls: the next day loads before you reach the end, and the day in view becomes the page's day
  const nearEnd = (st) => st.scrollLeft + st.clientWidth > st.scrollWidth - 1500;
  let dayQ = 0;
  document.addEventListener('scroll', (e) => {
    const st = e.target; if (!(st instanceof Element) || !st.classList.contains('strip')) return;
    if (nearEnd(st)) loadNext();
    if (!dayQ) dayQ = requestAnimationFrame(() => { dayQ = 0; const b = [...st.querySelectorAll('.blk')].find((n) => n.offsetLeft + n.offsetWidth - st.firstElementChild.offsetLeft > st.scrollLeft + 40); if (b) setDay(b.dataset.day); });
  }, { capture: true, passive: true });

  // the words of a programme that runs off a strip's left edge start at the edge, so you can always read it
  const queued = new Set();
  const queueEdge = (st) => { if (queued.has(st)) return; queued.add(st); requestAnimationFrame(() => { queued.delete(st); edges(st); }); };
  function edges(st) {
    const x = st.scrollLeft;
    for (const b of st.querySelectorAll('.blk')) {
      const l = b.offsetLeft - st.firstElementChild.offsetLeft, r = l + b.offsetWidth;
      if (l < x && r > x + 60) b.style.setProperty('--off', `${Math.min(x - l, b.offsetWidth - 120)}px`); else b.style.removeProperty('--off');
    }
  }
  // a strip to now (on today), or to the programme on at 7pm on day d
  function jumpStrip(st, smooth, d = state.day) {
    const at = d === today ? Date.now() : null, blocks = [...st.querySelectorAll('.blk')];
    const b = blocks.find((n) => { const x = shown.get(n.dataset.p); return at ? x.at <= at && at < x.end : n.dataset.day === d && (hour(x.at) >= 19 || hour(x.end) > 19); })
      || (at ? blocks.find((n) => shown.get(n.dataset.p).at > at) : blocks.find((n) => n.dataset.day === d));
    st.scrollTo({ left: b ? Math.max(0, b.offsetLeft - st.firstElementChild.offsetLeft) : 0, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  }
  $('#toNow').addEventListener('click', () => goDay(state.loaded.has(today) ? today : state.base));

  // the preview: what you point at (or tab to), its artwork melting in from the right
  let pvKey = null;
  function preview(x) {
    if (!x) { $('#pvLive').innerHTML = ''; $('#pvCh').innerHTML = '&nbsp;'; $('#pvT').textContent = ''; $('#pvSum').textContent = ''; $('#pvMeta').textContent = ''; $('#pvImg').hidden = true; return; }
    if (pvKey === x.id) return; pvKey = x.id;
    const now = Date.now(), started = x.at <= now && now < x.end;
    $('#pvCh').innerHTML = logo(x.ch) ? `<img class="pv-logo" src="${esc(logo(x.ch))}" alt="${esc(x.ch)}">` : esc(x.ch);
    $('#pvT').textContent = x.t;
    $('#pvSum').textContent = x.sum || epLine(x) || (x.g || []).join(', ');
    $('#pvLive').innerHTML = liveBtn(x);
    $('#pvMeta').textContent = [started ? `Started at ${hm(x.at)}` : `${x.end <= now ? 'Was on' : 'On'} at ${hm(x.at)}`, x.s && x.n ? `S${x.s} E${x.n}` : '', length(x.end - x.at), started ? `${Math.max(1, Math.round((x.end - now) / 60e3))} min left` : ''].filter(Boolean).join('  ·  ');
    const img = $('#pvImg'), src = x.wide || x.poster;
    $('#pv').classList.toggle('poster', !x.wide && !!x.poster);
    if (!src) { img.hidden = true; document.querySelector('.guide').style.removeProperty('--pv-img'); return; }
    img.classList.remove('on'); img.onload = () => img.classList.add('on'); img.hidden = false; img.src = src;
    document.querySelector('.guide').style.setProperty('--pv-img', `url("${src.replace(/["\\]/g, '')}")`);   // the wash behind the guide
  }
  const over = (e) => { const b = e.target.closest('.blk, .pick'); if (b) preview(shown.get(b.dataset.p)); };
  document.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') over(e); });
  document.addEventListener('focusin', over);

  // tonight's picks: the evening's best on the main channels (not news or chat), one per show, in time order
  function drawPicks(d = state.day) {
    const data = state.loaded.get(d); if (!data) return;
    const main = data.channels.slice(0, 10), seen = new Set(), list = [];
    for (const c of main) c.items.forEach((x, j) => {
      const h = hour(x.at); if (h < 19 || h > 22.5) return;
      const g = (x.g || []).join(' ') + ' ' + (x.type || '');
      const score = (x.r || 6.2) + (x.wide ? 1.4 : x.poster ? .8 : 0) + (x.sum ? .3 : 0) + (/Scripted|Documentary|Drama|Comedy/.test(g) ? .6 : 0) - (/News|Talk Show|Weather/.test(g) ? 4 : 0);
      list.push({ x, c: c.name, next: c.items[j + 1], score });
    });
    const picks = list.sort((a, b) => b.score - a.score).filter(({ x }) => !seen.has(x.show) && seen.add(x.show)).slice(0, 10).sort((a, b) => a.x.at - b.x.at);
    $('#picksSec').hidden = picks.length < 3;
    $('#picksH').textContent = d === today ? 'Tonight’s picks' : d === days[1] ? 'Tomorrow’s picks' : `${dayName(d, { weekday: 'long' })}’s picks`;
    $('#picks').innerHTML = picks.map(({ x, c, next }) => `<li><button type="button" class="pick" ${reg(x, c, next)}>
      <span class="pick-art">${art(x)}<span class="chip">${hm(x.at)} · ${esc(c)}</span></span>
      <b>${esc(x.t)}</b><small>${esc(epLine(x) || (x.g || []).join(', ') || c)}</small></button></li>`).join('');
  }

  // ---------- the sheet ----------
  const sheet = $('#sheet');
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    const x = shown.get(b.dataset.p); if (!x) return;
    preview(x);
    $('#shIn').innerHTML = `<div class="sh-art${!x.wide && x.poster ? ' sh-poster' : ''}">${x.wide || x.poster ? art(x) : ''}
        <button type="button" class="sh-x" id="shX" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></div>
      <div class="sh-body"><p class="sh-when">${esc(x.ch)} · ${esc(dayName(ukDay(x.at), { weekday: 'long', day: 'numeric', month: 'long' }))} · ${hm(x.at)}–${hm(x.end)} · ${length(x.end - x.at)}</p>
        <h2 id="shT">${esc(x.t)}</h2>${epLine(x) ? `<p class="sh-ep">${esc(epLine(x))}</p>` : ''}
        ${x.sum ? `<p class="sh-sum">${esc(x.sum)}</p>` : '<p class="sh-sum" style="color:var(--label2)">No description yet.</p>'}
        ${x.g?.length ? `<ul class="sh-tags">${(x.g || []).map((g) => `<li>${esc(g)}</li>`).join('')}${x.r ? `<li>★ ${x.r.toFixed(1)}</li>` : ''}</ul>` : ''}
        <div class="sh-acts">${liveBtn(x)}${x.url ? `<a class="sh-link" href="${esc(x.url)}" target="_blank" rel="noopener">More on TVmaze</a>` : ''}</div>
        ${LIVE[x.ch] && liveBtn(x) ? '<p class="sh-note">Opens the channel’s own player. You need a TV licence to watch live TV in the UK.</p>' : ''}</div>`;
    sheet.showModal(); $('#shX').focus();
  });
  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('#shX')) sheet.close(); });   // tap outside, or ×

  // ---------- start, and keep "now" moving ----------
  load();
  setInterval(() => {
    if (!state.loaded.has(today)) return;
    const now = Date.now();
    document.querySelectorAll('.blk').forEach((b) => {
      const x = shown.get(b.dataset.p); if (!x) return;
      const live = x.at <= now && now < x.end; b.classList.toggle('live', live); b.classList.toggle('past', x.end <= now);
      if (live) { b.style.setProperty('--p', `${Math.round(((now - x.at) / (x.end - x.at)) * 100)}%`); b.querySelector('small').textContent = `Now · ${Math.max(1, Math.round((x.end - now) / 60e3))} min left`; }
      else b.querySelector('small').textContent = hm(x.at);
    });
  }, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ukDay() !== today) location.reload(); });   // past midnight: a new day
})();

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

  const today = ukDay(), days = Array.from({ length: 7 }, (_, i) => ukDay(Date.now() + i * 864e5));
  const q = new URLSearchParams(location.search).get('d');
  const state = { day: days.includes(q) ? q : today, data: null };
  const label = (d) => (d === today ? 'Tonight' : d === days[1] ? 'Tomorrow' : dayName(d, { weekday: 'short', day: 'numeric' }));
  const word = (d) => (d === today ? 'tonight' : d === days[1] ? 'tomorrow' : dayName(d, { weekday: 'long' }));

  // ---------- the days ----------
  $('#days').innerHTML = days.map((d) => `<button type="button" data-d="${d}">${esc(label(d))}</button>`).join('');
  $('#days').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b && b.dataset.d !== state.day) { state.day = b.dataset.d; load(); } });

  const shown = new Map();   // every drawn programme, by id: for the preview and the sheet
  const reg = (x, ch, next) => { shown.set(String(x.id), { ...x, ch, end: ends(x, next) }); return `data-p="${x.id}"`; };
  const epLine = (x) => [x.s && x.n ? `Series ${x.s}, episode ${x.n}` : x.n ? `Episode ${x.n}` : '', x.ep].filter(Boolean).join(' · ');
  const art = (x) => (x.wide ? `<img src="${esc(x.wide)}" alt="" loading="lazy" decoding="async">`
    : x.poster ? `<img class="bed" src="${esc(x.poster)}" alt="" loading="lazy" decoding="async"><img class="pst" src="${esc(x.poster)}" alt="" loading="lazy" decoding="async">`
    : `<span class="ph" style="background:linear-gradient(150deg,hsl(${hue(x.t)} 45% 40%),hsl(${(hue(x.t) + 50) % 360} 55% 18%))">${esc(x.t)}</span>`);
  const logo = (name) => state.data?.logos?.[name];

  // ---------- loading ----------
  let ctl = null;
  async function load() {
    document.querySelectorAll('#days button').forEach((b) => (b.dataset.d === state.day ? b.setAttribute('aria-current', 'date') : b.removeAttribute('aria-current')));
    const u = new URL(location.href); state.day === today ? u.searchParams.delete('d') : u.searchParams.set('d', state.day); history.replaceState(null, '', u);
    $('#eye').textContent = dayName(state.day, { weekday: 'long', day: 'numeric', month: 'long' });
    $('#h1').innerHTML = `What’s on <em class="grad">${esc(word(state.day))}</em>.`;
    document.title = `What’s on UK TV ${word(state.day)} · Tenner TV`;
    $('#toNow').textContent = state.day === today ? 'Now' : 'This evening';
    $('#epg').innerHTML = '<div class="skel" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>';
    ctl?.abort(); ctl = new AbortController();
    try {
      const r = await fetch(`/api/day?d=${state.day}`, { signal: ctl.signal });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status);
      state.data = d; shown.clear(); kept.clear(); drawCats(); drawGuide(); drawPicks();
    } catch (err) {
      if (err.name === 'AbortError') return;
      $('#picksSec').hidden = true;
      $('#epg').innerHTML = '<div class="empty"><h3>The listings didn’t load</h3><p>Check your connection, then try again in a moment.</p></div>';
      preview(null);
    }
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
    const now = Date.now(), m = px();
    $('#epg').innerHTML = `<div class="rows" role="list">${chans.map((c) => `<div class="crow" role="listitem">
      <button type="button" class="ch" data-ch="${esc(c.name)}" aria-pressed="${mine.includes(c.name)}"
          aria-label="${esc(`${c.name}: ${mine.includes(c.name) ? 'pinned to the top, tap to unpin' : 'tap to pin to the top'}`)}">${logo(c.name) ? `<img class="ch-logo" src="${esc(logo(c.name))}" alt="" decoding="async">` : `<span class="ch-name">${esc(c.name)}</span>`}${star(mine.includes(c.name))}</button>
      <div class="strip" data-strip="${esc(c.name)}" aria-label="${esc(`${c.name} through the day`)}">${c.items.map((x, j) => {
        const end = ends(x, c.items[j + 1]), live = x.at <= now && now < end, past = end <= now;
        const p = live ? Math.round(((now - x.at) / (end - x.at)) * 100) : 0;
        return `<button type="button" class="blk${live ? ' live' : past ? ' past' : ''}" style="width:${Math.max(150, ((end - x.at) / 60e3) * m)}px${live ? `;--p:${p}%` : ''}" ${reg(x, c.name, c.items[j + 1])}
          aria-label="${esc(`${c.name}, ${hm(x.at)}: ${x.t}`)}"><span class="bi"><b>${esc(x.t)}</b><small>${live ? `Now · ${Math.max(1, Math.round((end - now) / 60e3))} min left` : hm(x.at)}</small></span></button>`;
      }).join('')}</div></div>`).join('')}</div>`;
    for (const st of document.querySelectorAll('.strip')) {
      st.addEventListener('scroll', () => { kept.set(st.dataset.strip, st.scrollLeft); queueEdge(st); }, { passive: true });
      if (keep && kept.has(st.dataset.strip)) st.scrollLeft = kept.get(st.dataset.strip); else jumpStrip(st, false);
      edges(st);
    }
    // the preview starts on what's on now on the first channel (or the first thing this evening)
    const start = [...shown.values()].find((x) => x.ch === chans[0].name && x.at <= now && now < x.end)
      || [...shown.values()].find((x) => x.ch === chans[0].name && hour(x.at) >= 19) || [...shown.values()][0];
    preview(start);
  }
  // the words of a programme that runs off a strip's left edge start at the edge, so you can always read it
  const queued = new Set();
  const queueEdge = (st) => { if (queued.has(st)) return; queued.add(st); requestAnimationFrame(() => { queued.delete(st); edges(st); }); };
  function edges(st) {
    const x = st.scrollLeft;
    for (const b of st.children) {
      const l = b.offsetLeft - st.firstElementChild.offsetLeft, r = l + b.offsetWidth;
      if (l < x && r > x + 60) b.style.setProperty('--off', `${Math.min(x - l, b.offsetWidth - 120)}px`); else b.style.removeProperty('--off');
    }
  }
  // a strip to now (today) or the programme on at 7pm (another day)
  function jumpStrip(st, smooth) {
    const at = state.day === today ? Date.now() : null, blocks = [...st.children];
    const b = blocks.find((n) => { const x = shown.get(n.dataset.p); return at ? x.at <= at && at < x.end : hour(x.at) >= 19 || hour(x.end) > 19; }) || (at ? blocks.find((n) => shown.get(n.dataset.p).at > at) : null);
    st.scrollTo({ left: b ? Math.max(0, b.offsetLeft - st.firstElementChild.offsetLeft) : 0, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  }
  const jump = (smooth) => { kept.clear(); document.querySelectorAll('.strip').forEach((st) => jumpStrip(st, smooth)); };
  $('#toNow').addEventListener('click', () => jump(true));

  // the preview: what you point at (or tab to), its artwork melting in from the right
  let pvKey = null;
  function preview(x) {
    if (!x) { $('#pvCh').innerHTML = '&nbsp;'; $('#pvT').textContent = ''; $('#pvSum').textContent = ''; $('#pvMeta').textContent = ''; $('#pvImg').hidden = true; return; }
    if (pvKey === x.id) return; pvKey = x.id;
    const now = Date.now(), started = x.at <= now && now < x.end;
    $('#pvCh').innerHTML = logo(x.ch) ? `<img class="pv-logo" src="${esc(logo(x.ch))}" alt="${esc(x.ch)}">` : esc(x.ch);
    $('#pvT').textContent = x.t;
    $('#pvSum').textContent = x.sum || epLine(x) || (x.g || []).join(', ');
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
  function drawPicks() {
    const main = state.data.channels.slice(0, 10), seen = new Set(), list = [];
    for (const c of main) c.items.forEach((x, j) => {
      const h = hour(x.at); if (h < 19 || h > 22.5) return;
      const g = (x.g || []).join(' ') + ' ' + (x.type || '');
      const score = (x.r || 6.2) + (x.wide ? 1.4 : x.poster ? .8 : 0) + (x.sum ? .3 : 0) + (/Scripted|Documentary|Drama|Comedy/.test(g) ? .6 : 0) - (/News|Talk Show|Weather/.test(g) ? 4 : 0);
      list.push({ x, c: c.name, next: c.items[j + 1], score });
    });
    const picks = list.sort((a, b) => b.score - a.score).filter(({ x }) => !seen.has(x.show) && seen.add(x.show)).slice(0, 10).sort((a, b) => a.x.at - b.x.at);
    $('#picksSec').hidden = picks.length < 3;
    $('#picksH').textContent = state.day === today ? 'Tonight’s picks' : state.day === days[1] ? 'Tomorrow’s picks' : `${dayName(state.day, { weekday: 'long' })}’s picks`;
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
        ${x.url ? `<a class="sh-link" href="${esc(x.url)}" target="_blank" rel="noopener">More on TVmaze</a>` : ''}</div>`;
    sheet.showModal(); $('#shX').focus();
  });
  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('#shX')) sheet.close(); });   // tap outside, or ×

  // ---------- start, and keep "now" moving ----------
  load();
  setInterval(() => {
    if (!state.data || state.day !== today) return;
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

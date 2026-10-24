// Tenner TV: a day of UK TV from /api/day (TVmaze, trimmed by the Worker). Tonight's picks, on now (today only), and
// the evening (or the whole day) channel by channel. Any programme opens a sheet with what it's about.
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

  const today = ukDay(), days = Array.from({ length: 7 }, (_, i) => ukDay(Date.now() + i * 864e5));
  const q = new URLSearchParams(location.search).get('d');
  const state = { day: days.includes(q) ? q : today, span: 'eve', data: null, all: false };
  const label = (d) => (d === today ? 'Tonight' : d === days[1] ? 'Tomorrow' : dayName(d, { weekday: 'short', day: 'numeric' }));

  // ---------- the days ----------
  $('#days').innerHTML = days.map((d) => `<button type="button" data-d="${d}">${esc(label(d))}</button>`).join('');
  $('#days').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b && b.dataset.d !== state.day) { state.day = b.dataset.d; state.all = false; load(); } });
  document.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-span]'); if (!b) return;
    state.span = b.dataset.span; document.querySelectorAll('[data-span]').forEach((n) => n.setAttribute('aria-checked', n === b)); drawGrid();
  });

  const shown = new Map();   // every drawn programme, by id, for the sheet
  const reg = (x, ch) => { shown.set(String(x.id), { ...x, ch }); return `data-p="${x.id}"`; };
  const art = (x, wide) => {
    const src = wide ? x.wide || x.img : x.img;
    return src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">`
      : `<span class="ph" style="background:linear-gradient(150deg,hsl(${hue(x.t)} 45% 40%),hsl(${(hue(x.t) + 50) % 360} 55% 18%))">${esc(x.t)}</span>`;
  };
  const epLine = (x) => [x.s && x.n ? `Series ${x.s}, episode ${x.n}` : x.n ? `Episode ${x.n}` : '', x.ep].filter(Boolean).join(' · ');

  // ---------- loading ----------
  let ctl = null;
  async function load() {
    document.querySelectorAll('#days button').forEach((b) => (b.dataset.d === state.day ? b.setAttribute('aria-current', 'date') : b.removeAttribute('aria-current')));
    const u = new URL(location.href); state.day === today ? u.searchParams.delete('d') : u.searchParams.set('d', state.day); history.replaceState(null, '', u);
    const isToday = state.day === today;
    $('#eye').textContent = dayName(state.day, { weekday: 'long', day: 'numeric', month: 'long' });
    $('#h1').innerHTML = `What’s on <em class="grad">${esc(isToday ? 'tonight' : state.day === days[1] ? 'tomorrow' : dayName(state.day, { weekday: 'long' }))}</em>.`;
    document.title = `What’s on UK TV ${isToday ? 'tonight' : state.day === days[1] ? 'tomorrow' : dayName(state.day, { weekday: 'long' })} · Tenner TV`;
    $('#chans').innerHTML = '<div class="skel" aria-hidden="true"><i></i><i></i><i></i><i></i></div>';
    ctl?.abort(); ctl = new AbortController();
    try {
      const r = await fetch(`/api/day?d=${state.day}`, { signal: ctl.signal });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status);
      state.data = d; shown.clear(); draw();
    } catch (err) {
      if (err.name === 'AbortError') return;
      $('#picksSec').hidden = $('#nowSec').hidden = true;
      $('#chans').innerHTML = '<div class="empty"><h3>The listings didn’t load</h3><p>Check your connection, then try again in a moment.</p></div>';
    }
  }

  function draw() { drawPicks(); drawNow(); drawGrid(); }

  // tonight's picks: the evening's best on the main channels (not news or chat), one per show, in time order
  function drawPicks() {
    const main = state.data.channels.slice(0, 10), seen = new Set(), list = [];
    for (const c of main) for (const x of c.items) {
      const h = hour(x.at); if (h < 19 || h > 22.5) continue;
      const g = x.g.join(' ') + ' ' + (x.type || '');
      const score = (x.r || 6.2) + (x.img ? 1.2 : 0) + (x.sum ? .3 : 0) + (/Scripted|Documentary|Drama|Comedy/.test(g) ? .6 : 0) - (/News|Talk Show|Weather/.test(g) ? 4 : 0);
      list.push({ x, c: c.name, score });
    }
    const picks = list.sort((a, b) => b.score - a.score).filter(({ x }) => !seen.has(x.show) && seen.add(x.show)).slice(0, 10).sort((a, b) => a.x.at - b.x.at);
    $('#picksSec').hidden = picks.length < 3;
    $('#picksH').textContent = state.day === today ? 'Tonight’s picks' : state.day === days[1] ? 'Tomorrow’s picks' : `${dayName(state.day, { weekday: 'long' })}’s picks`;
    $('#picks').innerHTML = picks.map(({ x, c }) => `<li><button type="button" class="pick" ${reg(x, c)}>
      <span class="pick-art">${art(x, true)}<span class="chip">${hm(x.at)} · ${esc(c)}</span></span>
      <b>${esc(x.t)}</b><small>${esc(epLine(x) || x.g.join(', ') || c)}</small></button></li>`).join('');
  }

  // on now (today only): each main channel's programme, how far through it is, and what's next
  function drawNow() {
    const now = Date.now(), on = state.day === today;
    const tiles = on ? state.data.channels.slice(0, 12).map((c) => {
      const i = c.items.findIndex((x, j) => x.at <= now && now < ends(x, c.items[j + 1]));
      if (i < 0) return '';
      const x = c.items[i], nx = c.items[i + 1], end = ends(x, nx), p = Math.min(100, Math.max(0, ((now - x.at) / (end - x.at)) * 100));
      return `<li><button type="button" class="tile" ${reg(x, c.name)}><span class="tile-ch">${esc(c.name)}</span><span class="tile-t">${esc(x.t)}</span>
        <span class="tile-meta">${hm(x.at)}–${hm(end)} · ${Math.max(1, Math.round((end - now) / 60e3))} min left</span><span class="prog" aria-hidden="true"><i style="--p:${p.toFixed(1)}%"></i></span>
        ${nx ? `<span class="tile-next">Next <b>${hm(nx.at)} ${esc(nx.t)}</b></span>` : ''}</button></li>`;
    }).filter(Boolean) : [];
    $('#nowSec').hidden = !tiles.length;
    $('#now').innerHTML = tiles.join('');
  }

  // the evening (from 6pm) or the whole day, channel by channel; the first 14 channels, then the rest on request
  function drawGrid() {
    if (!state.data) return;
    const now = Date.now(), from = state.span === 'eve' ? 18 : 0;
    $('#gridH').textContent = state.span === 'eve' ? 'The evening, channel by channel' : 'The whole day, channel by channel';
    $('#gridP').textContent = state.span === 'eve' ? 'From 6pm' : 'From the early hours';
    const chans = state.data.channels.map((c) => ({ ...c, items: c.items.filter((x, j) => hour(ends(x, c.items[j + 1])) > from || hour(x.at) >= from) }))
      .filter((c) => c.items.length);
    if (!chans.length) { $('#chans').innerHTML = '<div class="empty"><h3>Nothing listed yet</h3><p>Listings for this day haven’t been published. Try a nearer day.</p></div>'; return; }
    const list = state.all ? chans : chans.slice(0, 14);
    $('#chans').innerHTML = list.map((c) => `<section class="chan"><h3>${esc(c.name)}<small>${c.items.length} programme${c.items.length === 1 ? '' : 's'}</small></h3>
      <ol class="list">${c.items.map((x, j) => {
        const end = ends(x, c.items[j + 1]), live = x.at <= now && now < end, past = end <= now;
        return `<li><button type="button" class="row${live ? ' on' : past ? ' past' : ''}" ${reg(x, c.name)}><time datetime="${new Date(x.at).toISOString()}">${hm(x.at)}</time>
          <span><b>${esc(x.t)}</b>${epLine(x) || x.g.length ? `<small>${esc(epLine(x) || x.g.join(', '))}</small>` : ''}</span></button></li>`;
      }).join('')}</ol></section>`).join('')
      + (chans.length > list.length ? `<div class="empty" style="padding:8px 0 0"><button type="button" class="more" id="allCh">Show all ${chans.length} channels</button></div>` : '');
    $('#allCh')?.addEventListener('click', () => { state.all = true; drawGrid(); });
  }

  // ---------- the sheet ----------
  const sheet = $('#sheet');
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    const x = shown.get(b.dataset.p); if (!x) return;
    const c = state.data.channels.find((y) => y.name === x.ch), j = c ? c.items.findIndex((y) => y.id === x.id) : -1, end = ends(x, c?.items[j + 1]);
    $('#shIn').innerHTML = `<div class="sh-art">${x.wide || x.img ? `<img src="${esc(x.wide || x.img)}" alt="">` : ''}
        <button type="button" class="sh-x" id="shX" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></div>
      <div class="sh-body"><p class="sh-when">${esc(x.ch)} · ${esc(dayName(ukDay(x.at), { weekday: 'long', day: 'numeric', month: 'long' }))} · ${hm(x.at)}–${hm(end)}${x.rt ? ` · ${x.rt} min` : ''}</p>
        <h2 id="shT">${esc(x.t)}</h2>${epLine(x) ? `<p class="sh-ep">${esc(epLine(x))}</p>` : ''}
        ${x.sum ? `<p class="sh-sum">${esc(x.sum)}</p>` : '<p class="sh-sum" style="color:var(--label2)">No description yet.</p>'}
        ${x.g.length ? `<ul class="sh-tags">${x.g.map((g) => `<li>${esc(g)}</li>`).join('')}${x.r ? `<li>★ ${x.r.toFixed(1)}</li>` : ''}</ul>` : ''}
        ${x.url ? `<a class="sh-link" href="${esc(x.url)}" target="_blank" rel="noopener">More on TVmaze</a>` : ''}</div>`;
    sheet.showModal(); $('#shX').focus();
  });
  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('#shX')) sheet.close(); });   // tap outside, or ×

  // ---------- start, and keep "now" current ----------
  load();
  setInterval(() => { if (state.data && state.day === today) { drawNow(); if (!sheet.open) drawGrid(); } }, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ukDay() !== today) location.reload(); });   // past midnight: a new day
})();

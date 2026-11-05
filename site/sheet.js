// Tenner's title sheet: tap a title anywhere and see where to watch it in the UK without leaving Tenner, the Apple TV
// app way. Artwork, title, year, running time, age rating, star rating, genres, the description, a trailer, and where
// to watch grouped as Included with, Free, Rent and Buy. A bottom sheet on phones (swipe it down to close), a centred
// card on computers. The address gains ?t=… so a title can be shared, and Back closes it.
// Details come from data/titles.json (rebuilt hourly), fetched the first time a sheet opens. The rest of TMDB's page for a
// title (its logo, episodes, trailers and extras, the film series, More Like This, reviews and Information) comes from the
// search API as the sheet opens, and fills in below.
(() => {
  const { esc, hue, reduce, saved, progress, nextUp, whenText } = window.tn;
  // the chart history (data/trail.json: each charted title's recent ranks), loaded with the first sheet
  let trailP = null;
  const trail = () => (trailP ||= fetch(`data/trail.json?v=${Math.floor(Date.now() / 600000)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  // what it costs to rent or buy (data/prices.json: popular new films to buy or rent), loaded with the first sheet too
  let priceP = null, priceD = null;
  const prices = () => (priceP ||= fetch(`data/prices.json?v=${Math.floor(Date.now() / 600000)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  // On TV this week: Freeview showings from Tenner TV's listings (rebuilt every three hours), loaded with the first sheet
  let airP = null, airD = null;
  const onAir = () => (airP ||= fetch('https://tenner-tv.danseacroft.workers.dev/api/onair').then((r) => (r.ok ? r.json() : null)).catch(() => null));
  addEventListener('tn:check', () => { trailP = null; priceP = null; airP = null; });
  let trailD = null;
  const CHART = { all: 'in the UK', netflix: 'on Netflix', disney: 'on Disney+', prime: 'on Prime Video', hbomax: 'on HBO Max', paramount: 'on Paramount+', appletv: 'on Apple TV' };

  // ---------- trackers ----------
  // On the chart: a line of the title's rank (No. 1 at the top) over the last month, or the last day while the history
  // is still building up, gaps where it was out of the top 10; and its life on the charts so far (days in the top 10,
  // its peak, days at No. 1, when it first charted)
  const SVC = { netflix: 'Netflix', disney: 'Disney+', prime: 'Prime Video', hbomax: 'HBO Max', paramount: 'Paramount+', appletv: 'Apple TV' };
  function lifeHtml(t) {
    const p = t.p; if (!p?.n) return '';
    const peak = p.u ? `Peaked at No. ${p.u} in the UK` : p.b ? `Peaked at No. ${p.b[0]} on ${SVC[p.b[1]] || p.b[1]}` : '';
    const first = new Date(p.f + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', ...(p.f.slice(0, 4) !== String(new Date().getFullYear()) ? { year: 'numeric' } : {}) });
    const cells = [[p.n, p.n === 1 ? 'day in a Top 10' : 'days in a Top 10'], peak && [peak.match(/No\. \d+/)[0], peak.replace(/^Peaked at No\. \d+ /, 'peak ')], p.o ? [p.o, p.o === 1 ? 'day at No. 1' : 'days at No. 1'] : null].filter(Boolean);
    return `<dl class="sh-life">${cells.map(([v, l]) => `<div><dt>${esc(String(v))}</dt><dd>${esc(l)}</dd></div>`).join('')}</dl>${onesHtml(t)}<p class="sh-first">First charted ${esc(first)}</p>`;
  }
  // Where it's been No. 1: the UK chart and each service's own, the ones it tops right now first
  function onesHtml(t) {
    const w = { ...(t.p?.w || {}) }, now = new Set(t.t1 || []);
    for (const sv of now) w[sv] ||= [1, new Date().toISOString().slice(0, 10)];
    const list = Object.entries(w).sort(([a, x], [b, y]) => now.has(b) - now.has(a) || (a === 'all' ? -1 : b === 'all' ? 1 : 0) || y[0] - x[0] || y[1].localeCompare(x[1]));
    if (!list.length) return '';
    const day = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const rows = list.map(([sv, [n, last]]) => {
      const s = sv === 'all' ? { label: 'UK Top 10' } : trailD?.svc?.[sv] || { label: SVC[sv] || sv };
      const days = `${n} ${n === 1 ? 'day' : 'days'}`;
      const line = now.has(sv) ? (n > 1 ? `No. 1 now · ${days}` : 'No. 1 now') : `${days} · last on ${day(last)}`;
      return `<li${now.has(sv) ? ' class="now"' : ''}><span class="sh-one-ic">${s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy">` : esc(sv === 'all' ? 'UK' : s.label[0])}</span><span><b>${esc(s.label)}</b><small>${esc(line)}</small></span></li>`;
    }).join('');
    return `<div class="sh-ones"><h4>No. 1 on</h4><ul>${rows}</ul></div>`;
  }
  function chartHtml(info) {
    const t = trailD?.items?.[info.k]; if (!t) return '';
    const byDay = t.d.filter(Boolean).length >= 3, r = byDay ? t.d : t.h, when = byDay ? trailD.days : trailD.hours;
    if (r.filter(Boolean).length < 2) return t.p ? `<section class="sh-track" aria-labelledby="shC"><h3 id="shC">On the Chart</h3>${lifeHtml(t)}</section>` : '';
    // Apple Stocks style: the plot on the left, No. 1 and No. 10 in a margin on the right, so labels never sit on the line
    const W = 300, H = 92, R = 40, px = (i) => 8 + (i * (W - R - 16)) / Math.max(1, r.length - 1), py = (n) => 10 + ((n - 1) * (H - 20)) / 9;
    let path = '', pen = false;
    r.forEach((n, i) => { if (!n) { pen = false; return; } path += `${pen ? 'L' : 'M'}${px(i).toFixed(1)} ${py(n).toFixed(1)}`; pen = true; });
    const dots = r.map((n, i) => (n ? `<circle cx="${px(i).toFixed(1)}" cy="${py(n).toFixed(1)}" r="${i === r.length - 1 ? 4 : 2.4}"${i === r.length - 1 ? ' class="now"' : ''}/>` : '')).join('');
    const label = (s) => (byDay ? new Date(s + 'T12:00:00').toLocaleDateString('en-GB', r.length > 7 ? { day: 'numeric', month: 'short' } : { weekday: 'short' }) : new Date(s).toLocaleTimeString('en-GB', { hour: 'numeric', hour12: true }).replace(' ', ''));
    const now = r.at(-1), best = Math.min(...r.filter(Boolean)), inTop = r.filter(Boolean).length;
    const where = CHART[t.c.split(':')[0]] || '';
    const summary = [now ? `No. ${now} ${where} now` : `Out of the top 10 ${where} now`, best < (now || 11) ? `best No. ${best}` : '',
      byDay ? `${inTop} of the last ${r.length} days in the top 10` : 'over the last 24 hours'].filter(Boolean).join(' · ');
    return `<section class="sh-track" aria-labelledby="shC"><h3 id="shC">On the Chart</h3><p class="sh-tsum">${esc(summary)}</p>
      <svg class="sh-spark" viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="${esc(summary)}">
        <defs><linearGradient id="shG" gradientUnits="userSpaceOnUse" x1="8" y1="0" x2="${W - R - 8}" y2="0"><stop offset="0" stop-color="#ff375f"/><stop offset=".35" stop-color="#ff9f0a"/><stop offset=".65" stop-color="#0a84ff"/><stop offset="1" stop-color="#bf5af2"/></linearGradient></defs>
        <line x1="8" x2="${W - R - 8}" y1="${py(1)}" y2="${py(1)}" class="g"/><line x1="8" x2="${W - R - 8}" y1="${py(10)}" y2="${py(10)}" class="g"/>
        <text x="${W}" y="${py(1) + 4}" class="y" text-anchor="end">No. 1</text><text x="${W}" y="${py(10) + 4}" class="y" text-anchor="end">No. 10</text>
        <path d="${path}" class="ln"/>${dots}
        <text x="8" y="${H + 12}" class="x">${esc(label(when[0]))}</text><text x="${W - R - 8}" y="${H + 12}" class="x" text-anchor="end">${byDay ? 'Today' : 'Now'}</text>
      </svg>${lifeHtml(t)}</section>`;
  }
  // Shows: when the next episode lands, and where you're up to (kept on this device)
  function nextHtml(info, x) {
    if (info.type !== 'tv') return '';
    if (x.nx) return `<p class="sh-next"><b>New episode ${esc(whenText(x.nx[0]))}</b><span>Season ${x.nx[1]}, episode ${x.nx[2]}</span></p>`;
    return x.en ? '<p class="sh-next done"><b>Series ended</b></p>' : '';
  }
  function progressHtml(info, x) {
    if (info.type !== 'tv' || !info.k || !x.sz?.length) return '';
    const p = progress.get(info.k), up = nextUp(p, x.sz), last = [x.sz.length, x.sz.at(-1)];
    const s = p?.[0] || 1;
    const opts = (n, cur, f) => Array.from({ length: n }, (_, i) => `<option value="${i + 1}"${i + 1 === cur ? ' selected' : ''}>${f(i + 1)}</option>`).join('');
    const status = !p ? 'Not started' : up ? `Up next: S${up[0]} E${up[1]}` : x.nx ? `All caught up · new episode ${whenText(x.nx[0])}` : 'All caught up';
    return `<section class="sh-prog" aria-labelledby="shP"><h3 id="shP">Your Progress</h3>
      <div class="sh-prow">
        <label><span>Watched up to</span>
          <select data-pr="s" aria-label="Season">${opts(x.sz.length, p ? s : 0, (n) => `Season ${n}`)}${p ? '' : '<option value="" selected>Season</option>'}</select>
          <select data-pr="e" aria-label="Episode"${p ? '' : ' disabled'}>${opts(x.sz[s - 1] || 1, p?.[1] || 0, (n) => `Episode ${n}`)}</select></label>
        ${up ? `<button type="button" class="btn btn-tinted" data-act="watched" aria-keyshortcuts="E">Mark S${up[0]} E${up[1]} watched</button>` : ''}
        ${p ? '<button type="button" class="btn btn-tinted sh-reset" data-act="reset" aria-label="Clear progress" title="Clear progress">Clear</button>' : ''}
      </div>
      <p class="sh-pstat">${esc(status)}${p && !(p[0] === last[0] && p[1] === last[1]) ? (() => { const n = x.sz.reduce((a, c) => a + c, 0) - (x.sz.slice(0, p[0] - 1).reduce((a, c) => a + c, 0) + p[1]); return n > 0 ? ` · ${n} episode${n === 1 ? '' : 's'} to go` : ''; })() : ''}</p>
    </section>`;
  }
  // the Watchlist button: a bookmark that fills in once saved
  const saveBtn = (on) => `<button type="button" class="btn btn-tinted sh-save${on ? ' on' : ''}" data-act="save" aria-pressed="${on}" aria-keyshortcuts="W">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11v17L12 16.6 6.5 20.5z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>${on ? 'In Watchlist' : 'Watchlist'}</button>`;
  // the heart (phones): a round button that tells Tenner you love this, for better recommendations; it does nothing else.
  // A grey circle with an outline heart, red with a filled heart once loved
  const starBtn = (on) => `<button type="button" class="btn btn-tinted sh-star${on ? ' on' : ''}" data-act="star" aria-pressed="${on}" aria-label="${on ? 'Loved' : 'Love it'}: tell Tenner you like this" title="${on ? 'Loved' : 'Love it, for better recommendations'}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2s-7.6-4.6-7.6-10.3A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.6 2.5c0 5.7-7.6 10.3-7.6 10.3z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></button>`;
  // ---------- Just for You (signed in): Watched, Not interested and a note only you can see, kept with your account ----------
  const SEEN_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2"/><path class="c" d="m8.2 12.3 2.6 2.6 5-5.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const HIDE_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.3-6 9-6 9 6 9 6-3.3 6-9 6-9-6-9-6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.5 19.5 19.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const seenBtn = (on) => `<button type="button" class="btn btn-tinted sh-seen${on ? ' on' : ''}" data-act="seen" aria-pressed="${on}">${SEEN_IC}${on ? 'Watched' : 'Mark as watched'}</button>`;
  const hideBtn = (on) => `<button type="button" class="btn btn-tinted sh-hide${on ? ' on' : ''}" data-act="hide" aria-pressed="${on}">${HIDE_IC}${on ? 'Hidden' : 'Not interested'}</button>`;
  function mineHtml(info) {
    if (!info.k || !window.tn.member()) return '';
    const { seen, hidden, notes } = window.tn, note = notes.get(info.k)?.[0] || '', at = seen.get(info.k)?.[1];
    return `<section class="sh-mine" aria-labelledby="shM"><h3 id="shM">Just for You</h3>
      <div class="sh-mbtns">${seenBtn(!!at)}${hideBtn(hidden.has(info.k))}</div>
      <label class="sh-note"><span class="sh-vh">Your note on ${esc(info.title)}</span><textarea data-note rows="2" maxlength="280" placeholder="Add a note. Only you can see it">${esc(note)}</textarea></label>
      <p class="sh-msay" id="shMsay" role="status">${at ? `Watched ${esc(new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}` : ''}</p></section>`;
  }
  let msayT = 0;
  const msay = (t) => { const el = $('#shMsay'); if (!el) return; el.textContent = t; clearTimeout(msayT); msayT = setTimeout(() => { if (el.isConnected) el.textContent = ''; }, 3500); };
  const $ = (s, el = document) => el.querySelector(s);
  let dataP = null, dataD = null;
  const details = () => (dataP ||= fetch(`data/titles.json?v=${Math.floor(Date.now() / 600000)}`).then((r) => (r.ok ? r.json() : null)).then((d) => (dataD = d || dataD)).catch(() => null));
  addEventListener('tn:check', () => { dataP = null; });   // the next sheet picks up the new hour's details
  // titles Tenner doesn't follow (from searching everything) come live from the search API instead
  const apiCache = new Map();
  const fromApi = (k) => {
    if (!window.tn.api || !/^[mt]\d+$/.test(k || '')) return Promise.resolve(null);
    if (!apiCache.has(k)) apiCache.set(k, fetch(`${window.tn.api}/title/${k}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    return apiCache.get(k);
  };
  let shown = null;   // the details the open sheet was drawn from
  // the first touch, click or key anywhere starts fetching the details, so the first sheet opens already filled in
  for (const t of ['pointerdown', 'keydown']) addEventListener(t, () => { details(); trail(); prices(); onAir(); }, { once: true, passive: true });

  // ---------- the sheet, built once ----------
  document.body.insertAdjacentHTML('beforeend', `
    <dialog class="sheet" id="sheet" aria-labelledby="shT">
      <div class="sh-grab" aria-hidden="true"></div>
      <button type="button" class="sh-x" id="shX" aria-label="Close" title="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
      <div class="sh-scroll" id="shScroll"></div>
    </dialog>`);
  // a native modal <dialog>: the browser keeps focus inside it, shuts the page behind off from taps and screen readers,
  // and closes it with Escape (or the back gesture on Android); the dimmed page behind is its ::backdrop
  const sheet = $('#sheet'), body = $('#shScroll');
  body.addEventListener('scroll', () => sheet.classList.toggle('sh-scrolled', body.scrollTop > 30), { passive: true });   // the poster steps aside
  let current = null, opener = null, pushed = 0, pageTitle = document.title;   // pushed: titles opened from here, one history step each

  const runtime = (m) => !m ? '' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
  const { brand, link: linkFor } = window.tnLinks;   // links.js: every service's tested link

  function providerList(ids, d, info) {
    const ln = d.items?.[info.k]?.ln || {};
    const seen = new Set();
    return (ids || []).map((id) => [id, ...(d.providers[id] || [])]).filter(([, n]) => n && !seen.has(brand(n)) && seen.add(brand(n))).map(([id, n, logo]) => {
      const href = linkFor(n, info.title, ln, info);
      return `<a class="sh-prov" href="${esc(href)}" target="_blank" rel="noopener">${logo && d.logo ? `<img src="${esc(d.logo + logo)}" alt="" loading="lazy">` : `<i>${esc(brand(n)[0])}</i>`}<span>${esc(brand(n))}</span></a>`;
    }).join('');
  }
  function whereHtml(info, d) {
    const x = d?.items?.[info.k];
    if (!x) {   // no details (yet): what we know from the chart or catalogue
      const on = (info.services || []).map((s) => `<a class="sh-prov" href="${esc(linkFor(s.label, info.title, {}, info))}" target="_blank" rel="noopener">${s.logo ? `<img src="${esc(s.logo)}" alt="">` : `<i>${esc(s.label[0])}</i>`}<span>${esc(s.label)}</span></a>`).join('');
      return on ? `<div class="sh-grp"><h4>Included with</h4><div class="sh-provs">${on}</div></div>${tvHtml(info)}` : tvHtml(info) || `<p class="sh-none">${d && !d.pending ? 'We don’t have where-to-watch details for this one yet.' : 'Loading where to watch…'}</p>`;
    }
    const groups = [['Included with', x.f], ['Free', x.fr], ['Rent', x.re], ['Buy', x.bu]]
      .map(([label, ids]) => { const list = providerList(ids, d, info); return list ? `<div class="sh-grp"><h4>${label}</h4><div class="sh-provs">${list}</div></div>` : ''; }).join('');
    return (groups + priceHtml(info) + tvHtml(info)) || '<p class="sh-none">Not available to stream, rent or buy in the UK right now.</p>';
  }
  // its next two Freeview showings this week, each opening Tenner TV's search for it (where Watch live is a tap away)
  const fold = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
  const ukDate = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const tvTime = (t) => {
    const d = ukDate(t), rel = d === ukDate(Date.now()) ? 'Today' : d === ukDate(Date.now() + 864e5) ? 'Tomorrow'
      : new Date(t).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long' });
    const [h, m] = new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
    return `${rel} at ${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
  };
  function tvHtml(info) {
    const film = info.type === 'movie' ? 1 : 0, now = Date.now();
    const list = (airD?.titles?.[fold(info.title)] || []).filter((x) => x[2] === film && x[1] + (x[3] || 30) * 6e4 > now).slice(0, 2);
    if (!list.length) return '';
    const href = `https://tv.tenner.stream/?q=${encodeURIComponent(info.title)}`;
    return `<div class="sh-grp sh-prices"><h4>On TV this week</h4>${list.map((x) => `<a class="sh-pr" href="${esc(href)}" target="_blank" rel="noopener">${x[1] <= now ? '<b>On now</b>' : `<b>${esc(tvTime(x[1]))}</b>`} on ${esc(x[0])}</a>`).join('')}</div>`;
  }
  // the cheapest way to rent it and to buy it, where we have prices
  const money = (n) => `£${n.toFixed(2)}`;
  function priceHtml(info) {
    const o = priceD?.items?.[info.k]?.o; if (!o?.length) return '';
    const best = (t) => o.filter((x) => x[1] === t).sort((a, b) => a[2] - b[2])[0];
    const line = (t, label) => { const x = best(t); if (!x) return ''; const inner = `${label} from <b>${money(x[2])}</b> on ${esc(x[0])}${x[3] ? ` <small>${esc(x[3])}</small>` : ''}`;
      return /^https:\/\//.test(x[4]) ? `<a class="sh-pr" href="${esc(x[4])}" target="_blank" rel="noopener">${inner}</a>` : `<span class="sh-pr">${inner}</span>`; };
    const lines = [line('rent', 'Rent'), line('buy', 'Buy')].filter(Boolean).join('');
    return lines ? `<div class="sh-grp sh-prices"><h4>Cheapest</h4>${lines}</div>` : '';
  }
  // the line above the title: plain words in sentence case; a move up or down becomes a small green or red badge
  // ("▲2 to No. 3 show on Prime Video" → [↑ 2] Now No. 3 show on Prime Video)
  const ARROW = { up: 'M8 13V3.5M3.8 7.6 8 3.4l4.2 4.2', down: 'M8 3v9.5M3.8 8.4 8 12.6l4.2-4.2' };
  function eyeHtml(eye) {
    if (!eye) return '';
    const m = String(eye).match(/^(?:([▲▼])|(Up|Down) )(\d+)\s+(?:to\s+)?(.*)$/);
    if (!m) return `<p class="sh-eye">${esc(eye)}</p>`;
    const dir = m[1] === '▼' || m[2] === 'Down' ? 'down' : 'up', rest = m[4].replace(/^No\./, 'Now No.');
    return `<p class="sh-eye"><span class="sh-mv ${dir}" aria-label="${dir === 'up' ? 'Up' : 'Down'} ${m[3]} place${m[3] === '1' ? '' : 's'}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="${ARROW[dir]}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>${m[3]}</span>${esc(rest)}</p>`;
  }
  // the one service to send people to: the first UK subscription (then free) service TMDB lists for it, the one whose
  // chart it's on first. Before the details arrive, only what the chart itself says (the Netflix UK chart's own link, or
  // the chart's service). Never from Wikidata alone: a Netflix ID there can be for another country (Supernatural is on
  // Netflix in the US but HBO Max here).
  function watchOn(info, d) {
    const x = d?.items?.[info.k];
    if (!x) {
      if (info.netflix) return { name: 'Netflix', href: info.netflix };
      const s = info.services?.[0]; if (!s) return null;
      const href = linkFor(s.label, info.title, {}, info);
      return href && href !== info.watch && href !== '#' ? { name: brand(s.label), href } : null;
    }
    const mine = new Set((info.services || []).map((s) => brand(s.label)));
    const names = [...(x.f || []), ...(x.fr || [])].map((id) => d.providers[id]?.[0]).filter(Boolean);
    const ordered = [...names.filter((n) => mine.has(brand(n))), ...names];
    for (const n of ordered) {
      const href = linkFor(n, info.title, x.ln || {}, info);
      if (href && href !== info.watch && href !== '#') return { name: brand(n), href };
    }
    return null;
  }
  // the actions, the Apple TV way: one wide filled button for the main thing (watching it where it's on, or the
  // trailer), then the rest side by side in equal widths
  function btnsHtml(info, x, d) {
    const on = watchOn(info, d);
    const trailer = x.tr ? `<button type="button" class="btn btn-tinted" data-act="trailer" aria-keyshortcuts="T"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>Trailer</button>` : '';
    const watch = on ? `<a class="btn btn-tinted" href="${esc(on.href)}" target="_blank" rel="noopener"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>Watch on ${esc(on.name)}</a>` : '';
    const share = `<button type="button" class="btn btn-tinted" data-act="share" aria-keyshortcuts="S"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11v8.5h12V11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Share</button>`;
    const main = watch || trailer, rest = [watch ? trailer : '', info.k ? saveBtn(saved.has(info.k)) : '', info.k ? starBtn(window.tn.stars.has(info.k)) : '', share].filter(Boolean);
    return `<div class="sh-btns">${main ? `<div class="sh-main">${main}</div>` : ''}<div class="sh-more">${rest.join('')}</div><p class="sh-thanks" id="shThanks" role="status"></p></div>`;
  }
  // Cast & Crew: round faces in a row, each opening that person’s sheet (person.js), from the search API
  const castCache = new Map();
  const castFor = (k) => {
    if (!window.tn.api || !/^[mt]\d+$/.test(k || '')) return Promise.resolve(null);
    if (!castCache.has(k)) castCache.set(k, fetch(`${window.tn.api}/credits/${k}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    return castCache.get(k);
  };
  // the rest of TMDB's page for a title, a season's episodes, and a film series, each fetched once from the search API
  const getOnce = (cache, path) => {
    if (!window.tn.api) return Promise.resolve(null);
    if (!cache.has(path)) cache.set(path, fetch(`${window.tn.api}${path}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    return cache.get(path);
  };
  const moreC = new Map(), moreD = new Map();
  const moreFor = (k) => (/^[mt]\d+$/.test(k || '') ? getOnce(moreC, `/more/${k}`).then((m) => { if (m) moreD.set(k, m); return m; }) : Promise.resolve(null));
  const seasonFor = (k, n) => getOnce(moreC, `/season/${k}/${n}`);
  const seriesFor = (id) => getOnce(moreC, `/collection/${id}`);
  const LOGO = 'https://image.tmdb.org/t/p/w500';
  // the description: from wherever the title was opened, or the search API when that had none (the Watchlist, a shared
  // link, Cast & Crew) or only a shortened one; a few grey placeholder lines hold its place meanwhile. Four lines, then More.
  const ovLive = (info) => (!info.overview || info.overview.endsWith('…')) && !info.ovDone && window.tn.api && /^[mt]\d+$/.test(info.k || '');
  const ovHtml = (info) => info.overview ? `<div class="sh-ov" id="shOv"><p>${esc(info.overview)}</p></div>`
    : ovLive(info) ? '<div class="sh-ov" id="shOv"><p class="sh-sk" aria-hidden="true"><span></span><span></span><span></span></p></div>' : '';
  async function fillOv(info) {
    if (ovLive(info)) {
      const a = await fromApi(info.k); info.ovDone = true;
      if (current !== info) return;
      const full = String(a?.info?.overview || '').trim();
      if (full.length > (info.overview || '').length) info.overview = full;
      const el = $('#shOv'); if (!el) return;
      if (!info.overview) { el.remove(); return; }
      const fresh = el.querySelector('.sh-sk');
      el.innerHTML = `<p>${esc(info.overview)}</p>`;
      if (fresh && !reduce) el.firstChild.classList.add('sh-in');
    }
    const el = $('#shOv'), p = el?.firstChild; if (!p || current !== info) return;
    // only offer More when the text really runs past four lines
    if (p.scrollHeight > p.clientHeight + 2) el.classList.add('clip'), el.insertAdjacentHTML('beforeend', '<button type="button" class="sh-ovmore" data-act="more" aria-label="Read the whole description">More</button>');
  }
  async function fillCast(info) {
    const c = await castFor(info.k), sec = $('#shCast');
    if (current !== info || !sec) return;
    const star = $('#shStarring'), lead = (c?.cast || []).slice(0, 3);
    if (star) { if (lead.length) star.innerHTML = `<span>Starring</span> ${lead.map((p) => `<a href="./?p=${p.id}" data-p="${p.id}">${esc(p.name)}</a>`).join(', ')}`; else star.remove(); }
    const people = [...(c?.crew || []).slice(0, 2), ...(c?.cast || [])].filter((p, i, l) => l.findIndex((q) => q.id === p.id) === i);
    if (!people.length) return;
    sec.innerHTML = `<h3 id="shCC">Cast &amp; Crew</h3><ul class="sh-faces">${people.map((p) => `<li><a href="./?p=${p.id}" data-p="${p.id}">
      <span class="sh-face" style="--h:${hue(p.name)}">${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" decoding="async">` : esc(p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join(''))}</span>
      <b>${esc(p.name)}</b><small>${esc(p.role)}</small></a></li>`).join('')}</ul>`;
    sec.hidden = false;
  }
  // ---------- the lower half: episodes, trailers and extras, the film series, More Like This, reviews, Information ----------
  const longDate = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const shortDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(iso.slice(0, 4) !== String(new Date().getFullYear()) ? { year: 'numeric' } : {}) });
  const today = () => new Date().toISOString().slice(0, 10);
  // a row of posters (More Like This, the film series), each opening its own sheet
  function postersHtml(list, here) {
    return `<ul class="nr sh-nr">${list.map((t) => {
      const ph = `<span class="ph" style="background:linear-gradient(160deg,hsl(${hue(t.title)} 45% 42%),hsl(${(hue(t.title) + 40) % 360} 55% 18%))">${esc(t.title)}</span>`;
      const inner = `<span class="nr-art">${t.poster ? `<img src="${esc(t.poster)}" alt="" loading="lazy" decoding="async">` : ph}</span><b>${esc(t.title)}</b><small>${esc(t.k === here ? 'You’re here' : [t.year, t.rating ? `★ ${t.rating.toFixed(1)}` : ''].filter(Boolean).join(' · '))}</small>`;
      return `<li>${t.k === here ? `<span aria-current="page">${inner}</span>` : `<a href="?t=${esc(t.k)}" data-open="${esc(t.k)}">${inner}</a>`}</li>`;
    }).join('')}</ul>`;
  }
  const rowInfo = new Map();   // what each poster in those rows knows, for opening its sheet
  const remember = (list) => { for (const t of list) rowInfo.set(t.k, { ...t, tmdb: `https://www.themoviedb.org/${t.type}/${t.k.slice(1)}` }); return list; };
  // Episodes: the season menu, then the season's episodes side by side (Apple TV style), ticked off up to where you are
  function episodesSkel() { return `<ul class="sh-eps" aria-hidden="true">${'<li class="sk"><span class="sh-still"></span><b></b><small></small></li>'.repeat(3)}</ul>`; }
  function episodesHtml(info, m, n) {
    const ss = m?.seasons || []; if (!ss.length) return '';
    const opts = ss.map((s) => `<option value="${s.n}"${s.n === n ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    return `<section class="sh-sec sh-epsec" aria-labelledby="shE"><div class="sh-h"><h3 id="shE">Episodes</h3>
      ${ss.length > 1 ? `<label class="sh-seas"><span class="sh-vh">Season</span><select data-season>${opts}</select></label>` : `<span class="sh-seas1">${esc(ss[0].name)}</span>`}</div>
      <div id="shEps">${episodesSkel()}</div></section>`;
  }
  async function fillEpisodes(info, n) {
    const box = $('#shEps'); if (!box) return;
    const se = await seasonFor(info.k, n), el = $('#shEps');
    if (current !== info || !el || +($('[data-season]')?.value ?? n) !== n) return;
    if (!se?.eps?.length) { el.innerHTML = '<p class="sh-none">No episode details for this season yet.</p>'; return; }
    const p = progress.get(info.k), done = (e) => n > 0 && p && (n < p[0] || (n === p[0] && e <= p[1])), up = nextUp(p, shown?.items?.[info.k]?.sz);
    const now = today();
    // Spoiler shield (Settings, signed in): in a show you've started, what's after where you're up to is blurred until tapped
    const shield = !!p && window.tn.member() && window.tn.prefs.get().spoil;
    el.innerHTML = `<ul class="sh-eps">${se.eps.map((e) => {
      const sp = shield && n > 0 && !done(e.n), ah = sp ? ' class="sp" aria-hidden="true"' : '';
      const soon = e.date && e.date > now, when = e.date ? (soon ? `Out ${shortDate(e.date)}` : shortDate(e.date)) : '';
      const nextOne = up && up[0] === n && up[1] === e.n;
      return `<li${nextOne ? ' data-up' : ''}${soon || sp ? ` class="${[soon && 'soon', sp && 'spoil'].filter(Boolean).join(' ')}"` : ''}><span class="sh-still">${e.still ? `<img src="${esc(e.still)}" alt="" loading="lazy" decoding="async">` : ''}${sp ? '<button type="button" class="sh-unspoil" data-act="unspoil" aria-label="Show this episode’s name and description (it may spoil things)">Show</button>' : ''}${done(e.n) ? '<i class="sh-tick" aria-label="Watched"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 8.4 2.6 2.6L12 5.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></i>' : ''}</span>
        <small class="sh-epn">${nextOne ? 'Up next · ' : ''}Episode ${e.n}</small><b${ah}>${esc(e.name)}</b>${e.ov ? `<p${ah}>${esc(e.ov)}</p>` : ''}<small>${esc([when, runtime(e.rt)].filter(Boolean).join(' · '))}</small></li>`;
    }).join('')}</ul>`;
    if (!reduce) el.firstChild.classList.add('sh-in');
    if (shield && el.querySelector('.spoil')) window.tn.tip?.({ id: 'spoiler-shield', for: '#shEps .spoil .sh-unspoil', title: 'Spoiler shield', text: 'Episodes after where you’re up to are blurred so nothing gets spoiled. Tap Show to see one, or turn it off in Settings.' });
    // the row starts at the episode you're up to
    const row = el.firstChild, at = row.querySelector('[data-up]');
    if (at) row.scrollLeft = at.offsetLeft - row.firstChild.offsetLeft;
  }
  // Trailers & Extras: YouTube's pictures for each, playing in the artwork like the Trailer button
  const VTYPE = { Trailer: 'Trailer', Teaser: 'Teaser', Clip: 'Clip', Featurette: 'Featurette', 'Behind the Scenes': 'Behind the scenes', Bloopers: 'Bloopers' };
  const vidsHtml = (m) => (m?.vids?.length > (m.vids.length === 1 && m.vids[0].key === shown?.items?.[current?.k]?.tr ? 1 : 0) ? `<section class="sh-sec" aria-labelledby="shV"><h3 id="shV">Trailers &amp; Extras</h3>
    <ul class="sh-vids">${m.vids.map((v) => `<li><button type="button" data-vid="${esc(v.key)}" data-vname="${esc(v.name)}"><span class="sh-vimg"><img src="https://i.ytimg.com/vi/${esc(v.key)}/mqdefault.jpg" alt="" loading="lazy" decoding="async"><i aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M5 3.2v9.6L12.6 8z" fill="currentColor"/></svg></i></span>
      <b>${esc(v.name)}</b><small>${esc(VTYPE[v.type] || v.type)}</small></button></li>`).join('')}</ul></section>` : '');
  // reviews: the start of each, the whole thing on TMDB
  const revsHtml = (m) => (m?.reviews?.length ? `<section class="sh-sec" aria-labelledby="shR"><h3 id="shR">Reviews</h3><ul class="sh-revs">${m.reviews.map((r) => {
    const inner = `<span class="sh-rby"><b>${esc(r.by)}</b>${r.stars ? `<span class="sh-rst" aria-label="${r.stars} out of 10">★ ${esc(String(r.stars))}/10</span>` : ''}</span><p>${esc(r.text)}</p><small>${esc(r.at ? shortDate(r.at) : '')}${r.url ? ' · Read on TMDB' : ''}</small>`;
    return `<li>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${inner}</a>` : `<div>${inner}</div>`}</li>`;
  }).join('')}</ul></section>` : '');
  // Information, as at the foot of the Apple TV app's pages
  const usd = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2).replace(/\.?0+$/, '')} billion` : n >= 1e6 ? `$${Math.round(n / 1e6)} million` : `$${n.toLocaleString('en-GB')}`);
  const STATUS = { 'Returning Series': 'Returning series', Ended: 'Ended', Canceled: 'Cancelled', 'In Production': 'In production', Planned: 'Planned', Pilot: 'Pilot',
    Released: '', 'Post Production': 'Coming soon', Rumored: 'Rumoured' };
  let regionName = null; try { regionName = new Intl.DisplayNames(['en-GB'], { type: 'region' }); } catch {}
  const country = (c) => { try { return (c.length === 2 && regionName?.of(c)) || c; } catch { return c; } };
  function infoHtml(info, x, m) {
    const i = m?.info; if (!i) return '';
    const tv = info.type === 'tv', list = (l) => (l || []).join(', ');
    const rows = (tv ? [
      ['First shown', longDate(i.first)], ['Last shown', longDate(i.last)], ['On', list(i.networks)], ['Created by', list(i.creators)],
      ['Episodes', i.eps ? (() => { const n = x.se || (m.seasons || []).filter((s) => s.n > 0).length; return `${i.eps} across ${n} season${n === 1 ? '' : 's'}`; })() : ''],
      ['Status', STATUS[i.status] ?? i.status],
    ] : [
      ['Released', longDate(i.released)], ['Running time', runtime(x.rt)], ['Rated', x.c || ''], ['Studio', list(i.studios)],
      ['Budget', i.budget ? usd(i.budget) : ''], ['Box office', i.revenue ? usd(i.revenue) : ''], ['Status', STATUS[i.status] ?? ''],
    ]).concat([['Original language', i.lang || ''], [(i.countries || []).length > 1 ? 'Countries' : 'Country', list((i.countries || []).map(country))]]).filter(([, v]) => v);
    if (tv && i.studios?.length) rows.splice(4, 0, ['Studio', list(i.studios)]);
    return rows.length ? `<section class="sh-sec" aria-labelledby="shI"><h3 id="shI">Information</h3><dl class="sh-info">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>` : '';
  }
  let gen = 0;   // which drawing of the sheet is on screen, so a late answer only fills the drawing it was meant for
  async function fillMore(info) {
    const g = gen, m = await moreFor(info.k);
    if (g !== gen) return;
    if (current !== info || !m) { if (current === info) $('#shEpsWrap')?.remove(); return; }
    const x = shown?.items?.[info.k] || {};
    // the logo, where the hourly details didn't have one
    if (!x.lg && m.logo) showLogo(info, m.logo);
    // episodes, at the season you're up to
    const wrap = $('#shEpsWrap');
    if (wrap && info.type === 'tv') {
      const p = progress.get(info.k), up = nextUp(p, x.sz), ns = (m.seasons || []).map((s) => s.n);
      const n = [up?.[0], p?.[0], 1].find((v) => ns.includes(v)) ?? ns[0];
      wrap.outerHTML = episodesHtml(info, m, n); if (ns.length) fillEpisodes(info, n);
    }
    const series = m.col ? await seriesFor(m.col.id) : null;
    if (current !== info || g !== gen) return;
    remember(m.like || []); if (series?.parts) remember(series.parts);
    const vids = $('#shVidsWrap'), lower = $('#shLower');
    if (vids) vids.outerHTML = vidsHtml(m);
    if (lower) {
      lower.innerHTML = [
        series?.parts?.length > 1 ? `<section class="sh-sec" aria-labelledby="shS"><h3 id="shS">${esc(series.name)}</h3>${postersHtml(series.parts, info.k)}</section>` : '',
        m.like?.length ? `<section class="sh-sec" aria-labelledby="shL"><h3 id="shL">More Like This</h3>${postersHtml(m.like)}</section>` : '',
        revsHtml(m), infoHtml(info, x, m),
      ].join('');
      if (!reduce) for (const s of lower.children) s.classList.add('sh-in');
    }
    const foot = $('#shFoot');
    if (foot) foot.insertAdjacentHTML('beforeend', [m.imdb ? ` <a href="https://www.imdb.com/title/${esc(m.imdb)}/" target="_blank" rel="noopener">IMDb</a>` : '',
      m.home ? ` <a href="${esc(m.home)}" target="_blank" rel="noopener">Official site</a>` : ''].join(''));
  }
  // the logo over the artwork in place of the name, the Apple TV way: only once it has loaded, and only a light or colourful
  // one (a dark logo would vanish on the artwork's dark edge), so the name is never lost
  const okLogo = new Set();   // logos already checked: drawn straight away next time
  const logoTag = (info, src) => `<img class="sh-logo on" src="${esc(src)}" alt="${esc(info.title)}" crossorigin="anonymous">`;
  function showLogo(info, src) {
    const art = $('#shArt'); if (!art || art.querySelector('.sh-logo') || okLogo.has(src)) return;
    const img = new Image(); img.crossOrigin = 'anonymous'; img.alt = info.title; img.className = 'sh-logo'; img.decoding = 'async';
    img.onload = () => {
      if (current !== info || !art.isConnected) return;
      try {
        const c = document.createElement('canvas'), w = (c.width = 60), h = (c.height = Math.max(8, Math.round(60 * img.naturalHeight / img.naturalWidth)));
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
        const px = g.getImageData(0, 0, w, h).data; let lum = 0, n = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 128) { lum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; n++; }
        if (!n || lum / n < 110) return;   // too dark to read: the name stays
      } catch { return; }
      okLogo.add(src); art.append(img); $('#shT')?.classList.add('sh-vh'); art.classList.add('has-logo');
      requestAnimationFrame(() => img.classList.add('on'));
    };
    img.src = src;
  }
  function render(info, d) {
    gen++;
    const x = d?.items?.[info.k] || {};
    const lg = x.lg ? LOGO + x.lg : moreD.get(info.k)?.logo, lgOk = lg && okLogo.has(lg);
    // one quiet grey line under the description, the Apple TV way: genre · seasons · year · length · rating badge · stars
    const meta = [...(x.g?.length ? x.g : info.genres || []).slice(0, 2), info.type === 'tv' ? (x.se ? `${x.se} season${x.se === 1 ? '' : 's'}` : 'Series') : 'Film', info.year, runtime(x.rt),
      x.c ? `<b class="sh-cert">${esc(x.c)}</b>` : '', info.rating ? `★ ${Number(info.rating).toFixed(1)}` : ''].filter(Boolean);
    const art = info.backdrop ? `<img src="${esc(info.backdrop)}" alt="" decoding="async">`
      : info.poster ? `<img class="soft" src="${esc(info.poster)}" alt="" decoding="async">`
      : `<span class="ph" style="background:linear-gradient(160deg,hsl(${hue(info.title)} 45% 42%),hsl(${(hue(info.title) + 40) % 360} 55% 18%))"></span>`;
    body.innerHTML = `
      <div class="sh-art${lgOk ? ' has-logo' : ''}" id="shArt">${art}${info.poster ? `<img class="sh-poster" src="${esc(info.poster)}" alt="">` : ''}${lgOk ? logoTag(info, lg) : ''}</div>
      <div class="sh-body">
        ${eyeHtml(info.eye)}
        <h2 id="shT"${lgOk ? ' class="sh-vh"' : ''}>${esc(info.title)}</h2>
        ${nextHtml(info, x)}
        ${btnsHtml(info, x, d)}
        <div class="sh-about">
          <div class="sh-desc">${ovHtml(info)}<p class="sh-meta">${meta.map(String).map((m) => (m.startsWith('<b') ? m : esc(m))).join('<span aria-hidden="true"> · </span>')}</p></div>
          ${/^[mt]\d+$/.test(info.k || '') && window.tn.api ? '<p class="sh-starring" id="shStarring"></p>' : ''}
        </div>
        <section class="sh-where" aria-labelledby="shW"><h3 id="shW">Where to Watch</h3>${whereHtml(info, d)}</section>
        ${progressHtml(info, x)}
        ${mineHtml(info)}
        ${info.type === 'tv' && d ? `<section class="sh-sec sh-epsec" id="shEpsWrap" aria-label="Episodes"><div class="sh-h"><h3>Episodes</h3></div>${episodesSkel()}</section>` : ''}
        ${chartHtml(info)}
        <div id="shVidsWrap"></div>
        <section class="sh-cast" id="shCast" aria-labelledby="shCC" hidden></section>
        <div id="shLower"></div>
        <p class="sh-foot" id="shFoot">Where-to-watch information from JustWatch, via TMDB.${info.tmdb ? ` <a href="${esc(info.tmdb)}" target="_blank" rel="noopener">More on TMDB</a>` : ''}</p>
      </div>`;
    fillCast(info); fillOv(info);
    if ($('.sh-mine')) {   // Just for You (signed in) introduces itself, once each
      const tip = window.tn.tip;
      tip?.({ id: 'mark-watched', for: '.sh-seen', title: 'Mark as watched', text: 'Keep a list of everything you’ve watched. It’s on your Watchlist page, and by default it takes the title off your Watchlist too (change that in Settings).' });
      tip?.({ id: 'not-interested', for: '.sh-hide', title: 'Not interested', text: 'Not for you? Tap this and it stays out of Home, Browse, Discover and For You. Bring it back here or in Settings.' });
      tip?.({ id: 'private-notes', for: '.sh-note textarea', title: 'Your notes', text: 'Jot down why you saved something, or who recommended it. Only you can see it, and it shows under the title on your Watchlist.' });
    }
    if (lg && !lgOk) showLogo(info, lg);
    if (d) fillMore(info);
  }

  // ---------- open and close ----------
  const seenInfo = new Map();   // each title opened this visit, for Back inside the sheet
  async function open(info, fromUrl, opts) {
    if (!info) return;
    hideCard(true, true);
    if (info.k) seenInfo.set(info.k, info);
    info.watch ||= info.tmdb ? `${info.tmdb}/watch?locale=GB` : info.netflix || '#';
    if (!current) pageTitle = document.title;
    if (!sheet.open) { opener = fromUrl ? null : document.activeElement; firstPushed = !fromUrl; }
    current = info; moreFor(info.k);   // start on the lower half straight away
    render(info, null);
    sheet.style.translate = '';
    if (!sheet.open) sheet.showModal();
    document.documentElement.classList.add('sheet-up');
    requestAnimationFrame(() => sheet.classList.add('in'));
    body.scrollTop = 0; $('#shX').focus({ preventScroll: true });
    if (!fromUrl && info.k) {
      const u = new URL(location.href); u.searchParams.set('t', info.k);
      history.pushState({ sheet: info.k }, '', u); pushed++;
    }
    document.title = `${info.title} | Tenner`;
    let [d] = await Promise.all([details(), trail().then((t) => { trailD = t; }), prices().then((p) => { priceD = p; }), Promise.race([onAir().then((a) => { airD = a; }), new Promise((r) => setTimeout(r, 1500))])]);   // another site: never a reason to wait long
    if (current !== info) return;
    if (!d?.items?.[info.k] && window.tn.api) {
      render(info, { ...(d || {}), items: {}, pending: true });   // "Loading…" stays until the live details arrive
      const a = await fromApi(info.k);
      if (current !== info) return;
      if (a) { for (const [f, v] of Object.entries(a.info || {})) if (v && !info[f]) info[f] = v; d = a; }
    }
    shown = d; render(info, d);
    if (opts?.trailer && d?.items?.[info.k]?.tr) sheet.querySelector('[data-act="trailer"]')?.click();   // from a hover card's Trailer button
    else autoplay(info, d?.items?.[info.k]);
    // no wide artwork in the hourly data (This Week, the Watchlist, search): the search API has it; swap it in softly
    if (!info.backdrop && info.k && window.tn.api) {
      const a = await fromApi(info.k), bd = a?.info?.backdrop;
      if (!bd || current !== info) return;
      info.backdrop = bd;
      const old = $('#shArt > img:first-child, #shArt > .ph'); if (!old) return;
      const img = new Image(); img.alt = ''; img.src = bd;
      img.decode().catch(() => {}).then(() => {
        if (current !== info || !old.isConnected) return;
        img.style.opacity = '0'; old.replaceWith(img); requestAnimationFrame(() => { img.style.opacity = ''; });
      });
    }
  }
  // open a title by its key alone (a shared link to something Tenner doesn't follow)
  async function openKey(k) {
    const a = await fromApi(k); if (!a?.info || current) return false;
    open({ ...a.info, tmdb: `https://www.themoviedb.org/${a.info.type}/${k.slice(1)}` }, true); return true;
  }
  function close(fromHistory) {
    if (!current) return;
    current = null; clearTimeout(autoT); $('#shArt iframe')?.remove(); sheet.classList.remove('in');
    document.documentElement.classList.remove('sheet-up');
    const done = () => { if (!current) { sheet.close(); body.innerHTML = ''; } };
    reduce ? done() : setTimeout(done, 320);
    if (!fromHistory && pushed) { tidy = !firstPushed; history.go(-pushed); pushed = 0; }
    else if (!fromHistory) { const u = new URL(location.href); u.searchParams.delete('t'); history.replaceState(null, '', u); }
    if (fromHistory) pushed = 0;
    document.title = pageTitle;
    opener?.focus?.({ preventScroll: true });
    dispatchEvent(new Event('tn:sheet-closed'));
  }
  let tidy = false, firstPushed = false;   // a sheet opened from a link, then others from it: once back, the link's ?t= goes too
  addEventListener('popstate', () => {
    if (tidy) { tidy = false; const u = new URL(location.href); u.searchParams.delete('t'); history.replaceState(null, '', u); }
    if (!current) return;
    const t = new URL(location.href).searchParams.get('t');
    if (!t) { close(true); return; }
    // Back from a title opened in the sheet (More Like This, the film series): the one before it
    if (t !== current.k && seenInfo.has(t)) { pushed = Math.max(0, pushed - 1); open(seenInfo.get(t), true); }
  });
  $('#shX').addEventListener('click', () => close());
  // a tap on the dimmed page closes it; Escape (the dialog's own "cancel") too, with the slide-away
  sheet.addEventListener('click', (e) => {
    if (e.target !== sheet) return;
    const r = sheet.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });
  sheet.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

  // ---------- trailer and share ----------
  const embed = (key, muted) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&rel=0&playsinline=1${muted ? `&mute=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}` : ''}`;
  // on computers the trailer starts by itself a moment after a title opens, with the sound off (browsers only allow that),
  // as the Apple TV app does; never on phones, with Reduce Motion, Data Saver, or Settings → Start trailers by themselves off
  const desk = matchMedia('(hover: hover) and (pointer: fine) and (min-width: 720px)'), still = matchMedia('(prefers-reduced-motion: reduce)');
  let autoT = 0;
  function autoplay(info, x) {
    clearTimeout(autoT);
    const p = window.tn.prefs.get();
    if (!x?.tr || !desk.matches || still.matches || navigator.connection?.saveData || p.trailers !== 'here' || p.autoplay === false) return;
    autoT = setTimeout(() => {
      const art = $('#shArt'); if (current !== info || !art || art.classList.contains('playing') || art.classList.contains('auto')) return;
      const f = document.createElement('iframe');
      f.src = embed(x.tr, true); f.title = `Trailer: ${info.title}`; f.tabIndex = -1;
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.allowFullscreen = true;
      // the artwork stays until the player is ready, then the trailer fades in over it
      f.addEventListener('load', () => setTimeout(() => { if (f.isConnected) art.classList.add('auto'); }, 600), { once: true });
      art.append(f);
      art.insertAdjacentHTML('beforeend', '<button type="button" class="sh-sound" data-act="sound" aria-pressed="false" aria-label="Turn the trailer\'s sound on"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path class="off" d="m16 9.5 5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path class="on" d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.7 7.7 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>');
    }, 1200);
  }
  // the sound button talks to YouTube's player (its JavaScript API, by message)
  function sound(on) {
    const f = $('#shArt iframe'), b = $('#shArt .sh-sound'); if (!f || !b) return;
    f.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: on ? 'unMute' : 'mute', args: [] }), 'https://www.youtube-nocookie.com');
    if (on) f.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }), 'https://www.youtube-nocookie.com');
    b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? 'Turn the trailer\'s sound off' : 'Turn the trailer\'s sound on');
  }
  // played in place, at the top, from YouTube's privacy-enhanced player (or on YouTube, if Settings says so)
  function play(key, title) {
    if (window.tn.prefs.get().trailers === 'youtube') { window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(key)}`, '_blank', 'noopener'); return; }
    clearTimeout(autoT);
    $('#shArt').innerHTML = `<iframe src="${embed(key)}" title="${esc(title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    $('#shArt').classList.remove('auto', 'has-logo'); $('#shArt').classList.add('playing'); $('#shT')?.classList.remove('sh-vh');
    body.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }
  let thanksT = 0;
  sheet.addEventListener('click', (e) => {
    // a poster in More Like This or the film series: its own sheet, in place (Back returns here)
    const o = e.target.closest('[data-open]');
    if (o && current && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); const t = rowInfo.get(o.dataset.open); if (t) open({ ...t }); return; }
    const v = e.target.closest('[data-vid]');
    if (v && current) play(v.dataset.vid, v.dataset.vname || current.title);
  });
  sheet.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b || !current) return;
    if (b.dataset.act === 'more') { b.parentElement.classList.add('open'); b.remove(); return; }
    if (b.dataset.act === 'trailer') {
      const key = (shown || await details())?.items?.[current.k]?.tr; if (!key) return;
      // already playing by itself with the sound off: Trailer just turns the sound on
      if ($('#shArt').classList.contains('auto')) { sound(true); body.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); return; }
      play(key, `Trailer: ${current.title}`);
    }
    if (b.dataset.act === 'sound') sound(b.getAttribute('aria-pressed') !== 'true');
    if (b.dataset.act === 'save') {
      const on = saved.toggle(current);
      b.outerHTML = saveBtn(on); sheet.querySelector('.sh-save')?.focus({ preventScroll: true });
    }
    if (b.dataset.act === 'star') {
      const on = window.tn.stars.toggle(current.k);
      b.outerHTML = starBtn(on); const nb = sheet.querySelector('.sh-star'); nb?.focus({ preventScroll: true });
      if (on && !reduce && nb?.animate) nb.querySelector('svg').animate([{ scale: 1 }, { scale: 1.35 }, { scale: 1 }], { duration: 420, easing: 'cubic-bezier(.3,1.6,.5,1)' });
      if (on) navigator.vibrate?.(10);
      const t = $('#shThanks'); clearTimeout(thanksT);
      t.textContent = on ? 'Thanks. We’ll use the shows and films you like to offer you better recommendations.' : ''; t.classList.toggle('in', on);
      if (on) thanksT = setTimeout(() => t.classList.remove('in'), 4500);
    }
    if (b.dataset.act === 'seen') {
      const on = !window.tn.seen.has(current.k); window.tn.seen.set(current, on ? 1 : 0);
      const off = on && window.tn.prefs.get().seenoff !== false && saved.has(current.k);
      if (off) { saved.remove(current.k); const sv = sheet.querySelector('.sh-save'); if (sv) sv.outerHTML = saveBtn(false); }
      b.outerHTML = seenBtn(on); sheet.querySelector('.sh-seen')?.focus({ preventScroll: true });
      if (on) navigator.vibrate?.(10);
      msay(on ? (off ? 'On your Watched list, and off your Watchlist' : 'On your Watched list') : 'Taken off your Watched list');
    }
    if (b.dataset.act === 'hide') {
      const on = !window.tn.hidden.has(current.k); window.tn.hidden.set(current, on ? 1 : 0);
      b.outerHTML = hideBtn(on); sheet.querySelector('.sh-hide')?.focus({ preventScroll: true });
      msay(on ? (window.tn.prefs.get().hideni !== false ? 'Hidden from Home, Browse, Discover and For You. Bring it back here or in Settings' : 'Marked as not interested') : 'It’s back');
    }
    if (b.dataset.act === 'unspoil') { const li = b.closest('li'); li.classList.remove('spoil'); li.querySelectorAll('[aria-hidden="true"].sp').forEach((el) => el.removeAttribute('aria-hidden')); b.remove(); }
    if (b.dataset.act === 'watched' || b.dataset.act === 'reset') {
      const x = shown?.items?.[current.k]; if (!x?.sz) return;
      if (b.dataset.act === 'reset') progress.set(current.k, null);
      else { const up = nextUp(progress.get(current.k), x.sz); if (up) progress.set(current.k, up); if (!saved.has(current.k)) saved.toggle(current); }
      redrawProgress(b.dataset.act);
    }
    if (b.dataset.act === 'share') {
      // a title with its own page (t/m123/, built hourly) shares that, so the link's preview shows its artwork and name
      const page = !!dataD?.items?.[current.k], url = new URL(page ? `t/${current.k}/` : location.href, location.href); if (current.k && !page) url.searchParams.set('t', current.k);
      window.tn.share({ heading: `Share ${current.title} with someone who'd like it`, title: `${current.title} on Tenner`, text: `Where to watch ${current.title} in the UK`, url: url.toString() });
    }
  });

  // the keyboard, as in Apple's apps: W for Watchlist, T for the trailer, S to share, E to mark the next episode watched
  const KEYS = { w: 'save', t: 'trailer', s: 'share', e: 'watched' };
  sheet.addEventListener('keydown', (e) => {
    const act = KEYS[e.key.toLowerCase()];
    if (!act || e.metaKey || e.ctrlKey || e.altKey || e.repeat || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const b = sheet.querySelector(`[data-act="${act}"]`); if (!b) return;
    e.preventDefault(); b.click();
  });

  // your note saves as you type (a moment after you stop), and when you leave the box
  let noteT = 0;
  const saveNote = (el) => { clearTimeout(noteT); if (!current) return; const t = el.value.trim(), was = window.tn.notes.get(current.k)?.[0] || '';
    if (t === was) return; window.tn.notes.set(current, t || 0); msay(t ? 'Note saved' : 'Note removed'); };
  sheet.addEventListener('input', (e) => { const el = e.target.closest('[data-note]'); if (el) { clearTimeout(noteT); noteT = setTimeout(() => saveNote(el), 800); } });
  sheet.addEventListener('focusout', (e) => { const el = e.target.closest?.('[data-note]'); if (el) saveNote(el); });

  // choosing a season or episode from the menus
  function redrawProgress(focus) {
    const sec = sheet.querySelector('.sh-prog'), x = shown?.items?.[current?.k]; if (!sec || !x) return;
    sec.outerHTML = progressHtml(current, x);
    const save = sheet.querySelector('.sh-save'); if (save) save.outerHTML = saveBtn(saved.has(current.k));
    const ss = sheet.querySelector('[data-season]'); if (ss || $('#shEps .sh-eps:not([aria-hidden])')) fillEpisodes(current, ss ? +ss.value : (moreD.get(current.k)?.seasons?.[0]?.n ?? 1));
    sheet.querySelector(focus === 'watched' ? '[data-act="watched"], [data-pr="e"]' : focus === 'reset' ? '[data-pr="s"]' : `[data-pr="${focus}"]`)?.focus({ preventScroll: true });
  }
  sheet.addEventListener('change', (e) => {
    const ss = e.target.closest('[data-season]');
    if (ss && current) { $('#shEps').innerHTML = episodesSkel(); fillEpisodes(current, +ss.value); return; }
    const sel = e.target.closest('[data-pr]'); if (!sel || !current) return;
    const x = shown?.items?.[current.k]; if (!x?.sz) return;
    const p = progress.get(current.k);
    let s = +sheet.querySelector('[data-pr="s"]').value || 1, ep = sel.dataset.pr === 's' ? (p && p[0] === s ? p[1] : 1) : +sel.value || 1;
    ep = Math.min(ep, x.sz[s - 1] || ep);
    progress.set(current.k, [s, ep]); if (!saved.has(current.k)) saved.toggle(current);
    redrawProgress(sel.dataset.pr);
  });

  // ---------- phones: swipe the sheet down to close it ----------
  let drag = null;
  sheet.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !matchMedia('(max-width: 719px)').matches) return;
    if (!e.target.closest('.sh-grab, .sh-art') || e.target.closest('iframe')) return;   // from the handle or the artwork
    drag = { id: e.pointerId, y0: e.clientY, dy: 0 };
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dy = Math.max(0, e.clientY - drag.y0);
    if (drag.dy > 6) { sheet.classList.add('dragging'); sheet.style.translate = `0 ${drag.dy}px`; }
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const far = drag.dy > 110; drag = null; sheet.classList.remove('dragging');
    if (far) close(); else sheet.style.translate = '';
  };
  sheet.addEventListener('pointerup', endDrag); sheet.addEventListener('pointercancel', endDrag);

  // ---------- hover cards (computers): rest the pointer on a poster and it opens up into a card ----------
  // Wide artwork, the title, genre, age rating and length, a Watch button with Watchlist and Trailer beside it, a short
  // description and who's in it; click anywhere else on it for the full sheet. Only with a mouse or trackpad: on touch
  // screens a tap opens the sheet, as before. Pages say which posters get one with tnSheet.hover(selector, el → info).
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const calm = () => reduce || document.documentElement.classList.contains('still');
  const hovers = [], ART = '.nr-art, .art, .pp-art, .cover, img';   // what a card grows out of: the poster
  const hc = Object.assign(document.createElement('div'), { className: 'hc', hidden: true });
  hc.setAttribute('role', 'group'); document.body.append(hc);
  let card = null, hcT = 0, hcWait = null, hcTok = 0, hcShut = 0, hcDirty = false;
  const PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>';
  const ADD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="p" d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="c" d="m5.5 12.5 4.2 4.2 8.8-9.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const FILM = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.2 9.4v5.2l4.4-2.6z" fill="currentColor"/></svg>';
  const cardArt = (info) => info.backdrop ? `<img src="${esc(info.backdrop)}" alt="" decoding="async">`
    : info.poster ? `<img class="soft" src="${esc(info.poster)}" alt="" decoding="async">`
    : `<span class="ph" style="background:linear-gradient(160deg,hsl(${hue(info.title)} 45% 42%),hsl(${(hue(info.title) + 40) % 360} 55% 18%))"></span>`;
  const saveRound = (on) => `<button type="button" class="btn btn-tinted hc-r" data-hc="save" aria-pressed="${on}" aria-label="${on ? 'In your Watchlist' : 'Add to Watchlist'}" title="${on ? 'In your Watchlist' : 'Add to Watchlist'}">${ADD}</button>`;
  function cardBody({ info, d, cast }) {
    const x = d?.items?.[info.k] || {};
    const meta = [(x.g?.length ? x.g : info.genres || [])[0], x.c ? `<b class="sh-cert">${esc(x.c)}</b>` : '',
      info.type === 'tv' ? (x.se ? `${x.se} season${x.se === 1 ? '' : 's'}` : 'Series') : runtime(x.rt) || 'Film', info.year].filter(Boolean)
      .map((m) => (String(m).startsWith('<b') ? m : esc(String(m)))).join('<span aria-hidden="true"> · </span>');
    const on = watchOn(info, d);
    const main = on ? `<a class="btn btn-tinted hc-go" href="${esc(on.href)}" target="_blank" rel="noopener">${PLAY}<span>Watch on ${esc(on.name)}</span></a>`
      : `<button type="button" class="btn btn-tinted hc-go" data-hc="open"><span>Where to watch</span></button>`;
    const people = (cast?.cast || []).slice(0, 3);
    const names = people.map((p) => p.name), who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || '';
    return `<h3>${esc(info.title)}</h3>
      <p class="hc-meta">${meta}</p>
      <div class="hc-acts">${main}${info.k ? saveRound(saved.has(info.k)) : ''}${x.tr ? `<button type="button" class="btn btn-tinted hc-r" data-hc="trailer" aria-label="Play the trailer" title="Trailer">${FILM}</button>` : ''}</div>
      ${info.overview ? `<p class="hc-ov">${esc(info.overview)}</p>` : d && !ovLive(info) ? '' : '<p class="hc-ov sh-sk" aria-hidden="true"><span></span><span></span></p>'}
      ${people.length ? `<p class="hc-cast"><span class="hc-faces" aria-hidden="true">${people.map((p) => `<span style="--h:${hue(p.name)}">${p.photo ? `<img src="${esc(p.photo)}" alt="" decoding="async">` : esc(p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join(''))}</span>`).join('')}</span><span class="hc-who">${esc(who)}</span></p>`
        : cast === undefined && window.tn.api && /^[mt]\d+$/.test(info.k || '') ? '<p class="hc-cast hc-wait" aria-hidden="true"><span class="hc-faces"><span></span><span></span></span></p>' : ''}`;
  }
  const redraw = () => { if (card) $('.hc-body', hc).innerHTML = cardBody(card); };
  function place() {
    const a = card?.anchor; if (!a?.isConnected) return hideCard(true);
    const r = a.getBoundingClientRect(), clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    hc.style.width = `${Math.round(clamp(r.width * 1.6, 320, 420))}px`;   // half as wide again as the poster, at least
    const w = hc.offsetWidth, h = hc.offsetHeight;
    const list = card.el.closest('ul, ol') || document.body, edge = list.getBoundingClientRect().left + parseFloat(getComputedStyle(list).paddingLeft || 0);
    const left = clamp(r.left + r.width / 2 - w / 2, Math.max(12, edge - 12), innerWidth - w - 12);   // never out over the sidebar
    const top = clamp(r.top - (h - r.height) * 0.3, 12, innerHeight - h - 12);
    hc.style.left = `${left}px`; hc.style.top = `${top}px`;
    return { r, left, top, w, h };
  }
  async function showCard(el, resolve) {
    const tok = ++hcTok, info = await resolve(el);
    if (tok !== hcTok || !info || !el.isConnected || current || !el.matches(':hover')) return;
    card = { info, el, anchor: el.querySelector(ART) || el.closest('li')?.querySelector(ART) || el, d: dataD, cast: undefined }; hcDirty = false;
    hc.getAnimations().forEach((a) => a.cancel());
    hc.setAttribute('aria-label', info.title);
    hc.innerHTML = `<div class="hc-art">${cardArt(info)}</div><div class="hc-body">${cardBody(card)}</div>`;
    hc.hidden = false;
    const p = place(); if (!p) return;
    // it grows out of the poster: from the poster's size and place to its own, on a spring
    if (!calm() && hc.animate) {
      const s = p.r.width / p.w, dx = p.r.left + p.r.width / 2 - (p.left + p.w / 2), dy = p.r.top + p.r.height / 2 - (p.top + p.h / 2);
      hc.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }], { duration: 460, easing: 'cubic-bezier(.25, 1.12, .4, 1)' });
      hc.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    } else if (!reduce && hc.animate) hc.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
    const c = card;
    // what isn't here yet: the hour's details (or, for a title Tenner doesn't follow, the search API's), the
    // description and wider artwork, and the lead cast
    (async () => {
      let d = await details();
      if (!d?.items?.[info.k] && window.tn.api) { const a = await fromApi(info.k); if (a) { for (const [f, v] of Object.entries(a.info || {})) if (v && !info[f]) info[f] = v; d = a; } }
      if (card !== c) return; c.d = d || {}; redraw();
      if (ovLive(info) || !info.backdrop) {
        const a = await fromApi(info.k); if (card !== c) return;
        const full = String(a?.info?.overview || '').trim(); if (full.length > (info.overview || '').length) info.overview = full;
        if (!info.backdrop && a?.info?.backdrop) info.backdrop = a.info.backdrop;
        info.ovDone = true; redraw();
      }
      // the wide artwork, if it only arrived now: swapped in softly
      if (info.backdrop && !$('.hc-art img:not(.soft)', hc)) {
        const img = new Image(); img.alt = ''; img.src = info.backdrop;
        img.decode().catch(() => {}).then(() => { if (card === c) $('.hc-art', hc).replaceChildren(img); });
      }
    })();
    castFor(info.k).then((x) => { if (card !== c) return; c.cast = x; redraw(); if (hc.getBoundingClientRect().bottom > innerHeight - 8) place(); });
  }
  function hideCard(now, toSheet) {
    clearTimeout(hcT); hcWait = null; hcTok++;
    if (!card) return;
    card = null; hcShut = Date.now();
    const done = () => { if (!card) { hc.hidden = true; hc.innerHTML = ''; } };
    if (now || calm() || !hc.animate) done();
    else hc.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.96)' }], { duration: 160, easing: 'ease-in' }).finished.then(done, done);
    // pages redraw for Watchlist changes once it's gone, as after the sheet (or after the sheet it's opening, which says so itself)
    if (hcDirty) { hcDirty = false; if (!toSheet) dispatchEvent(new Event('tn:sheet-closed')); }
  }
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || !fine.matches || current || hc.contains(e.target)) return;
    for (const [sel, resolve] of hovers) {
      const el = e.target.closest(sel); if (!el) continue;
      if (el === card?.el || el === hcWait) return;
      details(); clearTimeout(hcT); hcWait = el;
      // a moment's rest first, so sweeping across the page doesn't set them off; quicker from one card to the next
      hcT = setTimeout(() => { hcWait = null; showCard(el, resolve); }, card || Date.now() - hcShut < 800 ? 150 : 520);
      return;
    }
  });
  document.addEventListener('pointerout', (e) => { if (hcWait && !hcWait.contains(e.relatedTarget)) { clearTimeout(hcT); hcWait = null; } });
  document.addEventListener('pointerdown', (e) => { if (!hc.contains(e.target)) hideCard(true); }, true);
  hc.addEventListener('pointerleave', () => hideCard());
  addEventListener('scroll', (e) => { if (card && (e.target === document || e.target.contains?.(card.el))) hideCard(true); }, { capture: true, passive: true });
  addEventListener('resize', () => hideCard(true)); addEventListener('blur', () => hideCard(true));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCard(); });
  hc.addEventListener('click', (e) => {
    if (!card || e.target.closest('a')) return;   // Watch on …: off to the service, in a new tab
    const { info, el } = card, b = e.target.closest('[data-hc]');
    if (b?.dataset.hc === 'save') {
      const on = saved.toggle(info); hcDirty = true;
      b.outerHTML = saveRound(on); navigator.vibrate?.(10);
      const nb = $('[data-hc="save"]', hc); if (on && !calm() && nb?.animate) nb.animate([{ scale: 1 }, { scale: 1.18 }, { scale: 1 }], { duration: 380, easing: 'cubic-bezier(.3,1.6,.5,1)' });
      return;
    }
    if (b?.dataset.hc === 'trailer') {
      const key = card.d?.items?.[info.k]?.tr;
      if (key && window.tn.prefs.get().trailers === 'youtube') { window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(key)}`, '_blank', 'noopener'); return; }   // Settings: "Play trailers"
    }
    // anywhere else (or Trailer): the full sheet, and focus comes back to the poster when it closes
    hideCard(true); el.focus?.({ preventScroll: true });
    open(info, false, { trailer: b?.dataset.hc === 'trailer' });
  });
  const hover = (sel, resolve) => { hovers.push([sel, resolve]); };

  window.tnSheet = { open, openKey, close, isOpen: () => !!current || !!card, details, hover };
})();

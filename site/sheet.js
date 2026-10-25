// Tenner's title sheet: tap a title anywhere and see where to watch it in the UK without leaving Tenner, the Apple TV
// app way. Artwork, title, year, running time, age rating, star rating, genres, the description, a trailer, and where
// to watch grouped as Included with, Free, Rent and Buy. A bottom sheet on phones (swipe it down to close), a centred
// card on computers. The address gains ?t=… so a title can be shared, and Back closes it.
// Details come from data/titles.json (rebuilt hourly), fetched the first time a sheet opens.
(() => {
  const { esc, hue, reduce, saved, progress, nextUp, whenText } = window.tn;
  // the chart history (data/trail.json: each charted title's recent ranks), loaded with the first sheet
  let trailP = null;
  const trail = () => (trailP ||= fetch(`data/trail.json?v=${Math.floor(Date.now() / 600000)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  // what it costs to rent or buy (data/prices.json, the buy-or-rent chart's titles), loaded with the first sheet too
  let priceP = null, priceD = null;
  const prices = () => (priceP ||= fetch(`data/prices.json?v=${Math.floor(Date.now() / 600000)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  // On TV this week: Freeview showings from Tenner TV's listings (rebuilt every three hours), loaded with the first sheet
  let airP = null, airD = null;
  const onAir = () => (airP ||= fetch('https://tenner-tv.danseacroft.workers.dev/api/onair').then((r) => (r.ok ? r.json() : null)).catch(() => null));
  addEventListener('tn:check', () => { trailP = null; priceP = null; airP = null; });
  let trailD = null;
  const CHART = { all: 'in the UK', netflix: 'on Netflix', disney: 'on Disney+', prime: 'on Prime Video', hbomax: 'on HBO Max', paramount: 'on Paramount+' };

  // ---------- trackers ----------
  // On the chart: a line of the title's rank (No. 1 at the top) over the last month, or the last day while the history
  // is still building up, gaps where it was out of the top 10; and its life on the charts so far (days in the top 10,
  // its peak, days at No. 1, when it first charted)
  const SVC = { netflix: 'Netflix', disney: 'Disney+', prime: 'Prime Video', hbomax: 'HBO Max', paramount: 'Paramount+' };
  function lifeHtml(p) {
    if (!p?.n) return '';
    const peak = p.u ? `Peaked at No. ${p.u} in the UK` : p.b ? `Peaked at No. ${p.b[0]} on ${SVC[p.b[1]] || p.b[1]}` : '';
    const first = new Date(p.f + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', ...(p.f.slice(0, 4) !== String(new Date().getFullYear()) ? { year: 'numeric' } : {}) });
    const cells = [[p.n, p.n === 1 ? 'day in a Top 10' : 'days in a Top 10'], peak && [peak.match(/No\. \d+/)[0], peak.replace(/^Peaked at No\. \d+ /, 'peak ')], p.o ? [p.o, p.o === 1 ? 'day at No. 1' : 'days at No. 1'] : null].filter(Boolean);
    return `<dl class="sh-life">${cells.map(([v, l]) => `<div><dt>${esc(String(v))}</dt><dd>${esc(l)}</dd></div>`).join('')}</dl><p class="sh-first">First charted ${esc(first)}</p>`;
  }
  function chartHtml(info) {
    const t = trailD?.items?.[info.k]; if (!t) return '';
    const byDay = t.d.filter(Boolean).length >= 3, r = byDay ? t.d : t.h, when = byDay ? trailD.days : trailD.hours;
    if (r.filter(Boolean).length < 2) return t.p ? `<section class="sh-track" aria-labelledby="shC"><h3 id="shC">On the Chart</h3>${lifeHtml(t.p)}</section>` : '';
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
      </svg>${lifeHtml(t.p)}</section>`;
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
        ${up ? `<button type="button" class="btn btn-tinted" data-act="watched">Mark S${up[0]} E${up[1]} watched</button>` : ''}
        ${p ? '<button type="button" class="btn btn-tinted sh-reset" data-act="reset" aria-label="Clear progress" title="Clear progress">Clear</button>' : ''}
      </div>
      <p class="sh-pstat">${esc(status)}${p && !(p[0] === last[0] && p[1] === last[1]) ? ` · ${x.sz.reduce((a, n) => a + n, 0) - (x.sz.slice(0, p[0] - 1).reduce((a, n) => a + n, 0) + p[1])} episodes to go` : ''}</p>
    </section>`;
  }
  // the Watchlist button: a bookmark that fills in once saved
  const saveBtn = (on) => `<button type="button" class="btn btn-tinted sh-save${on ? ' on' : ''}" data-act="save" aria-pressed="${on}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11v17L12 16.6 6.5 20.5z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>${on ? 'In Watchlist' : 'Watchlist'}</button>`;
  // the star (phones): tells Tenner you like this, for better recommendations; it does nothing else
  const starBtn = (on) => `<button type="button" class="btn btn-tinted sh-star${on ? ' on' : ''}" data-act="star" aria-pressed="${on}" aria-label="${on ? 'Starred' : 'Star'}: tell Tenner you like this" title="${on ? 'Starred' : 'Star it, for better recommendations'}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.5l-5.1 2.7 1-5.6-4.1-4 5.7-.8z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg></button>`;
  const $ = (s, el = document) => el.querySelector(s);
  let dataP = null;
  const details = () => (dataP ||= fetch(`data/titles.json?v=${Math.floor(Date.now() / 600000)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
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
  let current = null, opener = null, pushed = false, pageTitle = document.title;

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
  // the actions, the Apple TV way: one wide filled button for the main thing (the trailer, or Netflix), then the rest
  // side by side in equal widths
  function btnsHtml(info, x) {
    const nf = info.netflix || (x.ln?.nf ? `https://www.netflix.com/title/${x.ln.nf}` : '');
    const trailer = x.tr ? `<button type="button" class="btn btn-tinted" data-act="trailer"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>Trailer</button>` : '';
    const netflix = nf ? `<a class="btn btn-tinted" href="${esc(nf)}" target="_blank" rel="noopener"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>Watch on Netflix</a>` : '';
    const share = `<button type="button" class="btn btn-tinted" data-act="share"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11v8.5h12V11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Share</button>`;
    const main = netflix || trailer, rest = [netflix ? trailer : '', info.k ? saveBtn(saved.has(info.k)) : '', info.k ? starBtn(window.tn.stars.has(info.k)) : '', share].filter(Boolean);
    return `<div class="sh-btns">${main ? `<div class="sh-main">${main}</div>` : ''}<div class="sh-more">${rest.join('')}</div><p class="sh-thanks" id="shThanks" role="status"></p></div>`;
  }
  // Cast & Crew: round faces in a row, each opening that person's page (people.html), from the search API
  const castCache = new Map();
  const castFor = (k) => {
    if (!window.tn.api || !/^[mt]\d+$/.test(k || '')) return Promise.resolve(null);
    if (!castCache.has(k)) castCache.set(k, fetch(`${window.tn.api}/credits/${k}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    return castCache.get(k);
  };
  async function fillCast(info) {
    const c = await castFor(info.k), sec = $('#shCast');
    if (current !== info || !sec) return;
    const people = [...(c?.crew || []).slice(0, 2), ...(c?.cast || [])].filter((p, i, l) => l.findIndex((q) => q.id === p.id) === i);
    if (!people.length) return;
    sec.innerHTML = `<h3 id="shCC">Cast &amp; Crew</h3><ul class="sh-faces">${people.map((p) => `<li><a href="people.html?p=${p.id}" data-p="${p.id}">
      <span class="sh-face" style="--h:${hue(p.name)}">${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" decoding="async">` : esc(p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join(''))}</span>
      <b>${esc(p.name)}</b><small>${esc(p.role)}</small></a></li>`).join('')}</ul>`;
    sec.hidden = false;
  }
  function render(info, d) {
    const x = d?.items?.[info.k] || {};
    const meta = [info.type === 'tv' ? (x.se ? `${x.se} season${x.se === 1 ? '' : 's'}` : 'Series') : 'Film', info.year, runtime(x.rt),
      x.c ? `<b class="sh-cert">${esc(x.c)}</b>` : '', info.rating ? `★ ${Number(info.rating).toFixed(1)}` : ''].filter(Boolean);
    const genres = (x.g?.length ? x.g : info.genres || []).join(' · ');
    const art = info.backdrop ? `<img src="${esc(info.backdrop)}" alt="" decoding="async">`
      : info.poster ? `<img class="soft" src="${esc(info.poster)}" alt="" decoding="async">`
      : `<span class="ph" style="background:linear-gradient(160deg,hsl(${hue(info.title)} 45% 42%),hsl(${(hue(info.title) + 40) % 360} 55% 18%))"></span>`;
    body.innerHTML = `
      <div class="sh-art" id="shArt">${art}${info.poster ? `<img class="sh-poster" src="${esc(info.poster)}" alt="">` : ''}</div>
      <div class="sh-body">
        ${eyeHtml(info.eye)}
        <h2 id="shT">${esc(info.title)}</h2>
        <p class="sh-meta">${meta.map(String).map((m) => (m.startsWith('<b') ? m : esc(m))).join('<span aria-hidden="true"> · </span>')}</p>
        ${genres ? `<p class="sh-genres">${esc(genres)}</p>` : ''}
        ${nextHtml(info, x)}
        ${btnsHtml(info, x)}
        ${x.tl ? `<p class="sh-tl">${esc(x.tl)}</p>` : ''}
        ${info.overview ? `<p class="sh-ov">${esc(info.overview)}</p>` : ''}
        <section class="sh-where" aria-labelledby="shW"><h3 id="shW">Where to Watch</h3>${whereHtml(info, d)}</section>
        ${progressHtml(info, x)}
        ${chartHtml(info)}
        <section class="sh-cast" id="shCast" aria-labelledby="shCC" hidden></section>
        <p class="sh-foot">Where-to-watch information from JustWatch, via TMDB.${info.tmdb ? ` <a href="${esc(info.tmdb)}" target="_blank" rel="noopener">More on TMDB</a>` : ''}</p>
      </div>`;
    fillCast(info);
  }

  // ---------- open and close ----------
  async function open(info, fromUrl) {
    if (!info) return;
    info.watch ||= info.tmdb ? `${info.tmdb}/watch?locale=GB` : info.netflix || '#';
    if (!current) pageTitle = document.title;
    current = info; opener = fromUrl ? null : document.activeElement;
    render(info, null);
    sheet.style.translate = '';
    if (!sheet.open) sheet.showModal();
    document.documentElement.classList.add('sheet-up');
    requestAnimationFrame(() => sheet.classList.add('in'));
    body.scrollTop = 0; $('#shX').focus({ preventScroll: true });
    if (!fromUrl && info.k) {
      const u = new URL(location.href); u.searchParams.set('t', info.k);
      history.pushState({ sheet: info.k }, '', u); pushed = true;
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
    current = null; sheet.classList.remove('in');
    document.documentElement.classList.remove('sheet-up');
    const done = () => { if (!current) { sheet.close(); body.innerHTML = ''; } };
    reduce ? done() : setTimeout(done, 320);
    if (!fromHistory && pushed) { pushed = false; history.back(); }
    else if (!fromHistory) { const u = new URL(location.href); u.searchParams.delete('t'); history.replaceState(null, '', u); }
    pushed = fromHistory ? false : pushed;
    document.title = pageTitle;
    opener?.focus?.({ preventScroll: true });
    dispatchEvent(new Event('tn:sheet-closed'));
  }
  addEventListener('popstate', () => { if (current && !new URL(location.href).searchParams.get('t')) close(true); });
  $('#shX').addEventListener('click', () => close());
  // a tap on the dimmed page closes it; Escape (the dialog's own "cancel") too, with the slide-away
  sheet.addEventListener('click', (e) => {
    if (e.target !== sheet) return;
    const r = sheet.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });
  sheet.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

  // ---------- trailer and share ----------
  let thanksT = 0;
  sheet.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b || !current) return;
    if (b.dataset.act === 'trailer') {
      const key = (shown || await details())?.items?.[current.k]?.tr; if (!key) return;
      if (window.tn.prefs.get().trailers === 'youtube') { window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(key)}`, '_blank', 'noopener'); return; }   // Settings: "Play trailers"
      // played in place, from YouTube's privacy-enhanced player, only when asked
      $('#shArt').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&rel=0&playsinline=1" title="Trailer: ${esc(current.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
      $('#shArt').classList.add('playing'); body.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    }
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
    if (b.dataset.act === 'watched' || b.dataset.act === 'reset') {
      const x = shown?.items?.[current.k]; if (!x?.sz) return;
      if (b.dataset.act === 'reset') progress.set(current.k, null);
      else { const up = nextUp(progress.get(current.k), x.sz); if (up) progress.set(current.k, up); if (!saved.has(current.k)) saved.toggle(current); }
      redrawProgress(b.dataset.act);
    }
    if (b.dataset.act === 'share') {
      const url = new URL(location.href); if (current.k) url.searchParams.set('t', current.k);
      window.tn.share({ heading: `Share ${current.title} with someone who'd like it`, title: `${current.title} on Tenner`, text: `Where to watch ${current.title} in the UK`, url: url.toString() });
    }
  });

  // choosing a season or episode from the menus
  function redrawProgress(focus) {
    const sec = sheet.querySelector('.sh-prog'), x = shown?.items?.[current?.k]; if (!sec || !x) return;
    sec.outerHTML = progressHtml(current, x);
    const save = sheet.querySelector('.sh-save'); if (save) save.outerHTML = saveBtn(saved.has(current.k));
    sheet.querySelector(focus === 'watched' ? '[data-act="watched"], [data-pr="e"]' : focus === 'reset' ? '[data-pr="s"]' : `[data-pr="${focus}"]`)?.focus({ preventScroll: true });
  }
  sheet.addEventListener('change', (e) => {
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

  window.tnSheet = { open, openKey, close, isOpen: () => !!current, details };
})();

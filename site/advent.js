// Tenner's Christmas calendar: 25 doors, one a day from 1 to 25 December. Behind each, a film or show picked at random
// when you open it (mostly Christmas favourites, sometimes something big we think you'll enjoy), kept on this device so it's
// the same next time you look. Opened from the homepage's Christmas slide with any [data-adv="open"]
// button. A door swings open on its hinge with a burst of gold sparkles and the pick comes forward on a card; close the
// calendar and it fades away, and the first time its box fades in at the top of the right-hand column (where it shows today's door from then on).
// No door opens before its day. The home page lends what it has loaded: window.tnAdvent.use({ cat, popular, info, redraw }).
// Motion is the point here, so it plays whatever Settings → Animations says, but never when the device asks for Reduce Motion.
(() => {
  const { esc, fold } = window.tn;
  const $ = (s, el = document) => el.querySelector(s);
  const opts = {};
  const motion = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const season = () => { const d = new Date(); return d.getMonth() === 10 || (d.getMonth() === 11 && d.getDate() <= 26); };
  const today = () => { const d = new Date(); return d.getMonth() === 11 ? d.getDate() : 0; };   // 0 before December
  const canOpen = (n) => today() >= n;
  const untilDec = () => { const d = new Date(), f = new Date(d.getFullYear(), 11, 1); return Math.max(1, Math.ceil((f - d) / 864e5)); };

  // what's behind the doors you've opened this year: { doors: { 5: { k, type, title, year, poster, on, why, at } } }
  const KEY = `tenner-advent-${new Date().getFullYear()}`;
  const store = {
    get() { try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); return { doors: {}, ...o }; } catch { return { doors: {} }; } },
    set(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {} },
  };

  // ---------- the picks ----------
  // Christmas favourites, found by name (in this hour's catalogue first, so they come with where to watch; otherwise from
  // the search service), plus anything in the catalogue with Christmas in its name
  const XMAS = [['Elf', 2003, 'movie'], ['Home Alone', 1990, 'movie'], ['Love Actually', 2003, 'movie'], ['The Polar Express', 2004, 'movie'], ['Klaus', 2019, 'movie'],
    ['Arthur Christmas', 2011, 'movie'], ['The Grinch', 2018, 'movie'], ['How the Grinch Stole Christmas', 2000, 'movie'], ['The Holiday', 2006, 'movie'],
    ['The Muppet Christmas Carol', 1992, 'movie'], ['Nativity!', 2009, 'movie'], ['Last Christmas', 2019, 'movie'], ['Jingle Jangle: A Christmas Journey', 2020, 'movie'],
    ['The Santa Clause', 1994, 'movie'], ["It's a Wonderful Life", 1946, 'movie'], ['Miracle on 34th Street', 1994, 'movie'], ['Home Alone 2: Lost in New York', 1992, 'movie'],
    ['The Nightmare Before Christmas', 1993, 'movie'], ['Die Hard', 1988, 'movie'], ['Gremlins', 1984, 'movie'], ['Scrooged', 1988, 'movie'],
    ["National Lampoon's Christmas Vacation", 1989, 'movie'], ['The Christmas Chronicles', 2018, 'movie'], ['Red One', 2024, 'movie'], ['Noelle', 2019, 'movie'],
    ['The Family Stone', 2005, 'movie'], ['Get Santa', 2014, 'movie'], ['Spirited', 2022, 'movie'], ['Paddington 2', 2017, 'movie'], ['Frozen', 2013, 'movie'],
    ['A Boy Called Christmas', 2021, 'movie'], ['The Man Who Invented Christmas', 2017, 'movie'], ['Fred Claus', 2007, 'movie'], ['Violent Night', 2022, 'movie'],
    ['A Christmas Carol', 2009, 'movie'], ['Single All the Way', 2021, 'movie'], ['Dash & Lily', 2020, 'tv'], ['The Santa Clauses', 2022, 'tv'], ['Hawkeye', 2021, 'tv'],
    ['Gavin & Stacey', 2007, 'tv'], ['The Vicar of Dibley', 1994, 'tv'], ['Home for Christmas', 2019, 'tv'], ['Merry Happy Whatever', 2019, 'tv']];
  const RX = /\b(christmas|xmas|santa|grinch|noel|nativity|klaus|scrooge|snowman|jingle|mistletoe|reindeer|nutcracker|polar express|home alone|love actually)\b/i;
  const shuffle = (l) => { const a = l.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const catItems = () => opts.cat?.()?.items || [];
  const fromCat = (x) => { const c = opts.cat?.(); return { k: `${x.t[0]}${x.i}`, type: x.t, title: x.n, year: +(x.d || '').slice(0, 4) || null, poster: x.img ? (x.img.startsWith('/') ? c.img + x.img : x.img) : null, on: x.s || [] }; };
  async function pick(n) {
    const used = new Set(Object.values(store.get().doors).map((d) => d.k)), cat = catItems();
    const fresh = (k) => k && !used.has(k);
    const xmasCat = cat.filter((x) => x.img && RX.test(x.n) && fresh(`${x.t[0]}${x.i}`)).sort((a, b) => b.p - a.p).slice(0, 30);
    async function christmas() {
      if (xmasCat.length && Math.random() < .5) return { ...fromCat(shuffle(xmasCat)[0]), why: 'xmas' };
      for (const [title, year, type] of shuffle(XMAS).slice(0, 6)) {
        const hit = cat.find((x) => x.t === type && x.img && fold(x.n) === fold(title) && Math.abs(+(x.d || '').slice(0, 4) - year) <= 1);
        if (hit && fresh(`${hit.t[0]}${hit.i}`)) return { ...fromCat(hit), why: 'xmas' };
        const r = await window.tn.findTitle({ title, year, type });
        if (r?.poster && fresh(r.k)) return { k: r.k, type: r.type, title: r.title, year: r.year, poster: r.poster, on: [], why: 'xmas' };
      }
      return xmasCat.length ? { ...fromCat(xmasCat[0]), why: 'xmas' } : null;
    }
    function popular() {   // something popular right now that isn't already on your Watchlist
      const pop = (opts.popular?.() || []).map((p) => p.it).filter((it) => it.poster && /^\d+$/.test(String(it.id)))
        .map((it) => ({ k: `${it.type === 'movie' ? 'm' : 't'}${it.id}`, type: it.type, title: it.title, year: +it.year || null, poster: it.poster, on: it.on || [], why: 'pop' }))
        .filter((p) => fresh(p.k) && !window.tn.saved.has(p.k)).slice(0, 30);
      if (pop.length) return shuffle(pop)[0];
      const any = cat.filter((x) => x.img && fresh(`${x.t[0]}${x.i}`)).sort((a, b) => b.p - a.p).slice(0, 40);
      return any.length ? { ...fromCat(shuffle(any)[0]), why: 'pop' } : null;
    }
    // mostly Christmas, and always on the 24th and 25th; whichever comes up empty, the other
    return n >= 24 || Math.random() < .72 ? (await christmas()) || popular() : popular() || christmas();
  }
  const LINES = {
    xmas: ['A Christmas favourite for a cosy night in.', 'Hot chocolate, blanket, this. Perfect.', 'One for the whole family this Christmas.', 'A festive classic to get you in the mood.', 'Pure Christmas magic, ready when you are.'],
    pop: ['One of the most watched in the UK right now.', 'Everyone’s talking about this one.', 'A big one this week, and we think you’ll love it.', 'Something to enjoy between the mince pies.'],
  };
  const lineFor = (n, why) => (n === 25 ? 'Merry Christmas from all of us at Tenner.' : LINES[why][n % LINES[why].length]);
  // the title sheet for a pick: the catalogue's full details where we have them, or else the search service's
  function openPick(p) {
    const x = catItems().find((c) => `${c.t[0]}${c.i}` === p.k);
    if (x && opts.info) window.tnSheet?.open(opts.info(x)); else window.tnSheet?.openKey?.(p.k);
  }
  const infoOf = (p) => ({ k: p.k, type: p.type, title: p.title, year: p.year, poster: p.poster });

  // ---------- the doors: 25 in a jumbled order, the 25th big, each with its own little gold drawing ----------
  const ORN = {
    star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4l-5.3 3 1.2-6-4.5-4.1 6-.7z"/>',
    bauble: '<circle cx="12" cy="14" r="6.5"/><path d="M10.2 7.6V5.6h3.6v2M12 5.6c0-1.8 1.8-2.2 2.4-1M5.9 12.6c2.2 1.4 10 1.4 12.2 0M6.5 16.4c2.2 1.2 8.8 1.2 11 0"/>',
    tree: '<path d="M12 2.8l3.6 5h-1.8l4.4 5.6h-2.6l4.6 5.8H3.8l4.6-5.8H5.8l4.4-5.6H8.4z"/><path d="M11 19.2v2.4h2v-2.4"/>',
    flake: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 4 12 6.4 14.5 4M9.5 20l2.5-2.4 2.5 2.4M3.6 10.4l3.3-.9-.9-3.3M20.4 13.6l-3.3.9.9 3.3M3.6 13.6l3.3.9-.9 3.3M20.4 10.4l-3.3-.9.9-3.3"/>',
    gift: '<rect x="3.5" y="9" width="17" height="4" rx="1"/><path d="M5 13v7.5h14V13M12 9v11.5M12 9c-1.5-3.5-5.8-4.6-6-2.2C5.8 9 10 9 12 9zm0 0c1.5-3.5 5.8-4.6 6-2.2.2 2.2-4 2.2-6 2.2z"/>',
    bell: '<path d="M12 3.5a1.4 1.4 0 0 1 1.4 1.4v.6c2.8.7 4.6 3.1 4.6 6.2v3.8l1.8 2.5H4.2L6 15.5v-3.8c0-3.1 1.8-5.5 4.6-6.2v-.6A1.4 1.4 0 0 1 12 3.5z"/><path d="M10 19.8a2 2 0 0 0 4 0"/>',
    cane: '<path d="M10 21V8a3.6 3.6 0 0 1 7.2 0v1.4"/><path d="M10 11.2l2.6-1.6M10 14.6l2.6-1.6M10 18l2.6-1.6M13.2 5l1.4 2.2M16.4 6.2l-1.8 1.6"/>',
    stocking: '<path d="M8.4 3h6.8v9.4l-4.8 6.6a3.2 3.2 0 0 1-5.2-3.7l3.2-4.3z"/><path d="M8.4 6.6h6.8"/>',
    holly: '<path d="M12 12c-1.8-3.6-5.4-4.2-8.4-3 1.2.8 1 2.2.2 3 1.4.2 2 1.4 1.4 2.6 2.8.6 5.4-.2 6.8-2.6zM12 12c1.8-3.6 5.4-4.2 8.4-3-1.2.8-1 2.2-.2 3-1.4.2-2 1.4-1.4 2.6-2.8.6-5.4-.2-6.8-2.6z"/><circle cx="10.6" cy="14.8" r="1.5"/><circle cx="13.4" cy="14.8" r="1.5"/><circle cx="12" cy="17.2" r="1.5"/>',
    ginger: '<circle cx="12" cy="6" r="3"/><path d="M9.6 8.6 5 10.4a1.6 1.6 0 0 0 1 3l3.2-1V15l-2.6 4.2a1.6 1.6 0 0 0 2.8 1.6L12 17.6l2.6 3.2a1.6 1.6 0 0 0 2.8-1.6L14.8 15v-2.6l3.2 1a1.6 1.6 0 0 0 1-3l-4.6-1.8"/><path d="M12 11.2v.1M12 13.6v.1"/>',
    candle: '<rect x="9" y="10" width="6" height="11" rx="1"/><path d="M12 3c1.6 2 2 3.4.2 5-1.8-1.6-1.6-3-.2-5zM12 8v2"/>',
    snowman: '<circle cx="12" cy="15.5" r="5"/><circle cx="12" cy="7.4" r="3.4"/><path d="M8.6 4.2h6.8M10 4.2l.4-2h3.2l.4 2M12 7.8l2 .6"/>',
    wreath: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="4"/><path d="M9.6 19.4l2.4-2 2.4 2"/>',
    moon: '<path d="M15 3.6A8.6 8.6 0 1 0 20.4 15 7 7 0 0 1 15 3.6z"/><path d="M19 4l.6 1.4L21 6l-1.4.6L19 8l-.6-1.4L17 6l1.4-.6z"/>',
    cocoa: '<path d="M5 9h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3"/>',
  };
  // laid out like a real advent calendar: doors of all sizes on a 6 × 7 grid, the 25th the biggest, then the 24th
  const MAP = [
    [12, 3, 3, 18, 18, 8],
    [12, 25, 25, 24, 24, 6],
    [15, 25, 25, 24, 24, 6],
    [15, 25, 25, 11, 20, 20],
    [1, 1, 16, 21, 9, 9],
    [22, 4, 10, 21, 2, 14],
    [19, 17, 23, 13, 7, 5]];
  const AREAS = MAP.map((r) => `"${r.map((n) => `d${n}`).join(' ')}"`).join(' ');
  const SIZE = {}; MAP.flat().forEach((n) => { SIZE[n] = (SIZE[n] || 0) + 1; });   // how many cells each door covers
  const ORDER = [...new Set(MAP.flat())];
  const KINDS = Object.keys(ORN);
  // deep, rich door colours: crimson, emerald, midnight and plum
  const TONES = [['#b0203c', '#5a0b1e'], ['#127a52', '#06372a'], ['#2b4cb0', '#0f1d52'], ['#7a2d93', '#2e0f3e']];
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ORN[k]}</svg>`;
  const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="10" rx="2.4" fill="currentColor"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.4-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" fill="currentColor"/></svg>';
  const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5.5 12.5 4.2 4.2 8.8-9.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CAL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 12.6l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2-1.45-1.4 2-.3z" fill="currentColor"/></svg>';
  const date = (n) => `${n} December`;
  // fairy lights wrapped round a calendar: red, green and blue bulbs on a dark wire that sags a little between them,
  // each bulb pointing outwards and twinkling at its own pace. top/side: how many bulbs along each edge.
  function lights(top, side) {
    const pts = [];   // [x, y, angle, bulb?] round the edge, clockwise from the top left (0 to 100 each way)
    const edge = (n, f, a) => { for (let i = 0; i <= n; i++) pts.push([...f(i / n), a, i > 0 && i < n]); };
    edge(top, (t) => [t * 100, 0], 0); edge(side, (t) => [100, t * 100], 90); edge(top, (t) => [100 - t * 100, 100], 180); edge(side, (t) => [0, 100 - t * 100], 270);
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      d += `Q${(mx + (50 - mx) * .05).toFixed(2)} ${(my + (50 - my) * .05).toFixed(2)} ${x1} ${y1}`;   // a gentle sag towards the middle
    }
    const C = [['#ff3b4e', 'rgba(255,59,78,.75)'], ['#30d158', 'rgba(48,209,88,.7)'], ['#0a84ff', 'rgba(10,132,255,.75)']];
    let k = 0;
    const bulbs = pts.filter((p) => p[3]).map(([x, y, a]) => { const [c, g] = C[k % 3], tilt = ((k * 37) % 30) - 15; k++;
      return `<i style="left:${x}%;top:${y}%;--a:${a + tilt}deg;--c:${c};--g:${g};--dl:${((k * 0.37) % 2.4).toFixed(2)}s"></i>`; }).join('');
    return `<span class="lt" aria-hidden="true"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${d}"/></svg>${bulbs}</span>`;
  }
  function door(n) {
    const p = store.get().doors[n], t = today(), [c1, c2] = TONES[(n * 7) % 4], kind = n === 25 ? 'tree' : KINDS[(n * 7) % KINDS.length];
    const cls = ['adv-d', n === 25 ? 'big' : SIZE[n] >= 4 ? 'mid' : '', p ? 'open' : '', !p && n === t ? 'today' : '', !p && n > t ? 'locked' : ''].filter(Boolean).join(' ');
    const label = p ? `Door ${n}: ${p.title}` : n <= t ? `Door ${n}, ready to open` : `Door ${n}, opens on ${date(n)}`;
    return `<button type="button" class="${cls}" data-day="${n}" style="grid-area:d${n};--c1:${c1};--c2:${c2}" aria-label="${esc(label)}">
      <span class="adv-in">${p ? inside(p) : ''}</span>
      <span class="adv-leaf"><span class="adv-f">${svg(kind)}<b class="adv-n">${n}</b>${n === 25 ? '<small class="adv-mc">Merry Christmas</small>' : ''}${!p && n === t ? '<i class="adv-now">Today</i>' : ''}${!p && n > t ? `<span class="adv-lock">${LOCK}</span>` : ''}</span><span class="adv-b"></span></span></button>`;
  }
  const inside = (p) => `<img src="${esc(p.poster)}" alt="" decoding="async"><b>${esc(p.title)}</b>`;

  // ---------- the calendar ----------
  let dlg = null, opener = null, busy = false, closing = false;
  function sub() {
    const t = today(), n = Object.keys(store.get().doors).length;
    if (!t) return `Behind every door, a film or show we think you’ll love. The first opens on 1 December, in ${untilDec()} day${untilDec() === 1 ? '' : 's'}.`;
    if (t >= 25 && n >= 25) return 'Merry Christmas! Every door’s open. Enjoy the films and shows.';
    return store.get().doors[Math.min(t, 25)] ? `Day ${Math.min(t, 25)}: you’ve opened today’s door. Come back tomorrow for the next.` : `Day ${Math.min(t, 25)}: open today’s door for a film or show to enjoy.`;
  }
  function build() {
    if (dlg) return dlg;
    const flakes = Array.from({ length: 22 }, (_, i) => `<i style="--x:${(i * 47) % 100}%;--d:${7 + (i * 13) % 9}s;--w:${(i * 31) % 10}s;--s:${2 + (i % 4)}px;--o:${.35 + (i % 5) / 10}"></i>`).join('');
    document.body.insertAdjacentHTML('beforeend', `<dialog class="adv" id="adv" aria-labelledby="advT">
      <div class="adv-sc">
        <div class="adv-sky" aria-hidden="true"><img src="xmas.webp" alt=""><span class="adv-snow">${flakes}</span></div>
        <header class="adv-hd"><img class="adv-logo" src="logo.svg" alt="" width="46" height="46">
          <div><p class="adv-eye">Tenner</p><h2 id="advT">The Christmas calendar</h2><p class="adv-sub" id="advSub"></p></div>
          <button type="button" class="adv-x" data-advx aria-label="Close the calendar">${CLOSE}</button></header>
        <div class="adv-lit"><div class="adv-grid" id="advGrid"></div>${lights(12, 13)}</div>
        <p class="adv-say" id="advSay" role="status" aria-live="polite"></p>
      </div>
      <div class="adv-rv" id="advRv" hidden></div>
      <div class="adv-fx" id="advFx" aria-hidden="true"></div>
    </dialog>`);
    dlg = $('#adv');
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (!$('#advRv').hidden) hideReveal(); else shut(); });
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-advx]')) { shut(); return; }
      if (e.target === dlg) { const r = dlg.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) shut(); return; }
      const rv = e.target.closest('[data-rv]');
      if (rv) {
        const p = store.get().doors[rv.dataset.n];
        if (rv.dataset.rv === 'close') hideReveal();
        else if (rv.dataset.rv === 'watch' && p) openPick(p);
        else if (rv.dataset.rv === 'save' && p) { const on = window.tn.saved.toggle(infoOf(p)); rv.innerHTML = on ? TICK : PLUS; rv.setAttribute('aria-pressed', on); rv.setAttribute('aria-label', `${on ? 'Remove' : 'Add'} ${p.title} ${on ? 'from' : 'to'} your Watchlist`); say(on ? `${p.title} is on your Watchlist` : `${p.title} is off your Watchlist`); window.tn.haptic?.(); }
        return;
      }
      if (e.target === $('#advRv')) { hideReveal(); return; }
      const d = e.target.closest('.adv-d'); if (d) openDoor(d);
    });
    return dlg;
  }
  function paint() {
    $('#advSub').textContent = sub();
    const g = $('#advGrid'); g.style.gridTemplateAreas = AREAS; g.innerHTML = ORDER.map(door).join('');
  }
  let sayT = 0;
  function say(t) { const s = $('#advSay'); s.textContent = t; s.classList.add('on'); clearTimeout(sayT); sayT = setTimeout(() => s.classList.remove('on'), 2600); }
  function open(from) {
    if (!season()) return;
    build(); opener = from || null; closing = false; paint();
    $('#advRv').hidden = true; dlg.getAnimations().forEach((a) => a.cancel());
    dlg.showModal();
    $('.adv-sc', dlg).scrollTop = 0;
    // the calendar grows out of the button that opened it
    if (motion() && from?.isConnected) {
      const a = dlg.getBoundingClientRect(), b = from.getBoundingClientRect();
      dlg.animate([{ transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width}, ${b.height / a.height})`, opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 620, easing: 'cubic-bezier(.2,.9,.25,1.04)' });
    }
    const t = today(), d = t && !store.get().doors[Math.min(t, 25)] && $(`.adv-d[data-day="${Math.min(t, 25)}"]`, dlg);
    (d || $('.adv-x', dlg)).focus({ preventScroll: true });
  }
  // a little burst of gold and white stars from a point in the calendar
  function burst(x, y, n = 18, spread = 120) {
    if (!motion()) return;
    const fx = $('#advFx'), r = dlg.getBoundingClientRect(), box = document.createElement('span');
    box.className = 'adv-sp'; box.style.left = `${x - r.left}px`; box.style.top = `${y - r.top}px`;
    box.innerHTML = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + Math.random() * .4, d = spread * (.45 + Math.random() * .7);
      return `<i style="--dx:${Math.round(Math.cos(a) * d)}px;--dy:${Math.round(Math.sin(a) * d - 20)}px;--s:${6 + Math.round(Math.random() * 10)}px;--rot:${Math.round(Math.random() * 180)}deg;--c:${['#ffe08a', '#fff', '#ffd36b', '#fff4d6', '#ffb340'][i % 5]};--t:${(.75 + Math.random() * .45).toFixed(2)}s"></i>`;
    }).join('');
    fx.append(box); setTimeout(() => box.remove(), 1400);
  }
  async function openDoor(btn) {
    const n = +btn.dataset.day, st = store.get();
    if (st.doors[n]) { reveal(n, btn); return; }
    if (!canOpen(n)) {
      btn.classList.remove('no'); void btn.offsetWidth; btn.classList.add('no');
      say(today() ? `Door ${n} opens on ${date(n)}. Not long now!` : `The first door opens on 1 December. Not long now!`); return;
    }
    if (busy) return; busy = true;
    window.tn.haptic?.(12);
    const got = pick(n).catch(() => null);
    btn.classList.add('opening');
    await wait(motion() ? 140 : 0);   // a breath, then it swings open
    btn.classList.add('open'); btn.querySelector('.adv-now, .adv-lock')?.remove();
    const r = btn.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, n === 25 ? 30 : 18, n === 25 ? 200 : 120);
    const p = await got;
    if (!p) {
      btn.classList.remove('open', 'opening'); busy = false;
      say('That door’s a bit stuck. Check your connection and try again.'); return;
    }
    const st2 = store.get(); st2.doors[n] = { ...p, at: Date.now() }; store.set(st2);
    $('.adv-in', btn).innerHTML = inside(p); btn.setAttribute('aria-label', `Door ${n}: ${p.title}`);
    btn.classList.remove('today');
    $('#advSub').textContent = sub();
    await wait(motion() ? 850 : 0);
    btn.classList.remove('opening'); busy = false;
    reveal(n, btn);
    opts.redraw?.();   // its box in the right-hand column
  }
  // the pick, on a card that comes forward from its door
  function reveal(n, from) {
    const p = store.get().doors[n]; if (!p) return;
    const on = window.tn.saved.has(p.k), kind = p.type === 'movie' ? 'Film' : 'Series';
    const rv = $('#advRv');
    rv.innerHTML = `<article class="adv-card" role="group" aria-labelledby="advCt">
      <button type="button" class="adv-x adv-cx" data-rv="close" aria-label="Back to the calendar">${CLOSE}</button>
      <span class="adv-cp"><img src="${esc(p.poster)}" alt=""></span>
      <div class="adv-cc"><p class="adv-eye">Door ${n} · ${p.why === 'xmas' ? 'A Christmas favourite' : 'Popular right now'}</p>
        <h3 id="advCt">${esc(p.title)}</h3>
        <p class="adv-cm">${[kind, p.year].filter(Boolean).map(esc).join(' · ')}</p>
        <p class="adv-cl">${esc(lineFor(n, p.why))}</p>
        <div class="adv-ca"><button type="button" class="btn btn-tinted adv-go" data-rv="watch" data-n="${n}">${PLAY}Where to watch</button>
          <button type="button" class="bx-r bx-r-l" data-rv="save" data-n="${n}" aria-pressed="${on}" aria-label="${on ? 'Remove' : 'Add'} ${esc(p.title)} ${on ? 'from' : 'to'} your Watchlist">${on ? TICK : PLUS}</button></div></div></article>`;
    rv.hidden = false;
    const card = $('.adv-card', rv);
    if (motion() && from) {
      const a = card.getBoundingClientRect(), b = from.getBoundingClientRect();
      card.animate([{ transform: `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(${Math.max(.15, b.width / a.width)})`, opacity: 0 },
        { opacity: 1, offset: .35 }, { transform: 'none', opacity: 1 }], { duration: 640, easing: 'cubic-bezier(.2,.9,.25,1.08)' });
      rv.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
      const c = card.getBoundingClientRect(); setTimeout(() => burst(c.left + c.width / 2, c.top + 40, 14, 220), 380);
    }
    $('.adv-go', rv).focus({ preventScroll: true });
  }
  function hideReveal() {
    const rv = $('#advRv'); if (rv.hidden) return;
    if (!motion()) { rv.hidden = true; return; }
    rv.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' }).finished.then((an) => { rv.hidden = true; an.cancel(); });
  }
  // closing: the calendar fades gently away. The first time, its box then joins the right-hand column: a space opens at
  // the top (Discover glides down beneath it) and the little calendar fades in there. After that it's always there.
  const inView = (el) => { if (!el?.isConnected) return null; const r = el.getBoundingClientRect(); return r.width && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth ? el : null; };
  function shut() {
    if (!dlg?.open || closing) return;
    closing = true;
    const st = store.get(), first = !st.placed;
    if (first) { st.placed = Date.now(); store.set(st); }
    const done = () => { dlg.close(); $('#advRv').hidden = true; closing = false; dlg.getAnimations().forEach((a) => a.cancel()); };
    if (!motion()) { done(); if (first) opts.redraw?.(); return; }
    dlg.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.97)' }], { duration: 380, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).finished.then(done);
    if (first) {
      opts.redraw?.();
      const box = $('#bxAdv'); if (!box) return;
      const h = box.offsetHeight; box.style.overflow = 'hidden';
      box.animate([{ height: '0px', marginBottom: '-16px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 }, { height: `${h}px`, marginBottom: '0px', opacity: 0, offset: .5 }, { height: `${h}px`, opacity: 1 }],
        { duration: 1400, delay: 250, easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'backwards' }).finished.then(() => { box.style.overflow = ''; });
    } else {
      const box = inView($('#bxAdv')); if (!box) return;
      setTimeout(() => { box.classList.remove('adv-land'); void box.offsetWidth; box.classList.add('adv-land'); setTimeout(() => box.classList.remove('adv-land'), 1300); }, 300);
    }
  }

  // ---------- its box at the top of the right-hand column: the calendar in miniature, Discover's size ----------
  // Shown from the first time you close the calendar. Opened doors show their posters; today's glows. Tap a door to open
  // the calendar at it.
  function box() {
    const st = store.get(), doors = st.doors, t = Math.min(today(), 25);
    if (!season() || !st.placed) return '';   // (placed: everyone sees it arrive afresh)
    const p = t ? doors[t] : null;
    const mini = ORDER.map((n) => {
      const d = doors[n], [c1, c2] = TONES[(n * 7) % 4];
      return `<button type="button" class="bx-ad${d ? ' open' : ''}${!d && n === t ? ' today' : ''}${n > t ? ' locked' : ''}${n === 25 ? ' big' : ''}" data-adv="door" data-n="${n}" style="grid-area:d${n};--c1:${c1};--c2:${c2}"
        aria-label="${esc(d ? `Door ${n}: ${d.title}` : n <= t ? `Door ${n}, ready to open` : `Door ${n}, opens on ${date(n)}`)}">${d ? `<img src="${esc(d.poster)}" alt="">` : `<b>${n}</b>`}</button>`;
    }).join('');
    const say = !t ? `The first door opens in ${untilDec()} day${untilDec() === 1 ? '' : 's'}.` : p ? `Behind door ${t}: ${p.title}` : `Door ${t} is ready to open.`;
    return `<section class="bx-panel panel bx-adv" id="bxAdv" aria-labelledby="bxAdvT">
      <header class="bx-panel-hd"><h2 id="bxAdvT">Christmas calendar</h2><span class="bx-tag bx-adv-tag">${t ? `Day ${t}` : '1 December'}</span></header>
      <div class="adv-lit adv-lit-s"><div class="bx-adv-cal" style='grid-template-areas:${AREAS}'>${mini}</div>${lights(8, 9)}</div>
      <p class="bx-panel-say bx-adv-say">${esc(say)}</p>
      <button type="button" class="btn btn-tinted bx-wide" data-adv="open">${CAL}${!t || p ? 'Open calendar' : `Open door ${t}`}</button></section>`;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-adv]'); if (!b) return;
    if (b.dataset.adv === 'open') open(b);
    else if (b.dataset.adv === 'door') {   // a door in the little calendar: the big one, at that door
      open($('#bxAdv') || b);
      setTimeout(() => { const d = dlg?.open && $(`.adv-d[data-day="${b.dataset.n}"]`, dlg); if (d) openDoor(d); }, motion() ? 640 : 0);
    }
    else if (b.dataset.adv === 'pick') { const p = store.get().doors[b.dataset.n]; if (p) openPick(p); }
  });
  window.tnAdvent = { use: (o) => Object.assign(opts, o), open, box, icon: CAL, season };
})();

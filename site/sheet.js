// Tenner's title sheet: tap a title anywhere and see where to watch it in the UK without leaving Tenner, the Apple TV
// app way. Artwork, title, year, running time, age rating, star rating, genres, the description, a trailer, and where
// to watch grouped as Included with, Free, Rent and Buy. A bottom sheet on phones (swipe it down to close), a centred
// card on computers. The address gains ?t=… so a title can be shared, and Back closes it.
// Details come from data/titles.json (rebuilt hourly), fetched the first time a sheet opens.
(() => {
  const { esc, hue, reduce, saved } = window.tn;
  // the Watchlist button: a bookmark that fills in once saved
  const saveBtn = (on) => `<button type="button" class="btn btn-tinted sh-save${on ? ' on' : ''}" data-act="save" aria-pressed="${on}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11v17L12 16.6 6.5 20.5z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>${on ? 'In Watchlist' : 'Watchlist'}</button>`;
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

  // ---------- the sheet, built once ----------
  document.body.insertAdjacentHTML('beforeend', `
    <div class="sh-scrim" id="shScrim" hidden></div>
    <div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="shT" hidden>
      <div class="sh-grab" aria-hidden="true"></div>
      <button type="button" class="sh-x" id="shX" aria-label="Close" title="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
      <div class="sh-scroll" id="shScroll"></div>
    </div>`);
  const sheet = $('#sheet'), scrim = $('#shScrim'), body = $('#shScroll');
  let current = null, opener = null, pushed = false, pageTitle = document.title;

  const runtime = (m) => !m ? '' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
  // one entry per service: TMDB lists plans and channels separately ("Netflix Standard with Ads", "Paramount+ Amazon
  // Channel", "Paramount Plus Premium"); they're all the same place to watch, so they fold into the service's own name
  const NAMES = { 'Disney Plus': 'Disney+', 'Amazon Prime Video': 'Prime Video', 'Paramount Plus': 'Paramount+', 'Apple TV Plus': 'Apple TV+',
    'Apple TV Store': 'Apple TV', 'Amazon Video': 'Prime Video Store', 'Now TV': 'NOW', 'Now TV Cinema': 'NOW', 'NOW TV Cinema': 'NOW', 'Netflix Kids': 'Netflix' };
  const brand = (n) => {
    const b = n.replace(/\s+(Standard|Basic|Premium)?\s*with Ads$/i, '').replace(/\s+(Amazon|Apple TV|Roku Premium)\s+Channel$/i, '')
      .replace(/\s+(Premium|Kids|Basic|Standard|Essential)$/i, '').replace(/^Paramount\+$/, 'Paramount Plus').trim();
    return NAMES[b] || b;
  };
  function providerList(ids, d, info) {
    const seen = new Set();
    return (ids || []).map((id) => [id, ...(d.providers[id] || [])]).filter(([, n]) => n && !seen.has(brand(n)) && seen.add(brand(n))).map(([id, n, logo]) => {
      // Netflix titles go straight to Netflix; everything else to the title's TMDB watch page, which links into each app
      const href = /^Netflix/i.test(n) && info.netflix ? info.netflix : info.watch;
      return `<a class="sh-prov" href="${esc(href)}" target="_blank" rel="noopener">${logo && d.logo ? `<img src="${esc(d.logo + logo)}" alt="" loading="lazy">` : `<i>${esc(brand(n)[0])}</i>`}<span>${esc(brand(n))}</span></a>`;
    }).join('');
  }
  function whereHtml(info, d) {
    const x = d?.items?.[info.k];
    if (!x) {   // no details (yet): what we know from the chart or catalogue
      const on = (info.services || []).map((s) => `<span class="sh-prov flat">${s.logo ? `<img src="${esc(s.logo)}" alt="">` : ''}<span>${esc(s.label)}</span></span>`).join('');
      return on ? `<div class="sh-grp"><h4>Included with</h4><div class="sh-provs">${on}</div></div>` : `<p class="sh-none">${d && !d.pending ? 'We don’t have where-to-watch details for this one yet.' : 'Loading where to watch…'}</p>`;
    }
    const groups = [['Included with', x.f], ['Free', x.fr], ['Rent', x.re], ['Buy', x.bu]]
      .map(([label, ids]) => { const list = providerList(ids, d, info); return list ? `<div class="sh-grp"><h4>${label}</h4><div class="sh-provs">${list}</div></div>` : ''; }).join('');
    return groups || '<p class="sh-none">Not available to stream, rent or buy in the UK right now.</p>';
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
        ${info.eye ? `<p class="sh-eye">${esc(info.eye)}</p>` : ''}
        <h2 id="shT">${esc(info.title)}</h2>
        <p class="sh-meta">${meta.map(String).map((m) => (m.startsWith('<b') ? m : esc(m))).join('<span aria-hidden="true"> · </span>')}</p>
        ${genres ? `<p class="sh-genres">${esc(genres)}</p>` : ''}
        <div class="sh-btns">
          ${x.tr ? `<button type="button" class="btn btn-tinted" data-act="trailer"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>Trailer</button>` : ''}
          ${info.k ? saveBtn(saved.has(info.k)) : ''}
          ${info.netflix ? `<a class="btn btn-tinted" href="${esc(info.netflix)}" target="_blank" rel="noopener">Watch on Netflix</a>` : ''}
          <button type="button" class="btn btn-tinted" data-act="share"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11v8.5h12V11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Share</button>
        </div>
        ${x.tl ? `<p class="sh-tl">${esc(x.tl)}</p>` : ''}
        ${info.overview ? `<p class="sh-ov">${esc(info.overview)}</p>` : ''}
        <section class="sh-where" aria-labelledby="shW"><h3 id="shW">Where to Watch</h3>${whereHtml(info, d)}</section>
        <p class="sh-foot">Where-to-watch information from JustWatch, via TMDB.${info.tmdb ? ` <a href="${esc(info.tmdb)}" target="_blank" rel="noopener">More on TMDB</a>` : ''}</p>
      </div>`;
  }

  // ---------- open and close ----------
  async function open(info, fromUrl) {
    if (!info) return;
    info.watch ||= info.tmdb ? `${info.tmdb}/watch?locale=GB` : info.netflix || '#';
    if (!current) pageTitle = document.title;
    current = info; opener = fromUrl ? null : document.activeElement;
    render(info, null);
    scrim.hidden = false; sheet.hidden = false; sheet.style.translate = '';
    document.documentElement.classList.add('sheet-up');
    requestAnimationFrame(() => { scrim.classList.add('in'); sheet.classList.add('in'); });
    body.scrollTop = 0; $('#shX').focus({ preventScroll: true });
    if (!fromUrl && info.k) {
      const u = new URL(location.href); u.searchParams.set('t', info.k);
      history.pushState({ sheet: info.k }, '', u); pushed = true;
    }
    document.title = `${info.title} | Tenner`;
    let d = await details();
    if (current !== info) return;
    if (!d?.items?.[info.k] && window.tn.api) {
      render(info, { ...(d || {}), items: {}, pending: true });   // "Loading…" stays until the live details arrive
      const a = await fromApi(info.k);
      if (current !== info) return;
      if (a) { for (const [f, v] of Object.entries(a.info || {})) if (v && !info[f]) info[f] = v; d = a; }
    }
    shown = d; render(info, d);
  }
  // open a title by its key alone (a shared link to something Tenner doesn't follow)
  async function openKey(k) {
    const a = await fromApi(k); if (!a?.info || current) return false;
    open({ ...a.info, tmdb: `https://www.themoviedb.org/${a.info.type}/${k.slice(1)}` }, true); return true;
  }
  function close(fromHistory) {
    if (!current) return;
    current = null; scrim.classList.remove('in'); sheet.classList.remove('in');
    document.documentElement.classList.remove('sheet-up');
    const done = () => { if (!current) { sheet.hidden = true; scrim.hidden = true; body.innerHTML = ''; } };
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
  scrim.addEventListener('click', () => close());
  addEventListener('keydown', (e) => {
    if (!current) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {   // keep the keyboard inside the sheet while it's open
      const f = [...sheet.querySelectorAll('a[href], button:not([disabled]), iframe')].filter((n) => n.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  });

  // ---------- trailer and share ----------
  sheet.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b || !current) return;
    if (b.dataset.act === 'trailer') {
      const key = (shown || await details())?.items?.[current.k]?.tr; if (!key) return;
      // played in place, from YouTube's privacy-enhanced player, only when asked
      $('#shArt').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&rel=0&playsinline=1" title="Trailer: ${esc(current.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
      $('#shArt').classList.add('playing'); body.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    }
    if (b.dataset.act === 'save') {
      const on = saved.toggle(current);
      b.outerHTML = saveBtn(on); sheet.querySelector('.sh-save')?.focus({ preventScroll: true });
    }
    if (b.dataset.act === 'share') {
      const url = new URL(location.href); if (current.k) url.searchParams.set('t', current.k);
      const data = { title: `${current.title} on Tenner`, text: `Where to watch ${current.title} in the UK`, url: url.toString() };
      try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(data.url); b.lastChild.textContent = 'Link copied'; setTimeout(() => (b.lastChild.textContent = 'Share'), 1600); } } catch { /* cancelled */ }
    }
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

// A person's sheet: an actor, director or writer from the menu's search or a title sheet's Cast & Crew, in the same
// sheet as a title (a bottom sheet on phones, a centred card on computers). What they're best known for as the artwork,
// their portrait and name, a few facts, the biography, what of theirs is on the six services now, Known For, and their
// whole career. The address gains ?p=… so a person can be shared, and Back closes it. A title opens its own sheet.
(() => {
  const { esc, hue, reduce, api, segment } = window.tn;
  const $ = (s, el = document) => el.querySelector(s);
  const DEPT = { Acting: 'Actor', Directing: 'Director', Writing: 'Writer', Production: 'Producer', Sound: 'Composer', Camera: 'Cinematographer', Editing: 'Editor', Creator: 'Creator' };
  const initials = (n) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const cache = new Map();
  const get = (id) => {
    if (!api) return Promise.resolve(null);
    if (!cache.has(id)) cache.set(id, fetch(`${api}/person/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    return cache.get(id);
  };
  // which titles are streaming on the six services right now (the Browse catalogue), and the services' names and logos
  let catP = null;
  const catalogue = () => (catP ||= Promise.all([
    fetch(`data/browse.json?v=${Math.floor(Date.now() / 600000)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`data/trending.json?v=${Math.floor(Date.now() / 600000)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([c, t]) => {
    const on = new Map(); for (const x of c?.items || []) if (x.s?.length) on.set(`${x.t[0]}${x.i}`, x.s);
    const svc = {}; for (const s of t?.services || []) svc[s.key] = { label: s.label, logo: s.logo };
    return { on, svc };
  }));

  document.body.insertAdjacentHTML('beforeend', `
    <dialog class="sheet psheet" id="psheet" aria-labelledby="psT">
      <div class="sh-grab" aria-hidden="true"></div>
      <button type="button" class="sh-x" id="psX" aria-label="Close" title="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
      <div class="sh-scroll" id="psScroll"></div>
    </dialog>`);
  const sheet = $('#psheet'), body = $('#psScroll');
  body.addEventListener('scroll', () => sheet.classList.toggle('sh-scrolled', body.scrollTop > 30), { passive: true });
  let current = null, pd = null, cat = null, pushed = 0, opener = null, pageTitle = document.title;

  const day = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const age = (born, died) => {
    const a = new Date(born + 'T12:00:00'), b = died ? new Date(died + 'T12:00:00') : new Date();
    return b.getFullYear() - a.getFullYear() - (b < new Date(b.getFullYear(), a.getMonth(), a.getDate()) ? 1 : 0);
  };
  const face = (p) => p.photo   // a photo opens larger when tapped
    ? `<button type="button" class="sh-poster ps-face" id="psFace" style="--h:${hue(p.name)}" aria-label="See ${esc(p.name)}’s photo larger"><img src="${esc(p.photo)}" alt="" decoding="async"></button>`
    : `<span class="sh-poster ps-face" style="--h:${hue(p.name)}">${esc(initials(p.name))}</span>`;
  const ph = (x) => `<span class="ph" style="background:linear-gradient(160deg,hsl(${hue(x.title)} 45% 42%),hsl(${(hue(x.title) + 40) % 360} 55% 18%))">${esc(x.title)}</span>`;
  const logos = (k) => {
    const l = (cat?.on.get(k) || []).map((s) => cat.svc[s]).filter((s) => s?.logo).slice(0, 3);
    return l.length ? `<span class="ps-on">${l.map((s) => `<img src="${esc(s.logo)}" alt="${esc(s.label)}" title="${esc(s.label)}">`).join('')}</span>` : '';
  };
  const posters = (list) => `<ul class="nr sh-nr">${list.map((x) => `<li><a href="./?t=${esc(x.k)}" data-pk="${esc(x.k)}"><span class="nr-art">${x.poster
    ? `<img src="${esc(x.poster)}" alt="" loading="lazy" decoding="async">` : ph(x)}${logos(x.k)}</span><b>${esc(x.title)}</b><small>${esc([x.year, x.role].filter(Boolean).join(' · '))}</small></a></li>`).join('')}</ul>`;
  const row = (x) => `<li><a href="./?t=${esc(x.k)}" data-pk="${esc(x.k)}">${x.poster ? `<img src="${esc(x.poster)}" alt="" loading="lazy" decoding="async">` : `<span class="cl-ph" style="background:hsl(${hue(x.title)} 45% 35%)"></span>`}
    <span class="cl-t"><b>${esc(x.title)}</b><small>${esc([x.role, x.eps > 1 ? `${x.eps} episodes` : '', x.type === 'tv' ? 'Show' : 'Film'].filter(Boolean).join(' · '))}</small></span>
    <span class="cl-r">${esc(x.year || 'Soon')}</span></a></li>`;
  const skeleton = (name) => `<div class="sh-art ps-art"><span class="ph ps-sk"></span><span class="sh-poster ps-face ps-sk"></span></div>
    <div class="sh-body ps-body"><h2 id="psT">${esc(name || 'Loading…')}</h2>
      <div class="sh-ov"><p class="sh-sk" aria-hidden="true"><span></span><span></span><span></span></p></div></div>`;

  function render() {
    const p = pd, dated = (l) => [...l.filter((x) => x.year), ...l.filter((x) => !x.year)];   // unannounced work goes last
    const tabs = [['acting', 'Acting', dated(p.acting)], ['crew', 'Behind the camera', dated(p.crew)]].filter((t) => t[2].length);
    let tab = p.dept === 'Acting' || !p.crew.length ? tabs[0] : tabs.find((t) => t[0] === 'crew');
    const all = [...p.acting, ...p.crew];
    const nowOn = [...new Map(all.filter((x) => cat?.on.has(x.k)).map((x) => [x.k, x])).values()].sort((a, b) => (b.votes || 0) - (a.votes || 0));
    const meta = [DEPT[p.dept] || p.dept, p.born && (p.died ? `${day(p.born)} – ${day(p.died)}` : `Born ${day(p.born)}`), p.born && (p.died ? `aged ${age(p.born, p.died)}` : `age ${age(p.born)}`)].filter(Boolean);
    const sp = p.known.find((x) => x.bd);   // the artwork: the wide picture of what they're best known for
    const art = sp ? `<img src="${esc(sp.bd)}" alt="" decoding="async">` : p.photo ? `<img class="soft" src="${esc(p.photo)}" alt="" decoding="async">` : `<span class="ph" style="background:hsl(${hue(p.name)} 40% 30%)"></span>`;
    body.innerHTML = `<div class="sh-art ps-art">${art}${face(p)}</div>
      <div class="sh-body ps-body">
        <h2 id="psT" tabindex="-1">${esc(p.name)}</h2>
        ${meta.length ? `<p class="sh-meta">${meta.map(esc).join('<span aria-hidden="true"> · </span>')}</p>` : ''}
        ${p.place ? `<p class="sh-genres">${esc(p.place)}</p>` : ''}
        <div class="sh-btns"><div class="sh-more"><button type="button" class="btn btn-tinted" id="psShare"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11v8.5h12V11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Share</button></div></div>
        ${p.bio ? `<div class="sh-ov" id="psBio"><p>${esc(p.bio).replace(/\n\n+/g, '<br><br>')}</p></div>` : ''}
        ${nowOn.length ? `<section class="sh-sec" aria-labelledby="psN"><h3 id="psN">Watch now</h3>${posters(nowOn.slice(0, 20))}</section>` : ''}
        ${p.known.length ? `<section class="sh-sec" aria-labelledby="psK"><h3 id="psK">Known for</h3>${posters(p.known)}</section>` : ''}
        ${tabs.length ? `<section class="sh-sec ps-career" aria-labelledby="psC"><div class="sh-h"><h3 id="psC">Career</h3>${tabs.length > 1
          ? `<div class="segmented" role="radiogroup" aria-label="Acting or behind the camera"><span class="seg-thumb" aria-hidden="true"></span>${tabs.map((t) =>
            `<button type="button" role="radio" data-f="${t[0]}" aria-checked="${t === tab}">${t[1]}</button>`).join('')}</div>` : ''}</div>
          <ol class="cl nw-cl ps-cl" id="psList"></ol></section>` : ''}
        <p class="sh-foot">From TMDB. <a href="https://www.themoviedb.org/person/${esc(String(p.id))}" target="_blank" rel="noopener">More on TMDB</a></p>
      </div>`;
    const draw = () => { $('#psList').innerHTML = tab[2].map(row).join(''); };
    if (tabs.length) draw();
    const seg = $('.segmented', body), pick = (b) => { seg.querySelectorAll('button').forEach((n) => n.setAttribute('aria-checked', n === b)); tab = tabs.find((t) => t[0] === b.dataset.f); draw(); };
    if (seg) { segment(seg, pick); seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick(b); }); }
    const bio = $('#psBio'), t = bio?.firstChild;   // four lines, then More
    if (t && t.scrollHeight > t.clientHeight + 2) { bio.classList.add('clip'); bio.insertAdjacentHTML('beforeend', '<button type="button" class="sh-ovmore" aria-label="Read the whole biography">More</button>'); }
    if (p.photo) window.tn.tip?.({ id: 'person-photo-zoom', for: '#psFace', title: 'See them up close', text: 'Tap a photo to see it larger. Tap anywhere to close it.' });
    $('#psShare').addEventListener('click', () => window.tn.share({ heading: `Share ${p.name}`, title: `${p.name} on Tenner`, text: `${p.name}: everything they’ve made, and where to watch it`, url: `${location.origin}/?p=${p.id}` }));
  }

  // ---------- the photo, larger: a round portrait over a blurred page, closed by a tap anywhere or Escape ----------
  document.body.insertAdjacentHTML('beforeend', `<dialog class="ps-zoom" id="psZoom" aria-labelledby="psZn"><figure><span class="ps-zf"><img alt=""></span><figcaption id="psZn"></figcaption></figure></dialog>`);
  const zoom = $('#psZoom');
  function showPhoto() {
    if (!pd?.photo) return;
    $('img', zoom).src = pd.photo; $('img', zoom).alt = pd.name; $('#psZn').textContent = pd.name;
    zoom.showModal(); navigator.vibrate?.(8);
  }
  zoom.addEventListener('click', () => zoom.close());
  zoom.addEventListener('close', () => $('#psFace')?.focus({ preventScroll: true }));

  // ---------- open and close ----------
  async function open(id, fromUrl, name) {
    id = String(id); if (!/^\d{1,9}$/.test(id)) return;
    if (!current) pageTitle = document.title;
    if (!sheet.open) opener = fromUrl ? null : document.activeElement;
    current = id; pd = null;
    body.innerHTML = skeleton(name); body.scrollTop = 0;
    sheet.style.translate = '';
    if (!sheet.open) sheet.showModal();
    document.documentElement.classList.add('sheet-up');
    requestAnimationFrame(() => sheet.classList.add('in'));
    $('#psX').focus({ preventScroll: true });
    if (!fromUrl) { const u = new URL(location.href); u.searchParams.set('p', id); history.pushState({ person: id }, '', u); pushed++; }
    const [d, c] = await Promise.all([get(id), catalogue()]);
    if (current !== id) return;
    cat = c; pd = d;
    if (!d) { body.innerHTML = `<div class="sh-body ps-body ps-none"><h2 id="psT">Couldn’t load this person</h2><p class="sh-genres">Check your connection and try again.</p></div>`; return; }
    document.title = `${d.name} | Tenner`;
    render();
  }
  function close(fromHistory) {
    if (!current) return;
    current = null; sheet.classList.remove('in');
    if (!window.tnSheet?.isOpen()) document.documentElement.classList.remove('sheet-up');
    const done = () => { if (!current) { sheet.close(); body.innerHTML = ''; } };
    reduce ? done() : setTimeout(done, 320);
    if (!fromHistory && pushed) { history.go(-pushed); pushed = 0; }
    else if (!fromHistory) { const u = new URL(location.href); u.searchParams.delete('p'); history.replaceState(history.state, '', u); }
    if (fromHistory) pushed = 0;
    document.title = pageTitle;
    opener?.focus?.({ preventScroll: true });
  }
  addEventListener('popstate', () => {
    const p = new URL(location.href).searchParams.get('p');
    if (!current) return;
    if (!p) close(true);
    else if (p !== current) { pushed = Math.max(0, pushed - 1); open(p, true); }   // Back to the person before
  });
  // the title sheet, closing, mustn't let the page scroll behind this one
  addEventListener('tn:sheet-closed', () => { if (current) document.documentElement.classList.add('sheet-up'); });
  $('#psX').addEventListener('click', () => close());
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) {   // the dimmed page around it
      const r = sheet.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
      return;
    }
    if (e.target.closest('#psFace')) { showPhoto(); return; }
    if (e.target.closest('.sh-ovmore')) { const o = $('#psBio'); o.classList.add('open'); e.target.remove(); return; }
    const a = e.target.closest('a[data-pk]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button || !window.tnSheet) return;
    e.preventDefault(); openTitle(a.dataset.pk);
  });
  sheet.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  // a title: its sheet opens over this one, so closing it comes back here (when a title sheet is already open
  // underneath, this one makes way for it)
  async function openTitle(k) {
    const x = pd && [...pd.known, ...pd.acting, ...pd.crew].find((y) => y.k === k); if (!x) return;
    const info = { k: x.k, type: x.type, title: x.title, year: x.year, poster: x.poster?.replace('/w342/', '/w500/'),
      tmdb: `https://www.themoviedb.org/${x.type}/${x.k.slice(1)}`, services: (cat?.on.get(x.k) || []).map((s) => cat.svc[s]).filter(Boolean) };
    if (window.tnSheet.isOpen()) { close(); await new Promise((r) => setTimeout(r, 380)); }
    window.tnSheet.open(info);
  }

  // phones: swipe it down to close, from the handle or the artwork
  let drag = null;
  sheet.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !matchMedia('(max-width: 719px)').matches || !e.target.closest('.sh-grab, .sh-art') || e.target.closest('#psFace')) return;
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

  // any link to a person (a title sheet's Cast & Crew, the menu's search) opens their sheet here
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('a[data-p]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault();
    const name = a.querySelector('b')?.textContent;
    if (a.closest('#sheet') && current) { window.tnSheet.close(); await new Promise((r) => setTimeout(r, 380)); }   // this sheet is underneath: the title makes way
    open(a.dataset.p, false, name);
  });
  window.tnPerson = { open, close, isOpen: () => !!current };

  // a shared link (?p=…), or an old Cast & Crew link sent on here
  const p = new URL(location.href).searchParams.get('p');
  if (p) open(p, true);
})();

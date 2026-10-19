// Cast & Crew: search the people behind every show and film (TMDB, through Tenner's search API on Cloudflare) and see
// everything they've made, the Apple TV app way. Faces from this week's top 10 until you type; ?p=ID opens a person,
// and tapping any of their titles opens the usual title sheet.
(() => {
  const { esc, hue, reduce, api, segment } = window.tn;
  const $ = (s) => document.querySelector(s);
  const find = $('#find'), person = $('#person'), q = $('#pq'), clear = $('#pqClear'), note = $('#pNote'), out = $('#pResults');
  const get = (path, signal) => fetch(api + path, { signal }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
  const DEPT = { Acting: 'Actor', Directing: 'Director', Writing: 'Writer', Production: 'Producer', Sound: 'Composer', Camera: 'Cinematographer', Editing: 'Editor', Creator: 'Creator' };
  const initials = (n) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const photo = (p, cls = 'pf') => `<span class="${cls}" style="--h:${hue(p.name)}">${p.photo
    ? `<img src="${esc(p.photo)}" alt="" loading="lazy" decoding="async">` : `<i aria-hidden="true">${esc(initials(p.name))}</i>`}</span>`;

  // ---------- faces ----------
  const face = (p, sub) => `<li class="face"><a href="?p=${p.id}" data-p="${p.id}">${photo(p)}<b>${esc(p.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</a></li>`;
  const shelf = (title, lede, list, sub) => list.length ? `<section class="p-sec"><div class="p-sh"><h2>${esc(title)}</h2>${lede ? `<p>${esc(lede)}</p>` : ''}</div>
    <ul class="faces shelf">${list.map((p) => face(p, sub(p))).join('')}</ul></section>` : '';

  // before anyone types: the people in this week's top 10, then who's trending on TMDB
  let homeHtml = null;
  async function home() {
    if (homeHtml) { out.innerHTML = homeHtml; return; }
    out.innerHTML = '<div class="p-load" aria-hidden="true">' + '<span></span>'.repeat(8) + '</div>';
    const chart = await fetch(`data/trending.json?v=${Math.floor(Date.now() / 600000)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const o = chart?.overall || {}, tops = [0, 1, 2, 3].flatMap((i) => [o.tv?.[i], o.movie?.[i]]).filter((x) => x?.id);   // shows and films taking turns
    const [credits, trend] = await Promise.all([
      Promise.all(tops.map((x) => get(`/credits/${x.type === 'movie' ? 'm' : 't'}${x.id}`).then((c) => ({ x, c })).catch(() => null))),
      get('/people').catch(() => null),
    ]);
    const seen = new Set(), stars = [], makers = [];
    for (const r of credits.filter(Boolean)) {
      for (const p of r.c.cast.slice(0, 3)) if (!seen.has(p.id)) { seen.add(p.id); stars.push({ ...p, in: r.x.title }); }
      for (const p of r.c.crew.slice(0, 1)) if (!seen.has(p.id)) { seen.add(p.id); makers.push({ ...p, in: r.x.title }); }
    }
    homeHtml = shelf('In This Week’s Top 10', 'The faces of the UK’s most-watched shows and films right now.', stars, (p) => p.in)
      + shelf('Behind the Camera', 'Who made them.', makers, (p) => `${p.role}, ${p.in}`)
      + shelf('Popular This Week', 'Who everyone’s looking up.', (trend?.results || []).filter((p) => p.photo), (p) => p.known[0] || DEPT[p.dept] || '');
    if (!homeHtml) homeHtml = `<div class="p-empty"><h2>Search for anyone</h2><p>Type a name to find an actor, director or writer.</p></div>`;
    if (!q.value.trim() && !person.dataset.id) out.innerHTML = homeHtml;
  }

  // ---------- search ----------
  let ctl = null, timer = 0;
  function search() {
    const s = q.value.trim();
    clear.hidden = !q.value;
    const u = new URL(location.href); s ? u.searchParams.set('q', s) : u.searchParams.delete('q'); history.replaceState(history.state, '', u);
    clearTimeout(timer); ctl?.abort();
    if (s.length < 2) { note.textContent = ''; find.classList.remove('searching'); home(); return; }
    find.classList.add('searching');
    timer = setTimeout(async () => {
      ctl = new AbortController();
      note.textContent = 'Searching…';
      try {
        const r = await get(`/people?q=${encodeURIComponent(s)}`, ctl.signal);
        const list = r.results || [];
        note.textContent = list.length ? '' : `No one called “${s}”. Check the spelling, or try their surname.`;
        out.innerHTML = list.length ? `<ul class="faces grid" aria-label="People called ${esc(s)}">${list.map((p) =>
          face(p, [DEPT[p.dept] || p.dept, p.known.slice(0, 2).join(', ')].filter(Boolean).join(' · '))).join('')}</ul>` : '';
      } catch (e) { if (e.name !== 'AbortError') note.textContent = 'Search isn’t answering just now. Try again in a moment.'; }
    }, 220);
  }
  q.addEventListener('input', search);
  clear.addEventListener('click', () => { q.value = ''; search(); q.focus(); });

  // ---------- a person ----------
  const day = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  function age(born, died) {
    const a = new Date(born + 'T12:00:00'), b = died ? new Date(died + 'T12:00:00') : new Date();
    return b.getFullYear() - a.getFullYear() - (b < new Date(b.getFullYear(), a.getMonth(), a.getDate()) ? 1 : 0);
  }
  const poster = (x) => `<span class="pp-art" style="--h:${hue(x.title)}">${x.poster ? `<img src="${esc(x.poster)}" alt="" loading="lazy" decoding="async">` : `<i>${esc(x.title)}</i>`}</span>`;
  const credit = (x) => `<li><a href="./?t=${x.k}" data-k="${x.k}"><span class="pp-y">${esc(x.year || '—')}</span>${poster(x)}
    <span class="pp-t"><b>${esc(x.title)}</b><small>${esc([x.role, x.eps > 1 ? `${x.eps} episodes` : '', x.type === 'tv' ? 'Show' : 'Film'].filter(Boolean).join(' · '))}</small></span></a></li>`;
  let pd = null;
  async function showPerson(id, push) {
    if (push) history.pushState({ p: id }, '', `?p=${id}`);
    find.hidden = true; person.hidden = false; person.dataset.id = id;
    person.innerHTML = `<div class="pp-hero"><div class="pp-in">${back}<span class="pf pp-ph sk"></span><div class="pp-id"><p class="pp-dept">&nbsp;</p><h1 class="sk-t">Loading…</h1></div></div></div>`;
    scrollTo({ top: 0, behavior: 'instant' });
    try { pd = await get(`/person/${id}`); } catch { pd = null; }
    if (person.dataset.id !== String(id)) return;
    if (!pd) { person.innerHTML = `<div class="pp-hero"><div class="pp-in">${back}</div></div><div class="p-empty"><h2>Couldn’t load this person</h2><p>Check your connection and try again.</p></div>`; return; }
    document.title = `${pd.name} · Cast & Crew · Tenner`;
    const facts = [pd.born && `Born ${day(pd.born)}${pd.place ? ` in ${pd.place}` : ''}`, pd.died ? `Died ${day(pd.died)}, aged ${age(pd.born, pd.died)}` : pd.born && `Age ${age(pd.born)}`].filter(Boolean);
    const dated = (l) => [...l.filter((x) => x.year), ...l.filter((x) => !x.year)];   // undated (unannounced) work goes last
    const tabs = [['acting', 'Acting', dated(pd.acting)], ['crew', 'Behind the Camera', dated(pd.crew)]].filter((t) => t[2].length);
    const first = pd.dept === 'Acting' || !pd.crew.length ? tabs[0] : tabs.find((t) => t[0] === 'crew');
    person.innerHTML = `<div class="pp-hero" style="--h:${hue(pd.name)}">${pd.photo ? `<img class="pp-glow" src="${esc(pd.photo)}" alt="" aria-hidden="true">` : ''}
      <div class="pp-in">${back}${photo(pd, 'pf pp-ph')}
        <div class="pp-id"><p class="pp-dept">${esc(DEPT[pd.dept] || pd.dept || '')}</p><h1>${esc(pd.name)}</h1>
          ${facts.length ? `<p class="pp-facts">${esc(facts.join(' · '))}</p>` : ''}</div></div></div>
      ${pd.bio ? `<section class="pp-bio"><p id="ppBio">${esc(pd.bio).replace(/\n\n+/g, '</p><p>')}</p><button type="button" class="pp-more" id="ppMore" hidden>More</button></section>` : ''}
      ${pd.known.length ? `<section class="p-sec"><div class="p-sh"><h2>Known For</h2></div><ul class="pp-known shelf">${pd.known.map((x) =>
        `<li><a href="./?t=${x.k}" data-k="${x.k}">${poster(x)}<b>${esc(x.title)}</b><small>${esc([x.year, x.role].filter(Boolean).join(' · '))}</small></a></li>`).join('')}</ul></section>` : ''}
      ${tabs.length ? `<section class="p-sec"><div class="p-sh pp-fh"><h2>Filmography</h2>${tabs.length > 1 ? `<div class="segmented" role="radiogroup" aria-label="Acting or behind the camera"><span class="seg-thumb" aria-hidden="true"></span>${tabs.map((t) =>
        `<button type="button" role="radio" data-f="${t[0]}" aria-checked="${t === first}">${t[1]} <span class="pp-n">${t[2].length}</span></button>`).join('')}</div>` : ''}</div>
        <ol class="pp-list" id="ppList">${first[2].map(credit).join('')}</ol></section>` : ''}`;
    const bio = $('#ppBio'), more = $('#ppMore');
    if (bio && bio.closest('.pp-bio').scrollHeight > bio.closest('.pp-bio').clientHeight + 4) { more.hidden = false; }
    more?.addEventListener('click', () => { bio.closest('.pp-bio').classList.add('open'); more.remove(); });
    const seg = person.querySelector('.segmented'), pick = (b) => {
      seg.querySelectorAll('button').forEach((n) => n.setAttribute('aria-checked', n === b));
      $('#ppList').innerHTML = tabs.find((t) => t[0] === b.dataset.f)[2].map(credit).join(''); $('#ppList').scrollTop = 0;
    };
    if (seg) { segment(seg, pick); seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick(b); }); }
  }
  const back = `<a class="pp-back" href="people.html" data-back><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>Cast &amp; Crew</a>`;
  function showFind() {
    delete person.dataset.id; person.hidden = true; person.innerHTML = ''; find.hidden = false;
    document.title = 'Cast & Crew · Tenner';
    search();
  }

  // ---------- taps ----------
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-p], a[data-k], a[data-back]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault();
    if (a.dataset.p && a.closest('#sheet')) {   // from a title sheet's Cast & Crew: close it, then open the person
      const go = () => { removeEventListener('popstate', go); clearTimeout(t); showPerson(a.dataset.p, true); };
      const t = setTimeout(go, 400); addEventListener('popstate', go); window.tnSheet.close(); return;
    }
    if (a.dataset.p) return showPerson(a.dataset.p, true);
    if (a.dataset.back !== undefined) { if (history.state?.p) history.back(); else { history.pushState(null, '', 'people.html' + (q.value.trim() ? `?q=${encodeURIComponent(q.value.trim())}` : '')); showFind(); } return; }
    const x = [...pd.known, ...pd.acting, ...pd.crew].find((y) => y.k === a.dataset.k); if (!x) return;
    window.tnSheet?.open({ k: x.k, type: x.type, title: x.title, year: x.year, poster: x.poster?.replace('/w342/', '/w500/'),
      tmdb: `https://www.themoviedb.org/${x.type}/${x.k.slice(1)}`, services: [] });
  });
  // Back and Forward move between the search and the people you've opened (a title sheet handles its own ?t=)
  addEventListener('popstate', () => {
    const p = new URL(location.href).searchParams.get('p');
    if (p && p !== person.dataset.id) showPerson(p, false); else if (!p && person.dataset.id) showFind();
  });

  // ---------- start ----------
  const u = new URL(location.href), p = u.searchParams.get('p'), t = u.searchParams.get('t');
  q.value = u.searchParams.get('q') || '';
  if (p && /^\d+$/.test(p)) showPerson(p, false); else search();
  if (t) window.tnSheet?.openKey?.(t);
  if (!reduce && !p && matchMedia('(hover: hover)').matches) q.focus({ preventScroll: true });
})();

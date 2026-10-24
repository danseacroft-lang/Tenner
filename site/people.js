// Cast & Crew: the people behind every show and film (TMDB, through Tenner's search API on Cloudflare).
// The front: this week's faces drifting past behind the title, a glass search bar, the stars of the week's Top 10 as
// portrait cards, who made them, and the Top 10 people everyone's looking up. A person (?p=ID): what they're best known
// for as a cinematic backdrop, their portrait and name, a few facts and figures, what of theirs is streaming on the
// five services right now, Known For, and their whole career by decade. Any title opens the usual title sheet.
(() => {
  const { esc, hue, reduce, api, segment } = window.tn;
  const $ = (s) => document.querySelector(s);
  const find = $('#find'), person = $('#person'), q = $('#pq'), clear = $('#pqClear'), note = $('#pNote'), out = $('#pResults');
  const get = (path, signal) => fetch(api + path, { signal }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
  const DEPT = { Acting: 'Actor', Directing: 'Director', Writing: 'Writer', Production: 'Producer', Sound: 'Composer', Camera: 'Cinematographer', Editing: 'Editor', Creator: 'Creator' };
  const initials = (n) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const photo = (p, cls = 'pf') => `<span class="${cls}" style="--h:${hue(p.name)}">${p.photo
    ? `<img src="${esc(p.photo)}" alt="" loading="lazy" decoding="async">` : `<i aria-hidden="true">${esc(initials(p.name))}</i>`}</span>`;
  const still = () => reduce || document.documentElement.classList.contains('still');

  // the hour's chart and the Browse catalogue: which of someone's titles are streaming on the five services right now
  let catP = null;
  const catalogue = () => (catP ||= Promise.all([
    fetch(`data/browse.json?v=${Math.floor(Date.now() / 600000)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`data/trending.json?v=${Math.floor(Date.now() / 600000)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([c, t]) => {
    const on = new Map(); for (const x of c?.items || []) if (x.s?.length) on.set(`${x.t[0]}${x.i}`, x.s);
    const svc = {}; for (const s of t?.services || []) if (!s.store) svc[s.key] = { label: s.label, logo: s.logo };
    return { on, svc, chart: t };
  }));

  // ---------- the front ----------
  // a portrait card: the face big, the name, and what they're in (with that title's poster)
  const card = (p, sub, extra = '') => `<li class="pcard-p"><a href="?p=${p.id}" data-p="${p.id}"><span class="pc-ph">${photo(p, 'pf pf-card')}${extra}</span>
    <span class="pc-name"><b>${esc(p.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></a></li>`;
  const shelf = (title, lede, items) => items ? `<section class="p-sec"><div class="p-sh"><h2>${esc(title)}</h2>${lede ? `<p>${esc(lede)}</p>` : ''}</div>
    <ul class="p-shelf">${items}</ul></section>` : '';
  let homeHtml = null;
  async function home() {
    if (homeHtml) { out.innerHTML = homeHtml; return; }
    out.innerHTML = '<div class="p-load" aria-hidden="true">' + '<span></span>'.repeat(8) + '</div>';
    const { chart } = await catalogue();
    const o = chart?.overall || {}, tops = [0, 1, 2, 3].flatMap((i) => [o.tv?.[i], o.movie?.[i]]).filter((x) => x?.id);   // shows and films taking turns
    const [credits, trend] = await Promise.all([
      Promise.all(tops.map((x) => get(`/credits/${x.type === 'movie' ? 'm' : 't'}${x.id}`).then((c) => ({ x, c })).catch(() => null))),
      get('/people').catch(() => null),
    ]);
    const seen = new Set(), stars = [], makers = [];
    for (const r of credits.filter(Boolean)) {
      for (const p of r.c.cast.slice(0, 3)) if (!seen.has(p.id)) { seen.add(p.id); stars.push({ ...p, in: r.x }); }
      for (const p of r.c.crew.slice(0, 1)) if (!seen.has(p.id)) { seen.add(p.id); makers.push({ ...p, in: r.x }); }
    }
    const inPoster = (x) => (x.poster ? `<img class="pc-in" src="${esc(x.poster)}" alt="" loading="lazy">` : '');
    const top10 = (trend?.results || []).filter((p) => p.photo).slice(0, 10);
    homeHtml = shelf('In This Week’s Top 10', 'The faces of the UK’s most-watched shows and films right now.', stars.map((p) => card(p, `${p.role ? `${p.role} in ` : ''}${p.in.title}`, inPoster(p.in))).join(''))
      + shelf('Behind the Camera', 'Who made them.', makers.map((p) => card(p, `${p.role}, ${p.in.title}`, inPoster(p.in))).join(''))
      + (top10.length ? `<section class="p-sec"><div class="p-sh"><h2>The Top 10 People This Week</h2><p>Who everyone’s looking up.</p></div>
        <ol class="cl">${top10.map((p, i) => `<li><a href="?p=${p.id}" data-p="${p.id}"><span class="cl-n">${i + 1}</span>${photo(p, 'pf cl-pf')}
          <span class="cl-t"><b>${esc(p.name)}</b><small>${esc([DEPT[p.dept] || p.dept, p.known.slice(0, 2).join(', ')].filter(Boolean).join(' · '))}</small></span></a></li>`).join('')}</ol></section>` : '');
    if (!homeHtml) homeHtml = `<div class="p-empty"><h2>Search for anyone</h2><p>Type a name to find an actor, director or writer.</p></div>`;
    wall([...stars, ...top10, ...makers]);   // only if the whole-catalogue faces didn't come
    if (!q.value.trim() && !person.dataset.id) out.innerHTML = homeHtml;
  }
  // the wall: three rows of faces from all of TMDB's popular people (three random pages, so different people every
  // visit), each row its own set, the middle one drifting the other way (paused when animations are off)
  const shuffle = (l) => { for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; };
  function wall(people) {
    const box = $('#pcWall'); if (box.dataset.done) return;
    const seen = new Set(), f = shuffle(people.filter((p) => p.photo && !seen.has(p.id) && seen.add(p.id)));
    if (f.length < 9) return;
    const per = Math.ceil(f.length / 3), row = (n) => {
      const cells = f.slice(n * per, n * per + per).map((p) => `<span class="pw-f"><img src="${esc(p.photo)}" alt="" loading="lazy" decoding="async"></span>`).join('');
      return `<div class="pw-row${n % 2 ? ' rev' : ''}"><div class="pw-track">${cells}${cells}</div></div>`;
    };
    box.innerHTML = row(0) + row(1) + row(2); box.dataset.done = '1';
    requestAnimationFrame(() => box.classList.add('in'));
  }
  const pages = shuffle(Array.from({ length: 25 }, (_, i) => i + 1)).slice(0, 3);
  Promise.all(pages.map((n) => get(`/people?page=${n}`).catch(() => null)))
    .then((r) => wall(r.flatMap((x) => x?.results || []))).catch(() => {});

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
        out.innerHTML = list.length ? `<ul class="p-grid" aria-label="People called ${esc(s)}">${list.map((p) =>
          card(p, [DEPT[p.dept] || p.dept, p.known.slice(0, 2).join(', ')].filter(Boolean).join(' · '))).join('')}</ul>` : '';
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
  let pd = null, cat = null;
  const onLogos = (k, cls = 'pp-on') => { const s = cat?.on.get(k); if (!s) return ''; const l = s.map((x) => cat.svc[x]).filter((x) => x?.logo).slice(0, 3);
    return l.length ? `<span class="${cls}" title="On ${esc(l.map((x) => x.label).join(', '))}">${l.map((x) => `<img src="${esc(x.logo)}" alt="${esc(x.label)}">`).join('')}</span>` : ''; };
  const credit = (x) => `<li><a href="./?t=${x.k}" data-k="${x.k}">${poster(x)}
    <span class="cl-t"><b>${esc(x.title)}</b><small>${esc([x.role, x.eps > 1 ? `${x.eps} episodes` : '', x.type === 'tv' ? 'Show' : 'Film'].filter(Boolean).join(' · '))}</small></span>
    ${onLogos(x.k)}<span class="cl-r">${esc(x.year || 'Soon')}</span></a></li>`;
  // the career, newest first, in decades
  function career(list) {
    const by = new Map();
    for (const x of list) { const d = x.year ? `${x.year.slice(0, 3)}0s` : 'Coming soon'; by.set(d, [...(by.get(d) || []), x]); }
    return [...by].map(([d, l]) => `<li class="pp-dec"><h3><span>${esc(d)}</span><small>${l.length}</small></h3><ol class="cl nw-cl pp-cl">${l.map(credit).join('')}</ol></li>`).join('');
  }
  const back = `<a class="pp-back" href="people.html" data-back><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>Cast &amp; Crew</a>`;
  async function showPerson(id, push) {
    if (push) history.pushState({ p: id }, '', `?p=${id}`);
    find.hidden = true; person.hidden = false; person.dataset.id = id;
    person.innerHTML = `<div class="pp-hero"><div class="pp-in"><span class="pf pp-ph sk"></span><div class="pp-id">${back}<p class="pp-dept">&nbsp;</p><h1 class="sk-t">Loading…</h1></div></div></div>`;
    scrollTo({ top: 0, behavior: 'instant' });
    let d; try { [d, cat] = await Promise.all([get(`/person/${id}`), catalogue()]); } catch { d = null; }
    pd = d;
    if (person.dataset.id !== String(id)) return;
    if (!pd) { person.innerHTML = `<div class="pp-hero"><div class="pp-in"><div class="pp-id">${back}</div></div></div><div class="p-empty"><h2>Couldn’t load this person</h2><p>Check your connection and try again.</p></div>`; return; }
    document.title = `${pd.name} · Cast & Crew · Tenner`;
    const dated = (l) => [...l.filter((x) => x.year), ...l.filter((x) => !x.year)];   // undated (unannounced) work goes last
    const tabs = [['acting', 'Acting', dated(pd.acting)], ['crew', 'Behind the Camera', dated(pd.crew)]].filter((t) => t[2].length);
    let tab = pd.dept === 'Acting' || !pd.crew.length ? tabs[0] : tabs.find((t) => t[0] === 'crew'), kind = 'all';
    // figures: how many credits, since when, how many of them you can watch now
    const all = [...pd.acting, ...pd.crew], years = all.map((x) => +x.year).filter(Boolean), since = years.length ? Math.min(...years) : null;
    const nowOn = [...new Map(all.filter((x) => cat?.on.has(x.k)).map((x) => [x.k, x])).values()];
    const figs = [[new Set(all.map((x) => x.k)).size, 'credits'], since && [new Date().getFullYear() - since, `years, since ${since}`], nowOn.length && [nowOn.length, 'streaming now']].filter(Boolean);
    const chips = [pd.born && (pd.died ? `${day(pd.born)} – ${day(pd.died)}` : `Born ${day(pd.born)}`), pd.born && (pd.died ? `Aged ${age(pd.born, pd.died)}` : `Age ${age(pd.born)}`), pd.place].filter(Boolean);
    // the splash: the wide artwork of what they're best known for, dissolving into the page; without one, a glow of their own photo
    const sp = pd.known.find((x) => x.bd);
    const bg = sp ? `<div class="pp-bg" aria-hidden="true"><img src="${esc(sp.bd)}" srcset="${esc(sp.bd)} 1280w, ${esc(sp.bd.replace('/w1280/', '/original/'))} 1920w" sizes="100vw" alt="" fetchpriority="high" decoding="async" onload="this.classList.add('on')"><div class="pp-wash"></div><div class="pp-shade"></div></div>`
      : pd.photo ? `<img class="pp-glow" src="${esc(pd.photo)}" alt="" aria-hidden="true">` : '';
    const cap = sp ? `<a class="pp-now" href="./?t=${sp.k}" data-k="${sp.k}">${sp.poster ? `<img src="${esc(sp.poster)}" alt="">` : ''}<span><small>Best known for</small><b>${esc(sp.title)}</b></span></a>` : '';
    nowOn.sort((a, b) => (b.votes || 0) - (a.votes || 0));
    person.innerHTML = `<div class="pp-hero${sp ? ' splash' : ''}" style="--h:${hue(pd.name)}">${bg}
      <div class="pp-in">${photo(pd, 'pf pp-ph')}
        <div class="pp-id">${back}<p class="pp-dept">${esc(DEPT[pd.dept] || pd.dept || '')}</p><h1 tabindex="-1">${esc(pd.name)}</h1>
          ${chips.length ? `<p class="pp-chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</p>` : ''}
          ${figs.length ? `<dl class="pp-figs">${figs.map(([n, l]) => `<div><dt>${n}</dt><dd>${esc(l)}</dd></div>`).join('')}</dl>` : ''}
          <div class="pp-acts"><button type="button" class="btn btn-tinted" id="ppShare"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11v8.5h12V11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Share</button>${cap}</div>
        </div></div></div>
      ${pd.bio ? `<section class="pp-bio"><div class="pp-bio-t" id="ppBio"><p>${esc(pd.bio).replace(/\n\n+/g, '</p><p>')}</p></div><button type="button" class="pp-more" id="ppMore" hidden>More</button></section>` : ''}
      ${nowOn.length ? `<section class="p-sec"><div class="p-sh"><h2>Watch ${esc(pd.name.split(' ')[0])} Now</h2><p>On the five services right now.</p></div><ul class="pp-known p-shelf">${nowOn.slice(0, 20).map((x) =>
        `<li><a href="./?t=${x.k}" data-k="${x.k}">${poster(x)}${onLogos(x.k, 'pp-on pp-on-art')}<b>${esc(x.title)}</b><small>${esc([x.year, x.role].filter(Boolean).join(' · '))}</small></a></li>`).join('')}</ul></section>` : ''}
      ${pd.known.length ? `<section class="p-sec"><div class="p-sh"><h2>Known For</h2></div><ul class="pp-known pp-big p-shelf">${pd.known.map((x) =>
        `<li><a href="./?t=${x.k}" data-k="${x.k}">${poster(x)}${onLogos(x.k, 'pp-on pp-on-art')}<b>${esc(x.title)}</b><small>${esc([x.year, x.role].filter(Boolean).join(' · '))}</small></a></li>`).join('')}</ul></section>` : ''}
      ${tabs.length ? `<section class="p-sec pp-career"><div class="p-sh pp-fh"><div><h2>Career</h2><p id="ppCount"></p></div>
        <div class="pp-ctl">${tabs.length > 1 ? `<div class="segmented" role="radiogroup" aria-label="Acting or behind the camera"><span class="seg-thumb" aria-hidden="true"></span>${tabs.map((t) =>
          `<button type="button" role="radio" data-f="${t[0]}" aria-checked="${t === tab}">${t[1]}</button>`).join('')}</div>` : ''}
          <div class="pp-kinds" role="radiogroup" aria-label="Shows or films">${[['all', 'All'], ['tv', 'Shows'], ['movie', 'Films']].map(([k, l]) => `<button type="button" role="radio" data-kind="${k}" aria-checked="${k === 'all'}">${l}</button>`).join('')}</div></div></div>
        <ol class="pp-decs" id="ppList"></ol></section>` : ''}`;
    if (push) person.querySelector('h1').focus({ preventScroll: true });   // screen readers land on the person's name
    const draw = () => {
      const l = tab[2].filter((x) => kind === 'all' || x.type === kind);
      $('#ppList').innerHTML = l.length ? career(l) : '<li class="p-empty"><p>None of those.</p></li>';
      $('#ppCount').textContent = `${l.length} ${tab[0] === 'acting' ? 'roles' : 'credits'}${kind === 'tv' ? ' in shows' : kind === 'movie' ? ' in films' : ''}`;
    };
    if (tabs.length) draw();
    const bio = $('#ppBio'), more = $('#ppMore');
    if (bio && bio.scrollHeight > bio.clientHeight + 4) { more.hidden = false; bio.classList.add('folded'); }
    more?.addEventListener('click', () => { bio.classList.remove('folded'); bio.classList.add('open'); more.remove(); });
    const seg = person.querySelector('.segmented'), pick = (b) => { seg.querySelectorAll('button').forEach((n) => n.setAttribute('aria-checked', n === b)); tab = tabs.find((t) => t[0] === b.dataset.f); draw(); };
    if (seg) { segment(seg, pick); seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick(b); }); }
    person.querySelector('.pp-kinds')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-kind]'); if (!b) return;
      kind = b.dataset.kind; person.querySelectorAll('.pp-kinds button').forEach((n) => n.setAttribute('aria-checked', n === b)); draw();
    });
    $('#ppShare').addEventListener('click', () => window.tn.share({ heading: `Share ${pd.name}`, title: `${pd.name} on Tenner`, text: `${pd.name}: everything they’ve made, and where to watch it`, url: `${location.origin}${location.pathname}?p=${pd.id}` }));
  }
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
      tmdb: `https://www.themoviedb.org/${x.type}/${x.k.slice(1)}`, services: (cat?.on.get(x.k) || []).map((s) => cat.svc[s]).filter(Boolean) });
  });
  // Back and Forward move between the search and the people you've opened (a title sheet handles its own ?t=)
  addEventListener('popstate', () => {
    const p = new URL(location.href).searchParams.get('p');
    if (p && p !== person.dataset.id) showPerson(p, false); else if (!p && person.dataset.id) showFind();
    const t = new URL(location.href).searchParams.get('t'); if (t && !window.tnSheet?.isOpen()) window.tnSheet?.openKey?.(t);
  });

  // ---------- start ----------
  const u = new URL(location.href), p = u.searchParams.get('p'), t = u.searchParams.get('t');
  q.value = u.searchParams.get('q') || '';
  if (p && /^\d+$/.test(p)) showPerson(p, false); else search();
  if (t) window.tnSheet?.openKey?.(t);
  if (!still() && !p && matchMedia('(hover: hover)').matches) q.focus({ preventScroll: true });
})();

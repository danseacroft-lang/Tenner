// Tenner's suggestion cards: now and then, a visitor is shown one hand-made card in Browse, themed to the show it
// suggests, with a button that opens that show's sheet, and (only when tapped) a short sound of 1 to 3 seconds,
// made in the browser with Web Audio (no recordings). Each card runs between two dates; a visitor sees one on about
// half their visits, decided once per visit, never again once they close it, and never if it's rated 18 and Settings
// hides 18s. ?card=<id> shows a card regardless (for trying one out).
(() => {
  const { esc, reduce, prefs, api } = window.tn;
  const HIDDEN = 'tenner-cards-hidden', PICK = 'tenner-card';
  const still = () => reduce || document.documentElement.classList.contains('still');
  const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch {} } };
  const hidden = () => { try { return JSON.parse(ls.get(HIDDEN) || '[]'); } catch { return []; } };
  const day = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  // ---------- the sound: a tiny piece of synthesis, well under three seconds ----------
  let ctx = null;
  const audio = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  const SOUNDS = {
    // a slow heartbeat: two low thumps, twice (about 1.5s)
    heartbeat(c, out) {
      const t0 = c.currentTime + 0.02;
      [0, 0.28, 1.05, 1.33].forEach((d, i) => {
        const t = t0 + d, o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(i % 2 ? 62 : 75, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
        o.connect(g).connect(out); env(g, t, 0.01, i % 2 ? 0.5 : 0.75, 0.24); o.start(t); o.stop(t + 0.32);
      });
    },
  };
  function play(name) {
    const c = audio(); if (c.state === 'suspended') c.resume();
    const out = c.createGain(); out.gain.value = 0.7; out.connect(c.destination);
    const echo = c.createDelay(); echo.delayTime.value = 0.23; const fb = c.createGain(); fb.gain.value = 0.28;   // a little room around it
    out.connect(echo); echo.connect(fb).connect(echo); echo.connect(c.destination);
    SOUNDS[name](c, out);
  }

  // ---------- the cards ----------
  const CARDS = [{
    id: 'ahs13', from: '2026-10-01', until: '2026-11-02', k: 't1413', cert18: true, sound: 'heartbeat',
    theme: 'ahs',
    // filled in from the show's details when they arrive: the next episode's date, if there is one
    html: (d) => {
      const nx = d?.items?.t1413?.nx, today = new Date().toLocaleDateString('en-CA');
      const last = d?.items?.t1413?.sz?.at(-1);   // episodes in the latest season, so the last one can be called the finale
      const when = nx && nx[0] >= today ? (nx[2] === last ? `The finale arrives ${day(nx[0])}.` : `Episode ${nx[2]} arrives ${day(nx[0])}.`) : 'The finale arrives Friday 30 October.';
      const bd = d?.info?.backdrop;
      return `<div class="dyn-art" aria-hidden="true">${bd ? `<img src="${esc(bd)}" alt="" decoding="async">` : ''}<i class="dyn-blood"></i><i class="dyn-grain"></i><i class="dyn-scratch"></i><i class="dyn-glow"></i></div>
        <span class="ahs-13" aria-hidden="true">13</span>
        <div class="dyn-copy">
          <p class="dyn-eye">Tenner suggests</p>
          <h3 class="dyn-h">American Horror Story</h3>
          <p class="dyn-p">Season 13 is streaming now on Disney+, new episodes every Friday. ${esc(when)}</p>
          <div class="dyn-acts">
            <button type="button" class="dyn-go" data-open="t1413">Watch the latest<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            <button type="button" class="dyn-snd" aria-label="Play a short spooky sound" title="Play a short spooky sound"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg></button>
          </div>
        </div>`;
    },
  }];

  function pick() {
    const forced = new URLSearchParams(location.search).get('card');
    const today = new Date().toLocaleDateString('en-CA'), gone = hidden();
    const live = CARDS.filter((c) => c.id === forced || (today >= c.from && today <= c.until && !gone.includes(c.id) && !(c.cert18 && prefs.get().no18)));
    if (forced) return live.find((c) => c.id === forced) || null;
    let choice = ss.get(PICK);   // once per visit: a card on about half of them
    if (choice === null) { choice = live.length && Math.random() < 0.5 ? live[Math.floor(Math.random() * live.length)].id : ''; ss.set(PICK, choice); }
    return live.find((c) => c.id === choice) || null;
  }

  const card = pick(); if (!card) return;
  const el = document.createElement('section');
  el.className = `dyn dyn-${card.theme}`; el.setAttribute('aria-label', 'A suggestion from Tenner');
  el.innerHTML = card.html(null) + '<button type="button" class="dyn-x" aria-label="Hide this suggestion" title="Hide this suggestion"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>';
  // on computers, among the filters (after Sort by); on phones, above the genres
  const wide = matchMedia('(min-width: 821px)');
  const place = () => {
    const sort = document.querySelector('#sort')?.closest('.panel'), rows = document.querySelector('#bRows');
    if (wide.matches && sort) sort.after(el); else rows?.after(el);
  };
  place(); wide.addEventListener('change', place);
  if (api) fetch(`${api}/title/${card.k}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d) return; const x = el.querySelector('.dyn-x'); el.innerHTML = card.html(d); el.append(x);
  }).catch(() => {});

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-open]')) window.tnSheet?.openKey?.(e.target.closest('[data-open]').dataset.open);
    if (e.target.closest('.dyn-snd')) {
      play(card.sound);
      const b = e.target.closest('.dyn-snd'); b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit');
      el.classList.remove('jolt'); void el.offsetWidth; if (!still()) el.classList.add('jolt');
    }
    if (e.target.closest('.dyn-x')) {
      ls.set(HIDDEN, JSON.stringify([...hidden(), card.id].slice(-50)));
      if (still() || !el.animate) return el.remove();
      el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.94)', filter: 'blur(6px)' }], { duration: 280, easing: 'cubic-bezier(.3,0,.2,1)' }).finished.then(() => el.remove());
    }
  });
  // the light follows your pointer, and the card leans towards it a touch
  if (matchMedia('(hover: hover)').matches) {
    el.addEventListener('pointermove', (e) => {
      if (still()) return; const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--mx', `${x * 100}%`); el.style.setProperty('--my', `${y * 100}%`);
      el.style.setProperty('--rx', `${(0.5 - y) * 5}deg`); el.style.setProperty('--ry', `${(x - 0.5) * 6}deg`);
    });
    el.addEventListener('pointerleave', () => ['--mx', '--my', '--rx', '--ry'].forEach((p) => el.style.removeProperty(p)));
  }
})();

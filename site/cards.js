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

  // ---------- the sounds: tiny pieces of synthesis, each well under three seconds ----------
  let ctx = null;
  const audio = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  const SOUNDS = {
    // a wind-up music box, slightly out of tune, with a low hum underneath (about 2.6s)
    musicbox(c, out) {
      const t0 = c.currentTime + 0.02;
      const hum = c.createOscillator(), hg = c.createGain(); hum.type = 'sine'; hum.frequency.value = 55; hum.connect(hg).connect(out); env(hg, t0, 0.4, 0.12, 2.1); hum.start(t0); hum.stop(t0 + 2.6);
      [659.3, 523.3, 440, 622.3, 415.3].forEach((f, i) => {
        const t = t0 + i * 0.36, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
        o.type = 'triangle'; o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.012); o2.type = 'sine'; o2.frequency.value = f * 2.01;
        o.connect(g); o2.connect(g); g.connect(out); env(g, t, 0.005, 0.22, 0.9); o.start(t); o2.start(t); o.stop(t + 1); o2.stop(t + 1);
      });
    },
    // a slow heartbeat: two low thumps, twice (about 2s)
    heartbeat(c, out) {
      const t0 = c.currentTime + 0.02;
      [0, 0.28, 1.05, 1.33].forEach((d, i) => {
        const t = t0 + d, o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(i % 2 ? 62 : 75, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
        o.connect(g).connect(out); env(g, t, 0.01, i % 2 ? 0.5 : 0.75, 0.24); o.start(t); o.stop(t + 0.32);
      });
    },
    // an old door creaking open (about 1.8s)
    creak(c, out) {
      const t0 = c.currentTime + 0.02, o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), bp = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(95, t0); o.frequency.linearRampToValueAtTime(140, t0 + 0.9); o.frequency.linearRampToValueAtTime(80, t0 + 1.7);
      lfo.frequency.value = 23; lg.gain.value = 18; lfo.connect(lg).connect(o.frequency);
      bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 2.5;
      o.connect(bp).connect(g).connect(out);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1.3, t0 + 0.3); g.gain.setValueAtTime(1.3, t0 + 1.35); g.gain.linearRampToValueAtTime(0, t0 + 1.78); o.start(t0); lfo.start(t0); o.stop(t0 + 1.8); lfo.stop(t0 + 1.8);
    },
    // an original sound in the spirit of a horror title sequence (no one's theme, no borrowed tune): a stuttering, glitchy
    // pulse, metal scraping, a distorted swell, then a hard cut to silence (about 2.5s)
    glitch(c, out) {
      const t0 = c.currentTime + 0.02, end = t0 + 2.35;
      const noise = c.createBuffer(1, c.sampleRate * 2.5, c.sampleRate), ch = noise.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      const src = (o) => { const n = c.createBufferSource(); n.buffer = noise; n.start(t0, o || 0); n.stop(end); return n; };
      // the pulse: short bursts of filtered noise and a dirty low thud, on an uneven, stumbling beat
      const gate = c.createGain(), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.2;
      src().connect(bp).connect(gate).connect(out); gate.gain.value = 0;
      const thud = c.createOscillator(), tg = c.createGain(); thud.type = 'square'; thud.frequency.value = 49; thud.connect(tg).connect(out); tg.gain.value = 0;
      [0, .13, .2, .5, .63, .7, .78, 1.0, 1.13, 1.38, 1.45, 1.52, 1.59, 1.66, 1.9, 1.97, 2.04, 2.11, 2.18, 2.25].forEach((d, i) => {
        const t = t0 + d, len = i % 3 ? 0.035 : 0.07;
        gate.gain.setValueAtTime(0.5, t); gate.gain.setValueAtTime(0, t + len);
        if (i % 3 === 0) { tg.gain.setValueAtTime(0.32, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.11); }
      });
      thud.start(t0); thud.stop(end);
      // the scrape: noise through a narrow, wandering filter, like metal dragged on metal
      const sc = c.createBiquadFilter(), sg = c.createGain(), wob = c.createOscillator(), wg = c.createGain();
      sc.type = 'bandpass'; sc.Q.value = 28; sc.frequency.setValueAtTime(2300, t0 + 0.4); sc.frequency.linearRampToValueAtTime(3900, t0 + 1.5); sc.frequency.linearRampToValueAtTime(2700, end);
      wob.frequency.value = 7; wg.gain.value = 260; wob.connect(wg).connect(sc.frequency); wob.start(t0); wob.stop(end);
      src(0.6).connect(sc).connect(sg).connect(out); sg.gain.setValueAtTime(0.0001, t0 + 0.4); sg.gain.exponentialRampToValueAtTime(0.9, t0 + 1.1); sg.gain.setValueAtTime(0.9, end - 0.3);
      // the swell: two detuned, distorted saws rising towards the cut
      const shaper = c.createWaveShaper(), curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); }
      shaper.curve = curve;
      const lp = c.createBiquadFilter(), swg = c.createGain(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t0); lp.frequency.exponentialRampToValueAtTime(3200, end);
      [73.4, 77.8].forEach((f) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t0); o.frequency.linearRampToValueAtTime(f * 1.06, end); o.connect(shaper); o.start(t0); o.stop(end); });
      shaper.connect(lp).connect(swg).connect(out); swg.gain.setValueAtTime(0.0001, t0); swg.gain.exponentialRampToValueAtTime(0.16, end - 0.05);
      // and then nothing
      for (const g of [gate, tg, sg, swg]) { g.gain.cancelScheduledValues(end); g.gain.setValueAtTime(0, end); }
    },
  };
  function play(names) {
    const c = audio(); if (c.state === 'suspended') c.resume();
    const name = names[Math.floor(Math.random() * names.length)];
    const out = c.createGain(); out.gain.value = 0.7; out.connect(c.destination);
    if (name !== 'glitch') {   // a little room around it (not the glitch, which ends on a hard cut)
      const echo = c.createDelay(); echo.delayTime.value = 0.23; const fb = c.createGain(); fb.gain.value = 0.28;
      out.connect(echo); echo.connect(fb).connect(echo); echo.connect(c.destination);
    }
    SOUNDS[name](c, out);
    return name;
  }

  // ---------- the cards ----------
  const CARDS = [{
    id: 'ahs13', from: '2026-10-01', until: '2026-11-02', k: 't1413', cert18: true, sounds: ['glitch', 'musicbox', 'heartbeat', 'creak'],
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
      play(card.sounds);
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

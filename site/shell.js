// Tenner's shell, shared by every page: the tabs (a sidebar on computers, a floating bar on phones), the Theme menu,
// keyboard shortcuts, the fade behind the bar once the page scrolls, the hourly freshness check, and a few helpers the
// pages share (window.tn), so each exists once.
(() => {
  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;
  // ---------- settings (settings.html), on this device only ----------
  const PREFS = 'tenner-settings', DEF = { start: 'auto', anim: false, moves: true, ratings: true, hero: true, trailers: 'here', no18: false };
  const prefs = {
    get() { try { const { still, ...p } = JSON.parse(localStorage.getItem(PREFS) || '{}'); return { ...DEF, ...p }; } catch { return { ...DEF }; } },   // still: the old Reduce motion setting, gone
    set(k, v) { const p = prefs.get(); p[k] = v; try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch {} apply(); dispatchEvent(new Event('tn:prefs')); },
  };
  // no animations unless you switch them on in Settings (and never when the device asks for reduced motion)
  const osStill = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const apply = () => { const p = prefs.get(); root.classList.toggle('still', !p.anim || osStill); root.classList.toggle('no-moves', !p.moves); root.classList.toggle('no-ratings', !p.ratings); root.classList.toggle('no-hero', !p.hero); };
  apply();
  const reduce = osStill || !prefs.get().anim;

  // ---------- shared helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hue = (t) => { let h = 0; for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  // The pill under a chosen item (tabs, services, collections): it glides across, stretching a little on the way and
  // settling with a small spring. `from` remembers where each pill was.
  const from = new WeakMap();
  function glide(ind, b, animate, stretch = 1.14) {
    if (!ind || !b || !b.offsetWidth) return;
    const x = b.offsetLeft, w = b.offsetWidth, was = from.get(ind);
    from.set(ind, x);
    if (was === undefined || !animate || reduce || !ind.animate) { ind.style.width = w + 'px'; ind.style.transform = `translateX(${x}px)`; return; }
    const t0 = ind.style.transform, w0 = ind.style.width, mw = Math.max(parseFloat(w0), w) * stretch, mid = (was + x) / 2 - (mw - w) / 2;
    ind.style.width = w + 'px'; ind.style.transform = `translateX(${x}px)`;
    ind.animate([{ transform: t0, width: w0 }, { transform: `translateX(${mid}px)`, width: mw + 'px', offset: 0.45 }, { transform: `translateX(${x}px)`, width: w + 'px' }],
      { duration: 520, easing: 'cubic-bezier(.3,1.15,.4,1)' });
  }
  // Arrow keys move through a group of radio-like buttons (segmented controls, menus), as on Apple platforms.
  function arrows(group, items, pick) {
    group.addEventListener('keydown', (e) => {
      const list = items().filter((b) => b.offsetWidth && !b.hidden), i = list.indexOf(document.activeElement);
      const k = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
      if (k === undefined || i < 0) return;
      e.preventDefault(); const n = list[(k + list.length) % list.length]; n.focus(); pick?.(n);
    });
  }
  // A segmented control that behaves like an iOS switch: its thumb glides to the chosen option with a little spring
  // (when animations are on), and you can grab it and slide (or flick) it between options; it swells slightly while held, then snaps to the nearest.
  // The thumb follows aria-checked, so pages only mark the choice; `pick` is called when a drag lands on a new option.
  function segment(group, pick) {
    if (!group) return;
    const thumb = group.querySelector('.seg-thumb'), btns = () => [...group.querySelectorAll('button')].filter((b) => b.offsetWidth);
    const place = (animate) => glide(thumb, group.querySelector('button[aria-checked="true"]'), animate, 1.1);
    new MutationObserver(() => place(true)).observe(group, { attributes: true, subtree: true, attributeFilter: ['aria-checked'] });
    addEventListener('resize', () => place(false)); document.fonts?.ready.then(() => place(false)); place(false);
    let drag = null, moved = false;
    group.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button');
      if (!b || b.getAttribute('aria-checked') !== 'true' || e.button) return;   // grab the thumb itself
      const x = b.offsetLeft, max = Math.max(...btns().map((n) => n.offsetLeft + n.offsetWidth)) - b.offsetWidth;
      drag = { id: e.pointerId, x0: e.clientX, x, min: btns()[0].offsetLeft, max }; moved = false;
      group.setPointerCapture(e.pointerId); thumb.classList.add('held');
    });
    group.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x0; if (Math.abs(dx) > 3) moved = true;
      thumb.getAnimations?.().forEach((a) => a.cancel());
      thumb.style.transform = `translateX(${Math.min(drag.max, Math.max(drag.min, drag.x + dx))}px)`;
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null; thumb.classList.remove('held');
      if (!moved) return;
      // snap to whichever option the thumb's centre is over
      const r = thumb.getBoundingClientRect(), mid = r.left + r.width / 2;
      const to = btns().reduce((best, n) => { const nr = n.getBoundingClientRect(), d = Math.abs(nr.left + nr.width / 2 - mid); return d < best.d ? { n, d } : best; }, { n: null, d: Infinity }).n;
      if (to && to.getAttribute('aria-checked') !== 'true') pick(to); else place(true);
    };
    group.addEventListener('pointerup', end); group.addEventListener('pointercancel', end);
    // a drag isn't a tap: swallow the click that follows it
    group.addEventListener('click', (e) => { if (moved) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; } }, true);
  }
  // ---------- the version: change it here with every update and it shows everywhere (the sidebar, the end of About) ----------
  const version = '1.15.2';
  document.querySelectorAll('.side-ver, .side-ver-text').forEach((el) => { el.textContent = `Tenner ${version}`; });

  // ---------- the contact address: change it here and it updates everywhere (Contact, Privacy Policy, Terms) ----------
  const contact = 'support@tenner.stream';
  document.querySelectorAll('a.contact-email').forEach((a) => { a.href = `mailto:${contact}`; a.textContent = contact; });
  document.querySelectorAll('.contact-email-text').forEach((el) => { el.textContent = contact; });

  // ---------- the watchlist: kept on this device only (local storage), never sent anywhere ----------
  // Each entry: { k, type, title, year, poster, at }. Pages hear "tn:saved" whenever it changes, here or in another tab.
  const WL = 'tenner-watchlist';
  const saved = {
    all() { try { const l = JSON.parse(localStorage.getItem(WL) || '[]'); return Array.isArray(l) ? l.filter((x) => x?.k) : []; } catch { return []; } },
    has(k) { return !!k && saved.all().some((x) => x.k === k); },
    set(l) { try { localStorage.setItem(WL, JSON.stringify(l)); } catch {} dispatchEvent(new Event('tn:saved')); },
    toggle(info) {
      if (!info?.k) return false;
      const l = saved.all(), on = l.some((x) => x.k === info.k);
      saved.set(on ? l.filter((x) => x.k !== info.k)
        : [{ k: info.k, type: info.type, title: info.title, year: info.year || null, poster: info.poster || null, at: Date.now() }, ...l].slice(0, 500));
      return !on;
    },
    remove(k) { saved.set(saved.all().filter((x) => x.k !== k)); },
  };
  // where you're up to in a show: { k: [season, episode] } (the last episode you've watched), also on this device only
  const PR = 'tenner-progress';
  const progress = {
    all() { try { return JSON.parse(localStorage.getItem(PR) || '{}') || {}; } catch { return {}; } },
    get(k) { const p = progress.all()[k]; return Array.isArray(p) && p.length === 2 ? p : null; },
    set(k, p) { const all = progress.all(); if (p) all[k] = p; else delete all[k]; try { localStorage.setItem(PR, JSON.stringify(all)); } catch {} dispatchEvent(new Event('tn:saved')); },
  };
  // the next episode to watch after [s, e], given each season's episode count; null when you're caught up
  const nextUp = (p, sz) => { if (!p) return [1, 1]; const [s, e] = p; if (sz?.[s - 1] && e < sz[s - 1]) return [s, e + 1]; if (sz && s < sz.length) return [s + 1, 1]; return sz ? null : [s, e + 1]; };
  // "Today", "Tomorrow", "Fri 24 Oct (in 6 days)": when the next episode lands
  const whenText = (iso) => {
    const d = new Date(iso + 'T12:00:00'), t = new Date(); t.setHours(12, 0, 0, 0);
    const n = Math.round((d - t) / 864e5);
    return n <= 0 ? (n === 0 ? 'Today' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) : n === 1 ? 'Tomorrow'
      : n < 7 ? d.toLocaleDateString('en-GB', { weekday: 'long' }) : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  };
  addEventListener('storage', (e) => { if (e.key === WL || e.key === PR) dispatchEvent(new Event('tn:saved')); if (e.key === MS) dispatchEvent(new Event('tn:mine')); if (e.key === PREFS) { apply(); dispatchEvent(new Event('tn:prefs')); } });

  // ---------- My services: the ones you pay for, on this device. The Top 10 gets a chart of just those, and Browse
  // starts filtered to them. Empty means "all five". ----------
  const MS = 'tenner-services';
  const mine = {
    get() { try { const l = JSON.parse(localStorage.getItem(MS) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } },
    set(l) { try { if (l.length) localStorage.setItem(MS, JSON.stringify(l)); else localStorage.removeItem(MS); } catch {} dispatchEvent(new Event('tn:mine')); },
  };
  // the picker: a small sheet of switches, one per service
  function pickMine(list) {
    let dlg = document.getElementById('mineDlg');
    if (!dlg) {
      document.body.insertAdjacentHTML('beforeend', `<dialog class="mine-dlg" id="mineDlg" aria-labelledby="mineH">
        <form method="dialog"><h2 id="mineH">My services</h2>
          <p>Pick the services you pay for. Tenner makes you a Top 10 of just those, and Browse starts with them. Saved on this device only.</p>
          <div class="mine-list" id="mineList"></div>
          <div class="mine-acts"><button type="button" class="btn btn-tinted" id="mineClear">Use all five</button><button class="btn btn-tinted mine-done" value="done">Done</button></div>
        </form></dialog>`);
      dlg = document.getElementById('mineDlg');
      dlg.addEventListener('close', () => {
        if (dlg.returnValue !== 'done') return;
        const on = [...dlg.querySelectorAll('input:checked')].map((i) => i.value);
        mine.set(on.length === dlg.querySelectorAll('input').length ? [] : on);   // all five is the same as none chosen
      });
      dlg.querySelector('#mineClear').addEventListener('click', () => { dlg.querySelectorAll('input').forEach((i) => { i.checked = false; }); dlg.returnValue = 'done'; dlg.close('done'); });
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });   // a tap outside the card closes it
    }
    const cur = mine.get();
    dlg.querySelector('#mineList').innerHTML = list.map((s) => `<label class="mine-row">
      <span class="mine-ic">${s.logo ? `<img src="${esc(s.logo)}" alt="">` : esc(s.label[0])}</span><span class="mine-l">${esc(s.label)}</span>
      <input type="checkbox" switch role="switch" value="${esc(s.key)}"${cur.includes(s.key) ? ' checked' : ''}><i class="sw" aria-hidden="true"></i></label>`).join('');
    dlg.classList.toggle('native-sw', 'switch' in HTMLInputElement.prototype);   // Safari 17.4+: the real iOS switch
    dlg.returnValue = ''; dlg.showModal();
  }

  // ---------- Share: the phone's own share sheet where there is one, otherwise the share card ----------
  // As on Channel Crossings: on phones and tablets the system share sheet; on computers a black card (a native modal
  // <dialog>: Escape, focus and the dimmed page come free) with X, Facebook, WhatsApp, Telegram and Copy link, plus
  // "Save as picture" where there's a picture to save. Nothing loads from those sites until a button's pressed.
  // share({ heading, title, text, url, picture: async () => ({ blob, name }) })
  const NETS = [
    ['Post on X', (t, u) => `https://x.com/intent/post?text=${encodeURIComponent(t)}&url=${encodeURIComponent(u)}`,
      '<path fill="currentColor" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43Z"/>'],
    ['Share on Facebook', (t, u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`,
      '<circle cx="12" cy="12" r="11" fill="#0866FF"/><path fill="#fff" d="M13.4 23v-8.1h2.7l.42-3.2H13.4V9.7c0-.92.26-1.55 1.58-1.55h1.68V5.3a22 22 0 0 0-2.45-.13c-2.43 0-4.09 1.48-4.09 4.2v2.35H7.37v3.2h2.75V23z"/>'],
    ['Send on WhatsApp', (t, u) => `https://wa.me/?text=${encodeURIComponent(`${t} ${u}`)}`,
      '<path fill="#25D366" d="M12 1.5A10.4 10.4 0 0 0 3.05 17.2L1.6 22.5l5.45-1.43A10.4 10.4 0 1 0 12 1.5Z"/><path fill="#fff" d="M17.6 14.5c-.3-.15-1.8-.88-2.07-.98-.28-.1-.48-.15-.68.15-.2.3-.78.98-.96 1.18-.18.2-.35.22-.65.07a8.5 8.5 0 0 1-4.2-3.67c-.32-.55.32-.5.9-1.68.1-.2.05-.37-.02-.52-.08-.15-.68-1.64-.93-2.24-.25-.59-.5-.5-.68-.51h-.58c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5 0 1.47 1.07 2.9 1.22 3.1.15.2 2.1 3.2 5.08 4.49 1.89.81 2.62.88 3.56.74.57-.09 1.8-.74 2.04-1.45.25-.71.25-1.32.18-1.45-.07-.13-.27-.2-.57-.35Z"/>'],
    ['Send on Telegram', (t, u) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}`,
      '<circle cx="12" cy="12" r="11" fill="#29A9EB"/><path fill="#fff" d="M5.3 11.7 16.9 7.2c.54-.2 1.01.13.83.95l-1.97 9.3c-.15.66-.54.82-1.09.51l-3-2.22-1.45 1.4c-.16.16-.3.3-.6.3l.21-3.05 5.55-5.01c.24-.21-.05-.33-.38-.12l-6.86 4.32-2.96-.92c-.64-.2-.65-.64.14-.95Z"/>'],
  ];
  const LINK = '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/></g>';
  const PIC = '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-4.8-4.8L6 19.5"/></g>';
  // the scene at the foot of the card: a drive-in on a starry night, the screen glowing in Tenner's colours
  const SCENE = `<svg viewBox="0 0 280 170" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs>
      <linearGradient id="scSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset=".6" stop-color="#0d0b24"/><stop offset="1" stop-color="#1d1440"/></linearGradient>
      <linearGradient id="scScr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff375f"/><stop offset=".35" stop-color="#ff9f0a"/><stop offset=".7" stop-color="#0a84ff"/><stop offset="1" stop-color="#bf5af2"/></linearGradient>
      <linearGradient id="scBeam" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <radialGradient id="scGlow"><stop offset="0" stop-color="#bf5af2" stop-opacity=".55"/><stop offset="1" stop-color="#bf5af2" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="280" height="170" fill="url(#scSky)"/>
    <g fill="#fff">${[[22, 18, 1.1], [58, 34, .8], [96, 12, 1], [204, 20, 1.2], [238, 40, .8], [262, 14, 1], [150, 8, .7], [178, 44, .8], [36, 52, .7]].map(([x, y, r]) => `<circle class="sc-star" cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
    <ellipse class="sc-glow" cx="140" cy="80" rx="110" ry="60" fill="url(#scGlow)"/>
    <path class="sc-beam" d="M232 150 L96 52 L184 52 Z" fill="url(#scBeam)"/>
    <rect x="128" y="104" width="4" height="40" fill="#14112b"/><rect x="148" y="104" width="4" height="40" fill="#14112b"/>
    <rect class="sc-screen" x="88" y="44" width="104" height="62" rx="4" fill="url(#scScr)"/>
    <text x="140" y="88" text-anchor="middle" font-family="Inter Tight, Inter, -apple-system, sans-serif" font-weight="800" font-size="34" fill="none" stroke="#fff" stroke-width="1.6" opacity=".92">10</text>
    <path d="M0 150 Q70 138 140 144 T280 140 V170 H0Z" fill="#0b0920"/>
    <g fill="#05040d"><path d="M40 152h44l-6-10H50z"/><rect x="36" y="150" width="52" height="9" rx="4"/><path d="M170 154h40l-5-9h-26z"/><rect x="166" y="152" width="48" height="8" rx="4"/></g>
    <g fill="#ffd60a" opacity=".85"><circle cx="40" cy="155" r="1.6"/><circle cx="166" cy="157" r="1.5"/></g>
    <rect x="226" y="146" width="12" height="9" rx="2" fill="#05040d"/>
  </svg>`;
  let card = null, shareNow = null;
  function shareCard() {
    if (card) return card;
    document.body.insertAdjacentHTML('beforeend', `<dialog class="share-card" id="shareCard" aria-labelledby="scT">
      <button type="button" class="sc-x" id="scX" aria-label="Close"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      <h2 id="scT"></h2>
      <div class="sc-btns" id="scBtns"></div>
      <p>Each post carries a link back to Tenner. Nothing loads from these sites until you tap.</p>
      <div class="sc-art">${SCENE}</div>
    </dialog>`);
    card = $('#shareCard');
    const shut = () => { if (!card.open || card.classList.contains('out')) return; if (reduce || document.documentElement.classList.contains('still')) { card.close(); return; } card.classList.add('out'); setTimeout(() => { card.classList.remove('out'); card.close(); }, 200); };
    $('#scX').addEventListener('click', shut);
    card.addEventListener('cancel', (e) => { e.preventDefault(); shut(); });
    card.addEventListener('click', (e) => {   // a tap on the dimmed page closes it
      if (e.target === card) { const r = card.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) shut(); return; }
      const b = e.target.closest('[data-sc]'); if (!b || !shareNow) return;
      if (b.dataset.sc === 'copy') {
        navigator.clipboard?.writeText(shareNow.url).then(() => { b.lastChild.textContent = 'Link copied'; setTimeout(() => (b.lastChild.textContent = 'Copy link'), 1600); }, () => { b.lastChild.textContent = shareNow.url; });
      } else if (b.dataset.sc === 'pic') {
        b.disabled = true; b.lastChild.textContent = 'Making the picture…';
        shareNow.picture().then((p) => {
          if (!p?.blob) throw new Error();
          const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(p.blob), download: p.name }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          b.lastChild.textContent = 'Picture saved';
        }).catch(() => { b.lastChild.textContent = 'Couldn’t make the picture'; })
          .finally(() => { b.disabled = false; setTimeout(() => (b.lastChild.textContent = 'Save as picture'), 1800); });
      }
    });
    return card;
  }
  async function share(o) {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {   // phones and tablets: the system's own share sheet
      let files;
      try { const p = o.picture && await o.picture(); const f = p?.blob && new File([p.blob], p.name, { type: p.blob.type }); if (f && navigator.canShare?.({ files: [f] })) files = [f]; } catch {}
      return navigator.share(files ? { files, title: o.title, text: `${o.text} ${o.url}` } : { title: o.title, text: o.text, url: o.url }).catch(() => {});
    }
    const c = shareCard(); shareNow = o;
    $('#scT').textContent = o.heading;
    $('#scBtns').innerHTML = NETS.map(([label, href, icon]) => `<a class="sc-b" href="${esc(href(o.text, o.url))}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span></a>`).join('')
      + `<button type="button" class="sc-b" data-sc="copy"><svg viewBox="0 0 24 24" aria-hidden="true">${LINK}</svg><span>Copy link</span></button>`
      + (o.picture ? `<button type="button" class="sc-b" data-sc="pic"><svg viewBox="0 0 24 24" aria-hidden="true">${PIC}</svg><span>Save as picture</span></button>` : '');
    c.classList.remove('out'); if (!c.open) c.showModal();
    $('#scX').focus({ preventScroll: true });
  }

  // ---------- a one-time note about privacy: not a consent banner (there's nothing to consent to), just reassurance ----------
  // Shown once, at the foot of the screen in Tenner's frosted style; Got it puts it away for good on this device.
  const NOTE = 'tenner-note-seen';
  let seen = false; try { seen = !!localStorage.getItem(NOTE); } catch {}
  if (!seen && !navigator.webdriver) setTimeout(() => {
    document.body.insertAdjacentHTML('beforeend', `<aside class="pv-note" id="pvNote" aria-label="Privacy">
      <span class="pv-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M2.5 11.2 6 7.8l3.2 1.1 2.6-1.6a2.2 2.2 0 0 1 2.3 0l5.9 3.7-3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="m16.6 14.4-4.1-3.1-2 1.3a1.5 1.5 0 0 1-2-.4 1.5 1.5 0 0 1 .3-2.1l3-2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="m2.5 11.2 3.3 3.6M7.6 16.6l1.6 1.5a1.3 1.3 0 0 0 1.8 0M10.2 15.2l2.3 2.1a1.3 1.3 0 0 0 1.8 0 1.3 1.3 0 0 0 0-1.8M12.6 14l2.1 2a1.3 1.3 0 0 0 1.8-.1 1.3 1.3 0 0 0 0-1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <p>Tenner doesn’t use cookies or tracking. Your Watchlist and settings stay on this device. <a href="legal.html#cookies">Privacy Policy</a></p>
      <button type="button" class="pv-ok" id="pvOk">Got it</button></aside>`);
    const box = $('#pvNote');
    requestAnimationFrame(() => box.classList.add('in'));
    $('#pvOk').addEventListener('click', () => {
      try { localStorage.setItem(NOTE, '1'); } catch {}
      box.classList.remove('in'); setTimeout(() => box.remove(), reduce ? 0 : 350);
    });
  }, 1200);

  // ---------- the search API (worker/, on Cloudflare): every film and show on TMDB. Empty until it's deployed ----------
  const api = 'https://tenner-api.danseacroft.workers.dev';

  window.tn = { prefs, version, esc, hue, glide, arrows, segment, reduce, contact, saved, progress, nextUp, whenText, mine, pickMine, api, share };

  // ---------- tabs ----------
  const tabs = [...document.querySelectorAll('#tabs [role=tab]')], ind = $('#tabInd'), names = tabs.map((t) => t.dataset.tab);
  let cur = tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.tab ?? null, placed = false;
  const placeInd = (animate) => glide(ind, tabs[names.indexOf(cur)], animate, 1.18);
  function select(name) {
    cur = name;
    tabs.forEach((t) => { const on = t.dataset.tab === name; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
    placeInd(placed); placed = true;
  }
  // pages without their own handler (About) send the tabs back to the chart
  function open(name) {
    if (name === 'search') {   // Search lives on the Browse page: go there with the box focused
      const q = document.getElementById('q');
      if (q) { q.focus(); q.select(); scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); return; }
      location.href = 'browse.html#search'; return;
    }
    if (window.tnOnTab) return window.tnOnTab(name);
    if (name === cur) { scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); return; }
    if (name === 'about') { location.href = 'about.html'; return; }
    if (name === 'browse') { location.href = 'browse.html'; return; }
    if (name === 'new') { location.href = './#new'; return; }
    if (name === 'watchlist') { location.href = './#watchlist'; return; }
    if (name === 'people') { location.href = 'people.html'; return; }
    location.href = './';
  }
  tabs.forEach((t) => t.addEventListener('click', () => open(t.dataset.tab)));
  arrows($('#tabs'), () => tabs, (n) => open(n.dataset.tab));   // the visible tabs only (About is hidden in the sidebar)
  addEventListener('resize', () => placeInd(false));
  document.fonts?.ready.then(() => placeInd(false));
  placeInd(false); placed = true;

  // ---------- keyboard shortcuts, as on the Mac: / or ⌘K (Ctrl+K) to search, from any page ----------
  addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey)) {
      e.preventDefault(); open('search');
    }
  });

  // ---------- Theme: Auto, Day or Night (Night by default) ----------
  const modeBtns = document.querySelectorAll('.th-list button');
  const mode = () => root.getAttribute('data-theme') || 'auto';
  function showTheme() {
    const m = mode();
    modeBtns.forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === m));
    const dark = m === 'dark' || (m === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    $('#thIc').innerHTML = $(`.th-list [data-mode="${dark ? 'dark' : 'light'}"] i`).innerHTML; // the round button: a moon by night, a sun by day
  }
  // the round button opens a card just under it, lined up with its right edge
  // The card is a native popover (the browser's top layer, with its own tap-outside and Escape to close)
  function tbMenu(btn, pop, onOpen) {
    const side = matchMedia('(min-width: 1000px)');
    const place = () => {
      const r = btn.getBoundingClientRect(), w = pop.offsetWidth;
      if (side.matches) {   // computers: beside its row in the sidebar, like a Mac menu
        const h = pop.offsetHeight, top = Math.max(12, Math.min(r.top - 18, innerHeight - h - 12));
        Object.assign(pop.style, { left: `${r.right + 10}px`, top: `${top}px`, maxHeight: `${innerHeight - 24}px` });
        pop.style.setProperty('--tb-o', `-14px ${r.top + r.height / 2 - top}px`); return;
      }
      const left = Math.max(12, Math.min(r.right - w, innerWidth - w - 12));
      const h = pop.offsetHeight, up = innerHeight - r.bottom < h + 20 && r.top > h + 20;
      pop.style.top = (up ? r.top - h - 8 : r.bottom + 8) + 'px';
      pop.style.maxHeight = Math.max(200, up ? r.top - 20 : innerHeight - r.bottom - 20) + 'px';
      pop.style.left = left + 'px';
      pop.style.setProperty('--tb-o', `${r.left + r.width / 2 - left}px ${up ? 'calc(100% + 14px)' : '-14px'}`); // it grows out of its own button
    };
    btn.setAttribute('popovertarget', pop.id);
    pop.addEventListener('toggle', (e) => {
      const on = e.newState === 'open';
      btn.setAttribute('aria-expanded', on);
      if (on) { [...pop.children].forEach((c, i) => c.style.setProperty('--i', i)); place(); onOpen?.(); }
      else if (pop.contains(document.activeElement) || document.activeElement === document.body) btn.focus({ preventScroll: true });
    });
    addEventListener('resize', () => { if (pop.matches(':popover-open')) place(); });
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', showTheme); // Auto: the icon follows the device
  tbMenu($('#thBtn'), $('#thPop'), () => $('#thPop [aria-checked="true"]')?.focus({ preventScroll: true }));
  arrows($('#thPop'), () => [...modeBtns]);
  modeBtns.forEach((b) => b.addEventListener('click', () => {
    const n = b.dataset.mode;
    window.tnTheme?.(n);
    try { localStorage.setItem('tenner-theme', n); } catch {}
    showTheme();
  }));
  // phones: the phone's own picker instead of the card (a native <select> laid invisibly over the round button)
  const thWrap = document.createElement('span'), thSel = document.createElement('select');
  thWrap.className = 'th-wrap'; thSel.className = 'th-sel'; thSel.setAttribute('aria-label', 'Theme');
  thSel.innerHTML = '<option value="auto">Auto (follows your device)</option><option value="light">Day</option><option value="dark">Night</option>';
  $('#thBtn').before(thWrap); thWrap.append($('#thBtn'), thSel);
  thSel.addEventListener('change', () => { window.tnTheme?.(thSel.value); try { localStorage.setItem('tenner-theme', thSel.value); } catch {} showTheme(); });
  const syncSel = () => { thSel.value = mode(); };
  modeBtns.forEach((b) => b.addEventListener('click', syncSel));
  syncSel();
  showTheme();

  // ---------- a fade behind the floating bar once the page has scrolled ----------
  // and the page's title moves into the bar once its large title has gone under it (phones and tablets)
  const brand = $('.top-brand'), barTitle = document.createElement('span');
  barTitle.className = 'bar-title'; barTitle.setAttribute('aria-hidden', 'true'); brand?.append(barTitle);
  let ticking = false;
  const sidebar = matchMedia('(min-width: 1000px)'); sidebar.addEventListener('change', () => onScroll());
  const titleCheck = () => {
    ticking = false;
    const h = [...document.querySelectorAll('h1')].find((e) => e.getClientRects().length), bar = brand?.getBoundingClientRect();
    const under = !sidebar.matches && !!(h && bar && h.getBoundingClientRect().bottom < bar.bottom + 4);   // phones and tablets only
    if (under) { const t = (h.dataset.title || h.textContent).trim(); if (barTitle.textContent !== t) barTitle.textContent = t; }
    root.classList.toggle('title-in', under);
  };
  const onScroll = () => {
    root.classList.toggle('scrolled', scrollY > 8);
    if (!ticking) { ticking = true; requestAnimationFrame(titleCheck); }
  };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // ---------- staying current: pages left open fetch the new hour's data by themselves ----------
  // Every 15 minutes while the page is on screen, and whenever you come back to it after a few minutes away,
  // a "tn:check" event goes out; each page listens and quietly swaps in fresh posters, artwork and charts.
  // Nothing runs while the tab is hidden.
  let lastCheck = Date.now();
  const check = () => { lastCheck = Date.now(); dispatchEvent(new Event('tn:check')); };
  setInterval(() => { if (document.visibilityState === 'visible') check(); }, 15 * 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck > 4 * 60e3) check(); });
  addEventListener('pageshow', (e) => { if (e.persisted) check(); });   // back/forward cache

  window.tnShell = { select, current: () => cur };

  // ---------- install as an app: the offline cache (sw.js) ----------
  if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();

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
  const version = '1.4.3';
  document.querySelectorAll('.side-ver, .side-ver-text').forEach((el) => { el.textContent = `Tenner ${version}`; });

  // ---------- the contact address: change it here and it updates everywhere (Contact, Privacy Policy, Terms) ----------
  const contact = 'support@tenneruk.space';
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

  // ---------- the search API (worker/, on Cloudflare): every film and show on TMDB. Empty until it's deployed ----------
  const api = 'https://tenner-api.danseacroft.workers.dev';

  window.tn = { prefs, version, esc, hue, glide, arrows, segment, reduce, contact, saved, progress, nextUp, whenText, mine, pickMine, api };

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
    const place = () => {
      const r = btn.getBoundingClientRect(), w = pop.offsetWidth, left = Math.max(12, Math.min(r.right - w, innerWidth - w - 12));
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
  const onScroll = () => root.classList.toggle('scrolled', scrollY > 8);
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

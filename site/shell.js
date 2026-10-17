// Tenner's shell, shared by every page: the tabs (a sidebar on computers, a floating bar on phones), the Theme menu,
// keyboard shortcuts, the fade behind the bar once the page scrolls, the hourly freshness check, and a few helpers the
// pages share (window.tn), so each exists once.
(() => {
  const $ = (s) => document.querySelector(s);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;

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
  window.tn = { esc, hue, glide, arrows, reduce };

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
  function tbMenu(btn, pop, onOpen) {
    const place = () => {
      const r = btn.getBoundingClientRect(), w = pop.offsetWidth, left = Math.max(12, Math.min(r.right - w, innerWidth - w - 12));
      const h = pop.offsetHeight, up = innerHeight - r.bottom < h + 20 && r.top > h + 20;
      pop.style.top = (up ? r.top - h - 8 : r.bottom + 8) + 'px';
      pop.style.maxHeight = Math.max(200, up ? r.top - 20 : innerHeight - r.bottom - 20) + 'px';
      pop.style.left = left + 'px';
      pop.style.setProperty('--tb-o', `${r.left + r.width / 2 - left}px ${up ? 'calc(100% + 14px)' : '-14px'}`); // it grows out of its own button
    };
    const set = (on) => {
      if (on === !pop.hidden && !pop.classList.contains('out')) return;
      btn.setAttribute('aria-expanded', on);
      if (on) {
        pop.classList.remove('out'); pop.hidden = false;
        [...pop.children].forEach((c, i) => c.style.setProperty('--i', i));
        place(); onOpen?.();
      } else if (reduce) pop.hidden = true;
      else { pop.classList.add('out'); setTimeout(() => { if (pop.classList.contains('out')) { pop.hidden = true; pop.classList.remove('out'); } }, 190); }
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); set(pop.hidden || pop.classList.contains('out')); });
    document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target.isConnected) set(false); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { set(false); btn.focus({ preventScroll: true }); } });
    addEventListener('resize', () => { if (!pop.hidden) place(); });
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
})();

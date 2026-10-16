// Tenner's shell, shared by every page and ported from Channel Crossings:
// the tab bar's gliding pill, the Appearance menu (Auto, Day, Night) and the fade behind the bar once the page scrolls.
(() => {
  const $ = (s) => document.querySelector(s);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;

  // ---------- tabs ----------
  const tabs = [...document.querySelectorAll('#tabs [role=tab]')], ind = $('#tabInd'), names = tabs.map((t) => t.dataset.tab);
  let cur = tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.tab ?? null, indX = null;
  // the pill under the chosen tab: glides across, stretching a little on the way and settling with a small spring
  function placeInd(animate) {
    const b = tabs[names.indexOf(cur)]; if (!b || !b.offsetWidth) return;
    const x = b.offsetLeft, w = b.offsetWidth;
    if (indX === null || !animate || reduce || !ind.animate) { ind.style.width = w + 'px'; ind.style.transform = `translateX(${x}px)`; indX = x; return; }
    const from = ind.style.transform, fw = ind.style.width, mid = (indX + x) / 2, mw = Math.max(parseFloat(fw), w) * 1.18;
    ind.style.width = w + 'px'; ind.style.transform = `translateX(${x}px)`;
    ind.animate([{ transform: from, width: fw }, { transform: `translateX(${mid - (mw - w) / 2}px)`, width: mw + 'px', offset: 0.45 }, { transform: `translateX(${x}px)`, width: w + 'px' }],
      { duration: 520, easing: 'cubic-bezier(.3,1.15,.4,1)' });
    indX = x;
  }
  function select(name) {
    const first = indX === null;
    cur = name;
    tabs.forEach((t) => { const on = t.dataset.tab === name; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
    placeInd(!first);
  }
  // pages without their own handler (About) send the tabs back to the chart
  function open(name) {
    if (window.tnOnTab) return window.tnOnTab(name);
    if (name === cur) { scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); return; }
    if (name === 'about') { location.href = 'about.html'; return; }
    if (name === 'new') { location.href = './#new'; return; }
    try { localStorage.setItem('tenner-kind', name); } catch {}
    location.href = './#top';
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => open(t.dataset.tab));
    t.addEventListener('keydown', (e) => { // arrow keys move along the tabs, Home and End to the first and last
      const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key]; if (k === undefined) return;
      e.preventDefault(); const n = tabs[(k + tabs.length) % tabs.length]; n.focus(); open(n.dataset.tab);
    });
  });
  addEventListener('resize', () => placeInd(false));
  document.fonts?.ready.then(() => placeInd(false));
  placeInd(false);

  // ---------- appearance: Auto, Day or Night (Night by default) ----------
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
      pop.style.top = (r.bottom + 8) + 'px';
      pop.style.maxHeight = Math.max(200, innerHeight - r.bottom - 20) + 'px';
      pop.style.left = left + 'px';
      pop.style.setProperty('--tb-o', `${r.left + r.width / 2 - left}px -14px`); // it grows out of its own button
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

  window.tnShell = { select, current: () => cur };
})();

// Tenner Layout: the drag-and-drop layer the Mac app puts over tenner.stream.
// It only moves things on screen in the app's own window and writes down each move; it never changes the site.
(() => {
  if (window.TennerLayout) return;

  const KEY = 'tennerLayout:' + location.pathname + location.search;
  const send = (msg) => { try { window.webkit.messageHandlers.tennerLayout.postMessage(msg); } catch {} };
  const css = `
    .tl-hover { outline: 2px dashed rgba(10,132,255,.9) !important; outline-offset: 2px !important; cursor: grab !important; }
    .tl-picked { outline: 3px solid #0a84ff !important; outline-offset: 2px !important; box-shadow: 0 0 0 8px rgba(10,132,255,.18) !important; }
    .tl-moved { box-shadow: inset 0 0 0 2px rgba(48,209,88,.85) !important; }
    .tl-dragging { opacity: .35 !important; }
    #tl-line { position: fixed; z-index: 2147483646; pointer-events: none; background: #0a84ff; border-radius: 3px;
      box-shadow: 0 0 0 3px rgba(10,132,255,.25); display: none; }
    #tl-ghost { position: fixed; z-index: 2147483647; pointer-events: none; border-radius: 9px; overflow: hidden; opacity: .85;
      box-shadow: 0 18px 40px rgba(0,0,0,.35); transform-origin: 0 0; display: none; }
    #tl-tag { position: fixed; z-index: 2147483647; pointer-events: none; padding: 4px 8px; border-radius: 9px;
      font: 500 12px -apple-system, BlinkMacSystemFont, sans-serif; color: #fff; background: rgba(11,30,60,.92);
      -webkit-font-smoothing: antialiased; display: none; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }
    html.tl-on, html.tl-on * { user-select: none !important; -webkit-user-select: none !important; }
  `;
  const style = document.createElement('style'); style.textContent = css; document.documentElement.appendChild(style);
  const mk = (id) => { const d = document.createElement('div'); d.id = id; document.documentElement.appendChild(d); return d; };
  const line = mk('tl-line'), ghost = mk('tl-ghost'), tag = mk('tl-tag');
  const ours = (el) => el === line || el === ghost || el === tag;

  let on = false, hover = null, picked = null, trail = [], drag = null;
  let moves = load();          // [{sel, tsel, where, text}] for this page, kept for the app session
  const undo = [];             // [{el, parent, next}] so a move can be put back

  function load() { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; } }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(moves)); } catch {} }
  function everyPage() {
    const out = [];
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (!k.startsWith('tennerLayout:')) continue;
        for (const m of JSON.parse(sessionStorage.getItem(k) || '[]')) out.push({ page: k.slice(13), text: m.text });
      }
    } catch {}
    return out;
  }
  function report() {
    send({ type: 'state', width: innerWidth, moves: everyPage(), picked: picked ? name(picked) : '' });
  }

  // A short, human name for an element: its heading, label or text, then where it is.
  function name(el) {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    let words = clean(el.getAttribute('aria-label'));
    if (!words) { const h = el.matches('h1,h2,h3,h4') ? el : el.querySelector('h1,h2,h3,h4,[class*="title"],[class*="head"]'); if (h) words = clean(h.textContent); }
    if (!words) words = clean(el.textContent);
    if (!words && el.querySelector('img[alt]')) words = clean(el.querySelector('img[alt]').alt);
    if (words.length > 48) words = words.slice(0, 46).trim() + '…';
    const kind = { SECTION: 'section', ASIDE: 'side panel', NAV: 'menu', HEADER: 'header', FOOTER: 'footer', BUTTON: 'button',
      A: 'link', IMG: 'picture', UL: 'list', OL: 'list', LI: 'item', H1: 'heading', H2: 'heading', H3: 'heading', FORM: 'form' }[el.tagName] || 'box';
    return (words ? `the "${words}" ${kind}` : `a ${kind}`) + ` (\`${sel(el)}\`)`;
  }

  // A CSS selector that finds the element again: from the nearest id, then tag, a class and its place.
  function sel(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      if (n.id && !/^tl-/.test(n.id) && document.querySelectorAll('#' + CSS.escape(n.id)).length === 1) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let p = n.tagName.toLowerCase();
      const cls = [...n.classList].find((c) => !/^tl-|^(sk|on|is-|active|open|show)/.test(c));
      if (cls) p += '.' + CSS.escape(cls);
      const par = n.parentElement;
      if (par && [...par.children].filter((c) => c.matches(p)).length > 1) p += `:nth-child(${[...par.children].indexOf(n) + 1})`;
      parts.unshift(p);
      if (n === document.body) break;
    }
    return parts.join(' > ');
  }

  // The thing under the pointer worth moving: skip inline bits and anything tiny.
  function block(el) {
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (ours(n)) return null;
      const r = n.getBoundingClientRect(), d = getComputedStyle(n).display;
      if (d !== 'inline' && d !== 'contents' && r.width >= 24 && r.height >= 20) return n;
    }
    return null;
  }

  function setHover(el) {
    if (hover === el) return;
    hover?.classList.remove('tl-hover');
    hover = el && el !== picked ? el : null;
    hover?.classList.add('tl-hover');
  }
  function pick(el, keepTrail) {
    picked?.classList.remove('tl-picked');
    picked = el; if (!keepTrail) trail = [];
    if (picked) { picked.classList.add('tl-picked'); picked.classList.remove('tl-hover'); }
    report();
  }

  // Where a drop lands: beside a sibling if the pointer is over one, otherwise beside the block under it.
  function dropSpot(x, y, dragged) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || ours(hit)) return null;
    let target = null;
    for (let n = hit; n && n !== document.body; n = n.parentElement) if (n.parentElement === dragged.parentElement) { target = n; break; }
    if (!target) target = block(hit);
    if (!target || target === dragged || dragged.contains(target) || target.contains(dragged)) return null;
    const ps = getComputedStyle(target.parentElement), r = target.getBoundingClientRect();
    const across = (ps.display.includes('flex') && !ps.flexDirection.startsWith('column')) ||
      (ps.display.includes('grid') && ps.gridTemplateColumns.trim().split(/\s+/).length > 1);
    const before = across ? x < r.left + r.width / 2 : y < r.top + r.height / 2;
    return { target, before, across, r };
  }
  function showLine(spot) {
    if (!spot) { line.style.display = 'none'; return; }
    const { r, before, across } = spot, t = 4;
    Object.assign(line.style, across
      ? { display: 'block', left: (before ? r.left : r.right) - t / 2 + 'px', top: r.top + 'px', width: t + 'px', height: r.height + 'px' }
      : { display: 'block', left: r.left + 'px', top: (before ? r.top : r.bottom) - t / 2 + 'px', width: r.width + 'px', height: t + 'px' });
  }

  function place(el, target, before) {
    target.parentElement.insertBefore(el, before ? target : target.nextSibling);
  }
  function doMove(el, target, before, record = true) {
    undo.push({ el, parent: el.parentElement, next: el.nextSibling, recorded: record });
    const text = `Move ${name(el)} to just ${before ? 'before' : 'after'} ${name(target)}.`;
    const m = { sel: sel(el), tsel: sel(target), where: before ? 'before' : 'after', text };
    place(el, target, before);
    el.classList.add('tl-moved');
    if (record) { moves.push(m); save(); }
    report();
  }

  // Put this page's earlier moves back after a reload or a trip to another page.
  function replay() {
    let left = moves.slice(), tries = 0;
    const go = () => {
      left = left.filter((m) => {
        const el = document.querySelector(m.sel), t = document.querySelector(m.tsel);
        if (!el || !t || el.contains(t)) return true;
        place(el, t, m.where === 'before'); el.classList.add('tl-moved'); return false;
      });
      if (left.length && ++tries < 30) setTimeout(go, 300);
    };
    if (left.length) setTimeout(go, 600);
  }

  // Pointer handling, only while arranging.
  const swallow = (e) => { if (on && !ours(e.target)) { e.preventDefault(); e.stopPropagation(); } };
  addEventListener('click', swallow, true);
  addEventListener('dblclick', swallow, true);
  addEventListener('submit', swallow, true);
  addEventListener('mousedown', swallow, true);
  addEventListener('mouseup', swallow, true);
  addEventListener('dragstart', (e) => { if (on) e.preventDefault(); }, true);

  addEventListener('pointermove', (e) => {
    if (!on) return;
    if (drag) {
      if (!drag.live) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
        drag.live = true; startGhost(drag.el);
      }
      ghost.style.left = e.clientX - drag.dx * drag.k + 'px'; ghost.style.top = e.clientY - drag.dy * drag.k + 'px';
      drag.spot = dropSpot(e.clientX, e.clientY, drag.el); showLine(drag.spot);
      autoScroll(e.clientY);
      return;
    }
    const b = block(e.target);
    setHover(b);
    if (b) { tag.textContent = name(b).replace(/ \(`.*`\)$/, ''); tag.style.display = 'block';
      tag.style.left = Math.min(e.clientX + 14, innerWidth - tag.offsetWidth - 8) + 'px'; tag.style.top = Math.min(e.clientY + 18, innerHeight - 30) + 'px'; }
    else tag.style.display = 'none';
  }, true);

  addEventListener('pointerdown', (e) => {
    if (!on || e.button !== 0 || ours(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    let el = block(e.target);
    if (picked && picked.contains(e.target)) el = picked;       // keep a bigger pick made with the arrow keys
    if (!el) return;
    if (el !== picked) pick(el);
    const r = el.getBoundingClientRect();
    drag = { el, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, live: false, k: 1 };
  }, true);

  addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    ghost.style.display = 'none'; line.style.display = 'none'; ghost.textContent = '';
    d.el.classList.remove('tl-dragging');
    if (d.live && d.spot) doMove(d.el, d.spot.target, d.spot.before);
    if (on) e.preventDefault();
  }, true);

  function startGhost(el) {
    const r = el.getBoundingClientRect();
    const k = Math.min(1, 320 / r.width, 220 / r.height);
    drag.k = k;
    const copy = el.cloneNode(true);
    copy.classList.remove('tl-picked', 'tl-hover');
    copy.style.width = r.width + 'px'; copy.style.margin = '0';
    ghost.textContent = ''; ghost.appendChild(copy);
    Object.assign(ghost.style, { display: 'block', width: r.width + 'px', height: r.height + 'px', transform: `scale(${k})` });
    el.classList.add('tl-dragging');
    tag.style.display = 'none';
  }
  function autoScroll(y) {
    const edge = 60;
    if (y < edge) scrollBy(0, -12); else if (y > innerHeight - edge) scrollBy(0, 12);
  }

  addEventListener('keydown', (e) => {
    if (!on || !picked) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { bigger(); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { smaller(); e.preventDefault(); }
    else if (e.key === 'Escape') pick(null);
  }, true);

  function bigger() {
    if (!picked) return;
    const up = picked.parentElement;
    if (!up || up === document.body || up === document.documentElement) return;
    trail.push(picked); pick(up, true);
  }
  function smaller() {
    if (trail.length) pick(trail.pop(), true);
  }

  window.TennerLayout = {
    setArranging(v) {
      on = !!v;
      document.documentElement.classList.toggle('tl-on', on);
      if (!on) { setHover(null); pick(null); tag.style.display = 'none'; line.style.display = 'none'; }
      report();
    },
    bigger, smaller,
    undo() {
      const u = undo.pop();
      if (!u) return;
      u.parent.insertBefore(u.el, u.next && u.next.parentNode === u.parent ? u.next : null);
      if (u.recorded) { moves.pop(); save(); }
      if (!undo.some((x) => x.el === u.el)) u.el.classList.remove('tl-moved');
      report();
    },
    reset() {
      try { for (let i = sessionStorage.length - 1; i >= 0; i--) { const k = sessionStorage.key(i); if (k.startsWith('tennerLayout:')) sessionStorage.removeItem(k); } } catch {}
      moves = []; location.reload();
    },
    state: () => ({ moves: everyPage(), picked: picked ? name(picked) : '' }),
  };

  replay();
  send({ type: 'ready' });
  report();
})();

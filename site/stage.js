// The About page's hero: this hour's real top 10, fanned out in a 3D arc on a glossy stage.
// Posters fly out once on arrival; on a computer the arc leans towards the mouse. At rest nothing moves.
(() => {
  const stage = document.getElementById('stage'), ring = document.getElementById('ring');
  if (!stage) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hue = (t) => { let h = 0; for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const fallback = ['The Lighthouse Keepers', 'Signal Box', 'Ferryman', 'The Long Weekend', 'Dog and Duck', 'Brass Monkeys', 'Fenland', 'Ivy House', 'Cobble Street', 'Overcast']
    .map((title) => ({ title }));

  // the same neon tube as the chart's rank numbers: soft aura, glass fill, rainbow tube with bloom, white-hot core
  const NEON = `<svg class="one" viewBox="-24 -24 200 152" aria-hidden="true">
    <defs><linearGradient id="stRb" gradientUnits="userSpaceOnUse" x1="-40" y1="0" x2="200" y2="40">
      <stop offset="0" stop-color="#ff375f"/><stop offset=".2" stop-color="#ff9f0a"/><stop offset=".38" stop-color="#ffd60a"/><stop offset=".56" stop-color="#30d158"/><stop offset=".72" stop-color="#40c8e0"/><stop offset=".86" stop-color="#5e5ce6"/><stop offset="1" stop-color="#bf5af2"/>
      <animateTransform attributeName="gradientTransform" type="translate" from="-240 -40" to="0 0" dur="2.8s" begin="1.2s" calcMode="spline" keyTimes="0;1" keySplines=".45 0 .2 1" fill="freeze"/></linearGradient>
      <filter id="stBloom" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="t"/><feGaussianBlur in="SourceGraphic" stdDeviation="8" result="w"/><feMerge><feMergeNode in="w"/><feMergeNode in="t"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="stAura" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="16"/></filter></defs>
    <text x="0" y="104" fill="url(#stRb)" filter="url(#stAura)" opacity=".55">01</text>
    <text x="0" y="104" fill="rgba(0,0,0,.42)">01</text>
    <text x="0" y="104" fill="none" stroke="url(#stRb)" stroke-width="4.2" stroke-linejoin="round" filter="url(#stBloom)">01</text>
    <text x="0" y="104" fill="none" stroke="#fff" stroke-width="1.1" stroke-linejoin="round" opacity=".9">01</text></svg>`;

  function build(items) {
    ring.innerHTML = items.map((it, i) => {
      const h = hue(it.title);
      const face = it.poster
        ? `<img src="${esc(it.poster)}" alt="" decoding="async" ${i < 5 ? '' : 'loading="lazy"'}>`
        : `<span class="ph" style="background:linear-gradient(160deg,hsl(${h} 55% 45%),hsl(${(h + 40) % 360} 60% 16%))">${esc(it.title)}</span>`;
      return `<figure class="card" style="--i:${i};--h:${h}" title="${esc(it.title)}">${face}${i === 0 ? NEON : ''}</figure>`;
    }).join('');
    layout();
    // fly out from a stack into the arc, once
    requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add('open')));
  }

  // Place every card on a gentle arc: No. 1 front and centre, the rest alternating out to each side and receding.
  function layout() {
    const cards = [...ring.children], w = stage.clientWidth;
    const narrow = w < 560, step = narrow ? 0.34 : 0.27, R = narrow ? w * 0.95 : Math.min(w * 0.78, 980);
    cards.forEach((c, i) => {
      const slot = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
      const a = slot * step, x = Math.sin(a) * R, z = -(1 - Math.cos(a)) * R - (i ? 40 : 0);
      c.style.setProperty('--x', x.toFixed(1) + 'px');
      c.style.setProperty('--z', z.toFixed(1) + 'px');
      c.style.setProperty('--ry', (-a * 57.3 * 0.85).toFixed(2) + 'deg');
      c.style.zIndex = 20 - Math.abs(slot);
      c.hidden = narrow && Math.abs(slot) > 3;
    });
  }
  addEventListener('resize', layout);

  // a slight lean towards the mouse (only while it moves; nothing runs otherwise)
  if (!reduce && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let raf = 0, tx = 0, ty = 0;
    stage.addEventListener('pointermove', (e) => {
      const r = stage.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - 0.5; ty = (e.clientY - r.top) / r.height - 0.5;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; stage.style.setProperty('--tilt-y', (tx * 9).toFixed(2) + 'deg'); stage.style.setProperty('--tilt-x', (-ty * 5).toFixed(2) + 'deg'); });
    });
    stage.addEventListener('pointerleave', () => { stage.style.setProperty('--tilt-y', '0deg'); stage.style.setProperty('--tilt-x', '0deg'); });
  }

  // this hour's real chart, logos and update time
  fetch('data/trending.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => {
    const items = (d.overall?.tv?.length ? d.overall.tv : d.overall?.movie || []).slice(0, 10);
    build(items.length ? items : fallback);
    const mins = Math.floor((Date.now() - Date.parse(d.generatedAt)) / 60000);
    document.getElementById('cUpdT').textContent = mins < 3 ? 'Updated just now' : mins < 60 ? `Updated ${mins} min ago` : 'Updated this hour';
    const logos = (d.services || []).filter((s) => !s.store && s.logo);
    if (logos.length) document.getElementById('cLogos').innerHTML = logos.map((s) => `<img src="${esc(s.logo)}" alt="" title="${esc(s.label)}">`).join('');
  }).catch(() => build(fallback));
})();

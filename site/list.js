// A Watchlist someone shared from their Tenner account (list.html?u=…): their name and picture, and the posters,
// each opening where to watch on Tenner.
(() => {
  const { esc, hue, avatar, api } = window.tn;
  const $ = (s) => document.querySelector(s);
  const id = new URLSearchParams(location.search).get('u') || '';
  if (!/^[\w-]{8,24}$/.test(id)) { $('#lsSub').textContent = 'This link doesn’t look right.'; return; }
  fetch(`${api}/share/${id}`).then((r) => r.json().then((d) => ({ ok: r.ok, d }))).then(({ ok, d }) => {
    if (!ok) { $('#lsSub').textContent = d.error || 'This list isn’t shared any more.'; return; }
    const who = d.name || 'Someone';
    document.title = `${who}’s Watchlist · Tenner`;
    $('#lsAv').innerHTML = avatar(d, 'av-xl');
    $('#lsH').textContent = `${who}’s Watchlist`;
    $('#lsSub').textContent = d.list.length ? `${d.list.length} title${d.list.length === 1 ? '' : 's'} they want to watch. Tap one for where to watch it.` : 'Nothing on it yet.';
    $('#lsGrid').innerHTML = d.list.map((x) => `<li><a href="./?t=${esc(x.k)}">
      ${x.poster ? `<img src="${esc(x.poster)}" alt="" loading="lazy">` : `<span class="ls-ph" style="background:linear-gradient(160deg,hsl(${hue(x.title)} 45% 42%),hsl(${(hue(x.title) + 40) % 360} 55% 18%))">${esc(x.title)}</span>`}
      <b>${esc(x.title)}</b><small>${esc([x.type === 'movie' ? 'Film' : 'Series', x.year].filter(Boolean).join(' · '))}</small></a></li>`).join('');
  }).catch(() => { $('#lsSub').textContent = 'The list didn’t load. Check your connection.'; });
})();

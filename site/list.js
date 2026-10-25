// A Watchlist someone shared from their Tenner account (list.html?u=…): their name and picture, and the titles in Tenner's list,
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
    $('#lsH').innerHTML = `${esc(who)}’s <em class="grad">Watchlist</em>`;
    $('#lsSub').textContent = d.list.length ? `${d.list.length} title${d.list.length === 1 ? '' : 's'} they want to watch. Tap one for where to watch it.` : 'Nothing on it yet.';
    $('#lsGrid').innerHTML = d.list.map((x) => `<li><a href="./?t=${esc(x.k)}">
      ${x.poster ? `<img src="${esc(x.poster)}" alt="" loading="lazy" decoding="async">` : `<span class="cl-ph" style="background:hsl(${hue(x.title)} 45% 35%)"></span>`}
      <span class="cl-t"><b>${esc(x.title)}</b><small>${esc([x.type === 'movie' ? 'Film' : 'Series', x.year].filter(Boolean).join(' · '))}</small></span></a></li>`).join('');
  }).catch(() => { $('#lsSub').textContent = 'The list didn’t load. Check your connection.'; });
})();

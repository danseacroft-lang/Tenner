// Settings: every control is the browser's own (selects, switches, a file picker, confirm()), and each change is saved
// on this device straight away (shell.js keeps them and applies them on every page).
(() => {
  const { prefs, mine, saved, progress, stars, findTitle } = window.tn;
  const form = document.getElementById('setForm'), note = document.getElementById('setNote');
  const say = (t) => { note.textContent = t; clearTimeout(say.t); say.t = setTimeout(() => (note.textContent = ''), 3000); };
  form.classList.toggle('native-sw', 'switch' in HTMLInputElement.prototype);   // Safari: the real iOS switch
  const LABELS = { netflix: 'Netflix', disney: 'Disney+', prime: 'Prime Video', hbomax: 'HBO Max', paramount: 'Paramount+' };
  let logos = {};

  function show() {
    const p = prefs.get(), th = (() => { try { return localStorage.getItem('tenner-theme') || 'dark'; } catch { return 'dark'; } })();
    const kind = (() => { try { return localStorage.getItem('tenner-kind') || 'tv'; } catch { return 'tv'; } })();
    form.theme.value = ['auto', 'light', 'dark'].includes(th) ? th : 'dark';
    form.kind.value = kind; form.start.value = p.start; form.trailers.value = p.trailers;
    for (const k of ['anim', 'moves', 'ratings', 'hero', 'no18']) form[k].checked = !!p[k];
    const m = mine.get();
    document.getElementById('mineNow').textContent = m.length ? m.map((k) => LABELS[k] || k).join(', ') : 'All five';
  }
  form.addEventListener('change', (e) => {
    const el = e.target, n = el.name; if (!n) return;
    if (n === 'theme') { window.tnTheme?.(el.value); try { localStorage.setItem('tenner-theme', el.value); } catch {} }
    else if (n === 'kind') { try { localStorage.setItem('tenner-kind', el.value); } catch {} }
    else prefs.set(n, el.type === 'checkbox' ? el.checked : el.value);
    say('Saved');
  });

  fetch('data/trending.json').then((r) => (r.ok ? r.json() : null)).then((t) => { for (const s of t?.services || []) if (!s.store) logos[s.key] = s.logo; }).catch(() => {});
  document.getElementById('setMine').addEventListener('click', () => window.tn.pickMine(Object.keys(LABELS).map((k) => ({ key: k, label: LABELS[k], logo: logos[k] }))));
  addEventListener('tn:mine', show);

  // ---------- your data: a file to carry the Watchlist and progress to another device ----------
  document.getElementById('setExport').addEventListener('click', () => {
    const data = { tenner: 1, exported: new Date().toISOString(), watchlist: saved.all(), progress: progress.all(), services: mine.get(), settings: prefs.get() };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `tenner-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say(`Exported ${data.watchlist.length} title${data.watchlist.length === 1 ? '' : 's'}`);
  });
  // Import: a Tenner export, or what other apps give you. Letterboxd (watchlist.csv, or ratings.csv: 4 stars and up),
  // IMDb (a list or your ratings: 8 and up), Trakt (its JSON export) and Netflix (viewing activity: shows you've watched
  // three or more episodes of). Saved titles join the Watchlist; ones you rated highly or watched a lot are starred, so
  // For You learns from them. Each is matched through the search service, 300 at most.
  const csv = (t) => {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    row.push(cell); if (row.some(Boolean)) rows.push(row);
    const head = (rows.shift() || []).map((h) => h.replace(/^\uFEFF/, '').trim());
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  };
  function readOther(text) {
    const out = [];   // { imdb?, tmdb?, title?, year?, type?, as: 'save' | 'star' }
    if (/^\s*\[/.test(text)) {   // Trakt
      for (const x of JSON.parse(text)) {
        const it = x?.movie || x?.show, type = x?.movie ? 'movie' : x?.show ? 'tv' : null; if (!it || !type) continue;
        if (x.rating != null && x.rating < 8) continue;
        out.push({ tmdb: it.ids?.tmdb ? `${type === 'movie' ? 'm' : 't'}${it.ids.tmdb}` : null, imdb: it.ids?.imdb, title: it.title, year: it.year, type, as: x.rating != null || x.watched_at || x.plays ? 'star' : 'save' });
      }
      return { from: 'Trakt', list: out };
    }
    const rows = csv(text), h = rows[0] || {};
    if ('Letterboxd URI' in h) {
      for (const r of rows) { const rated = 'Rating' in r; if (rated && !(+r.Rating >= 4)) continue; if (r.Name) out.push({ title: r.Name, year: +r.Year || null, type: 'movie', as: rated ? 'star' : 'save' }); }
      return { from: 'Letterboxd', list: out };
    }
    if ('Const' in h) {
      const kind = (t) => (/series|episode/i.test(t || '') ? 'tv' : 'movie');
      for (const r of rows) { const rated = 'Your Rating' in r && r['Your Rating']; if (rated && +r['Your Rating'] < 8) continue; if (/episode/i.test(r['Title Type'] || '')) continue;
        out.push({ imdb: r.Const, title: r.Title, year: +r.Year || null, type: kind(r['Title Type']), as: rated ? 'star' : 'save' }); }
      return { from: 'IMDb', list: out };
    }
    if ('Title' in h && 'Date' in h) {   // Netflix: "Show: Season 2: Episode name" for each episode watched
      const n = new Map();
      for (const r of rows) { const m = r.Title.match(/^(.+?): (?:Season|Series|Limited Series|Part|Volume|Chapter|Collection|Book) /); if (m) n.set(m[1], (n.get(m[1]) || 0) + 1); }
      for (const [title, c] of n) if (c >= 3) out.push({ title, type: 'tv', as: 'star' });
      return { from: 'Netflix', list: out };
    }
    return null;
  }
  async function importOther(got) {
    const list = got.list.slice(0, 300); let done = 0, saves = 0, starred = 0, missed = 0;
    const have = saved.all(), keys = new Set(have.map((x) => x.k)), add = [];
    note.textContent = `Matching ${list.length} title${list.length === 1 ? '' : 's'} from ${got.from}…`; clearTimeout(say.t);
    const work = async (x) => {
      const t = x.tmdb ? { k: x.tmdb, type: x.type, title: x.title, year: x.year ? String(x.year) : null, poster: null } : await findTitle(x);
      done++; if (done % 10 === 0) note.textContent = `Matching ${done} of ${list.length} from ${got.from}…`;
      if (!t?.k) { missed++; return; }
      if (x.as === 'star') { if (!stars.has(t.k)) { stars.toggle(t.k); starred++; } }
      else if (!keys.has(t.k)) { keys.add(t.k); add.push({ k: t.k, type: t.type || x.type, title: t.title || x.title, year: t.year || null, poster: t.poster || null, at: Date.now() }); saves++; }
    };
    const queue = [...list]; await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await work(queue.shift()); }));
    if (add.length) saved.set([...add, ...have].slice(0, 500));
    const bits = [saves && `${saves} added to your Watchlist`, starred && `${starred} starred for For You`].filter(Boolean);
    say(bits.length ? `${got.from}: ${bits.join(', ')}${missed ? ` (${missed} not found)` : ''}` : `Nothing new from ${got.from}${missed ? ` (${missed} not found)` : ''}`);
  }
  document.getElementById('setImport').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
  // or drop the file anywhere on this page
  addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (!f) return; e.preventDefault(); importFile(f); });
  async function importFile(f) {
    let text = ''; try { text = await f.text(); } catch { say("That file didn't open"); return; }
    let d = null; try { d = JSON.parse(text); } catch {}
    if (d?.tenner === 1) {
      const have = saved.all(), keys = new Set(have.map((x) => x.k));
      const add = (d.watchlist || []).filter((x) => x?.k && !keys.has(x.k));
      saved.set([...have, ...add]);
      for (const [k, p] of Object.entries(d.progress || {})) if (!progress.get(k)) progress.set(k, p);
      if (!mine.get().length && d.services?.length) mine.set(d.services);
      show(); say(`Imported ${add.length} new title${add.length === 1 ? '' : 's'}`); return;
    }
    let got = null; try { got = readOther(text); } catch {}
    if (!got) { say('That file isn’t one Tenner can read. Try a Tenner, Letterboxd, IMDb, Trakt or Netflix export'); return; }
    if (!got.list.length) { say(`Nothing to bring in from that ${got.from} file`); return; }
    importOther(got);
  }
  // ---------- Watchlist alerts (shell.js tn.alerts, sent by the Worker) ----------
  const al = document.getElementById('setAlerts'), alNow = document.getElementById('alNow');
  const AL_TEXT = {
    on: 'On. You’ll hear when something you’ve saved arrives, has a new episode or is about to leave',
    off: 'A notification when something you’ve saved arrives, has a new episode or is about to leave',
    blocked: 'Notifications are turned off for Tenner in your browser’s settings',
    install: 'On iPhone and iPad: add Tenner to your Home Screen first (Share, then Add to Home Screen), then open it from there',
    unsupported: 'This browser can’t show notifications from websites',
  };
  async function showAlerts(st) {
    st ||= await window.tn.alerts.state();
    al.checked = st === 'on'; al.disabled = st === 'install' || st === 'unsupported' || st === 'blocked'; alNow.textContent = AL_TEXT[st];
  }
  al.addEventListener('change', async () => {
    al.disabled = true;
    try { const st = await (al.checked ? window.tn.alerts.enable() : window.tn.alerts.disable()); await showAlerts(st); say(st === 'on' ? 'Alerts on' : 'Alerts off'); }
    catch { await showAlerts(); say('Alerts aren’t available right now. Try again later'); }
  });
  showAlerts();

  // ---------- Move to another device: everything in a link (and a QR code of it); nothing is uploaded ----------
  // The link carries the Watchlist (key, title, year, poster), progress and services, squeezed with the browser's own
  // compression. Opening it on the other device shows what's coming and asks before adding anything.
  const IMG = 'https://image.tmdb.org/t/p/w342';
  const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (t) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
  const squeeze = async (text) => {
    if (!('CompressionStream' in window)) return `j${b64u(new TextEncoder().encode(text))}`;
    const out = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return `z${b64u(new Uint8Array(out))}`;
  };
  const unsqueeze = async (t) => {
    const bytes = unb64u(t.slice(1));
    if (t[0] === 'j') return new TextDecoder().decode(bytes);
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
  async function moveLink(posters) {
    const w = saved.all().map((x) => [x.k, x.title, x.year || 0, posters && x.poster ? String(x.poster).replace(IMG, '') : 0]);
    const data = { v: 1, w, p: progress.all(), s: mine.get() };
    return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}settings.html#take=${await squeeze(JSON.stringify(data))}`;
  }
  let qrLib = null;
  const loadQr = () => (qrLib ||= new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'qrcode.js'; sc.onload = () => res(window.qrcode); sc.onerror = rej; document.head.append(sc); }));
  document.getElementById('setMove').addEventListener('click', async () => {
    const dlg = document.getElementById('moveDlg'), box = document.getElementById('moveQr');
    let link = await moveLink(true);
    if (link.length > 1100) link = await moveLink(false);   // a long Watchlist: leave the posters out (they come back by themselves)
    dlg.dataset.link = link; box.innerHTML = '';
    if (link.length <= 2300) {
      try {
        const qrcode = await loadQr(), q = qrcode(0, 'L'); q.addData(link); q.make();
        const n = q.getModuleCount(); let d = '';
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
        box.innerHTML = `<svg viewBox="-3 -3 ${n + 6} ${n + 6}" role="img" aria-label="QR code of the link"><rect x="-3" y="-3" width="${n + 6}" height="${n + 6}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
      } catch { box.innerHTML = '<p class="move-none">The code didn’t load. Copy the link instead.</p>'; }
    } else box.innerHTML = '<p class="move-none">Your Watchlist is too long for a code. Copy the link and open it on the other device.</p>';
    dlg.showModal();
  });
  document.getElementById('moveCopy').addEventListener('click', async (e) => {
    const link = document.getElementById('moveDlg').dataset.link;
    if (navigator.share && window.tn.isIOS) { navigator.share({ title: 'My Tenner', url: link }).catch(() => {}); return; }
    try { await navigator.clipboard.writeText(link); e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy link'; }, 1600); } catch { prompt('Copy this link', link); }
  });
  document.getElementById('moveDlg').addEventListener('click', (e) => { if (e.target.id === 'moveDlg') e.target.close(); });
  // arriving with a link from another device
  (async () => {
    const m = location.hash.match(/^#take=([jz][\w-]+)$/); if (!m) return;
    history.replaceState(null, '', location.pathname);
    let d; try { d = JSON.parse(await unsqueeze(m[1])); if (d?.v !== 1) throw 0; } catch { say('That link didn’t work. Make a new one on the other device'); return; }
    const have = new Set(saved.all().map((x) => x.k)), add = (d.w || []).filter(([k]) => /^[mt]\d+$/.test(k) && !have.has(k));
    const prog = Object.keys(d.p || {}).filter((k) => !progress.get(k)).length, svcs = (d.s || []).filter((k) => LABELS[k]);
    const bits = [add.length ? `${add.length} title${add.length === 1 ? '' : 's'} for your Watchlist` : '', prog ? `where you’re up to in ${prog} show${prog === 1 ? '' : 's'}` : '',
      svcs.length && !mine.get().length ? `your services (${svcs.map((k) => LABELS[k]).join(', ')})` : ''].filter(Boolean);
    const dlg = document.getElementById('takeDlg');
    if (!bits.length) { say('Everything in that link is already here'); return; }
    document.getElementById('takeP').textContent = `From your other device: ${bits.join(', ')}. It’s added to what’s already here.`;
    dlg.returnValue = ''; dlg.showModal();
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'yes') return;
      saved.set([...add.map(([k, title, year, poster]) => ({ k, type: k[0] === 'm' ? 'movie' : 'tv', title, year: year || null, poster: poster ? (poster.startsWith('http') ? poster : IMG + poster) : null, at: Date.now() })), ...saved.all()].slice(0, 500));
      for (const [k, p] of Object.entries(d.p || {})) if (!progress.get(k) && Array.isArray(p)) progress.set(k, p);
      if (svcs.length && !mine.get().length) mine.set(svcs);
      show(); say(`Added ${add.length} title${add.length === 1 ? '' : 's'}`);
    }, { once: true });
  })();

  document.getElementById('setClear').addEventListener('click', () => {
    if (!confirm('Clear your Watchlist, progress, My services and settings on this device? This can’t be undone.')) return;
    try { ['tenner-watchlist', 'tenner-progress', 'tenner-services', 'tenner-settings', 'tenner-kind'].forEach((k) => localStorage.removeItem(k)); } catch {}
    saved.set([]); mine.set([]); prefs.set('start', 'auto'); show(); say('Cleared');
  });
  // the account row at the top: who's signed in
  const acct = () => {
    const u = window.tn.account.user(); document.getElementById('setAcctNow').textContent = u ? `Signed in as ${u.name || 'you'}. Everything here is kept in step on your devices` : 'Sign in to keep your Watchlist and settings in step on every device';
    // the Sunday email goes to your account's email address (Google's, or the one you signed up with)
    const dg = document.getElementById('setDigest'); dg.disabled = !u; dg.checked = !!u && !!prefs.get().digest;
    document.getElementById('dgNow').textContent = !u ? 'Sign in to get a short round-up of your Watchlist each Sunday morning'
      : dg.checked ? 'On. Each Sunday morning: new episodes, arrivals and what’s leaving from your Watchlist, sent to your account’s email'
      : 'A short round-up each Sunday morning: new episodes, arrivals and what’s leaving from your Watchlist';
  };
  acct(); addEventListener('tn:account', acct); addEventListener('tn:prefs', acct);
  show();
})();

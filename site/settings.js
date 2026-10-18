// Settings: every control is the browser's own (selects, switches, a file picker, confirm()), and each change is saved
// on this device straight away (shell.js keeps them and applies them on every page).
(() => {
  const { prefs, mine, saved, progress } = window.tn;
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
  document.getElementById('setImport').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const d = JSON.parse(await f.text()); if (d?.tenner !== 1) throw 0;
      const have = saved.all(), keys = new Set(have.map((x) => x.k));
      const add = (d.watchlist || []).filter((x) => x?.k && !keys.has(x.k));
      saved.set([...have, ...add]);
      for (const [k, p] of Object.entries(d.progress || {})) if (!progress.get(k)) progress.set(k, p);
      if (!mine.get().length && d.services?.length) mine.set(d.services);
      show(); say(`Imported ${add.length} new title${add.length === 1 ? '' : 's'}`);
    } catch { say("That file isn't a Tenner export"); }
  });
  document.getElementById('setClear').addEventListener('click', () => {
    if (!confirm('Clear your Watchlist, progress, My services and settings on this device? This can’t be undone.')) return;
    try { ['tenner-watchlist', 'tenner-progress', 'tenner-services', 'tenner-settings', 'tenner-kind'].forEach((k) => localStorage.removeItem(k)); } catch {}
    saved.set([]); mine.set([]); prefs.set('start', 'auto'); show(); say('Cleared');
  });
  show();
})();

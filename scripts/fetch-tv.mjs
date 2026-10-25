// Builds Tenner TV's listings (tv/public/data/): the 35 main Freeview channels, a file per day for the week ahead, from
// the open Freeview XMLTV feed (github.com/dp247/Freeview-EPG, refreshed by its author twice a day). Run every three hours
// by .github/workflows/tv.yml before it deploys. If the feed can't be read, the copy that's live now is carried over,
// so the guide never goes blank. Channel list and logos: tv/channels.json, tv/public/logos/.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), OUT = join(ROOT, 'tv', 'public', 'data');
const FEED = 'https://raw.githubusercontent.com/dp247/Freeview-EPG/master/epg.xml';
const LIVE = 'https://tenner-tv.danseacroft.workers.dev';
const TZ = 'Europe/London';
const ukDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'user-agent': 'TennerTV/1.0 (+https://tv.tenner.stream)' } }); if (r.ok) return r; throw new Error(`${r.status}`); }
    catch (e) { if (i >= tries) throw e; await sleep(3000 * i); }
  }
}
const unxml1 = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, '’');
const unxml = (s) => unxml1(unxml1(s || '')).replace(/\s+/g, ' ').replace(/&( &)+/g, '&').trim();   // twice: some text arrives encoded twice ("&amp;amp;")
// "20261024203500 +0100" → a time
const when = (s) => { const m = s.match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\s*([+-])(\d\d)(\d\d)$/); if (!m) return NaN;
  const [, y, mo, d, h, mi, se, sg, oh, om] = m; return Date.UTC(+y, mo - 1, +d, +h, +mi, +se) - (sg === '+' ? 1 : -1) * (oh * 3600e3 + om * 60e3); };

export function build(xml, channels, now = Date.now()) {
  const byId = new Map(channels.map((c, i) => [c.id, { ...c, k: i.toString(36) }])), days = new Map(), seen = new Set();
  const re = /<programme channel="([^"]+)" start="([^"]+)" stop="([^"]+)"[^>]*>([\s\S]*?)<\/programme>/g;
  const from = now - 864e5, to = now + 8 * 864e5;
  for (const m of xml.matchAll(re)) {
    const c = byId.get(m[1]); if (!c) continue;
    const at = when(m[2]), end = when(m[3]); if (!(end > at) || end < from || at > to) continue;
    const body = m[4], tag = (t) => body.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1];
    const ep = body.match(/<episode-num system="onscreen">\s*(?:S(\d+))?\s*E(\d+)/i);
    // "New: The Voice UK" → "The Voice UK", marked new; a description's "6/8." (the episode, shown separately) goes
    const raw = unxml(tag('title')), t = raw.replace(/^New:\s*/i, ''); if (!t) continue;
    const desc = (unxml(tag('desc')) || '').replace(/^\d+\/\d+\.\s*/, '').replace(/^(New series|New|Series \d+)\.\s*/i, '');
    // compact: a short id (the channel, then the start in minutes), and only the fields a programme has. Sky's pictures
    // (nearly all of them) are kept as just their id; the page puts the address back together
    const item = { id: `${c.k}.${Math.round(at / 6e4).toString(36)}`, t, at, rt: Math.round((end - at) / 6e4) };
    if (ep?.[1]) item.s = +ep[1];
    if (ep?.[2]) item.n = +ep[2];
    if (desc) item.sum = desc.length > 420 ? desc.slice(0, 400).replace(/\s+\S*$/, '') + '…' : desc;
    const icon = body.match(/<icon src="(https:\/\/[^"]+)"/)?.[1], sky = icon?.match(/^https:\/\/images\.metadata\.sky\.com\/pd-image\/([0-9a-f-]{36})\/cover$/)?.[1];
    if (sky) item.sky = sky; else if (icon) item.wide = icon;
    if (/<premiere/.test(body) || /^New:/i.test(raw)) item.isNew = true;
    if (seen.has(item.id)) continue; seen.add(item.id);   // the feed sometimes lists a programme twice
    const d = ukDay(at);
    if (!days.has(d)) days.set(d, new Map());
    const day = days.get(d); if (!day.has(c.name)) day.set(c.name, []); day.get(c.name).push(item);
  }
  const logos = Object.fromEntries(channels.map((c) => [c.name, c.logo]));
  const out = {};
  for (const [d, chans] of [...days].sort()) {
    out[d] = { date: d, source: 'freeview', logos,
      channels: channels.filter((c) => chans.has(c.name)).map((c) => ({ name: c.name, items: chans.get(c.name).sort((a, b) => a.at - b.at) })) };
  }
  return out;
}

// On TV this week, for tenner.stream's title sheets (onair.json): every title still to come, folded the way both pages
// fold names, with its next three showings as [channel, start, film, minutes]. A showing with no episode number that runs 75
// minutes or more counts as a film, so a film and a show of the same name don't get mixed up.
export const fold = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
export function onAir(days, now = Date.now()) {
  const all = new Map();
  for (const day of Object.values(days)) for (const c of day.channels) for (const x of c.items) {
    if (x.at + (x.rt || 30) * 6e4 <= now) continue;
    const k = fold(x.t); if (!k) continue;
    if (!all.has(k)) all.set(k, []);
    all.get(k).push([c.name, x.at, !x.s && !x.n && x.rt >= 75 ? 1 : 0, x.rt || 30]);
  }
  const titles = {};
  for (const [k, l] of all) titles[k] = l.sort((a, b) => a[1] - b[1]).slice(0, 3);
  return { generatedAt: new Date(now).toISOString(), titles };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const channels = JSON.parse(await readFile(join(ROOT, 'tv', 'channels.json'), 'utf8'));
  await mkdir(OUT, { recursive: true });
  const write = async (name, obj) => writeFile(join(OUT, name), JSON.stringify(obj));
  try {
    const xml = await (await get(FEED)).text();
    const days = build(xml, channels);
    const full = Object.values(days).filter((d) => d.channels.length >= 20);
    if (full.length < 5) throw new Error(`only ${full.length} full days in the feed`);
    for (const [d, v] of Object.entries(days)) await write(`${d}.json`, v);
    await write('meta.json', { generatedAt: new Date().toISOString(), source: 'freeview', days: Object.keys(days) });
    await write('onair.json', onAir(days));
    console.log(`Tenner TV: ${Object.keys(days).length} days, ${channels.length} channels, ${Object.values(days).reduce((n, d) => n + d.channels.reduce((m, c) => m + c.items.length, 0), 0)} programmes`);
  } catch (err) {
    // carry the live listings over rather than going blank (the Worker falls back to TVmaze for anything missing)
    console.log(`::warning title=Tenner TV listings::the Freeview feed didn't load (${err.message}); keeping the live copy`);
    try {
      const meta = await (await get(`${LIVE}/data/meta.json`, 2)).json();
      for (const d of meta.days || []) { try { await write(`${d}.json`, await (await get(`${LIVE}/data/${d}.json`, 2)).json()); } catch {} }
      await write('meta.json', meta);
      try { await write('onair.json', await (await get(`${LIVE}/data/onair.json`, 2)).json()); } catch {}
    } catch { console.log('::warning title=Tenner TV listings::no live copy either; the guide uses TVmaze until the feed is back'); }
  }
}

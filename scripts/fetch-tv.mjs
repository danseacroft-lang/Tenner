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
  const byId = new Map(channels.map((c) => [c.id, c])), days = new Map(), seen = new Set();
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
    const item = { id: `${c.id.replace(/\W/g, '')}${Math.round(at / 6e4)}`, show: t, t, at, rt: Math.round((end - at) / 6e4),
      s: ep?.[1] ? +ep[1] : null, n: ep?.[2] ? +ep[2] : null, sum: desc || null,
      wide: body.match(/<icon src="(https:\/\/[^"]+)"/)?.[1] || null, g: [], isNew: /<premiere/.test(body) || /^New:/i.test(raw) || undefined };
    if (item.sum && item.sum.length > 420) item.sum = item.sum.slice(0, 400).replace(/\s+\S*$/, '') + '…';
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
    console.log(`Tenner TV: ${Object.keys(days).length} days, ${channels.length} channels, ${Object.values(days).reduce((n, d) => n + d.channels.reduce((m, c) => m + c.items.length, 0), 0)} programmes`);
  } catch (err) {
    // carry the live listings over rather than going blank (the Worker falls back to TVmaze for anything missing)
    console.log(`::warning title=Tenner TV listings::the Freeview feed didn't load (${err.message}); keeping the live copy`);
    try {
      const meta = await (await get(`${LIVE}/data/meta.json`, 2)).json();
      for (const d of meta.days || []) { try { await write(`${d}.json`, await (await get(`${LIVE}/data/${d}.json`, 2)).json()); } catch {} }
      await write('meta.json', meta);
    } catch { console.log('::warning title=Tenner TV listings::no live copy either; the guide uses TVmaze until the feed is back'); }
  }
}

// The Sunday email: for signed-in people who switch it on in Settings (the "digest" setting, kept with their account).
// Once a week, from 9am UK time on Sunday: the shows on their Watchlist with new episodes in the week ahead, what from
// their Watchlist arrived on a service in the last week or is about to leave, and the week's biggest climber on their
// services. Sent through Resend, only to an address that's been confirmed (a password account's checked email, or the
// Google account's). Every email has a one-tap unsubscribe link (and the List-Unsubscribe header mail apps show).
//   GET|POST /digest/off?u=…&s=…   turn it off (the link is signed, so it only works for that account)
import { sendMail } from './auth.js';
import { nextEpisode, ukNow } from './push.js';

const SITE = 'https://tenner.stream', API = 'https://tenner-api.danseacroft.workers.dev';
const enc = new TextEncoder();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sign = async (env, uid) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`digest|${uid}|${env.RESEND_API_KEY}`)))].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
const LABEL = { netflix: 'Netflix', disney: 'Disney+', prime: 'Prime Video', hbomax: 'HBO Max', paramount: 'Paramount+', appletv: 'Apple TV' };
const MAX = 90;   // Resend's free plan sends 100 a day

export async function digestOff(req, env, url) {
  const uid = url.searchParams.get('u') || '', ok = env.DB && env.RESEND_API_KEY && /^[\w-]{6,64}$/.test(uid) && url.searchParams.get('s') === await sign(env, uid);
  if (ok) {
    const row = await env.DB.prepare('SELECT data FROM userdata WHERE user_id = ?').bind(uid).first();
    if (row) {
      const d = JSON.parse(row.data); d.settings = { ...(d.settings || {}), digest: false }; d.pfat = Date.now();
      await env.DB.prepare('UPDATE userdata SET data = ?, updated = ? WHERE user_id = ?').bind(JSON.stringify(d), Date.now(), uid).run();
    }
  }
  if (req.method === 'POST') return new Response(ok ? 'OK' : 'No', { status: ok ? 200 : 400 });   // the mail app's one-click unsubscribe
  const msg = ok ? ['You’re unsubscribed', 'You won’t get Tenner’s Sunday email any more. You can switch it back on in Settings.'] : ['That link didn’t work', 'Turn the Sunday email off in Tenner’s Settings instead.'];
  return new Response(`<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${msg[0]} | Tenner</title>
    <body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;background:#000;color:#f5f5f7;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px;box-sizing:border-box">
    <div><img src="${SITE}/apple-touch-icon.png" width="64" height="64" alt="" style="border-radius:15px"><h1 style="font-size:24px;font-weight:600;margin:20px 0 8px">${msg[0]}</h1>
    <p style="color:#a1a1a6;line-height:1.5;max-width:340px;margin:0 auto 24px">${msg[1]}</p><a href="${SITE}/settings.html" style="color:#0a84ff;text-decoration:none">Open Settings</a></div></body></html>`,
    { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function digestRun(env, force = false) {
  if (!env.DB || !env.RESEND_API_KEY || !env.PUSH) return;
  const { day, hour } = ukNow(), sunday = new Date(`${day}T12:00:00Z`).getUTCDay() === 0;
  if (!force && (!sunday || hour < 9 || (await env.PUSH.get('meta:digest')) === day)) return;
  await env.PUSH.put('meta:digest', day);
  const get = (p) => fetch(`${SITE}/data/${p}?v=${Date.now()}`, { cf: { cacheTtl: 0 } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [fresh, week] = await Promise.all([get('new.json'), get('week.json')]);
  // everyone with the Sunday email on, and the confirmed address to send it to
  const { results = [] } = await env.DB.prepare(`SELECT u.id, u.name, d.data, COALESCE(v.email, CASE WHEN u.google_sub IS NOT NULL THEN u.email END) AS email
    FROM userdata d JOIN users u ON u.id = d.user_id LEFT JOIN passwords p ON p.user_id = u.id LEFT JOIN verified v ON v.email = p.email
    WHERE d.data LIKE '%"digest":true%'`).all();
  let sent = 0;
  for (const u of results) {
    if (sent >= MAX) break;
    let d; try { d = JSON.parse(u.data); } catch { continue; }
    if (d.settings?.digest !== true || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email || '')) continue;
    const mail = await build(env, u, d, fresh, week, day);
    if (mail && await sendMail(env, u.email, mail.subject, mail).catch(() => false)) sent++;
  }
  console.log(`Sunday email: ${sent} sent`);
}

async function build(env, u, d, fresh, week, day) {
  const wl = (d.watchlist || []).filter((x) => /^[mt]\d+$/.test(x?.k || '')), want = new Map(wl.map((x) => [x.k, x]));
  const key = (x) => `${x.type === 'movie' ? 'm' : 't'}${x.id}`, end = new Date(Date.parse(day) + 7 * 864e5).toISOString().slice(0, 10), since = new Date(Date.parse(day) - 7 * 864e5).toISOString().slice(0, 10);
  const when = (iso) => { const g = Math.round((Date.parse(iso) - Date.parse(day)) / 864e5); return g <= 0 ? 'today' : g === 1 ? 'tomorrow' : new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }); };
  const eps = [];
  for (const x of wl.filter((x) => x.k[0] === 't').slice(0, 60)) {
    const e = await nextEpisode(env, x.k.slice(1)).catch(() => null);
    if (e?.nx && e.nx[0] >= day && e.nx[0] <= end) eps.push({ k: x.k, line: `${e.title || x.title}: season ${e.nx[1]}, episode ${e.nx[2]}, ${when(e.nx[0])}`, at: e.nx[0] });
  }
  eps.sort((a, b) => a.at.localeCompare(b.at));
  const arrived = (fresh?.items || []).filter((x) => x.id && want.has(key(x)) && x.date >= since && x.date <= day)
    .map((x) => ({ k: key(x), line: `${x.title}${x.season > 1 ? ` season ${x.season}` : ''}, now on ${LABEL[x.service] || 'streaming'}` }));
  const leaving = (fresh?.leaving || []).filter((x) => x.id && want.has(key(x)) && x.date >= day && x.date <= end)
    .map((x) => ({ k: key(x), line: `${x.title} leaves ${LABEL[x.service] || 'its service'} ${when(x.date)}` }));
  const mine = (d.services || []).length ? d.services : Object.keys(LABEL);
  const c = (week?.climbers || []).find((x) => week.items?.[x.k] && mine.includes(x.c.split(':')[0]));
  const climb = c ? [{ k: c.k, line: `${week.items[c.k].title}, up ${c.by} to No. ${c.to} on ${week.labels?.[c.c.split(':')[0]] || LABEL[c.c.split(':')[0]] || 'the charts'}` }] : [];
  const parts = [['New episodes this week', eps.slice(0, 8)], ['Arrived from your Watchlist', arrived.slice(0, 6)], ['Leaving soon', leaving.slice(0, 6)], ['Biggest climber', climb]].filter(([, l]) => l.length);
  if (!eps.length && !arrived.length && !leaving.length) return null;   // nothing of theirs this week: no email
  const off = `${API}/digest/off?u=${encodeURIComponent(u.id)}&s=${await sign(env, u.id)}`;
  const hi = u.name ? `Morning, ${u.name.split(' ')[0]}.` : 'Morning.';
  const subject = eps.length ? `This week: ${eps.length} new episode${eps.length > 1 ? 's' : ''} from your Watchlist` : leaving.length ? `${leaving.length} from your Watchlist leaving soon` : 'Your week on Tenner';
  const text = `${hi} Here's your week on Tenner.\n\n${parts.map(([h, l]) => `${h}\n${l.map((x) => `- ${x.line}`).join('\n')}`).join('\n\n')}\n\nOpen Tenner: ${SITE}/#watchlist\n\nYou're getting this because you switched on the Sunday email. Unsubscribe: ${off}\n\nTenner · tenner.stream`;
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1c1c1e">
    <img src="${SITE}/apple-touch-icon.png" width="56" height="56" alt="Tenner" style="border-radius:13px">
    <h1 style="font-size:24px;font-weight:600;margin:24px 0 6px">Your week on Tenner</h1>
    <p style="font-size:16px;line-height:1.5;color:#3a3a3c;margin:0 0 8px">${esc(hi)}</p>
    ${parts.map(([h, l]) => `<h2 style="font-size:17px;font-weight:600;margin:26px 0 6px">${esc(h)}</h2>
      ${l.map((x) => `<a href="${SITE}/?t=${esc(x.k)}" style="display:block;padding:10px 0;border-bottom:1px solid #e5e5ea;color:#1c1c1e;text-decoration:none;font-size:15px;line-height:1.4">${esc(x.line)}</a>`).join('')}`).join('')}
    <p style="margin:28px 0"><a href="${SITE}/#watchlist" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#0a84ff;color:#fff;text-decoration:none;font-size:16px;font-weight:500">Open your Watchlist</a></p>
    <p style="font-size:13px;line-height:1.5;color:#8e8e93;margin-top:32px">You’re getting this because you switched on the Sunday email in Tenner’s Settings. <a href="${esc(off)}" style="color:#8e8e93">Unsubscribe</a><br>Tenner · <a href="${SITE}" style="color:#8e8e93">tenner.stream</a></p></div>`;
  return { subject, text, html, headers: { 'List-Unsubscribe': `<${off}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}

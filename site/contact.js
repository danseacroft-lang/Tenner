// Tenner's Contact page: pick a topic, then name, email and message. Send posts it to Tenner's search service on
// Cloudflare, which emails it to our inbox (the address is a secret there, never in this page). What you've written
// is kept on this device until it's sent, so leaving the page doesn't lose it.
(() => {
  const { api, account } = window.tn;
  const $ = (s) => document.querySelector(s);
  const form = $('#cForm'), send = $('#cSend'), note = $('#cNote'), done = $('#cDone'), hint = note.textContent;
  const nameI = $('#cName'), emailI = $('#cEmail'), msgI = $('#cMsg'), count = $('#cCount'), topics = $('.cx-topics');
  const still = () => document.documentElement.classList.contains('still');
  const topic = () => form.querySelector('input[name="topic"]:checked')?.value || '';
  const pick = (v) => { const r = form.querySelector(`input[name="topic"][value="${CSS.escape(v)}"]`); if (r) r.checked = true; return !!r; };
  const say = (t, bad) => { note.textContent = t; note.classList.toggle('bad', !!bad); };
  // a field that needs attention: a red edge, a little shake, the reason in the note, and the cursor in it
  const flag = (el, box, t) => {
    say(t, true); box.classList.add('bad');
    if (!still()) { box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); }
    el.focus({ preventScroll: false }); navigator.vibrate?.(30);
  };
  const clear = (box) => box.classList.remove('bad', 'shake');

  // the draft, kept on this device until sent
  const KEY = 'tenner-contact-draft';
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ t: topic(), n: nameI.value, e: emailI.value, m: msgI.value })); } catch {} };
  try { const d = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (d) { if (d.t) pick(d.t); nameI.value = d.n || ''; emailI.value = d.e || ''; msgI.value = d.m || ''; } } catch {}
  // signed in: your name and email are filled in already
  const u = account?.user?.();
  if (u) { if (!nameI.value && u.name) nameI.value = u.name; if (!emailI.value && u.email) emailI.value = u.email; }
  // ?about=Feedback (from Browse's note): the topic chosen already
  const about = new URL(location.href).searchParams.get('about');
  if (about) pick(about);

  const tally = () => { const n = msgI.value.length; count.textContent = n ? `${n.toLocaleString('en-GB')} / 5,000` : ''; count.classList.toggle('near', n > 4500); };
  tally();
  form.addEventListener('input', (e) => {
    save(); if (e.target === msgI) tally();
    const box = e.target.closest('.cx-f, .cx-topics'); if (box?.classList.contains('bad')) { clear(box); say(hint); }
  });
  // ⌘↵ (Ctrl+↵ elsewhere) sends from anywhere in the form
  if (!/Mac|iPhone|iPad/.test(navigator.platform)) send.querySelector('kbd').textContent = 'Ctrl ↵';
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });

  // the card trades the form for the tick (and back), cross-fading where the browser can
  const swap = (fn) => (document.startViewTransition && !still() ? document.startViewTransition(fn) : fn());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailI.value.trim(), msg = msgI.value.trim();
    if (!topic()) return flag(topics.querySelector('input'), topics, 'Choose what it’s about.');
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return flag(emailI, emailI.parentNode, email ? 'That email address doesn’t look right.' : 'Add your email, so we can reply.');
    if (msg.length < 2) return flag(msgI, msgI.parentNode, 'Write your message first.');
    send.disabled = true; send.classList.add('busy'); send.querySelector('span').textContent = 'Sending…'; say('Sending…');
    try {
      const r = await fetch(`${api}/contact`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: topic(), name: nameI.value, email, msg, website: $('#cWeb').value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Couldn’t send right now. Please try again in a little while.');
      const first = nameI.value.trim().split(/\s+/)[0];
      $('#cDoneH').textContent = first ? `Thanks, ${first}` : 'Message sent';
      $('#cDoneP').textContent = `We’ve got it, and we’ll reply to ${email}, usually within a day.`;
      try { sessionStorage.removeItem(KEY); } catch {}
      navigator.vibrate?.([12, 60, 18]);
      swap(() => { form.hidden = true; done.hidden = false; });
      done.focus();
      form.reset(); tally(); say(hint);
      if (u) { nameI.value = u.name || ''; emailI.value = u.email || ''; }
    } catch (err) {
      say(navigator.onLine === false ? 'You’re offline. Try again when you’re back online.' : err.message, true);
    }
    send.disabled = false; send.classList.remove('busy'); send.querySelector('span').textContent = 'Send message';
  });
  $('#cAgain').addEventListener('click', () => { swap(() => { done.hidden = true; form.hidden = false; }); (emailI.value ? msgI : emailI).focus(); });
})();

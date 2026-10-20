// Tenner's Contact page: a compose sheet. Send posts the message to Tenner's search service on Cloudflare, which
// emails it to our inbox (the address is a secret there, never in this page). Add your email and we can reply.
(() => {
  const { segment, arrows, api } = window.tn;
  const $ = (s) => document.querySelector(s);
  const topics = () => [...document.querySelectorAll('.c-topic [data-topic]')];
  const pick = (b) => topics().forEach((t) => t.setAttribute('aria-checked', String(t === b)));
  topics().forEach((b) => b.addEventListener('click', () => pick(b)));
  arrows($('.c-topic'), topics, pick);
  segment($('.c-topic'), pick);

  const form = $('#cForm'), send = $('#cSend'), note = $('#cNote'), done = $('#cDone'), hint = note.textContent;
  const say = (t, bad) => { note.textContent = t; note.classList.toggle('bad', !!bad); };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#cMsg').value.trim(), email = $('#cEmail').value.trim();
    if (msg.length < 2) { say('Write your message first.', true); $('#cMsg').focus(); return; }
    if (email && !$('#cEmail').checkValidity()) { say('That email address doesn’t look right.', true); $('#cEmail').focus(); return; }
    send.disabled = true; send.classList.add('busy'); say('Sending…');
    try {
      const r = await fetch(`${api}/contact`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: $('.c-topic [aria-checked="true"]')?.dataset.topic, name: $('#cName').value, email, msg, website: $('#cWeb').value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Couldn’t send right now. Please try again in a little while.');
      $('#cDoneP').textContent = email ? `Thanks for getting in touch. We’ll reply to ${email}.` : 'Thanks for getting in touch. We read everything.';
      form.hidden = true; $('.c-actions').hidden = true; done.hidden = false; done.focus();
      form.reset(); pick(topics()[0]);
    } catch (err) {
      say(navigator.onLine === false ? 'You’re offline. Try again when you’re back online.' : err.message, true);
    }
    send.disabled = false; send.classList.remove('busy');
  });
  $('#cAgain').addEventListener('click', () => { done.hidden = true; form.hidden = false; $('.c-actions').hidden = false; say(hint); $('#cMsg').focus(); });
})();

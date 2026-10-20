// Tenner's Contact page: a compose sheet (name, email, type of enquiry, message). Submit posts it to Tenner's search
// service on Cloudflare, which emails it to our inbox (the address is a secret there, never in this page).
(() => {
  const { api } = window.tn;
  const $ = (s) => document.querySelector(s);
  const form = $('#cForm'), send = $('#cSend'), note = $('#cNote'), done = $('#cDone'), hint = note.textContent;
  const say = (t, bad) => { note.textContent = t; note.classList.toggle('bad', !!bad); };
  const type = $('#cType');
  type.addEventListener('change', () => type.classList.toggle('chosen', !!type.value));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#cEmail').value.trim(), msg = $('#cMsg').value.trim();
    if (!email || !$('#cEmail').checkValidity()) { say(email ? 'That email address doesn’t look right.' : 'Add your email, so we can reply.', true); $('#cEmail').focus(); return; }
    if (!type.value) { say('Choose a type of enquiry.', true); type.focus(); return; }
    if (msg.length < 2) { say('Write your message first.', true); $('#cMsg').focus(); return; }
    send.disabled = true; send.classList.add('busy'); say('Sending…');
    try {
      const r = await fetch(`${api}/contact`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: type.value, name: $('#cName').value, email, msg, website: $('#cWeb').value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Couldn’t send right now. Please try again in a little while.');
      form.hidden = true; $('.c-actions').hidden = true; done.hidden = false; done.focus();
      form.reset(); type.classList.remove('chosen'); say(hint);
    } catch (err) {
      say(navigator.onLine === false ? 'You’re offline. Try again when you’re back online.' : err.message, true);
    }
    send.disabled = false; send.classList.remove('busy');
  });
  $('#cAgain').addEventListener('click', () => { done.hidden = true; form.hidden = false; $('.c-actions').hidden = false; $('#cName').focus(); });
})();

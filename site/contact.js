// Tenner's Contact page: a compose sheet. Send opens your own email app with the topic, your name and your message
// filled in; nothing is sent to or stored by Tenner. The address itself comes from shell.js (tn.contact).
(() => {
  const { segment, arrows, contact } = window.tn;
  const $ = (s) => document.querySelector(s);
  const topics = () => [...document.querySelectorAll('.c-topic [data-topic]')];
  const pick = (b) => topics().forEach((t) => t.setAttribute('aria-checked', String(t === b)));
  topics().forEach((b) => b.addEventListener('click', () => pick(b)));
  arrows($('.c-topic'), topics, pick);
  segment($('.c-topic'), pick);

  // Copy the address, for anyone who'd rather use webmail
  const copy = $('#cCopy');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(contact); copy.textContent = 'Copied'; }
    catch { getSelection().selectAllChildren($('.contact-email-text')); copy.textContent = 'Selected'; }
    setTimeout(() => (copy.textContent = 'Copy'), 1600);
  });

  $('#cForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const topic = $('.c-topic [aria-checked="true"]')?.dataset.topic || 'A message';
    const name = $('#cName').value.trim(), msg = $('#cMsg').value.trim();
    const body = [msg, name ? `\n— ${name}` : ''].filter(Boolean).join('\n');
    location.href = `mailto:${contact}?subject=${encodeURIComponent(`Tenner: ${topic}`)}&body=${encodeURIComponent(body)}`;
  });
})();

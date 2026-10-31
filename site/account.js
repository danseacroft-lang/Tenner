// Account: sign in with a passkey or Google, and, once in, your profile, a public link to your Watchlist, the ways you
// sign in, the devices you're signed in on, sign out and delete. The account itself lives in the Worker (auth.js);
// keeping devices in step is shell.js's (tn.account).
(() => {
  const { esc, account, avatar } = window.tn;
  const $ = (s) => document.querySelector(s);
  // Sign in with Google: the OAuth client ID from Google Cloud (public). Empty: the Google button stays hidden.
  const GOOGLE_CLIENT_ID = '573684167951-69isfjep31v7kl8hs0083228flhbq53e.apps.googleusercontent.com';
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  const say = (el, t, bad) => { const n = $(el); n.textContent = t; n.classList.toggle('bad', !!bad); clearTimeout(n.t); if (!bad) n.t = setTimeout(() => (n.textContent = ''), 3500); };
  const passkeys = !!window.PublicKeyCredential;
  // Show password: an eye inside each password box, so you can check what you've typed
  const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path class="ac-eye-off" d="M4 4l16 16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  function eyes(root) {
    root.querySelectorAll('input[type=password]').forEach((i) => {
      const w = document.createElement('span'); w.className = 'ac-pw'; i.replaceWith(w); w.append(i);
      w.insertAdjacentHTML('beforeend', `<button type="button" class="ac-eye" aria-label="Show password" aria-pressed="false">${EYE}</button>`);
      const b = w.lastChild;
      b.addEventListener('pointerdown', (e) => e.preventDefault());   // keeps the keyboard up and the caret where it was
      b.addEventListener('click', () => { const on = i.type === 'password'; i.type = on ? 'text' : 'password'; b.setAttribute('aria-pressed', on); b.setAttribute('aria-label', on ? 'Hide password' : 'Show password'); });
      i.form?.addEventListener('submit', () => { if (i.type === 'text') b.click(); });   // hidden again before the browser offers to save it
    });
  }
  eyes(document);

  // ---------- signed out ----------
  async function signIn() {
    const { id, options: o } = await account.call('POST', '/auth/login/start');
    const cred = await navigator.credentials.get({ publicKey: { challenge: unb64u(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: o.userVerification, allowCredentials: [] } });
    const r = cred.response;
    const out = await account.call('POST', '/auth/login/finish', { id, credential: { id: cred.id, type: cred.type,
      response: { clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature), userHandle: r.userHandle ? b64u(r.userHandle) : null } } });
    await account.signedIn(out.token, out.user);
  }
  async function makePasskey(name) {   // a new account (name given), or another passkey for yours (signed in)
    const { id, options: o } = await account.call('POST', '/auth/passkey/start', name ? { name } : {});
    const cred = await navigator.credentials.create({ publicKey: { ...o, challenge: unb64u(o.challenge), user: { ...o.user, id: unb64u(o.user.id) },
      excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: unb64u(c.id) })) } });
    const out = await account.call('POST', '/auth/passkey/finish', { id, credential: { id: cred.id, type: cred.type,
      response: { clientDataJSON: b64u(cred.response.clientDataJSON), attestationObject: b64u(cred.response.attestationObject) } } });
    if (out.token) await account.signedIn(out.token, out.user);
  }
  const friendly = (e) => e?.name === 'NotAllowedError' ? 'Cancelled' : e?.name === 'InvalidStateError' ? 'This device already has a passkey for your account' : e?.message || 'Something went wrong';
  $('#acPasskey').addEventListener('click', async (e) => {
    if (!passkeys) { say('#acMsg', 'This browser can’t use passkeys. Try Safari, Chrome or Edge', true); return; }
    const b = e.currentTarget; b.disabled = true;
    try { await signIn(); } catch (err) { say('#acMsg', err.status === 404 ? 'That passkey isn’t linked to an account. Create one below' : friendly(err), err.name !== 'NotAllowedError'); }
    b.disabled = false;
  });
  $('#acNewOpen').addEventListener('click', () => { $('#acNew').hidden = false; $('#acNewOpen').hidden = true; $('#acName').focus(); });
  $('#acNew').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = e.submitter, name = $('#acName').value.trim(); b.disabled = true;
    try {
      if (b?.id === 'acMakePk') {   // a passkey instead of a password
        if (!passkeys) throw new Error('This browser can’t make passkeys. Try Safari, Chrome or Edge');
        await makePasskey(name);
      } else {
        const email = $('#acNewEmail').value.trim(), pw = $('#acNewPw').value;
        if (!email) { $('#acNewEmail').focus(); throw new Error('Enter your email address'); }
        if (pw.length < 8) { $('#acNewPw').focus(); throw new Error('Use 8 or more characters for your password'); }
        const out = await account.call('POST', '/auth/password/signup', { email, name, key: await pwKey(email, pw) });
        if (out.verify) checkInbox(out.verify, true); else await account.signedIn(out.token, out.user);
      }
    } catch (err) { say('#acMsg', friendly(err), err.name !== 'NotAllowedError'); }
    b.disabled = false;
  });
  // the name is all a passkey account needs; email and password only for a password one
  $('#acMakePk').addEventListener('click', () => { $('#acNewEmail').required = false; $('#acNewPw').required = false; });
  $('#acMakePw').addEventListener('click', () => { $('#acNewEmail').required = true; $('#acNewPw').required = true; });

  // ---------- email and password ----------
  // The password is stretched here first (PBKDF2, 310,000 rounds, salted with the email), so what's sent is a key, never
  // the password; the account server salts and hashes that once more.
  async function pwKey(email, pw) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(`tenner.stream:${email.trim().toLowerCase()}`), iterations: 310000 }, base, 256));
  }
  $('#acLogin').addEventListener('submit', async (e) => {
    e.preventDefault(); const b = e.submitter; b.disabled = true;
    try {
      const email = $('#acEmail').value.trim(), out = await account.call('POST', '/auth/password/login', { email, key: await pwKey(email, $('#acPw').value) });
      await account.signedIn(out.token, out.user);
    } catch (err) { if (err.data?.unverified) checkInbox(err.data.unverified, false); else say('#acMsg', friendly(err), true); }
    b.disabled = false;
  });
  // confirming the email: after signing up (or signing in before confirming), a "Check your inbox" screen
  let checkEmail = '';
  function checkInbox(email, fresh) {
    checkEmail = email;
    $('#acCheckP').textContent = fresh ? `We’ve sent a link to ${email}. Tap it to confirm your email and finish making your account.`
      : `${email} isn’t confirmed yet. Tap the link we emailed you, or have it sent again.`;
    for (const id of ['#acLogin', '#acNew', '#acNewOpen', '#acPasskey', '#acGoogle', '#acOr']) $(id).hidden = true;
    $('#acCheck').hidden = false; $('#acMsg').textContent = '';
  }
  $('#acResend').addEventListener('click', async (e) => {
    try { await account.call('POST', '/auth/password/resend', { email: checkEmail }); e.target.textContent = 'Sent'; setTimeout(() => { e.target.textContent = 'Send it again'; }, 4000); }
    catch (err) { say('#acMsg', friendly(err), true); }
  });
  $('#acBack').addEventListener('click', () => { $('#acCheck').hidden = true; show(); });
  // arriving from the welcome email's link: account.html#verify=…
  const verifyIn = new URLSearchParams(location.hash.slice(1)).get('verify');
  if (verifyIn) {
    history.replaceState(null, '', location.pathname);
    account.call('POST', '/auth/password/verify', { token: verifyIn })
      .then(async (out) => { await account.signedIn(out.token, out.user); say('#acNote', 'Email confirmed. You’re in'); })
      .catch((err) => say('#acMsg', friendly(err), true));
  }
  $('#acForgot').addEventListener('click', async () => {
    const email = $('#acEmail').value.trim();
    if (!email) { $('#acEmail').focus(); say('#acMsg', 'Enter your email above, then tap Forgot password again'); return; }
    try { await account.call('POST', '/auth/password/forgot', { email }); say('#acMsg', `If there’s a Tenner account for ${email}, we’ve emailed it a link to choose a new password. Check your inbox (and junk)`); }
    catch (err) { say('#acMsg', friendly(err), true); }
  });
  // arriving from the email's link: account.html#reset=…&e=…
  addEventListener('hashchange', () => { if (/^#(reset|verify)=/.test(location.hash)) location.reload(); });   // the link opened in a tab already on this page
  const resetIn = new URLSearchParams(location.hash.slice(1));
  if (resetIn.has('reset')) {
    history.replaceState(null, '', location.pathname);
    $('#acReset').hidden = false; $('#acLogin').hidden = true; $('#acResetEmail').value = resetIn.get('e') || '';
    $('#acReset').addEventListener('submit', async (e) => {
      e.preventDefault(); const b = e.submitter, pw = $('#acResetPw').value;
      if (pw.length < 8) { say('#acMsg', 'Use 8 or more characters for your password', true); return; }
      b.disabled = true;
      try { const out = await account.call('POST', '/auth/password/reset', { token: resetIn.get('reset'), key: await pwKey($('#acResetEmail').value, pw) }); $('#acReset').hidden = true; $('#acLogin').hidden = false; await account.signedIn(out.token, out.user); }
      catch (err) { say('#acMsg', friendly(err), true); }
      b.disabled = false;
    });
  }

  // Google's own button (their script loads only on this page, and only once the client ID is set)
  let gReady = null;
  function google(into, linking) {
    if (!GOOGLE_CLIENT_ID) return;
    gReady ||= new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = res; sc.onerror = rej; document.head.append(sc); });
    gReady.then(() => {
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, ux_mode: 'popup', callback: async ({ credential }) => {
        try {
          const out = await account.call('POST', '/auth/google', { credential });
          if (out.token) await account.signedIn(out.token, out.user); else { say('#acNote', 'Google linked'); load(); }
        } catch (err) { say(linking ? '#acNote' : '#acMsg', friendly(err), true); }
      } });
      const th = document.documentElement.dataset.theme, dark = th ? th === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      into.hidden = false; into.innerHTML = ''; if (!linking) $('#acOr').hidden = false;
      window.google.accounts.id.renderButton(into, { type: 'standard', theme: dark ? 'filled_black' : 'outline', size: 'large', shape: 'rectangular', text: 'continue_with', width: Math.min(360, into.parentElement.clientWidth || 320) });
    }).catch(() => {});
  }


  // ---------- signed in ----------
  const HUES = [210, 265, 330, 5, 30, 145, 175];
  const when = (t) => { const d = (Date.now() - t) / 864e5; return d < 1 ? 'Today' : d < 2 ? 'Yesterday' : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined }); };
  let me = null;
  async function load() {
    try { me = await account.call('GET', '/me'); } catch (err) { if (err.status === 401) return show(); say('#acNote', 'Your account didn’t load. Check your connection', true); return; }
    account.setUser(me.user); draw();
  }
  function draw() {
    const u = me.user;
    $('#acAv').innerHTML = avatar(u, 'av-xl');
    $('#acHello').textContent = u.name || 'Your account';
    if (document.activeElement !== $('#acEditName')) $('#acEditName').value = u.name || '';
    $('#acHues').hidden = !!u.picture;
    $('#acSw').innerHTML = HUES.map((h) => `<button type="button" class="ac-hue" style="--h:${h}" data-hue="${h}" aria-pressed="${h === u.hue}" aria-label="Colour ${h}"></button>`).join('');
    $('#acShare').checked = !!u.share_id; $('#acLinkRow').hidden = !u.share_id;
    if (u.share_id) $('#acUrl').textContent = `${location.origin}/list.html?u=${u.share_id}`;
    $('#acWays').innerHTML = me.passkeys.map((p) => `<div class="set-row"><span class="set-l">${esc(p.label || 'Passkey')}<small>Added ${esc(when(p.created))}${p.used ? ` · last used ${esc(when(p.used).toLowerCase())}` : ''}</small></span><button type="button" class="ac-x" data-pk="${esc(p.id)}">Remove</button></div>`).join('')
      + (u.google ? `<div class="set-row"><span class="set-l">Google<small>${esc(u.email || 'Linked')}</small></span><button type="button" class="ac-x" data-unlink>Unlink</button></div>` : '')
      + (me.password ? `<div class="set-row"><span class="set-l">Email and password<small>${esc(me.password)}${me.password_ok ? '' : ' · <b class="ac-warn">not confirmed yet</b> <button type="button" class="ac-link ac-inline" data-reverify>Send the link again</button>'}</small></span><span class="ac-btns"><button type="button" class="ac-x ac-ok" data-pw-open>Change</button><button type="button" class="ac-x" data-pw-remove>Remove</button></span></div>`
        : '<button type="button" class="set-row set-link" data-pw-open><span class="set-l">Add a password<small>Sign in with your email and a password too</small></span><span class="set-chev" aria-hidden="true"></span></button>')
      + `<form class="set-row ac-pwform" id="acPwForm" hidden><input type="email" id="acSetEmail" autocomplete="username" placeholder="Email" aria-label="Email" required value="${esc(me.password || '')}"><input type="password" id="acSetPw" autocomplete="new-password" minlength="8" placeholder="New password" aria-label="New password" required><button class="btn btn-tinted">Save</button></form>`
      + `<button type="button" class="set-row set-link" id="acAddPk"><span class="set-l">Add a passkey<small>For another device, or a password manager</small></span><span class="set-chev" aria-hidden="true"></span></button>`
      + (!u.google && GOOGLE_CLIENT_ID ? '<div class="set-row ac-glink"><span class="set-l">Link Google</span><div id="acGLink"></div></div>' : '');
    if (!u.google && GOOGLE_CLIENT_ID) google($('#acGLink'), true);
    eyes($('#acWays'));
    $('#acDevices').innerHTML = me.sessions.map((x) => `<div class="set-row"><span class="set-l"><span>${esc(x.label)}${x.here ? ' <em class="ac-here">This device</em>' : ''}</span><small>Signed in ${esc(when(x.created).toLowerCase())}${x.here ? '' : ` · seen ${esc(when(x.seen).toLowerCase())}`}</small></span>${x.here || !x.id ? '' : `<button type="button" class="ac-x" data-ses="${+x.id}" aria-label="Sign out ${esc(x.label)}">Remove</button>`}</div>`).join('')
      + (me.sessions.length > 1 ? '<button type="button" class="set-row set-link" id="acOthers"><span class="set-l">Sign out everywhere else</span></button>' : '');
    syncLine();
  }
  function syncLine() {
    const n = window.tn.saved.all().length;
    $('#acSync').textContent = `Synced · ${n} title${n === 1 ? '' : 's'} in your Watchlist, kept in step on every device you sign in on`;
  }
  addEventListener('tn:synced', () => { if (me) syncLine(); });

  $('#acEditName').addEventListener('change', async (e) => {
    const name = e.target.value.trim(); if (!name) { e.target.value = me.user.name; return; }
    try { me.user = (await account.call('PATCH', '/me', { name })).user; account.setUser(me.user); draw(); say('#acNote', 'Saved'); } catch (err) { say('#acNote', friendly(err), true); }
  });
  $('#acIn').addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    try {
      if (t.dataset.hue) { me.user = (await account.call('PATCH', '/me', { hue: +t.dataset.hue })).user; account.setUser(me.user); draw(); }
      else if (t.dataset.pk) { if (!confirm('Remove this passkey? You won’t be able to sign in with it any more.')) return; await account.call('DELETE', `/me/passkeys/${encodeURIComponent(t.dataset.pk)}`); load(); say('#acNote', 'Passkey removed'); }
      else if (t.dataset.ses) { if (!confirm(`Sign out ${t.closest('.set-row').querySelector('.set-l span').textContent || 'that device'}? You can sign in on it again any time.`)) return; await account.call('DELETE', `/me/sessions/${t.dataset.ses}`); load(); say('#acNote', 'Signed out on that device'); }
      else if ('reverify' in t.dataset) { await account.call('POST', '/me/verify'); say('#acNote', `Sent. Check ${me.password}`); }
      else if ('pwOpen' in t.dataset) { $('#acPwForm').hidden = false; $('#acSetEmail').focus(); }
      else if ('pwRemove' in t.dataset) { if (!confirm('Remove your password? You’ll sign in another way.')) return; await account.call('DELETE', '/me/password'); load(); say('#acNote', 'Password removed'); }
      else if ('unlink' in t.dataset) { await account.call('DELETE', '/me/google'); load(); say('#acNote', 'Google unlinked'); }
      else if (t.id === 'acAddPk') { await makePasskey(); load(); say('#acNote', 'Passkey added'); }
      else if (t.id === 'acOthers') { await account.call('DELETE', '/me/sessions'); load(); say('#acNote', 'Signed out everywhere else'); }
      else if (t.id === 'acCopy') { const link = $('#acUrl').textContent; if (navigator.share && window.tn.isIOS) navigator.share({ title: `${me.user.name}’s Watchlist`, url: link }).catch(() => {}); else { await navigator.clipboard.writeText(link); t.textContent = 'Copied'; setTimeout(() => (t.textContent = 'Copy'), 1500); } }
      else if (t.id === 'acDelete') askDelete();
    } catch (err) { say('#acNote', friendly(err), err.name !== 'NotAllowedError'); }
  });
  // ---------- delete: ask once, kindly, saying what goes; keeping it is the default, deleting one tap away ----------
  const delDlg = $('#acDelDlg');
  function askDelete() {
    const n = window.tn.saved.all().length;
    $('#acDelP').textContent = `Deleting your account removes ${n ? `your Watchlist of ${n} title${n === 1 ? '' : 's'}` : 'your Watchlist'}, where you’re up to and your settings from Tenner for good. What’s on this device stays. This can’t be undone.`;
    delDlg.returnValue = ''; delDlg.showModal();
  }
  delDlg.addEventListener('click', (e) => { if (e.target === delDlg) delDlg.close(); });   // a tap outside keeps it, as on iPhone
  delDlg.addEventListener('close', () => { if (delDlg.returnValue === 'delete') { del2Dlg.returnValue = ''; del2Dlg.showModal(); } });
  // the last word: are you sure? No (or a tap outside) heads back to Tenner; Yes deletes it
  const del2Dlg = $('#acDel2Dlg');
  del2Dlg.addEventListener('click', (e) => { if (e.target === del2Dlg) del2Dlg.close(); });
  del2Dlg.addEventListener('close', async () => {
    if (del2Dlg.returnValue !== 'delete') { location.href = '/'; return; }
    try { await account.call('DELETE', '/me'); account.forget(); show(); say('#acMsg', 'Your account has been deleted'); }
    catch (err) { say('#acNote', friendly(err), true); }
  });
  $('#acIn').addEventListener('submit', async (e) => {
    if (e.target.id !== 'acPwForm') return; e.preventDefault();
    const email = $('#acSetEmail').value.trim(), pw = $('#acSetPw').value;
    if (pw.length < 8) { say('#acNote', 'Use 8 or more characters for your password', true); return; }
    try { const r = await account.call('POST', '/me/password', { email, key: await pwKey(email, pw) }); load(); say('#acNote', r.verify ? `Password saved. Tap the link we sent to ${r.verify} to confirm it` : 'Password saved'); }
    catch (err) { say('#acNote', friendly(err), true); }
  });
  // ---------- slide to sign out: drag the knob across (or press Enter); let go early and it springs back ----------
  const slide = $('#acSlide'), knob = slide.querySelector('.ac-knob');
  let drag = null;
  const travel = () => slide.clientWidth - knob.offsetWidth - 8;
  const setX = (x) => { const max = travel(), v = Math.max(0, Math.min(max, x)); slide.style.setProperty('--x', `${v}px`); slide.style.setProperty('--p', (v / max).toFixed(3)); slide.setAttribute('aria-valuenow', Math.round((v / max) * 100)); return v / max; };
  async function goOut() {
    slide.classList.add('done'); setX(travel());
    await account.signOut($('#acClear').checked);
    setTimeout(() => { slide.classList.remove('done'); setX(0); $('#acClear').checked = false; show(); say('#acMsg', 'Signed out'); }, 350);
  }
  knob.addEventListener('pointerdown', (e) => { drag = { x0: e.clientX, id: e.pointerId }; knob.setPointerCapture(e.pointerId); slide.classList.add('held'); });
  knob.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) setX(e.clientX - drag.x0); });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = setX(e.clientX - drag.x0); drag = null; slide.classList.remove('held');
    if (p > 0.88) goOut(); else setX(0);   // not far enough: back it goes
  };
  knob.addEventListener('pointerup', end); knob.addEventListener('pointercancel', end);
  slide.addEventListener('keydown', (e) => { if (['Enter', ' ', 'ArrowRight', 'End'].includes(e.key)) { e.preventDefault(); goOut(); } });
  $('#acShare').addEventListener('change', async (e) => {
    try { const { share_id } = await account.call('POST', '/me/share', { on: e.target.checked }); me.user.share_id = share_id; draw(); }
    catch (err) { e.target.checked = !e.target.checked; say('#acNote', friendly(err), true); }
  });

  function show() {
    const inn = !!account.token();
    $('#acOut').hidden = inn; $('#acIn').hidden = !inn;
    if (inn) { const u = account.user(); if (u) { me ||= { user: u, passkeys: [], sessions: [] }; draw(); } load(); }
    else {
      $('#acNew').hidden = true; $('#acNewOpen').hidden = false; $('#acPasskey').hidden = false; $('#acCheck').hidden = true;
      if ($('#acReset').hidden) $('#acLogin').hidden = false;
      google($('#acGoogle'), false);
    }
  }
  addEventListener('tn:account', () => { if (!!account.token() === $('#acOut').hidden) return; show(); });
  $('#acIn').classList.toggle('native-sw', 'switch' in HTMLInputElement.prototype);
  show();
})();

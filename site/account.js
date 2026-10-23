// Account: sign in with a passkey or Google, and, once in, your profile, a public link to your Watchlist, the ways you
// sign in, the devices you're signed in on, sign out and delete. The account itself lives in the Worker (auth.js);
// keeping devices in step is shell.js's (tn.account).
(() => {
  const { esc, account, avatar } = window.tn;
  const $ = (s) => document.querySelector(s);
  // Sign in with Google: the OAuth client ID from Google Cloud (public). Empty: the Google button stays hidden.
  // Sign in with Apple: the Services ID from Apple Developer; Facebook Login: the Meta app ID (both public). Empty: hidden.
  const APPLE_SERVICES_ID = '';
  const FACEBOOK_APP_ID = '';
  const GOOGLE_CLIENT_ID = '573684167951-69isfjep31v7kl8hs0083228flhbq53e.apps.googleusercontent.com';
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  const say = (el, t, bad) => { const n = $(el); n.textContent = t; n.classList.toggle('bad', !!bad); clearTimeout(n.t); if (!bad) n.t = setTimeout(() => (n.textContent = ''), 3500); };
  const passkeys = !!window.PublicKeyCredential;

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
        await account.signedIn(out.token, out.user);
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
    } catch (err) { say('#acMsg', friendly(err), true); }
    b.disabled = false;
  });
  $('#acForgot').addEventListener('click', async () => {
    const email = $('#acEmail').value.trim();
    if (!email) { $('#acEmail').focus(); say('#acMsg', 'Enter your email above, then tap Forgot password again'); return; }
    try { await account.call('POST', '/auth/password/forgot', { email }); say('#acMsg', `If there’s a Tenner account for ${email}, we’ve emailed it a link to choose a new password. Check your inbox (and junk)`); }
    catch (err) { say('#acMsg', friendly(err), true); }
  });
  // arriving from the email's link: account.html#reset=…&e=…
  addEventListener('hashchange', () => { if (/^#reset=/.test(location.hash)) location.reload(); });   // the link opened in a tab already on this page
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

  // Apple: Apple's own sign-in window (their script loads only here, and only once it's set up)
  let aReady = null;
  const appleLib = () => (aReady ||= new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_GB/appleid.auth.js'; sc.onload = () => {
    window.AppleID.auth.init({ clientId: APPLE_SERVICES_ID, scope: 'name email', redirectURI: `${location.origin}/account.html`, usePopup: true }); res(); }; sc.onerror = rej; document.head.append(sc); }));
  async function apple(linking) {
    await appleLib();
    const r = await window.AppleID.auth.signIn();   // { authorization: { id_token }, user?: { name } } (the name only the very first time)
    const out = await account.call('POST', '/auth/apple', { id_token: r.authorization.id_token, name: r.user?.name?.firstName || '' });
    if (out.token) await account.signedIn(out.token, out.user); else if (linking) { say('#acNote', 'Apple linked'); load(); }
  }
  // Facebook: Facebook's own sign-in page, then straight back here with a one-off pass (no Facebook script on Tenner)
  function facebook(linking) {
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem('tenner-fb', JSON.stringify({ state, linking })); } catch {}
    location.href = `https://www.facebook.com/v23.0/dialog/oauth?${new URLSearchParams({ client_id: FACEBOOK_APP_ID, redirect_uri: `${location.origin}/account.html`, response_type: 'token', scope: 'public_profile', state })}`;
  }
  async function facebookBack() {
    const h = new URLSearchParams(location.hash.slice(1)); if (!h.has('access_token') && !h.has('error')) return;
    history.replaceState(null, '', location.pathname);
    let saved = null; try { saved = JSON.parse(sessionStorage.getItem('tenner-fb') || 'null'); sessionStorage.removeItem('tenner-fb'); } catch {}
    if (h.has('error') || !saved || saved.state !== h.get('state')) { say(account.token() ? '#acNote' : '#acMsg', h.has('error') ? 'Cancelled' : 'That didn’t work. Try again', !h.has('error')); return; }
    try {
      const out = await account.call('POST', '/auth/facebook', { token: h.get('access_token') });
      if (out.token) await account.signedIn(out.token, out.user); else { say('#acNote', 'Facebook linked'); load(); }
    } catch (err) { say(account.token() ? '#acNote' : '#acMsg', friendly(err), true); }
  }
  $('#acApple').addEventListener('click', () => apple(false).catch((err) => { if (err?.error !== 'popup_closed_by_user') say('#acMsg', friendly(err), true); }));
  $('#acFb').addEventListener('click', () => facebook(false));

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
      + (me.password ? `<div class="set-row"><span class="set-l">Email and password<small>${esc(me.password)}</small></span><span class="ac-btns"><button type="button" class="ac-x ac-ok" data-pw-open>Change</button><button type="button" class="ac-x" data-pw-remove>Remove</button></span></div>`
        : '<button type="button" class="set-row set-link" data-pw-open><span class="set-l">Add a password<small>Sign in with your email and a password too</small></span><span class="set-chev" aria-hidden="true"></span></button>')
      + `<form class="set-row ac-pwform" id="acPwForm" hidden><input type="email" id="acSetEmail" autocomplete="username" placeholder="Email" aria-label="Email" required value="${esc(me.password || '')}"><input type="password" id="acSetPw" autocomplete="new-password" minlength="8" placeholder="New password" aria-label="New password" required><button class="btn btn-tinted">Save</button></form>`
      + (me.logins || []).map((l) => `<div class="set-row"><span class="set-l">${l.provider === 'apple' ? 'Apple' : 'Facebook'}<small>${esc(l.name || 'Linked')}</small></span><button type="button" class="ac-x" data-unlink-svc="${esc(l.provider)}">Unlink</button></div>`).join('')
      + (APPLE_SERVICES_ID && !(me.logins || []).some((l) => l.provider === 'apple') ? '<button type="button" class="set-row set-link" id="acLinkApple"><span class="set-l">Link Apple</span><span class="set-chev" aria-hidden="true"></span></button>' : '')
      + (FACEBOOK_APP_ID && !(me.logins || []).some((l) => l.provider === 'facebook') ? '<button type="button" class="set-row set-link" id="acLinkFb"><span class="set-l">Link Facebook</span><span class="set-chev" aria-hidden="true"></span></button>' : '')
      + `<button type="button" class="set-row set-link" id="acAddPk"><span class="set-l">Add a passkey<small>For another device, or a password manager</small></span><span class="set-chev" aria-hidden="true"></span></button>`
      + (!u.google && GOOGLE_CLIENT_ID ? '<div class="set-row ac-glink"><span class="set-l">Link Google</span><div id="acGLink"></div></div>' : '');
    if (!u.google && GOOGLE_CLIENT_ID) google($('#acGLink'), true);
    $('#acDevices').innerHTML = me.sessions.map((x) => `<div class="set-row"><span class="set-l"><span>${esc(x.label)}${x.here ? ' <em class="ac-here">This device</em>' : ''}</span><small>Signed in ${esc(when(x.created).toLowerCase())}${x.here ? '' : ` · seen ${esc(when(x.seen).toLowerCase())}`}</small></span></div>`).join('')
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
      else if ('pwOpen' in t.dataset) { $('#acPwForm').hidden = false; $('#acSetEmail').focus(); }
      else if ('pwRemove' in t.dataset) { if (!confirm('Remove your password? You’ll sign in another way.')) return; await account.call('DELETE', '/me/password'); load(); say('#acNote', 'Password removed'); }
      else if (t.dataset.unlinkSvc) { await account.call('DELETE', `/me/${t.dataset.unlinkSvc}`); load(); say('#acNote', 'Unlinked'); }
      else if (t.id === 'acLinkApple') { await apple(true); }
      else if (t.id === 'acLinkFb') { facebook(true); }
      else if ('unlink' in t.dataset) { await account.call('DELETE', '/me/google'); load(); say('#acNote', 'Google unlinked'); }
      else if (t.id === 'acAddPk') { await makePasskey(); load(); say('#acNote', 'Passkey added'); }
      else if (t.id === 'acOthers') { await account.call('DELETE', '/me/sessions'); load(); say('#acNote', 'Signed out everywhere else'); }
      else if (t.id === 'acCopy') { const link = $('#acUrl').textContent; if (navigator.share && window.tn.isIOS) navigator.share({ title: `${me.user.name}’s Watchlist`, url: link }).catch(() => {}); else { await navigator.clipboard.writeText(link); t.textContent = 'Copied'; setTimeout(() => (t.textContent = 'Copy'), 1500); } }
      else if (t.id === 'acOutBtn') { await account.signOut(confirm('Also remove your Watchlist and progress from this device? (They stay in your account.)')); show(); }
      else if (t.id === 'acDelete') {
        if (!confirm('Delete your Tenner account? Your Watchlist, progress and settings are removed from Tenner. What’s on this device stays. This can’t be undone.')) return;
        await account.call('DELETE', '/me'); account.forget(); show(); say('#acMsg', 'Your account has been deleted');
      }
    } catch (err) { say('#acNote', friendly(err), err.name !== 'NotAllowedError'); }
  });
  $('#acIn').addEventListener('submit', async (e) => {
    if (e.target.id !== 'acPwForm') return; e.preventDefault();
    const email = $('#acSetEmail').value.trim(), pw = $('#acSetPw').value;
    if (pw.length < 8) { say('#acNote', 'Use 8 or more characters for your password', true); return; }
    try { await account.call('POST', '/me/password', { email, key: await pwKey(email, pw) }); load(); say('#acNote', 'Password saved'); }
    catch (err) { say('#acNote', friendly(err), true); }
  });
  $('#acShare').addEventListener('change', async (e) => {
    try { const { share_id } = await account.call('POST', '/me/share', { on: e.target.checked }); me.user.share_id = share_id; draw(); }
    catch (err) { e.target.checked = !e.target.checked; say('#acNote', friendly(err), true); }
  });

  function show() {
    const inn = !!account.token();
    $('#acOut').hidden = inn; $('#acIn').hidden = !inn;
    if (inn) { const u = account.user(); if (u) { me ||= { user: u, passkeys: [], sessions: [] }; draw(); } load(); }
    else {
      $('#acNew').hidden = true; $('#acNewOpen').hidden = false; google($('#acGoogle'), false);
      $('#acApple').hidden = !APPLE_SERVICES_ID; $('#acFb').hidden = !FACEBOOK_APP_ID;
      if (APPLE_SERVICES_ID) appleLib().catch(() => {});   // ready before the tap, so its window isn't blocked
      if (APPLE_SERVICES_ID || FACEBOOK_APP_ID) $('#acOr').hidden = false;
    }
  }
  addEventListener('tn:account', () => { if (!!account.token() === $('#acOut').hidden) return; show(); });
  $('#acIn').classList.toggle('native-sw', 'switch' in HTMLInputElement.prototype);
  show();
  facebookBack();
})();

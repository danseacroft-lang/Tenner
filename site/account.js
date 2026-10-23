// Account: sign in with a passkey or Google, and, once in, your profile, a public link to your Watchlist, the ways you
// sign in, the devices you're signed in on, sign out and delete. The account itself lives in the Worker (auth.js);
// keeping devices in step is shell.js's (tn.account).
(() => {
  const { esc, account, avatar } = window.tn;
  const $ = (s) => document.querySelector(s);
  // Sign in with Google: the OAuth client ID from Google Cloud (public). Empty: the Google button stays hidden.
  const GOOGLE_CLIENT_ID = '';
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
    if (!passkeys) { say('#acMsg', 'This browser can’t make passkeys. Try Safari, Chrome or Edge', true); return; }
    const b = e.submitter; b.disabled = true;
    try { await makePasskey($('#acName').value.trim()); } catch (err) { say('#acMsg', friendly(err), err.name !== 'NotAllowedError'); }
    b.disabled = false;
  });

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
      const dark = document.documentElement.dataset.theme !== 'light';
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
  $('#acShare').addEventListener('change', async (e) => {
    try { const { share_id } = await account.call('POST', '/me/share', { on: e.target.checked }); me.user.share_id = share_id; draw(); }
    catch (err) { e.target.checked = !e.target.checked; say('#acNote', friendly(err), true); }
  });

  function show() {
    const inn = !!account.token();
    $('#acOut').hidden = inn; $('#acIn').hidden = !inn;
    if (inn) { const u = account.user(); if (u) { me ||= { user: u, passkeys: [], sessions: [] }; draw(); } load(); }
    else { $('#acNew').hidden = true; $('#acNewOpen').hidden = false; google($('#acGoogle'), false); }
  }
  addEventListener('tn:account', () => { if (!!account.token() === $('#acOut').hidden) return; show(); });
  $('#acIn').classList.toggle('native-sw', 'switch' in HTMLInputElement.prototype);
  show();
})();

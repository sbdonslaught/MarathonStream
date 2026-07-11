'use strict';
/* Twitch integration: OAuth (implicit grant) + EventSub over WebSocket.
   Requires app.js to be loaded first (uses window.MS).

   This file is shared by the browser/SEA version (public/) and the Electron
   app (electronApp test/ui/) - keep both copies identical.
   - In a browser, sign-in navigates this page to Twitch and back.
   - In Electron, sign-in opens the user's default browser (where they are
     already logged in to Twitch); the redirect lands on /auth/callback, which
     hands the token back to the app through the local server.

   The Client ID is resolved in this order:
     1. manual override entered in Options
     2. remote config fetched from CONFIG_URL (see website/SETUP.md)
     3. the last successfully fetched value, cached locally
     4. DEFAULT_CLIENT_ID baked in below (last resort)
   API calls use the client id reported by Twitch's /validate endpoint for the
   active token, so rotating the remote id never breaks existing sessions. */
(function () {
  // Remote config endpoint - a small JSON file on the developer's website:
  //   { "client_id": "...", "message": "", "latest_version": "1.0.0" }
  // Rotating the Twitch app only requires editing that file, no new build.
  const CONFIG_URL = 'https://marathon.onslaught.ca/app/client_id';

  // Last-resort fallback if CONFIG_URL is unreachable and nothing is cached.
  const DEFAULT_CLIENT_ID = '';

  const CFG_CACHE_KEY = 'marathonstream_remote_cfg';

  const AUTH_URL = 'https://id.twitch.tv/oauth2/authorize';
  const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
  const HELIX = 'https://api.twitch.tv/helix';
  const EVENTSUB_WS = 'wss://eventsub.wss.twitch.tv/ws';
  const SCOPES = [
    'moderator:read:followers',
    'channel:read:subscriptions',
    'bits:read',
    'channel:read:redemptions',
    'user:read:chat'
  ].join(' ');

  const IS_ELECTRON = navigator.userAgent.includes('Electron');

  let ws = null;
  let sessionId = null;
  let intentionalClose = false;
  let lastMessageAt = 0;
  let keepaliveSec = 10;
  let reconnecting = false; // true while following a session_reconnect URL

  // ---------- client id resolution ----------
  function userClientId() {
    return (MS.state.settings.clientId || '').trim();
  }

  function looksLikeClientId(v) {
    return typeof v === 'string' && /^[a-z0-9]{20,40}$/.test(v.trim());
  }

  function cachedRemoteId() {
    try {
      const c = JSON.parse(localStorage.getItem(CFG_CACHE_KEY));
      return looksLikeClientId(c && c.client_id) ? c.client_id.trim() : null;
    } catch {
      return null;
    }
  }

  async function fetchRemoteConfig(timeoutMs = 6000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(CONFIG_URL, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) return null;
      const text = await r.text();
      let id;
      try { id = (JSON.parse(text).client_id || '').trim(); }
      catch { id = text.trim(); } // tolerate a bare-text file too
      if (!looksLikeClientId(id)) return null;
      localStorage.setItem(CFG_CACHE_KEY, JSON.stringify({ client_id: id, fetched_at: Date.now() }));
      return id;
    } catch {
      return null; // offline, DNS, CORS, timeout - caller falls back
    } finally {
      clearTimeout(timer);
    }
  }

  // for starting a NEW sign-in
  async function resolveClientId() {
    if (userClientId()) return userClientId();
    const remote = await fetchRemoteConfig();
    return remote || cachedRemoteId() || DEFAULT_CLIENT_ID || null;
  }

  // for API calls with the CURRENT token: must match the app that issued it.
  // /validate tells us that id, so remote rotation never breaks live sessions.
  function apiClientId() {
    return MS.state.auth.clientId || userClientId() || cachedRemoteId() || DEFAULT_CLIENT_ID;
  }

  // ---------- OAuth ----------
  function buildAuthUrl(id, redirectPath) {
    return AUTH_URL +
      '?response_type=token' +
      '&client_id=' + encodeURIComponent(id) +
      '&redirect_uri=' + encodeURIComponent(location.origin + redirectPath) +
      '&scope=' + encodeURIComponent(SCOPES) +
      '&force_verify=true';
  }

  async function startAuth() {
    MS.setTwitchStatus('Getting sign-in configuration...', '');
    const id = await resolveClientId();
    if (!id) {
      MS.setTwitchStatus('Could not fetch the sign-in configuration (is your internet up?). You can paste a Client ID override in the field above and try again.', 'err');
      return;
    }
    if (IS_ELECTRON) {
      // main process turns window.open into "open in default browser"
      window.open(buildAuthUrl(id, '/auth/callback'));
      MS.setTwitchStatus('Waiting for you to authorize in your browser...', '');
      pollForToken();
    } else {
      location.href = buildAuthUrl(id, '/');
    }
  }

  // Electron flow: the external browser hit /auth/callback, which POSTed the
  // token to the local server; pick it up from there.
  let polling = false;
  async function pollForToken() {
    if (polling) return;
    polling = true;
    const deadline = Date.now() + 5 * 60 * 1000;
    try {
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1500));
        if (MS.state.auth.token) return; // signed in some other way
        try {
          const r = await fetch('/auth/poll');
          if (r.ok) {
            const d = await r.json();
            if (d && d.token) {
              MS.state.auth.token = d.token;
              MS.saveNow();
              connect();
              return;
            }
          }
        } catch { /* transient - keep polling */ }
      }
      if (!MS.state.auth.token) MS.setTwitchStatus('Sign-in timed out - click Sign in to try again', 'err');
    } finally {
      polling = false;
    }
  }

  // Browser flow: the token comes back in this page's URL fragment.
  function grabTokenFromRedirect() {
    if (!location.hash || !location.hash.includes('access_token=')) return;
    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get('access_token');
    if (token) {
      MS.state.auth.token = token;
      MS.saveNow();
    }
    history.replaceState(null, '', location.pathname);
  }

  async function validateToken() {
    const r = await fetch(VALIDATE_URL, { headers: { Authorization: 'OAuth ' + MS.state.auth.token } });
    if (!r.ok) throw new Error('Token invalid or expired');
    const d = await r.json();
    MS.state.auth.userId = d.user_id;
    MS.state.auth.login = d.login;
    MS.state.auth.clientId = d.client_id; // the app this token belongs to
    MS.saveNow();
    return d;
  }

  function clearAuth() {
    MS.state.auth = { token: null, userId: null, login: null, clientId: null };
    MS.saveNow();
  }

  // ---------- Helix ----------
  async function helixPost(path, body) {
    const r = await fetch(HELIX + path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + MS.state.auth.token,
        'Client-Id': apiClientId(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (r.status === 401) {
      clearAuth();
      throw new Error('Twitch session expired - sign in again');
    }
    if (!r.ok) {
      let msg = 'HTTP ' + r.status;
      try { msg = (await r.json()).message || msg; } catch { /* keep default */ }
      throw new Error(msg);
    }
    return r.json();
  }

  async function subscribeAll() {
    const b = MS.state.auth.userId;
    const subs = [
      { type: 'channel.follow', version: '2', condition: { broadcaster_user_id: b, moderator_user_id: b } },
      { type: 'channel.subscribe', version: '1', condition: { broadcaster_user_id: b } },
      { type: 'channel.subscription.message', version: '1', condition: { broadcaster_user_id: b } },
      { type: 'channel.cheer', version: '1', condition: { broadcaster_user_id: b } },
      { type: 'channel.channel_points_custom_reward_redemption.add', version: '1', condition: { broadcaster_user_id: b } },
      { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: b, user_id: b } }
    ];
    const failed = [];
    for (const s of subs) {
      try {
        await helixPost('/eventsub/subscriptions', {
          type: s.type,
          version: s.version,
          condition: s.condition,
          transport: { method: 'websocket', session_id: sessionId }
        });
      } catch (e) {
        // "already exists" (409) means this socket session already has it - fine
        if (!String(e.message).toLowerCase().includes('already')) failed.push(s.type + ' (' + e.message + ')');
      }
    }
    if (failed.length) {
      MS.setTwitchStatus('Connected as ' + MS.state.auth.login + ' - some events failed: ' + failed.join(', '), 'err');
    } else {
      MS.setTwitchStatus('Connected as ' + MS.state.auth.login + ' - listening for events', 'ok');
    }
  }

  // ---------- EventSub WebSocket ----------
  function openSocket(url) {
    const sock = new WebSocket(url || EVENTSUB_WS);

    sock.onmessage = (evt) => {
      lastMessageAt = Date.now();
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      const kind = msg.metadata && msg.metadata.message_type;

      if (kind === 'session_welcome') {
        sessionId = msg.payload.session.id;
        keepaliveSec = msg.payload.session.keepalive_timeout_seconds || 10;
        if (reconnecting) {
          // moved to the new socket, old one can go; subscriptions carry over
          reconnecting = false;
          if (ws && ws !== sock) { const old = ws; ws = sock; try { old.close(); } catch { /* already closed */ } }
          MS.setTwitchStatus('Connected as ' + MS.state.auth.login + ' - listening for events', 'ok');
        } else {
          ws = sock;
          subscribeAll();
        }
      } else if (kind === 'notification') {
        MS.onTwitchEvent(msg.metadata.subscription_type, msg.payload.event);
      } else if (kind === 'session_reconnect') {
        reconnecting = true;
        openSocket(msg.payload.session.reconnect_url);
      } else if (kind === 'revocation') {
        MS.setTwitchStatus('Twitch revoked "' + msg.payload.subscription.type + '" - sign in again', 'err');
      }
      // session_keepalive: nothing to do, lastMessageAt already updated
    };

    sock.onclose = () => {
      if (sock !== ws) return; // stale socket from a reconnect handoff
      ws = null;
      sessionId = null;
      if (intentionalClose) return;
      if (MS.state.auth.token) {
        MS.setTwitchStatus('Connection lost - reconnecting in 5s...', 'err');
        setTimeout(() => { if (MS.state.auth.token && !ws) connect(); }, 5000);
      }
    };

    if (!url) ws = sock;
    return sock;
  }

  // watchdog: if Twitch stops sending keepalives, force a reconnect
  setInterval(() => {
    if (ws && lastMessageAt && Date.now() - lastMessageAt > (keepaliveSec + 15) * 1000) {
      try { ws.close(); } catch { /* ignore */ }
    }
  }, 5000);

  // re-validate token hourly (Twitch requires this) and catch expiry early
  setInterval(async () => {
    if (!MS.state.auth.token) return;
    try { await validateToken(); }
    catch {
      clearAuth();
      disconnect();
      MS.setTwitchStatus('Twitch session expired - sign in again', 'err');
    }
  }, 55 * 60 * 1000);

  async function connect() {
    if (!MS.state.auth.token) { startAuth(); return; }
    intentionalClose = false;
    MS.setTwitchStatus('Connecting...', '');
    try {
      await validateToken();
    } catch {
      clearAuth();
      MS.setTwitchStatus('Twitch session expired - sign in again', 'err');
      return;
    }
    lastMessageAt = Date.now();
    openSocket();
  }

  function disconnect() {
    intentionalClose = true;
    if (ws) { try { ws.close(); } catch { /* ignore */ } }
    ws = null;
    sessionId = null;
    MS.setTwitchStatus('Not connected', '');
  }

  // ---------- wiring ----------
  document.getElementById('btn-connect').addEventListener('click', connect);
  document.getElementById('btn-disconnect').addEventListener('click', () => {
    disconnect();
    clearAuth();
  });

  grabTokenFromRedirect();
  if (MS.state.auth.token) connect();
  fetchRemoteConfig(); // warm the cache in the background at startup
})();

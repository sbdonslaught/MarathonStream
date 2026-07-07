'use strict';
/* Twitch integration: OAuth (implicit grant) + EventSub over WebSocket.
   Requires app.js to be loaded first (uses window.MS). */
(function () {
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

  let ws = null;
  let sessionId = null;
  let intentionalClose = false;
  let lastMessageAt = 0;
  let keepaliveSec = 10;
  let reconnecting = false; // true while following a session_reconnect URL

  // ---------- OAuth ----------
  function startAuth() {
    const clientId = MS.state.settings.clientId.trim();
    if (!clientId) {
      alert('Enter your Twitch app Client ID first.\n\nCreate an app at https://dev.twitch.tv/console/apps with OAuth redirect URL:\n' + location.origin + '/');
      return;
    }
    const url = AUTH_URL +
      '?response_type=token' +
      '&client_id=' + encodeURIComponent(clientId) +
      '&redirect_uri=' + encodeURIComponent(location.origin + '/') +
      '&scope=' + encodeURIComponent(SCOPES) +
      '&force_verify=true';
    location.href = url;
  }

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
    MS.saveNow();
    return d;
  }

  function clearAuth() {
    MS.state.auth = { token: null, userId: null, login: null };
    MS.saveNow();
  }

  // ---------- Helix ----------
  async function helixPost(path, body) {
    const r = await fetch(HELIX + path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + MS.state.auth.token,
        'Client-Id': MS.state.settings.clientId.trim(),
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
})();

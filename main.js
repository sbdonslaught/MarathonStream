'use strict';
// MarathonStream - Electron main process.
// Hosts the UI on http://localhost:3117 (Twitch OAuth needs a localhost
// redirect URL) and shows it in a frameless-style desktop window.
const { app, BrowserWindow, shell, nativeTheme } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3117;
const UI = path.join(__dirname, 'ui');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json'
};

let win = null;
let server = null;

// one instance only: launching the exe again focuses the existing window
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    nativeTheme.themeSource = 'dark';
    await startServer();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}

// --- Twitch sign-in handoff -------------------------------------------------
// "Sign in with Twitch" opens the user's default browser. Twitch redirects it
// to /auth/callback below, whose page posts the token to /auth/token; the app
// window picks it up from /auth/poll.
let pendingToken = null;

const CALLBACK_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>MarathonStream sign-in</title>
<style>body{font-family:system-ui,sans-serif;background:#0e0e10;color:#efeff1;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center;max-width:480px}h1{color:#9147ff;letter-spacing:1px}</style>
</head><body><div><h1>MarathonStream</h1><p id="msg">Finishing sign-in...</p></div>
<script>
const hash = new URLSearchParams(location.hash.slice(1));
const query = new URLSearchParams(location.search);
const token = hash.get('access_token');
const msg = document.getElementById('msg');
if (token) {
  fetch('/auth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token }) })
    .then(() => { msg.textContent = 'Signed in! You can close this tab and return to MarathonStream.'; setTimeout(() => window.close(), 1200); })
    .catch(() => { msg.textContent = 'Could not reach MarathonStream - is the app still running?'; });
} else {
  msg.textContent = 'Sign-in was cancelled or failed (' + (query.get('error_description') || query.get('error') || 'no token returned') + '). You can close this tab.';
}
</script></body></html>`;

function handleAuthRoute(urlPath, req, res) {
  if (urlPath === '/auth/callback') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(CALLBACK_HTML);
    return true;
  }
  if (urlPath === '/auth/token' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try { pendingToken = JSON.parse(body).token || null; }
      catch { pendingToken = null; }
      res.writeHead(204); res.end();
      if (pendingToken && win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });
    return true;
  }
  if (urlPath === '/auth/poll') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token: pendingToken }));
    pendingToken = null; // one-shot: handed over exactly once
    return true;
  }
  return false;
}
// -----------------------------------------------------------------------------

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let urlPath;
      try {
        urlPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      } catch {
        res.writeHead(400); return res.end('Bad request');
      }
      if (handleAuthRoute(urlPath, req, res)) return;
      if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
      const filePath = path.normalize(path.join(UI, urlPath));
      if (!filePath.startsWith(UI)) { res.writeHead(404); return res.end('Not found'); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    // port already taken (npm-start server or the SEA exe): reuse it, same UI
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') { server = null; resolve(false); }
      else throw e;
    });
    // 127.0.0.1 only: the sign-in token passes through this server briefly,
    // so it must not be reachable from the network
    server.listen(PORT, '127.0.0.1', () => resolve(true));
  });
}

// remember window size/position between launches
const statePath = () => path.join(app.getPath('userData'), 'window-state.json');
function loadBounds() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); }
  catch { return null; }
}
function saveBounds() {
  try {
    if (win && !win.isMinimized() && !win.isMaximized()) {
      fs.writeFileSync(statePath(), JSON.stringify(win.getBounds()));
    }
  } catch { /* not critical */ }
}

function createWindow() {
  const bounds = loadBounds() || { width: 960, height: 600 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 520,
    minHeight: 340,
    backgroundColor: '#0e0e10',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0e0e10', symbolColor: '#efeff1', height: 34 },
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  // Twitch sign-in navigates inside the window; anything else opens in the
  // user's normal browser
  win.webContents.on('will-navigate', (e, url) => {
    let ok = false;
    try {
      const u = new URL(url);
      ok = u.origin === 'http://localhost:' + PORT ||
           u.hostname === 'twitch.tv' || u.hostname.endsWith('.twitch.tv');
    } catch { /* leave ok=false */ }
    if (!ok) { e.preventDefault(); shell.openExternal(url); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', saveBounds);
  win.loadURL('http://localhost:' + PORT + '/');
}

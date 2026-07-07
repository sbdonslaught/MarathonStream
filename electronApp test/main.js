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

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let urlPath;
      try {
        urlPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      } catch {
        res.writeHead(400); return res.end('Bad request');
      }
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
    server.listen(PORT, () => resolve(true));
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

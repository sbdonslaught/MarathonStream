'use strict';
// MarathonStream - tiny static file server, no dependencies.
// Twitch OAuth requires the app to be served over http://localhost,
// so this hosts the UI at http://localhost:3117
//
// Runs two ways:
//  - `npm start` (plain Node): serves files from ./public
//  - as a single-executable (built by build.js): serves files embedded in the exe
const http = require('http');
const fs = require('fs');
const path = require('path');

// detect single-executable mode (Node SEA)
let sea = null;
try {
  const s = require('node:sea');
  if (s.isSea && s.isSea()) sea = s;
} catch { /* not running as a single executable */ }

const PORT = 3117;
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json'
};

function readAsset(urlPath, cb) {
  if (sea) {
    try { cb(null, Buffer.from(sea.getAsset(urlPath.slice(1)))); }
    catch { cb(new Error('not found')); }
    return;
  }
  const filePath = path.normalize(path.join(PUBLIC, urlPath));
  if (!filePath.startsWith(PUBLIC)) return cb(new Error('not found'));
  fs.readFile(filePath, cb);
}

function openBrowser() {
  // Open as a standalone app window (Edge app mode: no tabs/address bar).
  // A dedicated profile folder keeps the timer's saved data tied to this app
  // instead of the user's everyday browser profile.
  const { exec } = require('child_process');
  const url = 'http://localhost:' + PORT;
  const dataDir = path.join(process.env.LOCALAPPDATA || __dirname, 'MarathonStream');
  exec(`start "" msedge --app=${url} --user-data-dir="${dataDir}" --no-first-run --no-default-browser-check`,
    (err) => { if (err) exec(`start "" ${url}`); }); // no Edge? fall back to default browser
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  } catch {
    res.writeHead(400); return res.end('Bad request');
  }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  readAsset(urlPath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(urlPath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('MarathonStream is already running - opening the browser.');
    if (sea && !process.argv.includes('--no-open')) openBrowser();
    setTimeout(() => process.exit(0), 1500);
  } else {
    throw e;
  }
});

server.listen(PORT, () => {
  console.log(`MarathonStream running at http://localhost:${PORT}`);
  if (sea) {
    console.log('Keep this window open while streaming. Closing it stops the app.');
    if (!process.argv.includes('--no-open')) openBrowser();
  }
});

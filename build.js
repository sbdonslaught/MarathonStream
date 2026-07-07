'use strict';
// Builds dist/MarathonStream.exe using Node's Single Executable Application support.
// Usage: npm run build   (requires internet the first time, to fetch the injector)
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const EXE = path.join(DIST, 'MarathonStream.exe');
const BLOB = path.join(ROOT, 'sea-prep.blob');
const CFG = path.join(ROOT, 'sea-config.json');

// 1. collect every file in public/ as an embedded asset (keys use forward slashes)
function walk(dir, prefix, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), rel, out);
    else out[rel] = 'public/' + rel;
  }
  return out;
}
const assets = walk(path.join(ROOT, 'public'), '', {});
console.log('Embedding assets:', Object.keys(assets).join(', '));

fs.writeFileSync(CFG, JSON.stringify({
  main: 'server.js',
  output: 'sea-prep.blob',
  disableExperimentalSEAWarning: true,
  assets
}, null, 2));

try {
  // 2. generate the SEA blob (script + assets)
  execFileSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], { cwd: ROOT, stdio: 'inherit' });

  // 3. start from a copy of the Node runtime
  fs.mkdirSync(DIST, { recursive: true });
  fs.copyFileSync(process.execPath, EXE);

  // 4. inject the blob into the exe
  execSync(
    `npx --yes postject "${EXE}" NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
    { cwd: ROOT, stdio: 'inherit' }
  );

  console.log('\nDone: ' + EXE);
  console.log('Double-click it to start MarathonStream (it opens your browser automatically).');
} finally {
  fs.rmSync(BLOB, { force: true });
  fs.rmSync(CFG, { force: true });
}

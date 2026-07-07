# MarathonStream — Electron app

The same sub-marathon timer as the main app, packaged as a real desktop application: its own window (no browser, no console window), app icon, taskbar entry, and installer.

## Develop / run from source

Requires [Node.js](https://nodejs.org).

```
cd "electronApp test"
npm install
npm start
```

## Build the distributable

```
npm run dist
```

This produces two things in `dist/`:

- **`MarathonStream Setup 1.0.0.exe`** — one-click installer (installs per-user, no admin needed, creates Start-menu/desktop shortcuts, launches when done). This is the file to give to other people.
- **`MarathonStream 1.0.0.exe`** — portable version, runs directly without installing.

Both are unsigned, so Windows SmartScreen may warn on first launch (*More info → Run anyway*).

## How it differs from the main app

- Opens as a standalone window with a hidden title bar — drag the top edge to move it, double-click the top edge to maximize. Window size/position is remembered.
- No console window at all; closing the window quits the app.
- Launching it a second time focuses the existing window instead of erroring about the port.
- Saved data (timer, settings, Twitch login) lives in Electron's own storage (`%APPDATA%\marathonstream-electron`), separate from the browser and SEA-exe versions.

## Twitch setup

Identical to the main app (see the [main README](../README.md)): register a Twitch app with OAuth redirect URL `http://localhost:3117/`, paste the Client ID in Options, sign in. The app still hosts itself on `http://localhost:3117`, so the same Twitch app registration works for both versions, and you can still add that URL as an OBS browser source while this app is running.

## UI code

`ui/` is a copy of the main app's `public/` folder with a small "ELECTRON APP TWEAKS" CSS block at the bottom of `style.css` and a `#drag-strip` div in `index.html` (the invisible draggable title bar). `app.js` and `twitch.js` are identical — if you change them in one place, copy them to the other.

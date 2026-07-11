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

Clicking **Sign in with Twitch** opens your normal web browser — where you're usually already logged in to Twitch — so signing in is typically a single click on "Authorize". The browser tab then hands the session back to the app and the app window pops back into focus.

For that to work, the Twitch app registration (see the [main README](../README.md)) needs **both** OAuth redirect URLs:

```
http://localhost:3117/
http://localhost:3117/auth/callback
```

The first is used by the browser/SEA version, the second by this Electron app. Same Client ID works for both, and you can still add `http://localhost:3117` as an OBS browser source while this app is running.

### Sharing with others: skip the Twitch dev console entirely

`ui/twitch.js` has a `DEFAULT_CLIENT_ID` constant at the top. Register **one** Twitch app yourself (Client type: **Public**, both redirect URLs above), paste its Client ID into that constant, and rebuild. Anyone using your build can then just click *Sign in with Twitch* — no Client ID field, no dev-console setup. (Public clients have no secret, so shipping the ID is safe and standard practice.)

## UI code

`ui/` is a copy of the main app's `public/` folder with a small "ELECTRON APP TWEAKS" CSS block at the bottom of `style.css` and a `#drag-strip` div in `index.html` (the invisible draggable title bar). `app.js` and `twitch.js` are identical — if you change them in one place, copy them to the other.

# MarathonStream

A Twitch **sub-marathon (subathon) countdown timer**. Viewers extend the timer by following, subbing, cheering bits, typing keywords in chat, or redeeming channel points. Runs entirely on your PC.

## Run it

Requires [Node.js](https://nodejs.org) (no packages to install).

```
cd MarathonStream
npm start
```

Then open **http://localhost:3117** in your browser.

## Build a standalone .exe

Double-click **`build_exe.bat`**, or run:

```
cd MarathonStream
npm run build
```

This creates **`dist/MarathonStream.exe`** — a single file with the whole app baked in. Double-click it to start: it opens as a standalone app window (no tabs or address bar), with its own taskbar entry. Keep the console window open while streaming; closing it stops the app. Double-clicking the exe again while it's already running just reopens the window.

Notes:
- The app window uses Microsoft Edge's app mode under the hood (built into Windows). If Edge is missing, it falls back to your default browser.
- The build needs internet the first time (it fetches a small injection tool). The finished exe works fully offline (except for Twitch itself, of course).
- The exe is unsigned, so Windows SmartScreen may warn on first launch — click *More info → Run anyway*.
- The exe's saved data (timer, settings, login) lives in `%LOCALAPPDATA%\MarathonStream`, so updating or moving the exe never loses your marathon. Note this is separate storage from any browser you used via `npm start`.

## Connect to Twitch (one-time setup)

The app talks to Twitch directly from your browser, so you need your own (free) Twitch app credentials:

1. Go to https://dev.twitch.tv/console/apps and click **Register Your Application**.
2. Name: anything (e.g. `MarathonStream`).
3. **OAuth Redirect URLs**: add both `http://localhost:3117/` (exactly, with the trailing slash) and `http://localhost:3117/auth/callback` (the second one is used by the Electron version).
4. Category: anything (e.g. *Broadcaster Suite*). Client type: **Public**.
5. Copy the **Client ID**.
6. In the app, open **Options** (gear icon, top-right — move the mouse to reveal it), paste the Client ID into the Twitch section, and click **Sign in with Twitch**.
7. Approve the permissions. You'll be sent back to the app, which auto-connects and starts listening for events.

Sign in with the **broadcaster's** Twitch account — the permissions (followers, subs, bits, redemptions, chat) only work on your own channel.

## How it works

- **Timer only** on screen. Move the mouse to reveal the corner buttons: play/pause timer, pause time-additions, Activity, Options.
- **Set the starting time** in Options → Timer (days/hours/minutes/seconds), then press **Start**.
- **Time per action** is configurable in seconds:
  - **Follow** — 7-day per-user cooldown; re-follows within a week are logged but add no time.
  - **Sub** — new subs, resubs, and each gifted sub all add the configured amount.
  - **Bits** — you set seconds per 100 bits; it scales (e.g. 60s per 100 bits → 500 bits = 300s).
  - **Keywords** — any number of chat keywords, each with its own amount. A per-user cooldown (default 60s) stops chat spam; set it to 0 to disable.
  - **Channel point rewards** — any number of reward titles, each with its own amount. The title must match the reward's name on Twitch (case-insensitive).
- **Add time manually** from Options (negative values subtract).
- **Timer at zero**: actions stop adding time, unless you enable *"Allow actions to add time after the timer hits zero"* — then the timer revives when time comes in.
- **Pause timer** (countdown freezes) and **Pause time additions** (events are logged but add nothing) are independent toggles.
- **Activity panel** (☰ icon) lists every action with who did it, what it was, when, and how much time it added.
- **Test buttons** in Options simulate each event type so you can verify your settings without real viewers.

## Saving & resetting

Everything (timer, activity, settings, cooldowns, login) is saved in the browser automatically — closing the app or browser loses nothing. While the app is closed the timer does **not** tick down; it resumes where it left off.

**RESET EVERYTHING** (Options → Danger zone) clears the timer, activity log, and cooldowns. Your settings and Twitch login are kept.

> Saved data lives in the browser's localStorage for `localhost:3117`, so always use the same browser (and don't clear site data mid-marathon).

## OBS

Add `http://localhost:3117` as a **Browser source** to show the timer on stream (the server must be running). Note: OBS's built-in browser is separate from your desktop browser, so run the marathon in your normal browser and use OBS's *interact* option, or capture the browser window instead — otherwise the OBS copy would have its own separate saved state.

## Notes

- The Twitch sign-in token typically lasts for weeks but can expire; the app checks hourly and the status line in Options will tell you if you need to sign in again.
- If the connection drops, the app reconnects automatically.

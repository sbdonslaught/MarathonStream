# MarathonStream

A **Twitch sub-marathon (subathon) timer** for Windows. You set a starting countdown; your viewers extend it by following, subscribing, cheering bits, typing keywords in chat, or redeeming channel points. When the timer hits zero, the marathon is over.

Everything runs locally on your PC — no accounts, no cloud, no data leaves your machine except talking to Twitch itself.

## Download

Grab **`MarathonStream Setup x.x.x.exe`** from the [latest release](https://github.com/sbdonslaught/MarathonStream/releases/latest) and run it. It installs per-user (no admin needed) and launches when done.

> **Windows SmartScreen note:** the exe is unsigned, so Windows may warn on first launch. Click *More info → Run anyway*. A `MarathonStream x.x.x.exe` portable version (no install) is also attached to each release.

## Quick start

1. Launch the app and move your mouse — the corner controls appear.
2. Open **Options** (⚙), click **Sign in with Twitch**. Your browser opens; approve, and the app connects. No setup, no API keys.
3. In Options → Timer, set your starting time and press **Start**.

That's it — follows, subs, bits, keywords, and channel point redemptions now add time.

## Features

- **Timer-only display** in days : hours : minutes : seconds — everything else lives in slide-out panels. Add `http://localhost:3117` as an OBS browser source to put the timer on stream.
- **Configurable time per action**, each set individually:
  - **Follows** — with a built-in 7-day per-user cooldown so nobody can unfollow/refollow to farm time.
  - **Subs** — new subs, resubs, and every gifted sub in a bomb each count.
  - **Bits** — seconds per 100 bits, scaling with the amount cheered.
  - **Chat keywords** — any number of them, each with its own amount and a per-user cooldown to stop spam.
  - **Channel point rewards** — any number, matched by reward title.
- **Manual add-time** button (negative values subtract).
- **Pause the timer** and **pause time additions** independently.
- **Timer at zero** blocks further additions — or revives the marathon if you enable the "allow after zero" option.
- **Activity panel** logging every action: who, what, when, how much time it added (including actions that were blocked and why).
- **Everything auto-saves.** Close the app, reboot, come back — the timer and log are exactly where you left them. Only the **RESET EVERYTHING** button wipes a marathon.
- **Test buttons** to simulate every event type before going live.

## Build from source

Requires [Node.js](https://nodejs.org). Then:

```
git clone https://github.com/sbdonslaught/MarathonStream.git
cd MarathonStream
npm install
npm start        # run in development
npm run dist     # build the installer + portable exe into dist/
```

Or just double-click `build_exe.bat`, which does all of the above.

## How the Twitch connection works

The app talks to Twitch directly from your machine using [EventSub over WebSocket](https://dev.twitch.tv/docs/eventsub/) with a user token obtained via OAuth — sign-in happens in your own browser and the token never leaves your PC. It listens for follows, subs, resubs, gift subs, cheers, chat messages, and channel point redemptions on **your** channel (sign in with the broadcaster account).

The OAuth Client ID is fetched at sign-in from a remote config URL (with a local fallback cache), so it can be rotated without shipping a new build — see [website/SETUP.md](website/SETUP.md) if you're forking this and want to host your own. You can also paste your own Twitch app Client ID into Options → "Client ID override" (register at [dev.twitch.tv](https://dev.twitch.tv/console/apps) with redirect URLs `http://localhost:3117/` and `http://localhost:3117/auth/callback`, client type Public).

## Data & privacy

Timer state, settings, activity log, and your Twitch token are stored locally in the app's own profile (`%APPDATA%\marathonstream`). Nothing is sent anywhere except Twitch's own API. Updating or reinstalling the app keeps your data; **RESET EVERYTHING** in Options clears the marathon but keeps settings and login.

## Contributing

Issues and pull requests welcome! The codebase is deliberately small and framework-free:

- [main.js](main.js) — Electron main process + the little localhost server (OAuth needs a `http://localhost` redirect)
- [ui/app.js](ui/app.js) — timer, persistence, activity log, settings UI
- [ui/twitch.js](ui/twitch.js) — OAuth + EventSub WebSocket client
- [ui/index.html](ui/index.html) / [ui/style.css](ui/style.css) — the interface

## License

[MIT](LICENSE)

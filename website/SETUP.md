# Hosting the Client ID on marathon.onslaught.ca

The app fetches its Twitch Client ID from:

```
https://marathon.onslaught.ca/app/client_id
```

so you can rotate the Twitch app registration by editing one file on your
server — no new build, no user action. This guide is for Ubuntu 22.04 (or
similar) + nginx behind Cloudflare.

## 1. Register the Twitch app (once)

At https://dev.twitch.tv/console/apps (your Twitch account needs 2FA enabled):

- **Name:** MarathonStream (this is what users see on the consent screen)
- **OAuth Redirect URLs** — add both:
  - `http://localhost:3117/`
  - `http://localhost:3117/auth/callback`
- **Category:** Broadcaster Suite (or anything)
- **Client type:** **Public**

Copy the Client ID.

## 2. Put the file on the server

Copy `client_id` (the file next to this guide) to the server, then paste your
real Client ID into it:

```bash
sudo mkdir -p /var/www/marathon/app
sudo cp client_id /var/www/marathon/app/client_id
sudo nano /var/www/marathon/app/client_id   # replace PASTE_YOUR_TWITCH_CLIENT_ID_HERE
```

The file is JSON:

```json
{
  "client_id": "your30characterclientidhere00",
  "message": "",
  "latest_version": "1.0.0"
}
```

(`message` and `latest_version` are reserved for future use — the app ignores
them today, so leaving them as-is is fine.)

## 3. nginx

Add this `location` block to the existing `server` block for
`marathon.onslaught.ca` (usually in `/etc/nginx/sites-available/...`):

```nginx
location = /app/client_id {
    root /var/www/marathon;                              # serves /var/www/marathon/app/client_id
    default_type application/json;
    add_header Access-Control-Allow-Origin "*" always;   # REQUIRED - app runs on http://localhost:3117
    add_header Cache-Control "public, max-age=300" always;
}
```

If you don't have a server block for that subdomain yet, a minimal one
(assuming Cloudflare handles HTTPS in front, "Flexible" mode):

```nginx
server {
    listen 80;
    server_name marathon.onslaught.ca;

    location = /app/client_id {
        root /var/www/marathon;
        default_type application/json;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "public, max-age=300" always;
    }
}
```

(If your Cloudflare SSL mode is "Full", use your usual `listen 443 ssl` setup
with your origin certificate instead.)

Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 4. Cloudflare

- DNS: `marathon` subdomain pointing at the server, proxied (orange cloud) is
  fine.
- Cloudflare respects the `Cache-Control: max-age=300` header, so edits
  propagate within 5 minutes on their own.

## 5. Test it

```bash
curl -i https://marathon.onslaught.ca/app/client_id
```

Check for:

- `HTTP/2 200`
- `access-control-allow-origin: *`  ← the app cannot fetch the file without this
- the JSON body with your real client id

Then in the app: Options → Sign in with Twitch should go straight to the
Twitch consent screen with no Client ID entered.

## Rotating the Client ID later

1. Register a new Twitch app (step 1) — or regenerate nothing, just make the
   new one.
2. Edit `/var/www/marathon/app/client_id` with the new id.
3. Wait up to 5 minutes (or purge the URL in Cloudflare: Caching → Purge →
   Custom purge).

Users who are already signed in are unaffected — the app pairs API calls with
the client id their token was issued under (reported by Twitch's `/validate`
endpoint). New sign-ins pick up the new id automatically. Only delete the OLD
Twitch app once you're happy to force everyone to re-sign-in (their tokens die
with it — the app will just show "sign in again").

## Notes

- The Client ID is public information (it appears in every OAuth URL), so
  serving it openly is safe. Public Twitch apps have no secret.
- The app caches the last fetched id locally, so your site being down only
  affects brand-new users trying to sign in for the first time.
- Keep the Cloudflare/registrar/server accounts secure — whoever controls
  this URL controls which Twitch app your users authorize.

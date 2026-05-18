# Setup guide

## 1. Install

```bash
npm install
npm run build:shared
```

## 2. Google Drive (business owner — one time)

1. Go to <https://console.cloud.google.com/> → create a project.
2. **APIs & Services → Enable APIs**, enable **Google Drive API**.
3. **Credentials → Create credentials → OAuth client ID → Web application**.
   * Authorized redirect URI: `http://localhost:4000/api/auth/google/callback`.
4. Copy the **Client ID** and **Client secret** into `.env`.
5. (Optional) Create a folder in the owner's Drive and copy its ID into
   `GOOGLE_DRIVE_FOLDER_ID` so every recording lands there.
6. Start the backend: `npm run dev:backend`.
7. Visit <http://localhost:4000/api/auth/google/url>, open the returned URL,
   sign in with the business Google account, grant access.
8. The callback page will print a **refresh token** — paste it into `.env`
   as `GOOGLE_REFRESH_TOKEN` and restart the backend.

## 3. SMTP (email)

Easiest path: Gmail app-password.

* Turn on 2FA on the sending Gmail account.
* Create an **App password** (Google Account → Security → App passwords).
* Fill in `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`,
  `SMTP_USER=<your gmail>`, `SMTP_PASS=<app password>`, `MAIL_FROM`.

For higher volume, swap in SendGrid / Mailgun / Postmark — same env vars,
no code change.

## 4. Run

```bash
# Two terminals
npm run dev:backend     # http://localhost:4000
npm run dev:web         # http://localhost:5173
```

Open <http://localhost:5173>, enter 1–3 emails, hit **Record**, then **Stop**.
The recording uploads, the link is emailed, and the file row appears in SQLite.

## 5. Mobile (iPad / Android)

```bash
cd apps/mobile
npm install
npx expo start
```

* iOS: open in **Expo Go** or build a dev client. iPad is supported out of the
  box (`supportsTablet: true`).
* Android: the emulator reaches the host backend via `http://10.0.2.2:4000`
  (already wired in `app.json → expo.extra.backendUrl`). On a real device,
  change it to your machine's LAN IP (e.g. `http://192.168.1.42:4000`).

## 6. Desktop (V2)

```bash
# Terminal 1
npm run dev:web
# Terminal 2
npm run dev:desktop
```

Electron loads the web UI and registers a display-media handler so screen
recording works without a chooser dialog.

## 7. IP cameras

The web client accepts an **HLS (`.m3u8`) or MJPEG URL** directly — most modern
NVRs / cloud cameras expose one. For RTSP-only cameras, run an `ffmpeg` sidecar
that re-streams RTSP → HLS, e.g.:

```bash
ffmpeg -rtsp_transport tcp -i rtsp://user:pass@cam/Streaming/Channels/101 \
  -c copy -f hls -hls_time 2 -hls_list_size 3 ./public/cam.m3u8
```

Then point StudioCam at `http://localhost/cam.m3u8`.

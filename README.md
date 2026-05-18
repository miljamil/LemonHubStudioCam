# StudioCam

Cross-platform recorder for iPad, Android, desktop browsers, Mac, and IP cameras.
Each recording can be saved to the **business owner's Google Drive** (free 15 GB
tier) or to **local storage**. The app emails either a Drive link or the local
video file/link to up to **3 recipients**. Recordings longer than **30 minutes
are automatically split** into multiple files.

> Monorepo: `apps/web` (Vite + React + TS), `apps/mobile` (Expo / React Native),
> `apps/desktop` (Electron, V2), `apps/backend` (Express + TS), `packages/shared`.

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Fill in Google OAuth + SMTP credentials (see docs/setup.md)

# 3. Build shared types
npm run build:shared

# 4. Run backend + web in two terminals
npm run dev:backend
npm run dev:web

# 5. (optional) Run mobile / desktop
npm run dev:mobile        # Expo on iPad / Android
npm run dev:desktop       # Electron (V2)
```

Open the web app, enter 1–3 recipient emails, pick a camera (built-in or IP cam
URL), choose **Local** or **Google Drive** storage in the UI, and press
**Record**. Press **Stop** to upload + email. See [docs/](docs/).

## Features

| Capability                            | V1  | V2  |
| ------------------------------------- | :-: | :-: |
| iPad / mobile browser recording       |  ✅  |  ✅  |
| Local download fallback               |  ✅  |  ✅  |
| Google Drive upload (UI configured)    |  ✅  |  ✅  |
| Local storage fallback                 |  ✅  |  ✅  |
| Email with link or small attachment    |  ✅  |  ✅  |
| 30-minute auto-split                  |  ✅  |  ✅  |
| Desktop (Electron) recording          |     |  ✅  |
| IP camera (RTSP/HLS) ingest           |     |  ✅  |
| Multi-device management dashboard     |     |  ✅  |

## Documentation

* [docs/architecture.md](docs/architecture.md) — system overview
* [docs/setup.md](docs/setup.md) — Google Drive + SMTP setup
* [docs/uml/](docs/uml/) — Mermaid UML diagrams (context, component, sequence, data)

## Why no paid storage?

We do not require paid storage. If Google Drive is configured from the UI, the
backend uploads directly to the owner's Drive and emails the share link. If not,
the backend stores the file locally and emails either the local download link or
a small attachment when the chunk is small enough. The backend only keeps a tiny
SQLite row (`recording_id`, `drive_file_id`, `recipients`, `created_at`) —
typically < 1 KB per recording.

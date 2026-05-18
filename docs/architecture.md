# Architecture

StudioCam is a **thin-client recorder + thin-backend relay**. No video is stored
on our infrastructure — every recording is streamed to the business owner's
**Google Drive** (free 15 GB tier) and emailed as a shareable link.

## High-level

```
┌────────────────┐  HTTPS multipart   ┌────────────────────┐  Drive API   ┌────────────┐
│ Web / Mobile / │ ─────────────────▶ │ Express backend    │ ───────────▶ │ Google     │
│ Desktop client │                    │ (TypeScript)       │              │ Drive      │
│ (MediaRecorder)│ ◀───── JSON ─────  │  + Nodemailer SMTP │ ◀── link ─── │ (business) │
└────────────────┘                    └────────────────────┘              └────────────┘
        │                                      │
        │                                      └─▶ SMTP ─▶ up to 3 recipients
        │
        └─▶ Local download (browser) / Photo library (iOS/Android)
```

## Why this shape

| Goal                                | Decision                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------- |
| No paid storage                     | Backend never persists the video. Drive holds it on the owner's account.  |
| Recover from network blips          | Each chunk is uploaded independently and also saved locally as backup.    |
| ≤ 30-minute files                   | `ChunkedRecorder` rotates the underlying `MediaRecorder` on a timer.      |
| Multi-platform                      | All clients use the same `/api/recordings` endpoint and shared TS types.  |
| Compression                         | Video is already compressed (H.264/VP9). Optional ZIP wrap is available.  |
| Cross-recipient sharing             | Drive permission set to `role=reader, type=anyone` → link works for all 3.|

## Storage / compression strategy

* **Source codecs.** Browsers pick `video/mp4 (h264+aac)` if available, falling
  back to `video/webm (vp9)` or `vp8`. Both are already compressed; wrapping in
  ZIP saves typically < 2 %. ZIP is offered as a toggle for users who want a
  single attachment-friendly file.
* **Chunk size.** 30 min @ 720p ≈ 250–400 MB → fits in Drive upload limit and
  in the 500 MB multer ceiling. Adjust `MAX_CHUNK_SECONDS` to trade size for
  number of emails.
* **Email payload.** We never attach the video. The email contains the Drive
  **link**, so message size is < 5 KB regardless of recording length.

## Components

* **`packages/shared`** — TypeScript types (`CameraSource`, `RecordingChunkMeta`,
  `UploadResult`), validation helpers (`sanitizeRecipients`), constants
  (`MAX_RECIPIENTS = 3`, `DEFAULT_MAX_CHUNK_SECONDS = 1800`).
* **`apps/web`** — Vite + React. `recorder.ts` contains `ChunkedRecorder` which
  rotates the underlying `MediaRecorder` every N seconds. `uploader.ts` POSTs
  each chunk to the backend.
* **`apps/mobile`** — Expo + `expo-camera`. Uses `recordAsync({ maxDuration })`
  in a loop to achieve the same auto-split.
* **`apps/desktop`** — Electron shell that loads the web app and exposes
  `desktopCapturer` so screen recording works in V2.
* **`apps/backend`** — Express + TypeScript:
  * `drive.ts` — Google OAuth (offline refresh token, single-account model),
    Drive uploads, link-permission grant.
  * `mailer.ts` — Nodemailer SMTP wrapper.
  * `db.ts` — SQLite (better-sqlite3). Only stores metadata
    (≈ 1 KB / recording). No SaaS database required.
  * `server.ts` — REST endpoints.

## REST API

| Method | Path                              | Purpose                                                |
| -----: | --------------------------------- | ------------------------------------------------------ |
| GET    | `/api/health`                     | Liveness probe.                                        |
| GET    | `/api/auth/google/url`            | Returns OAuth consent URL (one-time owner setup).      |
| GET    | `/api/auth/google/callback`       | Receives code, prints refresh token to paste in `.env`.|
| POST   | `/api/recordings`                 | Multipart upload of a chunk → Drive → email.           |
| GET    | `/api/recordings`                 | List recent recordings (V2 dashboard).                 |

## Security

* Only the business owner's Drive refresh token lives in `.env`, never in
  clients.
* Recipients are validated and de-duplicated server-side (`sanitizeRecipients`).
* SMTP credentials never reach the client.
* Drive files are shared with link-anyone-can-view; if you need stricter
  sharing, drop the `permissions.create` call in `drive.ts` and email the file
  as an attachment via Nodemailer instead.

## V1 → V2 roadmap

* V1 (this scaffold): iPad/Android/mobile browser + web, local storage, Drive
  upload, email, 30-min split.
* V2 additions: Electron desktop, IP camera ingest (HLS/MJPEG already wired in
  the web client; RTSP would need an `ffmpeg` sidecar), multi-device dashboard
  (the `/api/recordings` listing endpoint is the seed).

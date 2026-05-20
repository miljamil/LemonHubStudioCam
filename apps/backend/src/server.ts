import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { sanitizeRecipients, MAX_RECIPIENTS } from '@studiocam/shared';
import { config } from './config.js';
import { db } from './db.js';
import { uploadToDrive, buildAuthUrl, exchangeCode, fetchAuthenticatedEmail } from './drive.js';
import { sendRecordingMail, testSmtpConnection } from './mailer.js';
import { saveLocally } from './storage.js';
import {
  driveLinked,
  driveOAuthClientReady,
  loadStorageSettings,
  saveStorageSettings,
  smtpIsConfigured,
  type SmtpSettings,
} from './storage-settings.js';

const app = express();
const runtimeRequire = createRequire(__filename);

// Increase timeouts for large uploads on slower connections (e.g., Render free tier)
app.use((req, res, next) => {
  req.socket.setTimeout(5 * 60 * 1000); // 5 minutes for socket
  res.setTimeout(5 * 60 * 1000); // 5 minutes for response
  next();
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(
  '/local-recordings',
  express.static(path.resolve(process.cwd(), config.localStorageDir)),
);

// 500 MB per chunk should comfortably fit a 30-minute 720p capture in webm/mp4.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ----- Watermark post-processing -----
const ffmpegStaticPath = (() => {
  try {
    const mod = runtimeRequire('ffmpeg-static') as string | { default?: string | null } | null;
    if (typeof mod === 'string') return mod;
    return mod?.default ?? null;
  } catch (err) {
    console.warn('[studiocam][postprocess:watermark] ffmpeg-static load failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
})();

const Ffmpeg = (() => {
  try {
    const mod = runtimeRequire('fluent-ffmpeg') as {
      default?: {
        (input?: string): {
          input(inputPath: string): any;
          complexFilter(filters: string | string[]): any;
          outputOptions(options: string[]): any;
          output(outputPath: string): any;
          on(event: 'end', listener: () => void): any;
          on(event: 'error', listener: (err: unknown) => void): any;
          run(): void;
        };
        setFfmpegPath(path: string): void;
      };
      (input?: string): {
        input(inputPath: string): any;
        complexFilter(filters: string | string[]): any;
        outputOptions(options: string[]): any;
        output(outputPath: string): any;
        on(event: 'end', listener: () => void): any;
        on(event: 'error', listener: (err: unknown) => void): any;
        run(): void;
      };
      setFfmpegPath(path: string): void;
    };
    return (mod.default ?? mod) || null;
  } catch (err) {
    console.warn('[studiocam][postprocess:watermark] fluent-ffmpeg load failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
})();

if (Ffmpeg && ffmpegStaticPath) {
  Ffmpeg.setFfmpegPath(ffmpegStaticPath);
  console.info('[studiocam][postprocess:watermark] ffmpeg enabled', {
    ffmpegPath: ffmpegStaticPath,
  });
} else {
  console.warn('[studiocam][postprocess:watermark] ffmpeg module or binary not available; watermark will be skipped.');
}

const WATERMARK_ASSET_PATH = path.resolve(__dirname, '../assets/watermark.png');

/**
 * Composites watermark.png into the bottom-right corner of every video frame.
 * Uses the ffmpeg movie+overlay filter so it works with any container/codec
 * the browser produces (webm VP8/VP9, mp4 H.264, ogg Theora, etc.).
 *
 * The watermark is padded 16 px from the bottom-right edge and scaled to at
 * most 20 % of the video width while preserving its aspect ratio.
 */
async function applyWatermark(buffer: Buffer, mimeType: string, traceId: string): Promise<Buffer> {
  if (!Ffmpeg || !ffmpegStaticPath) {
    console.warn('[studiocam][postprocess:watermark] ffmpeg unavailable, skipping', {
      traceId,
    });
    return buffer;
  }

  console.info('[studiocam][postprocess:watermark] starting', {
    traceId,
    assetPath: WATERMARK_ASSET_PATH,
    assetExists: fs.existsSync(WATERMARK_ASSET_PATH),
    bufferSize: buffer.length,
    mimeType,
  });
  if (!fs.existsSync(WATERMARK_ASSET_PATH)) {
    console.warn('[studiocam][postprocess:watermark] asset not found, skipping', {
      traceId,
      path: WATERMARK_ASSET_PATH,
    });
    return buffer;
  }

  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(8).toString('hex');
  // Guess an extension so ffmpeg can auto-detect the container.
  const inExt = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogv' : 'webm';
  const inPath = path.join(tmpDir, `studiocam-in-${id}.${inExt}`);
  const outPath = path.join(tmpDir, `studiocam-out-${id}.${inExt}`);

  await fs.promises.writeFile(inPath, buffer);

  try {
    await new Promise<void>((resolve, reject) => {
      Ffmpeg(inPath)
        .input(WATERMARK_ASSET_PATH)
        // Overlay watermark at bottom-right with 16px padding.
        // Scale watermark to 15% of main video height, preserving aspect ratio.
        .complexFilter(
          '[1:v][0:v]scale2ref=oh*mdar:ih*0.15[wm][vid];[vid][wm]overlay=W-w-16:H-h-16'
        )
        // Copy audio without re-encoding.
        .outputOptions(['-c:a', 'copy', '-map', '0:a?'])
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err: unknown) => reject(err))
        .run();
    });

    const result = await fs.promises.readFile(outPath);
    console.info('[studiocam][postprocess:watermark] applied', {
      traceId,
      originalBytes: buffer.length,
      processedBytes: result.length,
    });
    return result;
  } catch (err) {
    console.error('[studiocam][postprocess:watermark] ffmpeg failed, returning original', {
      traceId,
      error: (err as Error).message,
    });
    return buffer;
  } finally {
    await Promise.allSettled([
      fs.promises.unlink(inPath),
      fs.promises.unlink(outPath),
    ]);
  }
}

app.get('/api/storage/settings', (_req, res) => {
  const settings = loadStorageSettings();
  res.json({
    storageMode: settings.storageMode,
    google: {
      linkedEmail: settings.google.linkedEmail,
      linked: driveLinked(settings),
    },
    smtpLinked: smtpIsConfigured(settings),
    smtpLinkedEmail: settings.smtp.linkedEmail,
  });
});

app.put('/api/storage/settings', (req, res) => {
  const payload = z.object({
    storageMode: z.enum(['local', 'google-drive']).optional(),
    google: z.object({
      folderId: z.string().optional(),
    }).optional(),
  }).parse(req.body);

  const settings = saveStorageSettings({
    storageMode: payload.storageMode,
    google: payload.google,
  });

  res.json({
    storageMode: settings.storageMode,
    google: {
      linkedEmail: settings.google.linkedEmail,
      folderId: settings.google.folderId,
      linked: driveLinked(settings),
    },
  });
});

// ---------- Google OAuth (one-time setup by business owner) ----------
app.post('/api/auth/google/start', (req, res) => {
  const payload = z.object({
    email: z.string().email(),
  }).parse(req.body);

  try {
    const settings = loadStorageSettings();
    if (!driveOAuthClientReady(settings)) {
      return res.status(409).json({
        error: 'Google OAuth app is not configured on the server. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env once.',
      });
    }

    const state = Buffer.from(
      JSON.stringify({ expectedEmail: payload.email.toLowerCase() }),
      'utf8',
    ).toString('base64url');

    res.json({
      url: buildAuthUrl(settings.google, {
        loginHint: payload.email,
        state,
      }),
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Backward-compatible endpoint used by older UI.
app.get('/api/auth/google/url', (_req, res) => {
  try {
    const settings = loadStorageSettings();
    if (!driveOAuthClientReady(settings)) {
      return res.status(409).json({
        error: 'Google OAuth app is not configured on the server. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env once.',
      });
    }
    res.json({ url: buildAuthUrl(settings.google) });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/auth/google/callback', async (req, res) => {
  const code = String(req.query.code ?? '');
  const stateRaw = String(req.query.state ?? '');
  if (!code) return res.status(400).send('Missing code');
  try {
    const settings = loadStorageSettings();
    const tokens = await exchangeCode(code, settings.google);
    const linkedEmail = await fetchAuthenticatedEmail(tokens, settings.google);

    let expectedEmail: string | null = null;
    if (stateRaw) {
      try {
        const parsed = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8')) as { expectedEmail?: string };
        expectedEmail = parsed.expectedEmail?.toLowerCase() ?? null;
      } catch {
        expectedEmail = null;
      }
    }

    saveStorageSettings({
      google: {
        refreshToken: tokens.refresh_token ?? settings.google.refreshToken,
        linkedEmail: linkedEmail ?? settings.google.linkedEmail,
      },
    });

    const mismatch = expectedEmail && linkedEmail && expectedEmail !== linkedEmail.toLowerCase();
    res.type('html').send(`
      <h2>Google Drive linked ✓</h2>
      <p>The refresh token has been saved. You can now switch the app to Google Drive mode from the UI.</p>
      <p><b>Authenticated account:</b> ${linkedEmail ?? 'unknown'}</p>
      ${mismatch ? `<p style="color:#f97316"><b>Warning:</b> You entered ${expectedEmail} but authenticated as ${linkedEmail}.</p>` : ''}
      <pre style="background:#111;color:#0f0;padding:1em;white-space:pre-wrap;">${tokens.refresh_token ?? '(none — re-run with prompt=consent)'}</pre>
    `);
  } catch (e) {
    res.status(500).send((e as Error).message);
  }
});

// ---------- SMTP / Email settings (UI-driven) ----------
app.get('/api/smtp/settings', (_req, res) => {
  const settings = loadStorageSettings();
  res.json({
    host: settings.smtp.host,
    port: settings.smtp.port,
    secure: settings.smtp.secure,
    user: settings.smtp.user,
    from: settings.smtp.from,
    linkedEmail: settings.smtp.linkedEmail,
    connected: smtpIsConfigured(settings),
    // Never return password to the frontend
  });
});

app.put('/api/smtp/settings', async (req, res) => {
  const parsed = z.object({
    host: z.string().trim().min(1, 'SMTP host is required'),
    port: z.coerce.number().int().min(1).max(65535),
    secure: z.coerce.boolean(),
    user: z.string().trim().min(1, 'Email address is required'),
    pass: z.string().trim().min(1, 'App password is required'),
    from: z.string().trim().optional(),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid SMTP settings payload',
      details: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      connected: false,
    });
  }

  const payload = parsed.data;

  const smtpConfig: Partial<SmtpSettings> = {
    host: payload.host,
    port: payload.port,
    secure: payload.secure,
    user: payload.user,
    pass: payload.pass,
    from: payload.from || `StudioCam <${payload.user}>`,
    linkedEmail: payload.user,
  };

  // Test connection before saving
  const testResult = await testSmtpConnection({
    host: payload.host,
    port: payload.port,
    secure: payload.secure,
    user: payload.user,
    pass: payload.pass,
    from: smtpConfig.from!,
    linkedEmail: payload.user,
  });

  if (!testResult.ok) {
    const smtpHint = payload.host.includes('gmail.com')
      ? 'For Gmail, use a 16-character App Password from Google Account security settings (not your normal password).'
      : payload.host.includes('outlook.com') || payload.host.includes('office365.com')
        ? 'For Outlook/Office365, try host smtp.office365.com, port 587, secure=false, and ensure SMTP AUTH is enabled for the mailbox.'
        : 'Check host, port, SSL/TLS setting, username, and password.';
    return res.status(400).json({
      error: `SMTP connection failed: ${testResult.error}`,
      hint: smtpHint,
      connected: false,
    });
  }

  saveStorageSettings({ smtp: smtpConfig });
  res.json({
    host: payload.host,
    port: payload.port,
    secure: payload.secure,
    user: payload.user,
    from: smtpConfig.from,
    linkedEmail: payload.user,
    connected: true,
  });
});

app.post('/api/smtp/test', async (req, res) => {
  const payload = z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    user: z.string().min(1),
    pass: z.string().min(1),
  }).parse(req.body);

  const result = await testSmtpConnection({
    host: payload.host,
    port: payload.port,
    secure: payload.secure,
    user: payload.user,
    pass: payload.pass,
    from: '',
    linkedEmail: '',
  });

  res.json(result);
});

app.delete('/api/smtp/settings', (_req, res) => {
  saveStorageSettings({
    smtp: { host: '', port: 465, secure: true, user: '', pass: '', from: '', linkedEmail: '' },
  });
  res.json({ connected: false });
});

// ---------- Upload a recording chunk ----------
const metaSchema = z.object({
  sessionId: z.string().min(8),
  chunkIndex: z.coerce.number().int().min(0),
  recipients: z.string().min(3), // JSON-encoded array
  mimeType: z.string().min(3),
  label: z.string().optional(),
  watermark: z.union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')]).optional(),
  qualityPreset: z.enum(['auto', '480p', '720p', '1080p', '4k']).optional(),
});

app.post(
  '/api/recordings',
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    const traceId = crypto.randomUUID();
    try {
      if (!req.file) return res.status(400).json({ error: 'file is required' });
      const meta = metaSchema.parse(req.body);

      console.info('[studiocam][upload:start]', {
        traceId,
        sessionId: meta.sessionId,
        chunkIndex: meta.chunkIndex,
        mimeType: meta.mimeType,
        fileSize: req.file.size,
      });

      let recipientsRaw: unknown;
      try {
        recipientsRaw = JSON.parse(meta.recipients);
      } catch {
        return res.status(400).json({ error: 'recipients must be JSON array' });
      }
      if (!Array.isArray(recipientsRaw)) {
        return res.status(400).json({ error: 'recipients must be an array' });
      }
      const recipients = sanitizeRecipients(recipientsRaw.map(String));
      console.info('[studiocam][upload:recipients]', {
        traceId,
        recipients,
        recipientCount: recipients.length,
      });
      if (recipients.length === 0) {
        return res.status(400).json({ error: 'at least one valid email required' });
      }
      if (recipients.length > MAX_RECIPIENTS) {
        return res.status(400).json({ error: `max ${MAX_RECIPIENTS} recipients` });
      }

      const ext = guessExt(meta.mimeType);
      const filename =
        `${(meta.label ?? 'recording').replace(/[^a-z0-9_-]+/gi, '_')}` +
        `_${meta.sessionId.slice(0, 8)}_p${String(meta.chunkIndex + 1).padStart(2, '0')}.${ext}`;

      const watermarkRequested = meta.watermark === '1' || meta.watermark === 'true';
      console.info('[studiocam][upload:options]', {
        traceId,
        qualityPreset: meta.qualityPreset ?? 'auto',
        watermarkRequested,
      });

      // Post-processing: composite watermark before storage / email.
      let processedBuffer = req.file.buffer;
      if (watermarkRequested) {
        processedBuffer = await applyWatermark(processedBuffer, meta.mimeType, traceId);
      }

      const storageSettings = loadStorageSettings();
      const shouldUseDrive =
        storageSettings.storageMode === 'google-drive' && driveLinked(storageSettings);

      const uploaded = shouldUseDrive
        ? await uploadToDrive(filename, meta.mimeType, processedBuffer, storageSettings.google)
        : await saveLocally(filename, processedBuffer);

      console.info('[studiocam][upload:stored]', {
        traceId,
        storageKind: shouldUseDrive ? 'google-drive' : 'local',
        fileId: uploaded.id,
        viewLink: uploaded.webViewLink,
      });

      const downloadLink =
        uploaded.webContentLink ||
        `https://drive.google.com/uc?export=download&id=${uploaded.id}`;

      const storageKind: 'google-drive' | 'local' = shouldUseDrive ? 'google-drive' : 'local';
      const id = crypto.randomUUID();

      // Persist the recording BEFORE attempting email, so the user can always retry email later.
      db.prepare(
        `INSERT INTO recordings
          (id, session_id, chunk_index, drive_file_id, drive_link, recipients, size_bytes, mime_type,
           filename, download_link, storage_kind, mail_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        meta.sessionId,
        meta.chunkIndex,
        uploaded.id,
        uploaded.webViewLink,
        JSON.stringify(recipients),
        req.file.size,
        meta.mimeType,
        filename,
        downloadLink,
        storageKind,
        smtpIsConfigured() ? 'pending' : 'skipped-smtp',
      );

      let mailStatus: 'sent' | 'failed' | 'skipped-smtp' = 'skipped-smtp';
      let mailError: string | undefined;
      if (smtpIsConfigured()) {
        try {
          await sendRecordingMail({
            to: recipients,
            sessionId: meta.sessionId,
            chunkIndex: meta.chunkIndex,
            filename,
            viewLink: uploaded.webViewLink,
            downloadLink,
            sizeBytes: req.file.size,
            storageLabel: shouldUseDrive ? 'the linked Google Drive' : 'local StudioCam storage',
          });
          mailStatus = 'sent';
          db.prepare(
            `UPDATE recordings SET mail_status='sent', mail_error=NULL, mailed_at=datetime('now') WHERE id=?`,
          ).run(id);
          console.info('[studiocam][upload:emailed]', {
            traceId,
            recipientCount: recipients.length,
            recipients,
          });
        } catch (mailErr) {
          mailStatus = 'failed';
          mailError = mailErr instanceof Error ? mailErr.message : String(mailErr);
          db.prepare(`UPDATE recordings SET mail_status='failed', mail_error=? WHERE id=?`)
            .run(mailError, id);
          console.error('[studiocam][upload:email-failed]', { traceId, error: mailError });
          // Do NOT throw — the upload itself succeeded, the user can retry email later.
        }
      } else {
        console.warn('[studiocam][upload:email-skipped]', {
          traceId,
          reason: 'SMTP not configured',
        });
      }

      res.json({
        recordingId: id,
        driveFileId: uploaded.id,
        driveWebViewLink: uploaded.webViewLink,
        driveDownloadLink: downloadLink,
        filename,
        recipients,
        emailedTo: mailStatus === 'sent' ? recipients : [],
        storageKind,
        mailStatus,
        mailError,
        traceId,
      });
    } catch (e) {
      console.error('[studiocam][upload:error]', {
        traceId,
        error: e instanceof Error ? e.message : String(e),
      });
      next(e);
    }
  },
);

// ---------- Resend email for an existing recording (no re-upload) ----------
app.post('/api/recordings/:id/resend-email', async (req, res, next) => {
  const traceId = crypto.randomUUID();
  const id = req.params.id;
  try {
    const stmt = db.prepare(`SELECT * FROM recordings WHERE id = ?`) as unknown as {
      get: (id: string) => {
        id: string;
        session_id: string;
        chunk_index: number;
        drive_link: string;
        download_link: string | null;
        recipients: string;
        size_bytes: number;
        filename: string | null;
        storage_kind: string | null;
        mime_type: string;
      } | undefined;
    };
    const row = stmt.get(id);
    if (!row) return res.status(404).json({ error: 'recording not found' });
    if (!smtpIsConfigured()) {
      return res.status(409).json({ error: 'SMTP not configured. Connect email first.' });
    }

    // Allow caller to override recipients (e.g., add/remove addresses on retry).
    const overrideRecipients = Array.isArray(req.body?.recipients)
      ? sanitizeRecipients(req.body.recipients.map(String))
      : null;
    const recipients = overrideRecipients && overrideRecipients.length > 0
      ? overrideRecipients
      : (JSON.parse(row.recipients) as string[]);
    if (recipients.length === 0) return res.status(400).json({ error: 'no valid recipients' });
    if (recipients.length > MAX_RECIPIENTS) return res.status(400).json({ error: `max ${MAX_RECIPIENTS} recipients` });

    try {
      await sendRecordingMail({
        to: recipients,
        sessionId: row.session_id,
        chunkIndex: row.chunk_index,
        filename: row.filename ?? `recording_${row.chunk_index + 1}`,
        viewLink: row.drive_link,
        downloadLink: row.download_link ?? row.drive_link,
        sizeBytes: row.size_bytes,
        storageLabel: row.storage_kind === 'google-drive' ? 'the linked Google Drive' : 'local StudioCam storage',
      });
      db.prepare(
        `UPDATE recordings SET mail_status='sent', mail_error=NULL, mailed_at=datetime('now'), recipients=? WHERE id=?`,
      ).run(JSON.stringify(recipients), id);
      console.info('[studiocam][resend:ok]', { traceId, id, recipientCount: recipients.length });
      res.json({ mailStatus: 'sent', recipients, traceId });
    } catch (mailErr) {
      const message = mailErr instanceof Error ? mailErr.message : String(mailErr);
      db.prepare(`UPDATE recordings SET mail_status='failed', mail_error=? WHERE id=?`)
        .run(message, id);
      console.error('[studiocam][resend:failed]', { traceId, id, error: message });
      res.status(502).json({ mailStatus: 'failed', error: message, traceId });
    }
  } catch (e) {
    next(e);
  }
});

// ---------- Delete a recording (and local file when applicable) ----------
app.delete('/api/recordings/:id', async (req, res, next) => {
  const traceId = crypto.randomUUID();
  const id = req.params.id;
  try {
    const stmt = db.prepare(
      `SELECT id, drive_file_id, storage_kind FROM recordings WHERE id = ?`,
    ) as unknown as {
      get: (id: string) => {
        id: string;
        drive_file_id: string;
        storage_kind: 'local' | 'google-drive' | null;
      } | undefined;
    };
    const row = stmt.get(id);
    if (!row) return res.status(404).json({ error: 'recording not found' });

    let fileDeleted = false;
    let note: string | undefined;

    if ((row.storage_kind ?? 'local') === 'local') {
      const localDir = path.resolve(process.cwd(), config.localStorageDir);
      const candidatePath = path.resolve(localDir, row.drive_file_id);
      const inLocalDir = candidatePath === localDir || candidatePath.startsWith(`${localDir}${path.sep}`);
      if (!inLocalDir) {
        return res.status(400).json({ error: 'invalid file path for local recording' });
      }

      try {
        await fs.promises.unlink(candidatePath);
        fileDeleted = true;
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
          // File already missing is fine; continue to clean DB row.
          note = 'File was already missing from disk; database entry removed.';
        } else {
          throw e;
        }
      }
    } else {
      // Google Drive delete is not implemented yet in this endpoint.
      note = 'Database entry removed; cloud file deletion is not implemented for this storage type.';
    }

    db.prepare(`DELETE FROM recordings WHERE id = ?`).run(id);
    console.info('[studiocam][recording:delete]', {
      traceId,
      id,
      storageKind: row.storage_kind ?? 'local',
      fileDeleted,
      note,
    });
    res.json({
      ok: true,
      traceId,
      deletedId: id,
      storageKind: row.storage_kind ?? 'local',
      fileDeleted,
      note,
    });
  } catch (e) {
    next(e);
  }
});

// ---------- List recent recordings (for a future multi-device dashboard) ----------
app.get('/api/recordings', (req, res) => {
  const sessionId = req.query.sessionId ? String(req.query.sessionId) : null;
  const rows = sessionId
    ? db
        .prepare(
          `SELECT * FROM recordings WHERE session_id = ? ORDER BY chunk_index ASC`,
        )
        .all(sessionId)
    : db.prepare(`SELECT * FROM recordings ORDER BY created_at DESC LIMIT 50`).all();
  res.json(rows);
});

// ---------- Error handler ----------
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error('[backend] error:', err);
  const msg = err instanceof Error ? err.message : 'Internal error';
  res.status(500).json({ error: msg });
});

function guessExt(mime: string): string {
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('zip')) return 'zip';
  return 'bin';
}

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[studiocam-backend] listening on :${config.port}`);
});

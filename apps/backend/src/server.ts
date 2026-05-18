import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
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
      const storageSettings = loadStorageSettings();
      const shouldUseDrive =
        storageSettings.storageMode === 'google-drive' && driveLinked(storageSettings);

      const uploaded = shouldUseDrive
        ? await uploadToDrive(filename, meta.mimeType, req.file.buffer, storageSettings.google)
        : await saveLocally(filename, req.file.buffer);

      console.info('[studiocam][upload:stored]', {
        traceId,
        storageKind: shouldUseDrive ? 'google-drive' : 'local',
        fileId: uploaded.id,
        viewLink: uploaded.webViewLink,
      });

      const downloadLink =
        uploaded.webContentLink ||
        `https://drive.google.com/uc?export=download&id=${uploaded.id}`;

      let mailStatus: 'sent' | 'skipped-smtp' = 'skipped-smtp';
      if (smtpIsConfigured()) {
        const localAttachment = !shouldUseDrive && req.file.size <= 20 * 1024 * 1024
          ? {
              filename,
              content: req.file.buffer,
              contentType: meta.mimeType,
            }
          : undefined;
        await sendRecordingMail({
          to: recipients,
          sessionId: meta.sessionId,
          chunkIndex: meta.chunkIndex,
          filename,
          viewLink: uploaded.webViewLink,
          downloadLink,
          sizeBytes: req.file.size,
          storageLabel: shouldUseDrive ? 'the linked Google Drive' : 'local StudioCam storage',
          attachment: localAttachment,
        });
        mailStatus = 'sent';
        console.info('[studiocam][upload:emailed]', {
          traceId,
          recipientCount: recipients.length,
          recipients,
        });
      } else {
        console.warn('[studiocam][upload:email-skipped]', {
          traceId,
          reason: 'SMTP not configured',
        });
      }

      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO recordings
          (id, session_id, chunk_index, drive_file_id, drive_link, recipients, size_bytes, mime_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        meta.sessionId,
        meta.chunkIndex,
        uploaded.id,
        uploaded.webViewLink,
        JSON.stringify(recipients),
        req.file.size,
        meta.mimeType,
      );

      res.json({
        driveFileId: uploaded.id,
        driveWebViewLink: uploaded.webViewLink,
        driveDownloadLink: downloadLink,
        emailedTo: smtpIsConfigured() ? recipients : [],
        storageKind: shouldUseDrive ? 'google-drive' : 'local',
        mailStatus,
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

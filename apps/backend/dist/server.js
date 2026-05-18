"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const multer_1 = __importDefault(require("multer"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_path_1 = __importDefault(require("node:path"));
const zod_1 = require("zod");
const shared_1 = require("@studiocam/shared");
const config_js_1 = require("./config.js");
const db_js_1 = require("./db.js");
const drive_js_1 = require("./drive.js");
const mailer_js_1 = require("./mailer.js");
const storage_js_1 = require("./storage.js");
const storage_settings_js_1 = require("./storage-settings.js");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '1mb' }));
app.use('/local-recordings', express_1.default.static(node_path_1.default.resolve(process.cwd(), config_js_1.config.localStorageDir)));
// 500 MB per chunk should comfortably fit a 30-minute 720p capture in webm/mp4.
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 },
});
app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});
app.get('/api/storage/settings', (_req, res) => {
    const settings = (0, storage_settings_js_1.loadStorageSettings)();
    res.json({
        storageMode: settings.storageMode,
        google: {
            linkedEmail: settings.google.linkedEmail,
            linked: (0, storage_settings_js_1.driveLinked)(settings),
        },
        smtpLinked: (0, storage_settings_js_1.smtpIsConfigured)(settings),
        smtpLinkedEmail: settings.smtp.linkedEmail,
    });
});
app.put('/api/storage/settings', (req, res) => {
    const payload = zod_1.z.object({
        storageMode: zod_1.z.enum(['local', 'google-drive']).optional(),
        google: zod_1.z.object({
            folderId: zod_1.z.string().optional(),
        }).optional(),
    }).parse(req.body);
    const settings = (0, storage_settings_js_1.saveStorageSettings)({
        storageMode: payload.storageMode,
        google: payload.google,
    });
    res.json({
        storageMode: settings.storageMode,
        google: {
            linkedEmail: settings.google.linkedEmail,
            folderId: settings.google.folderId,
            linked: (0, storage_settings_js_1.driveLinked)(settings),
        },
    });
});
// ---------- Google OAuth (one-time setup by business owner) ----------
app.post('/api/auth/google/start', (req, res) => {
    const payload = zod_1.z.object({
        email: zod_1.z.string().email(),
    }).parse(req.body);
    try {
        const settings = (0, storage_settings_js_1.loadStorageSettings)();
        if (!(0, storage_settings_js_1.driveOAuthClientReady)(settings)) {
            return res.status(409).json({
                error: 'Google OAuth app is not configured on the server. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env once.',
            });
        }
        const state = Buffer.from(JSON.stringify({ expectedEmail: payload.email.toLowerCase() }), 'utf8').toString('base64url');
        res.json({
            url: (0, drive_js_1.buildAuthUrl)(settings.google, {
                loginHint: payload.email,
                state,
            }),
        });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// Backward-compatible endpoint used by older UI.
app.get('/api/auth/google/url', (_req, res) => {
    try {
        const settings = (0, storage_settings_js_1.loadStorageSettings)();
        if (!(0, storage_settings_js_1.driveOAuthClientReady)(settings)) {
            return res.status(409).json({
                error: 'Google OAuth app is not configured on the server. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env once.',
            });
        }
        res.json({ url: (0, drive_js_1.buildAuthUrl)(settings.google) });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.get('/api/auth/google/callback', async (req, res) => {
    const code = String(req.query.code ?? '');
    const stateRaw = String(req.query.state ?? '');
    if (!code)
        return res.status(400).send('Missing code');
    try {
        const settings = (0, storage_settings_js_1.loadStorageSettings)();
        const tokens = await (0, drive_js_1.exchangeCode)(code, settings.google);
        const linkedEmail = await (0, drive_js_1.fetchAuthenticatedEmail)(tokens, settings.google);
        let expectedEmail = null;
        if (stateRaw) {
            try {
                const parsed = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'));
                expectedEmail = parsed.expectedEmail?.toLowerCase() ?? null;
            }
            catch {
                expectedEmail = null;
            }
        }
        (0, storage_settings_js_1.saveStorageSettings)({
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
    }
    catch (e) {
        res.status(500).send(e.message);
    }
});
// ---------- SMTP / Email settings (UI-driven) ----------
app.get('/api/smtp/settings', (_req, res) => {
    const settings = (0, storage_settings_js_1.loadStorageSettings)();
    res.json({
        host: settings.smtp.host,
        port: settings.smtp.port,
        secure: settings.smtp.secure,
        user: settings.smtp.user,
        from: settings.smtp.from,
        linkedEmail: settings.smtp.linkedEmail,
        connected: (0, storage_settings_js_1.smtpIsConfigured)(settings),
        // Never return password to the frontend
    });
});
app.put('/api/smtp/settings', async (req, res) => {
    const parsed = zod_1.z.object({
        host: zod_1.z.string().trim().min(1, 'SMTP host is required'),
        port: zod_1.z.coerce.number().int().min(1).max(65535),
        secure: zod_1.z.coerce.boolean(),
        user: zod_1.z.string().trim().min(1, 'Email address is required'),
        pass: zod_1.z.string().trim().min(1, 'App password is required'),
        from: zod_1.z.string().trim().optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            error: 'Invalid SMTP settings payload',
            details: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
            connected: false,
        });
    }
    const payload = parsed.data;
    const smtpConfig = {
        host: payload.host,
        port: payload.port,
        secure: payload.secure,
        user: payload.user,
        pass: payload.pass,
        from: payload.from || `StudioCam <${payload.user}>`,
        linkedEmail: payload.user,
    };
    // Test connection before saving
    const testResult = await (0, mailer_js_1.testSmtpConnection)({
        host: payload.host,
        port: payload.port,
        secure: payload.secure,
        user: payload.user,
        pass: payload.pass,
        from: smtpConfig.from,
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
    (0, storage_settings_js_1.saveStorageSettings)({ smtp: smtpConfig });
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
    const payload = zod_1.z.object({
        host: zod_1.z.string().min(1),
        port: zod_1.z.number().int().min(1).max(65535),
        secure: zod_1.z.boolean(),
        user: zod_1.z.string().min(1),
        pass: zod_1.z.string().min(1),
    }).parse(req.body);
    const result = await (0, mailer_js_1.testSmtpConnection)({
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
    (0, storage_settings_js_1.saveStorageSettings)({
        smtp: { host: '', port: 465, secure: true, user: '', pass: '', from: '', linkedEmail: '' },
    });
    res.json({ connected: false });
});
// ---------- Upload a recording chunk ----------
const metaSchema = zod_1.z.object({
    sessionId: zod_1.z.string().min(8),
    chunkIndex: zod_1.z.coerce.number().int().min(0),
    recipients: zod_1.z.string().min(3), // JSON-encoded array
    mimeType: zod_1.z.string().min(3),
    label: zod_1.z.string().optional(),
});
app.post('/api/recordings', upload.single('file'), async (req, res, next) => {
    const traceId = node_crypto_1.default.randomUUID();
    try {
        if (!req.file)
            return res.status(400).json({ error: 'file is required' });
        const meta = metaSchema.parse(req.body);
        console.info('[studiocam][upload:start]', {
            traceId,
            sessionId: meta.sessionId,
            chunkIndex: meta.chunkIndex,
            mimeType: meta.mimeType,
            fileSize: req.file.size,
        });
        let recipientsRaw;
        try {
            recipientsRaw = JSON.parse(meta.recipients);
        }
        catch {
            return res.status(400).json({ error: 'recipients must be JSON array' });
        }
        if (!Array.isArray(recipientsRaw)) {
            return res.status(400).json({ error: 'recipients must be an array' });
        }
        const recipients = (0, shared_1.sanitizeRecipients)(recipientsRaw.map(String));
        console.info('[studiocam][upload:recipients]', {
            traceId,
            recipients,
            recipientCount: recipients.length,
        });
        if (recipients.length === 0) {
            return res.status(400).json({ error: 'at least one valid email required' });
        }
        if (recipients.length > shared_1.MAX_RECIPIENTS) {
            return res.status(400).json({ error: `max ${shared_1.MAX_RECIPIENTS} recipients` });
        }
        const ext = guessExt(meta.mimeType);
        const filename = `${(meta.label ?? 'recording').replace(/[^a-z0-9_-]+/gi, '_')}` +
            `_${meta.sessionId.slice(0, 8)}_p${String(meta.chunkIndex + 1).padStart(2, '0')}.${ext}`;
        const storageSettings = (0, storage_settings_js_1.loadStorageSettings)();
        const shouldUseDrive = storageSettings.storageMode === 'google-drive' && (0, storage_settings_js_1.driveLinked)(storageSettings);
        const uploaded = shouldUseDrive
            ? await (0, drive_js_1.uploadToDrive)(filename, meta.mimeType, req.file.buffer, storageSettings.google)
            : await (0, storage_js_1.saveLocally)(filename, req.file.buffer);
        console.info('[studiocam][upload:stored]', {
            traceId,
            storageKind: shouldUseDrive ? 'google-drive' : 'local',
            fileId: uploaded.id,
            viewLink: uploaded.webViewLink,
        });
        const downloadLink = uploaded.webContentLink ||
            `https://drive.google.com/uc?export=download&id=${uploaded.id}`;
        let mailStatus = 'skipped-smtp';
        if ((0, storage_settings_js_1.smtpIsConfigured)()) {
            const localAttachment = !shouldUseDrive && req.file.size <= 20 * 1024 * 1024
                ? {
                    filename,
                    content: req.file.buffer,
                    contentType: meta.mimeType,
                }
                : undefined;
            await (0, mailer_js_1.sendRecordingMail)({
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
        }
        else {
            console.warn('[studiocam][upload:email-skipped]', {
                traceId,
                reason: 'SMTP not configured',
            });
        }
        const id = node_crypto_1.default.randomUUID();
        db_js_1.db.prepare(`INSERT INTO recordings
          (id, session_id, chunk_index, drive_file_id, drive_link, recipients, size_bytes, mime_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, meta.sessionId, meta.chunkIndex, uploaded.id, uploaded.webViewLink, JSON.stringify(recipients), req.file.size, meta.mimeType);
        res.json({
            driveFileId: uploaded.id,
            driveWebViewLink: uploaded.webViewLink,
            driveDownloadLink: downloadLink,
            emailedTo: (0, storage_settings_js_1.smtpIsConfigured)() ? recipients : [],
            storageKind: shouldUseDrive ? 'google-drive' : 'local',
            mailStatus,
            traceId,
        });
    }
    catch (e) {
        console.error('[studiocam][upload:error]', {
            traceId,
            error: e instanceof Error ? e.message : String(e),
        });
        next(e);
    }
});
// ---------- List recent recordings (for a future multi-device dashboard) ----------
app.get('/api/recordings', (req, res) => {
    const sessionId = req.query.sessionId ? String(req.query.sessionId) : null;
    const rows = sessionId
        ? db_js_1.db
            .prepare(`SELECT * FROM recordings WHERE session_id = ? ORDER BY chunk_index ASC`)
            .all(sessionId)
        : db_js_1.db.prepare(`SELECT * FROM recordings ORDER BY created_at DESC LIMIT 50`).all();
    res.json(rows);
});
// ---------- Error handler ----------
app.use((err, _req, res, _next) => {
    // eslint-disable-next-line no-console
    console.error('[backend] error:', err);
    const msg = err instanceof Error ? err.message : 'Internal error';
    res.status(500).json({ error: msg });
});
function guessExt(mime) {
    if (mime.includes('mp4'))
        return 'mp4';
    if (mime.includes('webm'))
        return 'webm';
    if (mime.includes('zip'))
        return 'zip';
    return 'bin';
}
app.listen(config_js_1.config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[studiocam-backend] listening on :${config_js_1.config.port}`);
});
//# sourceMappingURL=server.js.map
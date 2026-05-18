"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.hasDriveConfigured = hasDriveConfigured;
exports.hasSmtpConfigured = hasSmtpConfigured;
exports.assertDriveConfigured = assertDriveConfigured;
exports.assertSmtpConfigured = assertSmtpConfigured;
require("dotenv/config");
function req(name, fallback) {
    const v = process.env[name] ?? fallback;
    if (v === undefined || v === '') {
        throw new Error(`Missing required env var: ${name}`);
    }
    return v;
}
exports.config = {
    port: Number(process.env.PORT ?? 4000),
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:4000',
    maxChunkSeconds: Number(process.env.MAX_CHUNK_SECONDS ?? 1800),
    localStorageDir: process.env.LOCAL_STORAGE_DIR ?? 'recordings',
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        redirectUri: process.env.GOOGLE_REDIRECT_URI ??
            'http://localhost:4000/api/auth/google/callback',
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN ?? '',
        folderId: process.env.GOOGLE_DRIVE_FOLDER_ID ?? '',
    },
    smtp: {
        host: process.env.SMTP_HOST ?? '',
        port: Number(process.env.SMTP_PORT ?? 465),
        secure: (process.env.SMTP_SECURE ?? 'true') === 'true',
        user: process.env.SMTP_USER ?? '',
        pass: process.env.SMTP_PASS ?? '',
        from: process.env.MAIL_FROM ?? 'StudioCam <no-reply@studiocam.local>',
    },
};
function hasDriveConfigured() {
    return Boolean(exports.config.google.clientId &&
        exports.config.google.clientSecret &&
        exports.config.google.refreshToken);
}
function hasSmtpConfigured() {
    return Boolean(exports.config.smtp.host && exports.config.smtp.user && exports.config.smtp.pass);
}
/** Throws if Drive credentials are not configured. Call from Drive routes only. */
function assertDriveConfigured() {
    req('GOOGLE_CLIENT_ID');
    req('GOOGLE_CLIENT_SECRET');
    req('GOOGLE_REFRESH_TOKEN');
}
/** Throws if SMTP is not configured. Call from mail routes only. */
function assertSmtpConfigured() {
    req('SMTP_HOST');
    req('SMTP_USER');
    req('SMTP_PASS');
}
//# sourceMappingURL=config.js.map
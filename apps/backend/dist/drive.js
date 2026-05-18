"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAuthUrl = buildAuthUrl;
exports.exchangeCode = exchangeCode;
exports.fetchAuthenticatedEmail = fetchAuthenticatedEmail;
exports.uploadToDrive = uploadToDrive;
const googleapis_1 = require("googleapis");
const node_stream_1 = require("node:stream");
const config_js_1 = require("./config.js");
const storage_settings_js_1 = require("./storage-settings.js");
function resolveGoogleSettings(override) {
    const current = (0, storage_settings_js_1.loadStorageSettings)();
    return {
        clientId: override?.clientId ?? current.google.clientId,
        clientSecret: override?.clientSecret ?? current.google.clientSecret,
        redirectUri: override?.redirectUri ?? current.google.redirectUri,
        folderId: override?.folderId ?? current.google.folderId,
        refreshToken: override?.refreshToken ?? current.google.refreshToken,
    };
}
function oauthClient(settings) {
    (0, config_js_1.assertDriveConfigured)();
    const googleSettings = resolveGoogleSettings(settings);
    const client = new googleapis_1.google.auth.OAuth2(googleSettings.clientId, googleSettings.clientSecret, googleSettings.redirectUri);
    client.setCredentials({ refresh_token: googleSettings.refreshToken });
    return client;
}
/** Build an OAuth consent URL so the business owner can grant Drive access once. */
function buildAuthUrl(settings, options) {
    const googleSettings = resolveGoogleSettings(settings);
    const client = new googleapis_1.google.auth.OAuth2(googleSettings.clientId, googleSettings.clientSecret, googleSettings.redirectUri);
    return client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/drive.file'],
        login_hint: options?.loginHint,
        state: options?.state,
    });
}
/** Exchange an OAuth code for a refresh token (one-time, for setup). */
async function exchangeCode(code, settings) {
    const googleSettings = resolveGoogleSettings(settings);
    const client = new googleapis_1.google.auth.OAuth2(googleSettings.clientId, googleSettings.clientSecret, googleSettings.redirectUri);
    const { tokens } = await client.getToken(code);
    return tokens;
}
async function fetchAuthenticatedEmail(tokens, settings) {
    const googleSettings = resolveGoogleSettings(settings);
    const client = new googleapis_1.google.auth.OAuth2(googleSettings.clientId, googleSettings.clientSecret, googleSettings.redirectUri);
    client.setCredentials({
        access_token: tokens.access_token ?? undefined,
        refresh_token: tokens.refresh_token ?? undefined,
    });
    const oauth2 = googleapis_1.google.oauth2({ version: 'v2', auth: client });
    const me = await oauth2.userinfo.get();
    return me.data.email ?? null;
}
/** Upload a buffer to Drive and make it readable by link. */
async function uploadToDrive(filename, mimeType, buffer, settings) {
    const auth = oauthClient(settings);
    const drive = googleapis_1.google.drive({ version: 'v3', auth });
    const resolved = resolveGoogleSettings(settings);
    const create = await drive.files.create({
        requestBody: {
            name: filename,
            parents: resolved.folderId ? [resolved.folderId] : undefined,
            mimeType,
        },
        media: {
            mimeType,
            body: node_stream_1.Readable.from(buffer),
        },
        fields: 'id, webViewLink, webContentLink',
    });
    const fileId = create.data.id;
    // Make file accessible to anyone with the link (read-only).
    await drive.permissions.create({
        fileId,
        requestBody: { role: 'reader', type: 'anyone' },
    });
    const meta = await drive.files.get({
        fileId,
        fields: 'id, webViewLink, webContentLink',
    });
    return {
        id: meta.data.id,
        webViewLink: meta.data.webViewLink ?? '',
        webContentLink: meta.data.webContentLink ?? '',
    };
}
//# sourceMappingURL=drive.js.map
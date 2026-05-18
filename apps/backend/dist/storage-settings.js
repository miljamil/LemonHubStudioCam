"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadStorageSettings = loadStorageSettings;
exports.saveStorageSettings = saveStorageSettings;
exports.driveIsConfigured = driveIsConfigured;
exports.driveOAuthClientReady = driveOAuthClientReady;
exports.driveLinked = driveLinked;
exports.smtpIsConfigured = smtpIsConfigured;
const config_js_1 = require("./config.js");
const db_js_1 = require("./db.js");
const DEFAULT_SETTINGS = {
    storageMode: 'local',
    google: {
        clientId: config_js_1.config.google.clientId,
        clientSecret: config_js_1.config.google.clientSecret,
        redirectUri: config_js_1.config.google.redirectUri,
        folderId: config_js_1.config.google.folderId,
        refreshToken: config_js_1.config.google.refreshToken,
        linkedEmail: '',
    },
    smtp: {
        host: config_js_1.config.smtp.host,
        port: config_js_1.config.smtp.port,
        secure: config_js_1.config.smtp.secure,
        user: config_js_1.config.smtp.user,
        pass: config_js_1.config.smtp.pass,
        from: config_js_1.config.smtp.from,
        linkedEmail: '',
    },
};
function loadStorageSettings() {
    return {
        storageMode: (0, db_js_1.getSetting)('storageMode') ?? DEFAULT_SETTINGS.storageMode,
        google: {
            clientId: (0, db_js_1.getSetting)('google.clientId') ?? DEFAULT_SETTINGS.google.clientId,
            clientSecret: (0, db_js_1.getSetting)('google.clientSecret') ?? DEFAULT_SETTINGS.google.clientSecret,
            redirectUri: (0, db_js_1.getSetting)('google.redirectUri') ?? DEFAULT_SETTINGS.google.redirectUri,
            folderId: (0, db_js_1.getSetting)('google.folderId') ?? DEFAULT_SETTINGS.google.folderId,
            refreshToken: (0, db_js_1.getSetting)('google.refreshToken') ?? DEFAULT_SETTINGS.google.refreshToken,
            linkedEmail: (0, db_js_1.getSetting)('google.linkedEmail') ?? DEFAULT_SETTINGS.google.linkedEmail,
        },
        smtp: {
            host: (0, db_js_1.getSetting)('smtp.host') ?? DEFAULT_SETTINGS.smtp.host,
            port: Number((0, db_js_1.getSetting)('smtp.port') ?? DEFAULT_SETTINGS.smtp.port),
            secure: ((0, db_js_1.getSetting)('smtp.secure') ?? String(DEFAULT_SETTINGS.smtp.secure)) === 'true',
            user: (0, db_js_1.getSetting)('smtp.user') ?? DEFAULT_SETTINGS.smtp.user,
            pass: (0, db_js_1.getSetting)('smtp.pass') ?? DEFAULT_SETTINGS.smtp.pass,
            from: (0, db_js_1.getSetting)('smtp.from') ?? DEFAULT_SETTINGS.smtp.from,
            linkedEmail: (0, db_js_1.getSetting)('smtp.linkedEmail') ?? DEFAULT_SETTINGS.smtp.linkedEmail,
        },
    };
}
function saveStorageSettings(input) {
    const current = loadStorageSettings();
    const next = {
        storageMode: input.storageMode ?? current.storageMode,
        google: {
            clientId: input.google?.clientId ?? current.google.clientId,
            clientSecret: input.google?.clientSecret ?? current.google.clientSecret,
            redirectUri: input.google?.redirectUri ?? current.google.redirectUri,
            folderId: input.google?.folderId ?? current.google.folderId,
            refreshToken: input.google?.refreshToken ?? current.google.refreshToken,
            linkedEmail: input.google?.linkedEmail ?? current.google.linkedEmail,
        },
        smtp: {
            host: input.smtp?.host ?? current.smtp.host,
            port: input.smtp?.port ?? current.smtp.port,
            secure: input.smtp?.secure ?? current.smtp.secure,
            user: input.smtp?.user ?? current.smtp.user,
            pass: input.smtp?.pass ?? current.smtp.pass,
            from: input.smtp?.from ?? current.smtp.from,
            linkedEmail: input.smtp?.linkedEmail ?? current.smtp.linkedEmail,
        },
    };
    (0, db_js_1.setSetting)('storageMode', next.storageMode);
    (0, db_js_1.setSetting)('google.clientId', next.google.clientId);
    (0, db_js_1.setSetting)('google.clientSecret', next.google.clientSecret);
    (0, db_js_1.setSetting)('google.redirectUri', next.google.redirectUri);
    (0, db_js_1.setSetting)('google.folderId', next.google.folderId);
    (0, db_js_1.setSetting)('google.refreshToken', next.google.refreshToken);
    (0, db_js_1.setSetting)('google.linkedEmail', next.google.linkedEmail);
    (0, db_js_1.setSetting)('smtp.host', next.smtp.host);
    (0, db_js_1.setSetting)('smtp.port', String(next.smtp.port));
    (0, db_js_1.setSetting)('smtp.secure', String(next.smtp.secure));
    (0, db_js_1.setSetting)('smtp.user', next.smtp.user);
    (0, db_js_1.setSetting)('smtp.pass', next.smtp.pass);
    (0, db_js_1.setSetting)('smtp.from', next.smtp.from);
    (0, db_js_1.setSetting)('smtp.linkedEmail', next.smtp.linkedEmail);
    return next;
}
function driveIsConfigured(settings = loadStorageSettings()) {
    return Boolean(settings.google.clientId && settings.google.clientSecret && settings.google.refreshToken);
}
function driveOAuthClientReady(settings = loadStorageSettings()) {
    return Boolean(settings.google.clientId &&
        settings.google.clientSecret &&
        settings.google.redirectUri);
}
function driveLinked(settings = loadStorageSettings()) {
    return Boolean(settings.google.clientId &&
        settings.google.clientSecret &&
        settings.google.redirectUri &&
        settings.google.refreshToken);
}
function smtpIsConfigured(settings = loadStorageSettings()) {
    return Boolean(settings.smtp.host && settings.smtp.user && settings.smtp.pass);
}
//# sourceMappingURL=storage-settings.js.map
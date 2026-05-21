import { config } from './config.js';
import { getSetting, setSetting } from './db.js';

export type StorageMode = 'local' | 'google-drive';

export interface GoogleDriveSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  folderId: string;
  refreshToken: string;
  linkedEmail: string;
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  linkedEmail: string;
}

export interface StorageSettings {
  storageMode: StorageMode;
  google: GoogleDriveSettings;
  smtp: SmtpSettings;
}

const DEFAULT_SETTINGS: StorageSettings = {
  storageMode: 'local',
  google: {
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    redirectUri: config.google.redirectUri,
    folderId: config.google.folderId,
    refreshToken: config.google.refreshToken,
    linkedEmail: '',
  },
  smtp: {
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    user: config.smtp.user,
    pass: config.smtp.pass,
    from: config.smtp.from,
    linkedEmail: '',
  },
};

export function loadStorageSettings(): StorageSettings {
  return {
    storageMode: (getSetting('storageMode') as StorageMode | null) ?? DEFAULT_SETTINGS.storageMode,
    google: {
      clientId: getSetting('google.clientId') ?? DEFAULT_SETTINGS.google.clientId,
      clientSecret: getSetting('google.clientSecret') ?? DEFAULT_SETTINGS.google.clientSecret,
      redirectUri: getSetting('google.redirectUri') ?? DEFAULT_SETTINGS.google.redirectUri,
      folderId: getSetting('google.folderId') ?? DEFAULT_SETTINGS.google.folderId,
      refreshToken: getSetting('google.refreshToken') ?? DEFAULT_SETTINGS.google.refreshToken,
      linkedEmail: getSetting('google.linkedEmail') ?? DEFAULT_SETTINGS.google.linkedEmail,
    },
    smtp: {
      host: getSetting('smtp.host') ?? DEFAULT_SETTINGS.smtp.host,
      port: Number(getSetting('smtp.port') ?? DEFAULT_SETTINGS.smtp.port),
      secure: (getSetting('smtp.secure') ?? String(DEFAULT_SETTINGS.smtp.secure)) === 'true',
      user: getSetting('smtp.user') ?? DEFAULT_SETTINGS.smtp.user,
      pass: getSetting('smtp.pass') ?? DEFAULT_SETTINGS.smtp.pass,
      from: getSetting('smtp.from') ?? DEFAULT_SETTINGS.smtp.from,
      linkedEmail: getSetting('smtp.linkedEmail') ?? DEFAULT_SETTINGS.smtp.linkedEmail,
    },
  };
}

export function saveStorageSettings(input: {
  storageMode?: StorageMode;
  google?: Partial<GoogleDriveSettings>;
  smtp?: Partial<SmtpSettings>;
}): StorageSettings {
  const current = loadStorageSettings();
  const next: StorageSettings = {
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

  setSetting('storageMode', next.storageMode);
  setSetting('google.clientId', next.google.clientId);
  setSetting('google.clientSecret', next.google.clientSecret);
  setSetting('google.redirectUri', next.google.redirectUri);
  setSetting('google.folderId', next.google.folderId);
  setSetting('google.refreshToken', next.google.refreshToken);
  setSetting('google.linkedEmail', next.google.linkedEmail);
  setSetting('smtp.host', next.smtp.host);
  setSetting('smtp.port', String(next.smtp.port));
  setSetting('smtp.secure', String(next.smtp.secure));
  setSetting('smtp.user', next.smtp.user);
  setSetting('smtp.pass', next.smtp.pass);
  setSetting('smtp.from', next.smtp.from);
  setSetting('smtp.linkedEmail', next.smtp.linkedEmail);

  return next;
}

export function driveIsConfigured(settings = loadStorageSettings()): boolean {
  return Boolean(settings.google.clientId && settings.google.clientSecret && settings.google.refreshToken);
}

export function driveOAuthClientReady(settings = loadStorageSettings()): boolean {
  return Boolean(
    settings.google.clientId &&
      settings.google.clientSecret &&
      settings.google.redirectUri,
  );
}

export function driveLinked(settings = loadStorageSettings()): boolean {
  return Boolean(
    settings.google.clientId &&
      settings.google.clientSecret &&
      settings.google.redirectUri &&
      settings.google.refreshToken,
  );
}

export function smtpIsConfigured(settings = loadStorageSettings()): boolean {
  // Resend HTTP transport bypasses SMTP entirely.
  if (process.env.RESEND_API_KEY?.trim()) return true;
  return Boolean(settings.smtp.host && settings.smtp.user && settings.smtp.pass);
}
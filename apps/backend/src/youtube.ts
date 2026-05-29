import { google } from 'googleapis';
import { Readable } from 'node:stream';
import { config } from './config.js';
import { loadStorageSettings } from './storage-settings.js';

export interface YouTubeSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
  linkedEmail: string;
}

function resolveYouTubeSettings(override?: Partial<YouTubeSettings>) {
  const current = loadStorageSettings();
  return {
    clientId: override?.clientId ?? current.youtube.clientId,
    clientSecret: override?.clientSecret ?? current.youtube.clientSecret,
    redirectUri: override?.redirectUri ?? current.youtube.redirectUri,
    refreshToken: override?.refreshToken ?? current.youtube.refreshToken,
  };
}

function oauthClient(settings?: Partial<YouTubeSettings>) {
  const s = resolveYouTubeSettings(settings);
  const client = new google.auth.OAuth2(s.clientId, s.clientSecret, s.redirectUri);
  client.setCredentials({ refresh_token: s.refreshToken });
  return client;
}

/** Build an OAuth consent URL for YouTube upload access. */
export function buildYouTubeAuthUrl(
  settings?: Partial<YouTubeSettings>,
  options?: { loginHint?: string; state?: string },
): string {
  const s = resolveYouTubeSettings(settings);
  const client = new google.auth.OAuth2(s.clientId, s.clientSecret, s.redirectUri);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/userinfo.email',
      'openid',
    ],
    login_hint: options?.loginHint,
    state: options?.state,
  });
}

/** Exchange an OAuth code for tokens (one-time setup). */
export async function exchangeYouTubeCode(code: string, settings?: Partial<YouTubeSettings>) {
  const s = resolveYouTubeSettings(settings);
  const client = new google.auth.OAuth2(s.clientId, s.clientSecret, s.redirectUri);
  const { tokens } = await client.getToken(code);
  return tokens;
}

export async function fetchYouTubeEmail(
  tokens: { access_token?: string | null; refresh_token?: string | null },
  settings?: Partial<YouTubeSettings>,
): Promise<string | null> {
  const s = resolveYouTubeSettings(settings);
  const client = new google.auth.OAuth2(s.clientId, s.clientSecret, s.redirectUri);
  client.setCredentials({
    access_token: tokens.access_token ?? undefined,
    refresh_token: tokens.refresh_token ?? undefined,
  });
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const me = await oauth2.userinfo.get();
  return me.data.email ?? null;
}

export interface YouTubeUploadResult {
  id: string;
  webViewLink: string;
  webContentLink: string;
}

/** Upload a video buffer to YouTube as unlisted. Returns watch URL. */
export async function uploadToYouTube(
  filename: string,
  mimeType: string,
  buffer: Buffer,
  settings?: Partial<YouTubeSettings>,
): Promise<YouTubeUploadResult> {
  const auth = oauthClient(settings);
  const youtube = google.youtube({ version: 'v3', auth });

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: filename.replace(/\.[^.]+$/, ''),
        description: `Uploaded by Lemon Hub Studio Cam`,
      },
      status: {
        privacyStatus: 'unlisted',
      },
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
  });

  const videoId = res.data.id!;
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  return {
    id: videoId,
    webViewLink: watchUrl,
    webContentLink: watchUrl,
  };
}

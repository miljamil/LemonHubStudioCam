import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import {
  CloudTokens,
  setDriveTokens,
  setYouTubeTokens,
  getDriveTokens,
  getYouTubeTokens,
} from './storage';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_CLIENT_ID =
  (Constants.expoConfig?.extra as any)?.googleClientId ?? '';

const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

function getRedirectUri() {
  return AuthSession.makeRedirectUri({ scheme: 'com.studiocam.app' });
}

async function fetchEmail(accessToken: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return '';
  const data = await res.json();
  return data.email ?? '';
}

export async function connectGoogleDrive(): Promise<CloudTokens | null> {
  const redirectUri = getRedirectUri();
  const request = new AuthSession.AuthRequest({
    clientId: GOOGLE_CLIENT_ID,
    scopes: DRIVE_SCOPES,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: { access_type: 'offline', prompt: 'consent' },
  });
  await request.promptAsync(discovery);

  const result = request.result;
  if (result?.type !== 'success' || !result.params.code) return null;

  const tokenRes = await AuthSession.exchangeCodeAsync(
    {
      clientId: GOOGLE_CLIENT_ID,
      code: result.params.code,
      redirectUri,
      extraParams: { code_verifier: request.codeVerifier! },
    },
    discovery,
  );

  const tokens: CloudTokens = {
    accessToken: tokenRes.accessToken,
    refreshToken: tokenRes.refreshToken ?? '',
    linkedEmail: await fetchEmail(tokenRes.accessToken),
  };
  await setDriveTokens(tokens);
  return tokens;
}

export async function connectYouTube(): Promise<CloudTokens | null> {
  const redirectUri = getRedirectUri();
  const request = new AuthSession.AuthRequest({
    clientId: GOOGLE_CLIENT_ID,
    scopes: YOUTUBE_SCOPES,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: { access_type: 'offline', prompt: 'consent' },
  });
  await request.promptAsync(discovery);

  const result = request.result;
  if (result?.type !== 'success' || !result.params.code) return null;

  const tokenRes = await AuthSession.exchangeCodeAsync(
    {
      clientId: GOOGLE_CLIENT_ID,
      code: result.params.code,
      redirectUri,
      extraParams: { code_verifier: request.codeVerifier! },
    },
    discovery,
  );

  const tokens: CloudTokens = {
    accessToken: tokenRes.accessToken,
    refreshToken: tokenRes.refreshToken ?? '',
    linkedEmail: await fetchEmail(tokenRes.accessToken),
  };
  await setYouTubeTokens(tokens);
  return tokens;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token ?? null;
}

async function getValidToken(
  getTokens: () => Promise<CloudTokens | null>,
  saveTokens: (t: CloudTokens) => Promise<void>,
): Promise<string | null> {
  const tokens = await getTokens();
  if (!tokens) return null;

  // Try using current access token
  const testRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (testRes.ok) return tokens.accessToken;

  // Refresh
  if (!tokens.refreshToken) return null;
  const newAccess = await refreshAccessToken(tokens.refreshToken);
  if (!newAccess) return null;
  await saveTokens({ ...tokens, accessToken: newAccess });
  return newAccess;
}

export async function getValidDriveToken(): Promise<string | null> {
  return getValidToken(getDriveTokens, setDriveTokens);
}

export async function getValidYouTubeToken(): Promise<string | null> {
  return getValidToken(getYouTubeTokens, setYouTubeTokens);
}

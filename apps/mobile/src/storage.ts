import * as SecureStore from 'expo-secure-store';

export type StorageMode = 'local' | 'google-drive' | 'youtube';

export interface CloudTokens {
  accessToken: string;
  refreshToken: string;
  linkedEmail?: string;
}

const KEYS = {
  storageMode: 'studiocam_storage_mode',
  driveTokens: 'studiocam_drive_tokens',
  youtubeTokens: 'studiocam_youtube_tokens',
};

export async function getStorageMode(): Promise<StorageMode> {
  const v = await SecureStore.getItemAsync(KEYS.storageMode);
  if (v === 'google-drive' || v === 'youtube') return v;
  return 'local';
}

export async function setStorageMode(mode: StorageMode) {
  await SecureStore.setItemAsync(KEYS.storageMode, mode);
}

export async function getDriveTokens(): Promise<CloudTokens | null> {
  const raw = await SecureStore.getItemAsync(KEYS.driveTokens);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function setDriveTokens(tokens: CloudTokens) {
  await SecureStore.setItemAsync(KEYS.driveTokens, JSON.stringify(tokens));
}

export async function clearDriveTokens() {
  await SecureStore.deleteItemAsync(KEYS.driveTokens);
}

export async function getYouTubeTokens(): Promise<CloudTokens | null> {
  const raw = await SecureStore.getItemAsync(KEYS.youtubeTokens);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function setYouTubeTokens(tokens: CloudTokens) {
  await SecureStore.setItemAsync(KEYS.youtubeTokens, JSON.stringify(tokens));
}

export async function clearYouTubeTokens() {
  await SecureStore.deleteItemAsync(KEYS.youtubeTokens);
}

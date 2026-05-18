/** Shared constants & types for StudioCam (web, mobile, desktop, backend). */

export const MAX_RECIPIENTS = 3;
/** Default auto-split window (seconds). */
export const DEFAULT_MAX_CHUNK_SECONDS = 30 * 60;
/** Preferred MIME types in order of fallback for MediaRecorder. */
export const RECORDER_MIME_CANDIDATES = [
  'video/mp4;codecs=h264,aac',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export type CameraSource =
  | { kind: 'device'; deviceId?: string; facingMode?: 'user' | 'environment' }
  | { kind: 'screen' }
  | { kind: 'ipcam'; url: string }; // HLS / MJPEG URL

export interface RecordingSession {
  /** Stable client-side id (UUID v4). */
  sessionId: string;
  /** Up to MAX_RECIPIENTS emails. */
  recipients: string[];
  /** Optional display label. */
  label?: string;
  /** Auto-split threshold in seconds. */
  maxChunkSeconds: number;
  startedAt: string; // ISO
}

export interface RecordingChunkMeta {
  sessionId: string;
  chunkIndex: number; // 0-based
  startedAt: string;
  endedAt: string;
  mimeType: string;
  sizeBytes: number;
  /** Optional ZIP compression flag (true = client zipped before upload). */
  zipped?: boolean;
}

export interface UploadResult {
  driveFileId: string;
  driveWebViewLink: string;
  driveDownloadLink: string;
  emailedTo: string[];
}

export interface ApiError {
  error: string;
  detail?: string;
}

/** RFC-5322-ish email validation. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function sanitizeRecipients(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const v = r.trim().toLowerCase();
    if (!v || seen.has(v) || !isValidEmail(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= MAX_RECIPIENTS) break;
  }
  return out;
}

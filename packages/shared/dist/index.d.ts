/** Shared constants & types for StudioCam (web, mobile, desktop, backend). */
export declare const MAX_RECIPIENTS = 3;
/** Default auto-split window (seconds). */
export declare const DEFAULT_MAX_CHUNK_SECONDS: number;
/** Preferred MIME types in order of fallback for MediaRecorder. */
export declare const RECORDER_MIME_CANDIDATES: string[];
export type CameraSource = {
    kind: 'device';
    deviceId?: string;
    facingMode?: 'user' | 'environment';
} | {
    kind: 'screen';
} | {
    kind: 'ipcam';
    url: string;
};
export interface RecordingSession {
    /** Stable client-side id (UUID v4). */
    sessionId: string;
    /** Up to MAX_RECIPIENTS emails. */
    recipients: string[];
    /** Optional display label. */
    label?: string;
    /** Auto-split threshold in seconds. */
    maxChunkSeconds: number;
    startedAt: string;
}
export interface RecordingChunkMeta {
    sessionId: string;
    chunkIndex: number;
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
export declare function isValidEmail(value: string): boolean;
export declare function sanitizeRecipients(raw: string[]): string[];

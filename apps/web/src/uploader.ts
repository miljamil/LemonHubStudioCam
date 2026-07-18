import JSZip from 'jszip';
import { apiUrl } from './api.js';
import type { ChunkPayload } from './recorder.js';

export interface UploadOpts {
  sessionId: string;
  recipients: string[];
  label?: string;
  /** When true, the chunk blob is wrapped in a ZIP before upload. */
  zip?: boolean;
  /** When true, ask the backend to apply the watermark during post-processing. */
  watermark?: boolean;
  /** Resolution preset selected at capture time, forwarded to the backend for logging/post-processing. */
  qualityPreset?: 'auto' | '480p' | '720p' | '1080p' | '4k';
  /** When true, notify the studio that the artist consents to social media posting. */
  socialMediaConsent?: boolean;
  /** Max retry attempts (default 3). Set to 1 to disable retries. */
  maxAttempts?: number;
  /** Called when an attempt fails and another will be tried. */
  onAttempt?: (info: { attempt: number; maxAttempts: number; error: Error; nextDelayMs: number }) => void;
}

export type MailStatus = 'sent' | 'failed' | 'skipped-smtp';

export interface UploadResponse {
  recordingId?: string;
  driveFileId: string;
  driveWebViewLink: string;
  driveDownloadLink: string;
  filename?: string;
  recipients?: string[];
  emailedTo: string[];
  storageKind?: 'google-drive' | 'youtube' | 'local';
  mailStatus?: MailStatus;
  mailError?: string;
  /** Set when a cloud upload failed and the server fell back to local storage. */
  fallbackReason?: string | null;
  traceId?: string;
}

async function postOnce(form: FormData): Promise<UploadResponse> {
  const res = await fetch(apiUrl('/api/recordings'), { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Upload failed (${res.status}): ${text || res.statusText}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as UploadResponse;
}

export async function uploadChunk(
  chunk: ChunkPayload,
  opts: UploadOpts,
): Promise<UploadResponse> {
  const tracePrefix = `[studiocam][chunk:${chunk.index + 1}]`;
  console.info(tracePrefix, 'preparing upload', {
    sessionId: opts.sessionId,
    recipientCount: opts.recipients.length,
    recipients: opts.recipients,
    zip: Boolean(opts.zip),
    mimeType: chunk.mimeType,
  });

  let blob = chunk.blob;
  let mime = chunk.mimeType;

  if (opts.zip) {
    const zip = new JSZip();
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    zip.file(`chunk_${chunk.index + 1}.${ext}`, blob);
    blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    mime = 'application/zip';
  }

  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const backoffsMs = [2_000, 5_000, 12_000];

  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // FormData is recreated each attempt because some browsers consume the body.
    const form = new FormData();
    form.append('file', blob, `chunk_${chunk.index + 1}`);
    form.append('sessionId', opts.sessionId);
    form.append('chunkIndex', String(chunk.index));
    form.append('recipients', JSON.stringify(opts.recipients));
    form.append('mimeType', mime);
    if (opts.label) form.append('label', opts.label);
    if (opts.watermark) form.append('watermark', '1');
    if (opts.qualityPreset) form.append('qualityPreset', opts.qualityPreset);
    if (opts.socialMediaConsent) form.append('socialMediaConsent', '1');

    try {
      const result = await postOnce(form);
      console.info(tracePrefix, `upload complete on attempt ${attempt}`, result);
      return result;
    } catch (e) {
      lastErr = e as Error;
      const status = (e as Error & { status?: number }).status;
      // Don't retry client errors (4xx other than 408/429) — they won't get better.
      const retriable = !status || status >= 500 || status === 408 || status === 429;
      console.warn(tracePrefix, `attempt ${attempt}/${maxAttempts} failed`, { status, message: lastErr.message });
      if (!retriable || attempt >= maxAttempts) break;
      const nextDelayMs = backoffsMs[Math.min(attempt - 1, backoffsMs.length - 1)];
      opts.onAttempt?.({ attempt, maxAttempts, error: lastErr, nextDelayMs });
      await new Promise((r) => setTimeout(r, nextDelayMs));
    }
  }

  console.error(tracePrefix, 'upload failed after all attempts', lastErr?.message);
  throw lastErr ?? new Error('Upload failed');
}

/** Resend the email for a recording that's already been uploaded. No re-upload. */
export async function resendRecordingEmail(
  recordingId: string,
  recipients?: string[],
): Promise<{ mailStatus: MailStatus; recipients?: string[]; error?: string; traceId?: string }> {
  const res = await fetch(apiUrl(`/api/recordings/${encodeURIComponent(recordingId)}/resend-email`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(recipients ? { recipients } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { mailStatus: 'failed', error: data?.error || `HTTP ${res.status}`, traceId: data?.traceId };
  }
  return data as { mailStatus: MailStatus; recipients?: string[]; traceId?: string };
}

/** Delete a previously uploaded recording and its local file (when stored locally). */
export async function deleteRecording(recordingId: string): Promise<{
  ok: boolean;
  error?: string;
  traceId?: string;
  fileDeleted?: boolean;
  note?: string;
}> {
  const res = await fetch(apiUrl(`/api/recordings/${encodeURIComponent(recordingId)}`), {
    method: 'DELETE',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error || `HTTP ${res.status}`, traceId: data?.traceId };
  }
  return {
    ok: true,
    traceId: data?.traceId,
    fileDeleted: Boolean(data?.fileDeleted),
    note: typeof data?.note === 'string' ? data.note : undefined,
  };
}

/** Build a mailto: URL the user's mail client opens as a draft. */
export function buildMailtoDraft(input: {
  recipients: string[];
  filename: string;
  viewLink: string;
  downloadLink?: string;
  sessionId: string;
  chunkIndex: number;
  sizeBytes: number;
}): string {
  const sizeMb = (input.sizeBytes / (1024 * 1024)).toFixed(2);
  const subject = `Lemon Hub Studio Cam recording — ${input.filename}`;
  const body =
    `Hello,\n\n` +
    `A new Lemon Hub Studio Cam recording is ready.\n\n` +
    `Session: ${input.sessionId}\n` +
    `Part: ${input.chunkIndex + 1}\n` +
    `File: ${input.filename}\n` +
    `Size: ${sizeMb} MB\n\n` +
    `Open: ${input.viewLink}\n` +
    (input.downloadLink && input.downloadLink !== input.viewLink ? `Download: ${input.downloadLink}\n` : '') +
    `\n— Lemon Hub Studio Cam`;
  const to = encodeURIComponent(input.recipients.join(','));
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Trigger a local browser download of a chunk (fallback / always-on backup). */
export function downloadChunkLocally(chunk: ChunkPayload, baseName: string) {
  const ext = chunk.mimeType.includes('mp4') ? 'mp4' : 'webm';
  const url = URL.createObjectURL(chunk.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}_p${String(chunk.index + 1).padStart(2, '0')}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}


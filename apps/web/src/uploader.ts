import JSZip from 'jszip';
import type { ChunkPayload } from './recorder.js';

export interface UploadOpts {
  sessionId: string;
  recipients: string[];
  label?: string;
  /** When true, the chunk blob is wrapped in a ZIP before upload. */
  zip?: boolean;
}

export interface UploadResponse {
  driveFileId: string;
  driveWebViewLink: string;
  driveDownloadLink: string;
  emailedTo: string[];
  storageKind?: 'google-drive' | 'local';
  mailStatus?: 'sent' | 'skipped-smtp';
  traceId?: string;
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

  const form = new FormData();
  form.append('file', blob, `chunk_${chunk.index + 1}`);
  form.append('sessionId', opts.sessionId);
  form.append('chunkIndex', String(chunk.index));
  form.append('recipients', JSON.stringify(opts.recipients));
  form.append('mimeType', mime);
  if (opts.label) form.append('label', opts.label);

  const res = await fetch('/api/recordings', { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text();
    console.error(tracePrefix, 'upload failed', { status: res.status, text });
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
  const result = (await res.json()) as UploadResponse;
  console.info(tracePrefix, 'upload complete', result);
  return result;
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

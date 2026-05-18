import {
  DEFAULT_MAX_CHUNK_SECONDS,
  RECORDER_MIME_CANDIDATES,
} from '@studiocam/shared';

export interface ChunkPayload {
  index: number;
  blob: Blob;
  mimeType: string;
  startedAt: Date;
  endedAt: Date;
}

export interface ChunkedRecorderOptions {
  stream: MediaStream;
  /** Auto-split every N seconds (default 30 min). */
  maxChunkSeconds?: number;
  onChunk: (chunk: ChunkPayload) => void | Promise<void>;
  onError?: (err: Error) => void;
}

export function pickMimeType(): string | undefined {
  for (const m of RECORDER_MIME_CANDIDATES) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) {
      return m;
    }
  }
  return undefined;
}

/**
 * Wraps MediaRecorder so it auto-rotates every `maxChunkSeconds` and emits one
 * `ChunkPayload` per finished segment. This is the 30-minute splitter.
 */
export class ChunkedRecorder {
  private opts: Required<Omit<ChunkedRecorderOptions, 'onError'>> & {
    onError?: (e: Error) => void;
  };
  private mime: string | undefined;
  private current: MediaRecorder | null = null;
  private buf: Blob[] = [];
  private chunkIndex = 0;
  private startedAt = new Date();
  private rotateTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;

  constructor(o: ChunkedRecorderOptions) {
    this.opts = {
      stream: o.stream,
      maxChunkSeconds: o.maxChunkSeconds ?? DEFAULT_MAX_CHUNK_SECONDS,
      onChunk: o.onChunk,
      onError: o.onError,
    };
    this.mime = pickMimeType();
  }

  start() {
    this.stopping = false;
    this.chunkIndex = 0;
    this.spawn();
  }

  /** Stop the current chunk and emit it; no new chunk is started. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.rotateTimer) {
      clearTimeout(this.rotateTimer);
      this.rotateTimer = null;
    }
    if (this.current && this.current.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        this.current!.addEventListener('stop', () => resolve(), { once: true });
        this.current!.stop();
      });
    }
  }

  private spawn() {
    this.buf = [];
    this.startedAt = new Date();
    const rec = this.mime
      ? new MediaRecorder(this.opts.stream, { mimeType: this.mime })
      : new MediaRecorder(this.opts.stream);
    this.current = rec;
    const myIndex = this.chunkIndex;

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.buf.push(e.data);
    };
    rec.onerror = (e: any) => {
      this.opts.onError?.(e.error ?? new Error('MediaRecorder error'));
    };
    rec.onstop = () => {
      const endedAt = new Date();
      const blob = new Blob(this.buf, { type: rec.mimeType || this.mime || 'video/webm' });
      this.opts.onChunk({
        index: myIndex,
        blob,
        mimeType: blob.type,
        startedAt: this.startedAt,
        endedAt,
      });
      if (!this.stopping) {
        this.chunkIndex += 1;
        this.spawn();
      }
    };

    rec.start(1000); // gather data every 1s
    this.rotateTimer = setTimeout(() => {
      if (rec.state !== 'inactive') rec.stop(); // triggers onstop → spawn next
    }, this.opts.maxChunkSeconds * 1000);
  }
}

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_MAX_CHUNK_SECONDS,
  MAX_RECIPIENTS,
  sanitizeRecipients,
} from '@studiocam/shared';
import { apiUrl } from './api.js';
import { ChunkedRecorder, pickMimeType, type ChunkPayload } from './recorder.js';
import { downloadChunkLocally, uploadChunk } from './uploader.js';

type SourceKind = 'camera' | 'screen' | 'ipcam';
type StorageMode = 'local' | 'google-drive';
type ChunkState = 'recorded' | 'uploading' | 'done' | 'error';
type TraceKind = 'info' | 'success' | 'warn' | 'error';
type QualityPreset = 'auto' | '480p' | '720p' | '1080p' | '4k';

interface ResolutionSpec {
  width: number;
  height: number;
  frameRate: number;
  label: string;
}

const RESOLUTION_PRESETS: Record<Exclude<QualityPreset, 'auto'>, ResolutionSpec> = {
  '480p': { width: 854, height: 480, frameRate: 30, label: 'SD 480p' },
  '720p': { width: 1280, height: 720, frameRate: 30, label: 'HD 720p' },
  '1080p': { width: 1920, height: 1080, frameRate: 30, label: 'Full HD 1080p' },
  '4k': { width: 3840, height: 2160, frameRate: 30, label: '4K UHD' },
};
interface ChunkRow {
  index: number;
  sizeBytes: number;
  state: ChunkState;
  link?: string;
  error?: string;
}

interface TraceRow {
  id: string;
  time: string;
  kind: TraceKind;
  message: string;
}

interface StorageState {
  storageMode: StorageMode;
  google: {
    linkedEmail: string;
    folderId?: string;
    linked: boolean;
  };
  smtpLinked: boolean;
  smtpLinkedEmail?: string;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function App() {
  const [emails, setEmails] = useState<string[]>(['', '', '']);
  const [label, setLabel] = useState('recording');
  const [source, setSource] = useState<SourceKind>('camera');
  const [ipUrl, setIpUrl] = useState('');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [splitMin, setSplitMin] = useState<number>(DEFAULT_MAX_CHUNK_SECONDS / 60);
  const [zip, setZip] = useState(false);
  const [alsoSaveLocally, setAlsoSaveLocally] = useState(true);
  const [storageMode, setStorageMode] = useState<StorageMode>('local');
  const [googleBusinessEmail, setGoogleBusinessEmail] = useState('');
  const [googleFolderId, setGoogleFolderId] = useState('');
  const [storageState, setStorageState] = useState<StorageState | null>(null);
  const [storageModalOpen, setStorageModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'email' | 'storage' | 'capture'>('email');

  // SMTP form state
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState(465);
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpSaving, setSmtpSaving] = useState(false);

  const [recording, setRecording] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [qualityPreset, setQualityPreset] = useState<QualityPreset>('auto');
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [chunks, setChunks] = useState<ChunkRow[]>([]);
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<ChunkedRecorder | null>(null);
  const sessionRef = useRef<string>('');
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef(false);

  const cleanRecipients = useMemo(() => sanitizeRecipients(emails), [emails]);
  const showTraces = (import.meta as unknown as { env: { DEV: boolean } }).env.DEV;
  const isSafari = typeof navigator !== 'undefined'
    && /Safari/i.test(navigator.userAgent)
    && !/Chrome|Chromium|Android/i.test(navigator.userAgent);
  const canRecord = cleanRecipients.length > 0 && !recording &&
    (source !== 'ipcam' || ipUrl.trim().length > 0);
  const preferFrontCamera = useMemo(() => {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
    const ua = navigator.userAgent.toLowerCase();
    const isTouch = navigator.maxTouchPoints > 1;
    const isMobile = /android|iphone|ipad|ipod|mobile|phone/.test(ua) || isTouch;
    return isMobile;
  }, []);
  const [videoOrientation, setVideoOrientation] = useState<'portrait' | 'landscape'>(
    () => (typeof window !== 'undefined' && window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'),
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function updateOrientation() {
      setVideoOrientation(window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
    }

    updateOrientation();
    window.addEventListener('orientationchange', updateOrientation);
    window.addEventListener('resize', updateOrientation);

    return () => {
      window.removeEventListener('orientationchange', updateOrientation);
      window.removeEventListener('resize', updateOrientation);
    };
  }, []);

  function addTrace(kind: TraceKind, message: string) {
    setTraces((prev) => [
      {
        id: uuid(),
        time: new Date().toLocaleTimeString(),
        kind,
        message,
      },
      ...prev,
    ].slice(0, 12));
  }

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    // Request permission once so labels appear, then list cameras.
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((s) => { s.getTracks().forEach((t) => t.stop()); })
      .catch(() => undefined)
      .finally(() => {
        navigator.mediaDevices.enumerateDevices().then((devs) => {
          setCameras(devs.filter((d) => d.kind === 'videoinput'));
        });
      });
  }, []);

  useEffect(() => {
    fetch(apiUrl('/api/storage/settings'))
      .then((res) => res.json())
      .then((data: StorageState) => {
        setStorageState(data);
        setStorageMode(data.storageMode);
        setGoogleBusinessEmail(data.google.linkedEmail ?? '');
        setGoogleFolderId(data.google.folderId ?? '');
      })
      .catch((e) => addTrace('warn', `Could not load storage settings: ${(e as Error).message}`));
    // Load SMTP settings too
    fetch(apiUrl('/api/smtp/settings'))
      .then((res) => res.json())
      .then((data: { host?: string; port?: number; secure?: boolean; user?: string }) => {
        if (data.host) setSmtpHost(data.host);
        if (data.port) setSmtpPort(data.port);
        if (typeof data.secure === 'boolean') setSmtpSecure(data.secure);
        if (data.user) setSmtpUser(data.user);
      })
      .catch(() => undefined);
  }, []);

  const driveReady = Boolean(storageState?.google.linked);
  const smtpReady = Boolean(storageState?.smtpLinked);
  const storageSummary = storageMode === 'google-drive'
    ? (driveReady ? `Google Drive connected (${storageState?.google.linkedEmail || 'account linked'})` : 'Google Drive selected, not linked yet')
    : 'Local storage active';

  function getCameraVideoConstraints(): MediaTrackConstraints {
    const isLandscape = videoOrientation === 'landscape';
    const base: MediaTrackConstraints = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: preferFrontCamera ? 'user' : 'environment' };

    if (qualityPreset === 'auto') {
      // Let the browser/device negotiate the best available resolution,
      // but still hint orientation so the longer side matches the viewport.
      return {
        ...base,
        aspectRatio: { ideal: isLandscape ? 16 / 9 : 9 / 16 },
        frameRate: { ideal: 30 },
      };
    }

    const preset = RESOLUTION_PRESETS[qualityPreset];
    const longSide = Math.max(preset.width, preset.height);
    const shortSide = Math.min(preset.width, preset.height);
    const targetWidth = isLandscape ? longSide : shortSide;
    const targetHeight = isLandscape ? shortSide : longSide;

    return {
      ...base,
      width: { ideal: targetWidth, max: targetWidth },
      height: { ideal: targetHeight, max: targetHeight },
      aspectRatio: { ideal: targetWidth / targetHeight },
      frameRate: { ideal: preset.frameRate, max: preset.frameRate },
    };
  }

  async function acquireStream(): Promise<MediaStream> {
    if (source === 'screen') {
      const screenSpec = qualityPreset === 'auto' ? null : RESOLUTION_PRESETS[qualityPreset];
      const isLandscape = videoOrientation === 'landscape';
      const screenConstraints: MediaTrackConstraints = screenSpec
        ? {
            width: {
              ideal: isLandscape ? Math.max(screenSpec.width, screenSpec.height) : Math.min(screenSpec.width, screenSpec.height),
            },
            height: {
              ideal: isLandscape ? Math.min(screenSpec.width, screenSpec.height) : Math.max(screenSpec.width, screenSpec.height),
            },
            frameRate: { ideal: screenSpec.frameRate, max: screenSpec.frameRate },
          }
        : { frameRate: { ideal: 30 } };
      return await (navigator.mediaDevices as any).getDisplayMedia({
        video: screenConstraints,
        audio: true,
      });
    }
    if (source === 'ipcam') {
      // Browsers can't capture arbitrary RTSP. We accept an HLS/MJPEG URL,
      // render it in a <video>, and captureStream() it.
      const v = document.createElement('video');
      v.src = ipUrl;
      v.crossOrigin = 'anonymous';
      v.muted = true;
      v.playsInline = true;
      await v.play();
      const s = (v as any).captureStream() as MediaStream;
      if (!s) throw new Error('IP camera stream could not be captured (browser blocked).');
      return s;
    }
    return await navigator.mediaDevices.getUserMedia({
      video: getCameraVideoConstraints(),
      audio: true,
    });
  }

  async function previewSource() {
    if (!videoRef.current) return;
    if (recording) return;
    if (!previewEnabled) {
      teardownStream();
      return;
    }

    try {
      if (source === 'screen') {
        // Browser security requires an explicit user gesture for display capture.
        return;
      }

      if (source === 'ipcam') {
        teardownStream();
        if (!ipUrl.trim()) return;
        videoRef.current.srcObject = null;
        videoRef.current.src = ipUrl;
        await videoRef.current.play().catch(() => undefined);
        return;
      }

      const previewStream = await navigator.mediaDevices.getUserMedia({
        video: getCameraVideoConstraints(),
        audio: false,
      });
      teardownStream();
      streamRef.current = previewStream;
      videoRef.current.src = '';
      videoRef.current.srcObject = previewStream;
      await videoRef.current.play().catch(() => undefined);
    } catch {
      // Preview can fail due to permissions; recording flow still handles explicit errors on start.
    }
  }

  async function start() {
    setError(null);
    setChunks([]);
    setTraces([]);
    try {
      if (!pickMimeType()) {
        setError('This browser has no compatible MediaRecorder codec. Try Chrome/Edge.');
        addTrace('error', 'No compatible MediaRecorder codec was found.');
        return;
      }
      // Always acquire a fresh stream with audio for recording
      const stream = await acquireStream();
      recordingStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      // Stop preview-only stream (it has no audio anyway)
      if (streamRef.current && streamRef.current !== stream) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      sessionRef.current = uuid();
      addTrace('info', `Started session ${sessionRef.current}. Recipients: ${cleanRecipients.join(', ') || 'none'}`);
      addTrace('info', `Source: ${source}${source === 'ipcam' ? ` (${ipUrl})` : ''}`);
      addTrace('info', `Storage mode: ${storageMode}${storageMode === 'google-drive' ? (driveReady ? ' (connected)' : ' (not connected yet)') : ''}`);

      const rec = new ChunkedRecorder({
        stream,
        maxChunkSeconds: Math.max(5, Math.floor(splitMin * 60)),
        onChunk: handleChunk,
        onError: (e) => {
          setError(e.message);
          addTrace('error', `Recorder error: ${e.message}`);
        },
      });
      recorderRef.current = rec;
      rec.start();

      recordingRef.current = true;
      setRecording(true);
      addTrace('success', `Recording started. Auto-split set to ${splitMin} minutes.`);
      const t0 = Date.now();
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    } catch (e) {
      setError((e as Error).message);
      addTrace('error', `Start failed: ${(e as Error).message}`);
      teardownStream();
    }
  }

  async function stop() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    recordingRef.current = false;
    setRecording(false);
    addTrace('info', 'Stop requested by user. Final chunk will flush and upload.');
    try {
      await recorderRef.current?.stop();
    } finally {
      // Stop the recording stream
      recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
      recordingStreamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = '';
      }
    }
  }

  function teardownStream() {
    // Never tear down a recording stream — only the preview stream
    if (recordingRef.current) return;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.src = '';
    }
  }

  useEffect(() => {
    if (!recording) previewSource();
    return () => {
      // Use the ref (not the stale closure) to avoid killing a recording stream
      if (!recordingRef.current) teardownStream();
    };
  }, [source, deviceId, ipUrl, preferFrontCamera, videoOrientation, qualityPreset, recording, previewEnabled]);

  async function handleChunk(chunk: ChunkPayload) {
    addTrace('info', `Chunk ${chunk.index + 1} captured (${(chunk.blob.size / (1024 * 1024)).toFixed(2)} MB).`);
    setChunks((prev) => [
      ...prev,
      { index: chunk.index, sizeBytes: chunk.blob.size, state: 'uploading' },
    ]);


    // Always default to 'recording' if label is empty or whitespace
    const safeLabel = label.trim() ? label : 'recording';
    if (alsoSaveLocally) {
      downloadChunkLocally(chunk, safeLabel);
      addTrace('success', `Chunk ${chunk.index + 1} saved locally in the browser.`);
    }

    try {
      addTrace('info', `Chunk ${chunk.index + 1} upload started with ${cleanRecipients.length} recipient(s).`);
      const r = await uploadChunk(chunk, {
        sessionId: sessionRef.current,
        recipients: cleanRecipients,
        label: safeLabel,
        zip,
        watermark: watermarkEnabled,
        qualityPreset,
      });
      addTrace(
        r.mailStatus === 'sent' ? 'success' : 'warn',
        `Chunk ${chunk.index + 1} stored as ${r.storageKind ?? 'unknown'}; mail ${r.mailStatus === 'sent' ? 'sent' : 'skipped'}. Trace ${r.traceId ?? 'n/a'}.`,
      );
      setChunks((prev) =>
        prev.map((c) => c.index === chunk.index
          ? { ...c, state: 'done', link: r.driveWebViewLink }
          : c),
      );
    } catch (e) {
      addTrace('error', `Chunk ${chunk.index + 1} upload failed: ${(e as Error).message}`);
      setChunks((prev) =>
        prev.map((c) => c.index === chunk.index
          ? { ...c, state: 'error', error: (e as Error).message }
          : c),
      );
    }
  }

  async function saveStorageSettings() {
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/storage/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storageMode,
          google: {
            folderId: googleFolderId,
          },
        }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json() as StorageState;
      setStorageState(data);
      setStorageMode(data.storageMode);
      addTrace('success', `Storage settings saved. Mode: ${data.storageMode}.`);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      addTrace('error', `Saving storage settings failed: ${message}`);
    }
  }

  async function connectGoogleDrive() {
    try {
      const email = googleBusinessEmail.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Enter a valid Google email first.');
      }

      const res = await fetch(apiUrl('/api/auth/google/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to get Google auth URL');
      }
      addTrace('info', `Opening Google consent screen for ${email}.`);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      addTrace('error', `Google Drive connect failed: ${message}`);
    }
  }

  async function connectSmtp() {
    setSmtpSaving(true);
    setError(null);
    try {
      const normalizedHost = smtpHost.trim();
      const normalizedUser = smtpUser.trim().toLowerCase();
      const normalizedPass = normalizedHost.includes('gmail.com')
        ? smtpPass.replace(/\s+/g, '')
        : smtpPass;

      const res = await fetch(apiUrl('/api/smtp/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: normalizedHost,
          port: smtpPort,
          secure: smtpSecure,
          user: normalizedUser,
          pass: normalizedPass,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = Array.isArray(data.details) ? ` (${data.details.join('; ')})` : '';
        const hint = data.hint ? ` Hint: ${data.hint}` : '';
        throw new Error(`${data.error || 'Failed to save SMTP settings'}${detail}${hint}`);
      }
      setStorageState((prev) => prev ? { ...prev, smtpLinked: true, smtpLinkedEmail: normalizedUser } : prev);
      addTrace('success', `Email connected: ${normalizedUser}. SMTP verified successfully.`);
      setSmtpPass(''); // clear password from memory
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      addTrace('error', `Email connect failed: ${message}`);
    } finally {
      setSmtpSaving(false);
    }
  }

  async function disconnectSmtp() {
    setError(null);
    try {
      await fetch(apiUrl('/api/smtp/settings'), { method: 'DELETE' });
      setStorageState((prev) => prev ? { ...prev, smtpLinked: false, smtpLinkedEmail: '' } : prev);
      setSmtpUser('');
      setSmtpPass('');
      addTrace('info', 'Email disconnected.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="app">
      <h1>Lemon Hub Studio Cam</h1>
      <p className="subtitle">
        Record from your camera, screen or an IP cam — auto-split every {splitMin} min
        and email up to {MAX_RECIPIENTS} recipients.
      </p>

      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <strong>Connections</strong>
            <div className="muted">
              Email: {smtpReady ? `connected (${storageState?.smtpLinkedEmail || 'linked'})` : 'not connected'}.
              {' '}Storage: {storageSummary}.
            </div>
          </div>
          <div className="row">
            <button type="button" onClick={() => setStorageModalOpen(true)}>
              Settings
            </button>
          </div>
        </div>
        <div className="muted" style={{ marginTop: 8 }}>
          Connect your email to send recordings to recipients. Optionally connect Google Drive for cloud storage.
          {isSafari && ' Safari on recent iPadOS versions can record camera video, but some sources and codecs are more limited.'}
        </div>
      </section>

      <section className="panel">
        <label>Recipients (up to {MAX_RECIPIENTS})</label>
        <div className="row">
          {emails.map((v, i) => (
            <input
              key={i}
              type="email"
              placeholder={`email ${i + 1}`}
              value={v}
              disabled={recording}
              onChange={(e) =>
                setEmails((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
              }
            />
          ))}
        </div>
        <div className="muted" style={{ marginTop: 6 }}>
          {cleanRecipients.length} valid · {cleanRecipients.join(', ') || 'none yet'}
        </div>
      </section>

      <section className="panel">
        <video ref={videoRef} muted playsInline />
              <div style={{ marginTop: 10, width: '100%' }}>
                <input
                  value={label}
                  disabled={recording}
                  onChange={e => setLabel(e.target.value)}
                  placeholder="Name your song…"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    fontSize: 15,
                    borderRadius: 10,
                    border: '1px solid #b0b0b0',
                    background: '#fff',
                    color: '#222',
                    textAlign: 'center',
                    letterSpacing: 0.3,
                    boxShadow: '0 1px 4px 0 rgba(0,0,0,0.03)',
                    outline: 'none',
                  }}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  marginTop: 12,
                  width: "100%",
                }}
              >
                {/* Left-aligned status */}
                <div style={{ flex: "0 0 auto" }}>
                  {recording ? (
                    <span className="rec-indicator">
                      <span className="blink" /> REC {formatHMS(elapsed)}
                    </span>
                  ) : (
                    <span className="muted">Idle</span>
                  )}
                </div>

                {/* Center-aligned button */}
                <div style={{ flex: 1, textAlign: "center" }}>
                  {!recording ? (
                    <button className="primary" disabled={!canRecord} onClick={start}>
                      ● Record Your Song
                    </button>
                  ) : (
                    <button className="secondary" onClick={stop}>■ Stop & email</button>
                  )}
                </div>

                {/* Right-aligned preview */}
                <div style={{ flex: "0 0 auto" }}>
                  <button
                    type="button"
                    disabled={recording}
                    onClick={() => setPreviewEnabled((prev) => !prev)}
                    style={{
                      fontSize: 12,
                      padding: '6px 10px',
                      borderRadius: 8,
                    }}
                    title={recording ? 'Preview can be toggled when not recording' : undefined}
                  >
                    {previewEnabled ? 'Preview on' : 'Preview off'}
                  </button>
                </div>
              </div>
        {error && <div className="error">{error}</div>}
      </section>

      {showTraces && traces.length > 0 && (
        <section className="panel">
          <strong>Traces</strong>
          <ul className="chunks">
            {traces.map((trace) => (
              <li key={trace.id}>
                <span className={`dot ${trace.kind === 'success' ? 'ok' : trace.kind === 'error' ? 'err' : trace.kind === 'warn' ? 'up' : ''}`} />
                <span className="muted">{trace.time}</span>
                <span>{trace.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {storageModalOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setStorageModalOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong id="settings-title">Settings</strong>
              <button type="button" onClick={() => setStorageModalOpen(false)}>Close</button>
            </div>

            {/* Tabs */}
            <div className="row" style={{ marginTop: 12, gap: 0 }}>
              <button
                type="button"
                className={settingsTab === 'email' ? 'tab-active' : 'tab'}
                onClick={() => setSettingsTab('email')}
              >
                Connect Email
              </button>
              <button
                type="button"
                className={settingsTab === 'storage' ? 'tab-active' : 'tab'}
                onClick={() => setSettingsTab('storage')}
              >
                Cloud Storage
              </button>
              <button
                type="button"
                className={settingsTab === 'capture' ? 'tab-active' : 'tab'}
                onClick={() => setSettingsTab('capture')}
              >
                Source / Camera
              </button>
            </div>

            {/* ========= EMAIL TAB ========= */}
            {settingsTab === 'email' && (
              <div style={{ marginTop: 16 }}>
                {smtpReady ? (
                  <div>
                    <div style={{ color: '#4ade80', fontWeight: 600, marginBottom: 8 }}>
                      ✓ Email connected: {storageState?.smtpLinkedEmail}
                    </div>
                    <p className="muted">
                      Recordings will be emailed to your recipients through this account.
                    </p>
                    <button type="button" className="secondary" onClick={disconnectSmtp}>
                      Disconnect email
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="muted" style={{ marginBottom: 12 }}>
                      Connect your email so StudioCam can send recordings to recipients.
                      For Gmail, use an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>App Password</a> (not your regular password).
                    </p>

                    {/* Preset quick-select */}
                    <div style={{ marginBottom: 12 }}>
                      <label>Email provider</label>
                      <select
                        value={smtpHost === 'smtp.gmail.com' ? 'gmail' : smtpHost === 'smtp.outlook.com' ? 'outlook' : 'custom'}
                        onChange={(e) => {
                          if (e.target.value === 'gmail') { setSmtpHost('smtp.gmail.com'); setSmtpPort(465); setSmtpSecure(true); }
                          else if (e.target.value === 'outlook') { setSmtpHost('smtp.outlook.com'); setSmtpPort(587); setSmtpSecure(false); }
                        }}
                      >
                        <option value="gmail">Gmail</option>
                        <option value="outlook">Outlook / Hotmail</option>
                        <option value="custom">Custom SMTP</option>
                      </select>
                    </div>

                    <div className="row">
                      <div style={{ flex: 2 }}>
                        <label>SMTP Host</label>
                        <input style={{ width: '100%' }} value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label>Port</label>
                        <input style={{ width: '100%' }} type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} />
                      </div>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
                        <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
                          <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} /> SSL/TLS
                        </label>
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: 8 }}>
                      <div style={{ flex: 1 }}>
                        <label>Email address</label>
                        <input style={{ width: '100%' }} type="email" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="you@gmail.com" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label>App password</label>
                        <input style={{ width: '100%' }} type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder="xxxx xxxx xxxx xxxx" />
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
                      <button type="button" className="primary" onClick={connectSmtp} disabled={smtpSaving || !smtpUser || !smtpPass}>
                        {smtpSaving ? 'Connecting...' : 'Connect & verify'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ========= STORAGE TAB ========= */}
            {settingsTab === 'storage' && (
              <div style={{ marginTop: 16 }}>
                <div className="row">
                  <div>
                    <label>Storage mode</label>
                    <select value={storageMode} onChange={(e) => setStorageMode(e.target.value as StorageMode)} disabled={recording}>
                      <option value="local">Local storage (free, no setup)</option>
                      <option value="google-drive">Google Drive</option>
                    </select>
                  </div>
                </div>

                {storageMode === 'local' && (
                  <div className="muted" style={{ marginTop: 12 }}>
                    Recordings are stored on the server. Links to the files are included in the email sent to recipients.
                    {smtpReady
                      ? ' Files under 20 MB are also attached directly to the email.'
                      : ' Connect your email first (Email tab) so recordings can be sent.'}
                  </div>
                )}

                {storageMode === 'google-drive' && (
                  <div style={{ marginTop: 12 }}>
                    <p className="muted" style={{ marginBottom: 8 }}>
                      To use Google Drive you need OAuth credentials from Google Cloud Console.
                      This is an advanced option — local storage works fine for most use cases.
                    </p>
                    <div className="row">
                      <div style={{ flex: 1 }}>
                        <label>Business Google email</label>
                        <input
                          style={{ width: '100%' }}
                          value={googleBusinessEmail}
                          disabled={recording}
                          onChange={(e) => setGoogleBusinessEmail(e.target.value)}
                          placeholder="owner@business.com"
                        />
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: 8 }}>
                      <div style={{ flex: 1 }}>
                        <label>Drive folder ID (optional)</label>
                        <input
                          style={{ width: '100%' }}
                          value={googleFolderId}
                          disabled={recording}
                          onChange={(e) => setGoogleFolderId(e.target.value)}
                          placeholder="Folder ID"
                        />
                      </div>
                    </div>
                    {storageState?.google.linkedEmail && (
                      <div className="muted" style={{ marginTop: 8 }}>
                        Currently linked account: {storageState.google.linkedEmail}
                      </div>
                    )}
                    <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                      <button type="button" className="secondary" onClick={connectGoogleDrive}>
                        Open Google consent
                      </button>
                    </div>
                  </div>
                )}

                <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={saveStorageSettings}>Save storage settings</button>
                </div>
              </div>
            )}

            {/* ========= CAPTURE TAB ========= */}
            {settingsTab === 'capture' && (
              <div style={{ marginTop: 16 }}>
                <div className="row" style={{ marginBottom: 10 }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: '#a8c7ff',
                      border: '1px solid #2d6cdf',
                      borderRadius: 999,
                      padding: '4px 10px',
                      background: 'rgba(45,108,223,0.12)',
                    }}
                  >
                    {preferFrontCamera ? 'Mobile detected: default front camera' : 'Desktop detected: default back camera'}
                  </span>
                </div>
                <div className="row">
                  <div>
                    <label>Source</label>
                    <select value={source} disabled={recording}
                      onChange={(e) => setSource(e.target.value as SourceKind)}>
                      <option value="camera">Built-in / USB camera</option>
                      <option value="screen">Screen / window</option>
                      <option value="ipcam">IP camera (HLS/MJPEG URL)</option>
                    </select>
                  </div>
                  {source === 'camera' && (
                    <div>
                      <label>Camera device</label>
                      <select value={deviceId} disabled={recording}
                        onChange={(e) => setDeviceId(e.target.value)}>
                        <option value="">Default ({preferFrontCamera ? 'front on mobile' : 'back on desktop'})</option>
                        {cameras.map((c) => (
                          <option key={c.deviceId} value={c.deviceId}>
                            {c.label || `Camera ${c.deviceId.slice(0, 6)}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="row" style={{ marginTop: 10 }}>
                  <div>
                    <label>Resolution</label>
                    <select
                      value={qualityPreset}
                      disabled={recording}
                      onChange={(e) => setQualityPreset(e.target.value as QualityPreset)}
                    >
                      <option value="auto">Auto (device best)</option>
                      <option value="480p">SD 480p (854 × 480)</option>
                      <option value="720p">HD 720p (1280 × 720)</option>
                      <option value="1080p">Full HD 1080p (1920 × 1080)</option>
                      <option value="4k">4K UHD (3840 × 2160)</option>
                    </select>
                  </div>
                  <div className="muted" style={{ alignSelf: 'flex-end', maxWidth: 320 }}>
                    Constraints are sent as <code>ideal</code>, so the device picks the closest match.
                    Width/height swap automatically when the screen rotates.
                  </div>
                </div>

                <div className="row" style={{ marginTop: 10 }}>
                  <div>
                    <label>Auto-split (min)</label>
                    <input type="number" min={1} max={60} value={splitMin}
                      disabled={recording}
                      onChange={(e) => setSplitMin(Number(e.target.value) || 30)} />
                  </div>
                </div>

                <div className="row" style={{ marginTop: 8 }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
                    <input type="checkbox" checked={zip} disabled={recording}
                      onChange={(e) => setZip(e.target.checked)} /> ZIP each chunk before upload
                  </label>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
                    <input type="checkbox" checked={alsoSaveLocally} disabled={recording}
                      onChange={(e) => setAlsoSaveLocally(e.target.checked)} /> Also download locally (backup)
                  </label>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
                    <input type="checkbox" checked={watermarkEnabled} disabled={recording}
                      onChange={(e) => setWatermarkEnabled(e.target.checked)} /> Apply watermark in post-processing
                  </label>
                </div>

                {watermarkEnabled && (
                  <div className="muted" style={{ marginTop: 6 }}>
                    Watermark will be composited onto uploaded chunks by the backend post-processing pipeline.
                    Drop your image at <code>apps/backend/assets/watermark.png</code> (a placeholder file is included).
                  </div>
                )}

                {source === 'ipcam' && (
                  <div className="row" style={{ marginTop: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label>IP camera URL (HLS .m3u8 or MJPEG)</label>
                      <input
                        style={{ width: '100%' }}
                        placeholder="https://camera.local/stream.m3u8"
                        value={ipUrl}
                        disabled={recording}
                        onChange={(e) => setIpUrl(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div className="muted" style={{ marginTop: 10 }}>
                  Default camera behavior: mobile devices use front camera; desktops use environment/back camera unless you select a specific device. Video orientation follows device rotation.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {chunks.length > 0 && (
        <section className="panel">
          <strong>Chunks</strong>
          <ul className="chunks">
            {chunks.map((c) => (
              <li key={c.index}>
                <span className={`dot ${c.state === 'done' ? 'ok' : c.state === 'error' ? 'err' : 'up'}`} />
                <span>Part {c.index + 1}</span>
                <span className="muted">{(c.sizeBytes / (1024 * 1024)).toFixed(2)} MB</span>
                <span className="muted">·</span>
                <span className="muted">{c.state}</span>
                {c.link && (
                  <a href={c.link} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto' }}>
                    Open in Drive ↗
                  </a>
                )}
                {c.error && <span className="error" style={{ marginLeft: 'auto' }}>{c.error}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function formatHMS(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

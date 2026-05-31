import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';

import {
  StorageMode,
  getStorageMode,
  setStorageMode as persistStorageMode,
  getDriveTokens,
  getYouTubeTokens,
  clearDriveTokens,
  clearYouTubeTokens,
} from './src/storage';
import { connectGoogleDrive, connectYouTube } from './src/auth';
import { uploadToDrive, uploadToYouTube } from './src/uploader';

// ---------- Constants ----------
const MAX_RECIPIENTS = 3;
const BACKEND_URL: string =
  (Constants.expoConfig?.extra as any)?.backendUrl ?? 'https://lemonhubstudiocam.onrender.com';

type QualityPreset = 'auto' | '480p' | '720p' | '1080p' | '4k';
type CameraFacing = 'front' | 'back';

const QUALITY_OPTIONS: { value: QualityPreset; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4K' },
];

const STORAGE_OPTIONS: { value: StorageMode; label: string; icon: string }[] = [
  { value: 'local', label: 'Local only', icon: '📱' },
  { value: 'google-drive', label: 'Google Drive', icon: '☁️' },
  { value: 'youtube', label: 'YouTube', icon: '▶️' },
];

// ---------- Helpers ----------
function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function uuid() {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function formatHMS(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function buildFilename(label: string, chunkIndex: number): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const YYYY = now.getFullYear();
  const safeName = label.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'recording';
  return `${safeName}_${hh}${mm}_${MM}${DD}${YYYY}_p${String(chunkIndex + 1).padStart(2, '0')}.mp4`;
}

// ---------- Send email via backend ----------
async function sendEmailNotification(opts: {
  recipients: string[];
  filename: string;
  viewLink: string;
  downloadLink: string;
  sizeBytes: number;
  storageLabel: string;
  socialMediaConsent: boolean;
}) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const t = await res.text();
      console.warn('Email send failed:', t);
    }
  } catch (e) {
    console.warn('Email send error:', e);
  }
}

// ---------- Main App ----------
export default function App() {
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const [mediaPerm, setMediaPerm] = useState<boolean | null>(null);

  // Form state
  const [emails, setEmails] = useState<string[]>(['', '', '']);
  const [label, setLabel] = useState('');
  const [splitMin, setSplitMin] = useState('30');
  const [qualityPreset, setQualityPreset] = useState<QualityPreset>('auto');
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const [socialMediaConsent, setSocialMediaConsent] = useState(true);
  const [facing, setFacing] = useState<CameraFacing>('front');
  const [alsoSaveLocally, setAlsoSaveLocally] = useState(true);

  // Storage state
  const [storageMode, setStorageModeState] = useState<StorageMode>('local');
  const [driveEmail, setDriveEmail] = useState<string | null>(null);
  const [youtubeEmail, setYoutubeEmail] = useState<string | null>(null);

  // Settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Recording state
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [chunks, setChunks] = useState<{ index: number; uri: string; status: string }[]>([]);

  const cameraRef = useRef<CameraView | null>(null);
  const sessionIdRef = useRef('');
  const chunkIndexRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Orientation
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(() => {
    const { width, height } = Dimensions.get('window');
    return width > height ? 'landscape' : 'portrait';
  });

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      setOrientation(window.width > window.height ? 'landscape' : 'portrait');
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    (async () => {
      const ml = await MediaLibrary.requestPermissionsAsync();
      setMediaPerm(ml.status === 'granted');
    })();
  }, []);

  // Load persisted storage settings
  useEffect(() => {
    (async () => {
      const mode = await getStorageMode();
      setStorageModeState(mode);
      const dt = await getDriveTokens();
      if (dt?.linkedEmail) setDriveEmail(dt.linkedEmail);
      const yt = await getYouTubeTokens();
      if (yt?.linkedEmail) setYoutubeEmail(yt.linkedEmail);
    })();
  }, []);

  const validRecipients = emails
    .map((e) => e.trim().toLowerCase())
    .filter((e, i, arr) => e && isValidEmail(e) && arr.indexOf(e) === i)
    .slice(0, MAX_RECIPIENTS);

  const ready = camPerm?.granted && micPerm?.granted && mediaPerm;

  // ---------- Storage mode setter ----------
  async function handleSetStorageMode(mode: StorageMode) {
    if (mode === 'google-drive' && !driveEmail) {
      Alert.alert('Not linked', 'Connect Google Drive first in settings.');
      return;
    }
    if (mode === 'youtube' && !youtubeEmail) {
      Alert.alert('Not linked', 'Connect YouTube first in settings.');
      return;
    }
    setStorageModeState(mode);
    await persistStorageMode(mode);
  }

  // ---------- OAuth connect handlers ----------
  async function handleConnectDrive() {
    try {
      const tokens = await connectGoogleDrive();
      if (tokens?.linkedEmail) {
        setDriveEmail(tokens.linkedEmail);
        Alert.alert('Connected', `Google Drive linked as ${tokens.linkedEmail}`);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to connect Google Drive');
    }
  }

  async function handleConnectYouTube() {
    try {
      const tokens = await connectYouTube();
      if (tokens?.linkedEmail) {
        setYoutubeEmail(tokens.linkedEmail);
        Alert.alert('Connected', `YouTube linked as ${tokens.linkedEmail}`);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to connect YouTube');
    }
  }

  async function handleDisconnectDrive() {
    await clearDriveTokens();
    setDriveEmail(null);
    if (storageMode === 'google-drive') {
      setStorageModeState('local');
      await persistStorageMode('local');
    }
  }

  async function handleDisconnectYouTube() {
    await clearYouTubeTokens();
    setYoutubeEmail(null);
    if (storageMode === 'youtube') {
      setStorageModeState('local');
      await persistStorageMode('local');
    }
  }

  // ---------- Permissions gate ----------
  if (!camPerm || !micPerm) {
    return <Centered text="Loading permissions\u2026" />;
  }
  if (!camPerm.granted || !micPerm.granted) {
    return (
      <Centered text="StudioCam needs camera + microphone access.">
        <Pressable
          style={styles.btn}
          onPress={async () => {
            await requestCamPerm();
            await requestMicPerm();
          }}
        >
          <Text style={styles.btnText}>Grant permissions</Text>
        </Pressable>
      </Centered>
    );
  }

  // ---------- Recording logic ----------
  async function recordOneChunk(splitSec: number): Promise<void> {
    if (!cameraRef.current) return;
    const idx = chunkIndexRef.current;
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: splitSec });
      if (!video?.uri) return;

      // Save to phone gallery
      if (alsoSaveLocally && mediaPerm) {
        try {
          await MediaLibrary.saveToLibraryAsync(video.uri);
        } catch (e) {
          console.warn('saveToLibrary failed', e);
        }
      }

      const safeLabel = label.trim() || 'recording';
      const filename = buildFilename(safeLabel, idx);

      setChunks((prev) => [...prev, { index: idx, uri: video.uri, status: 'uploading\u2026' }]);

      if (storageMode === 'google-drive') {
        try {
          const result = await uploadToDrive(video.uri, filename, 'video/mp4');
          setChunks((prev) =>
            prev.map((c) => (c.index === idx ? { ...c, status: 'uploaded to Drive \u2713' } : c)),
          );
          const info = await FileSystem.getInfoAsync(video.uri);
          const sizeBytes = (info as any).size ?? 0;
          if (validRecipients.length > 0) {
            sendEmailNotification({
              recipients: validRecipients,
              filename,
              viewLink: result.viewLink,
              downloadLink: result.downloadLink,
              sizeBytes,
              storageLabel: 'Google Drive',
              socialMediaConsent,
            });
          }
        } catch (e: any) {
          setChunks((prev) =>
            prev.map((c) => (c.index === idx ? { ...c, status: `error: ${e?.message}` } : c)),
          );
        }
      } else if (storageMode === 'youtube') {
        try {
          const title = filename.replace(/\.\w+$/, '');
          const result = await uploadToYouTube(video.uri, title, 'video/mp4');
          setChunks((prev) =>
            prev.map((c) => (c.index === idx ? { ...c, status: 'uploaded to YouTube \u2713' } : c)),
          );
          const info = await FileSystem.getInfoAsync(video.uri);
          const sizeBytes = (info as any).size ?? 0;
          if (validRecipients.length > 0) {
            sendEmailNotification({
              recipients: validRecipients,
              filename,
              viewLink: result.viewLink,
              downloadLink: result.downloadLink,
              sizeBytes,
              storageLabel: 'YouTube',
              socialMediaConsent,
            });
          }
        } catch (e: any) {
          setChunks((prev) =>
            prev.map((c) => (c.index === idx ? { ...c, status: `error: ${e?.message}` } : c)),
          );
        }
      } else {
        // Local mode \u2014 upload to backend for watermark + email
        try {
          const form = new FormData();
          form.append('file', {
            uri: video.uri,
            name: filename,
            type: 'video/mp4',
          } as any);
          form.append('sessionId', sessionIdRef.current);
          form.append('chunkIndex', String(idx));
          form.append('recipients', JSON.stringify(validRecipients));
          form.append('mimeType', 'video/mp4');
          form.append('label', safeLabel);
          if (watermarkEnabled) form.append('watermark', '1');
          form.append('qualityPreset', qualityPreset);
          if (socialMediaConsent) form.append('socialMediaConsent', '1');

          const res = await fetch(`${BACKEND_URL}/api/recordings`, {
            method: 'POST',
            body: form as any,
          });
          if (!res.ok) {
            const t = await res.text();
            throw new Error(`HTTP ${res.status}: ${t}`);
          }
          setChunks((prev) =>
            prev.map((c) => (c.index === idx ? { ...c, status: 'emailed \u2713' } : c)),
          );
        } catch (e: any) {
          setChunks((prev) =>
            prev.map((c) => (c.index === idx ? { ...c, status: `error: ${e?.message}` } : c)),
          );
        }
      }
    } catch (e) {
      console.warn('recordAsync error', e);
    } finally {
      chunkIndexRef.current = idx + 1;
    }
  }

  async function startRecording() {
    if (storageMode === 'local' && validRecipients.length === 0) {
      Alert.alert('Missing recipients', 'Add at least one valid email for local mode.');
      return;
    }
    if (!cameraRef.current) return;
    sessionIdRef.current = uuid();
    chunkIndexRef.current = 0;
    stopRequestedRef.current = false;
    setChunks([]);
    setRecording(true);

    const t0 = Date.now();
    setElapsed(0);
    tickRef.current = setInterval(
      () => setElapsed(Math.floor((Date.now() - t0) / 1000)),
      1000,
    );

    const splitSec = Math.max(5, Math.floor((Number(splitMin) || 30) * 60));
    while (!stopRequestedRef.current) {
      await recordOneChunk(splitSec);
      if (stopRequestedRef.current) break;
    }

    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setRecording(false);
  }

  async function stopRecording() {
    stopRequestedRef.current = true;
    try {
      cameraRef.current?.stopRecording();
    } catch (e) {
      console.warn('stopRecording err', e);
    }
  }

  // ---------- UI ----------
  const isLandscape = orientation === 'landscape';
  const cameraAspect = isLandscape ? 16 / 9 : 9 / 16;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>Lemon Hub Studio Cam</Text>
            <Text style={styles.subtitle}>
              Record \u00b7 {storageMode === 'local' ? 'upload & email' : `save to ${storageMode === 'google-drive' ? 'Drive' : 'YouTube'}`}
            </Text>
          </View>
          <Pressable
            style={styles.settingsBtn}
            onPress={() => setSettingsOpen(true)}
          >
            <Text style={{ color: '#e8ecf1', fontSize: 22 }}>{'\u2699\uFE0F'}</Text>
          </Pressable>
        </View>

        {/* Recipients */}
        <View style={styles.panel}>
          <Text style={styles.label}>Recipients (up to {MAX_RECIPIENTS})</Text>
          {emails.map((v, i) => (
            <TextInput
              key={i}
              style={styles.input}
              placeholder={`email ${i + 1}`}
              placeholderTextColor="#7f8a99"
              autoCapitalize="none"
              keyboardType="email-address"
              value={v}
              editable={!recording}
              onChangeText={(t) =>
                setEmails((p) => p.map((x, j) => (j === i ? t : x)))
              }
            />
          ))}
          <Text style={styles.muted}>
            {validRecipients.length} valid \u00b7 {validRecipients.join(', ') || 'none yet'}
          </Text>
        </View>

        {/* Song name */}
        <View style={styles.panel}>
          <TextInput
            style={[styles.input, { textAlign: 'center', fontSize: 16, marginBottom: 0 }]}
            placeholder="Name your song\u2026"
            placeholderTextColor="#7f8a99"
            value={label}
            editable={!recording}
            onChangeText={setLabel}
          />
        </View>

        {/* Social media consent */}
        <View style={styles.panel}>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>
              I consent to having this recording shared on social media
            </Text>
            <Switch
              value={socialMediaConsent}
              onValueChange={setSocialMediaConsent}
              disabled={recording}
              trackColor={{ false: '#3a3f47', true: '#4ade80' }}
              thumbColor={socialMediaConsent ? '#fff' : '#aaa'}
            />
          </View>
        </View>

        {/* Storage mode selector */}
        <View style={styles.panel}>
          <Text style={[styles.label, { marginBottom: 8 }]}>Storage</Text>
          <View style={styles.pickerRow}>
            {STORAGE_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                style={[
                  styles.chip,
                  storageMode === opt.value && styles.chipActive,
                ]}
                disabled={recording}
                onPress={() => handleSetStorageMode(opt.value)}
              >
                <Text
                  style={[
                    styles.chipText,
                    storageMode === opt.value && styles.chipTextActive,
                  ]}
                >
                  {opt.icon} {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {storageMode === 'google-drive' && driveEmail && (
            <Text style={styles.muted}>Linked: {driveEmail}</Text>
          )}
          {storageMode === 'youtube' && youtubeEmail && (
            <Text style={styles.muted}>Linked: {youtubeEmail}</Text>
          )}
        </View>

        {/* Camera preview */}
        <View style={[styles.panel, { padding: 0, overflow: 'hidden' }]}>
          <CameraView
            ref={cameraRef}
            style={{ width: '100%', aspectRatio: cameraAspect }}
            mode="video"
            facing={facing}
          />
          {/* Controls row */}
          <View style={styles.controls}>
            <Text
              style={{ color: recording ? '#ff4757' : '#8892a0', fontWeight: '700' }}
            >
              {recording ? `\u25CF REC ${formatHMS(elapsed)}` : 'Idle'}
            </Text>
            {!recording ? (
              <Pressable
                style={[styles.btn, styles.primary, !ready && { opacity: 0.5 }]}
                disabled={!ready}
                onPress={startRecording}
              >
                <Text style={styles.btnText}>{'\u25CF'} Record</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[styles.btn, { backgroundColor: 'transparent', borderWidth: 2, borderColor: '#ff4757' }]}
                onPress={stopRecording}
              >
                <Text style={[styles.btnText, { color: '#ff4757' }]}>{'\u25A0'} Stop</Text>
              </Pressable>
            )}
            {/* Camera flip */}
            {!recording && (
              <Pressable
                style={styles.btn}
                onPress={() => setFacing((f) => (f === 'front' ? 'back' : 'front'))}
              >
                <Text style={styles.btnText}>{'\u27F2'} Flip</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Chunks */}
        {chunks.length > 0 && (
          <View style={styles.panel}>
            <Text style={styles.label}>Recordings</Text>
            {chunks.map((c) => (
              <Text key={c.index} style={styles.chunkRow}>
                Part {c.index + 1} \u00b7 {c.status}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Settings Modal */}
      <Modal
        visible={settingsOpen}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setSettingsOpen(false)}
      >
        <View style={styles.root}>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
            <View style={styles.headerRow}>
              <Text style={styles.h1}>Settings</Text>
              <Pressable style={styles.btn} onPress={() => setSettingsOpen(false)}>
                <Text style={styles.btnText}>{'\u2715'} Close</Text>
              </Pressable>
            </View>

            {/* Auto-split */}
            <View style={styles.panel}>
              <Text style={styles.label}>Auto-split (minutes)</Text>
              <TextInput
                style={styles.input}
                value={splitMin}
                keyboardType="number-pad"
                editable={!recording}
                onChangeText={setSplitMin}
              />
            </View>

            {/* Resolution */}
            <View style={styles.panel}>
              <Text style={styles.label}>Resolution</Text>
              <View style={styles.pickerRow}>
                {QUALITY_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[
                      styles.chip,
                      qualityPreset === opt.value && styles.chipActive,
                    ]}
                    disabled={recording}
                    onPress={() => setQualityPreset(opt.value)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        qualityPreset === opt.value && styles.chipTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Toggles */}
            <View style={styles.panel}>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Apply watermark</Text>
                <Switch
                  value={watermarkEnabled}
                  onValueChange={setWatermarkEnabled}
                  disabled={recording}
                  trackColor={{ false: '#3a3f47', true: '#4ade80' }}
                  thumbColor={watermarkEnabled ? '#fff' : '#aaa'}
                />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Save to phone gallery</Text>
                <Switch
                  value={alsoSaveLocally}
                  onValueChange={setAlsoSaveLocally}
                  disabled={recording}
                  trackColor={{ false: '#3a3f47', true: '#60a5fa' }}
                  thumbColor={alsoSaveLocally ? '#fff' : '#aaa'}
                />
              </View>
            </View>

            {/* Google Drive connection */}
            <View style={styles.panel}>
              <Text style={[styles.label, { fontSize: 14, fontWeight: '700', color: '#e8ecf1' }]}>
                {'\u2601\uFE0F'} Google Drive
              </Text>
              {driveEmail ? (
                <View>
                  <Text style={[styles.muted, { marginVertical: 6 }]}>
                    Connected: {driveEmail}
                  </Text>
                  <Pressable
                    style={[styles.btn, { backgroundColor: '#2d1215' }]}
                    onPress={handleDisconnectDrive}
                  >
                    <Text style={[styles.btnText, { color: '#ff4757' }]}>Disconnect Drive</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={[styles.btn, { backgroundColor: '#1a3a5c', marginTop: 8 }]}
                  onPress={handleConnectDrive}
                >
                  <Text style={styles.btnText}>Connect Google Drive</Text>
                </Pressable>
              )}
            </View>

            {/* YouTube connection */}
            <View style={styles.panel}>
              <Text style={[styles.label, { fontSize: 14, fontWeight: '700', color: '#e8ecf1' }]}>
                {'\u25B6\uFE0F'} YouTube
              </Text>
              {youtubeEmail ? (
                <View>
                  <Text style={[styles.muted, { marginVertical: 6 }]}>
                    Connected: {youtubeEmail}
                  </Text>
                  <Pressable
                    style={[styles.btn, { backgroundColor: '#2d1215' }]}
                    onPress={handleDisconnectYouTube}
                  >
                    <Text style={[styles.btnText, { color: '#ff4757' }]}>Disconnect YouTube</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={[styles.btn, { backgroundColor: '#3d1515', marginTop: 8 }]}
                  onPress={handleConnectYouTube}
                >
                  <Text style={styles.btnText}>Connect YouTube</Text>
                </Pressable>
              )}
            </View>

            <Text style={[styles.muted, { marginTop: 20 }]}>
              Backend: {BACKEND_URL}
              {'\n'}OAuth tokens stored securely on-device.
            </Text>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// ---------- Centered helper ----------
function Centered({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <View
      style={[
        styles.root,
        { alignItems: 'center', justifyContent: 'center', padding: 24 },
      ]}
    >
      <Text style={{ color: '#e8ecf1', textAlign: 'center', marginBottom: 16 }}>
        {text}
      </Text>
      {children}
    </View>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0d10' },
  h1: { color: '#e8ecf1', fontSize: 26, fontWeight: '800', marginBottom: 4 },
  subtitle: { color: '#8892a0', marginBottom: 16 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  settingsBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1f262d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    backgroundColor: '#14181d',
    borderColor: '#232a31',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  label: { color: '#8892a0', fontSize: 12, marginBottom: 4, marginTop: 4 },
  input: {
    backgroundColor: '#0e1216',
    color: '#e8ecf1',
    borderColor: '#232a31',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    gap: 8,
  },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#1f262d',
  },
  btnText: { color: '#e8ecf1', fontWeight: '700' },
  primary: { backgroundColor: '#ff4757' },
  muted: { color: '#8892a0', fontSize: 12 },
  chunkRow: { color: '#e8ecf1', paddingVertical: 4 },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
    marginTop: 4,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#232a31',
    backgroundColor: '#0e1216',
  },
  chipActive: {
    borderColor: '#60a5fa',
    backgroundColor: 'rgba(96,165,250,0.12)',
  },
  chipText: { color: '#8892a0', fontSize: 12 },
  chipTextActive: { color: '#60a5fa', fontWeight: '600' },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  switchLabel: { color: '#e8ecf1', fontSize: 14, flex: 1, marginRight: 8 },
});

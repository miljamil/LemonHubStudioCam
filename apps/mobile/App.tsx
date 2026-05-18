import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';

const MAX_RECIPIENTS = 3;
const DEFAULT_SPLIT_SEC = 30 * 60;
const BACKEND_URL: string =
  (Constants.expoConfig?.extra as any)?.backendUrl ?? 'http://localhost:4000';

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
function uuid() {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function App() {
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const [mediaPerm, setMediaPerm] = useState<boolean | null>(null);

  const [emails, setEmails] = useState<string[]>(['', '', '']);
  const [label, setLabel] = useState('recording');
  const [splitMin, setSplitMin] = useState('30');

  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [chunks, setChunks] = useState<{ index: number; uri: string; status: string }[]>([]);

  const cameraRef = useRef<CameraView | null>(null);
  const sessionIdRef = useRef('');
  const chunkIndexRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      const ml = await MediaLibrary.requestPermissionsAsync();
      setMediaPerm(ml.status === 'granted');
    })();
  }, []);

  const validRecipients = emails.map((e) => e.trim().toLowerCase())
    .filter((e, i, arr) => e && isValidEmail(e) && arr.indexOf(e) === i)
    .slice(0, MAX_RECIPIENTS);

  const ready = camPerm?.granted && micPerm?.granted && mediaPerm;

  if (!camPerm || !micPerm) {
    return <Centered text="Loading permissions…" />;
  }
  if (!camPerm.granted || !micPerm.granted) {
    return (
      <Centered text="StudioCam needs camera + microphone access.">
        <Pressable style={styles.btn} onPress={async () => {
          await requestCamPerm();
          await requestMicPerm();
        }}>
          <Text style={styles.btnText}>Grant permissions</Text>
        </Pressable>
      </Centered>
    );
  }

  async function recordOneChunk(splitSec: number): Promise<void> {
    if (!cameraRef.current) return;
    const idx = chunkIndexRef.current;
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: splitSec });
      if (!video?.uri) return;

      // Save to phone library
      try {
        if (mediaPerm) await MediaLibrary.saveToLibraryAsync(video.uri);
      } catch (e) {
        console.warn('saveToLibrary failed', e);
      }

      const info = await FileSystem.getInfoAsync(video.uri, { size: true } as any);
      setChunks((prev) => [
        ...prev,
        { index: idx, uri: video.uri, status: 'uploading' },
      ]);

      // Upload + email
      try {
        await uploadChunk({
          uri: video.uri,
          sessionId: sessionIdRef.current,
          chunkIndex: idx,
          recipients: validRecipients,
          label,
          mimeType: 'video/mp4',
        });
        setChunks((prev) => prev.map((c) => c.index === idx ? { ...c, status: 'emailed' } : c));
      } catch (e: any) {
        setChunks((prev) => prev.map((c) => c.index === idx ? { ...c, status: `error: ${e?.message ?? e}` } : c));
      }
    } catch (e) {
      console.warn('recordAsync error', e);
    } finally {
      chunkIndexRef.current = idx + 1;
    }
  }

  async function startRecording() {
    if (validRecipients.length === 0) {
      Alert.alert('Add at least one valid email.');
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
    tickRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);

    const splitSec = Math.max(5, Math.floor((Number(splitMin) || 30) * 60));
    // Loop: each call resolves when recording stops (either manually or maxDuration hits).
    while (!stopRequestedRef.current) {
      await recordOneChunk(splitSec);
      if (stopRequestedRef.current) break;
    }

    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
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

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        <Text style={styles.h1}>StudioCam</Text>
        <Text style={styles.subtitle}>
          Record · auto-split every {splitMin || 30} min · upload to Drive · email up to 3 recipients
        </Text>

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
              onChangeText={(t) => setEmails((p) => p.map((x, j) => (j === i ? t : x)))}
            />
          ))}
          <Text style={styles.muted}>{validRecipients.length} valid</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.label}>Label</Text>
          <TextInput style={styles.input} value={label} onChangeText={setLabel} editable={!recording} />
          <Text style={styles.label}>Auto-split (minutes)</Text>
          <TextInput style={styles.input} value={splitMin} keyboardType="number-pad"
            editable={!recording} onChangeText={setSplitMin} />
        </View>

        <View style={[styles.panel, { padding: 0, overflow: 'hidden' }]}>
          <CameraView
            ref={cameraRef}
            style={{ width: '100%', aspectRatio: 16 / 9 }}
            mode="video"
            facing="back"
          />
          <View style={styles.controls}>
            <Text style={{ color: recording ? '#ff4757' : '#8892a0', fontWeight: '700' }}>
              {recording ? `● REC ${formatHMS(elapsed)}` : 'Idle'}
            </Text>
            {!recording ? (
              <Pressable
                style={[styles.btn, styles.primary, !ready && { opacity: 0.5 }]}
                disabled={!ready || validRecipients.length === 0}
                onPress={startRecording}
              >
                <Text style={styles.btnText}>● Record</Text>
              </Pressable>
            ) : (
              <Pressable style={[styles.btn, styles.secondary]} onPress={stopRecording}>
                <Text style={[styles.btnText, { color: '#06210e' }]}>■ Stop & email</Text>
              </Pressable>
            )}
          </View>
        </View>

        {chunks.length > 0 && (
          <View style={styles.panel}>
            <Text style={styles.label}>Chunks</Text>
            {chunks.map((c) => (
              <Text key={c.index} style={styles.chunkRow}>
                #{c.index + 1} · {c.status}
              </Text>
            ))}
          </View>
        )}

        <Text style={[styles.muted, { marginTop: 20 }]}>
          Backend: {BACKEND_URL}
          {Platform.OS === 'android' && '  (emulator uses 10.0.2.2 → host)'}
        </Text>
      </ScrollView>
    </View>
  );
}

interface UploadInput {
  uri: string;
  sessionId: string;
  chunkIndex: number;
  recipients: string[];
  label?: string;
  mimeType: string;
}

async function uploadChunk(input: UploadInput) {
  const form = new FormData();
  form.append('file', {
    // @ts-expect-error RN FormData file shape
    uri: input.uri,
    name: `chunk_${input.chunkIndex + 1}.mp4`,
    type: input.mimeType,
  });
  form.append('sessionId', input.sessionId);
  form.append('chunkIndex', String(input.chunkIndex));
  form.append('recipients', JSON.stringify(input.recipients));
  form.append('mimeType', input.mimeType);
  if (input.label) form.append('label', input.label);

  const res = await fetch(`${BACKEND_URL}/api/recordings`, {
    method: 'POST',
    body: form as any,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t}`);
  }
  return res.json();
}

function formatHMS(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function Centered({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <View style={[styles.root, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
      <Text style={{ color: '#e8ecf1', textAlign: 'center', marginBottom: 16 }}>{text}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0d10' },
  h1: { color: '#e8ecf1', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#8892a0', marginBottom: 16 },
  panel: { backgroundColor: '#14181d', borderColor: '#232a31', borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12 },
  label: { color: '#8892a0', fontSize: 12, marginBottom: 4, marginTop: 4 },
  input: { backgroundColor: '#0e1216', color: '#e8ecf1', borderColor: '#232a31', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6 },
  controls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
  btn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#1f262d' },
  btnText: { color: '#e8ecf1', fontWeight: '700' },
  primary: { backgroundColor: '#ff4757' },
  secondary: { backgroundColor: '#2ed573' },
  muted: { color: '#8892a0', fontSize: 12 },
  chunkRow: { color: '#e8ecf1', paddingVertical: 4 },
});

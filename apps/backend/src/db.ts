import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const dbDir = path.resolve(process.cwd(), 'data');
fs.mkdirSync(dbDir, { recursive: true });

export const db = new Database(path.join(dbDir, 'studiocam.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS recordings (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  chunk_index     INTEGER NOT NULL,
  drive_file_id   TEXT NOT NULL,
  drive_link      TEXT NOT NULL,
  recipients      TEXT NOT NULL,          -- JSON array
  size_bytes      INTEGER NOT NULL,
  mime_type       TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recordings_session ON recordings(session_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export interface RecordingRow {
  id: string;
  session_id: string;
  chunk_index: number;
  drive_file_id: string;
  drive_link: string;
  recipients: string;
  size_bytes: number;
  mime_type: string;
  created_at: string;
}

export function getSetting(key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`) as unknown as {
    get: (key: string) => { value?: string } | undefined;
  };
  const result = row.get(key);
  return result?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

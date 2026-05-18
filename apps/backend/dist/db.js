"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.getSetting = getSetting;
exports.setSetting = setSetting;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const dbDir = node_path_1.default.resolve(process.cwd(), 'data');
node_fs_1.default.mkdirSync(dbDir, { recursive: true });
exports.db = new better_sqlite3_1.default(node_path_1.default.join(dbDir, 'studiocam.sqlite'));
exports.db.pragma('journal_mode = WAL');
exports.db.exec(`
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
function getSetting(key) {
    const row = exports.db.prepare(`SELECT value FROM settings WHERE key = ?`);
    const result = row.get(key);
    return result?.value ?? null;
}
function setSetting(key, value) {
    exports.db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}
//# sourceMappingURL=db.js.map
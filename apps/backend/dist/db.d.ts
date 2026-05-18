import Database from 'better-sqlite3';
export declare const db: Database;
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
export declare function getSetting(key: string): string | null;
export declare function setSetting(key: string, value: string): void;

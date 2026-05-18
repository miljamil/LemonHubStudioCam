import { SmtpSettings } from './storage-settings.js';
export interface RecordingMailInput {
    to: string[];
    sessionId: string;
    chunkIndex: number;
    filename: string;
    viewLink: string;
    downloadLink: string;
    sizeBytes: number;
    storageLabel?: string;
    attachment?: {
        filename: string;
        content: Buffer;
        contentType: string;
    };
}
export declare function sendRecordingMail(input: RecordingMailInput): Promise<void>;
export declare function testSmtpConnection(smtp: SmtpSettings): Promise<{
    ok: boolean;
    error?: string;
}>;

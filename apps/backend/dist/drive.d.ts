import { GoogleDriveSettings } from './storage-settings.js';
interface AuthUrlOptions {
    loginHint?: string;
    state?: string;
}
/** Build an OAuth consent URL so the business owner can grant Drive access once. */
export declare function buildAuthUrl(settings?: Partial<GoogleDriveSettings>, options?: AuthUrlOptions): string;
/** Exchange an OAuth code for a refresh token (one-time, for setup). */
export declare function exchangeCode(code: string, settings?: Partial<GoogleDriveSettings>): Promise<import("google-auth-library").Credentials>;
export declare function fetchAuthenticatedEmail(tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
}, settings?: Partial<GoogleDriveSettings>): Promise<string | null>;
export interface UploadedFile {
    id: string;
    webViewLink: string;
    webContentLink: string;
}
/** Upload a buffer to Drive and make it readable by link. */
export declare function uploadToDrive(filename: string, mimeType: string, buffer: Buffer, settings?: Partial<GoogleDriveSettings>): Promise<UploadedFile>;
export {};

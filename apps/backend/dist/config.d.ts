import 'dotenv/config';
export declare const config: {
    port: number;
    publicBaseUrl: string;
    maxChunkSeconds: number;
    localStorageDir: string;
    google: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
        refreshToken: string;
        folderId: string;
    };
    smtp: {
        host: string;
        port: number;
        secure: boolean;
        user: string;
        pass: string;
        from: string;
    };
};
export declare function hasDriveConfigured(): boolean;
export declare function hasSmtpConfigured(): boolean;
/** Throws if Drive credentials are not configured. Call from Drive routes only. */
export declare function assertDriveConfigured(): void;
/** Throws if SMTP is not configured. Call from mail routes only. */
export declare function assertSmtpConfigured(): void;

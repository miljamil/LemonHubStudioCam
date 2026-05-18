export type StorageMode = 'local' | 'google-drive';
export interface GoogleDriveSettings {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    folderId: string;
    refreshToken: string;
    linkedEmail: string;
}
export interface SmtpSettings {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
    linkedEmail: string;
}
export interface StorageSettings {
    storageMode: StorageMode;
    google: GoogleDriveSettings;
    smtp: SmtpSettings;
}
export declare function loadStorageSettings(): StorageSettings;
export declare function saveStorageSettings(input: {
    storageMode?: StorageMode;
    google?: Partial<GoogleDriveSettings>;
    smtp?: Partial<SmtpSettings>;
}): StorageSettings;
export declare function driveIsConfigured(settings?: StorageSettings): boolean;
export declare function driveOAuthClientReady(settings?: StorageSettings): boolean;
export declare function driveLinked(settings?: StorageSettings): boolean;
export declare function smtpIsConfigured(settings?: StorageSettings): boolean;

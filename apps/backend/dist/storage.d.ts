export interface LocalStoredFile {
    id: string;
    webViewLink: string;
    webContentLink: string;
    filePath: string;
}
export declare function saveLocally(filename: string, buffer: Buffer): Promise<LocalStoredFile>;

import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export interface LocalStoredFile {
  id: string;
  webViewLink: string;
  webContentLink: string;
  filePath: string;
}

export async function saveLocally(
  filename: string,
  buffer: Buffer,
): Promise<LocalStoredFile> {
  const dir = path.resolve(process.cwd(), config.localStorageDir);
  await fs.mkdir(dir, { recursive: true });

  const diskName = `${Date.now()}_${filename}`;
  const filePath = path.join(dir, diskName);
  await fs.writeFile(filePath, buffer);

  const publicPath = `/local-recordings/${encodeURIComponent(diskName)}`;
  return {
    id: diskName,
    webViewLink: `${config.publicBaseUrl}${publicPath}`,
    webContentLink: `${config.publicBaseUrl}${publicPath}`,
    filePath,
  };
}
import * as FileSystem from 'expo-file-system';
import { getValidDriveToken, getValidYouTubeToken } from './auth';

interface UploadResult {
  id: string;
  viewLink: string;
  downloadLink: string;
}

/**
 * Upload a file directly from the device to Google Drive.
 */
export async function uploadToDrive(
  fileUri: string,
  filename: string,
  mimeType: string,
): Promise<UploadResult> {
  const accessToken = await getValidDriveToken();
  if (!accessToken) throw new Error('Google Drive not connected. Please link your account.');

  // Read file content
  const fileBase64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Create metadata
  const metadata = {
    name: filename,
    mimeType,
  };

  // Use resumable upload for large files
  const initRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(metadata),
    },
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`Drive init failed: ${err}`);
  }

  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) throw new Error('No upload URL from Drive');

  // Convert base64 to binary for upload
  const binaryString = atob(fileBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(bytes.length),
    },
    body: bytes,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Drive upload failed: ${err}`);
  }

  const file = await uploadRes.json();

  // Make file viewable via link
  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  return {
    id: file.id,
    viewLink: `https://drive.google.com/file/d/${file.id}/view`,
    downloadLink: `https://drive.google.com/uc?export=download&id=${file.id}`,
  };
}

/**
 * Upload a file directly from the device to YouTube (as unlisted video).
 */
export async function uploadToYouTube(
  fileUri: string,
  title: string,
  mimeType: string,
): Promise<UploadResult> {
  const accessToken = await getValidYouTubeToken();
  if (!accessToken) throw new Error('YouTube not connected. Please link your account.');

  const fileBase64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const metadata = {
    snippet: {
      title,
      description: 'Uploaded via StudioCam mobile',
      categoryId: '10', // Music
    },
    status: {
      privacyStatus: 'unlisted',
    },
  };

  // Initiate resumable upload
  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify(metadata),
    },
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`YouTube init failed: ${err}`);
  }

  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) throw new Error('No upload URL from YouTube');

  const binaryString = atob(fileBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(bytes.length),
    },
    body: bytes,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`YouTube upload failed: ${err}`);
  }

  const video = await uploadRes.json();
  const watchUrl = `https://www.youtube.com/watch?v=${video.id}`;

  return {
    id: video.id,
    viewLink: watchUrl,
    downloadLink: watchUrl,
  };
}

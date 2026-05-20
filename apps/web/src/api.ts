const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

const rawBase = (env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '');

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`apiUrl expects an absolute path. Received: ${path}`);
  }
  return rawBase ? `${rawBase}${path}` : path;
}

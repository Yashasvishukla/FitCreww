import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { AzurePrivateBlobStorage, MediaPipelineError, type PrivateBlobStorage } from '@fitcrew/db/media-pipeline';

/**
 * Development storage must outlive a route-module reload. An in-memory adapter
 * is isolated per Next.js route bundle, so a PDF written by settlements could
 * not be read by the payslip route.
 */
export class LocalPrivateBlobStorage implements PrivateBlobStorage {
  constructor(private readonly root = resolve(process.env.LOCAL_MEDIA_STORAGE_PATH ?? defaultLocalStorageRoot())) {}

  async putPrivate(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async readPrivate(key: string): Promise<Uint8Array> {
    try { return await readFile(this.pathFor(key)); }
    catch { throw new MediaPipelineError('Media was not found.'); }
  }

  async createReadUrl(key: string, _expiresAt: Date): Promise<string> {
    const bytes = await this.readPrivate(key);
    const contentType = key.endsWith('.pdf') ? 'application/pdf' : key.endsWith('.jpg') || key.endsWith('.jpeg') ? 'image/jpeg' : 'application/octet-stream';
    return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    const rootWithSeparator = `${this.root}/`;
    const path = resolve(this.root, key);
    if (!path.startsWith(rootWithSeparator)) throw new MediaPipelineError('Invalid media key.');
    return path;
  }
}

function defaultLocalStorageRoot() {
  // Vercel functions can write only to /tmp. This fallback is intentionally
  // ephemeral: configure Azure storage before relying on media across cold
  // starts, deployments, or multiple function instances.
  return process.env.NODE_ENV === 'production' ? '/tmp/fitcrew-media' : '.fitcrew-media';
}

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
export const mediaStorage: PrivateBlobStorage = connectionString && process.env.AZURE_STORAGE_CONTAINER
  ? new AzurePrivateBlobStorage(connectionString, process.env.AZURE_STORAGE_CONTAINER)
  : new LocalPrivateBlobStorage();

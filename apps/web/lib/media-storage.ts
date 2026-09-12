import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { AzurePrivateBlobStorage, MediaPipelineError, type PrivateBlobStorage } from '@fitcrew/db/media-pipeline';

/**
 * Development storage must outlive a route-module reload. An in-memory adapter
 * is isolated per Next.js route bundle, so a PDF written by settlements could
 * not be read by the payslip route.
 */
export class LocalPrivateBlobStorage implements PrivateBlobStorage {
  constructor(private readonly root = resolve(process.env.LOCAL_MEDIA_STORAGE_PATH ?? '.fitcrew-media')) {}

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

class UnconfiguredPrivateBlobStorage implements PrivateBlobStorage {
  private fail(): never { throw new MediaPipelineError('Private media storage is not configured.'); }
  async putPrivate(): Promise<void> { this.fail(); }
  async readPrivate(): Promise<Uint8Array> { return this.fail(); }
  async createReadUrl(): Promise<string> { return this.fail(); }
  async delete(): Promise<void> { this.fail(); }
}

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
export const mediaStorage: PrivateBlobStorage = connectionString && process.env.AZURE_STORAGE_CONTAINER
  ? new AzurePrivateBlobStorage(connectionString, process.env.AZURE_STORAGE_CONTAINER)
  : process.env.NODE_ENV === 'production'
    ? new UnconfiguredPrivateBlobStorage()
    : new LocalPrivateBlobStorage();

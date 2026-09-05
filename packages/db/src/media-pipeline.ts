import { createHash, randomUUID } from 'node:crypto';
import { BlobServiceClient, BlobSASPermissions, StorageSharedKeyCredential, generateBlobSASQueryParameters } from '@azure/storage-blob';
import { Prisma, PrismaClient } from '@prisma/client';
import { accessGateForPrincipal, resolvePrincipal } from './access-gate.js';
import { prisma } from './prisma.js';
import { withTenant } from './with-tenant.js';

export interface PrivateBlobStorage { putPrivate(key: string, bytes: Uint8Array, contentType: string): Promise<void>; readPrivate(key: string): Promise<Uint8Array>; createReadUrl(key: string, expiresAt: Date): Promise<string>; delete(key: string): Promise<void>; }
export class MemoryPrivateBlobStorage implements PrivateBlobStorage {
  private readonly blobs = new Map<string, Uint8Array>();
  async putPrivate(key: string, bytes: Uint8Array): Promise<void> { this.blobs.set(key, bytes); }
  async readPrivate(key: string): Promise<Uint8Array> { const bytes = this.blobs.get(key); if (!bytes) throw new MediaPipelineError('Media was not found.'); return bytes; }
  async createReadUrl(key: string, expiresAt: Date): Promise<string> { if (!this.blobs.has(key)) throw new MediaPipelineError('Media was not found.'); return `memory://${encodeURIComponent(key)}?expires=${expiresAt.getTime()}`; }
  async delete(key: string): Promise<void> { this.blobs.delete(key); }
}
export class AzurePrivateBlobStorage implements PrivateBlobStorage {
  private readonly container;
  private readonly credential: StorageSharedKeyCredential;
  constructor(connectionString: string, containerName: string) {
    const service = BlobServiceClient.fromConnectionString(connectionString);
    this.container = service.getContainerClient(containerName);
    const match = connectionString.match(/AccountName=([^;]+).*AccountKey=([^;]+)/);
    if (!match) throw new MediaPipelineError('Invalid Azure storage configuration.');
    const [, accountName, accountKey] = match;
    if (!accountName || !accountKey) throw new MediaPipelineError('Invalid Azure storage configuration.');
    this.credential = new StorageSharedKeyCredential(accountName, accountKey);
  }
  async putPrivate(key: string, bytes: Uint8Array, contentType: string): Promise<void> { await this.container.getBlockBlobClient(key).uploadData(bytes, { blobHTTPHeaders: { blobContentType: contentType } }); }
  async readPrivate(key: string): Promise<Uint8Array> { return this.container.getBlockBlobClient(key).downloadToBuffer(); }
  async createReadUrl(key: string, expiresAt: Date): Promise<string> { const blob = this.container.getBlockBlobClient(key); const sas = generateBlobSASQueryParameters({ containerName: this.container.containerName, blobName: key, permissions: BlobSASPermissions.parse('r'), startsOn: new Date(Date.now() - 30_000), expiresOn: expiresAt }, this.credential).toString(); return `${blob.url}?${sas}`; }
  async delete(key: string): Promise<void> { await this.container.getBlockBlobClient(key).deleteIfExists(); }
}
export class MediaPipelineError extends Error { constructor(message: string) { super(message); this.name = 'MediaPipelineError'; } }
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function uploadClientPhoto(client: PrismaClient, tenantId: string, userId: string, input: { clientId: string; contentType: string; bytes: Uint8Array }, storage: PrivateBlobStorage) {
  if (!TYPES.has(input.contentType) || input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_PHOTO_BYTES) throw new MediaPipelineError('Photo must be JPEG, PNG, or WebP and no larger than 10 MB.');
  return withTenant(client as never, tenantId, async (tx: Prisma.TransactionClient) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    const target = principal && await tx.client.findFirst({ where: { id: input.clientId }, include: { currentCoachAssignment: true } });
    if (!principal || !target || !target.photoConsent || !(await accessGateForPrincipal(tx, principal).can(principal, 'create', { type: 'photo', tenantId, coachPartyId: target.currentCoachAssignment?.coachPartyId, organizationId: target.organizationId ?? undefined }))) throw new MediaPipelineError('Photo capture is not permitted.');
    const { default: sharp } = await import('sharp');
    const sanitized = await sharp(input.bytes).rotate().removeAlpha().jpeg({ quality: 90 }).toBuffer();
    const blobKey = `${tenantId}/${target.id}/${randomUUID()}.jpg`;
    await storage.putPrivate(blobKey, sanitized, 'image/jpeg');
    try {
      const asset = await tx.mediaAsset.create({ data: { tenantId, clientId: target.id, blobKey, contentType: 'image/jpeg', byteSize: sanitized.byteLength, sha256: createHash('sha256').update(sanitized).digest('hex') } });
      return { mediaAssetId: asset.id };
    } catch (error) { await storage.delete(blobKey); throw error; }
  });
}

export async function uploadPaymentProof(client: PrismaClient, tenantId: string, userId: string, input: { paymentId: string; contentType: string; bytes: Uint8Array }, storage: PrivateBlobStorage) {
  if (!TYPES.has(input.contentType) || input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_PHOTO_BYTES) throw new MediaPipelineError('Proof must be JPEG, PNG, or WebP and no larger than 10 MB.');
  return withTenant(client as never, tenantId, async (tx: Prisma.TransactionClient) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    const payment = principal && await tx.paymentRecord.findFirst({ where: { id: input.paymentId, status: 'pending' }, include: { subscription: { include: { client: { include: { currentCoachAssignment: true } } } } } });
    const assignment = payment?.subscription?.client.currentCoachAssignment;
    if (!principal || !payment || !assignment || !(await accessGateForPrincipal(tx, principal).can(principal, 'update', { type: 'payment', tenantId, coachPartyId: assignment.coachPartyId, organizationId: payment.subscription?.client.organizationId ?? undefined }))) throw new MediaPipelineError('Payment proof upload is not permitted.');
    const { default: sharp } = await import('sharp');
    const sanitized = await sharp(input.bytes).rotate().removeAlpha().jpeg({ quality: 90 }).toBuffer();
    const blobKey = `${tenantId}/payment-proofs/${payment.id}/${randomUUID()}.jpg`;
    await storage.putPrivate(blobKey, sanitized, 'image/jpeg');
    try { const asset = await tx.mediaAsset.create({ data: { tenantId, clientId: null, blobKey, contentType: 'image/jpeg', byteSize: sanitized.byteLength, sha256: createHash('sha256').update(sanitized).digest('hex') } }); return { mediaAssetId: asset.id }; }
    catch (error) { await storage.delete(blobKey); throw error; }
  });
}

export async function mintClientPhotoReadUrl(client: PrismaClient, tenantId: string, userId: string, mediaAssetId: string, storage: PrivateBlobStorage, now = new Date()) {
  return withTenant(client as never, tenantId, async (tx: Prisma.TransactionClient) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    const asset = principal && await tx.mediaAsset.findFirst({ where: { id: mediaAssetId, status: 'active' }, include: { client: { include: { currentCoachAssignment: true } } } });
    if (!principal || !asset?.client || !(await accessGateForPrincipal(tx, principal).can(principal, 'read', { type: 'photo', tenantId, coachPartyId: asset.client.currentCoachAssignment?.coachPartyId, organizationId: asset.client.organizationId ?? undefined }))) throw new MediaPipelineError('Photo access denied.');
    return { url: await storage.createReadUrl(asset.blobKey, new Date(now.getTime() + 10 * 60 * 1_000)), expiresAt: new Date(now.getTime() + 10 * 60 * 1_000) };
  });
}
export function cleanMediaPipelineError(error: unknown): string { return error instanceof MediaPipelineError ? error.message : 'Media operation failed.'; }
export { prisma };

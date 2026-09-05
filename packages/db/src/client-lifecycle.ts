import { Money } from '@fitcrew/domain';
import { Prisma, PrismaClient } from '@prisma/client';
import { accessGateForPrincipal, resolvePrincipal } from './access-gate.js';
import { prisma } from './prisma.js';
import { withTenant } from './with-tenant.js';
import { hashPassword } from './password.js';

type Tx = Prisma.TransactionClient;
export type EnrollmentInput = { name: string; email?: string; password?: string; price: string | number; coachPartyId: string; organizationId: string | null; schedule: unknown; photoConsent: boolean; subscriptionDurationMonths: number };
export type BaselineInput = { clientId: string; measurements: Record<string, number>; postureNotes: string; photoAssetIds?: string[] };
export type EvaluationInput = BaselineInput & { evaluatedAt?: string };
export type SatisfactionInput = { clientId: string; score: number; comment?: string };
export type ClientListEntry = { clientId: string; name: string; organizationId: string | null; coachPartyId: string | null; status: string; workflowState: string | null; photoConsent: boolean; };

export class ClientLifecycleError extends Error { constructor(message: string) { super(message); this.name = 'ClientLifecycleError'; } }

export async function enrollClientForUser(client: PrismaClient, tenantId: string, userId: string, input: EnrollmentInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal) throw new ClientLifecycleError('Forbidden.');
    const gate = accessGateForPrincipal(tx, principal);
    const name = input.name.trim();
    if (!name || name.length > 200 || !Number.isInteger(input.subscriptionDurationMonths) || input.subscriptionDurationMonths <= 0) throw new ClientLifecycleError('Valid client details are required.');
    const price = Money.inr(input.price);
    const coach = await tx.party.findFirst({ where: { id: input.coachPartyId, kind: 'person', status: 'active', roleAssignments: { some: { role: 'Coach', OR: input.organizationId ? [{ scopeType: 'tenant' }, { scopeType: 'organization', scopeId: input.organizationId }] : [{ scopeType: 'tenant' }] } } } });
    if (!coach) throw new ClientLifecycleError('A valid active coach is required.');
    if (input.organizationId) {
      const organization = await tx.organization.findFirst({ where: { id: input.organizationId, status: 'active' } });
      if (!organization) throw new ClientLifecycleError('Organization was not found.');
    }
    const allowed = await gate.can(principal, 'create', { type: 'client', tenantId, coachPartyId: input.coachPartyId, organizationId: input.organizationId ?? undefined });
    if (!allowed) throw new ClientLifecycleError('Forbidden.');
    const email = input.email?.trim().toLowerCase() || null;
    if (email && (!input.password || input.password.length < 12)) throw new ClientLifecycleError('Client password must be at least 12 characters.');
    const user = email ? await tx.user.create({ data: { email, name, passwordHash: await hashPassword(input.password!) } }) : null;
    const party = await tx.party.create({ data: { tenantId, kind: 'person', displayName: name, status: 'active', userId: user?.id ?? null } });
    const clientRecord = await tx.client.create({ data: { tenantId, partyId: party.id, organizationId: input.organizationId, enrolledByPartyId: principal.partyId, customPrice: price.toString(), schedule: input.schedule as Prisma.InputJsonValue, photoConsent: input.photoConsent, photoConsentAt: input.photoConsent ? new Date() : null, workflowState: 'enrollment' } });
    const assignment = await tx.clientCoachAssignment.create({ data: { tenantId, clientId: clientRecord.id, coachPartyId: input.coachPartyId, assignedByPartyId: principal.partyId, validFrom: today() } });
    if (user) await tx.roleAssignment.create({ data: { tenantId, partyId: party.id, role: 'Client', scopeType: 'self', scopeId: null, validFrom: today() } });
    await tx.client.updateMany({ where: { id: clientRecord.id }, data: { currentCoachAssignmentId: assignment.id } });
    if (input.photoConsent) await tx.consentRecord.create({ data: { tenantId, clientId: clientRecord.id, purpose: 'progress_photo', policyVersion: 'v1', state: 'granted', capturedByPartyId: principal.partyId, captureSource: 'enrollment', capturedAt: new Date() } });
    const endDate = addMonths(today(), input.subscriptionDurationMonths);
    await tx.subscription.create({ data: { tenantId, clientId: clientRecord.id, price: price.toString(), startDate: today(), durationMonths: input.subscriptionDurationMonths, endDate, status: 'active' } });
    await ensureWorkflow(tx, tenantId);
    return { clientId: clientRecord.id, partyId: party.id, assignmentId: assignment.id };
  });
}

export async function listClientsForUser(client: PrismaClient, tenantId: string, userId: string): Promise<readonly ClientListEntry[]> {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal) throw new ClientLifecycleError('Forbidden.');
    const rows = await tx.client.findMany({ where: accessGateForPrincipal(tx, principal).scopeQuery(principal, 'Client') as never, include: { party: true, currentCoachAssignment: true }, orderBy: { party: { displayName: 'asc' } } });
    return rows.map((row) => ({ clientId: row.id, name: row.party.displayName, organizationId: row.organizationId, coachPartyId: row.currentCoachAssignment?.coachPartyId ?? null, status: row.status, workflowState: row.workflowState, photoConsent: row.photoConsent }));
  });
}

export async function recordBaselineForUser(client: PrismaClient, tenantId: string, userId: string, input: BaselineInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal) throw new ClientLifecycleError('Forbidden.');
    const record = await tx.client.findFirst({ where: { id: input.clientId }, include: { currentCoachAssignment: true } });
    if (!record || !record.currentCoachAssignment || !(await accessGateForPrincipal(tx, principal).can(principal, 'update', { type: 'evaluation', tenantId, clientId: record.id, coachPartyId: record.currentCoachAssignment.coachPartyId, organizationId: record.organizationId ?? undefined } as never))) throw new ClientLifecycleError('Forbidden.');
    if (Object.values(input.measurements).some((value) => !Number.isFinite(value) || value < 0)) throw new ClientLifecycleError('Measurements must be non-negative numbers.');
    if (input.photoAssetIds?.length && !record.photoConsent) throw new ClientLifecycleError('Photo consent is required before capture.');
    const evaluation = await tx.evaluation.create({ data: { tenantId, clientId: record.id, coachAssignmentId: record.currentCoachAssignment.id, evaluatedByPartyId: principal.partyId, evaluatedAt: new Date(), type: 'baseline', measurements: input.measurements, postureNotes: input.postureNotes.trim(), deltas: {}, cadenceContext: { stage: 'baseline-intake' } } });
    if (input.photoAssetIds?.length) {
      const assets = await tx.mediaAsset.findMany({ where: { id: { in: input.photoAssetIds }, tenantId, clientId: record.id, status: 'active' }, select: { id: true } });
      if (assets.length !== new Set(input.photoAssetIds).size) throw new ClientLifecycleError('Photo assets are invalid or belong to another client.');
      for (const mediaAssetId of input.photoAssetIds) await tx.evaluationPhoto.create({ data: { tenantId, evaluationId: evaluation.id, mediaAssetId, viewType: 'other' } });
    }
    await tx.client.updateMany({ where: { id: record.id }, data: { workflowState: 'active' } });
    return { evaluationId: evaluation.id, clientId: record.id };
  });
}

export async function recordEvaluationForUser(client: PrismaClient, tenantId: string, userId: string, input: EvaluationInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal) throw new ClientLifecycleError('Forbidden.');
    const record = await tx.client.findFirst({ where: { id: input.clientId }, include: { currentCoachAssignment: true } });
    if (!record?.currentCoachAssignment || !(await accessGateForPrincipal(tx, principal).can(principal, 'update', { type: 'evaluation', tenantId, clientId: record.id, coachPartyId: record.currentCoachAssignment.coachPartyId, organizationId: record.organizationId ?? undefined } as never))) throw new ClientLifecycleError('Forbidden.');
    validateMeasurements(input.measurements);
    const previous = await tx.evaluation.findFirst({ where: { tenantId, clientId: record.id }, orderBy: { evaluatedAt: 'desc' } });
    const deltas = Object.fromEntries(Object.entries(input.measurements).flatMap(([key, value]) => {
      const old = previous && typeof previous.measurements === 'object' && previous.measurements && key in previous.measurements ? Number((previous.measurements as Record<string, unknown>)[key]) : NaN;
      return Number.isFinite(old) ? [[key, value - old]] : [];
    }));
    const photos = input.photoAssetIds ?? [];
    if (photos.length && !record.photoConsent) throw new ClientLifecycleError('Photo consent is required before capture.');
    if (photos.length) {
      const assets = await tx.mediaAsset.findMany({ where: { id: { in: photos }, tenantId, clientId: record.id, status: 'active' }, select: { id: true } });
      if (assets.length !== new Set(photos).size) throw new ClientLifecycleError('Photo assets are invalid or belong to another client.');
    }
    const evaluation = await tx.evaluation.create({ data: { tenantId, clientId: record.id, coachAssignmentId: record.currentCoachAssignment.id, evaluatedByPartyId: principal.partyId, evaluatedAt: input.evaluatedAt ? parseDateTime(input.evaluatedAt) : new Date(), type: 'periodic', measurements: input.measurements, postureNotes: input.postureNotes.trim(), deltas, cadenceContext: { comparedToEvaluationId: previous?.id ?? null } } });
    for (const mediaAssetId of photos) await tx.evaluationPhoto.create({ data: { tenantId, evaluationId: evaluation.id, mediaAssetId, viewType: 'other' } });
    return { evaluationId: evaluation.id, clientId: record.id, deltas };
  });
}

export async function listEvaluationsForUser(client: PrismaClient, tenantId: string, userId: string, clientId: string) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const { clientRecord } = await requireEvaluationClient(tx, tenantId, userId, clientId, 'read');
    const rows = await tx.evaluation.findMany({ where: { tenantId, clientId: clientRecord.id }, include: { photos: { include: { mediaAsset: true } } }, orderBy: { evaluatedAt: 'asc' } });
    return rows.map((row) => ({ id: row.id, type: row.type, evaluatedAt: row.evaluatedAt.toISOString(), measurements: row.measurements, postureNotes: row.postureNotes, deltas: row.deltas, photos: row.photos.map((photo) => ({ id: photo.id, mediaAssetId: photo.mediaAssetId, viewType: photo.viewType })) }));
  });
}

export async function recordSatisfactionForUser(client: PrismaClient, tenantId: string, userId: string, input: SatisfactionInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const { principal, clientRecord } = await requireEvaluationClient(tx, tenantId, userId, input.clientId, 'update');
    if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) throw new ClientLifecycleError('Satisfaction score must be 1–5.');
    const config = await tx.tenantConfig.findUnique({ where: { tenantId } });
    return tx.satisfactionRecord.create({ data: { tenantId, clientId: clientRecord.id, capturedByPartyId: principal.partyId, mode: config?.satisfactionMode ?? 'per_session', score: input.score, comment: input.comment?.trim() || null } });
  });
}

export async function getSatisfactionMetricsForUser(client: PrismaClient, tenantId: string, userId: string) {
  return withTenant(client as never, tenantId, async (tx: Tx) => { const principal = await resolvePrincipal(tx, tenantId, userId); if (!principal || !principal.assignments.some((assignment) => assignment.role === 'OwnerAdmin')) throw new ClientLifecycleError('Forbidden.'); const rows = await tx.satisfactionRecord.findMany({ where: { tenantId }, select: { score: true } }); return { count: rows.length, averageScore: rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : null }; });
}

function validateMeasurements(measurements: Record<string, number>) { if (!Object.keys(measurements).length || Object.values(measurements).some((value) => !Number.isFinite(value) || value < 0)) throw new ClientLifecycleError('Measurements must be non-negative numbers.'); }
function parseDateTime(value: string) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw new ClientLifecycleError('Evaluation date is invalid.'); return date; }
async function requireEvaluationClient(tx: Tx, tenantId: string, userId: string, clientId: string, action: 'read' | 'update' = 'update') {
  const principal = await resolvePrincipal(tx, tenantId, userId); if (!principal) throw new ClientLifecycleError('Forbidden.');
  const clientRecord = await tx.client.findFirst({ where: { id: clientId }, include: { currentCoachAssignment: true } });
  if (!clientRecord) throw new ClientLifecycleError('Forbidden.');
  const isClientRead = action === 'read' && principal.assignments.some((assignment) => assignment.role === 'Client');
  if ((!isClientRead && !clientRecord.currentCoachAssignment) || !(await accessGateForPrincipal(tx, principal).can(principal, action, { type: 'evaluation', tenantId, clientId, ownerPartyId: clientRecord.partyId, coachPartyId: clientRecord.currentCoachAssignment?.coachPartyId, organizationId: clientRecord.organizationId ?? undefined } as never))) throw new ClientLifecycleError('Forbidden.');
  return { principal, clientRecord };
}

async function ensureWorkflow(tx: Tx, tenantId: string): Promise<void> {
  const existing = await tx.workflowDefinition.findFirst({ where: { tenantId, status: 'active' } });
  if (existing) return;
  await tx.workflowDefinition.create({ data: { tenantId, name: 'Default client lifecycle', version: 1, status: 'active', activatedAt: new Date(), stages: { create: [{ tenantId, sequence: 1, stepType: 'baseline-intake', config: {}, isRequired: true }, { tenantId, sequence: 2, stepType: 'active-client', config: {}, isRequired: true }] } } });
}
function today(): Date { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); }
function addMonths(start: Date, months: number): Date { const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + months); end.setUTCDate(end.getUTCDate() - 1); return end; }
export function cleanClientLifecycleError(error: unknown): string { return error instanceof ClientLifecycleError ? error.message : 'Client lifecycle operation failed.'; }
export { prisma };

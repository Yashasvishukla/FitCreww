import { Money } from '@fitcrew/domain';
import { Prisma, PrismaClient } from '@prisma/client';
import { accessGateForPrincipal, resolvePrincipal } from './access-gate.js';
import { prisma } from './prisma.js';
import { withTenant } from './with-tenant.js';

type Tx = Prisma.TransactionClient;
export type EnrollmentInput = { name: string; price: string | number; coachPartyId: string; organizationId: string | null; schedule: unknown; photoConsent: boolean; subscriptionDurationMonths: number };
export type BaselineInput = { clientId: string; measurements: Record<string, number>; postureNotes: string; photoAssetIds?: string[] };
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
    const party = await tx.party.create({ data: { tenantId, kind: 'person', displayName: name, status: 'active' } });
    const clientRecord = await tx.client.create({ data: { tenantId, partyId: party.id, organizationId: input.organizationId, enrolledByPartyId: principal.partyId, customPrice: price.toString(), schedule: input.schedule as Prisma.InputJsonValue, photoConsent: input.photoConsent, photoConsentAt: input.photoConsent ? new Date() : null, workflowState: 'enrollment' } });
    const assignment = await tx.clientCoachAssignment.create({ data: { tenantId, clientId: clientRecord.id, coachPartyId: input.coachPartyId, assignedByPartyId: principal.partyId, validFrom: today() } });
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
    if (input.photoAssetIds) for (const mediaAssetId of input.photoAssetIds) await tx.evaluationPhoto.create({ data: { tenantId, evaluationId: evaluation.id, mediaAssetId, viewType: 'other' } });
    await tx.client.updateMany({ where: { id: record.id }, data: { workflowState: 'active' } });
    return { evaluationId: evaluation.id, clientId: record.id };
  });
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

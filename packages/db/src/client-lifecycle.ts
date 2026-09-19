import { effectiveAssignments } from '@fitcrew/application';
import { DomainError, Money } from '@fitcrew/domain';
import { Prisma, PrismaClient } from '@prisma/client';
import { accessGateForPrincipal, resolvePrincipal } from './access-gate.js';
import { prisma } from './prisma.js';
import { withTenant } from './with-tenant.js';
import { hashPassword } from './password.js';

type Tx = Prisma.TransactionClient;
export type EnrollmentInput = { name: string; email?: string; password?: string; price: string | number; coachPartyId: string; organizationId: string | null; schedule: unknown; photoConsent: boolean; subscriptionDurationMonths: number; billingCadence?: 'upfront' | 'monthly' };
export type ReassignCoachInput = { clientId: string; coachPartyId: string; reason?: string };
export type BaselineInput = { clientId: string; measurements: Record<string, number>; postureNotes: string; photoAssetIds?: string[] };
export type EvaluationInput = BaselineInput & { evaluatedAt?: string };
export type SatisfactionInput = { clientId: string; score: number; comment?: string };
export type NutritionInput = { clientId: string; foodName: string; mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack'; inputSource?: 'text' | 'camera' | 'barcode' | 'manual'; quantityText?: string; servingGrams?: number; loggedAt?: string; notes?: string; photoAssetId?: string; nutrition?: Partial<Pick<NutritionEstimate, 'calories' | 'proteinGrams' | 'carbGrams' | 'fatGrams' | 'fiberGrams' | 'confidence'>> };
export type ClientListEntry = { clientId: string; name: string; email: string | null; organizationId: string | null; coachPartyId: string | null; coachName?: string | null; status: string; workflowState: string | null; photoConsent: boolean; subscription?: { billingCadence: 'upfront' | 'monthly'; totalContractValue: string; installmentAmount: string; durationMonths: number; startDate: string; endDate: string; remainingBalance: string; remainingInstallments: number } | null; };
export type ClientPage = { clients: ClientListEntry[]; total: number; page: number; pageSize: number };
export type NutritionEstimateSource = 'usda-fdc' | 'fitcrew-local' | 'manual';
export type NutritionEstimate = { foodName: string; servingGrams: number; calories: number; proteinGrams: number; carbGrams: number; fatGrams: number; fiberGrams: number; confidence: number; matchedFood: string; source: NutritionEstimateSource; sourceId?: string; dataType?: string };
export type NutritionLogEntry = NutritionEstimate & { id: string; mealType: string; inputSource: string; quantityText: string | null; loggedAt: string; notes: string | null };
export type NutritionDaySummary = { date: string; totals: { calories: number; proteinGrams: number; carbGrams: number; fatGrams: number; fiberGrams: number }; byMeal: Record<string, { calories: number; count: number }>; entries: NutritionLogEntry[] };
export type NutritionCalendarDay = { date: string; calories: number; count: number };

export class ClientLifecycleError extends Error { constructor(message: string) { super(message); this.name = 'ClientLifecycleError'; } }

export async function enrollClientForUser(client: PrismaClient, tenantId: string, userId: string, input: EnrollmentInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal) throw new ClientLifecycleError('Forbidden.');
    const gate = accessGateForPrincipal(tx, principal);
    const name = input.name.trim();
    if (!name || name.length > 200 || !Number.isInteger(input.subscriptionDurationMonths) || input.subscriptionDurationMonths <= 0) throw new ClientLifecycleError('Valid client details are required.');
    const price = Money.inr(input.price);
    if (price.amountMinor <= 0n) throw new ClientLifecycleError('Subscription value must be positive.');
    const billingCadence = input.billingCadence ?? 'monthly';
    if (!['upfront', 'monthly'].includes(billingCadence)) throw new ClientLifecycleError('Billing cadence is invalid.');
    const installmentMinor = billingCadence === 'monthly' ? divideRoundHalfUp(price.amountMinor, BigInt(input.subscriptionDurationMonths)) : price.amountMinor;
    if (installmentMinor <= 0n) throw new ClientLifecycleError('Installment amount must be positive.');
    const assignments = effectiveAssignments(principal);
    const isOwner = assignments.some((assignment) => assignment.role === 'OwnerAdmin' && assignment.scopeType === 'tenant');
    const organizationAdminIds = assignments.filter((assignment) => assignment.role === 'OrgAdmin' && assignment.scopeType === 'organization').map((assignment) => assignment.scopeId).filter((scopeId): scopeId is string => scopeId !== null);
    const organizationId = !isOwner && organizationAdminIds.length > 0
      ? input.organizationId ?? (organizationAdminIds.length === 1 ? organizationAdminIds[0] : null)
      : input.organizationId;
    if (!isOwner && organizationAdminIds.length > 0 && (!organizationId || !organizationAdminIds.includes(organizationId))) throw new ClientLifecycleError('An organization-scoped client is required.');
    const coachScopes = organizationId && !isOwner ? [{ scopeType: 'organization' as const, scopeId: organizationId }] : organizationId ? [{ scopeType: 'tenant' as const }, { scopeType: 'organization' as const, scopeId: organizationId }] : [{ scopeType: 'tenant' as const }];
    const coach = await tx.party.findFirst({ where: { id: input.coachPartyId, kind: 'person', status: 'active', roleAssignments: { some: { role: 'Coach', OR: coachScopes } } } });
    if (!coach) throw new ClientLifecycleError('A valid active coach is required.');
    if (organizationId) {
      const organization = await tx.organization.findFirst({ where: { id: organizationId, tenantId, status: 'active' } });
      if (!organization) throw new ClientLifecycleError('Organization was not found.');
    }
    const allowed = await gate.can(principal, 'create', { type: 'client', tenantId, coachPartyId: input.coachPartyId, organizationId: organizationId ?? undefined });
    if (!allowed) throw new ClientLifecycleError('Forbidden.');
    const email = input.email?.trim().toLowerCase() || null;
    if (email && (!input.password || input.password.length < 12)) throw new ClientLifecycleError('Client password must be at least 12 characters.');
    const user = email ? await tx.user.create({ data: { email, name, passwordHash: await hashPassword(input.password!) } }) : null;
    const party = await tx.party.create({ data: { tenantId, kind: 'person', displayName: name, status: 'active', userId: user?.id ?? null } });
    const clientRecord = await tx.client.create({ data: { tenantId, partyId: party.id, organizationId, enrolledByPartyId: principal.partyId, customPrice: price.toString(), schedule: input.schedule as Prisma.InputJsonValue, photoConsent: input.photoConsent, photoConsentAt: input.photoConsent ? new Date() : null, workflowState: 'enrollment' } });
    const assignment = await tx.clientCoachAssignment.create({ data: { tenantId, clientId: clientRecord.id, coachPartyId: input.coachPartyId, assignedByPartyId: principal.partyId, validFrom: today() } });
    if (user) {
      await tx.roleAssignment.create({ data: { tenantId, partyId: party.id, role: 'Client', scopeType: 'self', scopeId: null, validFrom: today() } });
      await tx.userTenantMembership.create({ data: { userId: user.id, tenantId } });
    }
    await tx.client.updateMany({ where: { id: clientRecord.id }, data: { currentCoachAssignmentId: assignment.id } });
    if (input.photoConsent) await tx.consentRecord.create({ data: { tenantId, clientId: clientRecord.id, purpose: 'progress_photo', policyVersion: 'v1', state: 'granted', capturedByPartyId: principal.partyId, captureSource: 'enrollment', capturedAt: new Date() } });
    const endDate = addMonths(today(), input.subscriptionDurationMonths);
    await tx.subscription.create({ data: { tenantId, clientId: clientRecord.id, price: price.toString(), billingCadence, totalContractValue: price.toString(), installmentAmount: minorUnitsToAmount(installmentMinor), startDate: today(), durationMonths: input.subscriptionDurationMonths, endDate, status: 'active' } });
    await ensureWorkflow(tx, tenantId);
    return { clientId: clientRecord.id, partyId: party.id, assignmentId: assignment.id };
  });
}

export async function listClientsForUser(client: PrismaClient, tenantId: string, userId: string): Promise<readonly ClientListEntry[]> {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal) throw new ClientLifecycleError('Forbidden.');
    const rows = await tx.client.findMany({ where: accessGateForPrincipal(tx, principal).scopeQuery(principal, 'Client') as never, include: { party: { include: { user: { select: { email: true } } } }, currentCoachAssignment: { include: { coachParty: true } }, subscriptions: { where: { status: 'active' }, include: { payments: true }, orderBy: { endDate: 'desc' }, take: 1 } }, orderBy: { party: { displayName: 'asc' } } });
    return rows.map((row) => {
      const subscription = row.subscriptions[0];
      const confirmedAmount = subscription?.payments.filter((payment) => payment.purpose === 'client_subscription' && payment.status === 'confirmed').reduce((total, payment) => total + Number(payment.amount.toString()), 0) ?? 0;
      const confirmedInstallments = subscription ? new Set(subscription.payments.filter((payment) => payment.purpose === 'client_subscription' && payment.status === 'confirmed' && payment.installmentNumber !== null).map((payment) => payment.installmentNumber)).size : 0;
      const installmentCount = subscription?.billingCadence === 'monthly' ? subscription.durationMonths : 1;
      return { clientId: row.id, name: row.party.displayName, email: row.party.user?.email ?? null, organizationId: row.organizationId, coachPartyId: row.currentCoachAssignment?.coachPartyId ?? null, coachName: row.currentCoachAssignment?.coachParty.displayName ?? null, status: row.status, workflowState: row.workflowState, photoConsent: row.photoConsent, subscription: subscription ? { billingCadence: subscription.billingCadence, totalContractValue: subscription.totalContractValue.toString(), installmentAmount: subscription.installmentAmount.toString(), durationMonths: subscription.durationMonths, startDate: subscription.startDate.toISOString(), endDate: subscription.endDate.toISOString(), remainingBalance: Math.max(0, Number(subscription.totalContractValue.toString()) - confirmedAmount).toFixed(2), remainingInstallments: Math.max(0, installmentCount - confirmedInstallments) } : null };
    });
  });
}

export async function listClientPageForUser(client: PrismaClient, tenantId: string, userId: string, options: { query?: string; page?: number; pageSize?: number } = {}): Promise<ClientPage> {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal) throw new ClientLifecycleError('Forbidden.');
    const page = Math.max(1, Math.floor(options.page ?? 1));
    const pageSize = Math.min(20, Math.max(5, Math.floor(options.pageSize ?? 8)));
    const query = options.query?.trim();
    const scope = accessGateForPrincipal(tx, principal).scopeQuery(principal, 'Client');
    const where = query ? { AND: [scope, { party: { OR: [{ displayName: { contains: query, mode: 'insensitive' } }, { user: { email: { contains: query, mode: 'insensitive' } } }] } }] } : scope;
    const [rows, total] = await Promise.all([tx.client.findMany({ where: where as never, include: { party: { include: { user: { select: { email: true } } } }, currentCoachAssignment: true }, orderBy: { party: { displayName: 'asc' } }, skip: (page - 1) * pageSize, take: pageSize }), tx.client.count({ where: where as never })]);
    return { clients: rows.map((row) => ({ clientId: row.id, name: row.party.displayName, email: row.party.user?.email ?? null, organizationId: row.organizationId, coachPartyId: row.currentCoachAssignment?.coachPartyId ?? null, status: row.status, workflowState: row.workflowState, photoConsent: row.photoConsent })), total, page, pageSize };
  });
}

export async function getClientForUser(client: PrismaClient, tenantId: string, userId: string, clientId: string): Promise<ClientListEntry | null> {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal) throw new ClientLifecycleError('Forbidden.');
    const row = await tx.client.findFirst({ where: { AND: [accessGateForPrincipal(tx, principal).scopeQuery(principal, 'Client'), { id: clientId }] } as never, include: { party: { include: { user: { select: { email: true } } } }, currentCoachAssignment: true } });
    return row ? { clientId: row.id, name: row.party.displayName, email: row.party.user?.email ?? null, organizationId: row.organizationId, coachPartyId: row.currentCoachAssignment?.coachPartyId ?? null, status: row.status, workflowState: row.workflowState, photoConsent: row.photoConsent } : null;
  });
}

/** Close the current dated assignment and append a new one atomically. */
export async function reassignClientCoachForUser(client: PrismaClient, tenantId: string, userId: string, input: ReassignCoachInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal) throw new ClientLifecycleError('Forbidden.');
    const record = await tx.client.findFirst({ where: { id: input.clientId }, include: { currentCoachAssignment: true } });
    if (!record) throw new ClientLifecycleError('Client was not found.');
    if (!(await accessGateForPrincipal(tx, principal).can(principal, 'update', { type: 'client', id: record.id, tenantId, organizationId: record.organizationId ?? undefined }))) throw new ClientLifecycleError('Forbidden.');
    const isOwner = effectiveAssignments(principal).some((assignment) => assignment.role === 'OwnerAdmin' && assignment.scopeType === 'tenant');
    const coachScopes = record.organizationId && !isOwner ? [{ scopeType: 'organization' as const, scopeId: record.organizationId }] : record.organizationId ? [{ scopeType: 'tenant' as const }, { scopeType: 'organization' as const, scopeId: record.organizationId }] : [{ scopeType: 'tenant' as const }];
    const coach = await tx.party.findFirst({ where: { id: input.coachPartyId, tenantId, kind: 'person', status: 'active', roleAssignments: { some: { role: 'Coach', validTo: null, OR: coachScopes } } } });
    if (!coach) throw new ClientLifecycleError('A valid coach for this organization is required.');
    const from = today();
    if (record.currentCoachAssignment && record.currentCoachAssignment.coachPartyId === coach.id) return { assignmentId: record.currentCoachAssignment.id, clientId: record.id };
    if (record.currentCoachAssignment) await tx.clientCoachAssignment.update({ where: { id: record.currentCoachAssignment.id }, data: { validTo: new Date(from.getTime() - 86400000) } });
    const assignment = await tx.clientCoachAssignment.create({ data: { tenantId, clientId: record.id, coachPartyId: coach.id, assignedByPartyId: principal.partyId, validFrom: from, reason: input.reason?.trim() || null } });
    await tx.client.update({ where: { id: record.id }, data: { currentCoachAssignmentId: assignment.id } });
    return { assignmentId: assignment.id, clientId: record.id };
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

export async function recordNutritionForUser(client: PrismaClient, tenantId: string, userId: string, input: NutritionInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const { principal, clientRecord } = await requireEvaluationClient(tx, tenantId, userId, input.clientId, 'update');
    const foodName = input.foodName.trim();
    if (!foodName || foodName.length > 200) throw new ClientLifecycleError('Food name is required.');
    const servingGrams = input.servingGrams ?? parseServingGrams(input.quantityText) ?? undefined;
    const estimate = await estimateFoodNutritionFromBestSource(foodName, servingGrams);
    const usedManualOverride = input.nutrition !== undefined && Object.values(input.nutrition).some((value) => value !== undefined && value !== null);
    const nutrition = {
      calories: normalizeInt(input.nutrition?.calories, estimate.calories, 'Calories'),
      proteinGrams: normalizeMacro(input.nutrition?.proteinGrams, estimate.proteinGrams, 'Protein'),
      carbGrams: normalizeMacro(input.nutrition?.carbGrams, estimate.carbGrams, 'Carbs'),
      fatGrams: normalizeMacro(input.nutrition?.fatGrams, estimate.fatGrams, 'Fat'),
      fiberGrams: normalizeMacro(input.nutrition?.fiberGrams, estimate.fiberGrams, 'Fiber'),
      confidence: normalizeConfidence(input.nutrition?.confidence ?? estimate.confidence),
    };
    if (input.photoAssetId) {
      const asset = await tx.mediaAsset.findFirst({ where: { id: input.photoAssetId, tenantId, clientId: clientRecord.id, status: 'active' }, select: { id: true } });
      if (!asset) throw new ClientLifecycleError('Food photo asset is invalid.');
    }
    const row = await tx.nutritionLog.create({ data: { tenantId, clientId: clientRecord.id, capturedByPartyId: principal.partyId, photoAssetId: input.photoAssetId ?? null, mealType: input.mealType, inputSource: input.inputSource ?? (usedManualOverride ? 'manual' : 'text'), foodName, quantityText: input.quantityText?.trim() || null, servingGrams: servingGrams ?? estimate.servingGrams, calories: nutrition.calories, proteinGrams: nutrition.proteinGrams.toFixed(2), carbGrams: nutrition.carbGrams.toFixed(2), fatGrams: nutrition.fatGrams.toFixed(2), fiberGrams: nutrition.fiberGrams.toFixed(2), confidence: nutrition.confidence.toFixed(2), loggedAt: input.loggedAt ? parseDateTime(input.loggedAt) : new Date(), notes: input.notes?.trim() || null, metadata: { source: usedManualOverride ? 'manual' : estimate.source, upstreamSource: estimate.source, sourceId: estimate.sourceId ?? null, dataType: estimate.dataType ?? null, matchedFood: estimate.matchedFood, requestedServingGrams: servingGrams ?? null } } });
    return toNutritionEntry(row);
  });
}

export async function listNutritionForUser(client: PrismaClient, tenantId: string, userId: string, clientId: string, date = plainToday()): Promise<NutritionDaySummary> {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const { clientRecord } = await requireEvaluationClient(tx, tenantId, userId, clientId, 'read');
    const start = parsePlainDate(date);
    const end = new Date(start.getTime() + 86400000);
    const rows = await tx.nutritionLog.findMany({ where: { tenantId, clientId: clientRecord.id, loggedAt: { gte: start, lt: end } }, orderBy: { loggedAt: 'desc' } });
    const entries = rows.map(toNutritionEntry);
    const totals = entries.reduce((sum, entry) => ({ calories: sum.calories + entry.calories, proteinGrams: sum.proteinGrams + entry.proteinGrams, carbGrams: sum.carbGrams + entry.carbGrams, fatGrams: sum.fatGrams + entry.fatGrams, fiberGrams: sum.fiberGrams + entry.fiberGrams }), { calories: 0, proteinGrams: 0, carbGrams: 0, fatGrams: 0, fiberGrams: 0 });
    const byMeal = entries.reduce<Record<string, { calories: number; count: number }>>((mealSummary, entry) => {
      const current = mealSummary[entry.mealType] ?? { calories: 0, count: 0 };
      mealSummary[entry.mealType] = { calories: current.calories + entry.calories, count: current.count + 1 };
      return mealSummary;
    }, {});
    return { date, totals: roundTotals(totals), byMeal, entries };
  });
}

/** Lightweight month summary for the nutrition calendar. */
export async function listNutritionCalendarForUser(client: PrismaClient, tenantId: string, userId: string, clientId: string, month: string): Promise<NutritionCalendarDay[]> {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const { clientRecord } = await requireEvaluationClient(tx, tenantId, userId, clientId, 'read');
    if (!/^\d{4}-\d{2}$/.test(month)) throw new ClientLifecycleError('Nutrition month is invalid.');
    const start = new Date(`${month}-01T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) throw new ClientLifecycleError('Nutrition month is invalid.');
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
    const rows = await tx.nutritionLog.findMany({ where: { tenantId, clientId: clientRecord.id, loggedAt: { gte: start, lt: end } }, select: { loggedAt: true, calories: true } });
    const daily = new Map<string, NutritionCalendarDay>();
    for (const row of rows) {
      const date = row.loggedAt.toISOString().slice(0, 10);
      const current = daily.get(date) ?? { date, calories: 0, count: 0 };
      current.calories += row.calories; current.count += 1; daily.set(date, current);
    }
    return [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  });
}

/** Small date-range summary used by the seven-day nutrition history. */
export async function listNutritionHistoryForUser(client: PrismaClient, tenantId: string, userId: string, clientId: string, from: string, to: string): Promise<NutritionCalendarDay[]> {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const { clientRecord } = await requireEvaluationClient(tx, tenantId, userId, clientId, 'read');
    const start = parsePlainDate(from);
    const end = new Date(parsePlainDate(to).getTime() + 86400000);
    if (end <= start || end.getTime() - start.getTime() > 32 * 86400000) throw new ClientLifecycleError('Nutrition history range is invalid.');
    const rows = await tx.nutritionLog.findMany({ where: { tenantId, clientId: clientRecord.id, loggedAt: { gte: start, lt: end } }, select: { loggedAt: true, calories: true } });
    return summarizeNutritionDays(rows);
  });
}

export async function getSatisfactionMetricsForUser(client: PrismaClient, tenantId: string, userId: string) {
  return withTenant(client as never, tenantId, async (tx: Tx) => { const principal = await resolvePrincipal(tx, tenantId, userId); if (!principal || !effectiveAssignments(principal).some((assignment) => assignment.role === 'OwnerAdmin' && assignment.scopeType === 'tenant')) throw new ClientLifecycleError('Forbidden.'); const rows = await tx.satisfactionRecord.findMany({ where: { tenantId }, select: { score: true } }); return { count: rows.length, averageScore: rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : null }; });
}

function validateMeasurements(measurements: Record<string, number>) { if (!Object.keys(measurements).length || Object.values(measurements).some((value) => !Number.isFinite(value) || value < 0)) throw new ClientLifecycleError('Measurements must be non-negative numbers.'); }
function parseDateTime(value: string) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw new ClientLifecycleError('Evaluation date is invalid.'); return date; }
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint { return (numerator + denominator / 2n) / denominator; }
function minorUnitsToAmount(value: bigint): string { return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`; }
async function requireEvaluationClient(tx: Tx, tenantId: string, userId: string, clientId: string, action: 'read' | 'update' = 'update') {
  const principal = await resolvePrincipal(tx, tenantId, userId); if (!principal) throw new ClientLifecycleError('Forbidden.');
  const clientRecord = await tx.client.findFirst({ where: { id: clientId }, include: { currentCoachAssignment: true } });
  if (!clientRecord) throw new ClientLifecycleError('Forbidden.');
  const isClientRead = action === 'read' && effectiveAssignments(principal).some((assignment) => assignment.role === 'Client' && assignment.scopeType === 'self');
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

const FOOD_CATALOG = [
  { names: ['rice', 'white rice', 'cooked rice'], calories: 130, proteinGrams: 2.7, carbGrams: 28.2, fatGrams: 0.3, fiberGrams: 0.4 },
  { names: ['brown rice'], calories: 123, proteinGrams: 2.7, carbGrams: 25.6, fatGrams: 1, fiberGrams: 1.8 },
  { names: ['roti', 'chapati'], calories: 297, proteinGrams: 9.8, carbGrams: 46.4, fatGrams: 7.5, fiberGrams: 9.2 },
  { names: ['dal', 'lentils'], calories: 116, proteinGrams: 9, carbGrams: 20, fatGrams: 0.4, fiberGrams: 7.9 },
  { names: ['paneer'], calories: 265, proteinGrams: 18.3, carbGrams: 1.2, fatGrams: 20.8, fiberGrams: 0 },
  { names: ['chicken breast', 'chicken'], calories: 165, proteinGrams: 31, carbGrams: 0, fatGrams: 3.6, fiberGrams: 0 },
  { names: ['egg', 'eggs'], calories: 155, proteinGrams: 13, carbGrams: 1.1, fatGrams: 11, fiberGrams: 0 },
  { names: ['oats', 'oatmeal'], calories: 389, proteinGrams: 16.9, carbGrams: 66.3, fatGrams: 6.9, fiberGrams: 10.6 },
  { names: ['banana'], calories: 89, proteinGrams: 1.1, carbGrams: 22.8, fatGrams: 0.3, fiberGrams: 2.6 },
  { names: ['apple'], calories: 52, proteinGrams: 0.3, carbGrams: 13.8, fatGrams: 0.2, fiberGrams: 2.4 },
  { names: ['milk'], calories: 61, proteinGrams: 3.2, carbGrams: 4.8, fatGrams: 3.3, fiberGrams: 0 },
  { names: ['curd', 'yogurt'], calories: 98, proteinGrams: 3.5, carbGrams: 4.7, fatGrams: 4.3, fiberGrams: 0 },
  { names: ['poha'], calories: 180, proteinGrams: 3.3, carbGrams: 31, fatGrams: 4.8, fiberGrams: 2.2 },
  { names: ['idli'], calories: 156, proteinGrams: 4.5, carbGrams: 30, fatGrams: 1, fiberGrams: 2.1 },
  { names: ['dosa'], calories: 168, proteinGrams: 3.9, carbGrams: 29, fatGrams: 3.7, fiberGrams: 1.1 },
  { names: ['salad'], calories: 33, proteinGrams: 1.7, carbGrams: 6.5, fatGrams: 0.3, fiberGrams: 2.4 },
] as const;

export function estimateFoodNutrition(foodName: string, servingGrams = 100): NutritionEstimate {
  const normalized = foodName.toLowerCase();
  const match = FOOD_CATALOG.find((item) => item.names.some((name) => normalized.includes(name)));
  const reference = match ?? { names: ['generic food'], calories: 180, proteinGrams: 6, carbGrams: 22, fatGrams: 6, fiberGrams: 3 };
  const grams = Number.isInteger(servingGrams) && servingGrams > 0 ? servingGrams : 100;
  const ratio = grams / 100;
  return { foodName: foodName.trim(), servingGrams: grams, calories: Math.round(reference.calories * ratio), proteinGrams: roundMacro(reference.proteinGrams * ratio), carbGrams: roundMacro(reference.carbGrams * ratio), fatGrams: roundMacro(reference.fatGrams * ratio), fiberGrams: roundMacro(reference.fiberGrams * ratio), confidence: match ? 0.78 : 0.45, matchedFood: reference.names[0], source: 'fitcrew-local' };
}

export async function estimateFoodNutritionFromBestSource(foodName: string, servingGrams = 100, environment: NodeJS.ProcessEnv = process.env): Promise<NutritionEstimate> {
  const usda = await estimateFoodNutritionFromUsda(foodName, servingGrams, environment);
  return usda ?? estimateFoodNutrition(foodName, servingGrams);
}

export async function estimateFoodNutritionFromUsda(foodName: string, servingGrams = 100, environment: NodeJS.ProcessEnv = process.env): Promise<NutritionEstimate | null> {
  const apiKey = environment.USDA_FDC_API_KEY?.trim();
  if (!apiKey) return null;
  const grams = Number.isInteger(servingGrams) && servingGrams > 0 ? servingGrams : 100;
  const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
  url.searchParams.set('api_key', apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: foodName, pageSize: 5, dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'] }), signal: controller.signal });
    if (!response.ok) return null;
    const payload = await response.json() as FoodDataSearchResponse;
    const food = payload.foods?.find((item) => item.foodNutrients?.some((nutrient) => nutrient.nutrientNumber === '208' || nutrient.nutrientId === 1008));
    if (!food) return null;
    const per100g = {
      calories: readUsdaNutrient(food, ['208'], [1008]),
      proteinGrams: readUsdaNutrient(food, ['203'], [1003]),
      carbGrams: readUsdaNutrient(food, ['205'], [1005]),
      fatGrams: readUsdaNutrient(food, ['204'], [1004]),
      fiberGrams: readUsdaNutrient(food, ['291'], [1079]),
    };
    if (per100g.calories === null) return null;
    const ratio = grams / 100;
    return { foodName: foodName.trim(), servingGrams: grams, calories: Math.round(per100g.calories * ratio), proteinGrams: roundMacro((per100g.proteinGrams ?? 0) * ratio), carbGrams: roundMacro((per100g.carbGrams ?? 0) * ratio), fatGrams: roundMacro((per100g.fatGrams ?? 0) * ratio), fiberGrams: roundMacro((per100g.fiberGrams ?? 0) * ratio), confidence: 0.9, matchedFood: food.description, source: 'usda-fdc', sourceId: String(food.fdcId), dataType: food.dataType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

type FoodDataSearchResponse = { foods?: FoodDataSearchFood[] };
type FoodDataSearchFood = { fdcId: number; description: string; dataType?: string; foodNutrients?: FoodDataNutrient[] };
type FoodDataNutrient = { nutrientId?: number; nutrientNumber?: string; nutrientName?: string; value?: number };

function readUsdaNutrient(food: FoodDataSearchFood, nutrientNumbers: string[], nutrientIds: number[]): number | null {
  const nutrient = food.foodNutrients?.find((item) => (item.nutrientNumber && nutrientNumbers.includes(item.nutrientNumber)) || (item.nutrientId !== undefined && nutrientIds.includes(item.nutrientId)));
  return typeof nutrient?.value === 'number' && Number.isFinite(nutrient.value) ? nutrient.value : null;
}

function parseServingGrams(value?: string): number | null { const match = value?.match(/(\d{1,4})(?:\.\d+)?\s*(?:g|gram|grams)\b/i); return match ? Number.parseInt(match[1]!, 10) : null; }
function normalizeInt(value: unknown, fallback: number, label: string): number { if (value === undefined || value === null) return fallback; const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 0 || parsed > 20_000) throw new ClientLifecycleError(`${label} must be a non-negative whole number.`); return parsed; }
function normalizeMacro(value: unknown, fallback: number, label: string): number { if (value === undefined || value === null) return fallback; const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5_000) throw new ClientLifecycleError(`${label} must be a non-negative number.`); return roundMacro(parsed); }
function normalizeConfidence(value: unknown): number { const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new ClientLifecycleError('Nutrition confidence must be between 0 and 1.'); return roundMacro(parsed); }
function toNutritionEntry(row: { id: string; foodName: string; servingGrams: number | null; calories: number; proteinGrams: Prisma.Decimal | null; carbGrams: Prisma.Decimal | null; fatGrams: Prisma.Decimal | null; fiberGrams: Prisma.Decimal | null; confidence: Prisma.Decimal; mealType: string; inputSource: string; quantityText: string | null; loggedAt: Date; notes: string | null; metadata: Prisma.JsonValue }): NutritionLogEntry { const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {}; return { id: row.id, foodName: row.foodName, servingGrams: row.servingGrams ?? 100, calories: row.calories, proteinGrams: Number(row.proteinGrams ?? 0), carbGrams: Number(row.carbGrams ?? 0), fatGrams: Number(row.fatGrams ?? 0), fiberGrams: Number(row.fiberGrams ?? 0), confidence: Number(row.confidence), matchedFood: String(metadata.matchedFood ?? row.foodName), source: parseNutritionSource(metadata.source), sourceId: typeof metadata.sourceId === 'string' ? metadata.sourceId : undefined, dataType: typeof metadata.dataType === 'string' ? metadata.dataType : undefined, mealType: row.mealType, inputSource: row.inputSource, quantityText: row.quantityText, loggedAt: row.loggedAt.toISOString(), notes: row.notes }; }
function parseNutritionSource(value: unknown): NutritionEstimateSource { return value === 'usda-fdc' || value === 'manual' || value === 'fitcrew-local' ? value : 'fitcrew-local'; }
function summarizeNutritionDays(rows: { loggedAt: Date; calories: number }[]): NutritionCalendarDay[] { const daily = new Map<string, NutritionCalendarDay>(); for (const row of rows) { const date = row.loggedAt.toISOString().slice(0, 10); const current = daily.get(date) ?? { date, calories: 0, count: 0 }; current.calories += row.calories; current.count += 1; daily.set(date, current); } return [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)); }
function parsePlainDate(value: string): Date { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ClientLifecycleError('Nutrition date is invalid.'); const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.getTime())) throw new ClientLifecycleError('Nutrition date is invalid.'); return date; }
function plainToday(): string { return today().toISOString().slice(0, 10); }
function roundMacro(value: number): number { return Math.round(value * 10) / 10; }
function roundTotals<T extends Record<string, number>>(totals: T): T { return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, roundMacro(value)])) as T; }
export function cleanClientLifecycleError(error: unknown): string {
  if (error instanceof ClientLifecycleError) return error.message;
  if (error instanceof DomainError) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(', ') : String(error.meta?.target ?? '');
      if (target.includes('email')) return 'A user already exists with this client email.';
      if (target.includes('client_tenant_party_key')) return 'This person is already enrolled as a client in this workspace.';
      return 'A record with these details already exists.';
    }
    if (error.code === 'P2003') return 'One of the selected records no longer exists. Refresh and choose the coach or organization again.';
    if (error.code === 'P2000') return 'One of the enrollment fields is too long.';
  }

  const message = error instanceof Error ? error.message : '';
  if (message.includes('invalid input value for enum') && message.includes('self')) {
    return 'Client access is not fully migrated. Run database migrations before enrolling clients with login access.';
  }
  if (message.includes('role_assignment_client_scope') || message.includes('ScopeType')) {
    return 'Client access is not fully migrated. Run database migrations before enrolling clients with login access.';
  }

  return 'Client lifecycle operation failed.';
}
export { prisma };

import { ManualConfirmationSource, PercentageWithLifespanWindow, postLedgerEntry, type CommissionResult, type PostLedgerInput } from '@fitcrew/application';
import { Money } from '@fitcrew/domain';
import { Prisma, type PrismaClient } from '@prisma/client';
import { accessGateForPrincipal, resolvePrincipal } from './access-gate.js';
import { PrismaLedgerRepository } from './ledger.js';
import { withTenant } from './with-tenant.js';

type Tx = Prisma.TransactionClient;
export type PayoutHandleInput = { partyId: string; type: 'upi' | 'phone' | 'qr'; value: string; label?: string; isDefault?: boolean };
export type UpdatePayoutHandleInput = PayoutHandleInput & { handleId: string };
export type RecordClientPaymentInput = { subscriptionId: string; amount: string | number; method: 'upi' | 'qr' | 'phone' | 'other' };
export type RecordOrganizationPaymentInput = { organizationId: string; amount: string | number; method: 'upi' | 'qr' | 'phone' | 'other' };
export type ConfirmPaymentInput = { paymentId: string; utr?: string; proofMediaAssetId?: string };
export type ReversePaymentInput = { paymentId: string; method: 'upi' | 'qr' | 'phone' | 'other'; utr?: string; proofMediaAssetId?: string };
export class PaymentRecordingError extends Error { constructor(message: string) { super(message); this.name = 'PaymentRecordingError'; } }

export async function savePayoutHandleForUser(client: PrismaClient, tenantId: string, userId: string, input: PayoutHandleInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await requirePrincipal(tx, tenantId, userId);
    const party = await tx.party.findFirst({ where: { id: input.partyId, status: 'active' } });
    if (!party || !(await accessGateForPrincipal(tx, principal).can(principal, 'create', { type: 'payout_handle', tenantId, ownerPartyId: party.id, coachPartyId: party.id }))) throw new PaymentRecordingError('Forbidden.');
    const value = validateHandle(input.type, input.value);
    if (input.isDefault) await tx.payoutHandle.updateMany({ where: { partyId: party.id, isDefault: true }, data: { isDefault: false } });
    const handle = await tx.payoutHandle.create({ data: { tenantId, partyId: party.id, type: input.type, value, label: input.label?.trim() || null, isDefault: input.isDefault ?? false } });
    await audit(tx, tenantId, principal.partyId, 'create', 'payout_handle', handle.id, { type: handle.type, partyId: handle.partyId });
    return handle;
  });
}

export async function deletePayoutHandleForUser(client: PrismaClient, tenantId: string, userId: string, handleId: string) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await requirePrincipal(tx, tenantId, userId);
    const handle = await tx.payoutHandle.findFirst({ where: { id: handleId } });
    if (!handle || !(await accessGateForPrincipal(tx, principal).can(principal, 'delete', { type: 'payout_handle', id: handle.id, tenantId, ownerPartyId: handle.partyId, coachPartyId: handle.partyId }))) throw new PaymentRecordingError('Forbidden.');
    await tx.payoutHandle.deleteMany({ where: { id: handle.id } });
    await audit(tx, tenantId, principal.partyId, 'delete', 'payout_handle', handle.id, { partyId: handle.partyId });
    return { id: handle.id };
  });
}

export async function updatePayoutHandleForUser(client: PrismaClient, tenantId: string, userId: string, input: UpdatePayoutHandleInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await requirePrincipal(tx, tenantId, userId);
    const existing = await tx.payoutHandle.findFirst({ where: { id: input.handleId, partyId: input.partyId } });
    if (!existing || !(await accessGateForPrincipal(tx, principal).can(principal, 'update', { type: 'payout_handle', id: existing.id, tenantId, ownerPartyId: existing.partyId, coachPartyId: existing.partyId }))) throw new PaymentRecordingError('Forbidden.');
    if (input.isDefault) await tx.payoutHandle.updateMany({ where: { partyId: existing.partyId, isDefault: true, id: { not: existing.id } }, data: { isDefault: false } });
    const result = await tx.payoutHandle.updateMany({ where: { id: existing.id }, data: { type: input.type, value: validateHandle(input.type, input.value), label: input.label?.trim() || null, isDefault: input.isDefault ?? false } });
    if (result.count !== 1) throw new PaymentRecordingError('Payout handle was not updated.');
    await audit(tx, tenantId, principal.partyId, 'update', 'payout_handle', existing.id, { type: input.type, partyId: existing.partyId });
    return { id: existing.id };
  });
}

export async function recordClientPaymentForUser(client: PrismaClient, tenantId: string, userId: string, input: RecordClientPaymentInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await requirePrincipal(tx, tenantId, userId);
    const subscription = await tx.subscription.findFirst({ where: { id: input.subscriptionId }, include: { client: { include: { currentCoachAssignment: true } } } });
    const assignment = subscription?.client.currentCoachAssignment;
    if (!subscription || !assignment || !(await accessGateForPrincipal(tx, principal).can(principal, 'create', { type: 'payment', tenantId, coachPartyId: assignment.coachPartyId, organizationId: subscription.client.organizationId ?? undefined }))) throw new PaymentRecordingError('Forbidden.');
    const owner = principal.assignments.some((a) => a.role === 'OwnerAdmin')
      ? await tx.party.findFirst({ where: { id: principal.partyId, status: 'active' } })
      : (await tx.engagement.findFirst({ where: { downstreamPartyId: assignment.coachPartyId, validTo: null }, include: { upstreamParty: true }, orderBy: { validFrom: 'desc' } }))?.upstreamParty;
    if (!owner) throw new PaymentRecordingError('Tenant owner was not found.');
    const amount = Money.inr(input.amount);
    if (amount.amountMinor <= 0n) throw new PaymentRecordingError('Payment amount must be positive.');
    const payment = await tx.paymentRecord.create({ data: { tenantId, payerPartyId: subscription.client.partyId, payeePartyId: owner.id, subscriptionId: subscription.id, purpose: 'client_subscription', amount: amount.toString(), method: input.method, status: 'pending' } });
    await audit(tx, tenantId, principal.partyId, 'create', 'payment', payment.id, { status: 'pending', amount: amount.toString(), subscriptionId: subscription.id });
    return { id: payment.id, status: payment.status };
  });
}

/** Records the organization's one permitted agreement payment; confirmation uses the common evidence pipeline below. */
export async function recordOrganizationPaymentForUser(client: PrismaClient, tenantId: string, userId: string, input: RecordOrganizationPaymentInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await requireOwner(tx, tenantId, userId);
    const organization = await tx.organization.findFirst({ where: { id: input.organizationId, status: 'active' }, include: { party: true } });
    if (!organization) throw new PaymentRecordingError('Organization was not found.');
    const owner = await tx.party.findFirst({ where: { id: principal.partyId, status: 'active' } });
    if (!owner) throw new PaymentRecordingError('Tenant owner was not found.');
    const amount = Money.inr(input.amount); if (amount.amountMinor <= 0n) throw new PaymentRecordingError('Payment amount must be positive.');
    try {
      const payment = await tx.paymentRecord.create({ data: { tenantId, payerPartyId: organization.partyId, payeePartyId: owner.id, organizationId: organization.id, purpose: 'org_agreement', amount: amount.toString(), method: input.method, status: 'pending' } });
      await audit(tx, tenantId, principal.partyId, 'create', 'payment', payment.id, { status: 'pending', purpose: 'org_agreement', amount: amount.toString(), organizationId: organization.id });
      return { id: payment.id, status: payment.status };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new PaymentRecordingError('This organization already has an agreement payment record.');
      throw error;
    }
  });
}

export async function confirmPaymentForUser(client: PrismaClient, tenantId: string, userId: string, input: ConfirmPaymentInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await requirePrincipal(tx, tenantId, userId);
    const payment = await tx.paymentRecord.findFirst({ where: { id: input.paymentId }, include: { subscription: { include: { client: { include: { currentCoachAssignment: true } } } } } });
    const subscription = payment?.subscription;
    const assignment = subscription?.client.currentCoachAssignment;
    const isOrganizationPayment = payment?.purpose === 'org_agreement' && payment.organizationId !== null;
    const allowed = payment && payment.status === 'pending' && ((subscription && assignment && await accessGateForPrincipal(tx, principal).can(principal, 'update', { type: 'payment', id: payment.id, tenantId, coachPartyId: assignment.coachPartyId, organizationId: subscription.client.organizationId ?? undefined })) || (isOrganizationPayment && principal.assignments.some((a) => a.role === 'OwnerAdmin')));
    if (!payment || !allowed) throw new PaymentRecordingError('Payment is unavailable for confirmation.');
    const confirmation = await new ManualConfirmationSource(input).awaitConfirmation(payment.id);
    if (confirmation.proofMediaAssetId) {
      const proof = await tx.mediaAsset.findFirst({ where: { id: confirmation.proofMediaAssetId, status: 'active' } });
      if (!proof) throw new PaymentRecordingError('Payment proof was not found.');
    }
    const updated = await tx.paymentRecord.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'confirmed', utr: confirmation.utr, proofMediaAssetId: confirmation.proofMediaAssetId, confirmationSource: confirmation.source, confirmedByPartyId: principal.partyId, confirmedAt: confirmation.confirmedAt } });
    if (updated.count !== 1) throw new PaymentRecordingError('Payment was already confirmed.');
    const amountMinor = decimalToMinor(payment.amount.toString());
    const commission = subscription && assignment ? await accrueCommission(tx, tenantId, payment.id, payment.payeePartyId, subscription.client.id, assignment.id, assignment.coachPartyId, amountMinor, confirmation.confirmedAt) : null;
    const lines: PostLedgerInput['lines'] = [
      { partyId: payment.payeePartyId, purpose: 'owner_cash', direction: 'debit', amountMinor: decimalToMinor(payment.amount.toString()) },
      { partyId: payment.payerPartyId, purpose: isOrganizationPayment ? 'org_agreement_receivable' : 'client_receivable', direction: 'credit', amountMinor: decimalToMinor(payment.amount.toString()) },
      ...(commission ? [
        { partyId: payment.payerPartyId, purpose: 'client_receivable' as const, direction: 'debit' as const, amountMinor },
        ...(commission.commissionAmountMinor > 0n ? [{ partyId: payment.payeePartyId, purpose: 'commission_income' as const, direction: 'credit' as const, amountMinor: commission.commissionAmountMinor }] : []),
        { partyId: assignment!.coachPartyId, purpose: 'coach_payable' as const, direction: 'credit' as const, amountMinor: commission.coachPayableAmountMinor },
      ] : []),
    ];
    await postLedgerEntry(new PrismaLedgerRepository(tx), { tenantId, description: `Client payment ${payment.id}`, referenceType: 'payment', referenceId: payment.id, lines });
    await audit(tx, tenantId, principal.partyId, 'update', 'payment', payment.id, { status: 'confirmed', source: confirmation.source, utr: confirmation.utr, proofMediaAssetId: confirmation.proofMediaAssetId, commissionAccrued: commission ? minorUnitsToAmount(commission.commissionAmountMinor) : null });
    return { id: payment.id, status: 'confirmed' as const, confirmedAt: confirmation.confirmedAt.toISOString(), commissionAmount: commission ? minorUnitsToAmount(commission.commissionAmountMinor) : null, coachPayableAmount: commission ? minorUnitsToAmount(commission.coachPayableAmountMinor) : null };
  });
}

/** Posts a linked, immutable refund and a signed accrual that is picked up by the next settlement. */
export async function reverseClientPaymentForUser(client: PrismaClient, tenantId: string, userId: string, input: ReversePaymentInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await requireOwner(tx, tenantId, userId);
    const original = await tx.paymentRecord.findFirst({ where: { id: input.paymentId }, include: { commissionAccruals: true, subscription: { include: { client: { include: { currentCoachAssignment: true } } } } } });
    const accrual = original?.commissionAccruals.find((row) => row.kind === 'earning');
    const assignment = original?.subscription?.client.currentCoachAssignment;
    if (!original || original.purpose !== 'client_subscription' || original.status !== 'confirmed' || !original.subscription || !assignment) throw new PaymentRecordingError('Only a confirmed, unreversed client payment can be refunded.');
    const confirmation = await new ManualConfirmationSource(input).awaitConfirmation(original.id); await validateProof(tx, confirmation.proofMediaAssetId);
    const config = await tx.tenantConfig.findFirstOrThrow({ where: { tenantId } });
    const grossMinor = decimalToMinor(original.amount.toString());
    const originalCommissionMinor = accrual ? decimalToMinor(accrual.commissionAmount.toString()) : 0n;
    const originalCoachMinor = accrual ? decimalToMinor(accrual.coachPayableAmount.toString()) : 0n;
    const clawbackRateBasisPoints = decimalRateToBasisPoints(config.refundCoachClawbackRate.toString());
    const coachClawbackMinor = divideRoundHalfUp(originalCoachMinor * BigInt(clawbackRateBasisPoints), 10_000n);
    const ownerAbsorptionMinor = originalCoachMinor - coachClawbackMinor;
    const originalEntry = await tx.ledgerEntry.findFirstOrThrow({ where: { referenceType: 'payment', referenceId: original.id } });
    const correction = await tx.paymentRecord.create({ data: { tenantId, payerPartyId: original.payeePartyId, payeePartyId: original.payerPartyId, purpose: 'correction', amount: original.amount, method: input.method, status: 'confirmed', reversesPaymentId: original.id, utr: confirmation.utr, proofMediaAssetId: confirmation.proofMediaAssetId, confirmationSource: confirmation.source, confirmedByPartyId: principal.partyId, confirmedAt: confirmation.confirmedAt } });
    const reversed = await tx.paymentRecord.updateMany({ where: { id: original.id, status: 'confirmed' }, data: { status: 'reversed' } });
    if (reversed.count !== 1) throw new PaymentRecordingError('Payment was already reversed.');
    if (accrual) await tx.commissionAccrual.create({ data: { tenantId, paymentId: correction.id, kind: 'correction', reversesAccrualId: accrual.id, engagementId: accrual.engagementId, clientId: accrual.clientId, coachAssignmentId: accrual.coachAssignmentId, grossAmount: amountSigned(-grossMinor), rateApplied: accrual.rateApplied, lifespanMonthsApplied: accrual.lifespanMonthsApplied, windowAnchorAt: accrual.windowAnchorAt, windowEndAt: accrual.windowEndAt, commissionAmount: amountSigned(-(grossMinor - coachClawbackMinor)), coachPayableAmount: amountSigned(-coachClawbackMinor), withinLifespan: accrual.withinLifespan } });
    const lines: Array<PostLedgerInput['lines'][number]> = [{ partyId: original.payeePartyId, purpose: 'owner_cash', direction: 'credit', amountMinor: grossMinor }];
    if (accrual) {
      if (originalCommissionMinor > 0n) lines.push({ partyId: original.payeePartyId, purpose: 'commission_income', direction: 'debit', amountMinor: originalCommissionMinor });
      if (coachClawbackMinor > 0n) lines.push({ partyId: assignment.coachPartyId, purpose: 'coach_payable', direction: 'debit', amountMinor: coachClawbackMinor });
      if (ownerAbsorptionMinor > 0n) lines.push({ partyId: original.payeePartyId, purpose: 'refund_absorption_expense', direction: 'debit', amountMinor: ownerAbsorptionMinor });
    } else lines.push({ partyId: original.payerPartyId, purpose: 'client_receivable', direction: 'debit', amountMinor: grossMinor });
    await postLedgerEntry(new PrismaLedgerRepository(tx), { tenantId, description: `Refund of client payment ${original.id}`, referenceType: 'correction', referenceId: correction.id, reversesEntryId: originalEntry.id, lines });
    await audit(tx, tenantId, principal.partyId, 'reverse', 'payment', original.id, { correctionPaymentId: correction.id, refundAmount: original.amount.toString(), coachClawbackRate: config.refundCoachClawbackRate.toString(), coachClawbackAmount: minorUnitsToAmount(coachClawbackMinor), ownerAbsorptionAmount: minorUnitsToAmount(ownerAbsorptionMinor) });
    await audit(tx, tenantId, principal.partyId, 'create', 'payment_correction', correction.id, { reversesPaymentId: original.id, source: confirmation.source, utr: confirmation.utr, proofMediaAssetId: confirmation.proofMediaAssetId });
    return { id: correction.id, reversesPaymentId: original.id, status: 'confirmed' as const, coachClawbackAmount: minorUnitsToAmount(coachClawbackMinor), ownerAbsorptionAmount: minorUnitsToAmount(ownerAbsorptionMinor) };
  });
}

export async function updateRefundClawbackRateForUser(client: PrismaClient, tenantId: string, userId: string, rate: string | number) {
  return withTenant(client as never, tenantId, async (tx: Tx) => { const principal = await requireOwner(tx, tenantId, userId); const value = Number(rate); if (!Number.isFinite(value) || value < 0 || value > 100) throw new PaymentRecordingError('Refund claw-back rate must be between 0 and 100%.'); const result = await tx.tenantConfig.updateMany({ where: { tenantId }, data: { refundCoachClawbackRate: value.toFixed(2) } }); if (result.count !== 1) throw new PaymentRecordingError('Money configuration was not updated.'); const updated = await tx.tenantConfig.findFirstOrThrow({ where: { tenantId } }); await audit(tx, tenantId, principal.partyId, 'update', 'money_config', tenantId, { refundCoachClawbackRate: updated.refundCoachClawbackRate.toString() }); return { refundCoachClawbackRate: updated.refundCoachClawbackRate.toString() }; });
}

export async function getMoneyWorkspaceForUser(client: PrismaClient, tenantId: string, userId: string) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await requirePrincipal(tx, tenantId, userId);
    const ownerAccess = principal.assignments.some((a) => a.role === 'OwnerAdmin');
    const owner = ownerAccess
      ? await tx.party.findFirst({ where: { id: principal.partyId } })
      : (await tx.engagement.findFirst({ where: { downstreamPartyId: principal.partyId, validTo: null }, include: { upstreamParty: true }, orderBy: { validFrom: 'desc' } }))?.upstreamParty;
    if (!owner) throw new PaymentRecordingError('Tenant owner was not found.');
    const paymentWhere = ownerAccess ? { tenantId } : { tenantId, subscription: { client: { currentCoachAssignment: { coachPartyId: principal.partyId } } } };
    const [handles, payments, subscriptions, organizations, config] = await Promise.all([
      tx.payoutHandle.findMany({ where: ownerAccess ? { tenantId } : { tenantId, partyId: { in: [owner.id, principal.partyId] } }, include: { party: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }),
      tx.paymentRecord.findMany({ where: paymentWhere, include: { payer: true, payee: true, commissionAccruals: true, subscription: { include: { client: { include: { party: true } } } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
      tx.subscription.findMany({ where: ownerAccess ? { tenantId, status: 'active' } : { tenantId, status: 'active', client: { currentCoachAssignment: { coachPartyId: principal.partyId } } }, include: { client: { include: { party: true } } }, orderBy: { endDate: 'desc' } }),
      ownerAccess ? tx.organization.findMany({ where: { tenantId, status: 'active' }, include: { party: true }, orderBy: { createdAt: 'desc' } }) : Promise.resolve([]),
      tx.tenantConfig.findFirstOrThrow({ where: { tenantId } }),
    ]);
    return { ownerAccess, principalPartyId: principal.partyId, ownerPartyId: owner.id, refundCoachClawbackRate: config.refundCoachClawbackRate.toString(), handles: handles.map((h) => ({ id: h.id, partyId: h.partyId, partyName: h.party.displayName, type: h.type, value: h.value, label: h.label, isDefault: h.isDefault })), payments: payments.map((p) => { const accrual = p.commissionAccruals[0]; return { id: p.id, purpose: p.purpose, reversesPaymentId: p.reversesPaymentId, clientName: p.subscription?.client.party.displayName ?? p.payer.displayName, amount: p.amount.toString(), method: p.method, status: p.status, utr: p.utr, createdAt: p.createdAt.toISOString(), confirmedAt: p.confirmedAt?.toISOString() ?? null, accrual: accrual ? { kind: accrual.kind, commissionAmount: accrual.commissionAmount.toString(), coachPayableAmount: accrual.coachPayableAmount.toString(), rateApplied: accrual.rateApplied.toString(), withinLifespan: accrual.withinLifespan, windowEndAt: accrual.windowEndAt.toISOString() } : null }; }), subscriptions: subscriptions.map((s) => ({ id: s.id, clientName: s.client.party.displayName, price: s.price.toString() })), organizations: organizations.map((organization) => ({ id: organization.id, name: organization.party.displayName })) };
  });
}

function validateHandle(type: PayoutHandleInput['type'], raw: string): string { const value = raw.trim(); if (!value || value.length > 500) throw new PaymentRecordingError('A valid payout handle is required.'); if (type === 'upi' && !/^[\w.-]{2,256}@[A-Za-z]{2,64}$/.test(value)) throw new PaymentRecordingError('UPI ID is invalid.'); if (type === 'phone' && !/^\+?[1-9]\d{9,14}$/.test(value)) throw new PaymentRecordingError('Phone number is invalid.'); return value; }
function decimalToMinor(value: string): bigint { const [major, minor = ''] = value.split('.'); return BigInt(major!) * 100n + BigInt(minor.padEnd(2, '0').slice(0, 2)); }
function decimalRateToBasisPoints(value: string): number { const [major, fraction = ''] = value.split('.'); return Number(major) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2)); }
function minorUnitsToAmount(value: bigint): string { return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`; }
function amountSigned(value: bigint): string { const sign = value < 0n ? '-' : ''; const absolute = value < 0n ? -value : value; return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`; }
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint { return (numerator + denominator / 2n) / denominator; }
async function validateProof(tx: Tx, proofMediaAssetId: string | null) { if (proofMediaAssetId && !(await tx.mediaAsset.findFirst({ where: { id: proofMediaAssetId, status: 'active' } }))) throw new PaymentRecordingError('Payment proof was not found.'); }
async function accrueCommission(tx: Tx, tenantId: string, paymentId: string, ownerPartyId: string, clientId: string, assignmentId: string, coachPartyId: string, grossAmountMinor: bigint, confirmedAt: Date): Promise<CommissionResult | null> {
  if (ownerPartyId === coachPartyId) return null;
  const day = new Date(Date.UTC(confirmedAt.getUTCFullYear(), confirmedAt.getUTCMonth(), confirmedAt.getUTCDate()));
  const engagement = await tx.engagement.findFirst({ where: { upstreamPartyId: ownerPartyId, downstreamPartyId: coachPartyId, validFrom: { lte: day }, OR: [{ validTo: null }, { validTo: { gte: day } }] } });
  if (!engagement) throw new PaymentRecordingError('Active commission terms were not found for the assigned coach.');
  await tx.$executeRaw`INSERT INTO public.client_engagement_clock (tenant_id, client_id, engagement_id, coach_assignment_id, anchor_at) VALUES (${tenantId}::uuid, ${clientId}::uuid, ${engagement.id}::uuid, ${assignmentId}::uuid, ${confirmedAt}) ON CONFLICT (tenant_id, client_id, engagement_id, coach_assignment_id) DO NOTHING`;
  const clock = await tx.clientEngagementClock.findFirstOrThrow({ where: { clientId, engagementId: engagement.id, coachAssignmentId: assignmentId } });
  const result = new PercentageWithLifespanWindow().compute({ amountMinor: grossAmountMinor, confirmedAt }, { rateBasisPoints: decimalRateToBasisPoints(engagement.commissionRate.toString()), lifespanMonths: engagement.commissionLifespanMonths }, { anchorAt: clock.anchorAt });
  await tx.commissionAccrual.create({ data: { tenantId, paymentId, engagementId: engagement.id, clientId, coachAssignmentId: assignmentId, grossAmount: minorUnitsToAmount(result.grossAmountMinor), rateApplied: (result.rateBasisPointsApplied / 100).toFixed(2), lifespanMonthsApplied: result.lifespanMonthsApplied, windowAnchorAt: result.windowAnchorAt, windowEndAt: result.windowEndAt, commissionAmount: minorUnitsToAmount(result.commissionAmountMinor), coachPayableAmount: minorUnitsToAmount(result.coachPayableAmountMinor), withinLifespan: result.withinLifespan } });
  return result;
}
async function requirePrincipal(tx: Tx, tenantId: string, userId: string) { const principal = await resolvePrincipal(tx, tenantId, userId); if (!principal) throw new PaymentRecordingError('Forbidden.'); return principal; }
async function requireOwner(tx: Tx, tenantId: string, userId: string) { const principal = await requirePrincipal(tx, tenantId, userId); if (!principal.assignments.some((a) => a.role === 'OwnerAdmin')) throw new PaymentRecordingError('Forbidden.'); return principal; }
async function audit(tx: Tx, tenantId: string, actorPartyId: string, action: string, resourceType: string, resourceId: string, after: object) { await tx.auditLog.create({ data: { tenantId, actorPartyId, action, resourceType, resourceId, before: Prisma.JsonNull, after } }); }
export function cleanPaymentRecordingError(error: unknown): string { return error instanceof PaymentRecordingError || error instanceof Error && error.name === 'LedgerInvariantError' ? error.message : 'Payment operation failed.'; }

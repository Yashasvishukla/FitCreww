import { effectiveAssignments, ManualConfirmationSource, PercentageWithLifespanWindow, postLedgerEntry, type CommissionResult, type PostLedgerInput } from '@fitcrew/application';
import { Money } from '@fitcrew/domain';
import { Prisma, type PrismaClient } from '@prisma/client';
import Razorpay from 'razorpay';
import { validatePaymentVerification, validateWebhookSignature } from 'razorpay/dist/utils/razorpay-utils';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { accessGateForPrincipal, resolvePrincipal } from './access-gate.js';
import { PrismaLedgerRepository } from './ledger.js';
import { withTenant } from './with-tenant.js';

type Tx = Prisma.TransactionClient;
export type PayoutHandleInput = { partyId: string; type: 'upi' | 'phone' | 'qr'; value: string; label?: string; isDefault?: boolean };
export type UpdatePayoutHandleInput = PayoutHandleInput & { handleId: string };
type PaymentMethodInput = 'upi' | 'qr' | 'phone' | 'razorpay' | 'other';
export type RecordClientPaymentInput = { subscriptionId: string; amount?: string | number; method: PaymentMethodInput };
export type RecordOrganizationPaymentInput = { organizationId: string; amount: string | number; method: PaymentMethodInput };
export type ConfirmPaymentInput = { paymentId: string; utr?: string; proofMediaAssetId?: string };
export type ConfirmRazorpayPaymentInput = { paymentId: string; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string };
export type ConfirmRazorpayWebhookInput = { rawBody: string; signature: string; eventId: string };
export type CreateRazorpayOrderInput = { kind: 'client'; subscriptionId: string } | { kind: 'organization'; organizationId: string; amount: string | number };
type RazorpayOrderResult = {
  keyId: string;
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: 'INR';
  name: string;
  description: string;
  checkoutMode: 'test' | 'live' | 'mock';
  mockConfirmation?: {
    razorpayPaymentId: string;
    razorpaySignature: string;
  };
};
export type ReversePaymentInput = { paymentId: string; method: PaymentMethodInput; utr?: string; proofMediaAssetId?: string };
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
  assertPermittedClientCollectionMethod(input.method);
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await requirePrincipal(tx, tenantId, userId);
    const subscription = await tx.subscription.findFirst({ where: { id: input.subscriptionId }, include: { payments: true, client: { include: { currentCoachAssignment: true } } } });
    const assignment = subscription?.client.currentCoachAssignment;
    if (!subscription || !assignment || !(await accessGateForPrincipal(tx, principal).can(principal, 'create', { type: 'payment', tenantId, coachPartyId: assignment.coachPartyId, organizationId: subscription.client.organizationId ?? undefined }))) throw new PaymentRecordingError('Forbidden.');
    const owner = effectiveAssignments(principal).some((assignment) => assignment.role === 'OwnerAdmin' && assignment.scopeType === 'tenant')
      ? await tx.party.findFirst({ where: { id: principal.partyId, status: 'active' } })
      : (await tx.engagement.findFirst({ where: { downstreamPartyId: assignment.coachPartyId, validTo: null }, include: { upstreamParty: true }, orderBy: { validFrom: 'desc' } }))?.upstreamParty;
    if (!owner) throw new PaymentRecordingError('Tenant owner was not found.');
    // A gateway timeout happens after this local record is created. Keep the
    // same financial identity on retry instead of advancing the installment or
    // creating a second pending receivable.
    const existingPending = subscription.payments.find((payment) => payment.purpose === 'client_subscription' && payment.status === 'pending');
    if (existingPending) return { id: existingPending.id, status: existingPending.status, amount: existingPending.amount.toString(), installmentNumber: existingPending.installmentNumber!, billingPeriodStart: isoDate(existingPending.billingPeriodStart!), billingPeriodEnd: isoDate(existingPending.billingPeriodEnd!) };
    const due = nextSubscriptionInstallment(subscription);
    const payment = await tx.paymentRecord.create({ data: { tenantId, payerPartyId: subscription.client.partyId, payeePartyId: owner.id, subscriptionId: subscription.id, purpose: 'client_subscription', amount: due.amount, method: input.method, status: 'pending', installmentNumber: due.installmentNumber, billingPeriodStart: due.periodStart, billingPeriodEnd: due.periodEnd } });
    await audit(tx, tenantId, principal.partyId, 'create', 'payment', payment.id, { status: 'pending', amount: payment.amount.toString(), subscriptionId: subscription.id, installmentNumber: due.installmentNumber, billingPeriodStart: isoDate(due.periodStart), billingPeriodEnd: isoDate(due.periodEnd), billingCadence: subscription.billingCadence });
    return { id: payment.id, status: payment.status, amount: payment.amount.toString(), installmentNumber: due.installmentNumber, billingPeriodStart: isoDate(due.periodStart), billingPeriodEnd: isoDate(due.periodEnd) };
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
    const existing = await tx.paymentRecord.findFirst({ where: { organizationId: organization.id, purpose: 'org_agreement' } });
    if (existing?.status === 'pending') return { id: existing.id, status: existing.status, amount: existing.amount.toString() };
    if (existing) throw new PaymentRecordingError('This organization already has an agreement payment record.');
    try {
      const payment = await tx.paymentRecord.create({ data: { tenantId, payerPartyId: organization.partyId, payeePartyId: owner.id, organizationId: organization.id, purpose: 'org_agreement', amount: amount.toString(), method: input.method, status: 'pending' } });
      await audit(tx, tenantId, principal.partyId, 'create', 'payment', payment.id, { status: 'pending', purpose: 'org_agreement', amount: amount.toString(), organizationId: organization.id });
      return { id: payment.id, status: payment.status, amount: payment.amount.toString() };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new PaymentRecordingError('This organization already has an agreement payment record.');
      throw error;
    }
  });
}

export async function createRazorpayOrderForUser(client: PrismaClient, tenantId: string, userId: string, input: CreateRazorpayOrderInput): Promise<RazorpayOrderResult> {
  const pending = input.kind === 'client'
    ? await recordClientPaymentForUser(client, tenantId, userId, { subscriptionId: input.subscriptionId, method: 'razorpay' })
    : await recordOrganizationPaymentForUser(client, tenantId, userId, { organizationId: input.organizationId, amount: input.amount, method: 'razorpay' });
  const existing = await withTenant(client as never, tenantId, (tx: Tx) => tx.paymentRecord.findFirst({ where: { id: pending.id } }));
  if (!existing || existing.status !== 'pending') throw new PaymentRecordingError('Payment is unavailable for Razorpay checkout.');
  if (existing.gatewayProvider === 'razorpay' && existing.gatewayOrderId) return razorpayOrderResult({
    paymentId: existing.id, orderId: existing.gatewayOrderId, amountMinor: decimalToMinor(existing.amount.toString()), kind: input.kind,
  });
  if (existing.gatewayOrderId || existing.method !== 'razorpay') throw new PaymentRecordingError('Payment is already awaiting another collection method.');

  const order = await createRazorpayOrder({ paymentId: pending.id, amountMinor: decimalToMinor(pending.amount), tenantId });
  await withTenant(client as never, tenantId, async (tx: Tx) => {
    const updated = await tx.paymentRecord.updateMany({
      where: { id: pending.id, status: 'pending', gatewayOrderId: null },
      data: { gatewayProvider: 'razorpay', gatewayOrderId: order.id },
    });
    if (updated.count !== 1) throw new PaymentRecordingError('Payment order was already initialized.');
  });
  return razorpayOrderResult({ paymentId: pending.id, orderId: order.id, amountMinor: BigInt(order.amount), kind: input.kind, mock: order.mock });
}

function razorpayOrderResult(input: { paymentId: string; orderId: string; amountMinor: bigint; kind: CreateRazorpayOrderInput['kind']; mock?: boolean }): RazorpayOrderResult {
  const mockPaymentId = input.mock ? `pay_mock_${randomUUID().replaceAll('-', '')}` : null;
  return {
    keyId: razorpayConfig().keyId,
    paymentId: input.paymentId,
    orderId: input.orderId,
    amountMinor: Number(input.amountMinor),
    currency: 'INR',
    name: 'FitCrew',
    description: input.kind === 'client' ? 'Client subscription payment' : 'Organization agreement payment',
    checkoutMode: input.mock ? 'mock' as const : razorpayConfig().keyId.startsWith('rzp_test_') ? 'test' as const : 'live' as const,
    ...(mockPaymentId ? { mockConfirmation: { razorpayPaymentId: mockPaymentId, razorpaySignature: paymentSignature(input.orderId, mockPaymentId) } } : {}),
  };
}

export async function confirmRazorpayPaymentForUser(client: PrismaClient, tenantId: string, userId: string, input: ConfirmRazorpayPaymentInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const actor = await requirePrincipal(tx, tenantId, userId);
    const payment = await tx.paymentRecord.findFirst({ where: { id: input.paymentId, gatewayProvider: 'razorpay', gatewayOrderId: input.razorpayOrderId }, include: { subscription: { include: { client: { include: { currentCoachAssignment: true } } } } } });
    if (!payment || payment.status !== 'pending') throw new PaymentRecordingError('Razorpay payment is unavailable for confirmation.');
    const assignment = payment.subscription?.client.currentCoachAssignment;
    const allowed = payment.purpose === 'org_agreement'
      ? effectiveAssignments(actor).some((assignment) => assignment.role === 'OwnerAdmin' && assignment.scopeType === 'tenant')
      : assignment && await accessGateForPrincipal(tx, actor).can(actor, 'create', { type: 'payment', tenantId, coachPartyId: assignment.coachPartyId, organizationId: payment.subscription?.client.organizationId ?? undefined });
    if (!allowed) throw new PaymentRecordingError('Forbidden.');
    verifyRazorpaySignature(input);
    await verifyCapturedRazorpayPayment(input.razorpayPaymentId, {
      orderId: input.razorpayOrderId,
      amountMinor: decimalToMinor(payment.amount.toString()),
    });
    const principal = await gatewayOwnerPrincipal(tx, tenantId, payment.payeePartyId);
    return confirmPaymentTx(tx, tenantId, principal, payment, {
      source: 'gateway',
      confirmedAt: new Date(),
      utr: input.razorpayPaymentId,
      proofMediaAssetId: null,
    }, {
      gatewayProvider: 'razorpay',
      gatewayOrderId: input.razorpayOrderId,
      gatewayPaymentId: input.razorpayPaymentId,
      gatewaySignature: null,
    });
  });
}

export async function confirmRazorpayWebhookPayment(client: PrismaClient, input: ConfirmRazorpayWebhookInput) {
  verifyRazorpayWebhookSignature(input.rawBody, input.signature);
  if (!/^[A-Za-z0-9_:-]{1,255}$/.test(input.eventId)) throw new PaymentRecordingError('Razorpay webhook event id is invalid.');
  const event = parseRazorpayWebhook(input.rawBody);
  if (!event) return { ignored: true as const };

  return withTenant(client as never, event.tenantId, async (tx: Tx) => {
    // Create before financial work. The unique event id gives us exactly-once
    // handling even when Razorpay retries a successfully delivered webhook.
    const existingEvent = await tx.paymentGatewayEvent.findFirst({ where: { provider: 'razorpay', eventId: input.eventId } });
    if (existingEvent) return { ignored: true as const, duplicate: true as const };
    const gatewayEvent = await tx.paymentGatewayEvent.create({ data: {
      tenantId: event.tenantId,
      provider: 'razorpay', eventId: input.eventId, eventType: 'payment.captured',
      payloadSha256: createHash('sha256').update(input.rawBody).digest('hex'), outcome: 'received',
    } });
    const payment = await tx.paymentRecord.findFirst({
      where: {
        id: event.paymentId,
        gatewayProvider: 'razorpay',
        gatewayOrderId: event.razorpayOrderId,
      },
      include: { subscription: { include: { client: { include: { currentCoachAssignment: true } } } } },
    });
    if (!payment) throw new PaymentRecordingError('Razorpay payment is unavailable for webhook confirmation.');
    if (payment.status === 'confirmed') {
      await tx.paymentGatewayEvent.updateMany({ where: { id: gatewayEvent.id }, data: { paymentRecordId: payment.id, outcome: 'duplicate', processedAt: new Date() } });
      return { id: payment.id, status: 'confirmed' as const, duplicate: true as const };
    }
    if (payment.status !== 'pending') throw new PaymentRecordingError('Razorpay payment is not pending.');
    if (decimalToMinor(payment.amount.toString()) !== BigInt(event.amountMinor)) throw new PaymentRecordingError('Razorpay payment amount does not match FitCrew.');

    const principal = await gatewayOwnerPrincipal(tx, event.tenantId, payment.payeePartyId);
    const confirmed = await confirmPaymentTx(tx, event.tenantId, principal, payment, {
      source: 'gateway',
      confirmedAt: event.capturedAt,
      utr: event.razorpayPaymentId,
      proofMediaAssetId: null,
    }, {
      gatewayProvider: 'razorpay',
      gatewayOrderId: event.razorpayOrderId,
      gatewayPaymentId: event.razorpayPaymentId,
      gatewaySignature: null,
    });
    await tx.paymentGatewayEvent.updateMany({ where: { id: gatewayEvent.id }, data: { paymentRecordId: payment.id, outcome: 'confirmed', processedAt: new Date() } });
    return confirmed;
  });
}

export async function confirmPaymentForUser(client: PrismaClient, tenantId: string, userId: string, input: ConfirmPaymentInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await requireOwner(tx, tenantId, userId);
    const payment = await tx.paymentRecord.findFirst({ where: { id: input.paymentId }, include: { subscription: { include: { client: { include: { currentCoachAssignment: true } } } } } });
    if (!payment) throw new PaymentRecordingError('Payment is unavailable for manual confirmation.');
    // Browser-submitted UTRs or screenshots must never be used to confirm a
    // Razorpay collection. Razorpay records are confirmed only by the verified
    // Checkout callback or signed gateway webhook.
    if (payment.method === 'razorpay' || payment.gatewayProvider === 'razorpay') {
      throw new PaymentRecordingError('Razorpay payments must be confirmed by verified gateway evidence.');
    }
    const confirmation = await new ManualConfirmationSource(input).awaitConfirmation(payment.id);
    if (confirmation.proofMediaAssetId) {
      const proof = await tx.mediaAsset.findFirst({ where: { id: confirmation.proofMediaAssetId, status: 'active' } });
      if (!proof) throw new PaymentRecordingError('Payment proof was not found.');
    }
    return confirmPaymentTx(tx, tenantId, principal, payment, confirmation);
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

export async function getMoneyWorkspaceForUser(client: PrismaClient, tenantId: string, userId: string, reportingMonth?: string) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await requirePrincipal(tx, tenantId, userId);
    const ownerAccess = effectiveAssignments(principal).some((assignment) => assignment.role === 'OwnerAdmin' && assignment.scopeType === 'tenant');
    const owner = ownerAccess
      ? await tx.party.findFirst({ where: { id: principal.partyId } })
      : (await tx.engagement.findFirst({ where: { downstreamPartyId: principal.partyId, validTo: null }, include: { upstreamParty: true }, orderBy: { validFrom: 'desc' } }))?.upstreamParty;
    if (!owner) throw new PaymentRecordingError('Tenant owner was not found.');
    const paymentWhere = ownerAccess ? { tenantId } : { tenantId, subscription: { client: { currentCoachAssignment: { coachPartyId: principal.partyId } } } };
    const period = reportingPeriod(reportingMonth);
    const [handles, payments, subscriptions, organizations, config] = await Promise.all([
      tx.payoutHandle.findMany({ where: ownerAccess ? { tenantId } : { tenantId, partyId: { in: [owner.id, principal.partyId] } }, include: { party: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }),
      tx.paymentRecord.findMany({ where: { ...paymentWhere, OR: [{ createdAt: { gte: period.start, lt: period.end } }, { confirmedAt: { gte: period.start, lt: period.end } }] }, include: { payer: { include: { enrolledClients: { include: { currentCoachAssignment: { include: { coachParty: true } } } } } }, payee: true, commissionAccruals: true, subscription: { include: { client: { include: { party: true, currentCoachAssignment: { include: { coachParty: true } } } } } } }, orderBy: { createdAt: 'desc' }, take: 250 }),
      tx.subscription.findMany({ where: ownerAccess
        ? { tenantId, status: 'active' }
        : { tenantId, status: 'active', client: { currentCoachAssignment: { coachPartyId: principal.partyId } } }, include: { payments: true, client: { include: { party: true, currentCoachAssignment: { include: { coachParty: true } } } } }, orderBy: { endDate: 'desc' } }),
      ownerAccess ? tx.organization.findMany({ where: { tenantId, status: 'active' }, include: { party: true }, orderBy: { createdAt: 'desc' } }) : Promise.resolve([]),
      tx.tenantConfig.findFirstOrThrow({ where: { tenantId } }),
    ]);
    const scheduledSubscriptions = subscriptions.flatMap((subscription) => {
      const due = installmentInPeriod(subscription, period);
      if (!due) return [];
      const payment = subscription.payments.find((row) => row.purpose === 'client_subscription' && row.installmentNumber === due.installmentNumber && row.status !== 'reversed');
      let canCollect = false;
      try {
        const next = nextSubscriptionInstallment(subscription);
        canCollect = next.installmentNumber === due.installmentNumber && period.start <= new Date();
      } catch {
        // A fully collected plan remains visible in its scheduled month.
      }
      const paymentStatus: 'unpaid' | 'pending' | 'confirmed' = payment?.status === 'confirmed' ? 'confirmed' : payment?.status === 'pending' ? 'pending' : 'unpaid';
      return [{ subscription, due, paymentStatus, canCollect }];
    });

    const subscriptionSummary = (subscription: SubscriptionPlan) => {
      const confirmed = subscription.payments.filter((payment) => payment.purpose === 'client_subscription' && payment.status === 'confirmed');
      const confirmedMinor = confirmed.reduce((total, payment) => total + decimalToMinor(payment.amount.toString()), 0n);
      const count = installmentCount(subscription);
      return { confirmedInstallmentCount: new Set(confirmed.map((payment) => payment.installmentNumber).filter((number): number is number => number !== null)).size, installmentCount: count, remainingInstallmentCount: count - new Set(confirmed.map((payment) => payment.installmentNumber).filter((number): number is number => number !== null)).size, remainingBalance: minorUnitsToAmount(decimalToMinor(subscription.totalContractValue.toString()) - confirmedMinor) };
    };
    const plan = (subscription: SubscriptionPlan) => ({ id: subscription.id, clientName: subscription.client.party.displayName, coachName: subscription.client.currentCoachAssignment?.coachParty.displayName ?? null, billingCadence: subscription.billingCadence, totalContractValue: subscription.totalContractValue.toString(), installmentAmount: subscription.installmentAmount.toString(), durationMonths: subscription.durationMonths, ...subscriptionSummary(subscription) });
    return { ownerAccess, principalPartyId: principal.partyId, ownerPartyId: owner.id, reportingPeriod: { key: period.key, label: period.label, start: period.start.toISOString(), end: period.end.toISOString() }, refundCoachClawbackRate: config.refundCoachClawbackRate.toString(), handles: handles.map((h) => ({ id: h.id, partyId: h.partyId, partyName: h.party.displayName, type: h.type, value: h.value, label: h.label, isDefault: h.isDefault })), payments: payments.map((p) => { const accrual = p.commissionAccruals[0]; const coachName = p.subscription?.client.currentCoachAssignment?.coachParty.displayName ?? p.payer.enrolledClients[0]?.currentCoachAssignment?.coachParty.displayName ?? (p.purpose === 'coach_payout' ? p.payee.displayName : null); return { id: p.id, subscriptionId: p.subscriptionId, purpose: p.purpose, reversesPaymentId: p.reversesPaymentId, clientName: p.subscription?.client.party.displayName ?? p.payer.displayName, coachName, amount: p.amount.toString(), method: p.method, status: p.status, utr: p.utr, gatewayProvider: p.gatewayProvider, gatewayOrderId: p.gatewayOrderId, installmentNumber: p.installmentNumber, billingPeriodStart: p.billingPeriodStart?.toISOString() ?? null, billingPeriodEnd: p.billingPeriodEnd?.toISOString() ?? null, createdAt: p.createdAt.toISOString(), confirmedAt: p.confirmedAt?.toISOString() ?? null, accrual: accrual ? { kind: accrual.kind, commissionAmount: accrual.commissionAmount.toString(), coachPayableAmount: accrual.coachPayableAmount.toString(), rateApplied: accrual.rateApplied.toString(), withinLifespan: accrual.withinLifespan, windowEndAt: accrual.windowEndAt.toISOString() } : null }; }), subscriptions: subscriptions.map(plan), collectionsDue: scheduledSubscriptions.map(({ subscription, due, paymentStatus, canCollect }) => ({ ...plan(subscription), price: due.amount, installmentNumber: due.installmentNumber, billingPeriodStart: isoDate(due.periodStart), billingPeriodEnd: isoDate(due.periodEnd), paymentStatus, canCollect })), organizations: organizations.map((organization) => ({ id: organization.id, name: organization.party.displayName })) };
  });
}

function reportingPeriod(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) : now.getUTCMonth() + 1;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return reportingPeriod();
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { key: `${year}-${String(month).padStart(2, '0')}`, label: new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start), start, end };
}

type PaymentWithConfirmationRelations = Prisma.PaymentRecordGetPayload<{ include: { subscription: { include: { client: { include: { currentCoachAssignment: true } } } } } }>;
type SubscriptionWithPayments = Prisma.SubscriptionGetPayload<{ include: { payments: true } }>;
type SubscriptionPlan = Prisma.SubscriptionGetPayload<{ include: { payments: true; client: { include: { party: true; currentCoachAssignment: { include: { coachParty: true } } } } } }>;

async function confirmPaymentTx(tx: Tx, tenantId: string, principal: Awaited<ReturnType<typeof requirePrincipal>>, payment: PaymentWithConfirmationRelations, confirmation: { source: 'manual' | 'gateway'; confirmedAt: Date; utr: string | null; proofMediaAssetId: string | null }, gateway?: { gatewayProvider: string; gatewayOrderId: string; gatewayPaymentId: string; gatewaySignature: string | null }) {
  const subscription = payment.subscription;
  const assignment = subscription?.client.currentCoachAssignment;
  const isOrganizationPayment = payment.purpose === 'org_agreement' && payment.organizationId !== null;
  const allowed = payment.status === 'pending' && effectiveAssignments(principal).some((assignment) => assignment.role === 'OwnerAdmin' && assignment.scopeType === 'tenant');
  if (!allowed) throw new PaymentRecordingError('Payment is unavailable for confirmation.');
  const updated = await tx.paymentRecord.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'confirmed', utr: confirmation.utr, proofMediaAssetId: confirmation.proofMediaAssetId, confirmationSource: confirmation.source, confirmedByPartyId: principal.partyId, confirmedAt: confirmation.confirmedAt, ...gateway } });
  if (updated.count !== 1) throw new PaymentRecordingError('Payment was already confirmed.');
  const amountMinor = decimalToMinor(payment.amount.toString());
  const commission = subscription && assignment ? await accrueCommission(tx, tenantId, payment.id, payment.payeePartyId, subscription.client.id, assignment.id, assignment.coachPartyId, amountMinor, confirmation.confirmedAt) : null;
  const lines: PostLedgerInput['lines'] = [
    { partyId: payment.payeePartyId, purpose: 'owner_cash', direction: 'debit', amountMinor },
    { partyId: payment.payerPartyId, purpose: isOrganizationPayment ? 'org_agreement_receivable' : 'client_receivable', direction: 'credit', amountMinor },
    ...(commission ? [
      { partyId: payment.payerPartyId, purpose: 'client_receivable' as const, direction: 'debit' as const, amountMinor },
      ...(commission.commissionAmountMinor > 0n ? [{ partyId: payment.payeePartyId, purpose: 'commission_income' as const, direction: 'credit' as const, amountMinor: commission.commissionAmountMinor }] : []),
      { partyId: assignment!.coachPartyId, purpose: 'coach_payable' as const, direction: 'credit' as const, amountMinor: commission.coachPayableAmountMinor },
    ] : []),
  ];
  await postLedgerEntry(new PrismaLedgerRepository(tx), { tenantId, description: `${isOrganizationPayment ? 'Organization' : 'Client'} payment ${payment.id}`, referenceType: 'payment', referenceId: payment.id, lines });
  await audit(tx, tenantId, principal.partyId, 'update', 'payment', payment.id, { status: 'confirmed', source: confirmation.source, utr: confirmation.utr, proofMediaAssetId: confirmation.proofMediaAssetId, gatewayProvider: gateway?.gatewayProvider ?? null, gatewayOrderId: gateway?.gatewayOrderId ?? null, gatewayPaymentId: gateway?.gatewayPaymentId ?? null, commissionAccrued: commission ? minorUnitsToAmount(commission.commissionAmountMinor) : null });
  return { id: payment.id, status: 'confirmed' as const, confirmedAt: confirmation.confirmedAt.toISOString(), commissionAmount: commission ? minorUnitsToAmount(commission.commissionAmountMinor) : null, coachPayableAmount: commission ? minorUnitsToAmount(commission.coachPayableAmountMinor) : null };
}

function validateHandle(type: PayoutHandleInput['type'], raw: string): string { const value = raw.trim(); if (!value || value.length > 500) throw new PaymentRecordingError('A valid payout handle is required.'); if (type === 'upi' && !/^[\w.-]{2,256}@[A-Za-z]{2,64}$/.test(value)) throw new PaymentRecordingError('UPI ID is invalid.'); if (type === 'phone' && !/^\+?[1-9]\d{9,14}$/.test(value)) throw new PaymentRecordingError('Phone number is invalid.'); return value; }
function decimalToMinor(value: string): bigint { const [major, minor = ''] = value.split('.'); return BigInt(major!) * 100n + BigInt(minor.padEnd(2, '0').slice(0, 2)); }
function decimalRateToBasisPoints(value: string): number { const [major, fraction = ''] = value.split('.'); return Number(major) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2)); }
function minorUnitsToAmount(value: bigint): string { return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`; }
function amountSigned(value: bigint): string { const sign = value < 0n ? '-' : ''; const absolute = value < 0n ? -value : value; return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`; }
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint { return (numerator + denominator / 2n) / denominator; }
const LOCAL_MOCK_RAZORPAY_SECRET = 'fitcrew-local-mock-checkout-only';
/**
 * Mock checkout is intentionally opt-in. Staging must be able to run with
 * rzp_test_* keys while NODE_ENV remains production-like.
 */
function localMockCheckoutEnabled() { return process.env.PAYMENT_GATEWAY_MODE === 'mock'; }
/**
 * Manual client collection is an explicit, non-production migration escape
 * hatch. It is deliberately off by default so a new coach collection cannot
 * silently bypass Razorpay in Test, Staging, or Live environments.
 */
function manualClientCollectionsEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.PAYMENT_COLLECTION_MODE === 'manual';
}
function assertPermittedClientCollectionMethod(method: PaymentMethodInput) {
  if (method === 'razorpay') return;
  if (manualClientCollectionsEnabled()) return;
  throw new PaymentRecordingError('New client collections must use Razorpay Checkout.');
}
function razorpayConfig() {
  if (localMockCheckoutEnabled()) return { keyId: 'rzp_test_fitcrew_local_mock', keySecret: LOCAL_MOCK_RAZORPAY_SECRET };
  const keyId = process.env.RAZORPAY_KEY_ID?.trim(); const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) throw new PaymentRecordingError('Razorpay credentials are not configured.');
  if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId)) throw new PaymentRecordingError('Razorpay key id is invalid.');
  return { keyId, keySecret };
}
function razorpayClient() {
  const { keyId, keySecret } = razorpayConfig();
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}
async function createRazorpayOrder(input: { paymentId: string; amountMinor: bigint; tenantId: string }): Promise<{ id: string; amount: number; currency: 'INR'; mock: boolean }> {
  if (localMockCheckoutEnabled()) return { id: `order_mock_${randomUUID().replaceAll('-', '')}`, amount: Number(input.amountMinor), currency: 'INR', mock: true };
  const order = await razorpayClient().orders.create({
    amount: Number(input.amountMinor),
    currency: 'INR',
    receipt: input.paymentId,
    notes: { tenantId: input.tenantId, paymentId: input.paymentId },
  });
  if (!order.id || order.currency !== 'INR' || Number(order.amount) !== Number(input.amountMinor)) {
    throw new PaymentRecordingError('Razorpay order could not be created.');
  }
  return { id: order.id, amount: Number(order.amount), currency: 'INR', mock: false };
}
function verifyRazorpaySignature(input: ConfirmRazorpayPaymentInput) {
  if (localMockCheckoutEnabled()) {
    if (paymentSignature(input.razorpayOrderId, input.razorpayPaymentId) !== input.razorpaySignature) throw new PaymentRecordingError('Razorpay payment signature is invalid.');
    return;
  }
  const ok = validatePaymentVerification({ order_id: input.razorpayOrderId, payment_id: input.razorpayPaymentId }, input.razorpaySignature, razorpayConfig().keySecret);
  if (!ok) throw new PaymentRecordingError('Razorpay payment signature is invalid.');
}
function paymentSignature(orderId: string, paymentId: string) { return createHmac('sha256', razorpayConfig().keySecret).update(`${orderId}|${paymentId}`).digest('hex'); }
async function verifyCapturedRazorpayPayment(razorpayPaymentId: string, expected: { orderId: string; amountMinor: bigint }) {
  if (localMockCheckoutEnabled()) return;
  const payment = await razorpayClient().payments.fetch(razorpayPaymentId);
  if (payment.order_id !== expected.orderId || BigInt(payment.amount) !== expected.amountMinor || payment.status !== 'captured') {
    throw new PaymentRecordingError('Razorpay payment has not been captured.');
  }
}
function verifyRazorpayWebhookSignature(rawBody: string, signature: string) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret) throw new PaymentRecordingError('Razorpay webhook secret is not configured.');
  // During a deliberate secret rotation Razorpay may retry an older delivery
  // signed with the previous secret. Keep this value only for that bounded
  // overlap, then remove it once the retry window has elapsed.
  const previousSecret = process.env.RAZORPAY_WEBHOOK_PREVIOUS_SECRET?.trim();
  const valid = validateWebhookSignature(rawBody, signature, secret)
    || Boolean(previousSecret && validateWebhookSignature(rawBody, signature, previousSecret));
  if (!valid) throw new PaymentRecordingError('Razorpay webhook signature is invalid.');
}
type ParsedRazorpayWebhook = {
  tenantId: string;
  paymentId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountMinor: number;
  capturedAt: Date;
};
function parseRazorpayWebhook(rawBody: string): ParsedRazorpayWebhook | null {
  const body = JSON.parse(rawBody) as {
    event?: string;
    payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; status?: string; captured?: boolean; created_at?: number; notes?: { tenantId?: string; paymentId?: string } } } };
  };
  if (body.event !== 'payment.captured') return null;
  const payment = body.payload?.payment?.entity;
  if (!payment?.id || !payment.order_id || payment.status !== 'captured' || !payment.captured) throw new PaymentRecordingError('Razorpay webhook payment is not captured.');
  const tenantId = payment.notes?.tenantId;
  const paymentId = payment.notes?.paymentId;
  if (!tenantId || !paymentId || typeof payment.amount !== 'number') throw new PaymentRecordingError('Razorpay webhook payment metadata is incomplete.');
  return {
    tenantId,
    paymentId,
    razorpayOrderId: payment.order_id,
    razorpayPaymentId: payment.id,
    amountMinor: payment.amount,
    capturedAt: payment.created_at ? new Date(payment.created_at * 1_000) : new Date(),
  };
}
function nextSubscriptionInstallment(subscription: SubscriptionWithPayments) {
  const count = installmentCount(subscription);
  const collected = new Set(subscription.payments.filter((payment) => payment.purpose === 'client_subscription' && payment.status !== 'reversed' && payment.installmentNumber !== null).map((payment) => payment.installmentNumber!));
  const installmentNumber = Array.from({ length: count }, (_, index) => index + 1).find((number) => !collected.has(number));
  if (!installmentNumber) throw new PaymentRecordingError('All installments for this subscription are already collected.');
  const amountMinor = installmentAmountMinor(subscription, installmentNumber, count);
  const periodStart = subscription.billingCadence === 'monthly' ? addMonths(subscription.startDate, installmentNumber - 1) : subscription.startDate;
  const periodEnd = subscription.billingCadence === 'monthly' ? addDays(addMonths(subscription.startDate, installmentNumber), -1) : subscription.endDate;
  return { installmentNumber, amount: minorUnitsToAmount(amountMinor), periodStart, periodEnd };
}
function installmentInPeriod(subscription: SubscriptionWithPayments, period: { start: Date; end: Date }) {
  const count = installmentCount(subscription);
  const installmentNumber = Array.from({ length: count }, (_, index) => index + 1).find((number) => {
    const start = subscription.billingCadence === 'monthly' ? addMonths(subscription.startDate, number - 1) : subscription.startDate;
    return start >= period.start && start < period.end;
  });
  if (!installmentNumber) return null;
  const periodStart = subscription.billingCadence === 'monthly' ? addMonths(subscription.startDate, installmentNumber - 1) : subscription.startDate;
  const periodEnd = subscription.billingCadence === 'monthly' ? addDays(addMonths(subscription.startDate, installmentNumber), -1) : subscription.endDate;
  return { installmentNumber, amount: minorUnitsToAmount(installmentAmountMinor(subscription, installmentNumber, count)), periodStart, periodEnd };
}
function installmentCount(subscription: Pick<SubscriptionWithPayments, 'billingCadence' | 'durationMonths'>) { return subscription.billingCadence === 'monthly' ? subscription.durationMonths : 1; }
function installmentAmountMinor(subscription: Pick<SubscriptionWithPayments, 'billingCadence' | 'installmentAmount' | 'totalContractValue'>, installmentNumber: number, count: number) {
  const total = decimalToMinor(subscription.totalContractValue.toString());
  if (subscription.billingCadence !== 'monthly') return total;
  const regular = decimalToMinor(subscription.installmentAmount.toString());
  return installmentNumber === count ? total - (regular * BigInt(count - 1)) : regular;
}
function addMonths(date: Date, months: number) { const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); copy.setUTCMonth(copy.getUTCMonth() + months); return copy; }
function addDays(date: Date, days: number) { const copy = new Date(date); copy.setUTCDate(copy.getUTCDate() + days); return copy; }
function isoDate(value: Date) { return value.toISOString().slice(0, 10); }
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
async function requireOwner(tx: Tx, tenantId: string, userId: string) { const principal = await requirePrincipal(tx, tenantId, userId); if (!effectiveAssignments(principal).some((assignment) => assignment.role === 'OwnerAdmin' && assignment.scopeType === 'tenant')) throw new PaymentRecordingError('Forbidden.'); return principal; }
async function gatewayOwnerPrincipal(tx: Tx, tenantId: string, partyId: string) {
  const today = new Date();
  const assignment = await tx.roleAssignment.findFirst({
    where: {
      tenantId,
      partyId,
      role: 'OwnerAdmin',
      scopeType: 'tenant',
      validFrom: { lte: today },
      OR: [{ validTo: null }, { validTo: { gte: today } }],
    },
  });
  if (!assignment) throw new PaymentRecordingError('Tenant owner was not found.');
  return {
    tenantId,
    partyId,
    assignments: [{ role: 'OwnerAdmin' as const, scopeType: 'tenant' as const, scopeId: null, validFrom: assignment.validFrom.toISOString().slice(0, 10), validTo: assignment.validTo?.toISOString().slice(0, 10) ?? null }],
  };
}
async function audit(tx: Tx, tenantId: string, actorPartyId: string, action: string, resourceType: string, resourceId: string, after: object) { await tx.auditLog.create({ data: { tenantId, actorPartyId, action, resourceType, resourceId, before: Prisma.JsonNull, after } }); }
export function cleanPaymentRecordingError(error: unknown): string { return error instanceof PaymentRecordingError || error instanceof Error && error.name === 'LedgerInvariantError' ? error.message : 'Payment operation failed.'; }

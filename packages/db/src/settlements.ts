import { createHash } from 'node:crypto';
import { generatePayslipPdf, ManualConfirmationSource, postLedgerEntry } from '@fitcrew/application';
import { Prisma, type PrismaClient } from '@prisma/client';
import { accessGateForPrincipal, resolvePrincipal } from './access-gate.js';
import { PrismaLedgerRepository } from './ledger.js';
import type { PrivateBlobStorage } from './media-pipeline.js';
import { withTenant } from './with-tenant.js';

type Tx = Prisma.TransactionClient;
export class SettlementError extends Error { constructor(message: string) { super(message); this.name = 'SettlementError'; } }
export type CreateSettlementInput = { coachPartyId: string; periodStart: string; periodEnd: string; method: 'upi' | 'qr' | 'phone' | 'other' };
export type ConfirmSettlementInput = { settlementId: string; utr?: string; proofMediaAssetId?: string };

export async function createSettlementForUser(client: PrismaClient, tenantId: string, userId: string, input: CreateSettlementInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await requireOwner(tx, tenantId, userId); const periodStart = plainDate(input.periodStart); const periodEnd = plainDate(input.periodEnd);
    if (periodEnd < periodStart) throw new SettlementError('Settlement period end cannot precede its start.');
    const coach = await tx.party.findFirst({ where: { id: input.coachPartyId, status: 'active' } }); if (!coach) throw new SettlementError('Coach was not found.');
    const endExclusive = new Date(periodEnd); endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const accruals = await tx.commissionAccrual.findMany({ where: { settlementId: null, coachAssignment: { coachPartyId: coach.id }, payment: { confirmedAt: { gte: periodStart, lt: endExclusive } } }, orderBy: { createdAt: 'asc' } });
    if (!accruals.length) throw new SettlementError('No unsettled coach earnings exist in this period.');
    const grossMinor = sum(accruals.map((a) => decimalToMinor(a.grossAmount.toString()))); const commissionMinor = sum(accruals.map((a) => decimalToMinor(a.commissionAmount.toString()))); const netMinor = sum(accruals.map((a) => decimalToMinor(a.coachPayableAmount.toString())));
    if (netMinor <= 0n) throw new SettlementError('Settlement total must be positive.');
    const settlement = await tx.settlement.create({ data: { tenantId, coachPartyId: coach.id, periodStart, periodEnd, grossRevenue: amount(grossMinor), commissionAmount: amount(commissionMinor), totalAmount: amount(netMinor) } });
    const claimed = await tx.commissionAccrual.updateMany({ where: { id: { in: accruals.map((a) => a.id) }, settlementId: null }, data: { settlementId: settlement.id } });
    if (claimed.count !== accruals.length) throw new SettlementError('Some accruals were already claimed by another settlement.');
    const payout = await tx.paymentRecord.create({ data: { tenantId, payerPartyId: principal.partyId, payeePartyId: coach.id, purpose: 'coach_payout', amount: amount(netMinor), method: input.method, status: 'pending' } });
    await tx.settlement.updateMany({ where: { id: settlement.id }, data: { payoutPaymentId: payout.id } });
    await audit(tx, tenantId, principal.partyId, 'create', 'settlement', settlement.id, { coachPartyId: coach.id, accrualIds: accruals.map((a) => a.id), totalAmount: amount(netMinor) });
    return { id: settlement.id, payoutPaymentId: payout.id, accrualCount: accruals.length, totalAmount: amount(netMinor), status: 'draft' as const };
  });
}

export async function confirmSettlementForUser(client: PrismaClient, tenantId: string, userId: string, input: ConfirmSettlementInput, storage: PrivateBlobStorage) {
  let uploadedKey: string | null = null;
  try {
    return await withTenant(client as never, tenantId, async (tx: Tx) => {
      const principal = await requireOwner(tx, tenantId, userId);
      const settlement = await tx.settlement.findFirst({ where: { id: input.settlementId }, include: { coachParty: true, payoutPayment: true, accruals: { include: { payment: true, client: { include: { party: true } } }, orderBy: { createdAt: 'asc' } } } });
      if (!settlement?.payoutPayment || settlement.status !== 'draft' || settlement.payoutPayment.status !== 'pending') throw new SettlementError('Settlement is unavailable for confirmation.');
      const confirmation = await new ManualConfirmationSource(input).awaitConfirmation(settlement.payoutPayment.id);
      if (confirmation.proofMediaAssetId && !(await tx.mediaAsset.findFirst({ where: { id: confirmation.proofMediaAssetId, status: 'active' } }))) throw new SettlementError('Payout proof was not found.');
      const paymentUpdate = await tx.paymentRecord.updateMany({ where: { id: settlement.payoutPayment.id, status: 'pending' }, data: { status: 'confirmed', utr: confirmation.utr, proofMediaAssetId: confirmation.proofMediaAssetId, confirmationSource: 'manual', confirmedByPartyId: principal.partyId, confirmedAt: confirmation.confirmedAt } });
      if (paymentUpdate.count !== 1) throw new SettlementError('Payout was already confirmed.');
      const netMinor = decimalToMinor(settlement.totalAmount.toString());
      await postLedgerEntry(new PrismaLedgerRepository(tx), { tenantId, description: `Coach settlement ${settlement.id}`, referenceType: 'settlement', referenceId: settlement.id, lines: [{ partyId: settlement.coachPartyId, purpose: 'coach_payable', direction: 'debit', amountMinor: netMinor }, { partyId: settlement.payoutPayment.payerPartyId, purpose: 'owner_cash', direction: 'credit', amountMinor: netMinor }] });
      const detail = settlement.accruals.map((accrual) => ({ accrualId: accrual.id, paymentId: accrual.paymentId, kind: accrual.kind, clientName: accrual.client.party.displayName, paymentDate: accrual.payment.confirmedAt?.toISOString().slice(0, 10) ?? '', gross: accrual.grossAmount.toString(), commission: accrual.commissionAmount.toString(), net: accrual.coachPayableAmount.toString() }));
      const pdf = generatePayslipPdf({ payslipNumber: settlement.id, businessName: 'FitCrew', coachName: settlement.coachParty.displayName, periodStart: isoDate(settlement.periodStart), periodEnd: isoDate(settlement.periodEnd), issuedAt: isoDate(confirmation.confirmedAt), grossRevenue: settlement.grossRevenue.toString(), commissionDeducted: settlement.commissionAmount.toString(), netPaid: settlement.totalAmount.toString(), lines: detail });
      uploadedKey = `${tenantId}/payslips/${settlement.id}.pdf`; await storage.putPrivate(uploadedKey, pdf, 'application/pdf');
      const document = await tx.mediaAsset.create({ data: { tenantId, clientId: null, blobKey: uploadedKey, contentType: 'application/pdf', byteSize: pdf.byteLength, sha256: createHash('sha256').update(pdf).digest('hex') } });
      await tx.payslip.create({ data: { tenantId, settlementId: settlement.id, grossRevenue: settlement.grossRevenue, commissionDeducted: settlement.commissionAmount, netPaid: settlement.totalAmount, detail, documentMediaAssetId: document.id, issuedAt: confirmation.confirmedAt } });
      await tx.settlement.updateMany({ where: { id: settlement.id, status: 'draft' }, data: { status: 'paid', paidAt: confirmation.confirmedAt } });
      await audit(tx, tenantId, principal.partyId, 'update', 'settlement', settlement.id, { status: 'paid', payoutPaymentId: settlement.payoutPayment.id, documentMediaAssetId: document.id });
      return { id: settlement.id, status: 'paid' as const, payslipMediaAssetId: document.id };
    });
  } catch (error) { if (uploadedKey) await storage.delete(uploadedKey); throw error; }
}

export async function getEarningsForUser(client: PrismaClient, tenantId: string, userId: string) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await resolvePrincipal(tx, tenantId, userId); if (!principal) throw new SettlementError('Forbidden.');
    const owner = principal.assignments.some((a) => a.role === 'OwnerAdmin'); const coachIds = owner ? undefined : [principal.partyId];
    if (!owner && !principal.assignments.some((a) => a.role === 'Coach')) throw new SettlementError('Forbidden.');
    const [accruals, settlements] = await Promise.all([
      tx.commissionAccrual.findMany({ where: coachIds ? { coachAssignment: { coachPartyId: { in: coachIds } } } : { tenantId }, include: { coachAssignment: { include: { coachParty: true } }, client: { include: { party: true } } }, orderBy: { createdAt: 'desc' } }),
      tx.settlement.findMany({ where: coachIds ? { coachPartyId: { in: coachIds } } : { tenantId }, include: { coachParty: true, payslip: true }, orderBy: { periodEnd: 'desc' } }),
    ]);
    const payables = new Map<string, { coachPartyId: string; coachName: string; amountMinor: bigint; accrualCount: number }>();
    for (const accrual of accruals.filter((a) => a.settlementId === null)) { const row = payables.get(accrual.coachAssignment.coachPartyId) ?? { coachPartyId: accrual.coachAssignment.coachPartyId, coachName: accrual.coachAssignment.coachParty.displayName, amountMinor: 0n, accrualCount: 0 }; row.amountMinor += decimalToMinor(accrual.coachPayableAmount.toString()); row.accrualCount += 1; payables.set(row.coachPartyId, row); }
    return { owner, payables: [...payables.values()].map((p) => ({ coachPartyId: p.coachPartyId, coachName: p.coachName, amount: amount(p.amountMinor), accrualCount: p.accrualCount, settleable: p.amountMinor > 0n })), accruals: accruals.map((a) => ({ id: a.id, kind: a.kind, clientName: a.client.party.displayName, coachPartyId: a.coachAssignment.coachPartyId, coachName: a.coachAssignment.coachParty.displayName, gross: a.grossAmount.toString(), commission: a.commissionAmount.toString(), net: a.coachPayableAmount.toString(), settled: a.settlementId !== null, createdAt: a.createdAt.toISOString() })), settlements: settlements.map((s) => ({ id: s.id, coachPartyId: s.coachPartyId, coachName: s.coachParty.displayName, periodStart: isoDate(s.periodStart), periodEnd: isoDate(s.periodEnd), grossRevenue: s.grossRevenue.toString(), commissionAmount: s.commissionAmount.toString(), totalAmount: s.totalAmount.toString(), status: s.status, payslipMediaAssetId: s.payslip?.documentMediaAssetId ?? null })) };
  });
}

export async function mintPayslipReadUrl(client: PrismaClient, tenantId: string, userId: string, mediaAssetId: string, storage: PrivateBlobStorage) { return withTenant(client as never, tenantId, async (tx: Tx) => { const principal = await resolvePrincipal(tx, tenantId, userId); const payslip = principal && await tx.payslip.findFirst({ where: { documentMediaAssetId: mediaAssetId }, include: { settlement: true, document: true } }); if (!principal || !payslip || !(await accessGateForPrincipal(tx, principal).can(principal, 'read', { type: 'payslip', id: payslip.id, tenantId, coachPartyId: payslip.settlement.coachPartyId }))) throw new SettlementError('Payslip access denied.'); const expiresAt = new Date(Date.now() + 10 * 60_000); return { url: await storage.createReadUrl(payslip.document.blobKey, expiresAt), expiresAt }; }); }
export async function downloadPayslipForUser(client: PrismaClient, tenantId: string, userId: string, mediaAssetId: string, storage: PrivateBlobStorage) { return withTenant(client as never, tenantId, async (tx: Tx) => { const principal = await resolvePrincipal(tx, tenantId, userId); const payslip = principal && await tx.payslip.findFirst({ where: { documentMediaAssetId: mediaAssetId }, include: { settlement: true, document: true } }); if (!principal || !payslip || !(await accessGateForPrincipal(tx, principal).can(principal, 'read', { type: 'payslip', id: payslip.id, tenantId, coachPartyId: payslip.settlement.coachPartyId }))) throw new SettlementError('Payslip access denied.'); return { bytes: await storage.readPrivate(payslip.document.blobKey), filename: `fitcrew-payslip-${payslip.settlementId}.pdf` }; }); }
function plainDate(value: string): Date { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new SettlementError('A valid settlement date is required.'); const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.getTime()) || isoDate(date) !== value) throw new SettlementError('A real settlement date is required.'); return date; }
function decimalToMinor(value: string): bigint { const negative = value.startsWith('-'); const unsigned = negative ? value.slice(1) : value; const [major, minor = ''] = unsigned.split('.'); const result = BigInt(major!) * 100n + BigInt(minor.padEnd(2, '0').slice(0, 2)); return negative ? -result : result; }
function amount(value: bigint): string { const negative = value < 0n; const unsigned = negative ? -value : value; return `${negative ? '-' : ''}${unsigned / 100n}.${(unsigned % 100n).toString().padStart(2, '0')}`; }
function sum(values: readonly bigint[]): bigint { return values.reduce((total, value) => total + value, 0n); }
function isoDate(value: Date): string { return value.toISOString().slice(0, 10); }
async function requireOwner(tx: Tx, tenantId: string, userId: string) { const principal = await resolvePrincipal(tx, tenantId, userId); if (!principal?.assignments.some((a) => a.role === 'OwnerAdmin')) throw new SettlementError('Forbidden.'); return principal; }
async function audit(tx: Tx, tenantId: string, actorPartyId: string, action: string, resourceType: string, resourceId: string, after: object) { await tx.auditLog.create({ data: { tenantId, actorPartyId, action, resourceType, resourceId, before: Prisma.JsonNull, after } }); }
export function cleanSettlementError(error: unknown): string { return error instanceof SettlementError || error instanceof Error && error.name === 'LedgerInvariantError' ? error.message : 'Settlement operation failed.'; }

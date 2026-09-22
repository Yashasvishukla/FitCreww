import { createHash } from 'node:crypto';
import { effectiveAssignments, generatePayslipPdf, ManualConfirmationSource, postLedgerEntry } from '@fitcrew/application';
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
    const accruals = await tx.commissionAccrual.findMany({ where: { settlementId: null, coachAssignment: { coachPartyId: coach.id }, payment: { OR: [
      { billingPeriodStart: { not: null, lte: periodEnd }, billingPeriodEnd: { not: null, gte: periodStart } },
      // Older records may not have a subscription period; preserve the original
      // confirmation-date behaviour for those records.
      { billingPeriodStart: null, confirmedAt: { gte: periodStart, lt: endExclusive } },
    ] } }, orderBy: { createdAt: 'asc' } });
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
      const settlement = await tx.settlement.findFirst({ where: { id: input.settlementId, tenantId }, include: { coachParty: true, payoutPayment: true, accruals: { include: { payment: true, client: { include: { party: true } } }, orderBy: { createdAt: 'asc' } } } });
      if (!settlement?.payoutPayment) throw new SettlementError('This settlement no longer has an available payout.');
      if (settlement.status !== 'draft') throw new SettlementError('This settlement has already been processed. Refresh the page to view its latest status.');
      if (settlement.payoutPayment.status !== 'pending') throw new SettlementError('This payout is no longer awaiting confirmation. Refresh the page to view its latest status.');
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

export async function getEarningsForUser(client: PrismaClient, tenantId: string, userId: string, month?: string) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await resolvePrincipal(tx, tenantId, userId); if (!principal) throw new SettlementError('Forbidden.');
    const assignments = effectiveAssignments(principal); const owner = assignments.some((assignment) => assignment.role === 'OwnerAdmin' && assignment.scopeType === 'tenant'); const coachIds = owner ? undefined : [principal.partyId];
    if (!owner && !assignments.some((assignment) => assignment.role === 'Coach')) throw new SettlementError('Forbidden.');
    const period = reportingPeriod(month);
    const [accruals, settlements] = await Promise.all([
      tx.commissionAccrual.findMany({ where: { ...(coachIds ? { coachAssignment: { coachPartyId: { in: coachIds } } } : { tenantId }), payment: { confirmedAt: { gte: period.start, lt: period.end } } }, include: { coachAssignment: { include: { coachParty: true } }, client: { include: { party: true } }, payment: { select: { billingPeriodStart: true, billingPeriodEnd: true, confirmedAt: true } } }, orderBy: { createdAt: 'desc' } }),
      tx.settlement.findMany({ where: { ...(coachIds ? { coachPartyId: { in: coachIds } } : { tenantId }), periodStart: { lt: period.end }, periodEnd: { gte: period.start } }, include: { coachParty: true, payslip: true, payoutPayment: { select: { status: true } } }, orderBy: { periodEnd: 'desc' } }),
    ]);
    const payables = new Map<string, { coachPartyId: string; coachName: string; amountMinor: bigint; accrualCount: number; periodStart: Date | null; periodEnd: Date | null }>();
    for (const accrual of accruals.filter((a) => a.settlementId === null)) {
      const fallbackDate = accrual.payment.confirmedAt ?? accrual.createdAt;
      const start = accrual.payment.billingPeriodStart ?? fallbackDate;
      const end = accrual.payment.billingPeriodEnd ?? fallbackDate;
      const row = payables.get(accrual.coachAssignment.coachPartyId) ?? { coachPartyId: accrual.coachAssignment.coachPartyId, coachName: accrual.coachAssignment.coachParty.displayName, amountMinor: 0n, accrualCount: 0, periodStart: null, periodEnd: null };
      row.amountMinor += decimalToMinor(accrual.coachPayableAmount.toString()); row.accrualCount += 1;
      if (!row.periodStart || start < row.periodStart) row.periodStart = start;
      if (!row.periodEnd || end > row.periodEnd) row.periodEnd = end;
      payables.set(row.coachPartyId, row);
    }
    return { owner, reportingPeriod: { key: period.key, label: period.label, start: period.start.toISOString(), end: period.end.toISOString() }, payables: [...payables.values()].map((p) => ({ coachPartyId: p.coachPartyId, coachName: p.coachName, amount: amount(p.amountMinor), accrualCount: p.accrualCount, periodStart: p.periodStart ? isoDate(p.periodStart) : null, periodEnd: p.periodEnd ? isoDate(p.periodEnd) : null, settleable: p.amountMinor > 0n })), accruals: accruals.map((a) => ({ id: a.id, settlementId: a.settlementId, kind: a.kind, clientName: a.client.party.displayName, coachPartyId: a.coachAssignment.coachPartyId, coachName: a.coachAssignment.coachParty.displayName, gross: a.grossAmount.toString(), commission: a.commissionAmount.toString(), net: a.coachPayableAmount.toString(), settled: a.settlementId !== null, createdAt: a.createdAt.toISOString() })), settlements: settlements.map((s) => ({ id: s.id, coachPartyId: s.coachPartyId, coachName: s.coachParty.displayName, periodStart: isoDate(s.periodStart), periodEnd: isoDate(s.periodEnd), grossRevenue: s.grossRevenue.toString(), commissionAmount: s.commissionAmount.toString(), totalAmount: s.totalAmount.toString(), status: s.status, payoutStatus: s.payoutPayment?.status ?? null, payslipMediaAssetId: s.payslip?.documentMediaAssetId ?? null })) };
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

export async function mintPayslipReadUrl(client: PrismaClient, tenantId: string, userId: string, mediaAssetId: string, storage: PrivateBlobStorage) { return withTenant(client as never, tenantId, async (tx: Tx) => { const principal = await resolvePrincipal(tx, tenantId, userId); const payslip = principal && await tx.payslip.findFirst({ where: { documentMediaAssetId: mediaAssetId }, include: { settlement: true, document: true } }); if (!principal || !payslip || !(await accessGateForPrincipal(tx, principal).can(principal, 'read', { type: 'payslip', id: payslip.id, tenantId, coachPartyId: payslip.settlement.coachPartyId }))) throw new SettlementError('Payslip access denied.'); const expiresAt = new Date(Date.now() + 10 * 60_000); return { url: await storage.createReadUrl(payslip.document.blobKey, expiresAt), expiresAt }; }); }
export async function downloadPayslipForUser(client: PrismaClient, tenantId: string, userId: string, mediaAssetId: string, storage: PrivateBlobStorage) { return withTenant(client as never, tenantId, async (tx: Tx) => { const principal = await resolvePrincipal(tx, tenantId, userId); const payslip = principal && await tx.payslip.findFirst({ where: { documentMediaAssetId: mediaAssetId }, include: { settlement: { include: { coachParty: true } }, document: true } }); if (!principal || !payslip || !(await accessGateForPrincipal(tx, principal).can(principal, 'read', { type: 'payslip', id: payslip.id, tenantId, coachPartyId: payslip.settlement.coachPartyId }))) throw new SettlementError('Payslip access denied.'); let bytes: Uint8Array; try { bytes = await storage.readPrivate(payslip.document.blobKey); } catch { bytes = regeneratePayslip(payslip); await storage.putPrivate(payslip.document.blobKey, bytes, 'application/pdf'); } return { bytes, filename: `fitcrew-payslip-${payslip.settlementId}.pdf` }; }); }
function regeneratePayslip(payslip: { id: string; settlementId: string; grossRevenue: { toString(): string }; commissionDeducted: { toString(): string }; netPaid: { toString(): string }; issuedAt: Date; detail: Prisma.JsonValue; settlement: { periodStart: Date; periodEnd: Date; coachParty: { displayName: string } } }): Uint8Array { const lines = Array.isArray(payslip.detail) ? payslip.detail.flatMap((value) => { if (!value || typeof value !== 'object' || Array.isArray(value)) return []; const row = value as Record<string, unknown>; return [{ clientName: String(row.clientName ?? 'Client'), paymentDate: String(row.paymentDate ?? ''), gross: String(row.gross ?? '0.00'), commission: String(row.commission ?? '0.00'), net: String(row.net ?? '0.00') }]; }) : []; return generatePayslipPdf({ payslipNumber: payslip.settlementId, businessName: 'FitCrew', coachName: payslip.settlement.coachParty.displayName, periodStart: isoDate(payslip.settlement.periodStart), periodEnd: isoDate(payslip.settlement.periodEnd), issuedAt: isoDate(payslip.issuedAt), grossRevenue: payslip.grossRevenue.toString(), commissionDeducted: payslip.commissionDeducted.toString(), netPaid: payslip.netPaid.toString(), lines }); }
function plainDate(value: string): Date { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new SettlementError('A valid settlement date is required.'); const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.getTime()) || isoDate(date) !== value) throw new SettlementError('A real settlement date is required.'); return date; }
function decimalToMinor(value: string): bigint { const negative = value.startsWith('-'); const unsigned = negative ? value.slice(1) : value; const [major, minor = ''] = unsigned.split('.'); const result = BigInt(major!) * 100n + BigInt(minor.padEnd(2, '0').slice(0, 2)); return negative ? -result : result; }
function amount(value: bigint): string { const negative = value < 0n; const unsigned = negative ? -value : value; return `${negative ? '-' : ''}${unsigned / 100n}.${(unsigned % 100n).toString().padStart(2, '0')}`; }
function sum(values: readonly bigint[]): bigint { return values.reduce((total, value) => total + value, 0n); }
function isoDate(value: Date): string { return value.toISOString().slice(0, 10); }
async function requireOwner(tx: Tx, tenantId: string, userId: string) { const principal = await resolvePrincipal(tx, tenantId, userId); if (!principal || !effectiveAssignments(principal).some((assignment) => assignment.role === 'OwnerAdmin' && assignment.scopeType === 'tenant')) throw new SettlementError('Forbidden.'); return principal; }
async function audit(tx: Tx, tenantId: string, actorPartyId: string, action: string, resourceType: string, resourceId: string, after: object) { await tx.auditLog.create({ data: { tenantId, actorPartyId, action, resourceType, resourceId, before: Prisma.JsonNull, after } }); }
export function cleanSettlementError(error: unknown): string { return error instanceof SettlementError || error instanceof Error && error.name === 'LedgerInvariantError' ? error.message : 'Settlement operation failed.'; }

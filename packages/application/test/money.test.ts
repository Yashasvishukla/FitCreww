import { describe, expect, it } from 'vitest';
import { generatePayslipPdf, LedgerEntry, LedgerInvariantError, ManualConfirmationSource, PercentageWithLifespanWindow, postLedgerEntry, type LedgerAccountRef, type LedgerRepository } from '../src/money/index.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const cash = account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner_cash');
const receivable = account('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'client_receivable');

describe('ledger aggregate properties', () => {
  it('accepts thousands of generated multi-line postings and every result balances', () => {
    const random = mulberry32(0x4f1c0de);
    for (let sample = 0; sample < 10_000; sample += 1) {
      const amounts = Array.from({ length: 1 + Math.floor(random() * 8) }, () => BigInt(1 + Math.floor(random() * 10_000_000)));
      const debitTotal = amounts.reduce((sum, value) => sum + value, 0n);
      const entry = LedgerEntry.post({
        tenantId,
        description: `generated posting ${sample}`,
        referenceType: 'payment',
        referenceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        lines: [
          ...amounts.map((amountMinor) => ({ account: cash, direction: 'debit' as const, amountMinor })),
          { account: receivable, direction: 'credit', amountMinor: debitTotal },
        ],
      });
      expect(entry.signedTotalMinor).toBe(0n);
    }
  });

  it('rejects unbalanced, non-positive, and cross-tenant lines', () => {
    expect(() => posting(100n, 99n)).toThrow(LedgerInvariantError);
    expect(() => posting(0n, 0n)).toThrow('must be positive');
    expect(() => LedgerEntry.post({
      tenantId,
      description: 'cross tenant',
      referenceType: 'payment',
      referenceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      lines: [{ account: cash, direction: 'debit', amountMinor: 1n }, { account: { ...receivable, tenantId: 'other' }, direction: 'credit', amountMinor: 1n }],
    })).toThrow('different tenant');
  });

  it('resolves accounts and saves only a validated aggregate', async () => {
    const saved: LedgerEntry[] = [];
    const repository: LedgerRepository = {
      async getOrCreateAccount(input) { return account(input.partyId, input.purpose); },
      async save(entry) { saved.push(entry); return { id: 'entry-1' }; },
    };
    await expect(postLedgerEntry(repository, {
      tenantId,
      description: 'Client payment confirmed',
      referenceType: 'payment',
      referenceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      lines: [
        { partyId: cash.partyId, purpose: 'owner_cash', direction: 'debit', amountMinor: 125_050n },
        { partyId: receivable.partyId, purpose: 'client_receivable', direction: 'credit', amountMinor: 125_050n },
      ],
    })).resolves.toEqual({ id: 'entry-1' });
    expect(saved[0]?.signedTotalMinor).toBe(0n);
  });
});

describe('manual payment confirmation', () => {
  it('requires evidence and snapshots its source and time', async () => {
    const confirmedAt = new Date('2026-09-05T10:00:00.000Z');
    await expect(new ManualConfirmationSource({}, () => confirmedAt).awaitConfirmation('payment')).rejects.toThrow('requires a UTR or screenshot');
    await expect(new ManualConfirmationSource({ utr: '  UTR123456  ' }, () => confirmedAt).awaitConfirmation('payment')).resolves.toEqual({ source: 'manual', confirmedAt, utr: 'UTR123456', proofMediaAssetId: null });
    await expect(new ManualConfirmationSource({ proofMediaAssetId: 'proof-asset' }, () => confirmedAt).awaitConfirmation('payment')).resolves.toEqual({ source: 'manual', confirmedAt, utr: null, proofMediaAssetId: 'proof-asset' });
  });
});

describe('PercentageWithLifespanWindow golden scenarios', () => {
  const strategy = new PercentageWithLifespanWindow();
  const anchorAt = new Date('2026-01-15T10:00:00.000Z');
  it.each([
    ['mixed price A', 99_999n, 1250, 3, '2026-02-01T00:00:00.000Z', 12_500n, 87_499n],
    ['mixed price B', 250_050n, 3333, 8, '2026-08-15T09:59:59.999Z', 83_342n, 166_708n],
    ['short lifespan', 300_000n, 2000, 1, '2026-02-14T23:59:59.999Z', 60_000n, 240_000n],
  ])('%s', (_name, gross, rate, lifespan, paidAt, cut, payable) => {
    const result = strategy.compute({ amountMinor: gross, confirmedAt: new Date(paidAt) }, { rateBasisPoints: rate, lifespanMonths: lifespan }, { anchorAt });
    expect(result).toMatchObject({ commissionAmountMinor: cut, coachPayableAmountMinor: payable, withinLifespan: true });
  });
  it('excludes a payment exactly at the window edge', () => { const result = strategy.compute({ amountMinor: 100_000n, confirmedAt: new Date('2026-04-15T10:00:00.000Z') }, { rateBasisPoints: 2500, lifespanMonths: 3 }, { anchorAt }); expect(result).toMatchObject({ commissionAmountMinor: 0n, coachPayableAmountMinor: 100_000n, withinLifespan: false }); });
  it('accrues zero commission after expiry', () => { const result = strategy.compute({ amountMinor: 175_000n, confirmedAt: new Date('2027-01-01T00:00:00.000Z') }, { rateBasisPoints: 4000, lifespanMonths: 6 }, { anchorAt }); expect(result).toMatchObject({ commissionAmountMinor: 0n, coachPayableAmountMinor: 175_000n, withinLifespan: false }); });
  it('clamps calendar month ends deterministically', () => { const result = strategy.compute({ amountMinor: 100n, confirmedAt: new Date('2026-02-28T11:59:59.999Z') }, { rateBasisPoints: 1000, lifespanMonths: 1 }, { anchorAt: new Date('2026-01-31T12:00:00.000Z') }); expect(result.windowEndAt.toISOString()).toBe('2026-02-28T12:00:00.000Z'); expect(result.withinLifespan).toBe(true); });
});

describe('payslip PDF', () => {
  it('generates a valid, paginated and traceable PDF document', () => {
    const bytes = generatePayslipPdf({ payslipNumber: 'settlement-1', businessName: 'FitCrew Demo', coachName: 'Coach A', periodStart: '2026-08-01', periodEnd: '2026-08-31', issuedAt: '2026-09-05', grossRevenue: '3000.00', commissionDeducted: '600.00', netPaid: '2400.00', lines: Array.from({ length: 30 }, (_, index) => ({ clientName: `Client ${index + 1}`, paymentDate: '2026-08-15', gross: '100.00', commission: '20.00', net: '80.00' })) });
    const pdf = String.fromCharCode(...bytes);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true); expect(pdf).toContain('/Count 2'); expect(pdf).toContain('NET PAID  INR 2400.00'); expect(pdf.endsWith('%%EOF\n')).toBe(true);
  });
});

function account(id: string, purpose: LedgerAccountRef['purpose']): LedgerAccountRef {
  return { id, tenantId, partyId: id, purpose, currency: 'INR' };
}
function posting(debit: bigint, credit: bigint): LedgerEntry {
  return LedgerEntry.post({ tenantId, description: 'test', referenceType: 'payment', referenceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', lines: [{ account: cash, direction: 'debit', amountMinor: debit }, { account: receivable, direction: 'credit', amountMinor: credit }] });
}
function mulberry32(seed: number): () => number {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let value = Math.imul(seed ^ seed >>> 15, 1 | seed); value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value; return ((value ^ value >>> 14) >>> 0) / 4_294_967_296; };
}

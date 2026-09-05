// Money module public barrel (Architecture §8, §11, §12).
// Owns: LedgerAccount/Entry/Line, CommissionStrategy, ClientEngagementClock,
// Settlement, Payslip use cases. Never imports sibling module internals — it
// reacts to domain events only (enforced by dependency-cruiser rule
// "money-does-not-import-siblings"). Landing starting Level 4.1.

export const MONEY_MODULE = 'money';
export { generatePayslipPdf } from './payslip-pdf.js';
export type { PayslipPdfInput, PayslipPdfLine } from './payslip-pdf.js';

export type LedgerAccountPurpose =
  | 'client_receivable'
  | 'owner_cash'
  | 'coach_payable'
  | 'commission_income'
  | 'org_agreement_receivable'
  | 'refund_absorption_expense';
export type LedgerReferenceType = 'payment' | 'settlement' | 'correction';
export type LedgerDirection = 'debit' | 'credit';

export type LedgerAccountRef = {
  readonly id: string;
  readonly tenantId: string;
  readonly partyId: string;
  readonly purpose: LedgerAccountPurpose;
  readonly currency: 'INR';
};

export type LedgerLineDraft = {
  readonly account: LedgerAccountRef;
  readonly direction: LedgerDirection;
  /** Positive paise. Major-unit floating point values never enter the ledger. */
  readonly amountMinor: bigint;
};

export type LedgerEntryDraft = {
  readonly tenantId: string;
  readonly description: string;
  readonly referenceType: LedgerReferenceType;
  readonly referenceId: string;
  readonly reversesEntryId?: string;
  readonly lines: readonly LedgerLineDraft[];
};

export class LedgerInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerInvariantError';
  }
}

/** Immutable, validated journal aggregate. Persistence may only accept this shape. */
export class LedgerEntry {
  private constructor(
    readonly tenantId: string,
    readonly description: string,
    readonly referenceType: LedgerReferenceType,
    readonly referenceId: string,
    readonly reversesEntryId: string | undefined,
    readonly lines: readonly LedgerLineDraft[],
  ) {}

  static post(draft: LedgerEntryDraft): LedgerEntry {
    if (draft.description.trim().length === 0) {
      throw new LedgerInvariantError('Ledger entry description is required.');
    }
    if (draft.lines.length < 2) {
      throw new LedgerInvariantError('Ledger entry requires at least two lines.');
    }

    let signedTotal = 0n;
    for (const line of draft.lines) {
      if (line.amountMinor <= 0n) {
        throw new LedgerInvariantError('Ledger line amount must be positive.');
      }
      if (line.account.tenantId !== draft.tenantId) {
        throw new LedgerInvariantError('Ledger line account belongs to a different tenant.');
      }
      if (line.account.currency !== 'INR') {
        throw new LedgerInvariantError('Ledger line currency must be INR.');
      }
      signedTotal += line.direction === 'debit' ? line.amountMinor : -line.amountMinor;
    }
    if (signedTotal !== 0n) {
      throw new LedgerInvariantError(`Ledger entry does not balance (net ${signedTotal} minor units).`);
    }

    return new LedgerEntry(
      draft.tenantId,
      draft.description.trim(),
      draft.referenceType,
      draft.referenceId,
      draft.reversesEntryId,
      Object.freeze(draft.lines.map((line) => Object.freeze({ ...line }))),
    );
  }

  get signedTotalMinor(): bigint {
    return this.lines.reduce(
      (total, line) => total + (line.direction === 'debit' ? line.amountMinor : -line.amountMinor),
      0n,
    );
  }
}

export interface LedgerRepository {
  getOrCreateAccount(input: Omit<LedgerAccountRef, 'id'>): Promise<LedgerAccountRef>;
  save(entry: LedgerEntry): Promise<{ readonly id: string }>;
}

export type PostLedgerInput = Omit<LedgerEntryDraft, 'lines'> & {
  readonly lines: readonly {
    readonly partyId: string;
    readonly purpose: LedgerAccountPurpose;
    readonly direction: LedgerDirection;
    readonly amountMinor: bigint;
  }[];
};

/** Runs inside the caller's transaction so the causal event and journal commit together. */
export async function postLedgerEntry(
  repository: LedgerRepository,
  input: PostLedgerInput,
): Promise<{ readonly id: string }> {
  const accounts = new Map<string, LedgerAccountRef>();
  const lines: LedgerLineDraft[] = [];
  for (const line of input.lines) {
    const key = `${line.partyId}:${line.purpose}`;
    let account = accounts.get(key);
    if (!account) {
      account = await repository.getOrCreateAccount({ tenantId: input.tenantId, partyId: line.partyId, purpose: line.purpose, currency: 'INR' });
      accounts.set(key, account);
    }
    lines.push({ account, direction: line.direction, amountMinor: line.amountMinor });
  }

  return repository.save(LedgerEntry.post({ ...input, lines }));
}

export function minorUnitsToDecimal(amountMinor: bigint): string {
  if (amountMinor <= 0n) {
    throw new LedgerInvariantError('Ledger line amount must be positive.');
  }
  const major = amountMinor / 100n;
  const minor = amountMinor % 100n;
  return `${major}.${minor.toString().padStart(2, '0')}`;
}

export type PaymentConfirmation = {
  readonly source: 'manual' | 'gateway';
  readonly confirmedAt: Date;
  readonly utr: string | null;
  readonly proofMediaAssetId: string | null;
};

export interface PaymentConfirmationSource {
  awaitConfirmation(paymentId: string): Promise<PaymentConfirmation>;
}

/** MVP adapter. It validates human-supplied evidence but knows nothing about posting. */
export class ManualConfirmationSource implements PaymentConfirmationSource {
  constructor(
    private readonly evidence: { readonly utr?: string | null; readonly proofMediaAssetId?: string | null },
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async awaitConfirmation(_paymentId: string): Promise<PaymentConfirmation> {
    const utr = this.evidence.utr?.trim() || null;
    const proofMediaAssetId = this.evidence.proofMediaAssetId?.trim() || null;
    if (utr === null && proofMediaAssetId === null) {
      throw new LedgerInvariantError('Manual confirmation requires a UTR or screenshot proof.');
    }
    if (utr !== null && (utr.length < 6 || utr.length > 64 || !/^[A-Za-z0-9/_-]+$/.test(utr))) {
      throw new LedgerInvariantError('UTR must be 6–64 letters, numbers, slash, underscore, or hyphen characters.');
    }
    return { source: 'manual', confirmedAt: this.clock(), utr, proofMediaAssetId };
  }
}

export type ConfirmedPaymentForCommission = { readonly amountMinor: bigint; readonly confirmedAt: Date };
export type CommissionTermsSnapshot = { readonly rateBasisPoints: number; readonly lifespanMonths: number };
export type EngagementClockSnapshot = { readonly anchorAt: Date };
export type CommissionResult = {
  readonly grossAmountMinor: bigint;
  readonly commissionAmountMinor: bigint;
  readonly coachPayableAmountMinor: bigint;
  readonly rateBasisPointsApplied: number;
  readonly lifespanMonthsApplied: number;
  readonly windowAnchorAt: Date;
  readonly windowEndAt: Date;
  readonly withinLifespan: boolean;
};

export interface ICommissionStrategy {
  compute(payment: ConfirmedPaymentForCommission, terms: CommissionTermsSnapshot, clock: EngagementClockSnapshot): CommissionResult;
}

export class PercentageWithLifespanWindow implements ICommissionStrategy {
  compute(payment: ConfirmedPaymentForCommission, terms: CommissionTermsSnapshot, clock: EngagementClockSnapshot): CommissionResult {
    if (payment.amountMinor <= 0n) throw new LedgerInvariantError('Commission requires a positive payment.');
    if (!Number.isInteger(terms.rateBasisPoints) || terms.rateBasisPoints < 0 || terms.rateBasisPoints > 10_000) throw new LedgerInvariantError('Commission rate must be 0–100%.');
    if (!Number.isInteger(terms.lifespanMonths) || terms.lifespanMonths <= 0) throw new LedgerInvariantError('Commission lifespan must be positive whole months.');
    const windowEndAt = addCalendarMonths(clock.anchorAt, terms.lifespanMonths);
    const withinLifespan = payment.confirmedAt.getTime() < windowEndAt.getTime();
    const commissionAmountMinor = withinLifespan ? divideRoundHalfUp(payment.amountMinor * BigInt(terms.rateBasisPoints), 10_000n) : 0n;
    return { grossAmountMinor: payment.amountMinor, commissionAmountMinor, coachPayableAmountMinor: payment.amountMinor - commissionAmountMinor, rateBasisPointsApplied: terms.rateBasisPoints, lifespanMonthsApplied: terms.lifespanMonths, windowAnchorAt: new Date(clock.anchorAt), windowEndAt, withinLifespan };
  }
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint { return (numerator + denominator / 2n) / denominator; }
function addCalendarMonths(value: Date, months: number): Date {
  const result = new Date(value); const originalDay = result.getUTCDate(); result.setUTCDate(1); result.setUTCMonth(result.getUTCMonth() + months); const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate(); result.setUTCDate(Math.min(originalDay, lastDay)); return result;
}

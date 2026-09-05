import {
  minorUnitsToDecimal,
  type LedgerAccountPurpose,
  type LedgerAccountRef,
  type LedgerEntry,
  type LedgerRepository,
} from '@fitcrew/application/money';

type LedgerTransaction = {
  readonly $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  readonly ledgerAccount: {
    findFirst(args: unknown): Promise<{ id: string; tenantId: string; partyId: string; purpose: LedgerAccountPurpose; currency: string } | null>;
    create(args: unknown): Promise<{ id: string; tenantId: string; partyId: string; purpose: LedgerAccountPurpose; currency: string }>;
  };
  readonly ledgerEntry: {
    create(args: unknown): Promise<{ id: string }>;
  };
  readonly ledgerLine: {
    createMany(args: unknown): Promise<{ count: number }>;
  };
};

/** Prisma adapter intentionally accepts a transaction client, never the global client. */
export class PrismaLedgerRepository implements LedgerRepository {
  constructor(private readonly tx: LedgerTransaction) {}

  async getOrCreateAccount(input: Omit<LedgerAccountRef, 'id'>): Promise<LedgerAccountRef> {
    const where = { tenantId: input.tenantId, partyId: input.partyId, purpose: input.purpose, currency: input.currency };
    let account = await this.tx.ledgerAccount.findFirst({ where });
    if (account === null) {
      await this.tx.$executeRaw`INSERT INTO public.ledger_account (tenant_id, party_id, purpose, currency) VALUES (${input.tenantId}::uuid, ${input.partyId}::uuid, ${input.purpose}::public."LedgerAccountPurpose", ${input.currency}) ON CONFLICT (tenant_id, party_id, purpose, currency) DO NOTHING`;
      account = await this.tx.ledgerAccount.findFirst({ where });
      if (account === null) throw new Error('Ledger account could not be resolved.');
    }
    if (account.currency !== 'INR') {
      throw new Error(`Unsupported ledger currency: ${account.currency}`);
    }
    return { ...account, currency: 'INR' };
  }

  async save(entry: LedgerEntry): Promise<{ readonly id: string }> {
    const persisted = await this.tx.ledgerEntry.create({
      data: {
        tenantId: entry.tenantId,
        description: entry.description,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        reversesEntryId: entry.reversesEntryId,
      },
      select: { id: true },
    });
    // The repository can only be constructed with the caller's transaction.
    // The deferred trigger therefore sees every line when that transaction commits.
    await this.tx.ledgerLine.createMany({
      data: entry.lines.map((line) => ({
        tenantId: entry.tenantId,
        entryId: persisted.id,
        accountId: line.account.id,
        direction: line.direction,
        amount: minorUnitsToDecimal(line.amountMinor),
      })),
    });
    // Surface a constraint failure before returning from the repository. The
    // database still re-checks this constraint at transaction boundaries.
    await this.tx.$executeRaw`SET CONSTRAINTS ledger_line_balance_check IMMEDIATE`;
    return persisted;
  }
}

import { tenantScoping } from './tenant-scoping.js';
import { assertTenantId } from './tenant-scoping.js';

type TransactionOptions = {
  readonly maxWait?: number;
  readonly timeout?: number;
  readonly isolationLevel?: unknown;
};

export type TransactionClient = {
  readonly $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => unknown;
};

export type TenantScopedTransactionClient<TClient = unknown> = TClient;

export type TransactionCapableClient<TTransactionClient extends TransactionClient = TransactionClient> = {
  readonly $transaction: <TResult>(
    callback: (tx: TTransactionClient) => Promise<TResult>,
    options?: TransactionOptions,
  ) => Promise<TResult>;
  readonly $extends: (extension: unknown) => TransactionCapableClient<TTransactionClient>;
};

export type WithTenantOptions = {
  readonly tenantScopedModels?: readonly string[];
  readonly transaction?: TransactionOptions;
};

export async function withTenant<TResult, TTransactionClient extends TransactionClient = TransactionClient>(
  prisma: TransactionCapableClient<TTransactionClient>,
  tenantId: string,
  callback: (tx: TenantScopedTransactionClient<TTransactionClient>) => Promise<TResult>,
  options: WithTenantOptions = {},
): Promise<TResult> {
  assertTenantId(tenantId);

  const scopedPrisma = prisma.$extends(
    tenantScoping({
      tenantId,
      tenantScopedModels: options.tenantScopedModels,
    }),
  );

  return scopedPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return callback(tx);
  }, options.transaction);
}

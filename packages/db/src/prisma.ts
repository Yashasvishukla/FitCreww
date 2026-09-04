import { PrismaClient } from '@prisma/client';

declare const process: { env: Record<string, string | undefined> };

declare global {
  var fitcrewPrisma: PrismaClient | undefined;
}

// Request handlers and application services use this client through withTenant()
// so tenant_id stamping and transaction-local RLS context are always applied.
export const prisma = globalThis.fitcrewPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.fitcrewPrisma = prisma;
}

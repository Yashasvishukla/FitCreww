import { PrismaClient } from '@prisma/client';

declare const process: { env: Record<string, string | undefined> };

declare global {
  var fitcrewAuthPrisma: PrismaClient | undefined;
}

// This client is only for platform authentication tables. Tenant data must use
// withTenant(), which sets the transaction-local RLS context.
export const authPrisma = globalThis.fitcrewAuthPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.fitcrewAuthPrisma = authPrisma;
}

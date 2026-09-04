// Public barrel for @fitcrew/db.

export const DB_PACKAGE_NAME = '@fitcrew/db';

export { authPrisma } from './auth-prisma.js';
export { authenticateUser, normalizeEmail } from './credentials.js';
export type { AuthenticatedUser } from './credentials.js';
export { hashPassword, verifyPassword } from './password.js';
export { TENANT_SCOPED_MODELS, applyTenantScope, assertTenantId, tenantScoping } from './tenant-scoping.js';
export type { TenantScopingOptions } from './tenant-scoping.js';
export { withTenant } from './with-tenant.js';
export type { TenantScopedTransactionClient, TransactionCapableClient, WithTenantOptions } from './with-tenant.js';

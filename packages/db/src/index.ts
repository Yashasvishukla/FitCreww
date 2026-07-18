// Public barrel for @fitcrew/db.
// The tenant-scoping Prisma Client Extension and the withTenant(tenantId, callback)
// transaction wrapper (Architecture §4, §5) land in Chunk 1.2 ("Tenancy core"),
// once the real schema exists. This package intentionally exports nothing yet.

export const DB_PACKAGE_NAME = '@fitcrew/db';

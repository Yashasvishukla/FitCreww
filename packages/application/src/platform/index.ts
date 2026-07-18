// Platform module public barrel (Architecture §5, §11, §12).
// Owns: Tenant, TenantConfig, PlatformPlan, PlatformSubscription — the
// platform-schema, non-tenant-scoped side of the system, kept strictly
// separate from in-tenant Money vocabulary (PRD §4.7). Landing starting Level 1.2/5.4.

export const PLATFORM_MODULE = 'platform';

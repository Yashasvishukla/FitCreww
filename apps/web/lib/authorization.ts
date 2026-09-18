import { effectiveAssignments, type Principal } from '@fitcrew/application';
import { getPrincipalForUser, prisma } from '@fitcrew/db';
import { redirect } from 'next/navigation';
import type { AppRole } from '@/app/(protected)/network-nav';

export function requireTenantContext(tenantId: string | undefined): string {
  if (!tenantId) redirect('/dashboard');
  return tenantId;
}

export async function requireFeature(userId: string, tenantId: string, allowedRoles: readonly AppRole[]): Promise<Principal> {
  const principal = await getPrincipalForUser(prisma, tenantId, userId);
  if (!principal || !allowedRoles.some((role) => effectiveAssignments(principal).some((assignment) => assignment.role === role))) {
    redirect(defaultWorkspacePath(principal, tenantId) ?? `/profile?tenantId=${encodeURIComponent(tenantId)}`);
  }
  return principal;
}

export function hasRole(principal: Principal, role: AppRole): boolean {
  return effectiveAssignments(principal).some((assignment) => assignment.role === role);
}

export function isTenantOwner(principal: Principal | null): boolean {
  return principal !== null && effectiveAssignments(principal).some(
    (assignment) => assignment.role === 'OwnerAdmin' && assignment.scopeType === 'tenant',
  );
}

/** Returns the first workspace the current active role is allowed to use. */
export function defaultWorkspacePath(principal: Principal | null, tenantId: string): string | null {
  if (!principal) return null;
  const query = `?tenantId=${encodeURIComponent(tenantId)}`;
  if (isTenantOwner(principal)) return `/dashboard${query}`;
  if (hasRole(principal, 'Client')) return `/clients${query}`;
  if (hasRole(principal, 'Coach')) return `/training${query}`;
  if (hasRole(principal, 'OrgAdmin')) return `/organizations${query}`;
  return null;
}

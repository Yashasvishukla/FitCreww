import { effectiveAssignments, type Principal } from '@fitcrew/application';
import { getPrincipalForUser, prisma } from '@fitcrew/db';
import { redirect } from 'next/navigation';
import type { AppRole } from '@/app/(protected)/network-nav';

export const DEMO_TENANT_ID = '11111111-1111-4111-8111-111111111111';

export async function requireFeature(userId: string, tenantId: string, allowedRoles: readonly AppRole[]): Promise<Principal> {
  const principal = await getPrincipalForUser(prisma, tenantId, userId);
  if (!principal || !allowedRoles.some((role) => effectiveAssignments(principal).some((assignment) => assignment.role === role))) {
    redirect(`/dashboard?tenantId=${tenantId}`);
  }
  return principal;
}

export function hasRole(principal: Principal, role: AppRole): boolean {
  return effectiveAssignments(principal).some((assignment) => assignment.role === role);
}

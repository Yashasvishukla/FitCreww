import { effectiveAssignments } from '@fitcrew/application';
import { authPrisma } from './auth-prisma.js';
import { getPrincipalForUser } from './access-gate.js';
import { prisma } from './prisma.js';

export type ActiveWorkspace = {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly roles: readonly ('OwnerAdmin' | 'Coach' | 'OrgAdmin' | 'Client')[];
};

/** Resolves each candidate membership in its own RLS-scoped transaction. */
export async function listActiveWorkspacesForUser(userId: string): Promise<readonly ActiveWorkspace[]> {
  const memberships = await authPrisma.userTenantMembership.findMany({
    where: { userId },
    select: { tenantId: true, tenant: { select: { name: true } } },
    orderBy: { tenant: { name: 'asc' } },
  });
  const workspaces = await Promise.all(memberships.map(async (membership) => {
    const principal = await getPrincipalForUser(prisma, membership.tenantId, userId);
    const roles = principal ? [...new Set(effectiveAssignments(principal).map((assignment) => assignment.role))] : [];
    return roles.length ? { tenantId: membership.tenantId, tenantName: membership.tenant.name, roles } : null;
  }));
  return workspaces.filter((workspace): workspace is NonNullable<typeof workspace> => workspace !== null);
}

import { auth } from '@/auth';
import { effectiveAssignments } from '@fitcrew/application';
import { getPrincipalForUser, prisma } from '@fitcrew/db';
import { NetworkNavClient } from './network-nav-client';

export type AppRole = 'OwnerAdmin' | 'Coach' | 'OrgAdmin' | 'Client';

export async function NetworkNav({ tenantId }: { tenantId?: string }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!tenantId) return <NetworkNavClient roles={[]} tenantId={tenantId} />;
  const principal = await getPrincipalForUser(prisma, tenantId, session.user.id);
  const roles = [...new Set(principal ? effectiveAssignments(principal).map((assignment) => assignment.role) : [])] as AppRole[];
  return <NetworkNavClient roles={roles} tenantId={tenantId} />;
}

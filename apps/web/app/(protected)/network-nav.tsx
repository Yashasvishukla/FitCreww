import { auth } from '@/auth';
import { getPrincipalForUser, prisma } from '@fitcrew/db';
import { NetworkNavClient } from './network-nav-client';

export type AppRole = 'OwnerAdmin' | 'Coach' | 'OrgAdmin' | 'Client';

export async function NetworkNav({ tenantId }: { tenantId?: string }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const principal = await getPrincipalForUser(prisma, tenantId ?? '11111111-1111-4111-8111-111111111111', session.user.id);
  const roles = [...new Set(principal?.assignments.map((assignment) => assignment.role) ?? [])] as AppRole[];
  return <NetworkNavClient roles={roles} />;
}

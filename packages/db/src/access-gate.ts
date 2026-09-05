import {
  createAccessGate,
  type AccessGate,
  type Principal,
  type PrincipalAssignment,
} from '@fitcrew/application';
import { Prisma, PrismaClient } from '@prisma/client';
import type { TransactionCapableClient } from './with-tenant.js';
import { withTenant } from './with-tenant.js';

type TransactionClient = Prisma.TransactionClient;

export async function resolvePrincipal(
  tx: TransactionClient,
  tenantId: string,
  userId: string,
): Promise<Principal | null> {
  const party = await tx.party.findFirst({
    where: { tenantId, userId },
    include: { roleAssignments: true },
  });

  if (!party) return null;

  return {
    tenantId,
    partyId: party.id,
    assignments: party.roleAssignments.map((assignment): PrincipalAssignment => ({
      role: assignment.role,
      scopeType: assignment.scopeType === 'organization' ? 'organization' : assignment.scopeType === 'self' ? 'self' : 'tenant',
      scopeId: assignment.scopeId,
      validFrom: assignment.validFrom.toISOString().slice(0, 10),
      validTo: assignment.validTo?.toISOString().slice(0, 10) ?? null,
    })),
  };
}

export function accessGateForPrincipal(
  tx: TransactionClient,
  principal: Principal,
  now = new Date(),
): AccessGate {
  return createAccessGate(now, async (audit) => {
    await tx.auditLog.create({
      data: {
        tenantId: audit.tenantId,
        actorPartyId: audit.actorPartyId,
        action: audit.action,
        resourceType: audit.resourceType,
        resourceId: audit.resourceId,
        before: audit.before ?? Prisma.JsonNull,
        after: audit.after,
      },
    });
  });
}

export async function canUserAccess(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  action: Parameters<AccessGate['can']>[1],
  resource: Parameters<AccessGate['can']>[2],
): Promise<boolean | null> {
  return withTenant(
    prisma as unknown as TransactionCapableClient<Prisma.TransactionClient>,
    tenantId,
    async (tx) => {
      const principal = await resolvePrincipal(tx, tenantId, userId);
      if (!principal) return null;
      return accessGateForPrincipal(tx, principal).can(principal, action, resource);
    },
  );
}

export async function getPrincipalForUser(prisma: PrismaClient, tenantId: string, userId: string): Promise<Principal | null> {
  return withTenant(prisma as unknown as TransactionCapableClient<Prisma.TransactionClient>, tenantId, (tx) => resolvePrincipal(tx, tenantId, userId));
}

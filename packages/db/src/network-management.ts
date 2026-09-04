import { DateRange, LifespanMonths, Money, Percentage } from '@fitcrew/domain';
import { Prisma, PrismaClient } from '@prisma/client';
import { type EmailAdapter } from '@fitcrew/application';
import { createInviteForPrincipal, type InviteResult } from './invites.js';
import { accessGateForPrincipal, resolvePrincipal } from './access-gate.js';
import { prisma } from './prisma.js';
import { withTenant } from './with-tenant.js';

type TransactionClient = Prisma.TransactionClient;

export type CoachRosterEntry = {
  readonly partyId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly engagementId: string;
  readonly commissionRate: string;
  readonly commissionLifespanMonths: number;
  readonly validFrom: string;
  readonly validTo: string | null;
};

export type CoachTermsInput = {
  readonly engagementId: string;
  readonly commissionRate: string | number;
  readonly commissionLifespanMonths: number;
};

export type OrganizationInput = {
  readonly name: string;
  readonly email: string;
  readonly agreementAmount: string | number;
  readonly agreementStart: string;
  readonly agreementEnd: string | null;
  readonly baseUrl: string;
};

export async function listCoachRosterForUser(prismaClient: PrismaClient, tenantId: string, userId: string): Promise<readonly CoachRosterEntry[]> {
  return withTenant(prismaClient as never, tenantId, async (tx: TransactionClient) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal || !(await accessGateForPrincipal(tx, principal).can(principal, 'read', { type: 'party', tenantId }))) {
      throw new NetworkManagementError('Forbidden.');
    }
    const rows = await tx.engagement.findMany({
      where: { tenantId, upstreamPartyId: principal.partyId, downstreamParty: { kind: 'person' } },
      include: { downstreamParty: { include: { user: { select: { email: true } } } } },
      orderBy: { downstreamParty: { displayName: 'asc' } },
    });
    return rows.map((row) => ({
      partyId: row.downstreamPartyId,
      displayName: row.downstreamParty.displayName,
      email: row.downstreamParty.user?.email ?? null,
      engagementId: row.id,
      commissionRate: row.commissionRate.toString(),
      commissionLifespanMonths: row.commissionLifespanMonths,
      validFrom: row.validFrom.toISOString().slice(0, 10),
      validTo: row.validTo?.toISOString().slice(0, 10) ?? null,
    }));
  });
}

export async function listOrganizationsForUser(prismaClient: PrismaClient, tenantId: string, userId: string) {
  return withTenant(prismaClient as never, tenantId, async (tx: TransactionClient) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal) throw new NetworkManagementError('Forbidden.');
    const owner = principal.assignments.some((assignment) => assignment.role === 'OwnerAdmin');
    const where = owner ? { tenantId } : accessGateForPrincipal(tx, principal).scopeQuery(principal, 'Organization') as never;
    const rows = await tx.organization.findMany({ where, include: { party: true }, orderBy: { party: { displayName: 'asc' } } });
    return rows.map((row) => ({ organizationId: row.id, name: row.party.displayName, status: row.status, agreementTerms: row.agreementTerms }));
  });
}

export async function updateCoachTermsForUser(prismaClient: PrismaClient, tenantId: string, userId: string, input: CoachTermsInput) {
  return withTenant(prismaClient as never, tenantId, async (tx: TransactionClient) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal) throw new NetworkManagementError('Forbidden.');
    const gate = accessGateForPrincipal(tx, principal);
    const engagement = await tx.engagement.findFirst({ where: { id: input.engagementId } });
    if (!engagement || !(await gate.can(principal, 'update', { type: 'engagement', id: engagement.id, tenantId }))) {
      throw new NetworkManagementError('Forbidden.');
    }
    const rate = Percentage.of(input.commissionRate);
    const lifespan = LifespanMonths.of(input.commissionLifespanMonths);
    const updated = await tx.engagement.update({
      where: { id: engagement.id },
      data: { commissionRate: rate.toString(), commissionLifespanMonths: lifespan.value },
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorPartyId: principal.partyId,
        action: 'update',
        resourceType: 'engagement',
        resourceId: engagement.id,
        before: { commissionRate: engagement.commissionRate.toString(), commissionLifespanMonths: engagement.commissionLifespanMonths },
        after: { commissionRate: rate.toString(), commissionLifespanMonths: lifespan.value },
      },
    });
    return { engagementId: updated.id, commissionRate: rate.toString(), commissionLifespanMonths: lifespan.value };
  });
}

export async function createOrganizationAndInviteForUser(
  prismaClient: PrismaClient,
  tenantId: string,
  userId: string,
  input: OrganizationInput,
  emailAdapter: EmailAdapter,
): Promise<{ organizationId: string; invite: InviteResult }> {
  return withTenant(prismaClient as never, tenantId, async (tx: TransactionClient) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal) throw new NetworkManagementError('Forbidden.');
    const gate = accessGateForPrincipal(tx, principal);
    if (!(await gate.can(principal, 'create', { type: 'organization', tenantId }))) throw new NetworkManagementError('Forbidden.');
    const name = input.name.trim();
    if (!name || name.length > 200) throw new NetworkManagementError('Organization name is required.');
    const amount = Money.inr(input.agreementAmount).toString();
    const validity = DateRange.of(input.agreementStart, input.agreementEnd);
    const party = await tx.party.create({ data: { tenantId, kind: 'institution', displayName: name, contact: { email: input.email.trim().toLowerCase() } } });
    const organization = await tx.organization.create({
      data: { tenantId, partyId: party.id, agreementTerms: { amount, currency: 'INR', start: validity.from, end: validity.to } },
    });
    await tx.auditLog.create({
      data: { tenantId, actorPartyId: principal.partyId, action: 'create', resourceType: 'organization', resourceId: organization.id, before: Prisma.JsonNull, after: { name, agreementAmount: amount } },
    });
    const invite = await createInviteForPrincipal(tx, principal, gate, {
      email: input.email, role: 'OrgAdmin', scopeType: 'organization', scopeId: organization.id, baseUrl: input.baseUrl,
    }, emailAdapter);
    return { organizationId: organization.id, invite };
  });
}

export class NetworkManagementError extends Error {
  constructor(message: string) { super(message); this.name = 'NetworkManagementError'; }
}

export function cleanNetworkManagementError(error: unknown): string {
  return error instanceof NetworkManagementError ? error.message : 'Network operation failed.';
}

export { prisma };

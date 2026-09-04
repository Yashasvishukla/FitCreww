import { DomainError, DateRange, Engagement, EngagementId, LifespanMonths, PartyId, Percentage } from '@fitcrew/domain';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import type { TransactionCapableClient } from './with-tenant.js';
import { withTenant } from './with-tenant.js';

const demoTenantId = '11111111-1111-4111-8111-111111111111';
const ownerPartyId = '11111111-1111-4111-8111-000000000001';
const coachOnePartyId = '11111111-1111-4111-8111-000000000002';
const coachTwoPartyId = '11111111-1111-4111-8111-000000000003';
const ownerRoleAssignmentId = '11111111-1111-4111-8111-000000000011';
const coachOneRoleAssignmentId = '11111111-1111-4111-8111-000000000012';
const coachTwoRoleAssignmentId = '11111111-1111-4111-8111-000000000013';
const coachOneEngagementId = '11111111-1111-4111-8111-000000000021';
const coachTwoEngagementId = '11111111-1111-4111-8111-000000000022';
const overlappingEngagementId = '11111111-1111-4111-8111-000000000023';

export type DemoReferenceNetworkInput = {
  readonly tenantId?: string;
  readonly violation?: 'self-loop' | 'overlap';
};

export type DemoReferenceNetworkResult = {
  readonly tenantId: string;
  readonly parties: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly role: 'OwnerAdmin' | 'Coach';
  }[];
  readonly engagements: readonly {
    readonly id: string;
    readonly upstreamPartyId: string;
    readonly downstreamPartyId: string;
    readonly commissionRate: string;
    readonly commissionLifespanMonths: number;
  }[];
};

export async function seedDemoReferenceNetwork(
  input: DemoReferenceNetworkInput = {},
): Promise<DemoReferenceNetworkResult> {
  const tenantId = input.tenantId ?? demoTenantId;

  return withTenant(prisma as unknown as TransactionCapableClient<Prisma.TransactionClient>, tenantId, async (tx) => {
    await seedReferenceNetwork(tx, tenantId);

    if (input.violation === 'self-loop') {
      await seedSelfLoopViolation(tx, tenantId);
    }

    if (input.violation === 'overlap') {
      await seedOverlapViolation(tx, tenantId);
    }

    return {
      tenantId,
      parties: [
        { id: ownerPartyId, displayName: 'Rajesh Owner', role: 'OwnerAdmin' },
        { id: coachOnePartyId, displayName: 'Priya Coach', role: 'Coach' },
        { id: coachTwoPartyId, displayName: 'Aman Coach', role: 'Coach' },
      ],
      engagements: [
        {
          id: coachOneEngagementId,
          upstreamPartyId: ownerPartyId,
          downstreamPartyId: coachOnePartyId,
          commissionRate: '12.50',
          commissionLifespanMonths: 3,
        },
        {
          id: coachTwoEngagementId,
          upstreamPartyId: ownerPartyId,
          downstreamPartyId: coachTwoPartyId,
          commissionRate: '18.00',
          commissionLifespanMonths: 8,
        },
      ],
    };
  });
}

export function cleanDemoReferenceNetworkError(error: unknown): string {
  if (error instanceof DomainError) {
    return error.message;
  }

  if (isPrismaKnownRequestError(error)) {
    if (error.code === 'P2002') {
      return 'A duplicate or overlapping network record already exists.';
    }

    if (error.code === 'P2003') {
      return 'The network record references a missing tenant or party.';
    }
  }

  const text = error instanceof Error ? error.message : String(error);
  if (text.includes('engagement_no_overlapping_duplicate_edges')) {
    return 'Engagement overlaps an existing edge for the same upstream and downstream parties.';
  }

  if (text.includes('role_assignment_no_overlapping_duplicate')) {
    return 'Role assignment overlaps an existing assignment for the same party, role, and scope.';
  }

  if (text.includes('engagement_no_self_loop')) {
    return 'Engagement cannot be a self-loop.';
  }

  return 'Network seed failed.';
}

async function seedReferenceNetwork(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  const ownerUser = await tx.user.findUnique({ where: { email: 'owner@fitcrew.test' }, select: { id: true } });
  const ownerUpdate = await tx.party.updateMany({
    where: { id: ownerPartyId },
    data: {
      userId: ownerUser?.id ?? null,
      kind: 'person',
      displayName: 'Rajesh Owner',
      status: 'active',
      contact: { email: 'owner@fitcrew.test' },
    },
  });

  if (ownerUpdate.count === 0) {
    await tx.party.create({
      data: {
      id: ownerPartyId,
      tenantId,
      userId: ownerUser?.id ?? null,
      kind: 'person',
      displayName: 'Rajesh Owner',
      status: 'active',
      contact: { email: 'owner@fitcrew.test' },
    },
    });
  }

  const coachOneUpdate = await tx.party.updateMany({
    where: { id: coachOnePartyId },
    data: {
      kind: 'person',
      displayName: 'Priya Coach',
      status: 'active',
      contact: { email: 'priya.coach@fitcrew.test' },
    },
  });

  if (coachOneUpdate.count === 0) {
    await tx.party.create({
      data: {
      id: coachOnePartyId,
      tenantId,
      kind: 'person',
      displayName: 'Priya Coach',
      status: 'active',
      contact: { email: 'priya.coach@fitcrew.test' },
    },
    });
  }

  const coachTwoUpdate = await tx.party.updateMany({
    where: { id: coachTwoPartyId },
    data: {
      kind: 'person',
      displayName: 'Aman Coach',
      status: 'active',
      contact: { email: 'aman.coach@fitcrew.test' },
    },
  });

  if (coachTwoUpdate.count === 0) {
    await tx.party.create({
      data: {
      id: coachTwoPartyId,
      tenantId,
      kind: 'person',
      displayName: 'Aman Coach',
      status: 'active',
      contact: { email: 'aman.coach@fitcrew.test' },
    },
    });
  }

  await seedRoleAssignment(tx, tenantId, ownerRoleAssignmentId, ownerPartyId, 'OwnerAdmin', 'tenant', null, '2026-09-01');
  await seedRoleAssignment(tx, tenantId, coachOneRoleAssignmentId, coachOnePartyId, 'Coach', 'tenant', null, '2026-09-01');
  await seedRoleAssignment(tx, tenantId, coachTwoRoleAssignmentId, coachTwoPartyId, 'Coach', 'tenant', null, '2026-09-01');

  await seedEngagement(tx, tenantId, {
    id: coachOneEngagementId,
    upstreamPartyId: ownerPartyId,
    downstreamPartyId: coachOnePartyId,
    commissionRate: '12.50',
    commissionLifespanMonths: 3,
    validFrom: '2026-09-01',
    validTo: null,
  });

  await seedEngagement(tx, tenantId, {
    id: coachTwoEngagementId,
    upstreamPartyId: ownerPartyId,
    downstreamPartyId: coachTwoPartyId,
    commissionRate: '18.00',
    commissionLifespanMonths: 8,
    validFrom: '2026-09-01',
    validTo: null,
  });
}

async function seedSelfLoopViolation(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await seedEngagement(tx, tenantId, {
    id: overlappingEngagementId,
    upstreamPartyId: ownerPartyId,
    downstreamPartyId: ownerPartyId,
    commissionRate: '10.00',
    commissionLifespanMonths: 3,
    validFrom: '2026-09-01',
    validTo: null,
  });
}

async function seedOverlapViolation(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await seedEngagement(tx, tenantId, {
    id: overlappingEngagementId,
    upstreamPartyId: ownerPartyId,
    downstreamPartyId: coachOnePartyId,
    commissionRate: '15.00',
    commissionLifespanMonths: 6,
    validFrom: '2026-10-01',
    validTo: null,
  });
}

async function seedRoleAssignment(
  tx: Prisma.TransactionClient,
  tenantId: string,
  id: string,
  partyId: string,
  role: 'OwnerAdmin' | 'Coach',
  scopeType: 'tenant',
  scopeId: null,
  validFrom: string,
): Promise<void> {
  const update = await tx.roleAssignment.updateMany({
    where: { id },
    data: {
      partyId,
      role,
      scopeType,
      scopeId,
      validFrom: asDate(validFrom),
      validTo: null,
    },
  });

  if (update.count === 0) {
    await tx.roleAssignment.create({
      data: {
      id,
      tenantId,
      partyId,
      role,
      scopeType,
      scopeId,
      validFrom: asDate(validFrom),
      validTo: null,
    },
    });
  }
}

async function seedEngagement(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: {
    readonly id: string;
    readonly upstreamPartyId: string;
    readonly downstreamPartyId: string;
    readonly commissionRate: string;
    readonly commissionLifespanMonths: number;
    readonly validFrom: string;
    readonly validTo: string | null;
  },
): Promise<void> {
  Engagement.create({
    id: EngagementId.of(input.id),
    upstream: PartyId.of(input.upstreamPartyId),
    downstream: PartyId.of(input.downstreamPartyId),
    commissionRate: Percentage.of(input.commissionRate),
    commissionLifespan: LifespanMonths.of(input.commissionLifespanMonths),
    validity: DateRange.of(input.validFrom, input.validTo),
  });

  const update = await tx.engagement.updateMany({
    where: { id: input.id },
    data: {
      upstreamPartyId: input.upstreamPartyId,
      downstreamPartyId: input.downstreamPartyId,
      commissionRate: input.commissionRate,
      commissionLifespanMonths: input.commissionLifespanMonths,
      validFrom: asDate(input.validFrom),
      validTo: input.validTo === null ? null : asDate(input.validTo),
      terms: {},
    },
  });

  if (update.count === 0) {
    await tx.engagement.create({
      data: {
      id: input.id,
      tenantId,
      upstreamPartyId: input.upstreamPartyId,
      downstreamPartyId: input.downstreamPartyId,
      commissionRate: input.commissionRate,
      commissionLifespanMonths: input.commissionLifespanMonths,
      validFrom: asDate(input.validFrom),
      validTo: input.validTo === null ? null : asDate(input.validTo),
      terms: {},
    },
    });
  }
}

function asDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isPrismaKnownRequestError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

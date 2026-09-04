import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accessGateForPrincipal, consumeInvite, createInviteForPrincipal, createOrganizationAndInviteForUser, enrollClientForUser, listClientsForUser, listOrganizationsForUser, recordBaselineForUser, withTenant } from '../src/index.js';
import { ConsoleEmailAdapter, createAccessGate } from '@fitcrew/application';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '22222222-2222-4222-8222-222222222222';

loadPackageEnv();

const adminPrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

const appPrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.APP_DATABASE_URL,
    },
  },
});

describe('tenancy core RLS', () => {
  beforeAll(async () => {
    await seedTenant(adminPrisma, tenantId, 'FitCrew Demo', 'INR');
    await seedTenant(adminPrisma, otherTenantId, 'FitCrew Other', 'USD');
  });

  afterAll(async () => {
    await adminPrisma.$disconnect();
    await appPrisma.$disconnect();
  });

  it('allows the app role to read only the tenant selected by withTenant', async () => {
    const visibleConfigs = await withTenant(appPrisma, tenantId, async (tx) =>
      tx.tenantConfig.findMany({
        orderBy: { tenantId: 'asc' },
      }),
    );

    expect(visibleConfigs).toHaveLength(1);
    expect(visibleConfigs[0]?.tenantId).toBe(tenantId);
    expect(visibleConfigs[0]?.currency).toBe('INR');
  });

  it('blocks cross-tenant raw SQL under the app role even when Prisma scoping is bypassed', async () => {
    const rows = await withTenant(appPrisma, tenantId, async (tx) =>
      tx.$queryRaw<Array<{ tenant_id: string }>>`
        SELECT tenant_id
        FROM public.tenant_config
        WHERE tenant_id = ${otherTenantId}::uuid
      `,
    );

    expect(rows).toEqual([]);
  });

  it('rejects app-role writes for a different tenant through RLS', async () => {
    await expect(
      withTenant(appPrisma, tenantId, async (tx) =>
        tx.$executeRaw`
          INSERT INTO public.tenant_config (
            tenant_id,
            default_commission_rate,
            default_commission_lifespan_months,
            default_evaluation_cadence,
            fee_bearer,
            satisfaction_mode,
            currency
          )
          VALUES (
            ${otherTenantId}::uuid,
            12.00,
            4,
            'monthly'::public."EvaluationCadence",
            'tenant'::public."FeeBearer",
            'per_session'::public."SatisfactionMode",
            'EUR'
          )
          ON CONFLICT (tenant_id) DO UPDATE SET currency = EXCLUDED.currency
        `,
      ),
    ).rejects.toThrow();
  });

  it('applies tenant isolation to parties', async () => {
    const partyId = randomUUID();
    const otherPartyId = randomUUID();

    await withTenant(appPrisma, tenantId, async (tx) =>
      tx.party.create({
        data: {
          id: partyId,
          tenantId,
          kind: 'person',
          displayName: 'Visible Coach',
          status: 'active',
        },
      }),
    );

    await withTenant(appPrisma, otherTenantId, async (tx) =>
      tx.party.create({
        data: {
          id: otherPartyId,
          tenantId: otherTenantId,
          kind: 'person',
          displayName: 'Hidden Coach',
          status: 'active',
        },
      }),
    );

    const visibleParties = await withTenant(appPrisma, tenantId, async (tx) =>
      tx.party.findMany({
        where: {
          id: {
            in: [partyId, otherPartyId],
          },
        },
        orderBy: { id: 'asc' },
      }),
    );

    expect(visibleParties.map((party) => party.id)).toEqual([partyId]);
  });

  it('rejects engagement self-loops and overlapping duplicate edges', async () => {
    const ownerPartyId = randomUUID();
    const coachPartyId = randomUUID();

    await withTenant(appPrisma, tenantId, async (tx) =>
      tx.party.createMany({
        data: [
          {
            id: ownerPartyId,
            tenantId,
            kind: 'person',
            displayName: 'Owner',
            status: 'active',
          },
          {
            id: coachPartyId,
            tenantId,
            kind: 'person',
            displayName: 'Coach',
            status: 'active',
          },
        ],
      }),
    );

    await expect(
      withTenant(appPrisma, tenantId, async (tx) =>
        tx.engagement.create({
          data: {
            id: randomUUID(),
            tenantId,
            upstreamPartyId: ownerPartyId,
            downstreamPartyId: ownerPartyId,
            commissionRate: 10,
            commissionLifespanMonths: 3,
            validFrom: new Date('2026-09-01T00:00:00.000Z'),
          },
        }),
      ),
    ).rejects.toThrow();

    await withTenant(appPrisma, tenantId, async (tx) =>
      tx.engagement.create({
        data: {
          id: randomUUID(),
          tenantId,
          upstreamPartyId: ownerPartyId,
          downstreamPartyId: coachPartyId,
          commissionRate: 12.5,
          commissionLifespanMonths: 3,
          validFrom: new Date('2026-09-01T00:00:00.000Z'),
          validTo: null,
        },
      }),
    );

    await expect(
      withTenant(appPrisma, tenantId, async (tx) =>
        tx.engagement.create({
          data: {
            id: randomUUID(),
            tenantId,
            upstreamPartyId: ownerPartyId,
            downstreamPartyId: coachPartyId,
            commissionRate: 18,
            commissionLifespanMonths: 8,
            validFrom: new Date('2026-10-01T00:00:00.000Z'),
            validTo: null,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('writes an audit row when a coach is denied another coach resource', async () => {
    const actorPartyId = randomUUID();
    const otherCoachPartyId = randomUUID();

    await withTenant(appPrisma, tenantId, async (tx) => {
      await tx.party.createMany({
        data: [
          { id: actorPartyId, tenantId, kind: 'person', displayName: 'Actor Coach', status: 'active' },
          { id: otherCoachPartyId, tenantId, kind: 'person', displayName: 'Other Coach', status: 'active' },
        ],
      });

      const principal = {
        tenantId,
        partyId: actorPartyId,
        assignments: [{
          role: 'Coach' as const,
          scopeType: 'tenant' as const,
          scopeId: null,
          validFrom: '2026-01-01',
          validTo: null,
        }],
      };
      const gate = accessGateForPrincipal(tx, principal);

      await expect(gate.can(principal, 'read', {
        type: 'session',
        id: randomUUID(),
        coachPartyId: otherCoachPartyId,
        tenantId,
      })).resolves.toBe(false);
    });

    const auditRows = await withTenant(appPrisma, tenantId, (tx) => tx.auditLog.findMany({
      where: { actorPartyId },
    }));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'read',
      resourceType: 'session',
      actorPartyId,
      after: { allowed: false, reason: 'denied' },
    });
  });

  it('consumes an invite once and creates the account and role assignment', async () => {
    const ownerPartyId = randomUUID();
    const emailAdapter = new ConsoleEmailAdapter();
    const principal = {
      tenantId,
      partyId: ownerPartyId,
      assignments: [{
        role: 'OwnerAdmin' as const,
        scopeType: 'tenant' as const,
        scopeId: null,
        validFrom: '2026-01-01',
        validTo: null,
      }],
    };

    const invite = await withTenant(appPrisma, tenantId, async (tx) => {
      await tx.party.create({
        data: { id: ownerPartyId, tenantId, kind: 'person', displayName: 'Invite Owner', status: 'active' },
      });
      return createInviteForPrincipal(
        tx,
        principal,
        createAccessGate(new Date('2026-09-05T00:00:00.000Z')),
        {
          email: `coach-${randomUUID()}@fitcrew.test`,
          role: 'Coach',
          scopeType: 'tenant',
          scopeId: null,
          baseUrl: 'https://fitcrew.test',
        },
        emailAdapter,
        new Date('2026-09-05T00:00:00.000Z'),
      );
    });

    const rawToken = new URL(emailAdapter.sent[0].inviteUrl).searchParams.get('token');
    expect(rawToken).toBeTruthy();

    const consumed = await consumeInvite(appPrisma, {
      tenantId,
      token: rawToken!,
      password: 'CoachPassword!2026',
      displayName: 'Invited Coach',
    }, new Date('2026-09-05T01:00:00.000Z'));
    expect(consumed.role).toBe('Coach');

    await expect(consumeInvite(appPrisma, {
      tenantId,
      token: rawToken!,
      password: 'CoachPassword!2026',
      displayName: 'Invited Coach Again',
    }, new Date('2026-09-05T01:01:00.000Z'))).rejects.toThrow('invalid or expired');

    const roleCount = await withTenant(appPrisma, tenantId, (tx) => tx.roleAssignment.count({
      where: { role: 'Coach', partyId: consumed.partyId },
    }));
    expect(roleCount).toBe(1);
    expect(invite.role).toBe('Coach');
  });

  it('requires organization scope for OrgAdmin invites', async () => {
    const ownerPartyId = randomUUID();
    const emailAdapter = new ConsoleEmailAdapter();
    const principal = {
      tenantId,
      partyId: ownerPartyId,
      assignments: [{
        role: 'OwnerAdmin' as const,
        scopeType: 'tenant' as const,
        scopeId: null,
        validFrom: '2026-01-01',
        validTo: null,
      }],
    };

    await expect(withTenant(appPrisma, tenantId, async (tx) => {
      await tx.party.create({
        data: { id: ownerPartyId, tenantId, kind: 'person', displayName: 'Org Owner', status: 'active' },
      });
      return createInviteForPrincipal(
        tx,
        principal,
        createAccessGate(),
        {
          email: `org-${randomUUID()}@fitcrew.test`,
          role: 'OrgAdmin',
          scopeType: 'tenant',
          scopeId: null,
          baseUrl: 'https://fitcrew.test',
        },
        emailAdapter,
      );
    })).rejects.toThrow('organization scope');
  });

  it('creates an institution and gives its invited admin an organization-scoped home', async () => {
    const ownerPartyId = randomUUID();
    const ownerUserId = randomUUID();
    const email = `hospital-${randomUUID()}@fitcrew.test`;
    const emailAdapter = new ConsoleEmailAdapter();
    await withTenant(appPrisma, tenantId, async (tx) => {
      await tx.user.create({ data: { id: ownerUserId, email: email.replace('hospital-', 'owner-'), name: 'Hospital Owner' } });
      await tx.party.create({ data: { id: ownerPartyId, tenantId, userId: ownerUserId, kind: 'person', displayName: 'Hospital Owner', status: 'active' } });
    });
    await withTenant(appPrisma, tenantId, (tx) => tx.roleAssignment.create({
      data: { tenantId, partyId: ownerPartyId, role: 'OwnerAdmin', scopeType: 'tenant', validFrom: new Date('2026-01-01') },
    }));
    const result = await createOrganizationAndInviteForUser(appPrisma, tenantId, ownerUserId, {
      name: 'General Hospital', email, agreementAmount: '25000', agreementStart: '2026-09-01', agreementEnd: null, baseUrl: 'https://fitcrew.test',
    }, emailAdapter);
    const token = new URL(emailAdapter.sent[0].inviteUrl).searchParams.get('token');
    const admin = await consumeInvite(appPrisma, { tenantId, token: token!, password: 'HospitalPassword!2026', displayName: 'Hospital Admin' });
    const visible = await listOrganizationsForUser(appPrisma, tenantId, admin.userId);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.organizationId).toBe(result.organizationId);
  });

  it('enrolls a client, creates a subscription, and advances after baseline intake', async () => {
    const ownerUserId = randomUUID(); const ownerPartyId = randomUUID(); const coachPartyId = randomUUID();
    await withTenant(appPrisma, tenantId, async (tx) => {
      await tx.user.create({ data: { id: ownerUserId, email: `${randomUUID()}@fitcrew.test`, name: 'Lifecycle Owner' } });
      await tx.party.createMany({ data: [
        { id: ownerPartyId, tenantId, userId: ownerUserId, kind: 'person', displayName: 'Lifecycle Owner', status: 'active' },
        { id: coachPartyId, tenantId, kind: 'person', displayName: 'Lifecycle Coach', status: 'active' },
      ] });
      await tx.roleAssignment.createMany({ data: [
        { tenantId, partyId: ownerPartyId, role: 'OwnerAdmin', scopeType: 'tenant', validFrom: new Date('2026-01-01') },
        { tenantId, partyId: coachPartyId, role: 'Coach', scopeType: 'tenant', validFrom: new Date('2026-01-01') },
      ] });
    });
    const enrolled = await enrollClientForUser(appPrisma, tenantId, ownerUserId, { name: 'Baseline Client', price: '3500', coachPartyId, organizationId: null, schedule: { days: ['monday'] }, photoConsent: false, subscriptionDurationMonths: 3 });
    expect((await listClientsForUser(appPrisma, tenantId, ownerUserId)).some((client) => client.clientId === enrolled.clientId)).toBe(true);
    const baseline = await recordBaselineForUser(appPrisma, tenantId, ownerUserId, { clientId: enrolled.clientId, measurements: { weight: 80, bmi: 25 }, postureNotes: 'Initial assessment' });
    expect(baseline.clientId).toBe(enrolled.clientId);
    await withTenant(appPrisma, tenantId, async (tx) => {
      await expect(tx.evaluation.findFirst({ where: { id: baseline.evaluationId } })).resolves.toMatchObject({ type: 'baseline' });
      await expect(tx.subscription.count({ where: { clientId: enrolled.clientId } })).resolves.toBe(1);
    });
  });
});

async function seedTenant(prisma: PrismaClient, id: string, name: string, currency: string): Promise<void> {
  await prisma.tenant.upsert({
    where: { id },
    update: { name, status: 'trial' },
    create: { id, name, status: 'trial' },
  });

  await prisma.tenantConfig.upsert({
    where: { tenantId: id },
    update: {
      currency,
      defaultCommissionRate: 10,
      defaultCommissionLifespanMonths: 3,
      defaultEvaluationCadence: 'monthly',
      feeBearer: 'tenant',
      satisfactionMode: 'per_session',
    },
    create: {
      tenantId: id,
      currency,
      defaultCommissionRate: 10,
      defaultCommissionLifespanMonths: 3,
      defaultEvaluationCadence: 'monthly',
      feeBearer: 'tenant',
      satisfactionMode: 'per_session',
    },
  });
}

function loadPackageEnv(): void {
  const envPath = resolve(process.cwd(), '.env');

  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match === null || process.env[match[1]] !== undefined) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }
}

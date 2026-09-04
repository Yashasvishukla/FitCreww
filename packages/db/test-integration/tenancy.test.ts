import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/index.js';

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

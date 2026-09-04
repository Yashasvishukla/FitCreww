import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const prisma = new PrismaClient();

const tenants = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'FitCrew Demo',
    currency: 'INR',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'FitCrew Second Tenant',
    currency: 'USD',
  },
];

for (const tenant of tenants) {
  await prisma.tenant.upsert({
    where: { id: tenant.id },
    update: {
      name: tenant.name,
      status: 'trial',
    },
    create: {
      id: tenant.id,
      name: tenant.name,
      status: 'trial',
    },
  });

  await prisma.tenantConfig.upsert({
    where: { tenantId: tenant.id },
    update: {
      currency: tenant.currency,
      defaultCommissionRate: 10,
      defaultCommissionLifespanMonths: 3,
      defaultEvaluationCadence: 'monthly',
      feeBearer: 'tenant',
      satisfactionMode: 'per_session',
    },
    create: {
      tenantId: tenant.id,
      currency: tenant.currency,
      defaultCommissionRate: 10,
      defaultCommissionLifespanMonths: 3,
      defaultEvaluationCadence: 'monthly',
      feeBearer: 'tenant',
      satisfactionMode: 'per_session',
    },
  });
}

const demoPasswordHash = await hash('FitCrew!Demo2026', {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

await prisma.user.upsert({
  where: { email: 'owner@fitcrew.test' },
  update: {
    name: 'FitCrew Demo Owner',
    passwordHash: demoPasswordHash,
    failedSignInAttempts: 0,
    lockedUntil: null,
  },
  create: {
    email: 'owner@fitcrew.test',
    name: 'FitCrew Demo Owner',
    passwordHash: demoPasswordHash,
  },
});

await prisma.$disconnect();

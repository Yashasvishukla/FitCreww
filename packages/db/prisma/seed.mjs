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

const ownerUser = await prisma.user.upsert({
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

await prisma.party.updateMany({
  where: {
    id: '11111111-1111-4111-8111-000000000001',
    tenantId: '11111111-1111-4111-8111-111111111111',
  },
  data: { userId: ownerUser.id },
});

const globalExercises = [
  ['Squat', 'Legs'],
  ['Push-up', 'Chest'],
  ['Deadlift', 'Posterior chain'],
  ['Plank', 'Core'],
  ['Lat pulldown', 'Back'],
  ['Dumbbell row', 'Back'],
  ['Lunge', 'Legs'],
  ['Shoulder press', 'Shoulders'],
];

for (const [name, muscleGroup] of globalExercises) {
  const existing = await prisma.exerciseCatalog.findFirst({ where: { tenantId: null, name } });
  if (existing) {
    await prisma.exerciseCatalog.update({ where: { id: existing.id }, data: { muscleGroup } });
  } else {
    await prisma.exerciseCatalog.create({ data: { tenantId: null, name, muscleGroup, metadata: {} } });
  }
}

await prisma.$disconnect();

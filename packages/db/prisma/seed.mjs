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

const coachUser = await prisma.user.upsert({
  where: { email: 'priya.coach@fitcrew.test' },
  update: { name: 'Priya Coach', passwordHash: demoPasswordHash, failedSignInAttempts: 0, lockedUntil: null },
  create: { email: 'priya.coach@fitcrew.test', name: 'Priya Coach', passwordHash: demoPasswordHash },
});
const coachParty = await prisma.party.upsert({
  where: { id: '11111111-1111-4111-8111-000000000012' },
  update: { userId: coachUser.id, displayName: 'Priya Coach', status: 'active' },
  create: { id: '11111111-1111-4111-8111-000000000012', tenantId: tenants[0].id, userId: coachUser.id, kind: 'person', displayName: 'Priya Coach', status: 'active' },
});
await prisma.roleAssignment.upsert({
  where: { id: '11111111-1111-4111-8111-000000000013' },
  update: { tenantId: tenants[0].id, partyId: coachParty.id, role: 'Coach', scopeType: 'tenant', scopeId: null },
  create: { id: '11111111-1111-4111-8111-000000000013', tenantId: tenants[0].id, partyId: coachParty.id, role: 'Coach', scopeType: 'tenant', validFrom: new Date('2026-01-01T00:00:00.000Z') },
});

// Demo client credentials for exercising the client portal end-to-end.
const demoClientUser = await prisma.user.upsert({
  where: { email: 'client@fitcrew.test' },
  update: { name: 'FitCrew Demo Client', passwordHash: demoPasswordHash, failedSignInAttempts: 0, lockedUntil: null },
  create: { email: 'client@fitcrew.test', name: 'FitCrew Demo Client', passwordHash: demoPasswordHash },
});
const demoClientParty = await prisma.party.upsert({
  where: { id: '11111111-1111-4111-8111-000000000021' },
  update: { userId: demoClientUser.id, displayName: 'FitCrew Demo Client', status: 'active' },
  create: { id: '11111111-1111-4111-8111-000000000021', tenantId: tenants[0].id, userId: demoClientUser.id, kind: 'person', displayName: 'FitCrew Demo Client', status: 'active' },
});
const demoClient = await prisma.client.upsert({
  where: { tenantId_partyId: { tenantId: tenants[0].id, partyId: demoClientParty.id } },
  update: { status: 'active', workflowState: 'active' },
  create: { tenantId: tenants[0].id, partyId: demoClientParty.id, enrolledByPartyId: '11111111-1111-4111-8111-000000000001', customPrice: 0, schedule: { days: 'Mon, Wed, Fri' }, photoConsent: false, workflowState: 'active' },
});
await prisma.roleAssignment.upsert({
  where: { id: '11111111-1111-4111-8111-000000000022' },
  update: { tenantId: tenants[0].id, partyId: demoClientParty.id, role: 'Client', scopeType: 'self', scopeId: null },
  create: { id: '11111111-1111-4111-8111-000000000022', tenantId: tenants[0].id, partyId: demoClientParty.id, role: 'Client', scopeType: 'self', validFrom: new Date() },
});

const demoCoachPartyId = coachParty.id;
const demoAssignment = await prisma.clientCoachAssignment.upsert({
  where: { id: '11111111-1111-4111-8111-000000000023' },
  update: { tenantId: tenants[0].id, clientId: demoClient.id, coachPartyId: demoCoachPartyId, assignedByPartyId: demoCoachPartyId, validFrom: new Date('2026-01-01T00:00:00.000Z'), validTo: null },
  create: { id: '11111111-1111-4111-8111-000000000023', tenantId: tenants[0].id, clientId: demoClient.id, coachPartyId: demoCoachPartyId, assignedByPartyId: demoCoachPartyId, validFrom: new Date('2026-01-01T00:00:00.000Z') },
});
await prisma.client.update({ where: { id: demoClient.id }, data: { currentCoachAssignmentId: demoAssignment.id } });

const demoPlan = await prisma.workoutPlan.upsert({
  where: { id: '11111111-1111-4111-8111-000000000024' },
  update: { tenantId: tenants[0].id, clientId: demoClient.id, version: 1, isCurrent: true, createdByPartyId: demoCoachPartyId },
  create: { id: '11111111-1111-4111-8111-000000000024', tenantId: tenants[0].id, clientId: demoClient.id, version: 1, isCurrent: true, createdByPartyId: demoCoachPartyId },
});
for (const day of [
  { dayNumber: 1, exercises: [{ name: 'Squat', sets: '3', reps: '10' }, { name: 'Lunge', sets: '3', reps: '12' }] },
  { dayNumber: 2, exercises: [{ name: 'Push-up', sets: '3', reps: '10' }, { name: 'Plank', sets: '3', reps: '45 sec' }] },
  { dayNumber: 3, exercises: [{ name: 'Deadlift', sets: '3', reps: '8' }, { name: 'Dumbbell row', sets: '3', reps: '10' }] },
]) {
  await prisma.planDay.upsert({ where: { tenantId_planId_dayNumber: { tenantId: tenants[0].id, planId: demoPlan.id, dayNumber: day.dayNumber } }, update: { exercises: day.exercises }, create: { tenantId: tenants[0].id, planId: demoPlan.id, dayNumber: day.dayNumber, exercises: day.exercises } });
}

await prisma.evaluation.upsert({
  where: { id: '11111111-1111-4111-8111-000000000025' },
  update: { tenantId: tenants[0].id, clientId: demoClient.id, coachAssignmentId: demoAssignment.id, evaluatedByPartyId: demoCoachPartyId, evaluatedAt: new Date('2026-08-01T09:00:00.000Z'), type: 'baseline', measurements: { weightKg: 82, waistCm: 94 }, postureNotes: 'Baseline intake', deltas: {}, cadenceContext: { stage: 'baseline-intake' } },
  create: { id: '11111111-1111-4111-8111-000000000025', tenantId: tenants[0].id, clientId: demoClient.id, coachAssignmentId: demoAssignment.id, evaluatedByPartyId: demoCoachPartyId, evaluatedAt: new Date('2026-08-01T09:00:00.000Z'), type: 'baseline', measurements: { weightKg: 82, waistCm: 94 }, postureNotes: 'Baseline intake', deltas: {}, cadenceContext: { stage: 'baseline-intake' } },
});
await prisma.evaluation.upsert({
  where: { id: '11111111-1111-4111-8111-000000000026' },
  update: { tenantId: tenants[0].id, clientId: demoClient.id, coachAssignmentId: demoAssignment.id, evaluatedByPartyId: demoCoachPartyId, evaluatedAt: new Date('2026-09-01T09:00:00.000Z'), type: 'periodic', measurements: { weightKg: 79.5, waistCm: 90 }, postureNotes: 'Week 4 check-in', deltas: { weightKg: -2.5, waistCm: -4 }, cadenceContext: { comparedToEvaluationId: '11111111-1111-4111-8111-000000000025' } },
  create: { id: '11111111-1111-4111-8111-000000000026', tenantId: tenants[0].id, clientId: demoClient.id, coachAssignmentId: demoAssignment.id, evaluatedByPartyId: demoCoachPartyId, evaluatedAt: new Date('2026-09-01T09:00:00.000Z'), type: 'periodic', measurements: { weightKg: 79.5, waistCm: 90 }, postureNotes: 'Week 4 check-in', deltas: { weightKg: -2.5, waistCm: -4 }, cadenceContext: { comparedToEvaluationId: '11111111-1111-4111-8111-000000000025' } },
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

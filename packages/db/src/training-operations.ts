import { Prisma, PrismaClient } from '@prisma/client';
import { accessGateForPrincipal, resolvePrincipal } from './access-gate.js';
import { withTenant } from './with-tenant.js';

type Tx = Prisma.TransactionClient;
type Cadence = 'weekly' | 'biweekly' | 'monthly';

export type ExerciseCatalogEntry = {
  id: string;
  name: string;
  muscleGroup: string | null;
  tenantId: string | null;
};

export type TrainingDashboard = {
  clients: readonly { clientId: string; name: string; coachPartyId: string | null; organizationId: string | null }[];
  exercises: readonly ExerciseCatalogEntry[];
  currentPlan: null | { id: string; version: number; days: readonly PlanDayInput[] };
  planHistory: readonly { id: string; version: number; createdAt: string }[];
  sessions: readonly { id: string; clientName: string; sessionDate: string; startTime: string; endTime: string | null; exerciseCount: number; notes: string | null }[];
  dueEvaluations: readonly { id: string; clientId: string; clientName: string; nextDueDate: string; cadence: Cadence }[];
};

export type PlanDayInput = {
  dayNumber: number;
  exercises: readonly { name: string; sets?: string; reps?: string }[];
  notes?: string;
};

export type WorkoutPlanInput = {
  clientId: string;
  days: readonly PlanDayInput[];
};

export type TrainingSessionInput = {
  clientId: string;
  sessionDate: string;
  startTime: string;
  endTime?: string | null;
  exercises: readonly { name: string; sets?: string; reps?: string }[];
  notes?: string;
};

export type EvaluationScheduleInput = {
  clientId: string;
  cadence: Cadence;
  nextDueDate: string;
};

export type DueComputationResult = {
  createdEvents: number;
  advancedSchedules: number;
};

export type ReminderResult = {
  reminderId: string;
  tenantId: string;
  clientName: string;
  dueDate: string;
  recipient: string | null;
};

export class TrainingOperationsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrainingOperationsError';
  }
}

export async function listTrainingDashboardForUser(client: PrismaClient, tenantId: string, userId: string, selectedClientId?: string): Promise<TrainingDashboard> {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal) throw new TrainingOperationsError('Forbidden.');
    const gate = accessGateForPrincipal(tx, principal);
    const clientWhere = gate.scopeQuery(principal, 'Client') as Prisma.ClientWhereInput;
    const clients = await tx.client.findMany({ where: clientWhere, include: { party: true, currentCoachAssignment: true }, orderBy: { party: { displayName: 'asc' } } });
    const visibleClientIds = clients.map((entry) => entry.id);
    const activeClientId = selectedClientId && visibleClientIds.includes(selectedClientId) ? selectedClientId : visibleClientIds[0];
    const [exercises, currentPlan, planHistory, sessions, dueEvaluations] = await Promise.all([
      tx.exerciseCatalog.findMany({ where: { OR: [{ tenantId }, { tenantId: null }] }, orderBy: [{ muscleGroup: 'asc' }, { name: 'asc' }] }),
      activeClientId ? tx.workoutPlan.findFirst({ where: { clientId: activeClientId, isCurrent: true }, include: { days: { orderBy: { dayNumber: 'asc' } } } }) : null,
      activeClientId ? tx.workoutPlan.findMany({ where: { clientId: activeClientId }, select: { id: true, version: true, createdAt: true }, orderBy: { version: 'desc' } }) : [],
      tx.trainingSession.findMany({ where: { clientId: { in: visibleClientIds } }, include: { client: { include: { party: true } } }, orderBy: [{ sessionDate: 'desc' }, { createdAt: 'desc' }], take: 12 }),
      tx.evaluationDueEvent.findMany({ where: { clientId: { in: visibleClientIds }, status: { in: ['pending', 'reminded'] } }, include: { client: { include: { party: true } }, schedule: true }, orderBy: { nextDueDate: 'asc' }, take: 20 }),
    ]);
    return {
      clients: clients.map((row) => ({ clientId: row.id, name: row.party.displayName, coachPartyId: row.currentCoachAssignment?.coachPartyId ?? null, organizationId: row.organizationId })),
      exercises: exercises.map((row) => ({ id: row.id, name: row.name, muscleGroup: row.muscleGroup, tenantId: row.tenantId })),
      currentPlan: currentPlan ? { id: currentPlan.id, version: currentPlan.version, days: currentPlan.days.map((day) => ({ dayNumber: day.dayNumber, exercises: normalizeExerciseList(day.exercises), notes: day.notes ?? undefined })) } : null,
      planHistory: planHistory.map((plan) => ({ id: plan.id, version: plan.version, createdAt: plan.createdAt.toISOString() })),
      sessions: sessions.map((row) => ({ id: row.id, clientName: row.client.party.displayName, sessionDate: toPlainDate(row.sessionDate), startTime: row.startTime, endTime: row.endTime, exerciseCount: normalizeExerciseList(row.exercisesPerformed).length, notes: row.notes })),
      dueEvaluations: dueEvaluations.map((row) => ({ id: row.id, clientId: row.clientId, clientName: row.client.party.displayName, nextDueDate: toPlainDate(row.nextDueDate), cadence: row.schedule.cadence })),
    };
  });
}

export async function upsertExerciseForUser(client: PrismaClient, tenantId: string, userId: string, input: { name: string; muscleGroup?: string }) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const principal = await requirePrincipal(tx, tenantId, userId);
    if (!(await accessGateForPrincipal(tx, principal).can(principal, 'create', { type: 'plan', tenantId }))) throw new TrainingOperationsError('Forbidden.');
    const name = requiredText(input.name, 'Exercise name', 120);
    const muscleGroup = input.muscleGroup?.trim() || null;
    const row = await tx.exerciseCatalog.upsert({ where: { tenantId_name: { tenantId, name } }, update: { muscleGroup }, create: { tenantId, name, muscleGroup, metadata: {} } });
    return { exerciseId: row.id };
  });
}

export async function saveWorkoutPlanForUser(client: PrismaClient, tenantId: string, userId: string, input: WorkoutPlanInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const { principal, clientRecord } = await requireVisibleClient(tx, tenantId, userId, input.clientId, 'plan');
    const days = normalizePlanDays(input.days);
    if (days.length !== 7) throw new TrainingOperationsError('A 7-day plan is required.');
    const current = await tx.workoutPlan.findFirst({ where: { clientId: clientRecord.id, isCurrent: true }, orderBy: { version: 'desc' } });
    const version = (current?.version ?? 0) + 1;
    await tx.workoutPlan.updateMany({ where: { clientId: clientRecord.id, isCurrent: true }, data: { isCurrent: false } });
    const plan = await tx.workoutPlan.create({
      data: {
        tenantId,
        clientId: clientRecord.id,
        version,
        isCurrent: true,
        createdByPartyId: principal.partyId,
        days: { create: days.map((day) => ({ tenantId, dayNumber: day.dayNumber, exercises: day.exercises as Prisma.InputJsonValue, notes: day.notes ?? null })) },
      },
    });
    return { planId: plan.id, version };
  });
}

export async function logTrainingSessionForUser(client: PrismaClient, tenantId: string, userId: string, input: TrainingSessionInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const { clientRecord } = await requireVisibleClient(tx, tenantId, userId, input.clientId, 'session');
    if (!clientRecord.currentCoachAssignment) throw new TrainingOperationsError('Client has no active coach assignment.');
    const exercises = normalizeExercises(input.exercises);
    if (exercises.length === 0) throw new TrainingOperationsError('At least one exercise is required.');
    if (input.endTime && input.endTime < input.startTime) throw new TrainingOperationsError('End time cannot be before start time.');
    const session = await tx.trainingSession.create({
      data: {
        tenantId,
        clientId: clientRecord.id,
        coachAssignmentId: clientRecord.currentCoachAssignment.id,
        coachPartyId: clientRecord.currentCoachAssignment.coachPartyId,
        sessionDate: parsePlainDate(input.sessionDate, 'Session date'),
        startTime: parseClockTime(input.startTime, 'Start time'),
        endTime: input.endTime ? parseClockTime(input.endTime, 'End time') : null,
        exercisesPerformed: exercises as Prisma.InputJsonValue,
        notes: input.notes?.trim() || null,
      },
    });
    return { sessionId: session.id };
  });
}

export async function saveEvaluationScheduleForUser(client: PrismaClient, tenantId: string, userId: string, input: EvaluationScheduleInput) {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    await requireVisibleClient(tx, tenantId, userId, input.clientId, 'evaluation');
    const schedule = await tx.evaluationSchedule.upsert({
      where: { clientId: input.clientId },
      update: { cadence: input.cadence, nextDueDate: parsePlainDate(input.nextDueDate, 'Next due date'), isActive: true },
      create: { tenantId, clientId: input.clientId, cadence: input.cadence, nextDueDate: parsePlainDate(input.nextDueDate, 'Next due date'), isActive: true },
    });
    return { scheduleId: schedule.id };
  });
}

export async function computeEvaluationDueEvents(client: PrismaClient, tenantId: string, asOf = new Date()): Promise<DueComputationResult> {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const asOfDay = utcDateOnly(asOf);
    const schedules = await tx.evaluationSchedule.findMany({ where: { isActive: true, nextDueDate: { lte: asOfDay } } });
    let createdEvents = 0;
    for (const schedule of schedules) {
      const existing = await tx.evaluationDueEvent.findUnique({
        where: { tenantId_evaluationScheduleId_nextDueDate: { tenantId, evaluationScheduleId: schedule.id, nextDueDate: schedule.nextDueDate } },
        select: { id: true },
      });
      const result = await tx.evaluationDueEvent.upsert({
        where: { tenantId_evaluationScheduleId_nextDueDate: { tenantId, evaluationScheduleId: schedule.id, nextDueDate: schedule.nextDueDate } },
        update: {},
        create: { tenantId, evaluationScheduleId: schedule.id, clientId: schedule.clientId, nextDueDate: schedule.nextDueDate, status: 'pending' },
      });
      if (!existing && result.id) createdEvents += 1;
      await tx.evaluationSchedule.update({ where: { id: schedule.id }, data: { nextDueDate: advanceDueDate(schedule.nextDueDate, schedule.cadence) } });
    }
    return { createdEvents, advancedSchedules: schedules.length };
  });
}

export async function markPendingEvaluationRemindersSent(client: PrismaClient, tenantId: string, asOf = new Date()): Promise<readonly ReminderResult[]> {
  return withTenant(client as never, tenantId, async (tx: Tx) => {
    const dueRows = await tx.evaluationDueEvent.findMany({ where: { status: 'pending', nextDueDate: { lte: utcDateOnly(asOf) } }, include: { client: { include: { party: { include: { user: { select: { email: true } } } } } } }, orderBy: { nextDueDate: 'asc' }, take: 50 });
    return dueRows.map((row) => ({ reminderId: row.id, tenantId, clientName: row.client.party.displayName, dueDate: toPlainDate(row.nextDueDate), recipient: row.client.party.user?.email ?? null }));
  });
}

export async function acknowledgeEvaluationReminder(client: PrismaClient, tenantId: string, reminderId: string, sentAt = new Date()): Promise<void> {
  await withTenant(client as never, tenantId, async (tx: Tx) => { await tx.evaluationDueEvent.updateMany({ where: { id: reminderId, tenantId, status: 'pending' }, data: { status: 'reminded', reminderSentAt: sentAt } }); });
}

async function requirePrincipal(tx: Tx, tenantId: string, userId: string) {
  const principal = await resolvePrincipal(tx, tenantId, userId);
  if (!principal) throw new TrainingOperationsError('Forbidden.');
  return principal;
}

async function requireVisibleClient(tx: Tx, tenantId: string, userId: string, clientId: string, resourceType: 'session' | 'plan' | 'evaluation') {
  const principal = await requirePrincipal(tx, tenantId, userId);
  const clientRecord = await tx.client.findFirst({ where: { id: clientId }, include: { currentCoachAssignment: true } });
  if (!clientRecord || !clientRecord.currentCoachAssignment) throw new TrainingOperationsError('Forbidden.');
  const allowed = await accessGateForPrincipal(tx, principal).can(principal, 'update', { type: resourceType, tenantId, clientId: clientRecord.id, coachPartyId: clientRecord.currentCoachAssignment.coachPartyId, organizationId: clientRecord.organizationId ?? undefined });
  if (!allowed) throw new TrainingOperationsError('Forbidden.');
  return { principal, clientRecord };
}

function normalizePlanDays(days: readonly PlanDayInput[]): readonly PlanDayInput[] {
  return days.map((day) => ({ dayNumber: day.dayNumber, exercises: normalizeExercises(day.exercises), notes: day.notes?.trim() || undefined })).sort((a, b) => a.dayNumber - b.dayNumber);
}

function normalizeExercises(exercises: readonly { name: string; sets?: string; reps?: string }[]) {
  return exercises.map((exercise) => ({ name: requiredText(exercise.name, 'Exercise', 120), sets: exercise.sets?.trim() || undefined, reps: exercise.reps?.trim() || undefined }));
}

function normalizeExerciseList(value: Prisma.JsonValue): readonly { name: string; sets?: string; reps?: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const name = 'name' in item && typeof item.name === 'string' ? item.name : '';
    if (!name) return [];
    return [{ name, sets: 'sets' in item && typeof item.sets === 'string' ? item.sets : undefined, reps: 'reps' in item && typeof item.reps === 'string' ? item.reps : undefined }];
  });
}

function requiredText(value: string, label: string, maxLength: number): string {
  const text = value.trim();
  if (!text || text.length > maxLength) throw new TrainingOperationsError(`${label} is required.`);
  return text;
}

function parsePlainDate(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TrainingOperationsError(`${label} must be YYYY-MM-DD.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new TrainingOperationsError(`${label} must be a real calendar date.`);
  return parsed;
}

function parseClockTime(value: string, label: string): string {
  if (!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) throw new TrainingOperationsError(`${label} must be HH:mm.`);
  return value;
}

function utcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toPlainDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function advanceDueDate(date: Date, cadence: Cadence): Date {
  const next = new Date(date);
  if (cadence === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
  if (cadence === 'biweekly') next.setUTCDate(next.getUTCDate() + 14);
  if (cadence === 'monthly') {
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
  }
  return next;
}

export function cleanTrainingOperationsError(error: unknown): string {
  return error instanceof TrainingOperationsError ? error.message : 'Training operation failed.';
}

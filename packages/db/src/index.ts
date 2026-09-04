// Public barrel for @fitcrew/db.

export const DB_PACKAGE_NAME = '@fitcrew/db';

export { authPrisma } from './auth-prisma.js';
export { accessGateForPrincipal, canUserAccess, resolvePrincipal } from './access-gate.js';
export {
  cleanInviteError,
  consumeInvite,
  createInviteForPrincipal,
  createInviteForUser,
  hashInviteToken,
  InviteError,
} from './invites.js';
export type { ConsumedInviteResult, ConsumeInviteInput, CreateInviteInput, InviteResult } from './invites.js';
export { authenticateUser, normalizeEmail } from './credentials.js';
export { cleanDemoReferenceNetworkError, seedDemoReferenceNetwork } from './demo-reference-network.js';
export type { DemoReferenceNetworkInput, DemoReferenceNetworkResult } from './demo-reference-network.js';
export {
  cleanNetworkManagementError,
  createOrganizationAndInviteForUser,
  listCoachRosterForUser,
  listOrganizationsForUser,
  updateCoachTermsForUser,
  NetworkManagementError,
} from './network-management.js';
export type { CoachRosterEntry, CoachTermsInput, OrganizationInput } from './network-management.js';
export { cleanClientLifecycleError, enrollClientForUser, recordBaselineForUser, ClientLifecycleError } from './client-lifecycle.js';
export type { BaselineInput, ClientListEntry, EnrollmentInput } from './client-lifecycle.js';
export { listClientsForUser } from './client-lifecycle.js';
export {
  cleanTrainingOperationsError,
  computeEvaluationDueEvents,
  listTrainingDashboardForUser,
  logTrainingSessionForUser,
  markPendingEvaluationRemindersSent,
  saveEvaluationScheduleForUser,
  saveWorkoutPlanForUser,
  TrainingOperationsError,
  upsertExerciseForUser,
} from './training-operations.js';
export type { DueComputationResult, EvaluationScheduleInput, ExerciseCatalogEntry, PlanDayInput, ReminderResult, TrainingDashboard, TrainingSessionInput, WorkoutPlanInput } from './training-operations.js';
export type { AuthenticatedUser } from './credentials.js';
export { hashPassword, verifyPassword } from './password.js';
export { prisma } from './prisma.js';
export { TENANT_SCOPED_MODELS, applyTenantScope, assertTenantId, tenantScoping } from './tenant-scoping.js';
export type { TenantScopingOptions } from './tenant-scoping.js';
export { withTenant } from './with-tenant.js';
export type { TenantScopedTransactionClient, TransactionCapableClient, TransactionClient, WithTenantOptions } from './with-tenant.js';

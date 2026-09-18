// Public barrel for @fitcrew/db.

export const DB_PACKAGE_NAME = '@fitcrew/db';

export { authPrisma } from './auth-prisma.js';
export { accessGateForPrincipal, canUserAccess, getPrincipalForUser, resolvePrincipal } from './access-gate.js';
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
  listAssignableCoachesForUser,
  assignCoachToOrganizationForUser,
  listOrganizationsForUser,
  updateCoachTermsForUser,
  NetworkManagementError,
} from './network-management.js';
export type { CoachRosterEntry, CoachTermsInput, OrganizationInput, OrganizationCoachInput } from './network-management.js';
export { cleanClientLifecycleError, enrollClientForUser, estimateFoodNutrition, estimateFoodNutritionFromBestSource, estimateFoodNutritionFromUsda, reassignClientCoachForUser, recordBaselineForUser, recordEvaluationForUser, listEvaluationsForUser, listNutritionForUser, listNutritionCalendarForUser, listNutritionHistoryForUser, listClientPageForUser, getClientForUser, recordNutritionForUser, recordSatisfactionForUser, getSatisfactionMetricsForUser, ClientLifecycleError } from './client-lifecycle.js';
export type { BaselineInput, EvaluationInput, NutritionDaySummary, NutritionCalendarDay, NutritionEstimate, NutritionEstimateSource, NutritionInput, NutritionLogEntry, SatisfactionInput, ClientListEntry, ClientPage, EnrollmentInput, ReassignCoachInput } from './client-lifecycle.js';
export { listClientsForUser } from './client-lifecycle.js';
export {
  cleanTrainingOperationsError,
  computeEvaluationDueEvents,
  acknowledgeEvaluationReminder,
  listTrainingDashboardForUser,
  logTrainingSessionForUser,
  getWorkoutDraftForUser,
  saveWorkoutDraftForUser,
  saveTrainingRestDefaultForUser,
  clearWorkoutDraftForUser,
  markPendingEvaluationRemindersSent,
  saveEvaluationScheduleForUser,
  saveWorkoutPlanForUser,
  TrainingOperationsError,
  upsertExerciseForUser,
} from './training-operations.js';
export type { DueComputationResult, EvaluationScheduleInput, ExerciseCatalogEntry, PlanDayInput, ReminderResult, TrainingDashboard, TrainingSessionInput, WorkoutDraftInput, WorkoutPlanInput } from './training-operations.js';
export type { AuthenticatedUser } from './credentials.js';
export { hashPassword, verifyPassword } from './password.js';
export { changePasswordForUser, cleanProfileError, getProfileForUser, updateProfileForUser, ProfileError } from './profile.js';
export { cleanOwnerDashboardError, getOwnerDashboard, OwnerDashboardError } from './owner-dashboard.js';
export { cleanOrgDashboardError, getOrgDashboardForUser, OrgDashboardError } from './org-dashboard.js';
export { cleanPlatformProvisioningError, listPlatformTenants, PlatformProvisioningError, provisionTenant } from './platform.js';
export type { ProvisionTenantInput, ProvisionTenantResult } from './platform.js';
export { prisma } from './prisma.js';
export { listActiveWorkspacesForUser } from './workspace-membership.js';
export type { ActiveWorkspace } from './workspace-membership.js';
export { TENANT_SCOPED_MODELS, applyTenantScope, assertTenantId, tenantScoping } from './tenant-scoping.js';
export type { TenantScopingOptions } from './tenant-scoping.js';
export { withTenant } from './with-tenant.js';
export { PrismaLedgerRepository } from './ledger.js';
export { cleanPaymentRecordingError, confirmPaymentForUser, confirmRazorpayPaymentForUser, confirmRazorpayWebhookPayment, createRazorpayOrderForUser, deletePayoutHandleForUser, getMoneyWorkspaceForUser, PaymentRecordingError, recordClientPaymentForUser, recordOrganizationPaymentForUser, reverseClientPaymentForUser, savePayoutHandleForUser, updatePayoutHandleForUser, updateRefundClawbackRateForUser } from './payment-recording.js';
export type { ConfirmPaymentInput, ConfirmRazorpayPaymentInput, ConfirmRazorpayWebhookInput, CreateRazorpayOrderInput, PayoutHandleInput, RecordClientPaymentInput, RecordOrganizationPaymentInput, ReversePaymentInput, UpdatePayoutHandleInput } from './payment-recording.js';
export { cleanSettlementError, confirmSettlementForUser, createSettlementForUser, downloadPayslipForUser, getEarningsForUser, mintPayslipReadUrl, SettlementError } from './settlements.js';
export type { ConfirmSettlementInput, CreateSettlementInput } from './settlements.js';
export type { TenantScopedTransactionClient, TransactionCapableClient, TransactionClient, WithTenantOptions } from './with-tenant.js';

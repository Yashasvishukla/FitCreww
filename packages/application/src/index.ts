// @fitcrew/application root barrel. Prefer importing a specific module's
// subpath export (e.g. '@fitcrew/application/money') over this file, so
// module boundaries stay visible at the import site.

export { IDENTITY_ACCESS_MODULE } from './identity-access/index.js';
export {
  canAccess,
  createAccessGate,
  effectiveAssignments,
  scopeQuery,
} from './identity-access/index.js';
export { ConsoleEmailAdapter } from './notifications/index.js';
export type { EmailAdapter, EvaluationReminderEmail, InviteEmail } from './notifications/index.js';
export type {
  AccessAction,
  AccessAudit,
  AccessAuditWriter,
  AccessGate,
  AccessResourceType,
  Principal,
  PrincipalAssignment,
  ResourceRef,
} from './identity-access/index.js';
export { NETWORK_MODULE } from './network/index.js';
export { CLIENT_LIFECYCLE_MODULE } from './client-lifecycle/index.js';
export { LedgerEntry, LedgerInvariantError, ManualConfirmationSource, MONEY_MODULE, minorUnitsToDecimal, PercentageWithLifespanWindow, postLedgerEntry } from './money/index.js';
export type { CommissionResult, CommissionTermsSnapshot, ConfirmedPaymentForCommission, EngagementClockSnapshot, ICommissionStrategy, LedgerAccountPurpose, LedgerAccountRef, LedgerDirection, LedgerEntryDraft, LedgerLineDraft, LedgerReferenceType, LedgerRepository, PaymentConfirmation, PaymentConfirmationSource, PostLedgerInput } from './money/index.js';
export { generatePayslipPdf } from './money/index.js';
export type { PayslipPdfInput, PayslipPdfLine } from './money/index.js';
export { MEDIA_MODULE } from './media/index.js';
export { PLATFORM_MODULE } from './platform/index.js';
export { NOTIFICATIONS_MODULE } from './notifications/index.js';

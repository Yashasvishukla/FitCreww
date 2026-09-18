# FitCrew Application Review

Review date: 2026-09-18  
Reviewer stance: senior UI/UX developer and security-focused backend reviewer  
Scope reviewed: Next.js web app, API routes, Prisma schema/migrations, tenant scoping, auth, role gate, money, invites, media, client lifecycle, training, organizations, coaches, dashboards, and supporting packages.

## Executive Summary

FitCrew already has strong building blocks: tenant-aware service functions, forced RLS on most public tenant tables, an application access gate, invite token hashing, private media storage, image sanitization, Argon2 password hashing, and audit logging for many sensitive actions.

The main risks are not from a complete absence of controls. They are from inconsistent boundaries and unfinished flows:

- Several pages silently fall back to a hardcoded demo tenant when `tenantId` is missing.
- Middleware only guards `/dashboard`, leaving other protected pages and APIs dependent on scattered checks.
- Tenant isolation for public business data is strong, but platform/auth tables are outside RLS and need a clearer least-privilege story.
- Razorpay checkout currently creates an order and opens checkout, but does not send the returned payment id/signature to the confirmation API.
- Invites validate the shape of an organization scope, but do not verify the invited organization actually belongs to the inviter's tenant/scope before writing the invite.
- Upload endpoints parse multipart bodies before tenant/id validation and lack request-level rate limiting, malware scanning, and stricter body limits.
- The UI is functional but often hides system state, has generic error recovery, mixes polished dashboard language with unfinished "temporary" product copy, and lacks guided journeys for high-stakes actions like onboarding, payment confirmation, refunds, consent, and coach reassignment.

## Priority Findings

### P0 - Razorpay Checkout Does Not Confirm Successful Payments

Evidence:

- The checkout handler in `apps/web/app/(protected)/money/workspace.tsx` resolves when Razorpay calls `handler`, but it discards the checkout response and only marks local UI state complete.
- The confirmation endpoint exists at `apps/web/app/api/money/razorpay/confirm/route.ts` and expects `paymentId`, `razorpayOrderId`, `razorpayPaymentId`, and `razorpaySignature`.
- Backend confirmation verifies the signature in `packages/db/src/payment-recording.ts`.

Impact:

- A real online payment can be completed at Razorpay but remain `pending` in FitCrew.
- Ledger posting, commission accrual, coach payable amounts, and owner dashboard numbers will not update.
- Users see success feedback even though the application has not confirmed the payment.

Recommended fix:

- Capture the full Razorpay handler response.
- POST it to `/api/money/razorpay/confirm` with the internal `paymentId`.
- Show success only after FitCrew confirmation succeeds.
- Add an owner-visible retry/reconcile action for pending gateway payments.
- Add webhook-based server-to-server confirmation as the source of truth.

### P0 - Hardcoded Demo Tenant Fallback Can Mask Missing Workspace Context

Evidence:

- `DEMO_TENANT_ID` is exported from `apps/web/lib/authorization.ts`.
- Pages such as clients and money use `searchParams.tenantId ?? DEMO_TENANT_ID`.

Impact:

- A missing query string silently changes workspace context instead of asking the user to choose a workspace.
- Users with access to the demo tenant could land in the wrong workspace without realizing it.
- Security review and production operations become harder because missing tenant context is not treated as an error.

Recommended fix:

- Remove demo tenant fallbacks from production routes.
- Use a workspace picker for all protected product areas when `tenantId` is absent.
- Keep demo/reference tenants behind explicit development-only routes or feature flags.

### P0 - Protected Route Coverage Is Inconsistent

Evidence:

- Middleware matcher only covers `/dashboard/:path*` in `apps/web/middleware.ts`.
- The protected layout redirects unauthenticated users, but API and page protections are implemented route by route.

Impact:

- A future page added under `/clients`, `/training`, `/money`, `/coaches`, `/organizations`, `/earnings`, or `/profile` can be accidentally exposed if it misses local auth logic.
- Security posture relies on developer memory instead of a centralized guard.

Recommended fix:

- Expand middleware matcher to all protected route groups and sensitive API namespaces.
- Keep page/API-level authorization as defense in depth.
- Add a test that enumerates protected routes and verifies unauthenticated redirects or `401` responses.

### P0 - Invite Scope Validation Does Not Verify Organization Ownership

Evidence:

- `createInviteForPrincipal` validates role/scope shape, then writes the invite using `scopeId`.
- The code does not fetch the organization to prove `scopeId` belongs to the tenant and is visible to the inviter before creating an `OrgAdmin` or organization-scoped coach invite.

Impact:

- A tenant owner could submit a random UUID and create a broken invite.
- If future access rules loosen or bugs appear elsewhere, this can become a cross-scope role assignment risk.
- The invited user journey fails late during consumption or after login.

Recommended fix:

- For `scopeType: organization`, load `organization` by `tenantId`, `scopeId`, and active status before invite creation.
- For organization-scoped inviters, ensure `scopeId` is one of the principal's effective organization scopes.
- Add tests for invalid organization id, cross-tenant organization id, expired invite, consumed invite, and duplicate email.

### P1 - Platform/Auth Tables Need Stronger Isolation and Least Privilege

Evidence:

- Business tables in `public` use RLS policies keyed by `app.tenant_id`.
- Platform/auth tables such as users, sessions, accounts, tenants, platform plans, and memberships are in the `platform` schema and are accessed by regular Prisma clients.
- Platform operator authorization uses `PLATFORM_ADMIN_USER_IDS`.

Impact:

- A SQL injection or accidental direct Prisma query against platform tables has broader blast radius than tenant-scoped tables.
- `PLATFORM_ADMIN_USER_IDS` is operationally simple but lacks role lifecycle, auditability, approvals, and break-glass controls.

Recommended fix:

- Use separate database roles/connection strings for auth, tenant application data, worker jobs, and platform operations.
- Add RLS or strict views/policies for `platform.user_tenant_membership`, platform subscriptions, and tenant metadata where feasible.
- Move platform operator roles into audited database state with explicit grant/revoke events.
- Add monitoring for platform reads and tenant provisioning.

### P1 - CSRF and Origin Protections Are Not Explicit Enough for JSON Mutations

Evidence:

- API routes rely on Auth.js cookies and accept JSON/multipart mutations.
- There is no visible route-level origin check, CSRF token verification, or same-site enforcement in application code.

Impact:

- If cookie SameSite settings are weakened by deployment configuration or embedded contexts, mutation APIs become more exposed.
- Money, invite, profile, media, and client lifecycle routes are high-value CSRF targets.

Recommended fix:

- Enforce origin checks for all unsafe methods.
- Use CSRF tokens or a double-submit strategy for browser-originated JSON/multipart routes.
- Reject unsafe methods without `Content-Type` allow-listing.
- Add security headers and document required Auth.js cookie settings for production.

### P1 - Upload Endpoints Read Full Multipart Bodies Before Validation

Evidence:

- `apps/web/app/api/media/upload/route.ts` and `apps/web/app/api/money/proof/route.ts` call `request.formData()` before validating `tenantId`, ids, file type, or size.
- The media service validates type and size after bytes are read.

Impact:

- Large multipart uploads can consume memory before application limits are enforced.
- Attackers can stress serverless memory/runtime limits with unauthenticated or low-privilege sessions.

Recommended fix:

- Configure route/body limits at Next/runtime/proxy level.
- Validate tenant/id fields before loading file bytes where possible.
- Add upload rate limiting by user, tenant, and IP.
- Add malware scanning or quarantine before proofs/photos become active.
- Keep Sharp re-encoding, SHA-256, private blobs, and short-lived URLs.

### P1 - API Error Handling Is Too Generic for Users and Too Inconsistent for Operators

Evidence:

- Many routes return generic messages such as "Operation failed", "Invalid tenant", or "Forbidden".
- Some errors are swallowed in page loaders and replaced with broad unavailable messages.

Impact:

- Users do not know whether to retry, fix input, contact an admin, or switch workspace.
- Operators lack consistent correlation across UI, API, and audit events.

Recommended fix:

- Standardize API error shape: `code`, safe `message`, `correlationId`, optional field errors.
- Surface actionable UI messages.
- Use `x-correlation-id` across all route groups, not only dashboard middleware.
- Add structured logging around denied access, payment failures, invite delivery, upload failures, and tenant provisioning.

## UI Changes For Best User Experience

### Global Navigation and Workspace Context

- Replace query-string-only workspace state with a persistent workspace switcher visible in the top navigation.
- Show current workspace name in every protected area.
- Remove hardcoded demo fallback from production journeys.
- Add role badges or a role switcher when one user has multiple roles.
- Replace text/symbol nav items like `◉ Account`, `＋`, `↗`, `•••`, `×`, and `›` with accessible icon components and tooltips.
- Make primary navigation consistent across dashboard, clients, training, money, earnings, coaches, organizations, and profile.

### Dashboard

- Keep the KPI overview, but reduce the hero height and decorative treatment for operational use.
- Prioritize action queue, overdue evaluations, unpaid coach payouts, and lapsed subscriptions above decorative cards.
- Make "Last refreshed" interactive with loading state and error state.
- Add empty-state actions directly inside exception cards.
- Add date presets for owner earnings: this month, last month, last 30 days, quarter, custom.

### Clients Journey

- Split enrollment into a clear stepper: identity, coach/organization, pricing/subscription, schedule, consent/access.
- Add inline validation before submission for price, duration, coach availability, email/password pairing, and schedule days.
- Show what happens next after enrollment: "Record baseline", "Collect payment", "Create plan".
- Add bulk filters for coach, organization, status, consent state, subscription state, and inactive clients.
- Add "recently added" and "needs baseline" views.
- In client detail, make consent and photo capture status prominent before upload/evaluation actions.

### Training Journey

- The workout logger is strong, but it needs guardrails:
  - warn before switching clients with unsaved workout changes,
  - autosave drafts instead of relying on manual save,
  - show sync state: saved, saving, offline, failed,
  - allow removing an exercise, not just sets,
  - make the "more" button functional or remove it,
  - turn placeholder quick tools into implemented calculators or hide them.
- Add plan creation/editing as a first-class flow in the training workspace.
- Add evaluation due prompts near the active client.
- For read-only organization views, clearly label what data is hidden and why.

### Money Journey

- Fix Razorpay confirmation before presenting checkout as ready.
- Replace "Checkout Soon" and temporary implementation copy with actual status:
  - `Online checkout unavailable`,
  - `Mock checkout enabled`,
  - `Live checkout enabled`,
  - `Gateway reconciliation required`.
- Add a payment timeline per record: created, checkout opened, paid at gateway, confirmed in FitCrew, ledger posted, commission accrued, settled.
- Add explicit refund confirmation modal with financial impact: client refund, owner absorption, coach clawback, ledger effects.
- Add proof preview/download for owners after upload.
- Add filters by status, method, coach, client, organization, date, and amount.

### Coaches and Organizations

- Coach invite success should show a concise "sent to email" state; avoid exposing dev invite URLs in production UI.
- Add pending invite list with expiry, resend, revoke, and copy link in development.
- Coach terms changes should show before/after and effective date.
- Organization creation should validate agreement end date is after start date.
- Organization dashboard should include drill-downs into members needing action.

### Forms, Feedback, and Accessibility

- Use consistent pending/success/error states across all forms.
- Disable destructive actions only while the specific action is pending, not through a broad page-level `busy` flag.
- Use field-level errors everywhere, not only in money.
- Add confirmation dialogs for irreversible actions: refunds, coach reassignment, settlement confirmation, payout handle deletion.
- Improve keyboard support for custom controls and horizontal nav.
- Replace raw symbols with buttons that have clear accessible labels.
- Ensure mobile layouts keep primary actions sticky or easy to reach.

## Backend and Security Improvements

### Tenant Isolation

Current strengths:

- `withTenant` validates UUID tenant ids, applies a Prisma tenant scoping extension, and sets transaction-local `app.tenant_id`.
- The tenant scoping extension stamps tenant ids on create and rejects cross-tenant where/data mutations.
- Public tenant tables have RLS policies in migrations.

Needed improvements:

- Treat missing tenant context as an error everywhere, not a demo fallback.
- Add a lint/dependency rule preventing direct `prisma` business-table access outside service functions.
- Add tests that run direct cross-tenant read/write attempts for every tenant-scoped model.
- Ensure new tenant-scoped models are automatically covered by RLS migrations and `TENANT_SCOPED_MODELS`.
- Add database roles that cannot bypass RLS.

### Authentication and Session Security

Current strengths:

- Credentials are validated with zod.
- Passwords use Argon2.
- Failed sign-ins lock after five attempts for fifteen minutes.
- Dummy hash reduces account enumeration timing signals.

Needed improvements:

- Add IP/user/email rate limiting for sign-in and invite consumption.
- Consider MFA for owners and platform operators.
- Add password breach checks and stronger password guidance.
- Add session revocation and device/session management.
- Audit password changes and sign-in lockouts.

### Authorization

Current strengths:

- Central access gate supports OwnerAdmin, Coach, OrgAdmin, and Client.
- Service functions generally resolve principal inside tenant-scoped transactions.

Needed improvements:

- Centralize route authorization wrappers for API routes.
- Include required role/action/resource in every route definition.
- Add deny-by-default tests for each role and resource.
- Validate invite `scopeId` against actual organizations.
- Review combined-role users carefully. Current OrgAdmin scoping intentionally avoids leaking coach-wide clients in `scopeQuery`; keep regression tests around that behavior.

### Money, Ledger, and Payments

- Fix Razorpay client confirmation and add webhook confirmation.
- Add idempotency keys for payment order creation, confirmation, refund, settlement, and proof upload.
- Validate payment amounts against subscription price or require explicit owner override.
- Enforce unique gateway order/payment ids.
- Store only necessary gateway identifiers; do not persist signatures longer than needed unless required for audit.
- Add reconciliation views for gateway-paid-but-not-confirmed and pending-too-long records.
- Add settlement approval workflow for large payouts.

### Media and Private Data

- Add route-level upload size limits before body parsing.
- Add upload rate limits and antivirus/malware scanning.
- Add media deletion/retention policies for withdrawn consent.
- Ensure proof/photo media access is audited.
- Avoid returning development data URLs in any shared/staging environment.
- Consider image moderation/PII handling rules because progress photos are sensitive personal data.

### Privacy, Compliance, and Audit

- Add consent versioning beyond hardcoded `v1`.
- Add explicit consent withdrawal flow and downstream media handling.
- Add data export/delete workflows by tenant and by client.
- Add audit trails for read access to sensitive photos, evaluations, payslips, and payment proofs.
- Mask or minimize contact data in list views where not needed.
- Define retention periods for inactive clients, media, invites, audit logs, payment proofs, and sessions.

### Operational Security

- Add security headers: CSP, HSTS, frame ancestors, referrer policy, permissions policy.
- Add dependency vulnerability scanning in CI.
- Add secret scanning and prevent `.env` leakage.
- Add production readiness checks for `NEXTAUTH_SECRET`, `APP_BASE_URL`, storage, email, Razorpay, telemetry, and database roles.
- Add backup restore drill automation to CI or scheduled ops.

## User Journey Issues and Bad Experiences

### New Owner Onboarding

Issue:

- Tenant provisioning creates an owner invite, but the first-run experience after accepting is not clearly visible in the product.

Recommended journey:

1. Accept invite and create password.
2. Land in workspace with setup checklist.
3. Configure commission defaults, payout details, first coach, first client, and payment mode.
4. Show progress until the workspace is operational.

### Coach Onboarding

Issue:

- Coach invite flow is simple, but terms and expectations are not clearly surfaced to the coach during acceptance.

Recommended journey:

- Invite email and acceptance screen should show role, workspace, commission rate, commission lifespan, data access, and next steps.
- After sign-in, coach should land on training or money depending on pending tasks.

### Client Enrollment

Issue:

- Enrollment is dense and mixes operational setup, login creation, subscription, schedule, and consent in one panel.

Recommended journey:

- Use staged enrollment with validation and "save draft".
- After successful enrollment, present next best actions.
- Make client access creation and photo consent deliberate, not buried in optional details.

### Payment Collection

Issue:

- UI copy says checkout is temporary, but the primary action still opens checkout.
- Successful checkout does not currently guarantee FitCrew confirmation.

Recommended journey:

- Show payment mode clearly.
- Confirm only after backend ledger posting completes.
- Provide pending/retry/reconcile states.

### Training Session

Issue:

- The workout logger is powerful but can lose context when switching clients or navigating away.

Recommended journey:

- Autosave continuously.
- Warn on unsaved changes.
- Restore drafts with a clear timestamp.
- Let users finish, discard, or continue drafts.

### Organization Admin

Issue:

- OrgAdmin dashboard is read-only but lacks enough explanation and calls to action when issues exist.

Recommended journey:

- Show "Contact coach", "Request evaluation", or "Message owner" actions.
- Explain why financial/private assessment details are hidden.

## Suggested Remediation Plan

### Phase 1 - Critical Fixes

- Fix Razorpay confirm flow and add tests.
- Remove production demo tenant fallbacks.
- Expand middleware/protected route coverage.
- Validate invite organization scope against tenant and inviter authority.
- Add upload request/body limits and auth/origin protections.

### Phase 2 - Security Hardening

- Add CSRF/origin checks for unsafe API methods.
- Add rate limits for sign-in, invites, uploads, payments, and profile changes.
- Separate DB roles for auth, tenant app, worker, and platform operations.
- Add idempotency keys for money and invite mutations.
- Add structured audit/logging with correlation ids.

### Phase 3 - UX and Product Quality

- Add workspace switcher and role context.
- Redesign client enrollment as a guided flow.
- Add payment lifecycle timeline and reconciliation states.
- Add autosave/offline-state improvements to training.
- Add pending invite management.

### Phase 4 - Compliance and Operations

- Add consent withdrawal and media retention workflows.
- Add data export/delete workflows.
- Add operator console audit trail.
- Add production readiness checks and security headers.
- Add privacy/access audit reports.

## Positive Notes To Preserve

- The `withTenant` plus RLS pattern is a strong base.
- Access gate centralization is the right direction.
- Image re-encoding with Sharp is good for stripping unsafe image metadata and normalizing uploads.
- Invite tokens are random and stored hashed.
- Password handling is already better than basic implementations.
- Financial ledger and commission logic are modeled explicitly instead of hidden in ad hoc payment fields.
- The training workspace has a genuinely useful, coach-centered interaction model; it needs completion and safeguards, not a full rethink.


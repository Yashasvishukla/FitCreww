# CLAUDE.md — FitCrew Implementation

You are acting as a **senior software engineer** implementing FitCrew, a multi-tenant SaaS platform for coaching businesses. You have deep expertise in Next.js (App Router), TypeScript, Prisma, PostgreSQL, and production SaaS engineering. **The stack is Next.js full-stack + PostgreSQL — there is no separate backend framework.** Route Handlers and Server Actions are the API layer; Prisma is the ORM; a small companion Node worker process handles scheduled jobs (Next.js has no built-in job runtime). You write production-grade code from the first commit — not prototypes to be hardened later.

## 1. Source-of-truth documents

Three documents govern this project. When in doubt, they win over your instincts, and this file wins over convenience:

- **FitCrew_PRD.md** — what we're building and why; personas; MVP scope table; open product decisions.
- **FitCrew_Architecture_v2.md** — every architectural decision (ADR-1 through ADR-6, with ADR-1 revised for the Next.js + Postgres stack), principles P1–P6, module map, the five-level plan. Do not re-litigate settled ADRs; if you believe one is wrong, stop and raise it explicitly rather than silently deviating.
- **FitCrew_DataModel.md** — every entity, key, constraint, and relationship with cardinality. Migrations are written from this document, not from memory.

## 2. Non-negotiable engineering invariants

These are the rules that, if violated, constitute a broken build regardless of whether tests pass:

1. **Tenant isolation is dual-layer, always.** Every tenant-scoped table has non-null `tenant_id`. Layer 1: a Prisma Client Extension auto-injects `tenant_id` into every `where` clause for tenant-scoped models. Layer 2: PostgreSQL RLS policies, activated per request via `SET LOCAL app.tenant_id = ...` **inside an explicit Prisma interactive transaction** (`prisma.$transaction(async tx => {...})`) — never a bare session-level `SET`, which is unsafe under connection pooling (PgBouncer transaction mode recycles connections between statements). The app's DB role never has `BYPASSRLS`. No feature ships without its RLS integration test.
2. **The ledger is append-only double-entry.** No UPDATE or DELETE on `ledger_entry`/`ledger_line`, ever. Corrections are reversing entries. Lines sum to zero, enforced by a deferred DB trigger AND domain logic. Balances are always derived, never stored as mutable totals.
3. **All access flows through `IAccessGate`.** No Route Handler, Server Action, or page checks roles ad hoc. Point checks via `can(...)`; list endpoints via `scopeQuery(...)` composed into the Prisma query — never post-filtered in memory. Deny by default: a Server Action without a declared action/resource pair fails closed.
4. **Historical facts are frozen at write.** Commission accruals snapshot `rate_applied` and `within_lifespan`. Evaluation deltas are computed and stored at write. Payslips are immutable once issued. Later edits to source data never rewrite these.
5. **Photos are a security domain.** Private blob container only; every read brokered through the gate → short-lived SAS URL (≤10 min); consent checked before capture; EXIF/GPS stripped server-side on upload; deletion = blob delete + metadata tombstone.
6. **Money is a value object.** No naked `decimal` crosses a domain boundary. `Money`, `Percentage`, `LifespanMonths`, `DateRange` enforce invariants in constructors — illegal states unrepresentable.
7. **Everything business-variable is per-tenant config** (rates, lifespans, cadences, fee-bearer, satisfaction mode, workflow stages). Hardcoding a business rule is a bug even if only one tenant exists.
8. **Phase-2 seams stay honest.** `IPaymentConfirmationSource`, `IMeasurementSource`, `INotificationChannel`, `IAccessGate` are real ports with contract tests. Never let an implementation detail of the manual/MVP path leak through a port.

## 3. Production standards (definition of "done")

A work item is done only when ALL of the following hold:

- **Tests:** Vitest unit tests for domain logic; integration tests (Testcontainers-node spinning a real Postgres) for persistence and access; the risk-weighted suites from Architecture §13.4 (property-based tests via `fast-check` for ledger/commission; permission-matrix tests for access; RLS cross-tenant tests). Money code additionally requires golden-scenario tests. Playwright for UI and viewport (390/768/1280) tests. Coverage is not a vanity number — every invariant in §2 has a test that fails if it's violated.
- **Migrations:** Prisma Migrate, forward-only, reviewed, reversible where feasible; RLS policies and triggers live as raw SQL in the same migration (via `prisma migrate dev --create-only` + hand-added SQL), never applied manually outside the migration history.
- **Observability:** structured logging via `pino` (no PII/photos in logs; amounts OK, never proof screenshots), correlation IDs per request, App Insights (or equivalent) custom events for money operations and access denials.
- **Error handling:** domain errors as typed `Result`/discriminated-union returns from Server Actions (never throwing across the server/client boundary for expected failures) mapped to consistent error shapes; no swallowed exceptions; retries only where idempotent; every worker job is idempotent and safely re-runnable.
- **Security:** input validated at the boundary with `zod` schemas (shared between client forms and server actions), output encoded, no secrets in code (Azure Key Vault / `.env` never committed), authn on every Server Action/Route Handler by default with explicit opt-out only for health/invite-landing.
- **Audit:** every money action and access-sensitive mutation writes to `AuditLog`.
- **API:** Route Handlers that serve external callers (Razorpay webhooks, future public API) are OpenAPI-documented; internal Server Actions get end-to-end type safety natively from TypeScript — no client generation step needed. Versioned under `/api/v1` for any externally-facing Route Handler.
- **Review discipline:** small PRs (one chunk = one PR where possible), conventional commits, PR description states which invariants the change touches and which tests prove them.

Write code as if the next engineer reading it is a skeptical senior reviewer at 2 a.m. during an incident: explicit over clever, boring over novel, named constants over magic values, and comments only where the *why* isn't obvious from the code.

## 4. Repository layout

**A pnpm + Turborepo monorepo, single language (TypeScript) end to end.** This replaces a separate backend/frontend split: Next.js Server Actions and Route Handlers *are* the backend, so "backend" and "frontend" live in one app, with the domain/application logic factored into standalone packages that Next.js consumes — preserving the modular-monolith shape (P2/ADR-1b) without a second language or a generated API client.

```
/apps
  /web              — Next.js App Router: route groups per role (owner) (coach) (org)
                       Server Actions = write use cases; Route Handlers = webhooks/external API
  /worker           — companion Node process (node-cron or Azure Function timer triggers):
                       evaluation due-dates, subscription-lapse detection, reminders.
                       Next.js has no background-job runtime — this process exists because of that,
                       not by choice; it shares /packages/domain and /packages/db, nothing else.
/packages
  /domain           — entities, value objects, domain events; framework-agnostic, ZERO Next.js/Prisma imports
  /application       — use-case handlers, IAccessGate/AccessGate impl, ports (interfaces), specifications
  /db               — Prisma schema, migrations, RLS SQL, generated client, repository implementations
  /ui               — shared design-system components (Level-agnostic; consumed by /apps/web only)
  /config           — eslint, tsconfig, tailwind config shared across packages
/tests
  — colocated per package (*.test.ts via Vitest) + /tests/integration (Testcontainers Postgres)
  + /tests/e2e (Playwright, incl. viewport suite at 390/768/1280)
/docs               — the three governing documents + ADR additions
```

Module boundaries (Identity&Access, Network, ClientLifecycle, Money, Media, Platform, Notifications) are enforced as **sub-folders within `/packages/application` with `dependency-cruiser` or `eslint-plugin-boundaries` rules** (the TypeScript equivalent of NetArchTest): each module exposes an `index.ts` barrel of public use cases and domain events only; Money never imports ClientLifecycle internals directly — it reacts to events.

## 5. Frontend design system — sleek, global, HIG-grounded

This is a global product; the UI must feel like it belongs on a well-designed modern device, not like an internal admin tool. The design authority is **Apple's Human Interface Guidelines** (developer.apple.com/design/human-interface-guidelines) — not to imitate Apple's products, but to adopt the principles that make them feel effortless. When making a design decision without explicit guidance here, consult the HIG section for the closest pattern and follow its reasoning.

**Governing principles (HIG: Clarity, Deference, Depth — plus Universality):**
- **Clarity** — text legible at every size, icons precise, functionality obvious. One primary action per screen. If a screen needs explanation, redesign it.
- **Deference** — the UI serves the content. The coach's client list, the progress photos, the numbers on a payslip are the heroes; chrome is minimal. No decorative gradients, no ornamental borders, generous whitespace.
- **Depth** — hierarchy through layering and subtle motion, not heavy lines. Sheets and modals rise over context; navigation communicates place.
- **Universality (core principle)** — **every screen in the product works on both mobile and web/desktop. No exceptions.** There are no mobile-only or desktop-only screens; there are only screens with a primary design viewport and a fully functional counterpart. Every screen is built and verified at three breakpoints — 390px (mobile), 768px (tablet), and 1280px+ (desktop) — before its chunk's demo passes. Responsive behavior is layout adaptation (stacking, sheet↔sidebar, list↔table), never feature removal: anything a role can do on desktop, that role can do on mobile, and vice versa. Owner dashboards are desktop-primary but must remain fully operable one-handed on a phone (he will check payables from the gym floor); coach and org flows are mobile-primary but must be comfortable on a laptop. Playwright viewport tests at all three breakpoints are part of every UI chunk's definition of done.

**Concrete tokens and rules:**
- **Typography:** system font stack (`-apple-system, BlinkMacSystemFont, "SF Pro", "Segoe UI", Roboto, "Helvetica Neue", sans-serif`). Type scale mirrors HIG dynamic type: 34/28/22/20/17/15/13px with 400 and 600 weights only. Body text 17px on mobile (HIG minimum for comfortable reading), never below 13px anywhere.
- **Spacing:** 4px base unit; component padding in 8/12/16/24; screen margins 16px mobile, 24px+ desktop. Touch targets ≥44×44px (HIG hard rule) — coaches use this between sets with sweaty hands; err larger.
- **Color:** near-neutral foundation (white/system-gray surfaces, high-contrast text) + ONE brand accent used sparingly for primary actions and state. Semantic colors only for meaning: green = confirmed/paid, amber = pending/due, red = overdue/failed. All pairs must pass WCAG AA (4.5:1); support dark mode from day one via CSS variables.
- **Motion:** purposeful and brief (150–250ms, ease-out). Motion communicates state change (sheet presenting, item confirmed) — never decoration. Respect `prefers-reduced-motion`.
- **Components:** shadcn/ui primitives + Tailwind, restyled to these tokens (radius 10–12px, hairline borders, subtle elevation). No component zoo — one button family, one card, one sheet, one list row, reused everywhere.
- **Primary viewports (within Universality):** Coach and Org surfaces are designed at 390px width first, then adapted up. Owner dashboard is designed at 1280px first, then adapted down — never truncated down. The session-logging flow is the sacred path: ≤60 seconds, one screen, large tap targets, optimistic UI with background sync, and it must hit that bar on both a phone and a laptop.
- **Internationalization-ready:** all strings externalized from day one; layouts tolerate 1.5× text expansion; dates/currency via `Intl` with tenant locale (INR formatting: ₹1,50,000 — Indian digit grouping).
- **Empty states, loading, and errors are designed, not defaulted:** every list has a purposeful empty state with the next action; skeletons over spinners; errors say what happened and what to do.

## 6. Implementation plan — demoable chunks

Follow Architecture §15's five levels, broken here into chunks sized for one PR / 1–3 days each. **Every chunk ends with a demo script** — a sequence a human can click through or run. Do not start a chunk until the previous chunk's demo passes. Within a chunk: write the failing tests for its invariants first.

### Level 1 — Foundation (trust base)
- **1.1 Skeleton & CI** — monorepo layout (§4), `dependency-cruiser` boundary tests, GitHub Actions (build, test, migration check), docker-compose for local Postgres. *Demo: clean clone → one command → green pipeline locally.*
- **1.2 Tenancy core** — Tenant/TenantConfig Prisma models, tenant-scoping Client Extension, RLS migration (raw SQL policies) + the `withTenant(tenantId, callback)` transaction wrapper that issues `SET LOCAL app.tenant_id`, seed script for a dev tenant. *Demo: integration test suite proves cross-tenant `findMany` returns zero rows under the app role, with and without the extension active (RLS alone still blocks it).*
- **1.3 Identity & auth** — UserAccount model, Auth.js (NextAuth) with Credentials provider + database sessions, login Server Action, middleware protecting route groups. *Demo: log in from the browser, receive a scoped session, hit a protected Server Action.*
- **1.4 Party, roles, engagements** — Party/RoleAssignment/Engagement aggregates with value objects (Money, Percentage, LifespanMonths, DateRange), self-loop + overlap constraints, migrations. *Demo: seed the reference network — owner, two coaches with different rates/lifespans — via API; constraint violations rejected with clean errors.*
- **1.5 AccessGate v1** — `Can` + `ScopeQuery` with specifications, deny-by-default middleware, permission-matrix test suite (including owner-also-coach union case), AuditLog writes on denials. *Demo: matrix tests green; a coach token hitting another coach's resource gets 403 + audit row.*
- **1.6 Invites** — single-use expiring invites for Coach and OrgAdmin; email adapter (console/dev sink); consumption creates RoleAssignment. *Demo: owner invites a coach by email; coach sets password via link; link is dead on second use.*

### Level 2 — Network & onboarding (the business map)
- **2.1 Coach management UI** — owner screens: coach list, invite, per-edge terms editor (rate + lifespan with validation). *Demo: owner manages his real coach roster in the browser, mobile and desktop.*
- **2.2 Organizations** — Organization entity + agreement, org invite → OrgAdmin login → scoped (empty) org home. *Demo: hospital onboards itself end-to-end with zero owner data entry.*
- **2.3 Client enrollment** — Client entity, enrollment flow (by owner/coach/org) with custom price, coach assignment, schedule; org members via `organization_id`. *Demo: enroll a direct client and an org member; each visible to exactly the right roles (verified live with three logins).*
- **2.4 Media pipeline** — MediaAsset, private blob container, upload with type/size validation + EXIF strip, gate-brokered short-lived SAS reads, consent flag gating capture. *Demo: photo uploaded for a consenting client; URL expires; non-consenting client's capture UI is disabled; another coach's token cannot mint a URL.*
- **2.5 Baseline intake** — intake form (measurements JSONB, posture, photos), workflow pipeline v1 (WorkflowDefinition + ILifecycleStep registry + enrollment stages), Subscription record creation. *Demo: full enrollment → baseline → active client walk-through on a phone.*

### Level 3 — Training operations (the daily loop)
- **3.1 Exercise catalog & plans** — catalog (global seed + tenant additions), WorkoutPlan/PlanDay with versioning. *Demo: coach builds a 7-day plan; edits create v2; v1 history intact.*
- **3.2 Session logging** — the sacred flow: single-screen mobile logging, optimistic UI, `(tenant, coach, date)` index. *Demo: stopwatch test — log a real session in under 60 seconds on a 390px viewport.*
- **3.3 Evaluation scheduling** — EvaluationSchedule + worker job computing `next_due_date`, `EvaluationDue` event, email reminder handler. *Demo: advance clock in test tenant; reminder fires; due list shows on coach home.*
- **3.4 Evaluations & progress** — evaluation capture (measurements/posture/photos), deltas frozen at write, progress charts + side-by-side photo compare. *Demo: record week-2 evaluation; client's trend chart and photo comparison render; correcting baseline does NOT alter stored deltas.*
- **3.5 Satisfaction** — both capture modes behind TenantConfig, feeding owner metrics. *Demo: flip tenant config; capture surface changes accordingly.*

### Level 4 — Money (the trust engine)
- **4.1 Ledger core** — LedgerAccount/Entry/Line, balance-to-zero trigger, posting service, property-based test suite. *Demo: property tests (thousands of generated postings, all balanced) green; attempted UPDATE on a ledger row fails at the DB.*
- **4.2 Payment recording** — PayoutHandle CRUD, client-payment flow (display owner UPI/QR → record → confirm with UTR/screenshot proof), `ManualConfirmationSource`, posting handler. *Demo: record and confirm a real-shaped payment; ledger shows receivable→cash movement; audit trail complete.*
- **4.3 Commission engine** — `ICommissionStrategy` + `PercentageWithLifespanWindow`, ClientEngagementClock (anchor on first payment), accruals with snapshots. *Demo: golden scenarios green — mixed prices, mixed lifespans, a payment exactly at the window edge, a payment after expiry accruing zero.*
- **4.4 Settlement & payslips** — payables view, settlement batching, payout confirmation, immutable PDF payslip to blob, coach earnings view (own data only). *Demo: simulate a month; run settlement; open the payslip PDF; every number traceable to accruals; coach login sees own payslip and nothing else.*
- **4.5 Corrections & org payments** — reversing entries, configurable claw-back, org one-time agreement payment through the same pipeline. *Demo: refund a payment; ledger nets correctly; payslip regeneration blocked (immutable) with correction shown on next period.*

### Level 5 — Experience & platform (the SaaS layer)
- **5.1 Owner dashboard** — business-at-a-glance, per-coach and per-org drill-downs over event-refreshed summary tables. *Demo: owner runs Monday morning from one screen with the seeded month of data.*
- **5.2 Exception surfacing** — lapsed subscriptions, overdue evaluations, inactive clients, unsettled payables. *Demo: each exception type visible with a one-tap path to resolution.*
- **5.3 Org dashboard** — read-only member progress for OrgAdmin. *Demo: hospital coordinator shows leadership a progress report unaided.*
- **5.4 Platform layer** — platform schema, tenant provisioning with seeded defaults, second-tenant readiness audit (P4: zero hardcoded rules). *Demo: provision a second demo tenant; operate it with zero code changes; first tenant unaffected (RLS suite re-run).*
- **5.5 Hardening & phase-2 gates** — App Insights dashboards/alerts, backup-restore drill, DPDP checklist sign-off, contract-test suites proving `IPaymentConfirmationSource`/`IMeasurementSource` ports are swap-ready. *Demo: kill and restore the database from backup in staging; all contract tests green against a fake gateway source.*

## 7. Working agreements with the human

- Work one chunk at a time; announce the chunk, list its invariants and tests first, then implement.
- Never skip ahead to "interesting" chunks; the dependency spine is load-bearing.
- If a requirement is ambiguous, check the PRD's open-decisions list; if still ambiguous, ask — do not invent business rules.
- When you deviate from any governing document, stop and write a short ADR addendum in /docs and get explicit approval.
- Prefer deleting code to adding flags. Prefer the boring solution. If you reach for a queue, a cache, or a new service, re-read Architecture ADR-1b first.

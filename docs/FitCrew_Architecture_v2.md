# Architecture & Design Document — v2
## Coaching Business Management Platform ("FitCrew")

**Version:** 2.0 (supersedes v1.0)
**Date:** 18 July 2026
**Audience:** Solution architect, senior engineers, and Yash as implementing engineer
**Companion:** FitCrew PRD v1.0
**What's new in v2:** deep object-oriented design (aggregates, interfaces, class responsibilities, SOLID mapping), feature-wise architectural treatment, and a five-level prioritized implementation plan (§15) — each level a self-contained feature category, ordered for incremental build.

---

## Part I — Foundations

## 1. How to read this document

Part I (§1–5) sets context, principles, stack, and tenancy — the ground everything stands on. Part II (§6–10) is the domain and object-oriented design: the data model, the aggregate and class design, the access-control machinery, the money engine, and the extensibility mechanics — with concrete TypeScript shapes so this is implementable without a second interpretation pass. Part III (§11–14) covers feature-wise architecture, cross-cutting concerns, and the decision log. Part IV (§15) is the five-level build plan you will implement against.

**Note on this revision:** §4 (ADR-1) has been revised from the original v1.0/v2.0 decision (ASP.NET Core + Next.js) to a full-stack Next.js + PostgreSQL/Prisma architecture. All code samples throughout Part II are TypeScript. Every other decision in this document — the domain model, the ledger design, the access model, the extensibility patterns, the five-level plan — is unchanged, because those decisions were deliberately made stack-agnostic (P2). Only the mechanics of *how* they're enforced (Prisma Client Extensions instead of EF Core query filters, Auth.js instead of ASP.NET Identity, `dependency-cruiser` instead of NetArchTest) have moved.

The governing insight, unchanged from v1 and worth repeating because every decision descends from it: **this system's difficulty is correctness and change-absorption, not throughput.** Launch load is one tenant, 50–100 coaches; the design ceiling is 10–15k coaches across tenants. Both are trivial loads. What is expensive here is a wrong ledger split, a leaked body photo, a cross-tenant read, or a domain model too rigid for the requirement churn the owner has explicitly promised. So: boring infrastructure, rich and rigorously designed domain layer.

## 2. System context

Multi-tenant SaaS. The platform bills tenants (coaching businesses). Inside a tenant: an **Owner/Admin** runs **Coaches**, partner **Organizations** (self-managing bulk-client institutions, e.g., a hospital), and **Clients**. Clients pay the owner directly (UPI/QR out-of-band in MVP; Razorpay in phase 2); the owner retains a per-relationship commission — custom rate, custom lifespan window (1/3/6/8/12 months) — and routes the remainder to coaches with generated payslips. Coaches log actual training sessions, maintain prescribed workout plans, and record periodic evaluations (body composition, posture, photographs) on a configurable cadence. One identity may hold several roles at once (the reference owner is also a coach for a partner org). External systems: UPI ecosystem (out-of-band), Razorpay (phase 2), BMI machine (manual now, API later), Azure Blob (photos), email/SMS/WhatsApp (notifications).

## 3. Architectural principles (the constitution)

**P1 — Money and access correctness dominate.** Provable ledger; boundaries that hold even against buggy application code.
**P2 — Boring infrastructure, rich domain.** One deployable, one relational database; all sophistication in the domain layer where it is testable and cheap to change.
**P3 — Extend by adding, never by editing.** Open/closed realized through the concrete mechanisms in §10: strategies, registered pipeline steps, event handlers.
**P4 — Everything that varies is data.** Rates, lifespans, cadences, fee-bearer, workflow stages: per-tenant configuration, never constants. The second tenant must work with zero code changes.
**P5 — Phase 2 is substitution, not rewrite.** Manual→Razorpay and manual→BMI API are interfaces with swappable implementations, designed today. Authorization is not a phase-2 substitution: the AccessGate is the permanent in-app authorization boundary.
**P6 — Every boundary is enforced twice.** UI/app-layer scoping for correctness of experience; database-layer enforcement for correctness of fact.
**P7 — Implementation discipline is part of the architecture.** A design rule is not accepted until it has a code choke point, a test that can fail, and a review checklist item. Security and money controls are built in the first feature that needs them, never as a later hardening pass.

## 4. Technology stack (ADR-1, revised)

**This ADR supersedes the original v1 decision (ASP.NET Core Web API + Next.js front-end). Current decision: Next.js 14+ (App Router) as a full-stack application — Server Actions and Route Handlers as the API layer, no separate backend framework — with PostgreSQL 16 via Prisma, one deployable web app plus one small companion worker process, on Azure App Service, Azure Blob Storage for media, Application Insights for telemetry.**

*Why full-stack Next.js instead of a separate .NET API:* with the decision to build in TypeScript end-to-end, the two-language cost accepted in the original ADR-1 (C# backend, TS frontend, generated client at the boundary) disappears entirely — Server Actions give compiler-checked, end-to-end type safety between UI and server with no client-generation step. Colocating "backend" logic in Next.js does not weaken P1 (correctness dominates): the risk-bearing logic — ledger, commission engine, access gate, workflow engine — still lives in framework-agnostic TypeScript packages (`/packages/domain`, `/packages/application`, §12) that Next.js merely *calls*, exactly mirroring the discipline the original ADR asked of the .NET backend. What Next.js does *not* give natively is a background-job runtime — addressed explicitly by the companion worker process below, not glossed over.

*Why Postgres, unchanged:* row-level security (§5) remains the keystone of tenancy enforcement; JSONB serves the polymorphic payloads (terms, measurements, exercise lists); no license cost.

*ORM: Prisma.* Chosen over Drizzle or a raw query builder for its schema-as-source-of-truth workflow (`schema.prisma` generates migrations and a fully-typed client) and its Client Extensions API, which is what makes Layer-1 tenant scoping enforceable *by construction* (§5) rather than by developer discipline — every tenant-scoped query is intercepted and filtered centrally, the direct TypeScript analogue of the EF Core global query filter from v1. The one Prisma-specific caveat the team must internalize: RLS requires a Postgres session variable (`app.tenant_id`) to be set *before* the query runs, and under connection pooling (PgBouncer in transaction mode, common on managed Postgres) a bare `SET` can leak across requests sharing a pooled connection. The mitigation is structural, not a code-review reminder: **every tenant-scoped database access goes through a single `withTenant(tenantId, callback)` helper** that opens a Prisma interactive transaction and issues `SET LOCAL app.tenant_id = ...` as its first statement — `SET LOCAL` is transaction-scoped by Postgres itself, so it cannot leak regardless of pooling. This helper is the only place in the codebase allowed to touch tenant context.

*Auth: Auth.js (NextAuth) v5* with a Credentials provider (email/password against `UserAccount`) and **database-backed sessions**, not JWT sessions — this preserves the v1 requirement that role assignments are resolved server-side per request rather than baked into a token, so a revoked coach loses access immediately (critical for off-boarding mid-dispute, per Architecture §7.3's original reasoning, unchanged here).

*The worker process — the one genuine addition this stack forces.* Next.js is a request/response web framework; it has no equivalent of a .NET `IHostedService`. Evaluation due-date computation, subscription-lapse detection, and reminder dispatch (Architecture §11, §15 Level 3.3) need a process that runs independent of HTTP traffic. The decision: a **small standalone Node process** (`/apps/worker`, §12) using `node-cron`, sharing the `/packages/domain` and `/packages/db` packages with the web app — not a serverless function per job (which would fragment the domain logic across deployment boundaries) and not a third-party queue service (unjustified infrastructure at this load, consistent with ADR-1b below). It is a second deployable, which is the one place this revised stack is *less* monolithic than the original — an accepted, minimal, and clearly-scoped exception.

**ADR-1b — explicit rejection of distributed machinery (unchanged).** No microservices, no message broker, no Elasticsearch, no separate read store. The modular-monolith property that matters — domain state and ledger writes committing in one transaction — is preserved in the new stack: Prisma's `$transaction` gives the same atomicity guarantee EF Core's `SaveChanges` gave in v1. The concession to the future is *module seams* (§12): internally partitioned packages whose boundaries are the extraction lines if a module ever earns independent deployment. This remains a deliberate counter-steer to the team's day-job instincts (KEDA/Event Hub/Service Bus-scale systems) — correct for that load, incorrect for this one.

## 5. Multi-tenancy and isolation (ADR-2)

**Decision: pooled tenancy — `tenant_id uuid not null` on every tenant-scoped table — enforced twice (P6): a Prisma Client Extension in the application, PostgreSQL row-level security in the database.**

*Layer 1 (app):* a `TenantContext` is resolved from the authenticated Auth.js session per request; a Prisma Client Extension (`prisma.$extends(tenantScoping(tenantId))`) intercepts every query against tenant-scoped models and injects `where: { tenantId }` automatically, and stamps `tenantId` on every `create`. The extension is applied once, centrally, when the tenant-scoped Prisma client is constructed for a request — no call site can forget it because no call site sees the unscoped client. Scoping is by construction, not developer discipline.

*Layer 2 (db):* every tenant table carries `ENABLE ROW LEVEL SECURITY` with policy `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. The `withTenant(tenantId, callback)` helper (§4) opens a Prisma interactive transaction and issues `SET LOCAL app.tenant_id = ...` as its first statement — transaction-scoped, so it is safe under PgBouncer transaction-mode pooling where a bare session-level `SET` would not be. The application's database role does **not** have `BYPASSRLS`. Consequence: raw SQL that forgets the filter, or a Client Extension bypass bug, still returns zero foreign rows. Two independent layers must fail simultaneously.

*Rejected:* database-per-tenant and schema-per-tenant — migration×N, pool fragmentation, backup orchestration, all purchased to solve what RLS solves cheaper at thousands-of-small-tenants scale. Escape hatch retained: the schema is identical either way, so a future whale tenant can be lifted to a dedicated database without redesign.

*Platform tables* (tenants, platform subscriptions/billing) live in a separate `platform` schema without tenant RLS, owned by the Platform module — mirroring the PRD's hard split between *platform subscription* (tenant pays us) and *client subscription* (client pays the business).

**Indexing discipline:** every composite index leads with `tenant_id` — e.g., `(tenant_id, coach_party_id, session_date desc)` on sessions, `(tenant_id, client_id, evaluated_at desc)` on evaluations — so RLS predicates and hot paths share index access. Monetary columns are `numeric(12,2)`, INR-fixed in MVP but stored per record.

**Tenant-isolation implementation gate:** every new tenant-scoped model must ship with all of the following in the same change: `tenant_id not null`, an index whose first column is `tenant_id` for its hot paths, Prisma tenant-scoping coverage, an RLS policy using `current_setting('app.tenant_id')`, and an integration test proving a non-bypass application role cannot read another tenant's row. Raw SQL is allowed only inside `withTenant()` or explicitly platform-scoped code. The unscoped Prisma client is infrastructure-only and must not be imported by Server Actions, Route Handlers, application services, or tests outside the DB package.

## Part II — Domain & Object-Oriented Design

## 6. Domain model: the Party–Role–Edge core (ADR-3)

**Requirements this must absorb:** one person, several simultaneous roles (owner is also a coach at a partner org); organization as a self-managing *bulk client* whose members are ordinary clients; per-relationship commercial terms (custom rate + lifespan); future entity/relationship types without schema surgery.

**Decision: separate identity from capability from commerce.**

- **`Party`** — a person or institution; one row per real-world actor; optionally linked to a `UserAccount` (login). Clients are parties *without* accounts in MVP → phase-2 client login is "attach an account," not a migration.
- **`RoleAssignment`** — `(party_id, role, scope_type, scope_id, valid_from, valid_to)` with role ∈ {OwnerAdmin(scope: tenant), Coach(scope: tenant | organization), OrgAdmin(scope: organization)}. Effective permission = union of live assignments; the UI's "acting as" switch is presentation only. Rows are deliberately tuple-shaped so the AccessGate can evaluate scoped role assignments consistently.
- **`Engagement`** — the commercial edge: `(upstream_party_id, downstream_party_id, commission_rate, commission_lifespan_months, valid_from, valid_to, terms jsonb)` with a check constraint forbidding self-loops. MVP is a single hop (owner→coach); the generality costs nothing and absorbs future relationship types as rows.
- **`Organization`** — a party of kind `institution` with a partnership agreement (one-time payment, recorded like any inflow). Its members are ordinary `Client` parties whose enrollment references the org as containing/billing parent. Individual client = the degenerate case (bill-to self). Result: sessions, plans, evaluations, photos — one code path for both worlds.

### 6.1 Aggregate design (DDD tactical layer)

Aggregates are chosen by *invariant boundaries* — the sets of rows that must change atomically:

| Aggregate root | Contains | Invariant it guards |
|---|---|---|
| `Client` | enrollment info, consent flags, schedule, current workflow state | Enrollment consistency; consent precedes photo capture; single active coach assignment |
| `Subscription` | term, price, status history | Price immutable after first confirmed payment; status transitions legal (active→lapsed→renewed…) |
| `WorkoutPlan` | plan days (versioned) | Editing creates a new version; history immutable |
| `TrainingSession` | exercises, times, notes | Session belongs to an active coach-client pair at its date |
| `Evaluation` | measurements, posture, photo refs, deltas | Deltas computed and *frozen* at write; corrections append |
| `Engagement` | terms, validity | Rate/lifespan snapshot rules; no self-loop; no overlapping duplicate edges |
| `LedgerEntry` | its lines | Lines balance to zero — enforced in domain **and** by DB trigger (P6) |
| `Settlement` | accrual references, payslip | Once issued, immutable; every included accrual settles exactly once |
| `Organization` | agreement, admin invites | Invite single-use and expiring |

Aggregates reference each other by ID only; cross-aggregate consistency flows through domain events (§10.2) inside the Unit of Work where atomicity is required (payment→ledger→accrual), post-commit where it is not (notifications).

### 6.2 Class design and SOLID mapping (the OOP layer)

The domain layer is plain TypeScript in `/packages/domain` — **zero imports from Prisma, Next.js, or any framework** (enforced by the dependency-cruiser rule in §4/§12), so domain logic is testable with Vitest and no database. Persistence mapping lives entirely in `/packages/db`'s repository implementations, which translate between Prisma models and these domain types.

```typescript
// Identity & capability — a class with a private constructor + static factory
// enforces "you cannot construct an invalid Party" — invariants live in the
// factory, illegal states are unrepresentable, matching the discipline C#
// gets from a private constructor, achieved here purely by convention.
export class Party {
  private constructor(
    readonly id: PartyId,
    readonly kind: PartyKind,               // 'person' | 'institution'
    readonly name: PersonName | null,
    private readonly assignments: readonly RoleAssignment[],
  ) {}

  static reconstitute(props: PartyProps): Party {
    return new Party(props.id, props.kind, props.name, props.assignments);
  }

  holdsLive(role: Role, scope: Scope, on: PlainDate): boolean {
    return this.assignments.some(a => a.matches(role, scope) && a.isLiveOn(on));
  }
}

// The commercial edge — terms live here, never on the person
export class Engagement {
  private constructor(
    readonly id: EngagementId,
    readonly upstream: PartyId,
    readonly downstream: PartyId,
    readonly commissionRate: Percentage,          // value object: 0..100, 2dp
    readonly commissionLifespan: LifespanMonths,  // value object: 1|3|6|8|12, tenant-extensible
    readonly validity: DateRange,
  ) {}

  static create(
    upstream: PartyId, downstream: PartyId,
    rate: Percentage, lifespan: LifespanMonths, validity: DateRange,
  ): Engagement {
    if (upstream === downstream) {
      throw new DomainError('Engagement cannot be a self-loop.');
    }
    return new Engagement(EngagementId.new(), upstream, downstream, rate, lifespan, validity);
  }
}

// Money value object — no naked number crosses a domain boundary.
// Uses a fixed-point decimal library (decimal.js) internally — never
// native floating point for currency.
export class Money {
  private constructor(private readonly amount: Decimal, readonly currency: Currency) {}

  static inr(amount: Decimal.Value): Money {
    return new Money(new Decimal(amount).toDecimalPlaces(2), 'INR');
  }

  add(other: Money): Money {
    if (other.currency !== this.currency) throw new DomainError('Currency mismatch.');
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  toString(): string { return this.amount.toFixed(2); }
}
```

**Value objects everywhere quantities have rules:** `Money`, `Percentage`, `LifespanMonths`, `DateRange`, `UpiHandle`, `MeasurementSet`. This is where the object-oriented discipline earns its keep in this system — invariants live in private constructors + static factories, so an illegal state (negative money, 130% rate, inverted date range) is unrepresentable rather than validated at N call sites. TypeScript has no `readonly record struct` or compiler-enforced immutability, so every value object is a class with `private constructor` + `readonly` fields + a validating static factory (`Percentage.of(45)` throws if out of range) — the same invariant-at-construction guarantee, achieved through convention rather than the language.

**SOLID, mapped to actual seams rather than recited:**
- **S** — each aggregate guards exactly one invariant cluster (table above); each application-layer use case (e.g., `recordPayment`, `logSession` — plain async functions, not classes, since TS use cases don't need a handler-class ceremony) does one job.
- **O** — realized three ways in §10: `CommissionStrategy` implementations, `LifecycleStep` registrations, event handlers. New behavior = new module + registration; tested code untouched.
- **L** — every `PaymentConfirmationSource`/`MeasurementSource`/`NotificationChannel` implementation is contract-tested against the same Vitest suite, so substitutability is verified, not assumed.
- **I** — narrow interfaces at module boundaries: the Money module consumes an `EngagementTermsReader` port, not the whole Network module surface; `AccessGate` exposes `can` and `scopeQuery`, nothing else.
- **D** — domain and application layers depend on abstractions (`Clock`, `LedgerPoster`, `MediaStore`, `AccessGate` — TS interfaces or function types, not concrete classes); `/packages/db` and `/apps/web`'s infrastructure implement them; composition happens once, at the request-scoped container built in a Server Action or Route Handler entry point. This is also what makes P5's substitutions mechanical: swapping `ManualConfirmationSource` for `GatewayConfirmationSource` is a one-line change at the composition point.

### 6.3 Client lifecycle entities

`Client` (enrollment context, consent, schedule, workflow state) · `Subscription` (append-only term history) · `WorkoutPlan/PlanDay` (versioned prescription) · `TrainingSession` (the *actual* event — coach, client, date, time, exercises as JSONB against a catalog; write path is a single POST tuned for the <60s mobile bar) · `Evaluation` (JSONB `measurements` map so the phase-2 machine API adds metrics without migration; deltas denormalized at write — historical facts must not drift if a baseline is later corrected) · `EvaluationSchedule` (cadence per client, drives due-date jobs) · `SatisfactionRecord` (per-session or periodic; which is *enabled* is tenant config, per P4).

## 7. Access control (ADR-5): rule-based roles with hard boundaries

**Owner's steer, clarified for implementation:** rule-based access through the in-app AccessGate. Cross-tenant boundaries are enforced at the database layer with RLS. Role and relationship boundaries are enforced below the UI by a mandatory AccessGate that scopes every Prisma query and point action. This is not optional application hygiene: every list/write path must pass the gate, every gate rule gets matrix tests, and any route/use case without an explicit action/resource declaration fails closed.

### 7.1 The permission matrix

| Role | Scope | May |
|---|---|---|
| OwnerAdmin | tenant | Everything tenant-wide: parties, engagements, ledger, settlements, config, all dashboards |
| Coach | tenant-direct or an organization | Own clients only — sessions, plans, evaluations, photos; own accruals/payslips. Never another coach's roster or rates; never the tenant ledger |
| OrgAdmin | organization | Enroll/manage own members; view own assigned coaches; read-only member progress. Never pricing internals, other orgs, tenant finances |
| Client (phase 2) | self | Own progress, plan, photos |

### 7.2 One gate, two layers (P6 applied to authorization)

Every decision flows through a single object, constructed once per request from the resolved session:

```typescript
export interface AccessGate {
  can(
    principal: Principal, action: AccessAction, resource: ResourceRef,
  ): Promise<boolean>;

  // Returns a Prisma query-args fragment (a `where` clause + any joins needed),
  // NOT an in-memory filter — callers spread this into their prisma.model.findMany(...).
  scopeQuery<T extends AccessScoped>(
    principal: Principal, modelName: T,
  ): Prisma.Args<T, 'findMany'>['where'];
}
```

*`can`* answers point checks ("may this coach confirm this payment?") and is the only authority — no Server Action or Route Handler checks roles ad hoc. *`scopeQuery`* is the list-shaping half, and it matters more than it looks: coaches' and orgs' list screens must be filtered **in the Prisma query**, not post-filtered in memory, or pagination lies and data leaks into logs. Implementation composes **specification functions** per role (`coachOwnClientsSpec`, `orgMembersSpec` — plain functions returning a Prisma `where` fragment) into the final predicate — each specification unit-testable in isolation, no ORM required to test the logic.

*Division of labor between the layers (deliberate):* the **database guarantees the tenant wall** (RLS, stable rule, belongs in SQL); the **gate guarantees the room walls** (role rules, will churn with the product, belongs in TypeScript where tests and reviews are cheap). Deny-by-default: zero assignments ⇒ zero access; a Server Action that fails to declare its action/resource pair fails closed in the integration suite. If role/relationship rules become too numerous to reason about in matrix tests, the correct response is to simplify product sharing rules or explicitly revise this ADR.

### 7.3 Authentication and multi-role experience

Auth.js (NextAuth) v5 with a Credentials provider and JWT sessions, because Auth.js does not support Credentials sign-in with database sessions. `user_account` and adapter tables are platform-wide because one identity may later have roles in several tenants; tenant context begins at `RoleAssignment`. Passwords use Argon2id; five failed attempts lock an account for 15 minutes, and unknown, locked, and invalid credentials have one generic outcome. Middleware is only an early cookie-presence redirect; every protected layout, Server Action, and Route Handler calls `auth()` server-side as the authoritative check. Assignments are resolved **server-side per request** by querying `RoleAssignment` fresh, not baked into the session token — a revoked coach loses access immediately, which matters when off-boarding mid-dispute. Organization onboarding is invite-based: the owner issues a single-use expiring link binding (tenant, org, OrgAdmin); the org sets credentials and self-manages thereafter — the mechanism that removes the owner as enrollment bottleneck. "Acting as" is a UI context (a client-side selector persisted to a cookie) over the same permission union — it changes which dashboard renders, never what the gate will authorize.

### 7.4 Authorization boundary decision

The AccessGate is the single authorization boundary for role and relationship rules. New sharing requirements must be represented as explicit AccessGate actions/specifications with matrix tests, or rejected/deferred if they make the access model too hard to reason about.

## 8. Money architecture (ADR-4): ledger, commission engine, settlement

### 8.1 Design commitments

**Append-only double-entry ledger as the single source of financial truth.** `LedgerEntry` (immutable journal transaction, causal reference to its trigger) → ≥2 `LedgerLine`s summing to zero, enforced in the domain *and* by a deferred DB trigger (P6). No update, no delete; refunds and corrections are reversing entries referencing the original. This is what makes "why exactly ₹X to this coach in March?" a one-query answer a year later — the property no running-total column can offer, and the substrate of dispute-proof payslips.

**Confirmation as an abstraction — the entire phase-2 payment migration in one interface:**

```typescript
export interface PaymentConfirmationSource {
  // MVP: manualConfirmationSource — a human confirms, with UTR/screenshot proof
  // P2:  gatewayConfirmationSource — Razorpay webhook (a Route Handler), signature-verified
  awaitConfirmation(id: PaymentRecordId): Promise<PaymentConfirmation>;
}
```

The Razorpay webhook, when phase 2 arrives, is necessarily a Next.js **Route Handler** (`/app/api/webhooks/razorpay/route.ts`) rather than a Server Action — Server Actions are only invokable from within the app's own React tree, but a webhook is called by an external system over plain HTTP. This is the one place the "Server Actions are the API layer" simplification (§4) doesn't apply, and it's flagged here deliberately so it isn't a surprise mid-implementation.

Everything downstream of `PaymentConfirmed` — posting, accrual, settlement, payslip — is confirmation-source-blind. Fee-bearer is tenant config stamped per payment (default: tenant; flip to client-pays later without schema change).

### 8.2 The flow, end to end (MVP)

1. Payment due → app displays the **owner's** `PayoutHandle` (UPI/QR/phone); client pays out-of-band. The system is recorder/facilitator, not money-mover — no aggregator burden, which is why Razorpay was consciously deferred.
2. Owner (or permission-gated coach) records + confirms a `PaymentRecord` with proof.
3. `PaymentConfirmed` raises in-process; the **posting handler** books (client receivable ↓ / owner cash ↑) in the same transaction.
4. The **commission handler** (same UoW) runs the engine → `CommissionAccrual` rows for the owner's retained cut and a balanced entry that credits owner commission income and coach payable. **Terminology is fixed:** commission = owner's retained cut; coach payable = gross payment minus owner commission.
5. Settlement: owner reviews payables (derived from ledger), pays via UPI, records+confirms payout; system books it and issues the immutable `Payslip` — gross, per-accrual detail, cut, net.
6. Refund/correction: reversing entries; commission claw-back per tenant config (PRD open decision — mechanism supports either answer).

### 8.3 The commission engine — Strategy + the clock

```typescript
export interface CommissionStrategy {
  compute(payment: ConfirmedPayment, edge: Engagement, clock: EngagementClock): CommissionResult;
}

export const percentageWithLifespanWindow: CommissionStrategy = {
  compute(payment, edge, clock) {
    const windowEnd = clock.anchor.add({ months: edge.commissionLifespan.value });
    const inWindow = payment.date.isBefore(windowEnd);
    const cut = inWindow ? payment.amount.multiply(edge.commissionRate) : Money.inr(0);
    return { cut, rateApplied: edge.commissionRate, withinLifespan: inWindow, snapshotOf: edge };
  },
};
```

**`ClientEngagementClock`** is the small-but-critical state: per (client, engagement, coach-assignment), the window anchor = first confirmed payment date, created lazily on first payment. Without it, per-client flexible lifespans are unimplementable; with it, the window test is one comparison. Coach reassignment is therefore modeled as history (`ClientCoachAssignment`), not just a mutable field on `Client`, because money attribution and access must be explainable for any past date. **Snapshot rule:** rate and window outcome are frozen into the accrual — later edits to engagement terms or coach assignment must never rewrite history. New commission shapes (flat fee, tiered, promo-period) = new strategy classes registered per engagement type; the engine iterates "applicable engagements," so a future multi-hop revival is a resolver change, not an engine rewrite. This is P3 in its most consequential location.

## 9. Media & privacy architecture (progress photos)

Highest-sensitivity data in the system: body imagery of private individuals. Treated as a security domain, not an upload feature. Azure Blob, **private container**, per-tenant path prefix, encrypted at rest; DB stores `MediaAsset` metadata only. **Every read is brokered**: a Server Action authorizes via `AccessGate` (visibility = the client's role-scoped chain per §7.1) then issues a **short-lived SAS URL** (minutes) via the Azure Storage SDK; no durable direct link exists anywhere, and no `<img src>` ever points straight at a blob URL. Consent is not a boolean footnote: consent is versioned and auditable (`ConsentRecord`) with purpose, capture source, captured_by, granted/withdrawn timestamps, and policy version. `Client.photo_consent` may remain only as a denormalized current-state convenience. Evaluation photos are explicitly linked to evaluations (`EvaluationPhoto`) so photo compare, deletion markers, and audit trails are not inferred from loose client-level assets. Deletion honored: blob deleted, metadata tombstoned, evaluation keeps a "photo removed" marker (auditability without retention). Uploads size/type-validated client-side and re-validated server-side, then **re-encoded server-side (EXIF/GPS stripped)** using `sharp` inside the Route Handler that receives the upload. DPDP-posture checklist (consent, purpose limitation, deletability) is a launch-blocking review item, matching the PRD risk register.

## 10. Extensibility mechanics — how "add a step" stays a config change

### 10.1 The lifecycle as a configurable stage pipeline (State + Strategy + registry)

The client lifecycle (enroll+baseline → assign coach+timings → sessions ↔ periodic evaluations → payment/renewal) is data, not code: a per-tenant **`WorkflowDefinition`** = ordered stages, each naming a **registered step type** + per-stage config.

```typescript
export interface LifecycleStep {
  readonly stepType: string;                        // "baseline-intake", "coach-assignment", ...
  enter(ctx: ClientWorkflowContext, cfg: StepConfig): Promise<StepResult>;
  complete(ctx: ClientWorkflowContext, cfg: StepConfig): Promise<StepResult>;
  validate(cfg: StepConfig): ValidationResult;        // config sanity at definition time
}

// Steps register into a plain lookup map — the "registry" is just an object literal,
// no reflection/DI container needed for something this small.
export const lifecycleSteps: Record<string, LifecycleStep> = {
  'baseline-intake': baselineIntakeStep,
  'coach-assignment': coachAssignmentStep,
  // new steps are added here, existing entries untouched — P3 in practice
};
```

Client state machines advance against their tenant's definition. Adding "nutrition consultation" between baseline and assignment for one tenant = (new small step class if genuinely new behavior) + one definition row; zero edits to existing steps. *Honest scope note:* this is configuration selecting among **registered** behaviors — a fully generic user-authored workflow engine was considered and rejected as speculative (YAGNI); if a future tenant demands authoring, the definition table is already the substrate.

### 10.2 In-process domain events (Observer/Mediator — deliberately not a broker)

`ClientEnrolled`, `SessionLogged`, `EvaluationRecorded`, `EvaluationDue`, `PaymentConfirmed`, `SubscriptionLapsed`, `SettlementIssued` — dispatched in-process (MediatR-style). Handlers enlist **in the same transaction** where consistency demands (ledger posting) and **post-commit** where it doesn't (notifications, dashboard projections). New cross-cutting behavior — "alert the org admin when a member's evaluation is overdue" — is a new handler; emitting code untouched (P3). Escape hatch, named but unbuilt: a transactional-outbox table feeding a queue if any handler ever genuinely needs durable async — a local upgrade, not a re-architecture.

### 10.3 Patterns inventory — pattern → location → requirement served

| Pattern | Where | Problem it solves here |
|---|---|---|
| Modular monolith | §12 | One-transaction correctness now; extraction seams later |
| Party–Role–Edge | §6 | Multi-role owner; org-as-bulk-client; relationship churn |
| Aggregate + invariant-in-constructor value objects | §6.1–6.2 | Illegal states unrepresentable (Money, Percentage, DateRange) |
| Double-entry append-only ledger | §8 | Provable money; payslips that show their work; refunds as reversals |
| Strategy | Commission; assessments; notification channels | Per-tenant variability without edits (P4) |
| State + configurable pipeline + step registry | §10.1 | "Add a workflow step" as config (owner's meta-requirement) |
| Observer/Mediator in-process events | §10.2 | Extend by adding handlers (P3), zero infra |
| Specification | AccessGate `ScopeQuery` | Role scoping composed into SQL, unit-testable |
| Repository + Unit of Work | Prisma repository classes in `/packages/db` + `withTenant`/`$transaction` | Domain + ledger in one commit (P1) |
| Facade / Ports | `AccessGate`, `PaymentConfirmationSource`, `MeasurementSource`, `MediaStore`, `NotificationChannel` (TS interfaces) | Single choke points; every P5 substitution |
| Snapshot-at-write | Accruals, evaluation deltas, payslips | Historical facts immune to later edits |
| Factory methods on aggregates | `Engagement.Create`, `LedgerEntry.Post` | Invariants enforced at birth (self-loop guard, balance-to-zero) |
| Outbox (deferred) | Event dispatch | Durable async — named now, built only on evidence |

## Part III — System view & cross-cutting

## 11. Feature-wise architectural treatment

**Network & people:** Network module; Party/RoleAssignment/Engagement aggregates; invite flows; per-edge terms UI backed by value-object validation. Scalability note: pure CRUD at trivial volume; correctness risk is duplicate/overlapping engagements — guarded by aggregate invariant + unique partial index.
**Organization self-serve:** OrgAdmin role + invite; ScopeQuery specs; member enrollment writes ordinary Clients with org parent — zero parallel code path (the bulk-client dividend).
**Sessions & plans:** ClientLifecycle module; single-POST session write (<60s mobile bar); plan versioning. Scale note: highest-write table; index `(tenant_id, coach, date)`; JSONB exercises against catalog to avoid join fan-out on the hot write.
**Evaluations & progress:** cadence schedules + due-date job (hosted worker); deltas snapshotted; photo pipeline per §9. Scale note: charts read per-client slices — `(tenant_id, client_id, evaluated_at)` covers.
**Money:** Money module exactly as §8; property-based tests are the primary defense (see §13.4).
**Dashboards:** owner god-view is read-only projections over the same DB (no separate read store — ADR-1b); exception surfacing (lapsed, overdue, unsettled) computed by the worker into small summary tables refreshed on events — cheap CQRS-lite without infrastructure.
**Platform/SaaS:** separate schema; tenant provisioning seeds default WorkflowDefinition + config; platform billing isolated from tenant money vocabulary end-to-end.
**Notifications:** channel adapters behind a `NotificationChannel` interface (email day-one; SMS/WhatsApp as adapters when approved) driven purely by event handlers.

## 12. Runtime & module map

**One Next.js deployable (`/apps/web`) + one small companion worker process (`/apps/worker`, §4)** — two deployables total, the one deliberate exception to "one deployable" in this stack, scoped and justified in ADR-1. Modules live as sub-folders of `/packages/application`, boundary-enforced by `dependency-cruiser`/`eslint-plugin-boundaries` (public `index.ts` barrel exports + domain events only; no cross-module internals):

**Identity&Access · Network · ClientLifecycle · Money · Media · Platform · Notifications**

Money never reads ClientLifecycle tables directly — it reacts to events with IDs. These seams are the decomposition lines if ever needed, and the argument for why they won't be for years.

**Repository structure discipline:** keep the repo intentionally small, but do not flatten the boundaries that protect correctness. `/apps/web` owns routes, Server Actions, UI composition, and request/session wiring only. `/apps/worker` owns scheduled/background entry points only. `/packages/db` owns Prisma schema, migrations, RLS helpers, `withTenant()`, tenant-scoped Prisma clients, and repository implementations. `/packages/domain` owns framework-free entities, aggregates, value objects, and pure rules. `/packages/application` owns use cases, `AccessGate`, `can()`, `scopeQuery()`, workflows, and ports. `/packages/ui` owns shared presentation components only. `/packages/config` owns shared tooling config only. No new package is added without a named boundary and an import rule.

**Repo hygiene gate:** generated and machine-local artifacts (`.turbo/`, `*.tsbuildinfo`, `.DS_Store`, dependency folders) are not source architecture and must stay out of commits. Simplification means pruning noise and enforcing imports, not merging domain, database, application, and Next.js concerns into one folder.

## 13. Cross-cutting concerns

**13.1 Performance posture:** at ceiling (~15k coaches, ~50–150k clients) peak write load is low tens/sec — one Postgres with headroom. Deliberately not pre-scaling; App Insights measures, replicas/cache added only against observed load. Real risks at this size are query quality (N+1 — Prisma query logging enabled in CI against a query-count budget per route, review gates) and photo bandwidth (offloaded to Blob/SAS by design).
**13.2 Reliability:** zone-redundant Postgres, PITR 35d, blob soft-delete+versioning; RTO 4h / RPO 15m — proportionate to a business-hours SaaS, revisited at first external tenant.
**13.3 Auditability:** append-only `AuditLog` for every money and access-sensitive action, written by the AccessGate and Money module — the single-choke-point design's payoff.
**13.4 Testing strategy (risk-weighted):** ledger + commission get property-based tests (entries always balance; Σ accruals = Σ applicable cuts; window boundaries at exact month edges) plus golden scenarios mirroring the owner's real cases (mixed prices, mixed lifespans, org one-time payment, refund reversal). AccessGate gets a full (role × action × ownership) matrix including the multi-role owner. RLS gets integration tests attempting cross-tenant reads under a non-bypass role asserting zero rows. Pipeline: per-step units + definition-driven integration.
**13.5 Security implementation gates:** password authentication uses a memory-hard hash (Argon2id preferred; bcrypt acceptable only with reviewed cost settings), database-backed sessions use secure/httpOnly/sameSite cookies, and login/invite/upload/sensitive mutation endpoints are rate-limited. Invite tokens are high-entropy, stored only as hashes, consumed once inside a transaction, and expire by default. Upload handlers enforce size limits, server-side MIME validation, malware posture appropriate to the deployment, and `sharp` re-encoding to strip EXIF/GPS. Secrets live only in environment/managed secret storage. The app database role must not own tables and must not have `BYPASSRLS`; migrations run with a separate privileged role. Audit payloads must redact secrets, credentials, raw tokens, and unnecessary health/media metadata.

## 14. Decision log (consolidated)

| ADR | Decision | Trade-off knowingly accepted |
|---|---|---|
| 1 | Next.js full-stack + Postgres/Prisma, App Service (rev.) | One extra deployable (worker process) for scheduled jobs; RLS session var needs careful `SET LOCAL` handling under pooling |
| 1b | Modular monolith; no broker/microservices/search | Decomposition deferred to module seams |
| 2 | Pooled tenancy; EF filters + RLS (P6) | Shared-instance neighbors; RLS session plumbing |
| 3 | Party–Role–Edge core | One extra join vs. naive tables |
| 4 | Append-only double-entry ledger; confirmation-source port | Ceremony vs. running totals — bought: provability |
| 5 | Single AccessGate; roles in TypeScript, tenant wall in RLS | Role rules not DB-enforced (deliberate: churn lives where tests are cheap) |
| 6 | Manual-first payments; tenant-owned gateway accounts in P2 | Human confirmation step until P2 |

## Part IV — The build plan

## 15. Five-level implementation plan

Ordering logic: each level is one coherent feature category; each stands only on the levels beneath it; each ends **demonstrable** — something the owner can click, judge, and correct, which is how requirement churn gets caught early instead of at the end. Access enforcement is Level 1, not a hardening pass, because retrofitting boundaries is how systems leak.

### Level 1 — Foundation: tenancy, identity, roles, access (the trust base)
*Everything else is built on this; nothing above it ships without it.*
Scope: monorepo skeleton following §12 repository structure discipline (packages, `dependency-cruiser` boundary rules, repo hygiene, CI); Postgres + Prisma with the tenant-scoping Client Extension, RLS policies + the `withTenant` transaction wrapper; tenant provisioning (seed config + default WorkflowDefinition); Auth.js with Credentials provider + database sessions; `Party`, `RoleAssignment`, `Engagement` aggregates with value objects; `AccessGate` (`can` + `scopeQuery` with specification functions); invite flows (coach; organization single-use expiring link); audit log skeleton; "acting as" context plumbing.
Exit criteria: RLS cross-tenant test suite green; full permission-matrix tests green including the owner-is-also-org-coach case; static/import checks prove app code cannot import the unscoped Prisma client; security gates in §13.5 are implemented for auth and invites; an owner can create a tenant, invite a coach and an organization, and each logs into a correctly scoped (empty) world.

### Level 2 — Network & client onboarding (the business map)
*The WhatsApp roster, replaced.*
Scope: coach management with per-edge terms (custom rate + lifespan, value-object validated, overlap-guarded); organization accounts + OrgAdmin self-serve member enrollment; client enrollment (by owner/coach/org) with custom pricing, coach assignment, timings/schedule; **baseline intake** — body composition (manual `MeasurementSet`), posture, photo capture behind explicit consent, with the full §9 media pipeline (private blob, brokered SAS, EXIF strip) built *now*, not deferred; subscription records (term, price, status); workflow pipeline v1 (definition table + `ILifecycleStep` registry + the enrollment stages).
Exit criteria: owner sees his real network in-app; org enrolls members with zero owner involvement; a client exists with baseline + consent-gated photos visible to exactly the right three roles and no one else.

### Level 3 — Training operations (the daily-use loop)
*What coaches open every day; adoption is won or lost here.*
Scope: session logging (single-POST, <60s mobile flow, exercise catalog + JSONB); workout plans with day-wise versioning; evaluation schedules (weekly/biweekly/monthly per client) + hosted-worker due-date computation; evaluation capture (measurements, posture, photos) with **snapshotted deltas** vs. baseline and prior; progress views (metric timelines, side-by-side photo compare); satisfaction capture (both modes behind tenant config); reminder notifications (email adapter) via `EvaluationDue`/`SubscriptionLapsed` handlers.
Exit criteria: a coach runs a full week — log sessions, get evaluation reminders, record an evaluation, show a client their delta — entirely in-app; the <60s logging bar measured, not assumed.

### Level 4 — Money (the trust engine)
*Sequenced fourth deliberately: it needs Levels 1–3's engagements, subscriptions, and confirmed real usage — and it is the highest-correctness module, built when the domain around it has stabilized.*
Scope: `PayoutHandle`s; payment recording + `ManualConfirmationSource` (UTR/screenshot proof); append-only ledger (entries/lines, balance trigger); `PaymentConfirmed` posting handler; commission engine (`PercentageWithLifespanWindow` + `ClientEngagementClock`, snapshot rule); accruals; payables view; settlement flow + payout confirmation; immutable payslip generation (server-side PDF to blob); refund/correction reversals with configurable claw-back; org one-time agreement payment through the same pipeline; coach earnings view (own accruals + payslips only).
Exit criteria: golden-scenario suite green (mixed prices, mixed lifespans, window-edge months, refunds, org payment); property tests green; a full month simulated — payments in, cuts computed, settlement out, payslips that show their work; the owner can answer "why this number?" from the app alone.

### Level 5 — Holistic experience & platform (the SaaS layer)
*Turns a working tool into a product.*
Scope: owner god-view dashboard (business-at-a-glance + per-coach and per-org drill-downs) over event-refreshed summary tables; exception surfacing (lapsed subscriptions, overdue evaluations, inactive clients, unsettled payables); org read-only progress dashboard; platform-schema tenant billing + onboarding polish (second-tenant readiness = the P4 audit: zero hardcoded business rules); operational hardening — App Insights dashboards/alerts, backup restore drill, DPDP launch checklist sign-off; phase-2 seams verified by contract tests (`IPaymentConfirmationSource`, `IMeasurementSource`).
Exit criteria: the owner runs Monday morning from one screen; a second demo tenant provisions and operates with zero code changes; every phase-2 substitution point has a green contract-test suite proving the port is real.

**Dependency spine:** L1 trust base → L2 people & consented data → L3 operational truth (sessions/evaluations) → L4 money computed *from* that truth → L5 visibility over all of it. Phase-2 items (Razorpay, client login, BMI API) slot in above L5 as substitutions, exactly as designed.

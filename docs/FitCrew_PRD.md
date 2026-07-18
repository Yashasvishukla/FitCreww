# Product Requirements Document
## Coaching Business Management Platform (working name: "FitCrew")

**Version:** 1.0 (Draft for PM review)
**Date:** 18 July 2026
**Author:** Yash (requirements) — drafted with Claude
**Status:** Requirements groomed; awaiting PM validation and prioritization sign-off

---

## 1. Problem statement

Independent fitness coaching businesses today run their entire operation on WhatsApp: which coach trains which client, at what time, what was charged, what commission is owed, and how the client's body is changing over time. Nothing is queryable, nothing is auditable, and every question ("how much do I owe this coach this month?", "has this client improved since enrollment?") requires scrolling chat history or trusting memory.

The reference customer is an owner-coach who runs a team of coaches under him, takes a percentage cut of each coach's client revenue, and has institutional tie-ups (e.g., a hospital) whose members are trained by his coach team. As the business grows, the WhatsApp model breaks in three specific ways:

1. **Money is untracked.** Custom per-client pricing, per-coach commission terms, and manual settlements have no system of record. Disputes are unresolvable; payslips don't exist.
2. **Client progress is invisible.** Baseline body composition, posture, and photos are captured ad-hoc (if at all), so neither the coach nor the client can demonstrate results — the core product of a coaching business.
3. **The owner has no operational view.** He cannot see, at a glance, which coaches are serving which clients, how sessions are going, or how satisfied clients are.

We are building this first for one business, but designing it as a **multi-tenant SaaS**: any gym or coaching business can subscribe and run the same operations on its own isolated instance.

## 2. Product vision

**The operating system for coaching businesses.** One place where an owner runs their coach network, their institutional partnerships, their money, and — most importantly — the visible proof that their clients are getting results.

## 3. Personas

### 3.1 Owner / Admin ("Rajesh", owner-coach)
Runs the business. Has 5–50 coaches under him, plus institutional tie-ups. He is himself a practicing coach (including, sometimes, for a partner organization). He collects all client payments, retains his percentage cut, and routes the remainder to his coaches.
- **Needs:** a god-view of the whole operation; effortless commission math; payment records that survive disputes; proof of client results he can use to sell.
- **Success looks like:** "I stopped using WhatsApp for operations. Settlement day went from an evening of arithmetic to five minutes of review."

### 3.2 Coach ("Priya", trainer under the owner)
Trains a roster of clients — her own and/or those of a partner organization she is assigned to. Paid by the owner after his cut.
- **Needs:** her client list, session logging that takes seconds, her clients' progress data, and transparent visibility into her own earnings and payslips.
- **Success looks like:** "I log a session in under a minute and I always know exactly what I'll be paid and why."

### 3.3 Organization admin ("Hospital wellness coordinator")
Point of contact at a partner institution. Manages which of their members are enrolled, sees those members' progress at a summary level.
- **Needs:** self-serve enrollment of their members (the owner must not be a data-entry bottleneck), a scoped dashboard of only their coaches, members, and progress.
- **Success looks like:** "I enroll our members myself and can show my leadership a progress report without asking anyone."

### 3.4 Client ("Amit", end customer) — *phase 2 login*
The person being trained. In MVP he does not log in; he is tracked. In phase 2, he gets a self-serve view of his own transformation.

### 3.5 Platform operator (us)
Bills tenants on a subscription. Out of scope for tenant-facing features but shapes multi-tenancy requirements throughout.

**Key modeling note for all personas:** identity and role are separate. One person can hold multiple roles at once (the reference owner is Admin of the tenant *and* a Coach assigned to a partner organization). The product must support an "acting as" switch rather than forcing separate accounts.

## 4. Core capabilities (feature areas)

### 4.1 Network & people management
The owner's map of the business.
- Invite and manage coaches; each coach relationship carries **its own commission terms** — rate (fully custom per relationship) and **lifespan** (the window during which commission applies: 1 / 3 / 6 / 8 / 12 months — configurable).
- Enroll clients (by owner or by coach), assign a coach, set **fully custom pricing per client** (₹18k, ₹20k, ₹50k — no fixed plans).
- Create partner **Organizations** and send them a self-serve onboarding invite.
- One person, many roles: role assignments are scoped (e.g., "Coach at Organization X") and a user with multiple roles switches context in the UI.

### 4.2 Organization partnerships (B2B tie-ups)
An Organization is a first-class, self-managing account inside the tenant — think "bulk client."
- Own login with a **restricted, scoped view**: only their coaches, their members, their progress.
- **Self-serve member enrollment** — this is the headline requirement. The owner invites the org once; the org manages its own roster thereafter.
- Coaches (one or several) are assigned to the org by the owner; from that point the coach↔client experience is *identical* to the direct flow — same session logging, same evaluations, same tracking. No parallel system.
- Commercially: the org makes a **one-time payment** to the owner per the partnership agreement (recorded in the ledger like any inflow).

### 4.3 Client lifecycle & progress tracking
The product's emotional core: making transformation visible.
- **Enrollment baseline:** structured intake at day zero — body composition (weight, body fat %, muscle, BMI — manual entry from the BMI machine in MVP), posture assessment, and **photographs** of current state.
- **Session logging:** the coach records each actual training session — date, time, client, exercises given. This is the granular "who trained whom, when, and what" record replacing WhatsApp. Must be fast enough to do from a phone between sessions (< 60 seconds).
- **Workout plans:** the prescribed day-wise program, distinct from sessions (plan = intended; session = what happened).
- **Periodic evaluations:** on a **configurable cadence** (weekly / biweekly / monthly), capture fresh measurements and photos; the system computes and displays deltas against baseline and prior evaluations. Due-evaluation reminders surface to the coach.
- **Progress views:** timeline charts of each metric; side-by-side photo comparison.
- **Satisfaction signal:** a lightweight client-satisfaction indicator feeding the owner's dashboard. *(Open decision 8.1: per-session rating vs. periodic check-in.)*

> **Privacy is a feature here, not a footnote.** Progress photos are sensitive body imagery. Requirements: explicit consent captured at enrollment; photos stored access-controlled and visible only within the client's role-scoped chain (their coach, the owner, their org if applicable); deletable on request. A leak of body photos is the worst failure this product can have — treat as a launch-blocking requirement.

### 4.4 Money: pricing, collection, commission, payout
The flow, precisely: **client pays the owner directly → owner retains his percentage cut → owner routes the remainder to the coach.** The owner is the single collection hub.

MVP is **record-and-facilitate, not money-moving**:
- Each payee (owner; coaches for payouts) stores payment handles: UPI ID, phone number, and/or QR code image.
- When a client owes, the app surfaces the owner's UPI/QR; the client pays bank-to-bank outside the app; owner (or coach on his behalf) **marks the payment received**, optionally attaching a UTR reference or screenshot as proof.
- The **ledger** (double-entry, internal) records the inflow, computes the split per that coach's commission terms — respecting the commission lifespan window per client — and shows the coach-payable balance. **Terminology decision:** `commission` means the owner's retained cut; coach payable means gross client payment minus owner commission.
- **Settlement:** owner reviews payables, pays each coach via UPI, marks settled; the system generates a **payslip** per coach per period: gross client revenue, commission cut, net paid — the transparency artifact that prevents disputes.
- Payment-processing fees: borne by the tenant by default; **configurable** so a tenant can later pass fees to clients (config field now, behavior later).
- Subscription lifecycle: start date, duration, renewal state, and lapse visibility ("this client's subscription expired 5 days ago"). *(Open decision 8.2 on renewal/refund handling.)*

**Phase 2 — automated payments:** Razorpay integration replaces manual confirmation with gateway confirmation (Route-style collection/splits; RazorpayX-style payouts). **Design constraint the PM must hold the line on:** the ledger is the source of truth in both phases; Razorpay only changes *how a payment gets confirmed*. No MVP feature may assume manual payment in a way that breaks when automation arrives.

### 4.5 Owner's holistic dashboard
The reason the owner opens the app every morning.
- Business at a glance: active clients, sessions this week, revenue collected, payables outstanding, evaluations due/overdue.
- Per-coach drill-down: roster, session activity, client progress, satisfaction, earnings.
- Per-organization drill-down: members, assigned coaches, engagement, agreement status.
- Exception surfacing over raw data: lapsed subscriptions, overdue evaluations, inactive clients, unsettled payables.

### 4.6 Roles, access & trust boundaries
- Four roles: **Owner/Admin** (full tenant), **Coach** (own clients only: their sessions, plans, measurements; own earnings/payslips; *never* another coach's clients, rates, or the tenant ledger), **Organization** (own members/coaches, read-only progress, self-serve enrollment), **Client** (phase 2).
- Access enforced below the UI — a non-negotiable engineering requirement the PM should treat as acceptance criteria on every feature ("as a coach, I cannot retrieve another coach's client by any means"). Tenant isolation is enforced in PostgreSQL RLS; role/relationship isolation is enforced by the application AccessGate in every query and verified by integration tests. The AccessGate is the implementation boundary.
- **Tenant isolation is absolute.** No data path crosses tenants. This is what makes the SaaS sellable.

### 4.7 Platform subscription (SaaS layer)
- Tenant onboarding, platform-plan billing of tenants, tenant-level configuration (commission defaults, evaluation cadence defaults, fee-bearer setting).
- Kept strictly separate from in-tenant money: "platform subscription" (tenant pays us) vs. "client subscription" (client pays their coach's business) are different objects and must never share UI or vocabulary.

## 5. Scope

### 5.1 MVP (phase 1)
| # | Capability | Notes |
|---|---|---|
| 1 | Tenant + Owner onboarding | Single reference tenant acceptable at launch; multi-tenant model from day one |
| 2 | Coach management + custom commission terms (rate + lifespan) | Per-relationship |
| 3 | Client enrollment + custom pricing + coach assignment + timings | By owner or coach |
| 4 | Enrollment baseline: body comp (manual), posture, photos + consent | Privacy controls launch-blocking |
| 5 | Session logging by coach | < 60s mobile-friendly flow |
| 6 | Workout plans (day-wise) | Prescribed program |
| 7 | Periodic evaluations, configurable cadence + progress deltas + photo compare | Reminders for due evaluations |
| 8 | Manual payment flow: UPI/QR display, mark-received + proof, ledger, split computation, settlement, payslips | Owner as collection hub |
| 9 | Organization accounts: invite, scoped login, self-serve member enrollment, coach assignment, org dashboard | Headline B2B feature |
| 10 | Owner holistic dashboard + exception surfacing | |
| 11 | Role-based AccessGate enforcement + strict tenant isolation | Acceptance criteria on everything |

### 5.2 Phase 2 (committed, not started)
- Razorpay integration (collection + automated payouts + webhook-confirmed ledger entries)
- Client login: self-serve progress view (photos, charts, plan)
- Fee pass-through to client (activate the config)
- BMI machine API integration (replace manual entry)

### 5.3 Explicitly out of scope (for now)
- Multi-level commission chains (structure is flat: owner → coach, one hop)
- Diet/nutrition planning, wearables, class/group bookings
- Marketing website builder, lead-gen CRM

## 6. Non-functional requirements (PM-relevant)
- **Scale target:** design for 10,000–15,000 coaches across tenants; launch load is 50–100 coaches. Nothing in the product should require redesign between those two points.
- **Flexibility as a requirement:** the client lifecycle must be a configurable sequence of stages so a new step (e.g., nutrition check) is a configuration/extension, not a rebuild. Requirement churn is expected; the product should absorb added workflows cheaply.
- **Mobile-first for coaches and org admins** (they live on phones); desktop-friendly for the owner's dashboard.
- **Auditability:** every money event and every access-sensitive action is traceable (who, what, when).
- **India-first:** ₹ formatting, UPI-native payment UX, India data-privacy posture (DPDP Act) especially for photos and health-adjacent data.

## 7. Success metrics
- **North star:** % of the reference business's weekly operations conducted in-app instead of WhatsApp (target: >90% within 8 weeks of launch).
- Session-logging adoption: ≥80% of actual sessions logged, per coach.
- Evaluation compliance: ≥70% of due evaluations completed within their window.
- Settlement time: owner's monthly commission settlement < 30 minutes, zero disputes attributable to missing records.
- Org self-service: 100% of org member enrollments performed by the org, not the owner.
- Phase-2 gate: first external tenant signed = validation of the SaaS thesis.

## 8. Open product decisions and implementation decisions
1. **Satisfaction capture:** per-session quick rating (high signal, risk of fatigue) vs. periodic check-in (lighter, coarser)?
2. **Renewals, lapses, refunds:** grace period on lapse? Is a refund in the manual flow a ledger correction the owner records, and does it claw back the coach's commission?
3. **Duplicate identity:** can one real person exist as a client in two contexts (e.g., direct + via hospital)? Recommend: one person record, multiple enrollments.
4. **Commission lifespan semantics — implementation decision:** the clock runs per client-coach assignment/engagement from first confirmed payment. This requires assignment history, not only a mutable current coach field.
5. **Evaluation ownership:** can the owner perform/override an evaluation for any client, or is it coach-only?
6. **Org agreement renewals:** the one-time payment — literally once ever, or once per agreement term?

## 9. Risks
| Risk | Impact | Mitigation |
|---|---|---|
| Coaches don't adopt logging (WhatsApp habit) | Data hollow, dashboard worthless | <60s flow; payslip transparency as the coach's personal incentive to be in-app |
| Photo privacy incident | Trust-destroying, possibly legal | Consent + AccessGate-scoped reads + private blob storage + deletion; launch-blocking review |
| Manual payment records drift from reality | Ledger loses trust | Proof attachment (UTR/screenshot), owner review step, easy corrections with audit trail |
| Single-customer overfit | SaaS thesis fails | Everything configurable per tenant (rates, cadences, fees); no hardcoded business rules |
| Scope creep before MVP ships | Never launches | This document's MVP table is the contract; new asks go to phase 2 list by default |

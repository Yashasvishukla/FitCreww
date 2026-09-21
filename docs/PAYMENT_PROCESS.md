# Payment Process

## At a glance

```text
Client payment -> Owner/business account -> Owner confirmation
                                         -> Commission calculation
                                         -> Coach payable balance
                                         -> Owner payout to coach -> Payslip
```

FitCrew intentionally does not treat a client payment as a payment directly to a coach. The client pays the owner/business. The owner keeps the commission defined for that coach relationship and pays the remaining coach amount in a separate, recorded settlement.

## 1. Coach collects a payment from a client

1. The coach opens **Money** and selects the client's active subscription.
2. The coach starts a payment for the subscription amount. The standard flow opens Razorpay checkout; a local development-only mock checkout is also supported.
3. FitCrew creates a **pending client-subscription payment**. Its parties are:
   - **Payer:** the client
   - **Payee:** the owner/business
4. The client completes checkout. FitCrew confirms the record only after either the verified Checkout callback (including a server-side captured-payment fetch) or a signed `payment.captured` webhook. An owner cannot substitute a UTR or screenshot to confirm a Razorpay record.

The coach may initiate the collection, but the money is collected for the owner/business account. A coach cannot confirm their own client-payment record.

## 2. Owner verifies and confirms the client payment

1. The owner reviews payment status in **Money**.
2. For Razorpay payments, FitCrew verifies the order, payment ID, signature, and captured status before confirmation. For the exceptional legacy manual mode, an owner must provide a valid UTR/reference or screenshot proof.
3. FitCrew changes the record to **confirmed**, records who confirmed it and when, and writes an audit-log event.
4. A balanced ledger entry records that cash has been received by the owner/business.

Only confirmation creates an earning for the coach. A pending payment is not part of the coach's payable balance.

## 3. Commission and coach payable calculation

On confirmation, FitCrew finds the client's current coach and that coach's active commission agreement with the owner. It snapshots the agreed commission rate and commission lifespan so later agreement edits cannot change historical earnings.

For a payment of `P` within the commission window:

```text
Owner commission = P × agreed commission rate
Coach payable    = P − owner commission
```

For example, if a client pays ₹10,000 and the agreed commission is 20%:

```text
Owner commission = ₹2,000
Coach payable    = ₹8,000
```

The commission window starts from the client’s first confirmed payment for that coach assignment and lasts for the configured number of calendar months. A payment confirmed before the window ends receives the agreed commission. Once the window has expired, the owner commission is ₹0 and the full payment becomes coach payable.

Each result is stored as an immutable **commission accrual** linked to the specific client payment. The earnings screen shows its gross amount, commission, and net coach amount.

## 4. Owner pays the coach

1. The owner opens **Earnings** and sees each coach's outstanding payable balance.
2. The owner selects a coach, a settlement period, and a payout method (UPI, QR, phone, or other).
3. FitCrew creates a draft **settlement** containing all confirmed, unsettled accruals for that coach in the selected period. It also creates a pending `coach_payout` payment from the owner to the coach.
4. The owner sends the actual payment to the coach using the coach's saved payout handle where applicable.
5. The owner enters the payout UTR/reference (or proof) and confirms the settlement.
6. FitCrew marks the payout as confirmed, reduces the coach-payable ledger balance, records the owner-cash outflow, marks the settlement **paid**, and generates an immutable PDF payslip.

The coach can view their own earnings and payslips. The owner can view all coach payables and settlements.

## 5. Refunds and corrections

Confirmed payments are never edited or deleted. If a client is refunded, the owner posts a separate correction linked to the original payment.

- The original client payment is marked **reversed**.
- The system creates a negative commission accrual for the next settlement.
- The amount clawed back from the coach follows the tenant's configured refund clawback rate.
- Any part not clawed back from the coach is recorded as owner refund-absorption expense.

This preserves a complete, auditable trail: original payment, correction, commission impact, settlement, payout, and payslip.

## Important controls

- Client payments and coach payouts start as **pending**; confirmation is required before they affect financial balances.
- Only an owner/admin can confirm client payments, create coach settlements, and confirm coach payouts.
- Payment records, commission snapshots, settlements, and issued payslips are immutable financial history.
- Every financial action is tenant-scoped and audit logged.

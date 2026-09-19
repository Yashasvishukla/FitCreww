# Razorpay collection requirement

**Priority:** first payment-platform requirement.

All new client-side collections initiated by a coach must use Razorpay Checkout. A payment is financially confirmed only after FitCrew verifies a Razorpay signature and/or a signed `payment.captured` webhook, validates the order and amount, and posts the immutable internal ledger entry.

Client subscriptions must support both upfront and monthly collection. For example, a 6-month INR 6,000 coaching package can be either one INR 6,000 upfront Razorpay checkout or six monthly INR 1,000 Razorpay checkouts. Coach payout accruals are created only from confirmed client collections, so monthly client intake produces monthly coach payables instead of forcing the admin to pay the full 6-month coach share at once.

Each payment flow must preserve:

- authorization: a coach may initiate collection only for an assigned client; an OwnerAdmin or the verified gateway webhook may confirm it;
- tenant isolation: order metadata, payment lookup, database query scope, and row-level security must all bind to the same tenant;
- evidence and auditability: gateway order/payment IDs, confirmation source, actor, timestamps, and the ledger posting must be retained;
- replay safety: duplicate callbacks or webhooks cannot create a second confirmed payment or ledger entry;
- secret safety: Razorpay API and webhook secrets remain server-only.

Manual UPI/QR/phone payment recording is legacy/manual mode. It must not become the collection path for new coach-initiated client payments where Razorpay is enabled.

Production readiness requires real Razorpay credentials, a configured webhook secret and endpoint, webhook delivery/retry monitoring, and automated security/isolation coverage.

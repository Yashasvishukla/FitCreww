# DPDP launch checklist

This is the launch evidence checklist for FitCrew's India-first privacy posture. It is an operational control record, not legal advice. The privacy owner must complete the owner/date/sign-off fields before production launch.

| Control | Evidence in this repository | Owner | Status | Sign-off date |
| --- | --- | --- | --- | --- |
| Purpose limitation for progress photos and health-adjacent measurements | `ConsentRecord` stores purpose, policy version, capture source, actor, and timestamps; media reads are gate-brokered. | Privacy owner | Pending | |
| Explicit consent before photo capture | Client enrollment and media pipeline require consent; withdrawn consent is recorded append-only. | Product owner | Pending | |
| Data minimisation | Dashboard/profile projections select only role-visible fields; logs exclude client names and photo/proof content. | Engineering | Pending | |
| Access control and tenant isolation | AccessGate, tenant Prisma extension, transaction-local RLS, and cross-tenant integration tests. | Security owner | Pending | |
| Deletion request handling | Media deletion tombstones metadata and removes the private blob; evaluation history retains only the removal marker. | Engineering | Pending | |
| Retention and backup policy | PostgreSQL PITR target: 35 days; Blob soft-delete/versioning required; restore drill in `scripts/backup-restore-drill.sh`. | Operations | Pending | |
| Breach response | App Insights failure/dependency alerts and correlation IDs are enabled; incident runbook must be linked in the deployment environment. | Security owner | Pending | |
| Processor/subprocessor review | Azure PostgreSQL, Blob Storage, App Service, email provider, and any measurement/payment gateway require vendor review and DPA records. | Legal/privacy owner | Pending | |
| Data subject request workflow | Verify identity, locate tenant-scoped records, export/delete within the approved SLA, and append an audit record. | Support owner | Pending | |

## Release gate

Production release is blocked until every `Pending` row has an owner, evidence link, and sign-off date. Never place raw photos, screenshot proofs, passwords, invite tokens, or unnecessary health data in logs or support tickets.

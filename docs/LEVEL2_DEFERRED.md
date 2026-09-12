# Deferred Level 2 follow-ups

These are intentionally recorded for a later hardening pass:

1. Add database-backed route-handler tests using the CI test database (unit coverage for navigation and authorization is now present).
2. Execute the documented mobile browser walkthrough and add screenshot baselines once a browser runner is available in CI; see `docs/LEVEL2_MOBILE_QA.md`.

## Implemented since this list was created

- Role-aware navigation and route guards for OwnerAdmin, Coach, and OrgAdmin.
- Organization-scoped coach access: an OwnerAdmin can assign an existing tenant coach to an organization.
- Organization-scoped coach discovery for enrollment and reassignment.
- Atomic client coach reassignment: the previous assignment is closed, a new dated assignment is appended, and the action is auditable. OrgAdmins can manage clients within their organization; coaches cannot reassign clients.

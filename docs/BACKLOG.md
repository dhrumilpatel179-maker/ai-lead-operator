# Implementation Backlog

## Completed in vertical slice

- [x] Private responsive dashboard and lead queue.
- [x] Intake, field extraction, service/urgency classification.
- [x] Safe response drafting and explicit red block.
- [x] Edit, approve, simulated send, status update, follow-up, activity history.
- [x] Daily owner report.
- [x] Tenant-scoped demo schema and production RLS reference.
- [x] Architecture, decision record, scope, testing, deployment, and risk documentation.

## Completed in production-security milestone

- [x] Sites SIWC authentication on the dashboard and APIs.
- [x] Server-derived single-workspace membership and role context.
- [x] Viewer read-only enforcement and owner/manager/advisor write checks.
- [x] Role-aware Postgres RLS reference migration; consequential browser writes removed.
- [x] Server-side Green/Yellow/Red reclassification at approval time.
- [x] Atomic, idempotent simulated approval/send, message, lead, follow-up, and audit persistence.
- [x] Fail-closed UI/API behavior and adversarial security tests.

## Before first live customer

- [ ] Apply the Postgres RLS migration in a dedicated environment and complete independent security review.
- [ ] Provision production memberships and test account lifecycle/revocation.
- [ ] Connect one Gmail inbox with minimum OAuth scopes and encrypted tokens.
- [ ] Connect Google Calendar read/free-busy and appointment-request workflow.
- [ ] Add OpenAI structured extraction/draft adapter with policy validator and deterministic fallback.
- [ ] Add provider retry, dead-letter visibility, and provider health states when the first live provider is approved.
- [ ] Configure retention/deletion, privacy terms, consent, and incident response.
- [ ] Run all safety, failure, and cross-tenant acceptance scenarios.
- [ ] Create Stripe setup and monthly payment links; keep billing manual.

## After first-customer evidence

- [ ] Decide whether calendar booking, SMS, Google Business, multi-location, and shop-system integrations solve observed demand.
- [ ] Productize repeated onboarding rules only after at least two customers share them.
- [ ] Add self-service billing only when manual billing becomes an operational constraint.

# Implementation Backlog

## Completed in vertical slice

- [x] Private responsive dashboard and lead queue.
- [x] Intake, field extraction, service/urgency classification.
- [x] Safe response drafting and explicit red block.
- [x] Edit, approve, simulated send, status update, follow-up, activity history.
- [x] Daily owner report.
- [x] Tenant-scoped demo schema and production RLS reference.
- [x] Architecture, decision record, scope, testing, deployment, and risk documentation.

## Before first live customer

- [ ] Approve production auth/RLS architecture and complete independent security review.
- [ ] Replace demo tenant context with verified membership resolution.
- [ ] Connect one Gmail inbox with minimum OAuth scopes and encrypted tokens.
- [ ] Connect Google Calendar read/free-busy and appointment-request workflow.
- [ ] Add OpenAI structured extraction/draft adapter with policy validator and deterministic fallback.
- [ ] Add idempotency, retry, dead-letter visibility, and provider health states.
- [ ] Configure retention/deletion, privacy terms, consent, and incident response.
- [ ] Run all safety, failure, and cross-tenant acceptance scenarios.
- [ ] Create Stripe setup and monthly payment links; keep billing manual.

## After first-customer evidence

- [ ] Decide whether calendar booking, SMS, Google Business, multi-location, and shop-system integrations solve observed demand.
- [ ] Productize repeated onboarding rules only after at least two customers share them.
- [ ] Add self-service billing only when manual billing becomes an operational constraint.

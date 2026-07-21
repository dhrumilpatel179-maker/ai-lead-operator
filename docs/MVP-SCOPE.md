# MVP Scope and Non-goals

## In scope

- Responsive private owner dashboard.
- Lead pipeline and lead-detail workflow.
- Web/email-shaped inquiry intake.
- Extraction of customer, vehicle, mileage, service, symptoms, urgency, and source when present.
- Green/yellow/red authority classification.
- Editable response draft with role-authorized human approval.
- Hard block on red autonomous sending.
- Atomic, idempotent simulated outbound send, status transition, follow-up scheduling, approval/send ledger, and activity trail.
- Server-derived tenant membership, viewer restrictions, role-aware RLS reference schema, and audit model.
- Failure-mode and unauthorized-tenant tests.
- Exact interfaces for later Gmail, Calendar, OpenAI, and Stripe adapters.

## Explicit non-goals before validation

- Mechanical diagnosis or repair recommendations.
- Guaranteed pricing or completion dates.
- Live Gmail, Google Calendar, OpenAI, or Stripe credentials.
- Phone/SMS/Google Business direct integrations.
- Self-service onboarding, subscription portal, usage billing, or plan changes.
- Multi-location hierarchy, complex dispatch, parts/inventory, shop-management-system integration.
- Vector search, agent graphs, custom monitoring stacks, or distributed job infrastructure.

## First-customer acceptance gate

Do not ingest real customer information until the Postgres RLS migration is applied and tested, external-customer authentication and membership lifecycle are approved, and deletion/retention, audit access, backups, monitoring, and incident response have passed review.

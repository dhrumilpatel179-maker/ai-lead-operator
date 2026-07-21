# ADR-001: Private vertical slice before production integrations

- Status: Accepted
- Date: 2026-07-20

## Decision

Build a private, single-workspace, cloud-hosted demonstration using the existing site runtime and D1, while keeping intake, decision, sending, calendar, and persistence behind explicit boundaries. Use deterministic rules for the first safety workflow. Require Supabase/Postgres RLS or an equivalently reviewed database-enforced model before onboarding real multi-tenant customer data.

## Why

This produces a demonstrable workflow quickly without requesting credentials, taking on OAuth risk, or pretending the demo data layer satisfies the final database-level isolation requirement.

## Consequences

- A real shop can evaluate the workflow immediately with sample data.
- Real email sending, calendar access, and model calls remain disabled.
- Production onboarding has a hard security gate: reviewed external auth, RLS, tenant tests, audit retention, and provider credentials.
- D1 demo data is disposable and is not the migration source of truth for customer data.

## Rejected now

- Building a complete SaaS subscription interface.
- Adding workflow engines, vector search, observability platforms, or microservices.
- Accepting real customer data in a single hard-coded tenant context.

# Development and Deployment Environments

## Local

- Sample data only.
- Local database binding.
- No live email/calendar/model credentials.
- Simulated outbound send.

## Private demonstration

- Owner-only hosted access.
- Northstar Auto Care sample workspace.
- D1 persistence with authenticated membership and role enforcement after memberships are provisioned.
- No real customer data and no live outbound action.

## Customer production

- Separate environment and secrets from demonstration.
- Verified external-customer authentication, workspace membership provisioning, and revocation.
- Supabase Postgres RLS schema (or approved equivalent).
- Server-only Gmail, Calendar, OpenAI, and Stripe credentials.
- Automated database backups, retention/deletion jobs, incident alerts, and audit export.
- Deployment requires security acceptance and explicit approval to process customer data.

## Supabase database staging

The private manual workflow provisions and tests only the Supabase database, Auth, schema, and RLS controls. It does not deploy the application or change the private demonstration. Billing/capacity safety uses available Management API checks plus a persistent manual approval; it is not an API-guaranteed free-tier deployment. An unprivileged job requires `github.sha` to equal the explicit reviewed-commit input before the protected environment job can start. If GitHub required reviewers are unavailable, the enforced fallback is a commit-bound owner self-attestation that explicitly states no independent reviewer gate exists.

## Configuration names

Future configuration names may include `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `OPENAI_API_KEY` (server only), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, an OAuth encryption key, `STRIPE_SECRET_KEY`, and tenant-specific webhook secrets. None are required or configured for this milestone; values must never be committed.

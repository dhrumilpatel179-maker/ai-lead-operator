# Development and Deployment Environments

## Local

- Sample data only.
- Local database binding.
- No live email/calendar/model credentials.
- Simulated outbound send.

## Private demonstration

- Owner-only hosted access.
- Northstar Auto Care sample workspace.
- D1 persistence for submitted demo inquiries.
- No real customer data and no live outbound action.

## Customer production

- Separate environment and secrets from demonstration.
- Verified external authentication and workspace membership.
- Supabase Postgres RLS schema (or approved equivalent).
- Server-only Gmail, Calendar, OpenAI, and Stripe credentials.
- Automated database backups, retention/deletion jobs, incident alerts, and audit export.
- Deployment requires security acceptance and explicit approval to process customer data.

## Configuration names

`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `OPENAI_API_KEY` (server only), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, OAuth encryption key, `STRIPE_SECRET_KEY`, and tenant-specific webhook secrets. Values must never be committed.

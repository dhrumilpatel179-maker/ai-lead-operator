# AI Lead Operator

Managed lead follow-up for independent auto-repair shops. This repository contains a private, synthetic-data simulation with authenticated access, database-derived tenant membership, role-aware authorization, deterministic Green/Yellow/Red enforcement, and durable simulated-action records. It is not production-ready and does not send live messages.

## Product rule

The AI may automate routine administrative work, but it may not diagnose vehicles, provide safety-critical advice, guarantee price or completion dates, resolve disputes, or make financial/legal commitments. Green auto-send is available only when a tenant explicitly enables an approved action; it is off by default and is not connected in this repository. Yellow actions require human approval, and Red actions stay human-controlled.

## Current vertical slice

1. Select **Simulate new inquiry**.
2. Submit the realistic customer message.
3. The workflow extracts vehicle/service details and classifies urgency and authority.
4. A response draft opens with an audit trail.
5. An owner, manager, or advisor may edit and approve a non-Red draft; viewers are read-only.
6. Approval, simulated transport record, status change, simulated follow-up, and audit event commit atomically. No live message is sent.

The currently deployed demonstration is private and uses sample data. This repository revision removes the browser fallback: authentication, membership, authorization, and persistence failures now fail closed. A user must be provisioned in `tenant_memberships` before the secured revision can operate.

## Local setup

Requirements: Node.js 22.13 or newer.

```bash
npm ci
npm run db:generate
npm run dev
```

Validation:

```bash
npm run lint
npm test
npm run test:security
npm run validate:artifact
```

## Repository map

- `app/` — application routes and API endpoints
- `components/` — responsive owner dashboard and workflow UI
- `lib/` — safety classification, outbound policy, authenticated membership, and approval state machine
- `db/` — demo schema plus production Supabase/Postgres RLS reference schema
- `drizzle/` — generated demo migrations
- `docs/` — architecture, decisions, scope, security, testing, environments, backlog, and operating assumptions
- `tests/` — workflow and rendered-app tests

## Environments

- Local development: local site runtime and local D1 state.
- Private demonstration: hosted private site, sample Northstar Auto Care workspace.
- Production customer: not enabled. The Postgres RLS migration is implemented as a reference but has not been applied or independently penetration-tested.

The manual Supabase workflow in `.github/workflows/provision-supabase-staging.yml` provisions and validates a staging database only. It does not deploy this application. It requires the dispatched SHA to exactly match an explicit reviewed-commit input before protected environment access. Its cost guard combines Management API checks with a separately recorded manual approval because Supabase does not expose a documented API guarantee of account-wide free-project capacity. If GitHub required reviewers are unavailable, the documented fallback is owner self-attestation—not an independent review gate. See `docs/SUPABASE-STAGING.md`.

## Important limitation

The application is not yet approved for real customer data or live outbound messaging. The D1 runtime enforces membership and roles in server code; D1 does not provide PostgreSQL-style RLS. `db/supabase-production.sql` contains the role-aware production RLS design, immutable audit controls, and server-only consequential tables, but it still must be applied, integration-tested against Supabase Auth, reviewed independently, and operated with backups/retention/incident response.

Customer-facing pre-activation data practices are summarized in [`docs/DATA-HANDLING.md`](docs/DATA-HANDLING.md). The document explicitly distinguishes required pilot controls from controls that are already deployed.

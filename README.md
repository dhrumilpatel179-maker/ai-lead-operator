# AI Lead Operator

Managed lead follow-up for independent auto-repair shops. This repository contains the first sellable vertical slice: a responsive owner dashboard, inquiry intake, deterministic extraction and safety classification, approval-ready response drafts, simulated sending, follow-up scheduling, activity history, owner reporting, and an auditable tenant-scoped data model.

## Product rule

The AI may automate routine administrative work, but it may not diagnose vehicles, provide safety-critical advice, guarantee price or completion dates, resolve disputes, or make financial/legal commitments. Green actions may be automated, yellow actions begin with human approval, and red actions stay human-controlled.

## Current vertical slice

1. Select **Simulate new inquiry**.
2. Submit the realistic customer message.
3. The workflow extracts vehicle/service details and classifies urgency and authority.
4. A response draft opens with an audit trail.
5. Edit and approve the draft, or escalate it.
6. The lead status, next action, follow-up, activity, metrics, and daily report update.

The deployed demonstration is private and uses a single sample workspace. The D1-backed demo API stores submitted inquiries when its database is available and falls back safely to the in-browser demonstration if the binding is unavailable.

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
npm run validate:artifact
```

## Repository map

- `app/` — application routes and API endpoints
- `components/` — responsive owner dashboard and workflow UI
- `lib/` — safety classification, extraction, draft rules, and tenant context
- `db/` — demo schema plus production Supabase/Postgres RLS reference schema
- `drizzle/` — generated demo migrations
- `docs/` — architecture, decisions, scope, security, testing, environments, backlog, and operating assumptions
- `tests/` — workflow and rendered-app tests

## Environments

- Local development: local site runtime and local D1 state.
- Private demonstration: hosted private site, sample Northstar Auto Care workspace.
- Production customer: requires the credentials and production tenant-security gate listed in `docs/ASSUMPTIONS-COSTS-RISKS.md` before real customer data is accepted.

## Important limitation

The hosted demonstration is not yet approved for real customer data. Production must use the Postgres RLS model in `db/supabase-production.sql` (or an equivalently reviewed database-enforced tenant model), replace the single-tenant demo context, and connect approved email/calendar/model providers.

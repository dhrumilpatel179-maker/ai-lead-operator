# Private Supabase Database Staging

The manually dispatched GitHub Actions workflow provisions and validates only a private Supabase **database environment**. It does not build or deploy the web application, update the private demo, or connect Gmail, Calendar, OpenAI, Stripe, live messaging, or real customer data.

## What the workflow enforces

- It resolves the exact Supabase organization through the Management API.
- It rejects any programmatically visible non-Free organization plan.
- It stops when the Management API already shows two active accessible projects.
- It refuses paid-compute and high-availability creation fields.
- It requires a separately recorded, named, time-stamped manual Free-plan/capacity approval no more than 24 hours old.
- It creates a project with the exact staging-only name marker `ai-lead-operator-staging-only-synthetic`.
- It will not retrieve project keys or run privileged SQL until `SUPABASE_STAGING_PROJECT_REF` is recorded in the protected GitHub Environment and the ref, organization, region, and project-name marker all match.
- It applies the schema and database marker in one transaction, resumes safely when project creation succeeded but migration did not start, and skips an already verified migration.
- It rejects an unmarked partial schema rather than deleting or guessing.
- It validates that all three synthetic-user passwords are different and at least 20 characters.
- It paginates Auth user lookup and uploads only a redacted report.
- Every third-party GitHub Action is pinned to an immutable commit SHA.

## What is not technically guaranteed

Supabase documents an account-wide limit of two active Free projects across organizations where a user is Owner or Administrator, but the Management API does not provide a documented authoritative billing-and-capacity result that proves a new project cannot be billed. Visible organization/project metadata is therefore used as a fail-closed preflight, followed by a separately recorded manual approval. This is a strong cost control, not a technical guarantee of “free-tier only.” Supabase itself remains the final authority and may reject creation when capacity is unavailable.

## Protected environment configuration

Create the GitHub Environment `supabase-staging`, require a reviewer, and add these **secrets**:

- `SUPABASE_ACCESS_TOKEN` — a newly generated personal access token.
- `SUPABASE_ORGANIZATION_SLUG` — the exact target organization slug.
- `STAGING_OWNER_PASSWORD` — unique 20+ character password for `owner.staging@example.com`.
- `STAGING_STAFF_PASSWORD` — different unique 20+ character password for `staff.staging@example.com`.
- `STAGING_VIEWER_PASSWORD` — different unique 20+ character password for `viewer.staging@example.com`.

Add these **environment variables** for a provisioning run:

- `SUPABASE_FREE_TIER_APPROVAL` — exactly `I VERIFIED FREE PLAN AND FREE PROJECT CAPACITY`.
- `SUPABASE_FREE_TIER_APPROVED_BY` — the GitHub username of the person who checked Supabase billing and project capacity.
- `SUPABASE_FREE_TIER_APPROVED_AT` — the approval time in ISO-8601 UTC; it must be no more than 24 hours old.

Leave `SUPABASE_STAGING_PROJECT_REF` unset for the first `provision` run. That run creates only the marked project; it does not retrieve keys or run SQL. Record the returned 20-character ref as the environment variable `SUPABASE_STAGING_PROJECT_REF`, then run `resume`.

## Safe run and recovery sequence

1. Manually confirm the target organization is Free and that the account has a free active-project slot; record the three approval variables above.
2. Dispatch `operation=provision` with `CREATE SYNTHETIC STAGING PROJECT`.
3. Record the returned ref as `SUPABASE_STAGING_PROJECT_REF` in the protected environment.
4. Dispatch `operation=resume`. It verifies the recorded identity and staging marker before privileged access, then atomically applies or safely resumes the migration.
5. Use `operation=validate` for subsequent reruns. It refuses to modify an uninitialized or mismatched database.

If project creation succeeds but the job stops before the ref is recorded, rerun `provision`: the workflow finds the uniquely marked project and reports the same ref without creating another. If a non-atomic or externally created partial schema is detected, the workflow fails closed; cleanup must be reviewed and performed manually against the recorded staging ref.

## Validation scope

Hosted checks cover Supabase Auth, tenant isolation, viewer restrictions, advisor permissions, Red-action browser bypass, audit isolation/immutability, transaction rollback, policy/trigger inventory, database marker verification, and rerun safety. These checks validate the hosted database controls. They do not deploy or exercise the web application against Supabase.

# Private Supabase Database Staging

The manually dispatched GitHub Actions workflow provisions and validates only a private Supabase **database environment**. It does not build or deploy the web application, update the private demo, or connect Gmail, Calendar, OpenAI, Stripe, live messaging, or real customer data.

## What the workflow enforces

- It resolves the exact Supabase organization through the Management API.
- It rejects any programmatically visible non-Free organization plan.
- It stops when the Management API already shows two active accessible projects.
- It refuses paid-compute and high-availability creation fields.
- It requires a separately recorded, named, time-stamped manual Free-plan/capacity approval no more than 24 hours old.
- It requires a full 40-character `reviewed_commit` dispatch input and rejects the run unless it exactly equals `github.sha` in a separate job that has no protected environment or secrets.
- It then requires a second, persistent change-approval record bound to the same exact commit before any secret is injected into a command.
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

Create the GitHub Environment `supabase-staging` and restrict deployment branches to `main`. If GitHub exposes required reviewers for this private repository and plan, configure a trusted reviewer and prevent self-review where practical. Add these **secrets**:

- `SUPABASE_ACCESS_TOKEN` — a newly generated personal access token.
- `SUPABASE_ORGANIZATION_SLUG` — the exact target organization slug.
- `STAGING_OWNER_PASSWORD` — unique 20+ character password for `owner.staging@example.com`.
- `STAGING_STAFF_PASSWORD` — different unique 20+ character password for `staff.staging@example.com`.
- `STAGING_VIEWER_PASSWORD` — different unique 20+ character password for `viewer.staging@example.com`.

Add these **environment variables** for a provisioning run:

- `SUPABASE_FREE_TIER_APPROVAL` — exactly `I VERIFIED FREE PLAN AND FREE PROJECT CAPACITY`.
- `SUPABASE_FREE_TIER_APPROVED_BY` — the GitHub username of the person who checked Supabase billing and project capacity.
- `SUPABASE_FREE_TIER_APPROVED_AT` — the approval time in ISO-8601 UTC; it must be no more than 24 hours old.
- `SUPABASE_STAGING_APPROVAL_MODE` — exactly `required-reviewer` when GitHub actually enforces a required reviewer, otherwise `owner-attestation`.
- `SUPABASE_STAGING_APPROVED_COMMIT` — the exact lowercase 40-character commit SHA reviewed for the run.
- `SUPABASE_STAGING_APPROVED_BY` — GitHub username of the person recording the change approval.
- `SUPABASE_STAGING_APPROVED_AT` — ISO-8601 UTC approval time, no more than 24 hours old.
- `SUPABASE_STAGING_CHANGE_APPROVAL` — use the exact value for the selected model below.

### Approval models

When a GitHub Environment required reviewer is available and configured:

- Set `SUPABASE_STAGING_APPROVAL_MODE` to `required-reviewer`.
- Set `SUPABASE_STAGING_CHANGE_APPROVAL` to `GITHUB ENVIRONMENT REQUIRED REVIEWER IS CONFIGURED`.
- GitHub blocks the protected job until its configured reviewer approves. The workflow records the commit-bound approval metadata, but the statement alone does not prove the GitHub protection rule is configured.

When GitHub does not offer required reviewers for this private repository:

- Set `SUPABASE_STAGING_APPROVAL_MODE` to `owner-attestation`.
- Set `SUPABASE_STAGING_CHANGE_APPROVAL` to `I REVIEWED THIS COMMIT; NO INDEPENDENT REVIEWER GATE EXISTS`.
- The repository owner must review the exact commit, record the commit/username/time variables, and dispatch that exact SHA. This is an enforced, auditable self-attestation. It is **not** an independent reviewer gate and must never be described as one.

In either model, the unprivileged `reviewed-commit-gate` must pass before the `supabase-staging` environment job can start. Secrets are scoped only to the provisioner and hosted-validation steps; release and approval checks do not receive them as command environment variables.

Leave `SUPABASE_STAGING_PROJECT_REF` unset for the first `provision` run. That run creates only the marked project; it does not retrieve keys or run SQL. Record the returned 20-character ref as the environment variable `SUPABASE_STAGING_PROJECT_REF`, then run `resume`.

## Safe run and recovery sequence

1. Review the exact workflow commit and record the five staging change-approval variables above.
2. Manually confirm the target organization is Free and that the account has a free active-project slot; record the three billing approval variables above.
3. Dispatch the workflow from that exact commit with `reviewed_commit=<the same 40-character SHA>`, `operation=provision`, and `confirm_project_creation=CREATE SYNTHETIC STAGING PROJECT`.
4. Record the returned ref as `SUPABASE_STAGING_PROJECT_REF` in the protected environment.
5. Dispatch `operation=resume` with the same exact `reviewed_commit`. It verifies the recorded identity and staging marker before privileged access, then atomically applies or safely resumes the migration.
6. Use `operation=validate` with the same exact `reviewed_commit` for subsequent reruns. It refuses to modify an uninitialized or mismatched database.

If project creation succeeds but the job stops before the ref is recorded, rerun `provision`: the workflow finds the uniquely marked project and reports the same ref without creating another. If a non-atomic or externally created partial schema is detected, the workflow fails closed; cleanup must be reviewed and performed manually against the recorded staging ref.

## Validation scope

Before any provision/resume/validate command receives secrets, the repository release gate runs the complete 20-scenario pilot classification/workflow suite, the security suite, the production build, and artifact validation. The hosted phase then verifies that the reviewed Postgres migration contains and persists `escalation_reasons`, `immediate_escalation`, and every allowed `disposition` value using deterministic, conflict-safe fixtures. It also covers Supabase Auth, tenant isolation, viewer restrictions, advisor permissions, Red-action browser bypass, audit isolation/immutability, transaction rollback, policy/trigger inventory, database marker verification, rerun safety, denial of browser SELECT on the credential-bearing `provider_connections` table, and tenant-scoped access through the safe metadata function.

Every persistent synthetic lead and pending provider-connection fixture has a fixed ID and a full conflict-safe upsert; repeated `resume` and `validate` runs must neither add duplicates nor preserve stale fixture values. Pending connection fixtures contain no credential material: all envelope fields remain `NULL`, and the schema rejects partial envelopes or any non-pending row without a complete encrypted envelope. No placeholder ciphertext is inserted. A missing project region fails closed before project keys, privileged SQL, or hosted validation. The schema marker is bound to the SHA-256 hash of the exact reviewed Postgres migration, so a database initialized from a different schema revision is rejected rather than upgraded implicitly. These checks validate the repository logic and hosted database controls. They do not deploy or exercise the web application against Supabase.

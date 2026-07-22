# Private Supabase Staging

The staging database is provisioned and validated only by the manually triggered GitHub Actions workflow `Provision and validate Supabase staging`. It uses the GitHub Environment `supabase-staging`; secrets are not accepted as workflow inputs, written to the repository, included in artifacts, or printed in reports.

## Cost guard

Supabase billing is organization-level, and the Management API's old project-level `plan` field is ignored. Provisioning therefore stops unless the operator first verifies the organization is on the Free plan and enters the exact dispatch confirmation `I CONFIRM THIS ORGANIZATION IS FREE`. The request omits paid compute size and high-availability options. An existing project with the reserved name is never duplicated; later runs use the `validate` operation.

## Required environment secrets

Create the GitHub Environment `supabase-staging`, then add:

- `SUPABASE_ACCESS_TOKEN` — a newly generated Supabase personal access token; revoke the token previously shared in chat.
- `SUPABASE_ORGANIZATION_SLUG` — the target Supabase organization slug shown in its General settings/URL.
- `STAGING_OWNER_PASSWORD` — a unique password for `owner.staging@example.com`.
- `STAGING_STAFF_PASSWORD` — a unique password for `staff.staging@example.com` (mapped to the `advisor` role).
- `STAGING_VIEWER_PASSWORD` — a unique password for `viewer.staging@example.com`.

Each password should be unique, randomly generated, at least 20 characters, and used nowhere else.

## Run order

1. Verify the target Supabase organization is on the Free plan.
2. Run the workflow with `operation=provision` and confirmation `I CONFIRM THIS ORGANIZATION IS FREE`.
3. Confirm the repository tests, migration, and hosted security gate pass.
4. For later verification, run `operation=validate` with the confirmation blank.

The workflow creates only synthetic records. Gmail, Calendar, OpenAI, Stripe, live messaging, and real customer data remain disconnected.

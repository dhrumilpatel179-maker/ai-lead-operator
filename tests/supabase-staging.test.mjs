import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MANUAL_APPROVAL_TEXT,
  OWNER_ATTESTATION_TEXT,
  REQUIRED_REVIEWER_APPROVAL_TEXT,
  STAGING_MARKER,
  STAGING_PROJECT_NAME,
  SYNTHETIC_IDS,
  advisorLeadUpsert,
  findAuthUserByEmail,
  migrationDecision,
  validateExpectedProject,
  validateProvisioningPreflight,
  validateReviewedCommit,
  validateStagingChangeApproval,
  validateTestPasswords,
} from "../scripts/supabase-staging-core.mjs";

const now = new Date("2026-07-22T18:00:00.000Z");
const organization = { id: "org-id", slug: "repair-staging", plan: "free" };
const expectedRef = "abcdefghijklmnopqrst";
const reviewedCommit = "d".repeat(40);
const approval = {
  statement: MANUAL_APPROVAL_TEXT,
  approvedBy: "staging-approver",
  approvedAt: "2026-07-22T17:30:00.000Z",
};
const passwords = {
  owner: "owner-password-1234567890",
  staff: "staff-password-1234567890",
  viewer: "viewer-password-123456789",
};

test("provisioning passes only with programmatic checks and recorded approval", () => {
  const result = validateProvisioningPreflight({
    organizations: [organization], projects: [], organizationSlug: organization.slug, approval, now,
  });
  assert.equal(result.organization.id, organization.id);
  assert.equal(result.plan, "free");
  assert.equal(result.existingProject, null);
});

test("existing-project validation binds ref, organization, name marker, and region", () => {
  const projects = [{
    ref: expectedRef, name: STAGING_PROJECT_NAME, organization_id: organization.id,
    region: "us-east-2", status: "ACTIVE_HEALTHY",
  }];
  assert.equal(validateExpectedProject({ projects, organization, expectedRef, expectedRegion: "us-east-2" }).ref, expectedRef);
});

test("missing project region fails closed", () => {
  const projects = [{
    ref: expectedRef, name: STAGING_PROJECT_NAME, organization_id: organization.id,
    status: "ACTIVE_HEALTHY",
  }];
  assert.throws(
    () => validateExpectedProject({ projects, organization, expectedRef, expectedRegion: "us-east-2" }),
    /omitted the project region/,
  );
});

test("partial project-creation failure resumes by applying the atomic migration", () => {
  assert.equal(migrationDecision({
    markerTableExists: false, appTableCount: 0, policyCount: 0,
    immutableTriggerCount: 0, marker: null, schemaSha: null,
  }, "a".repeat(64)), "apply");
});

test("rerunning provision reports the marked existing project even when visible capacity is full", () => {
  const existing = {
    ref: expectedRef, name: STAGING_PROJECT_NAME, organization_id: organization.id,
    region: "us-east-2", status: "ACTIVE_HEALTHY",
  };
  const result = validateProvisioningPreflight({
    organizations: [organization],
    projects: [existing, { ref: "zyxwvutsrqponmlkjihg", name: "other", status: "ACTIVE_HEALTHY" }],
    organizationSlug: organization.slug, approval, now,
  });
  assert.equal(result.existingProject.ref, expectedRef);
});

test("wrong project reference or missing staging marker is rejected", () => {
  const projects = [{ ref: expectedRef, name: "production", organization_id: organization.id, region: "us-east-2" }];
  assert.throws(
    () => validateExpectedProject({ projects, organization, expectedRef, expectedRegion: "us-east-2" }),
    /Wrong project rejected/,
  );
});

test("weak and duplicate staging passwords are rejected", () => {
  assert.throws(() => validateTestPasswords({ ...passwords, owner: "too-short" }), /at least 20/);
  assert.throws(() => validateTestPasswords({ ...passwords, viewer: passwords.staff }), /must be different/);
  assert.doesNotThrow(() => validateTestPasswords(passwords));
});

test("rerun safety skips an already verified migration", () => {
  const schemaSha = "b".repeat(64);
  assert.equal(migrationDecision({
    markerTableExists: true, appTableCount: 10, policyCount: 12,
    immutableTriggerCount: 3, marker: STAGING_MARKER, schemaSha,
  }, schemaSha), "ready");
});

test("repeated resume is safe after the first atomic migration", () => {
  const schemaSha = "e".repeat(64);
  const empty = {
    markerTableExists: false, appTableCount: 0, policyCount: 0,
    immutableTriggerCount: 0, marker: null, schemaSha: null,
  };
  const ready = {
    markerTableExists: true, appTableCount: 10, policyCount: 12,
    immutableTriggerCount: 3, marker: STAGING_MARKER, schemaSha,
  };
  assert.equal(migrationDecision(empty, schemaSha), "apply");
  assert.equal(migrationDecision(ready, schemaSha), "ready");
  assert.equal(migrationDecision(ready, schemaSha), "ready");
});

test("repeated validate uses one deterministic conflict-safe advisor lead", () => {
  const first = advisorLeadUpsert();
  const second = advisorLeadUpsert();
  assert.deepEqual(second, first);
  assert.equal(first.body.id, SYNTHETIC_IDS.advisorLead);
  assert.match(first.path, /on_conflict=id/);
  assert.match(first.prefer, /resolution=merge-duplicates/);
  assert.deepEqual(first.body.escalation_reasons, []);
  assert.equal(first.body.immediate_escalation, false);
  assert.equal(first.body.disposition, "reply");

  const simulatedRows = new Map();
  for (const run of [first, second]) simulatedRows.set(run.body.id, run.body);
  assert.equal(simulatedRows.size, 1);
});

test("partial database schema without a marker fails closed", () => {
  assert.throws(() => migrationDecision({
    markerTableExists: false, appTableCount: 4, policyCount: 0,
    immutableTriggerCount: 0, marker: null, schemaSha: null,
  }, "c".repeat(64)), /Partial schema detected/);
});

test("Auth lookup paginates until it finds the synthetic user", async () => {
  const visited = [];
  const user = await findAuthUserByEmail(async (page) => {
    visited.push(page);
    return page === 1
      ? { users: Array.from({ length: 100 }, (_, index) => ({ email: `other-${index}@example.com` })), last_page: 2 }
      : { users: [{ id: "user-id", email: "owner.staging@example.com" }], last_page: 2 };
  }, "owner.staging@example.com");
  assert.equal(user.id, "user-id");
  assert.deepEqual(visited, [1, 2]);
});

test("third-party workflow actions are pinned to immutable SHAs", async () => {
  const workflow = await readFile(new URL("../.github/workflows/provision-supabase-staging.yml", import.meta.url), "utf8");
  const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
  assert.equal(uses.length, 3);
  for (const action of uses) assert.match(action, /^[^@]+@[0-9a-f]{40}$/);
});

test("exact reviewed commit is enforced before the protected environment job", async () => {
  assert.doesNotThrow(() => validateReviewedCommit(reviewedCommit, reviewedCommit));
  assert.throws(() => validateReviewedCommit("f".repeat(40), reviewedCommit), /does not exactly match/);
  assert.throws(() => validateReviewedCommit("main", reviewedCommit), /github.sha/);

  const workflow = await readFile(new URL("../.github/workflows/provision-supabase-staging.yml", import.meta.url), "utf8");
  const gateIndex = workflow.indexOf("reviewed-commit-gate:");
  const protectedIndex = workflow.indexOf("provision-and-validate:");
  assert.ok(gateIndex >= 0 && protectedIndex > gateIndex);
  assert.match(workflow, /reviewed_commit:[\s\S]*required: true/);
  assert.match(workflow, /test \"\$GITHUB_SHA\" = \"\$REVIEWED_COMMIT\"/);
  assert.match(workflow, /provision-and-validate:[\s\S]*needs: reviewed-commit-gate[\s\S]*environment: supabase-staging/);
  assert.doesNotMatch(workflow.slice(gateIndex, protectedIndex), /secrets\./);
  assert.doesNotMatch(workflow, /merge-base --is-ancestor/);
});

test("fallback owner approval is explicit, commit-bound, and not represented as independent", () => {
  const common = {
    actualCommit: reviewedCommit,
    reviewedCommit,
    approvedCommit: reviewedCommit,
    approvedBy: "staging-owner",
    approvedAt: "2026-07-22T17:30:00.000Z",
  };
  const fallback = validateStagingChangeApproval({
    ...common,
    mode: "owner-attestation",
    statement: OWNER_ATTESTATION_TEXT,
  }, now);
  assert.equal(fallback.independentReviewerClaimed, false);
  assert.throws(() => validateStagingChangeApproval({
    ...common,
    mode: "owner-attestation",
    statement: REQUIRED_REVIEWER_APPROVAL_TEXT,
  }, now), /no independent reviewer gate exists/);
  assert.throws(() => validateStagingChangeApproval({
    ...common,
    approvedCommit: "f".repeat(40),
    mode: "owner-attestation",
    statement: OWNER_ATTESTATION_TEXT,
  }, now), /does not match this exact commit/);
});

test("required-reviewer approval uses a distinct explicit record", () => {
  const result = validateStagingChangeApproval({
    mode: "required-reviewer",
    statement: REQUIRED_REVIEWER_APPROVAL_TEXT,
    actualCommit: reviewedCommit,
    reviewedCommit,
    approvedCommit: reviewedCommit,
    approvedBy: "staging-reviewer",
    approvedAt: "2026-07-22T17:30:00.000Z",
  }, now);
  assert.equal(result.independentReviewerClaimed, true);
});

test("hosted validation prevents duplicate persistent synthetic data", async () => {
  const hosted = await readFile(new URL("../scripts/hosted-supabase-security.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(hosted, /randomUUID/);
  assert.match(hosted, /on conflict \(id\) do update set name=excluded\.name/);
  assert.match(hosted, /on conflict \(tenant_id,user_id\) do update set role=excluded\.role/);
  assert.match(hosted, /on conflict \(id\) do update set[\s\S]*escalation_reasons=excluded\.escalation_reasons/);
  assert.match(hosted, /on conflict \(id\) do update set[\s\S]*state=excluded\.state/);
  assert.match(hosted, /on conflict \(tenant_id,correlation_id,action\) do nothing/);
  assert.match(hosted, /advisorLeadUpsert\(\)/);
  assert.match(hosted, /repeated validation created duplicate or stale advisor leads/);
  for (const id of Object.values(SYNTHETIC_IDS)) assert.match(id, /^[0-9a-f-]{36}$/);
});

test("staging gates the 20 pilot scenarios before secrets and validates the new hosted lead fields", async () => {
  const [workflow, packageJson, workflowTests, pilotTests, hosted, schema] = await Promise.all([
    readFile(new URL("../.github/workflows/provision-supabase-staging.yml", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("./workflow.test.ts", import.meta.url), "utf8"),
    readFile(new URL("./pilot-readiness.test.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/hosted-supabase-security.mjs", import.meta.url), "utf8"),
    readFile(new URL("../db/supabase-production.sql", import.meta.url), "utf8"),
  ]);
  const releaseGateIndex = workflow.indexOf("Run repository release gates");
  const protectedCommandIndex = workflow.indexOf("Provision, resume, or validate database staging");
  assert.ok(releaseGateIndex >= 0 && protectedCommandIndex > releaseGateIndex);
  assert.match(workflow.slice(releaseGateIndex, protectedCommandIndex), /npm test/);
  assert.match(packageJson.scripts.test, /tests\/workflow\.test\.ts/);
  assert.match(packageJson.scripts.test, /tests\/pilot-readiness\.test\.ts/);
  const scenarioSource = `${workflowTests}\n${pilotTests}`;
  const coveredScenarios = new Set([
    ...[...scenarioSource.matchAll(/\{ id: (\d+), message:/g)].map((match) => Number(match[1])),
    ...[...scenarioSource.matchAll(/test\("Claude scenario (\d+):/g)].map((match) => Number(match[1])),
  ]);
  assert.deepEqual([...coveredScenarios].sort((a, b) => a - b), Array.from({ length: 20 }, (_, index) => index + 1));
  for (const column of ["escalation_reasons", "immediate_escalation", "disposition"]) {
    assert.match(schema, new RegExp(`\\b${column}\\b`));
    assert.match(hosted, new RegExp(`\\b${column}\\b`));
  }
  assert.match(hosted, /pilotLeadSchemaAndFixtures: "passed"/);
  assert.match(hosted, /repositoryPilotScenarioSuite: "20\/20 passed before hosted access"/);
});

test("hosted validation inventories connector foundations without enabling connectors", async () => {
  const [hosted, schema] = await Promise.all([
    readFile(new URL("../scripts/hosted-supabase-security.mjs", import.meta.url), "utf8"),
    readFile(new URL("../db/supabase-production.sql", import.meta.url), "utf8"),
  ]);
  for (const table of [
    "provider_connections",
    "inbound_provider_events",
    "consent_records",
    "provider_send_outbox",
  ]) {
    assert.match(schema, new RegExp(`create table public\\.${table}\\b`, "i"));
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(hosted, new RegExp(`\\b${table}\\b`));
  }
  assert.match(hosted, /assert\.equal\(Number\(controlRow\.rls_tables\), 14\)/);
  assert.match(hosted, /assert\.equal\(Number\(controlRow\.connector_foundation_tables\), 4\)/);
  assert.match(hosted, /assert\.equal\(Number\(controlRow\.plaintext_token_columns\), 0\)/);
  assert.match(hosted, /connectorFoundationSchema: "passed"/);
  assert.match(hosted, /providerConnectionMetadataIsolation: "passed"/);
  assert.match(hosted, /gmail: false/);
  assert.match(hosted, /liveMessaging: false/);
});

test("provider credential envelopes are server-only and metadata is safely projected", async () => {
  const [hosted, schema] = await Promise.all([
    readFile(new URL("../scripts/hosted-supabase-security.mjs", import.meta.url), "utf8"),
    readFile(new URL("../db/supabase-production.sql", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(
    schema,
    /create policy\s+provider_connections_member_select\s+on\s+public\.provider_connections/i,
  );
  const authenticatedSelectGrants = [
    ...schema.matchAll(/grant select on([\s\S]*?)to authenticated;/gi),
  ].map((match) => match[1]);
  assert.equal(
    authenticatedSelectGrants.some((grant) => /\bpublic\.provider_connections\b/i.test(grant)),
    false,
  );
  assert.match(
    schema,
    /grant select, insert, update, delete on public\.provider_connections\s+to service_role;/i,
  );
  const projection = schema.match(
    /create or replace function public\.list_provider_connection_metadata\(\)[\s\S]*?\$\$;/i,
  )?.[0];
  assert.ok(projection, "safe provider connection metadata function is missing");
  for (const field of [
    "connection_id uuid",
    "tenant_id uuid",
    "provider text",
    "external_account_id text",
    "status text",
    "granted_scopes jsonb",
    "watch_expires_at timestamptz",
    "reconnect_required_at timestamptz",
    "revoked_at timestamptz",
    "created_at timestamptz",
    "updated_at timestamptz",
  ]) {
    assert.match(projection, new RegExp(`\\b${field.replace(" ", "\\s+")}\\b`, "i"));
  }
  for (const forbidden of [
    "credential_envelope_ciphertext",
    "credential_envelope_nonce",
    "credential_envelope_auth_tag",
    "credential_key_version",
    "gmail_history_id",
  ]) {
    assert.doesNotMatch(projection, new RegExp(`\\b${forbidden}\\b`, "i"));
  }
  assert.match(projection, /where public\.is_tenant_member\(connection\.tenant_id\)/i);
  assert.match(hosted, /provider_connections\?select=id,tenant_id,credential_envelope_ciphertext/);
  assert.match(hosted, /\[401, 403\]/);
  assert.match(hosted, /owner could read cross-tenant connection metadata/);
  assert.match(hosted, /connection metadata projection exposed an unexpected field/);
  assert.match(hosted, /provider_connection_browser_select_policies\), 0/);
  assert.match(hosted, /provider_connection_browser_select_grant, false/);
  assert.match(hosted, /provider_connection_service_access, true/);
});

test("region identity is checked before keys, privileged SQL, or hosted validation", async () => {
  const provisioner = await readFile(new URL("../scripts/provision-supabase-staging.mjs", import.meta.url), "utf8");
  const hosted = await readFile(new URL("../scripts/hosted-supabase-security.mjs", import.meta.url), "utf8");
  assert.ok(provisioner.indexOf("validateExpectedProject") < provisioner.indexOf("const migrationSql"));
  assert.ok(hosted.indexOf("validateExpectedProject({") < hosted.indexOf("/api-keys?reveal=true"));
  assert.ok(hosted.indexOf("validateExpectedProject({") < hosted.indexOf("await sql(`"));
});

test("paid-plan evidence and stale manual approvals stop provisioning", () => {
  assert.throws(() => validateProvisioningPreflight({
    organizations: [{ ...organization, plan: "pro" }], projects: [],
    organizationSlug: organization.slug, approval, now,
  }), /non-Free plan/);
  assert.throws(() => validateProvisioningPreflight({
    organizations: [organization], projects: [], organizationSlug: organization.slug,
    approval: { ...approval, approvedAt: "2026-07-20T17:30:00.000Z" }, now,
  }), /no more than 24 hours old/);
});

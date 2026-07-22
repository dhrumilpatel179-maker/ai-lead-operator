import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MANUAL_APPROVAL_TEXT,
  STAGING_MARKER,
  STAGING_PROJECT_NAME,
  findAuthUserByEmail,
  migrationDecision,
  validateExpectedProject,
  validateProvisioningPreflight,
  validateTestPasswords,
} from "../scripts/supabase-staging-core.mjs";

const now = new Date("2026-07-22T18:00:00.000Z");
const organization = { id: "org-id", slug: "repair-staging", plan: "free" };
const expectedRef = "abcdefghijklmnopqrst";
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

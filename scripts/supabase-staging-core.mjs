export const STAGING_PROJECT_NAME = "ai-lead-operator-staging-only-synthetic";
export const STAGING_MARKER = "AI_LEAD_OPERATOR_SYNTHETIC_STAGING_ONLY";
export const PROJECT_REF_PATTERN = /^[a-z]{20}$/;
export const MANUAL_APPROVAL_TEXT = "I VERIFIED FREE PLAN AND FREE PROJECT CAPACITY";
export const MANUAL_APPROVAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const REQUIRED_REVIEWER_APPROVAL_TEXT = "GITHUB ENVIRONMENT REQUIRED REVIEWER IS CONFIGURED";
export const OWNER_ATTESTATION_TEXT = "I REVIEWED THIS COMMIT; NO INDEPENDENT REVIEWER GATE EXISTS";
export const SYNTHETIC_IDS = Object.freeze({
  tenantA: "10000000-0000-4000-8000-000000000001",
  tenantB: "20000000-0000-4000-8000-000000000002",
  leadA: "10000000-0000-4000-8000-000000000101",
  leadB: "20000000-0000-4000-8000-000000000102",
  advisorLead: "10000000-0000-4000-8000-000000000103",
  immediateLead: "10000000-0000-4000-8000-000000000104",
  languageLead: "10000000-0000-4000-8000-000000000105",
  attachmentLead: "10000000-0000-4000-8000-000000000106",
  noActionLead: "10000000-0000-4000-8000-000000000107",
  draftRed: "10000000-0000-4000-8000-000000000201",
  connectionA: "10000000-0000-4000-8000-000000000301",
  connectionB: "20000000-0000-4000-8000-000000000302",
});

const inactiveStatuses = new Set(["INACTIVE", "PAUSED", "REMOVED"]);

function validateGithubUsername(value, message) {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value ?? "")) {
    throw new Error(message);
  }
}

function validateFreshUtcTimestamp(value, now, message) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value ?? "")) {
    throw new Error(`${message} must use ISO-8601 UTC`);
  }
  const timestamp = new Date(value);
  const age = now.getTime() - timestamp.getTime();
  if (!Number.isFinite(timestamp.getTime()) || age < 0 || age > MANUAL_APPROVAL_MAX_AGE_MS) {
    throw new Error(`${message} must be valid and no more than 24 hours old`);
  }
}

export function validateReviewedCommit(actualCommit, reviewedCommit) {
  if (!/^[0-9a-f]{40}$/.test(reviewedCommit ?? "")) {
    throw new Error("reviewed_commit must be an exact lowercase 40-character commit SHA");
  }
  if (!/^[0-9a-f]{40}$/.test(actualCommit ?? "")) {
    throw new Error("github.sha must be an exact lowercase 40-character commit SHA");
  }
  if (actualCommit !== reviewedCommit) {
    throw new Error("Workflow commit does not exactly match the explicitly reviewed commit");
  }
}

export function validateStagingChangeApproval(approval, now = new Date()) {
  validateReviewedCommit(approval.actualCommit, approval.reviewedCommit);
  if (approval.approvedCommit !== approval.actualCommit) {
    throw new Error("The recorded staging approval does not match this exact commit");
  }
  validateGithubUsername(approval.approvedBy, "The staging approval must record the approving GitHub username");
  validateFreshUtcTimestamp(approval.approvedAt, now, "The staging approval timestamp");
  if (approval.mode === "required-reviewer") {
    if (approval.statement !== REQUIRED_REVIEWER_APPROVAL_TEXT) {
      throw new Error("Required-reviewer mode must record that the GitHub Environment reviewer is configured");
    }
    return { mode: approval.mode, independentReviewerClaimed: true };
  }
  if (approval.mode === "owner-attestation") {
    if (approval.statement !== OWNER_ATTESTATION_TEXT) {
      throw new Error("Owner-attestation mode must explicitly record that no independent reviewer gate exists");
    }
    return { mode: approval.mode, independentReviewerClaimed: false };
  }
  throw new Error("SUPABASE_STAGING_APPROVAL_MODE must be required-reviewer or owner-attestation");
}

export function validateTestPasswords(passwords) {
  const entries = Object.entries(passwords);
  for (const [name, value] of entries) {
    if (typeof value !== "string" || value.length < 20) {
      throw new Error(`${name} must be at least 20 characters`);
    }
  }
  if (new Set(entries.map(([, value]) => value)).size !== entries.length) {
    throw new Error("All staging test passwords must be different");
  }
}

export function validateManualBillingApproval(approval, now = new Date()) {
  if (approval.statement !== MANUAL_APPROVAL_TEXT) {
    throw new Error("A separately recorded Free-plan and capacity approval is required");
  }
  validateGithubUsername(approval.approvedBy, "The billing approval must record the approving GitHub username");
  validateFreshUtcTimestamp(approval.approvedAt, now, "The billing approval timestamp");
}

export function organizationPlan(organization) {
  const candidates = [
    organization?.plan,
    organization?.subscription_plan,
    organization?.subscription?.plan,
    organization?.billing?.plan,
  ];
  const value = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  return value?.trim().toLowerCase() ?? null;
}

export function selectOrganization(organizations, slug) {
  const matches = organizations.filter((organization) => organization.slug === slug);
  if (matches.length !== 1) throw new Error("The target Supabase organization could not be resolved unambiguously");
  return matches[0];
}

export function activeVisibleProjects(projects) {
  return projects.filter((project) => !inactiveStatuses.has(String(project.status ?? "").toUpperCase()));
}

export function validateProvisioningPreflight({ organizations, projects, organizationSlug, approval, now }) {
  const organization = selectOrganization(organizations, organizationSlug);
  const plan = organizationPlan(organization);
  if (plan && plan !== "free") throw new Error(`The target organization reports a non-Free plan (${plan})`);
  const reserved = projects.filter(
    (project) => project.name === STAGING_PROJECT_NAME && projectOrganizationMatches(project, organization),
  );
  if (reserved.length > 1) throw new Error("More than one project uses the staging-only marker name");
  if (!reserved.length && activeVisibleProjects(projects).length >= 2) {
    throw new Error("The Management API shows no visible active free-project capacity");
  }
  validateManualBillingApproval(approval, now);
  return { organization, plan, existingProject: reserved[0] ?? null };
}

function projectOrganizationMatches(project, organization) {
  return project.organization_slug === organization.slug || project.organization_id === organization.id;
}

export function validateExpectedProject({ projects, organization, expectedRef, expectedRegion }) {
  if (!PROJECT_REF_PATTERN.test(expectedRef ?? "")) {
    throw new Error("SUPABASE_STAGING_PROJECT_REF must be a recorded 20-character project reference");
  }
  const project = projects.find((candidate) => candidate.ref === expectedRef);
  if (!project) throw new Error("The recorded staging project reference is not accessible");
  if (project.name !== STAGING_PROJECT_NAME) throw new Error("Wrong project rejected: staging-only project-name marker is missing");
  if (!projectOrganizationMatches(project, organization)) throw new Error("Wrong project rejected: organization does not match");
  if (typeof project.region !== "string" || !project.region.trim()) {
    throw new Error("Wrong project rejected: Supabase omitted the project region");
  }
  if (project.region !== expectedRegion) throw new Error("Wrong project rejected: region does not match");
  return project;
}

export function advisorLeadUpsert() {
  return {
    path: "leads?on_conflict=id",
    prefer: "resolution=merge-duplicates,return=representation",
    body: {
      id: SYNTHETIC_IDS.advisorLead,
      tenant_id: SYNTHETIC_IDS.tenantA,
      name: "Allowed staff write",
      email: "staff-write@example.com",
      service: "Test",
      symptoms: "Synthetic",
      urgency: "routine",
      source: "staging",
      status: "New",
      authority: "green",
      escalation_reasons: [],
      immediate_escalation: false,
      disposition: "reply",
      summary: "Synthetic advisor insert",
      next_action: "Review",
    },
  };
}

export function migrationDecision(state, expectedSchemaSha) {
  if (!state.markerTableExists && state.appTableCount === 0) return "apply";
  if (!state.markerTableExists) throw new Error("Partial schema detected without the staging migration marker; refusing automatic cleanup");
  if (state.marker !== STAGING_MARKER) throw new Error("Wrong database rejected: staging-only database marker is missing");
  if (state.schemaSha !== expectedSchemaSha) throw new Error("The hosted schema marker does not match this repository migration");
  if (state.appTableCount !== 10 || state.policyCount < 12 || state.immutableTriggerCount !== 3) {
    throw new Error("The hosted staging security inventory is incomplete");
  }
  return "ready";
}

export async function findAuthUserByEmail(listPage, email, { perPage = 100, maxPages = 100 } = {}) {
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await listPage(page, perPage);
    const users = Array.isArray(result?.users) ? result.users : [];
    const match = users.find((candidate) => candidate.email === email);
    if (match) return match;
    const lastPage = Number(result?.last_page);
    if (Number.isFinite(lastPage) ? page >= lastPage : users.length < perPage) return null;
  }
  throw new Error("Auth user lookup exceeded the pagination safety limit");
}

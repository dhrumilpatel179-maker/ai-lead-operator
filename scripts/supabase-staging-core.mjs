export const STAGING_PROJECT_NAME = "ai-lead-operator-staging-only-synthetic";
export const STAGING_MARKER = "AI_LEAD_OPERATOR_SYNTHETIC_STAGING_ONLY";
export const PROJECT_REF_PATTERN = /^[a-z]{20}$/;
export const MANUAL_APPROVAL_TEXT = "I VERIFIED FREE PLAN AND FREE PROJECT CAPACITY";
export const MANUAL_APPROVAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const inactiveStatuses = new Set(["INACTIVE", "PAUSED", "REMOVED"]);

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
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(approval.approvedBy ?? "")) {
    throw new Error("The billing approval must record the approving GitHub username");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(approval.approvedAt ?? "")) {
    throw new Error("The billing approval timestamp must use ISO-8601 UTC");
  }
  const approvedAt = new Date(approval.approvedAt);
  const age = now.getTime() - approvedAt.getTime();
  if (!Number.isFinite(approvedAt.getTime()) || age < 0 || age > MANUAL_APPROVAL_MAX_AGE_MS) {
    throw new Error("The billing approval timestamp must be valid and no more than 24 hours old");
  }
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
  if (project.region && project.region !== expectedRegion) throw new Error("Wrong project rejected: region does not match");
  return project;
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

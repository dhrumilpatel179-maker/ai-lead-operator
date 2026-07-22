import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  PROJECT_REF_PATTERN,
  STAGING_MARKER,
  STAGING_PROJECT_NAME,
  migrationDecision,
  selectOrganization,
  validateExpectedProject,
  validateProvisioningPreflight,
  validateTestPasswords,
} from "./supabase-staging-core.mjs";

const API_ROOT = "https://api.supabase.com/v1";
const REGION = process.env.STAGING_PROJECT_REGION ?? "us-east-2";
const OPERATION = process.env.STAGING_OPERATION ?? "validate";
const EXPECTED_REF = process.env.SUPABASE_STAGING_PROJECT_REF?.trim() ?? "";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required GitHub Environment value: ${name}`);
  return value;
}

const accessToken = required("SUPABASE_ACCESS_TOKEN");
const organizationSlug = required("SUPABASE_ORGANIZATION_SLUG");
const passwords = {
  STAGING_OWNER_PASSWORD: required("STAGING_OWNER_PASSWORD"),
  STAGING_STAFF_PASSWORD: required("STAGING_STAFF_PASSWORD"),
  STAGING_VIEWER_PASSWORD: required("STAGING_VIEWER_PASSWORD"),
};
validateTestPasswords(passwords);
for (const value of [accessToken, ...Object.values(passwords)]) process.stdout.write(`::add-mask::${value}\n`);

if (!["provision", "resume", "validate"].includes(OPERATION)) throw new Error(`Unsupported operation: ${OPERATION}`);

async function management(path, { method = "GET", body, expected = [200] } = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!expected.includes(response.status)) throw new Error(`Supabase Management API ${method} ${path} failed with HTTP ${response.status}`);
  return text ? JSON.parse(text) : null;
}

function resultRow(response) {
  return response?.[0]?.result?.[0] ?? response?.[0] ?? response?.result?.[0] ?? response;
}

async function sql(query, expected = [201]) {
  return management(`/projects/${EXPECTED_REF}/database/query`, { method: "POST", body: { query }, expected });
}

async function appendGithubOutput(entries) {
  if (!process.env.GITHUB_OUTPUT) return;
  const { appendFile } = await import("node:fs/promises");
  await appendFile(process.env.GITHUB_OUTPUT, Object.entries(entries).map(([key, value]) => `${key}=${value}\n`).join(""));
}

async function appendGithubSummary(markdown) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const { appendFile } = await import("node:fs/promises");
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

const [organizations, projects] = await Promise.all([management("/organizations"), management("/projects")]);
const organization = selectOrganization(organizations, organizationSlug);

if (OPERATION === "provision") {
  if (EXPECTED_REF) throw new Error("A staging project reference is already recorded; use operation=resume or validate");
  if (process.env.CONFIRM_PROJECT_CREATION !== "CREATE SYNTHETIC STAGING PROJECT") {
    throw new Error("Project creation requires the exact dispatch confirmation");
  }
  const preflight = validateProvisioningPreflight({
    organizations,
    projects,
    organizationSlug,
    approval: {
      statement: process.env.SUPABASE_FREE_TIER_APPROVAL,
      approvedBy: process.env.SUPABASE_FREE_TIER_APPROVED_BY,
      approvedAt: process.env.SUPABASE_FREE_TIER_APPROVED_AT,
    },
  });
  if (preflight.existingProject) {
    if (!PROJECT_REF_PATTERN.test(preflight.existingProject.ref ?? "")) throw new Error("Existing marked staging project has an invalid reference");
    await appendGithubOutput({ created_project_ref: preflight.existingProject.ref, ready: "false" });
    await appendGithubSummary(`## Resume required\n\nRecord \`${preflight.existingProject.ref}\` as the protected environment variable \`SUPABASE_STAGING_PROJECT_REF\`, then run \`operation=resume\`.`);
    console.log(`A marked staging project already exists. Record its ref as SUPABASE_STAGING_PROJECT_REF and run operation=resume.`);
    process.exit(0);
  }
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const random = crypto.getRandomValues(new Uint8Array(32));
  const databasePassword = `${Array.from(random, (byte) => alphabet[byte % alphabet.length]).join("")}Aa1!`;
  process.stdout.write(`::add-mask::${databasePassword}\n`);
  const created = await management("/projects", {
    method: "POST",
    body: { organization_slug: organizationSlug, name: STAGING_PROJECT_NAME, region: REGION, db_pass: databasePassword },
    expected: [200, 201],
  });
  if (!PROJECT_REF_PATTERN.test(created?.ref ?? "")) throw new Error("Supabase did not return a valid project reference");
  await appendGithubOutput({ created_project_ref: created.ref, ready: "false" });
  await appendGithubSummary(`## Project created; resume required\n\nRecord \`${created.ref}\` as the protected environment variable \`SUPABASE_STAGING_PROJECT_REF\`, then run \`operation=resume\`. No project key was retrieved and no SQL was run.`);
  console.log("Project created without retrieving keys or running SQL. Record the project ref, then run operation=resume.");
  process.exit(0);
}

validateExpectedProject({ projects, organization, expectedRef: EXPECTED_REF, expectedRegion: REGION });
let healthy = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  const currentProjects = await management("/projects");
  validateExpectedProject({ projects: currentProjects, organization, expectedRef: EXPECTED_REF, expectedRegion: REGION });
  const status = currentProjects.find((project) => project.ref === EXPECTED_REF)?.status;
  if (status === "ACTIVE_HEALTHY") { healthy = true; break; }
  if (["INACTIVE", "REMOVED", "PAUSED", "UNKNOWN"].includes(status)) throw new Error(`Staging entered a non-runnable state: ${status}`);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
if (!healthy) throw new Error("Staging did not become healthy within ten minutes");

const migrationSql = await readFile("db/supabase-production.sql", "utf8");
const schemaSha = createHash("sha256").update(migrationSql).digest("hex");
const inventory = resultRow(await sql(`
select
  (to_regclass('public.ai_lead_operator_staging_metadata') is not null) as marker_table_exists,
  (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname in
    ('tenants','tenant_memberships','leads','messages','response_drafts','approval_events','send_operations','follow_ups','audit_events','business_settings')) as app_table_count,
  (select count(*)::int from pg_policies where schemaname='public') as policy_count,
  (select count(*)::int from pg_trigger where tgname in
    ('audit_events_immutable','approval_events_immutable','send_operations_immutable') and not tgisinternal) as immutable_trigger_count;
`));
let state = {
  markerTableExists: inventory.marker_table_exists === true || inventory.marker_table_exists === "true",
  appTableCount: Number(inventory.app_table_count),
  policyCount: Number(inventory.policy_count),
  immutableTriggerCount: Number(inventory.immutable_trigger_count),
  marker: null,
  schemaSha: null,
};
if (state.markerTableExists) {
  const marker = resultRow(await sql("select environment_marker, schema_sha from public.ai_lead_operator_staging_metadata where singleton=true"));
  state = { ...state, marker: marker.environment_marker, schemaSha: marker.schema_sha };
}

const decision = migrationDecision(state, schemaSha);
if (OPERATION === "validate" && decision !== "ready") throw new Error("The staging schema is not initialized; run operation=resume");
if (decision === "apply") {
  const wrapped = `begin;\n${migrationSql}\ncreate table public.ai_lead_operator_staging_metadata (\n  singleton boolean primary key default true check (singleton),\n  environment_marker text not null,\n  schema_sha text not null check (schema_sha ~ '^[0-9a-f]{64}$'),\n  applied_at timestamptz not null default now()\n);\nalter table public.ai_lead_operator_staging_metadata enable row level security;\nrevoke all on public.ai_lead_operator_staging_metadata from anon, authenticated;\ninsert into public.ai_lead_operator_staging_metadata (singleton, environment_marker, schema_sha) values (true, '${STAGING_MARKER}', '${schemaSha}');\ncommit;`;
  await sql(wrapped);
}

const verified = resultRow(await sql("select environment_marker, schema_sha from public.ai_lead_operator_staging_metadata where singleton=true"));
if (verified.environment_marker !== STAGING_MARKER || verified.schema_sha !== schemaSha) throw new Error("Post-migration staging marker verification failed");
await appendGithubOutput({ project_ref: EXPECTED_REF, project_url: `https://${EXPECTED_REF}.supabase.co`, ready: "true" });
console.log(decision === "apply" ? "Atomic staging migration applied and verified." : "Existing staging migration and marker verified; no schema changes were made.");

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  STAGING_MARKER,
  findAuthUserByEmail,
  selectOrganization,
  validateExpectedProject,
  validateTestPasswords,
} from "./supabase-staging-core.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment value: ${name}`);
  return value;
}

const managementRoot = "https://api.supabase.com/v1";
const projectRef = required("SUPABASE_PROJECT_REF");
const projectUrl = required("SUPABASE_PROJECT_URL");
const expectedProjectRef = required("SUPABASE_EXPECTED_PROJECT_REF");
const accessToken = required("SUPABASE_ACCESS_TOKEN");
const organizationSlug = required("SUPABASE_ORGANIZATION_SLUG");
const credentials = {
  owner: { email: "owner.staging@example.com", password: required("STAGING_OWNER_PASSWORD"), role: "owner" },
  staff: { email: "staff.staging@example.com", password: required("STAGING_STAFF_PASSWORD"), role: "advisor" },
  viewer: { email: "viewer.staging@example.com", password: required("STAGING_VIEWER_PASSWORD"), role: "viewer" },
};
validateTestPasswords(Object.fromEntries(Object.entries(credentials).map(([name, account]) => [name, account.password])));
assert.equal(projectRef, expectedProjectRef, "Workflow output does not match the recorded staging project reference");

for (const value of [accessToken, organizationSlug, ...Object.values(credentials).map((c) => c.password)]) {
  process.stdout.write(`::add-mask::${value}\n`);
}

async function request(url, options = {}, expected = [200]) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!expected.includes(response.status)) {
    throw new Error(`${options.method ?? "GET"} request failed with HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function management(path, method = "GET", body, expected = [200]) {
  return request(`${managementRoot}${path}`, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, expected);
}

async function sql(query, expected = [201]) {
  return management(`/projects/${projectRef}/database/query`, "POST", { query }, expected);
}

function keyValue(entry) {
  return entry?.api_key ?? entry?.key ?? entry?.value ?? "";
}

// Re-bind to the recorded project reference and verify the staging-only
// project marker before retrieving privileged API keys.
const [organizations, projects] = await Promise.all([management("/organizations"), management("/projects")]);
const organization = selectOrganization(organizations, organizationSlug);
validateExpectedProject({
  projects,
  organization,
  expectedRef: expectedProjectRef,
  expectedRegion: process.env.STAGING_PROJECT_REGION ?? "us-east-2",
});

const apiKeys = await management(`/projects/${projectRef}/api-keys?reveal=true`);
let publishableKey = keyValue(apiKeys.find((entry) => entry.type === "publishable" || entry.name === "default"));
let secretKey = keyValue(apiKeys.find((entry) => entry.type === "secret"));
publishableKey ||= keyValue(apiKeys.find((entry) => entry.type === "legacy" && entry.name === "anon"));
secretKey ||= keyValue(apiKeys.find((entry) => entry.type === "legacy" && entry.name === "service_role"));
assert.ok(publishableKey && secretKey, "Supabase API keys were not available");
process.stdout.write(`::add-mask::${publishableKey}\n::add-mask::${secretKey}\n`);

async function adminAuth(path, method, body, expected = [200]) {
  return request(`${projectUrl}/auth/v1${path}`, {
    method,
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, expected);
}

async function ensureUser(account) {
  const created = await adminAuth("/admin/users", "POST", {
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { synthetic: true, environment: "staging" },
  }, [200, 201, 422]);
  if (created?.id) return created.id;
  const user = await findAuthUserByEmail(
    (page, perPage) => adminAuth(`/admin/users?page=${page}&per_page=${perPage}`, "GET"),
    account.email,
  );
  assert.ok(user?.id, `Could not provision synthetic ${account.role} user`);
  await adminAuth(`/admin/users/${user.id}`, "PUT", { password: account.password, email_confirm: true });
  return user.id;
}

const userIds = {};
for (const [name, account] of Object.entries(credentials)) userIds[name] = await ensureUser(account);
for (const id of Object.values(userIds)) assert.match(id, /^[0-9a-f-]{36}$/i);

const tenantA = "10000000-0000-4000-8000-000000000001";
const tenantB = "20000000-0000-4000-8000-000000000002";
const leadA = "10000000-0000-4000-8000-000000000101";
const leadB = "20000000-0000-4000-8000-000000000102";
const draftRed = "10000000-0000-4000-8000-000000000201";

await sql(`
insert into public.tenants (id,name) values
  ('${tenantA}','Northstar Auto Care — Synthetic Staging'),
  ('${tenantB}','Isolation Control Tenant — Synthetic Staging')
on conflict (id) do update set name=excluded.name;
insert into public.tenant_memberships (tenant_id,user_id,role) values
  ('${tenantA}','${userIds.owner}','owner'),
  ('${tenantA}','${userIds.staff}','advisor'),
  ('${tenantA}','${userIds.viewer}','viewer')
on conflict (tenant_id,user_id) do update set role=excluded.role;
insert into public.leads
  (id,tenant_id,name,email,service,symptoms,urgency,source,status,authority,summary,next_action)
values
  ('${leadA}','${tenantA}','Synthetic Customer A','customer.a@example.com','Oil change','Routine oil change','routine','staging','New','green','Synthetic tenant A lead','Review'),
  ('${leadB}','${tenantB}','Synthetic Customer B','customer.b@example.com','Brakes','Brake noise','soon','staging','New','yellow','Synthetic tenant B lead','Review')
on conflict (id) do nothing;
insert into public.response_drafts (id,tenant_id,lead_id,body,authority,state)
values ('${draftRed}','${tenantA}','${leadA}','Guaranteed diagnosis and price','red','blocked')
on conflict (id) do nothing;
insert into public.audit_events
  (tenant_id,lead_id,actor_type,actor_id,actor_role,action,authority,target_type,target_id,correlation_id,details,event_hash)
values
  ('${tenantA}','${leadA}','system','staging-provisioner','owner','synthetic_seeded','green','lead','${leadA}','staging-seed-a','{"synthetic":true}','pending'),
  ('${tenantB}','${leadB}','system','staging-provisioner',null,'synthetic_seeded','yellow','lead','${leadB}','staging-seed-b','{"synthetic":true}','pending')
on conflict (tenant_id,correlation_id,action) do nothing;
`);

async function signIn(account) {
  const session = await request(`${projectUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  assert.ok(session.access_token, `Authentication failed for ${account.role}`);
  return session.access_token;
}

const tokens = {};
for (const [name, account] of Object.entries(credentials)) tokens[name] = await signIn(account);

async function rest(token, path, method = "GET", body, expected = [200]) {
  return request(`${projectUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, expected);
}

const ownerLeads = await rest(tokens.owner, "leads?select=id,tenant_id,name&order=id");
assert.ok(ownerLeads.length >= 1 && ownerLeads.every((lead) => lead.tenant_id === tenantA), "owner crossed the tenant boundary");
const viewerLeads = await rest(tokens.viewer, "leads?select=id,tenant_id");
assert.ok(viewerLeads.length >= 1 && viewerLeads.every((lead) => lead.tenant_id === tenantA));

await rest(tokens.viewer, "leads", "POST", {
  tenant_id: tenantA, name: "Blocked viewer write", email: "blocked@example.com",
  service: "Test", symptoms: "Synthetic", urgency: "routine", source: "staging",
  status: "New", authority: "green", summary: "Must not persist", next_action: "None",
}, [401, 403]);

const advisorCreated = await rest(tokens.staff, "leads", "POST", {
  tenant_id: tenantA, name: "Allowed staff write", email: "staff-write@example.com",
  service: "Test", symptoms: "Synthetic", urgency: "routine", source: "staging",
  status: "New", authority: "green", summary: "Synthetic advisor insert", next_action: "Review",
}, [201]);
assert.equal(advisorCreated[0]?.tenant_id, tenantA);

await rest(tokens.owner, "response_drafts", "POST", {
  tenant_id: tenantA, lead_id: leadA, body: "Attempted browser bypass", authority: "green", state: "pending",
}, [401, 403]);
const redDraft = await rest(tokens.owner, `response_drafts?id=eq.${draftRed}&select=authority,state`);
assert.deepEqual(redDraft, [{ authority: "red", state: "blocked" }]);

const ownAudits = await rest(tokens.owner, "audit_events?select=tenant_id,event_hash,previous_event_hash&order=created_at");
assert.ok(ownAudits.length >= 1 && ownAudits.every((event) => event.tenant_id === tenantA));
assert.match(ownAudits[0].event_hash, /^[0-9a-f]{64}$/);
await rest(tokens.owner, "audit_events?correlation_id=eq.staging-seed-a", "PATCH", { action: "tampered" }, [401, 403]);

await sql("update public.audit_events set action='tampered' where correlation_id='staging-seed-a'", [400, 422, 500]);
await sql(`do $$ begin
  insert into public.tenants (name) values ('ROLLBACK-SENTINEL');
  raise exception 'intentional rollback verification';
end $$;`, [400, 422, 500]);
const rollbackCheck = await sql("select count(*)::int as count from public.tenants where name='ROLLBACK-SENTINEL'");
const rollbackRow = rollbackCheck[0]?.result?.[0] ?? rollbackCheck[0];
assert.equal(Number(rollbackRow.count), 0, "failed transaction persisted data");

const controls = await sql(`
select
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity and c.relname in ('tenants','tenant_memberships','leads','messages','response_drafts','approval_events','send_operations','follow_ups','audit_events','business_settings'))::int as rls_tables,
  (select count(*) from pg_policies where schemaname='public')::int as policies,
  (select count(*) from pg_trigger where tgname in ('audit_events_immutable','approval_events_immutable','send_operations_immutable') and not tgisinternal)::int as immutable_triggers,
  (select environment_marker from public.ai_lead_operator_staging_metadata where singleton=true) as staging_marker;
`);
const controlRow = controls[0]?.result?.[0] ?? controls[0];
assert.equal(Number(controlRow.rls_tables), 10);
assert.ok(Number(controlRow.policies) >= 12);
assert.equal(Number(controlRow.immutable_triggers), 3);
assert.equal(controlRow.staging_marker, STAGING_MARKER);

const report = {
  generatedAt: new Date().toISOString(),
  baselineCommit: process.env.BASELINE_COMMIT,
  project: { name: process.env.STAGING_PROJECT_NAME, region: process.env.STAGING_PROJECT_REGION, status: "ACTIVE_HEALTHY" },
  syntheticAccounts: Object.values(credentials).map(({ email, role }) => ({ email, role })),
  tests: {
    authentication: "passed", tenantIsolation: "passed", viewerRestriction: "passed",
    staffWritePolicy: "passed", redDraftBrowserBypass: "passed",
    auditReadIsolationAndImmutability: "passed", transactionRollback: "passed",
    rlsPolicyAndTriggerInventory: "passed",
  },
  integrations: { gmail: false, calendar: false, openai: false, stripe: false, liveMessaging: false, realCustomerData: false },
};
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/supabase-staging-report.json", `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log("Hosted Supabase security tests passed; the uploaded report contains no credentials or project keys.");

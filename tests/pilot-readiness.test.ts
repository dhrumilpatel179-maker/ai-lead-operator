import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("Green authority is explicitly opt-in and off by default", async () => {
  const [dashboard, authority] = await Promise.all([
    source("../components/lead-operator-dashboard.tsx"),
    source("../docs/AI-AUTHORITY.md"),
  ]);
  assert.doesNotMatch(dashboard, /Auto-send permitted/);
  assert.match(dashboard, /Auto-send is available only when explicitly enabled; off by default/);
  assert.match(authority, /Auto-send is off by default/);
});

test("dashboard language consistently identifies simulation and disconnected live sending", async () => {
  const dashboard = await source("../components/lead-operator-dashboard.tsx");
  assert.match(dashboard, /Live sending is disconnected/);
  assert.match(dashboard, /No live message was sent/);
  assert.match(dashboard, /Response simulations approved/);
  assert.doesNotMatch(dashboard, />Responses sent</);
  assert.doesNotMatch(dashboard, />Approve & send/);
});

test("Yellow and Red escalation reasons persist and render visibly", async () => {
  const [schema, migration, route, dashboard] = await Promise.all([
    source("../db/schema.ts"),
    source("../drizzle/0003_absent_quicksilver.sql"),
    source("../app/api/inquiries/route.ts"),
    source("../components/lead-operator-dashboard.tsx"),
  ]);
  assert.match(schema, /escalationReasonsJson/);
  assert.match(migration, /escalation_reasons_json/);
  assert.match(route, /escalationReasonsJson: JSON\.stringify\(lead\.escalationReasons\)/);
  assert.match(dashboard, /Why this needs attention/);
  assert.match(dashboard, /lead\.escalationReasons\.map/);
});

test("customer-facing data handling summary covers every required topic without claiming deployment", async () => {
  const document = await source("../docs/DATA-HANDLING.md");
  for (const heading of [
    "Minimum data access",
    "Retention and deletion",
    "Support access",
    "Subprocessors",
    "Incident response",
  ]) assert.match(document, new RegExp(`## ${heading}`));
  assert.match(document, /not approved for real customer data or live messaging/i);
  assert.match(document, /not a claim that these controls are already deployed/i);
});

test("production schema carries escalation reason and handling fields", async () => {
  const sql = await source("../db/supabase-production.sql");
  assert.match(sql, /escalation_reasons jsonb not null default '\[\]'::jsonb/);
  assert.match(sql, /immediate_escalation boolean not null default false/);
  assert.match(sql, /disposition text not null default 'reply'/);
});

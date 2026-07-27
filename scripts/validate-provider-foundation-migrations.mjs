import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const migrationDirectory = new URL("../drizzle/", import.meta.url);

async function apply(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS local_migration_journal (
      tag TEXT PRIMARY KEY NOT NULL
    );
  `);
  const filenames = (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  let applied = 0;
  for (const filename of filenames) {
    const tag = filename.replace(/\.sql$/, "");
    if (database.prepare(
      "SELECT 1 FROM local_migration_journal WHERE tag = ?",
    ).get(tag)) continue;
    const sql = (await readFile(new URL(filename, migrationDirectory), "utf8"))
      .replaceAll("--> statement-breakpoint", "");
    database.exec("BEGIN");
    try {
      database.exec(sql);
      database.prepare(
        "INSERT INTO local_migration_journal (tag) VALUES (?)",
      ).run(tag);
      database.exec("COMMIT");
      applied += 1;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  return { applied, total: filenames.length };
}

const database = new DatabaseSync(":memory:");
const first = await apply(database);
const second = await apply(database);
assert.equal(first.applied, first.total);
assert.equal(second.applied, 0);

for (const table of [
  "provider_connections",
  "inbound_provider_events",
  "consent_records",
  "provider_send_outbox",
]) {
  assert.ok(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table), `missing D1 table ${table}`);
}

const connectionColumns = database.prepare(
  "PRAGMA table_info('provider_connections')",
).all().map((row) => String(row.name));
assert.equal(
  connectionColumns.some((name) => /(^|_)(access|refresh)_?token($|_)/i.test(name)),
  false,
);

const postgres = await readFile(
  new URL("../db/supabase-production.sql", import.meta.url),
  "utf8",
);
for (const table of [
  "provider_connections",
  "inbound_provider_events",
  "consent_records",
  "provider_send_outbox",
]) {
  assert.match(postgres, new RegExp(`create table public\\.${table}\\b`, "i"));
  assert.match(postgres, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
}
assert.doesNotMatch(postgres, /\b(access_token|refresh_token)\b/i);
assert.doesNotMatch(
  postgres,
  /create policy\s+provider_connections_member_select\s+on\s+public\.provider_connections/i,
);
assert.match(
  postgres,
  /create or replace function public\.list_provider_connection_metadata\(\)/i,
);
assert.match(
  postgres,
  /grant select, insert, update, delete on public\.provider_connections\s+to service_role;/i,
);
assert.match(postgres, /unique \(connection_id, external_event_id\)/i);
assert.match(postgres, /unique \(tenant_id, idempotency_key\)/i);
assert.match(postgres, /unique \(tenant_id, approval_id\)/i);
assert.match(postgres, /approved body hash is immutable/i);
assert.match(postgres, /needs_reconciliation/i);

console.log(
  `Validated ${first.total} D1 migrations, zero-op rerun safety, and the Postgres connector-foundation controls.`,
);

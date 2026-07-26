import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import test from "node:test";
import {
  D1ProviderFoundationRepository,
  type D1DatabaseLike,
  type D1ResultLike,
  type D1StatementLike,
  type EnqueueProviderSendInput,
} from "../db/provider-foundation-repository.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-07-26T12:00:00.000Z";
const LATER = "2026-07-26T13:00:00.000Z";
const RETENTION = "2026-08-26T12:00:00.000Z";

class SqliteStatementAdapter implements D1StatementLike {
  private values: Array<string | number | null> = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
  ) {}

  bind(...values: Array<string | number | null>): D1StatementLike {
    const bound = new SqliteStatementAdapter(this.database, this.query);
    bound.values = values;
    return bound;
  }

  async first<T>(): Promise<T | null> {
    return (this.statement().get(...this.values) as T | undefined) ?? null;
  }

  async run(): Promise<D1ResultLike> {
    return this.runSync();
  }

  runSync(): D1ResultLike {
    const result = this.statement().run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  private statement(): StatementSync {
    return this.database.prepare(this.query);
  }
}

class SqliteD1Adapter implements D1DatabaseLike {
  constructor(readonly database: DatabaseSync) {}

  prepare(query: string): D1StatementLike {
    return new SqliteStatementAdapter(this.database, query);
  }

  async batch(statements: D1StatementLike[]): Promise<D1ResultLike[]> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        assert.ok(statement instanceof SqliteStatementAdapter);
        return statement.runSync();
      });
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function applyMigrations(database: DatabaseSync): number {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS local_migration_journal (
      tag TEXT PRIMARY KEY NOT NULL
    );
  `);
  let applied = 0;
  for (const filename of readdirSync(new URL("../drizzle/", import.meta.url))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    const tag = filename.replace(/\.sql$/, "");
    const exists = database.prepare(
      "SELECT 1 FROM local_migration_journal WHERE tag = ?",
    ).get(tag);
    if (exists) continue;
    const migration = readFileSync(new URL(`../drizzle/${filename}`, import.meta.url), "utf8")
      .replaceAll("--> statement-breakpoint", "");
    database.exec("BEGIN");
    try {
      database.exec(migration);
      database.prepare("INSERT INTO local_migration_journal (tag) VALUES (?)").run(tag);
      database.exec("COMMIT");
      applied += 1;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  return applied;
}

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  assert.equal(applyMigrations(database), 5);
  return database;
}

function seedTenant(database: DatabaseSync, tenantId: string): void {
  database.prepare(
    "INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?)",
  ).run(tenantId, `Tenant ${tenantId}`, NOW);
}

function seedApprovedChain(
  database: DatabaseSync,
  input: { tenantId: string; suffix: string; hash?: string },
): {
  connectionId: string;
  leadId: string;
  draftId: string;
  approvalId: string;
  hash: string;
} {
  const connectionId = `connection_${input.suffix}`;
  const leadId = `lead_${input.suffix}`;
  const draftId = `draft_${input.suffix}`;
  const approvalId = `approval_${input.suffix}`;
  const hash = input.hash ?? HASH_A;
  database.prepare(`
    INSERT INTO provider_connections (
      id, tenant_id, provider, external_account_id, status, granted_scopes_json,
      credential_envelope_ciphertext, credential_envelope_nonce,
      credential_envelope_auth_tag, credential_key_version, created_at, updated_at
    ) VALUES (?, ?, 'gmail', ?, 'active', '["mail.readonly"]', ?, ?, ?, 'key-v1', ?, ?)
  `).run(
    connectionId,
    input.tenantId,
    `account_${input.suffix}`,
    `ciphertext_${input.suffix}`,
    `nonce_${input.suffix}`,
    `tag_${input.suffix}`,
    NOW,
    NOW,
  );
  database.prepare(`
    INSERT INTO leads (
      id, tenant_id, name, email, vehicle, service, symptoms, urgency, source,
      status, authority, summary, next_action, next_follow_up, created_at, updated_at
    ) VALUES (?, ?, 'Synthetic Customer', 'synthetic@example.com', 'Synthetic vehicle',
      'Oil change', 'Routine request', 'routine', 'test', 'New', 'green',
      'Synthetic lead', 'Review', ?, ?, ?)
  `).run(leadId, input.tenantId, LATER, NOW, NOW);
  database.prepare(`
    INSERT INTO response_drafts (
      id, tenant_id, lead_id, body, authority, state, created_at, updated_at
    ) VALUES (?, ?, ?, 'Synthetic approved response', 'green', 'approved', ?, ?)
  `).run(draftId, input.tenantId, leadId, NOW, NOW);
  database.prepare(`
    INSERT INTO approval_events (
      id, tenant_id, lead_id, draft_id, decision, actor_id, actor_role,
      authority, body_hash, idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, 'approved', 'owner@example.com', 'owner',
      'green', ?, ?, ?)
  `).run(
    approvalId,
    input.tenantId,
    leadId,
    draftId,
    hash,
    `approval_intent_${input.suffix}`,
    NOW,
  );
  return { connectionId, leadId, draftId, approvalId, hash };
}

function outboxInput(
  tenantId: string,
  chain: ReturnType<typeof seedApprovedChain>,
  suffix: string,
): EnqueueProviderSendInput {
  return {
    id: `outbox_${suffix}`,
    tenantId,
    connectionId: chain.connectionId,
    leadId: chain.leadId,
    draftId: chain.draftId,
    approvalId: chain.approvalId,
    idempotencyKey: `send_intent_${suffix}`,
    approvedBodyHash: chain.hash,
    nextAttemptAt: NOW,
    createdAt: NOW,
    deletionDueAt: RETENTION,
  };
}

function setup(suffix = "a") {
  const database = createDatabase();
  seedTenant(database, "tenant_a");
  seedTenant(database, "tenant_b");
  const chain = seedApprovedChain(database, { tenantId: "tenant_a", suffix });
  const repository = new D1ProviderFoundationRepository(new SqliteD1Adapter(database));
  return { database, chain, repository };
}

test("connector migration applies all schema objects", () => {
  const database = createDatabase();
  const tables = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table'
      AND name IN (
        'provider_connections','inbound_provider_events',
        'consent_records','provider_send_outbox'
      )
    ORDER BY name
  `).all().map((row) => String(row.name));
  assert.deepEqual(tables, [
    "consent_records",
    "inbound_provider_events",
    "provider_connections",
    "provider_send_outbox",
  ]);
  const triggers = database.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE type = 'trigger' AND name LIKE 'provider_outbox_%'
  `).get() as { count: number };
  assert.equal(Number(triggers.count), 5);
});

test("connector migration rerun is safe", () => {
  const database = createDatabase();
  const before = database.prepare("SELECT count(*) AS count FROM local_migration_journal").get() as { count: number };
  assert.equal(applyMigrations(database), 0);
  const after = database.prepare("SELECT count(*) AS count FROM local_migration_journal").get() as { count: number };
  assert.equal(after.count, before.count);
});

test("duplicate provider events are rejected without raw payload storage", () => {
  const { database, chain } = setup();
  const insert = database.prepare(`
    INSERT INTO inbound_provider_events (
      id, tenant_id, connection_id, provider, external_event_id, payload_hash,
      non_sensitive_metadata_json, attachment_present, attachment_count,
      received_at, deletion_due_at
    ) VALUES (?, 'tenant_a', ?, 'gmail', 'event-1', ?, '{"eventType":"message"}',
      0, 0, ?, ?)
  `);
  insert.run("event_a", chain.connectionId, HASH_A, NOW, RETENTION);
  assert.throws(
    () => insert.run("event_b", chain.connectionId, HASH_A, NOW, RETENTION),
    /UNIQUE constraint failed/,
  );
});

test("duplicate provider send intents are rejected by idempotency and approval", async () => {
  const { database, chain, repository } = setup();
  await repository.enqueueProviderSend(outboxInput("tenant_a", chain, "a"));
  const second = seedApprovedChain(database, { tenantId: "tenant_a", suffix: "second" });
  await assert.rejects(
    repository.enqueueProviderSend({
      ...outboxInput("tenant_a", second, "second"),
      idempotencyKey: "send_intent_a",
    }),
    /UNIQUE constraint failed/,
  );
  await assert.rejects(
    repository.enqueueProviderSend({
      ...outboxInput("tenant_a", chain, "approval_duplicate"),
      id: "outbox_approval_duplicate",
      idempotencyKey: "send_intent_approval_duplicate",
    }),
    /UNIQUE constraint failed/,
  );
});

test("inbound email consent defaults to reply_only", () => {
  const { database } = setup();
  database.prepare(`
    INSERT INTO consent_records (
      id, tenant_id, normalized_customer_identity, channel, source,
      evidence_metadata_json, recorded_at, updated_at
    ) VALUES ('consent_default', 'tenant_a', 'customer@example.com', 'email',
      'inbound_email', '{"synthetic":true}', ?, ?)
  `).run(NOW, NOW);
  const row = database.prepare(
    "SELECT status FROM consent_records WHERE id = 'consent_default'",
  ).get() as { status: string };
  assert.equal(row.status, "reply_only");
});

test("revoked and suppressed consent remain represented as audit history", () => {
  const { database } = setup();
  const insert = database.prepare(`
    INSERT INTO consent_records (
      id, tenant_id, normalized_customer_identity, channel, status, source,
      evidence_metadata_json, recorded_at, revoked_at, updated_at
    ) VALUES (?, 'tenant_a', 'customer@example.com', 'email', ?, 'customer_request',
      '{}', ?, ?, ?)
  `);
  insert.run("consent_revoked", "revoked", NOW, LATER, LATER);
  insert.run("consent_suppressed", "suppressed", NOW, null, LATER);
  const rows = database.prepare(`
    SELECT id, status FROM consent_records
    WHERE normalized_customer_identity = 'customer@example.com'
    ORDER BY id
  `).all().map((row) => ({ id: String(row.id), status: String(row.status) }));
  assert.deepEqual(rows, [
    { id: "consent_revoked", status: "revoked" },
    { id: "consent_suppressed", status: "suppressed" },
  ]);
});

test("provider connection schema contains no plaintext token fields", () => {
  const database = createDatabase();
  const columns = database.prepare(
    "PRAGMA table_info('provider_connections')",
  ).all().map((row) => String(row.name));
  assert.equal(columns.some((name) => /(^|_)(access|refresh)_?token($|_)/i.test(name)), false);
  assert.ok(columns.includes("credential_envelope_ciphertext"));
  assert.ok(columns.includes("credential_key_version"));
});

test("approved body hash is immutable", async () => {
  const { database, chain, repository } = setup();
  const row = await repository.enqueueProviderSend(outboxInput("tenant_a", chain, "a"));
  assert.throws(
    () => database.prepare(
      "UPDATE provider_send_outbox SET approved_body_hash = ? WHERE id = ?",
    ).run(HASH_B, row.id),
    /approved body hash is immutable/,
  );
});

test("valid outbox transitions claim, send, and persist the provider acknowledgement", async () => {
  const { chain, repository } = setup();
  const row = await repository.enqueueProviderSend(outboxInput("tenant_a", chain, "a"));
  const claim = await repository.claimNext({
    tenantId: "tenant_a",
    outboxId: row.id,
    claimToken: "worker-a",
    claimedAt: NOW,
    claimExpiresAt: LATER,
  });
  assert.equal(claim?.state, "claimed");
  assert.equal(await repository.beginSending({
    tenantId: "tenant_a",
    outboxId: row.id,
    claimToken: "worker-a",
    occurredAt: "2026-07-26T12:10:00.000Z",
  }), true);
  assert.equal(await repository.markSent({
    tenantId: "tenant_a",
    outboxId: row.id,
    claimToken: "worker-a",
    providerMessageId: "provider-message-1",
    occurredAt: "2026-07-26T12:11:00.000Z",
  }), true);
  const sent = await repository.findOutbox("tenant_a", row.id);
  assert.equal(sent?.state, "sent");
  assert.equal(sent?.providerMessageId, "provider-message-1");
});

test("illegal outbox transitions are rejected by the database", async () => {
  const { database, chain, repository } = setup();
  const row = await repository.enqueueProviderSend(outboxInput("tenant_a", chain, "a"));
  assert.throws(
    () => database.prepare(
      "UPDATE provider_send_outbox SET state = 'sent', updated_at = ? WHERE id = ?",
    ).run(LATER, row.id),
    /illegal provider outbox state transition/,
  );
  database.prepare(
    "UPDATE provider_send_outbox SET state = 'cancelled', updated_at = ? WHERE id = ?",
  ).run(LATER, row.id);
  assert.equal(await repository.claimNext({
    tenantId: "tenant_a",
    outboxId: row.id,
    claimToken: "worker-a",
    claimedAt: NOW,
    claimExpiresAt: LATER,
  }), null);
  assert.throws(
    () => database.prepare(`
      UPDATE provider_send_outbox
      SET state = 'claimed', claim_token = 'worker-a',
        claimed_at = ?, claim_expires_at = ?, updated_at = ?
      WHERE id = ?
    `).run(NOW, LATER, NOW, row.id),
    /illegal provider outbox state transition/,
  );
});

test("concurrent workers cannot hold the same valid claim", async () => {
  const { chain, repository } = setup();
  const row = await repository.enqueueProviderSend(outboxInput("tenant_a", chain, "a"));
  const claims = await Promise.all([
    repository.claimNext({
      tenantId: "tenant_a",
      outboxId: row.id,
      claimToken: "worker-a",
      claimedAt: NOW,
      claimExpiresAt: LATER,
    }),
    repository.claimNext({
      tenantId: "tenant_a",
      outboxId: row.id,
      claimToken: "worker-b",
      claimedAt: NOW,
      claimExpiresAt: LATER,
    }),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
});

test("expired pre-send claims are recovered and may be reclaimed once", async () => {
  const { chain, repository } = setup();
  const row = await repository.enqueueProviderSend(outboxInput("tenant_a", chain, "a"));
  await repository.claimNext({
    tenantId: "tenant_a",
    outboxId: row.id,
    claimToken: "worker-a",
    claimedAt: NOW,
    claimExpiresAt: "2026-07-26T12:05:00.000Z",
  });
  assert.deepEqual(
    await repository.recoverExpiredClaims("tenant_a", "2026-07-26T12:06:00.000Z"),
    { recoveredBeforeSend: 1, needsReconciliation: 0 },
  );
  const reclaimed = await repository.claimNext({
    tenantId: "tenant_a",
    outboxId: row.id,
    claimToken: "worker-b",
    claimedAt: "2026-07-26T12:06:00.000Z",
    claimExpiresAt: "2026-07-26T12:11:00.000Z",
  });
  assert.equal(reclaimed?.attemptCount, 2);
});

test("sent state is terminal and cannot return to queued", async () => {
  const { database, chain, repository } = setup();
  const row = await repository.enqueueProviderSend(outboxInput("tenant_a", chain, "a"));
  await repository.claimNext({
    tenantId: "tenant_a", outboxId: row.id, claimToken: "worker-a",
    claimedAt: NOW, claimExpiresAt: LATER,
  });
  await repository.beginSending({
    tenantId: "tenant_a", outboxId: row.id, claimToken: "worker-a",
    occurredAt: "2026-07-26T12:10:00.000Z",
  });
  await repository.markSent({
    tenantId: "tenant_a", outboxId: row.id, claimToken: "worker-a",
    providerMessageId: "provider-message-1", occurredAt: "2026-07-26T12:11:00.000Z",
  });
  assert.throws(
    () => database.prepare(
      "UPDATE provider_send_outbox SET state = 'queued', updated_at = ? WHERE id = ?",
    ).run(LATER, row.id),
    /illegal provider outbox state transition/,
  );
});

test("acknowledgement-lost sends become needs_reconciliation and are not reclaimed", async () => {
  const { chain, repository } = setup();
  const row = await repository.enqueueProviderSend(outboxInput("tenant_a", chain, "a"));
  await repository.claimNext({
    tenantId: "tenant_a", outboxId: row.id, claimToken: "worker-a",
    claimedAt: NOW, claimExpiresAt: LATER,
  });
  await repository.beginSending({
    tenantId: "tenant_a", outboxId: row.id, claimToken: "worker-a",
    occurredAt: "2026-07-26T12:10:00.000Z",
  });
  assert.equal(await repository.markAcknowledgementLost({
    tenantId: "tenant_a", outboxId: row.id, claimToken: "worker-a",
    occurredAt: "2026-07-26T12:11:00.000Z",
  }), true);
  assert.equal((await repository.findOutbox("tenant_a", row.id))?.state, "needs_reconciliation");
  assert.equal(await repository.claimNext({
    tenantId: "tenant_a", outboxId: row.id, claimToken: "worker-b",
    claimedAt: "2026-07-26T12:12:00.000Z", claimExpiresAt: LATER,
  }), null);
});

test("crash after provider success but before persistence fails closed to reconciliation", async () => {
  const { chain, repository } = setup();
  const row = await repository.enqueueProviderSend(outboxInput("tenant_a", chain, "a"));
  await repository.claimNext({
    tenantId: "tenant_a", outboxId: row.id, claimToken: "worker-a",
    claimedAt: NOW, claimExpiresAt: "2026-07-26T12:05:00.000Z",
  });
  await repository.beginSending({
    tenantId: "tenant_a", outboxId: row.id, claimToken: "worker-a",
    occurredAt: "2026-07-26T12:01:00.000Z",
  });
  assert.deepEqual(
    await repository.recoverExpiredClaims("tenant_a", "2026-07-26T12:06:00.000Z"),
    { recoveredBeforeSend: 0, needsReconciliation: 1 },
  );
  assert.equal((await repository.findOutbox("tenant_a", row.id))?.state, "needs_reconciliation");
});

test("retention and deletion timestamps are required and ordered", async () => {
  const { database, chain, repository } = setup();
  const row = await repository.enqueueProviderSend(outboxInput("tenant_a", chain, "a"));
  assert.equal(
    database.prepare("SELECT deletion_due_at FROM provider_send_outbox WHERE id = ?").get(row.id)?.deletion_due_at,
    RETENTION,
  );
  assert.throws(
    () => database.prepare(`
      INSERT INTO inbound_provider_events (
        id, tenant_id, connection_id, provider, external_event_id, payload_hash,
        received_at, deletion_due_at
      ) VALUES ('bad-retention', 'tenant_a', ?, 'gmail', 'bad-retention', ?, ?, ?)
    `).run(chain.connectionId, HASH_A, LATER, NOW),
    /CHECK constraint failed/,
  );
});

test("repository operations are tenant-isolated", async () => {
  const { chain, repository } = setup();
  const row = await repository.enqueueProviderSend(outboxInput("tenant_a", chain, "a"));
  assert.equal(await repository.findOutbox("tenant_b", row.id), null);
  assert.equal(await repository.claimNext({
    tenantId: "tenant_b", outboxId: row.id, claimToken: "worker-b",
    claimedAt: NOW, claimExpiresAt: LATER,
  }), null);
});

test("connection, lead, draft, approval, and outbox must share one tenant and chain", async () => {
  const { database, chain, repository } = setup();
  const other = seedApprovedChain(database, { tenantId: "tenant_b", suffix: "b" });
  await assert.rejects(
    repository.enqueueProviderSend({
      ...outboxInput("tenant_a", chain, "mixed"),
      connectionId: other.connectionId,
    }),
    /tenant or approval chain is invalid/,
  );
  assert.throws(
    () => database.prepare(`
      INSERT INTO provider_send_outbox (
        id, tenant_id, connection_id, lead_id, draft_id, approval_id,
        idempotency_key, approved_body_hash, next_attempt_at,
        created_at, updated_at, deletion_due_at
      ) VALUES ('outbox_direct_mismatch', 'tenant_a', ?, ?, ?, ?,
        'direct_mismatch', ?, ?, ?, ?, ?)
    `).run(
      other.connectionId,
      chain.leadId,
      chain.draftId,
      chain.approvalId,
      chain.hash,
      NOW,
      NOW,
      NOW,
      RETENTION,
    ),
    /tenant or approval chain mismatch|FOREIGN KEY constraint failed/,
  );
});

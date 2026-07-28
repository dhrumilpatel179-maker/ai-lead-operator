import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import test from "node:test";
import {
  CredentialAuthenticationError,
  CredentialConfigurationError,
  CredentialEncryptionService,
  CredentialEnvelopeError,
  CredentialKeyUnavailableError,
  CredentialKeyring,
  credentialSchemaVersion,
  type CredentialPayload,
  type EncryptedCredentialEnvelope,
} from "../lib/credential-encryption.ts";
import { D1ConnectionManager } from "../lib/connection-manager.ts";
import {
  D1TokenStore,
  ProviderConnectionAccessError,
  ProviderConnectionStateError,
  type TokenStoreD1Database,
  type TokenStoreD1Result,
  type TokenStoreD1Statement,
} from "../db/token-store.ts";

const NOW = "2026-07-28T12:00:00.000Z";
const LATER = "2026-07-28T13:00:00.000Z";
const SYNTHETIC_REFRESH = "synthetic-refresh-token-v1";
const SYNTHETIC_ACCESS = "synthetic-access-token-v1";

class SqliteStatementAdapter implements TokenStoreD1Statement {
  private values: Array<string | number | null> = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
  ) {}

  bind(...values: Array<string | number | null>): TokenStoreD1Statement {
    const bound = new SqliteStatementAdapter(this.database, this.query);
    bound.values = values;
    return bound;
  }

  async first<T>(): Promise<T | null> {
    return (this.statement().get(...this.values) as T | undefined) ?? null;
  }

  async run(): Promise<TokenStoreD1Result> {
    return this.runSync();
  }

  runSync(): TokenStoreD1Result {
    const result = this.statement().run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  private statement(): StatementSync {
    return this.database.prepare(this.query);
  }
}

class SqliteD1Adapter implements TokenStoreD1Database {
  constructor(readonly database: DatabaseSync) {}

  prepare(query: string): TokenStoreD1Statement {
    return new SqliteStatementAdapter(this.database, query);
  }

  async batch(statements: TokenStoreD1Statement[]): Promise<TokenStoreD1Result[]> {
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
    const tag = filename.replace(/\.sql$/u, "");
    if (database.prepare(
      "SELECT 1 FROM local_migration_journal WHERE tag = ?",
    ).get(tag)) continue;
    const migration = readFileSync(new URL(`../drizzle/${filename}`, import.meta.url), "utf8")
      .replaceAll("--> statement-breakpoint", "");
    const rebuildsReferencedTable = /^\s*PRAGMA foreign_keys=OFF;/iu.test(migration);
    if (rebuildsReferencedTable) database.exec("PRAGMA foreign_keys = OFF");
    database.exec("BEGIN");
    try {
      database.exec(migration);
      if (rebuildsReferencedTable) {
        assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
      }
      database.prepare("INSERT INTO local_migration_journal (tag) VALUES (?)").run(tag);
      database.exec("COMMIT");
      applied += 1;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    } finally {
      if (rebuildsReferencedTable) database.exec("PRAGMA foreign_keys = ON");
    }
  }
  return applied;
}

function key(version: string, byte: number): { version: string; key: string } {
  return { version, key: Buffer.alloc(32, byte).toString("base64url") };
}

async function encryptionService(
  activeVersion = "v2",
  keys = [key("v2", 2), key("v1", 1)],
): Promise<CredentialEncryptionService> {
  return new CredentialEncryptionService(await CredentialKeyring.fromEnvironment({
    PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION: activeVersion,
    PROVIDER_CREDENTIAL_KEYS_JSON: JSON.stringify(keys),
  }));
}

function credentials(suffix = "v1"): CredentialPayload {
  return {
    credentialSchemaVersion,
    refreshToken: `synthetic-refresh-token-${suffix}`,
    accessToken: `synthetic-access-token-${suffix}`,
    accessTokenExpiresAt: "2026-07-28T14:00:00.000Z",
    grantedScopes: ["mail.readonly", "mail.send"],
    providerAccountId: "synthetic-shop@example.invalid",
    providerMetadata: { synthetic: true, generation: suffix },
  };
}

function binding(overrides: Partial<{
  tenantId: string;
  connectionId: string;
  provider: string;
  credentialSchemaVersion: number;
}> = {}) {
  return {
    tenantId: "tenant_a",
    connectionId: "connection_a",
    provider: "gmail",
    credentialSchemaVersion,
    ...overrides,
  };
}

async function setup(activeVersion = "v2") {
  const database = new DatabaseSync(":memory:");
  assert.equal(applyMigrations(database), 6);
  database.prepare(
    "INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?), (?, ?, ?)",
  ).run(
    "tenant_a", "Tenant A", NOW,
    "tenant_b", "Tenant B", NOW,
  );
  const adapter = new SqliteD1Adapter(database);
  const encryption = await encryptionService(activeVersion);
  const tokenStore = new D1TokenStore(adapter, encryption);
  const manager = new D1ConnectionManager(adapter, tokenStore);
  return { database, adapter, encryption, tokenStore, manager };
}

async function createPendingAndActivate(
  context: Awaited<ReturnType<typeof setup>>,
  tenantId = "tenant_a",
  connectionId = "connection_a",
  credentialPayload = credentials(),
) {
  await context.manager.createPendingConnection({
    id: connectionId,
    tenantId,
    provider: "gmail",
    externalAccountId: credentialPayload.providerAccountId,
    occurredAt: NOW,
  });
  return context.manager.activatePendingConnection({
    tenantId,
    connectionId,
    syntheticCredentials: credentialPayload,
    occurredAt: LATER,
  });
}

function mutateBase64Url(value: string): string {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}

test("credential encryption round trip uses the active key", async () => {
  const encryption = await encryptionService();
  const envelope = await encryption.encrypt(binding(), credentials());
  assert.equal(envelope.algorithm, "AES-256-GCM");
  assert.equal(envelope.keyVersion, "v2");
  assert.deepEqual(await encryption.decrypt(binding(), envelope), credentials());
});

test("credential encryption generates a unique nonce for every encryption", async () => {
  const encryption = await encryptionService();
  const nonces = new Set<string>();
  for (let attempt = 0; attempt < 32; attempt += 1) {
    nonces.add((await encryption.encrypt(binding(), credentials())).nonce);
  }
  assert.equal(nonces.size, 32);
});

test("authenticated additional-data mismatch is rejected", async () => {
  const encryption = await encryptionService();
  const envelope = await encryption.encrypt(binding(), credentials());
  for (const mismatch of [
    binding({ tenantId: "tenant_b" }),
    binding({ connectionId: "connection_b" }),
    binding({ provider: "outlook" }),
  ]) {
    await assert.rejects(
      encryption.decrypt(mismatch, envelope),
      CredentialAuthenticationError,
    );
  }
});

test("tampered ciphertext is rejected", async () => {
  const encryption = await encryptionService();
  const envelope = await encryption.encrypt(binding(), credentials());
  await assert.rejects(
    encryption.decrypt(binding(), {
      ...envelope,
      ciphertext: mutateBase64Url(envelope.ciphertext),
    }),
    CredentialAuthenticationError,
  );
});

test("tampered nonce is rejected", async () => {
  const encryption = await encryptionService();
  const envelope = await encryption.encrypt(binding(), credentials());
  await assert.rejects(
    encryption.decrypt(binding(), {
      ...envelope,
      nonce: mutateBase64Url(envelope.nonce),
    }),
    CredentialAuthenticationError,
  );
});

test("tampered authentication tag is rejected", async () => {
  const encryption = await encryptionService();
  const envelope = await encryption.encrypt(binding(), credentials());
  await assert.rejects(
    encryption.decrypt(binding(), {
      ...envelope,
      authenticationTag: mutateBase64Url(envelope.authenticationTag),
    }),
    CredentialAuthenticationError,
  );
});

test("malformed or incomplete envelopes are rejected", async () => {
  const encryption = await encryptionService();
  const envelope = await encryption.encrypt(binding(), credentials());
  for (const malformed of [
    { ...envelope, ciphertext: "" },
    { ...envelope, nonce: "not*base64url" },
    { ...envelope, authenticationTag: envelope.authenticationTag.slice(1) },
    { ...envelope, algorithm: "AES-CBC" },
  ]) {
    await assert.rejects(
      encryption.decrypt(binding(), malformed as EncryptedCredentialEnvelope),
      CredentialEnvelopeError,
    );
  }
});

test("missing credential encryption key configuration fails closed", async () => {
  await assert.rejects(
    CredentialKeyring.fromEnvironment({}),
    CredentialConfigurationError,
  );
});

test("malformed and duplicate key configuration fails closed", async () => {
  for (const configuredKeys of [
    [{ version: "v1", key: "short" }],
    [key("v1", 1), key("v1", 2)],
    [{ ...key("v1", 1), unexpected: true }],
  ]) {
    await assert.rejects(
      CredentialKeyring.fromEnvironment({
        PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION: "v1",
        PROVIDER_CREDENTIAL_KEYS_JSON: JSON.stringify(configuredKeys),
      }),
      CredentialConfigurationError,
    );
  }
});

test("unknown key version fails closed", async () => {
  const oldEncryption = await encryptionService("v1", [key("v1", 1)]);
  const envelope = await oldEncryption.encrypt(binding(), credentials());
  const activeOnly = await encryptionService("v2", [key("v2", 2)]);
  await assert.rejects(
    activeOnly.decrypt(binding(), envelope),
    CredentialKeyUnavailableError,
  );
});

test("previous keys decrypt while new encryption uses only the active key", async () => {
  const oldEncryption = await encryptionService("v1", [key("v1", 1)]);
  const oldEnvelope = await oldEncryption.encrypt(binding(), credentials());
  const rotatedConfiguration = await encryptionService();
  assert.deepEqual(
    await rotatedConfiguration.decrypt(binding(), oldEnvelope),
    credentials(),
  );
  assert.equal(
    (await rotatedConfiguration.encrypt(binding(), credentials())).keyVersion,
    "v2",
  );
});

test("pending connections persist no credential material", async () => {
  const context = await setup();
  await context.manager.createPendingConnection({
    id: "connection_pending",
    tenantId: "tenant_a",
    provider: "gmail",
    externalAccountId: credentials().providerAccountId,
    occurredAt: NOW,
  });
  const row = context.database.prepare(`
    SELECT status, credential_envelope_ciphertext AS ciphertext,
      credential_envelope_nonce AS nonce,
      credential_envelope_auth_tag AS tag,
      credential_key_version AS keyVersion,
      credential_schema_version AS schemaVersion
    FROM provider_connections WHERE id = 'connection_pending'
  `).get();
  assert.deepEqual({ ...row }, {
    status: "pending",
    ciphertext: null,
    nonce: null,
    tag: null,
    keyVersion: null,
    schemaVersion: null,
  });
});

test("active connections require a complete versioned credential envelope", async () => {
  const context = await setup();
  assert.throws(
    () => context.database.prepare(`
      INSERT INTO provider_connections (
        id, tenant_id, provider, external_account_id, status,
        granted_scopes_json, created_at, updated_at
      ) VALUES (
        'connection_invalid_active', 'tenant_a', 'gmail',
        'synthetic@example.invalid', 'active', '[]', ?, ?
      )
    `).run(NOW, NOW),
    /provider_connections_envelope_check/,
  );
  await context.manager.createPendingConnection({
    id: "connection_incomplete",
    tenantId: "tenant_a",
    provider: "gmail",
    externalAccountId: credentials().providerAccountId,
    occurredAt: NOW,
  });
  await assert.rejects(
    context.manager.activatePendingConnection({
      tenantId: "tenant_a",
      connectionId: "connection_incomplete",
      syntheticCredentials: {
        ...credentials(),
        refreshToken: undefined,
        accessToken: undefined,
      },
      occurredAt: LATER,
    }),
    CredentialEnvelopeError,
  );
});

test("TokenStore rejects and audits cross-tenant access", async () => {
  const context = await setup();
  await createPendingAndActivate(context, "tenant_b", "connection_b");
  await assert.rejects(
    context.tokenStore.retrieveDecryptedCredentials("tenant_a", "connection_b"),
    ProviderConnectionAccessError,
  );
  const event = context.database.prepare(`
    SELECT tenant_id AS tenantId, action, details_json AS details
    FROM audit_events
    WHERE action = 'provider_credentials_cross_tenant_access_denied'
  `).get();
  assert.deepEqual({ ...event }, {
    tenantId: "tenant_a",
    action: "provider_credentials_cross_tenant_access_denied",
    details: '{"result":"denied"}',
  });
});

test("ConnectionManager rejects cross-tenant metadata access", async () => {
  const context = await setup();
  await createPendingAndActivate(context, "tenant_b", "connection_b");
  await assert.rejects(
    context.manager.getConnectionMetadata("tenant_a", "connection_b"),
    ProviderConnectionAccessError,
  );
});

test("credential replacement after reconnect is atomic and decrypts the new payload", async () => {
  const context = await setup();
  await createPendingAndActivate(context);
  await context.manager.markReconnectRequired({
    tenantId: "tenant_a",
    connectionId: "connection_a",
    occurredAt: "2026-07-28T13:10:00.000Z",
  });
  const replacement = credentials("v2");
  const metadata = await context.manager.replaceAfterSyntheticReauthorization({
    tenantId: "tenant_a",
    connectionId: "connection_a",
    syntheticCredentials: replacement,
    occurredAt: "2026-07-28T13:20:00.000Z",
  });
  assert.equal(metadata.status, "active");
  assert.equal(metadata.reconnectRequiredAt, "2026-07-28T13:10:00.000Z");
  assert.deepEqual(
    await context.tokenStore.retrieveDecryptedCredentials("tenant_a", "connection_a"),
    replacement,
  );
});

test("reconnect-required may retain encrypted credentials for controlled recovery", async () => {
  const context = await setup();
  await createPendingAndActivate(context);
  const metadata = await context.manager.markReconnectRequired({
    tenantId: "tenant_a",
    connectionId: "connection_a",
    occurredAt: LATER,
  });
  assert.equal(metadata.status, "reconnect_required");
  assert.equal(metadata.reconnectRequiredAt, LATER);
  assert.deepEqual(
    await context.tokenStore.retrieveDecryptedCredentials("tenant_a", "connection_a"),
    credentials(),
  );
});

test("reconnect-required may erase encrypted credentials when recovery does not need them", async () => {
  const context = await setup();
  await createPendingAndActivate(context);
  await context.manager.markReconnectRequired({
    tenantId: "tenant_a",
    connectionId: "connection_a",
    occurredAt: LATER,
    retainEncryptedCredentials: false,
  });
  const row = context.database.prepare(`
    SELECT credential_envelope_ciphertext AS ciphertext,
      credential_envelope_nonce AS nonce,
      credential_envelope_auth_tag AS tag,
      credential_key_version AS keyVersion,
      credential_schema_version AS schemaVersion
    FROM provider_connections WHERE id = 'connection_a'
  `).get();
  assert.deepEqual({ ...row }, {
    ciphertext: null,
    nonce: null,
    tag: null,
    keyVersion: null,
    schemaVersion: null,
  });
});

test("revocation cryptographically erases credentials and provider watch state", async () => {
  const context = await setup();
  await createPendingAndActivate(context);
  context.database.prepare(`
    UPDATE provider_connections
    SET gmail_watch_expires_at = ?, gmail_history_id = ?
    WHERE id = 'connection_a'
  `).run(LATER, "synthetic-history");
  const metadata = await context.manager.revokeConnection({
    tenantId: "tenant_a",
    connectionId: "connection_a",
    occurredAt: "2026-07-28T13:30:00.000Z",
  });
  assert.equal(metadata.status, "revoked");
  assert.equal(metadata.revokedAt, "2026-07-28T13:30:00.000Z");
  const row = context.database.prepare(`
    SELECT granted_scopes_json AS scopes,
      credential_envelope_ciphertext AS ciphertext,
      credential_envelope_nonce AS nonce,
      credential_envelope_auth_tag AS tag,
      credential_key_version AS keyVersion,
      credential_schema_version AS schemaVersion,
      gmail_watch_expires_at AS watchExpiresAt,
      gmail_history_id AS historyId
    FROM provider_connections WHERE id = 'connection_a'
  `).get();
  assert.deepEqual({ ...row }, {
    scopes: "[]",
    ciphertext: null,
    nonce: null,
    tag: null,
    keyVersion: null,
    schemaVersion: null,
    watchExpiresAt: null,
    historyId: null,
  });
});

test("revoked connection credential access and operations are rejected", async () => {
  const context = await setup();
  await createPendingAndActivate(context);
  await context.manager.revokeConnection({
    tenantId: "tenant_a",
    connectionId: "connection_a",
    occurredAt: LATER,
  });
  await assert.rejects(
    context.tokenStore.retrieveDecryptedCredentials("tenant_a", "connection_a"),
    ProviderConnectionStateError,
  );
  await assert.rejects(
    context.manager.markReconnectRequired({
      tenantId: "tenant_a",
      connectionId: "connection_a",
      occurredAt: "2026-07-28T14:00:00.000Z",
    }),
    ProviderConnectionStateError,
  );
});

test("invalid connection state transitions are rejected", async () => {
  const context = await setup();
  await context.manager.createPendingConnection({
    id: "connection_a",
    tenantId: "tenant_a",
    provider: "gmail",
    externalAccountId: credentials().providerAccountId,
    occurredAt: NOW,
  });
  await assert.rejects(
    context.manager.markReconnectRequired({
      tenantId: "tenant_a",
      connectionId: "connection_a",
      occurredAt: LATER,
    }),
    ProviderConnectionStateError,
  );
  await context.manager.activatePendingConnection({
    tenantId: "tenant_a",
    connectionId: "connection_a",
    syntheticCredentials: credentials(),
    occurredAt: LATER,
  });
  await assert.rejects(
    context.manager.activatePendingConnection({
      tenantId: "tenant_a",
      connectionId: "connection_a",
      syntheticCredentials: credentials(),
      occurredAt: "2026-07-28T14:00:00.000Z",
    }),
    ProviderConnectionStateError,
  );
});

test("safe metadata excludes every credential-envelope field", async () => {
  const context = await setup();
  const metadata = await createPendingAndActivate(context);
  assert.deepEqual(Object.keys(metadata).sort(), [
    "createdAt",
    "externalAccountId",
    "grantedScopes",
    "id",
    "provider",
    "reconnectRequiredAt",
    "revokedAt",
    "status",
    "tenantId",
    "updatedAt",
    "watchExpiresAt",
  ].sort());
  assert.equal(
    Object.keys(metadata).some((name) => /credential|cipher|nonce|tag|key/i.test(name)),
    false,
  );
});

test("old-key credentials rotate atomically to the active key", async () => {
  const database = new DatabaseSync(":memory:");
  assert.equal(applyMigrations(database), 6);
  database.prepare(
    "INSERT INTO tenants (id, name, created_at) VALUES ('tenant_a', 'Tenant A', ?)",
  ).run(NOW);
  const adapter = new SqliteD1Adapter(database);
  const oldStore = new D1TokenStore(
    adapter,
    await encryptionService("v1", [key("v1", 1)]),
  );
  const oldManager = new D1ConnectionManager(adapter, oldStore);
  await oldManager.createPendingConnection({
    id: "connection_a",
    tenantId: "tenant_a",
    provider: "gmail",
    externalAccountId: credentials().providerAccountId,
    occurredAt: NOW,
  });
  await oldManager.activatePendingConnection({
    tenantId: "tenant_a",
    connectionId: "connection_a",
    syntheticCredentials: credentials(),
    occurredAt: LATER,
  });
  const rotatingStore = new D1TokenStore(adapter, await encryptionService());
  await rotatingStore.rotateCredentials({
    tenantId: "tenant_a",
    connectionId: "connection_a",
    occurredAt: "2026-07-28T14:00:00.000Z",
  });
  const row = database.prepare(
    "SELECT credential_key_version AS keyVersion FROM provider_connections WHERE id = 'connection_a'",
  ).get();
  assert.deepEqual({ ...row }, { keyVersion: "v2" });
  assert.deepEqual(
    await rotatingStore.retrieveDecryptedCredentials("tenant_a", "connection_a"),
    credentials(),
  );
});

test("tampered stored credentials fail closed and emit a sanitized audit event", async () => {
  const context = await setup();
  await createPendingAndActivate(context);
  context.database.prepare(`
    UPDATE provider_connections
    SET credential_envelope_auth_tag =
      CASE substr(credential_envelope_auth_tag, 1, 1)
        WHEN 'A' THEN 'B' || substr(credential_envelope_auth_tag, 2)
        ELSE 'A' || substr(credential_envelope_auth_tag, 2)
      END
    WHERE id = 'connection_a'
  `).run();
  await assert.rejects(
    context.tokenStore.retrieveDecryptedCredentials("tenant_a", "connection_a"),
    CredentialAuthenticationError,
  );
  const audit = context.database.prepare(`
    SELECT action, details_json AS details
    FROM audit_events
    WHERE action = 'provider_credentials_decryption_failed'
  `).get();
  assert.deepEqual({ ...audit }, {
    action: "provider_credentials_decryption_failed",
    details: '{"failure":"authentication_or_envelope_validation"}',
  });
});

test("D1 audit failure rolls back credential activation", async () => {
  const context = await setup();
  await context.manager.createPendingConnection({
    id: "connection_a",
    tenantId: "tenant_a",
    provider: "gmail",
    externalAccountId: credentials().providerAccountId,
    occurredAt: NOW,
  });
  context.database.exec(`
    CREATE TRIGGER fail_credential_audit
    BEFORE INSERT ON audit_events
    WHEN NEW.action = 'provider_credentials_stored'
    BEGIN
      SELECT RAISE(ABORT, 'synthetic audit persistence failure');
    END;
  `);
  await assert.rejects(
    context.manager.activatePendingConnection({
      tenantId: "tenant_a",
      connectionId: "connection_a",
      syntheticCredentials: credentials(),
      occurredAt: LATER,
    }),
    /synthetic audit persistence failure/,
  );
  const row = context.database.prepare(`
    SELECT status, credential_envelope_ciphertext AS ciphertext,
      credential_key_version AS keyVersion
    FROM provider_connections WHERE id = 'connection_a'
  `).get();
  assert.deepEqual({ ...row }, {
    status: "pending",
    ciphertext: null,
    keyVersion: null,
  });
});

test("plaintext tokens are never persisted or logged", async () => {
  const context = await setup();
  const captured: string[] = [];
  const originals = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = (...values: unknown[]) => captured.push(values.map(String).join(" "));
  console.warn = (...values: unknown[]) => captured.push(values.map(String).join(" "));
  console.error = (...values: unknown[]) => captured.push(values.map(String).join(" "));
  try {
    await createPendingAndActivate(context, "tenant_a", "connection_a", {
      ...credentials(),
      refreshToken: SYNTHETIC_REFRESH,
      accessToken: SYNTHETIC_ACCESS,
    });
    await context.tokenStore.retrieveDecryptedCredentials("tenant_a", "connection_a");
  } finally {
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
  }
  const persisted = context.database.prepare(`
    SELECT
      coalesce(credential_envelope_ciphertext, '') || ' ' ||
      coalesce(credential_envelope_nonce, '') || ' ' ||
      coalesce(credential_envelope_auth_tag, '') || ' ' ||
      coalesce(credential_key_version, '') AS stored
    FROM provider_connections WHERE id = 'connection_a'
  `).get() as { stored: string };
  const auditDetails = context.database.prepare(
    "SELECT group_concat(details_json, ' ') AS details FROM audit_events",
  ).get() as { details: string };
  for (const sensitive of [SYNTHETIC_REFRESH, SYNTHETIC_ACCESS]) {
    assert.equal(persisted.stored.includes(sensitive), false);
    assert.equal(auditDetails.details.includes(sensitive), false);
    assert.equal(captured.join(" ").includes(sensitive), false);
  }
});

test("audit events contain no credential envelope material", async () => {
  const context = await setup();
  await createPendingAndActivate(context);
  await context.manager.markReconnectRequired({
    tenantId: "tenant_a",
    connectionId: "connection_a",
    occurredAt: "2026-07-28T13:10:00.000Z",
  });
  await context.manager.replaceAfterSyntheticReauthorization({
    tenantId: "tenant_a",
    connectionId: "connection_a",
    syntheticCredentials: credentials("v2"),
    occurredAt: "2026-07-28T13:20:00.000Z",
  });
  await context.manager.revokeConnection({
    tenantId: "tenant_a",
    connectionId: "connection_a",
    occurredAt: "2026-07-28T13:30:00.000Z",
  });
  const rows = context.database.prepare(
    "SELECT action, details_json AS details FROM audit_events ORDER BY created_at, action",
  ).all() as Array<{ action: string; details: string }>;
  const serialized = JSON.stringify(rows);
  for (const forbidden of [
    "synthetic-refresh-token",
    "synthetic-access-token",
    "ciphertext",
    "nonce",
    "authenticationTag",
    "credential_key",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  for (const action of [
    "provider_connection_created",
    "provider_credentials_stored",
    "provider_connection_reconnect_required",
    "provider_credentials_replaced",
    "provider_connection_revoked",
    "provider_credential_erasure_completed",
  ]) {
    assert.equal(rows.some((row) => row.action === action), true, `missing ${action}`);
  }
});

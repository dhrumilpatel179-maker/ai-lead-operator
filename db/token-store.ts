import {
  CredentialAuthenticationError,
  CredentialEnvelopeError,
  CredentialKeyUnavailableError,
  type CredentialBinding,
  type CredentialPayload,
  type EncryptedCredentialEnvelope,
  CredentialEncryptionService,
} from "../lib/credential-encryption";

type D1Value = string | number | null;

export interface TokenStoreD1Result {
  meta: { changes?: number };
  success?: boolean;
}

export interface TokenStoreD1Statement {
  bind(...values: D1Value[]): TokenStoreD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<TokenStoreD1Result>;
}

export interface TokenStoreD1Database {
  prepare(query: string): TokenStoreD1Statement;
  batch(statements: TokenStoreD1Statement[]): Promise<TokenStoreD1Result[]>;
}

export type ProviderConnectionStatus =
  | "pending"
  | "active"
  | "reconnect_required"
  | "revoked"
  | "error";

export interface SafeProviderConnectionMetadata {
  id: string;
  tenantId: string;
  provider: string;
  externalAccountId: string;
  status: ProviderConnectionStatus;
  grantedScopes: string[];
  watchExpiresAt: string | null;
  reconnectRequiredAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type ProviderConnectionRow = {
  id: string;
  tenantId: string;
  provider: string;
  externalAccountId: string;
  status: ProviderConnectionStatus;
  grantedScopesJson: string;
  watchExpiresAt: string | null;
  reconnectRequiredAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type CredentialEnvelopeRow = ProviderConnectionRow & {
  ciphertext: string | null;
  nonce: string | null;
  authenticationTag: string | null;
  keyVersion: string | null;
  credentialSchemaVersion: number | null;
};

export class ProviderConnectionAccessError extends Error {
  constructor() {
    super("Provider connection is unavailable");
    this.name = "ProviderConnectionAccessError";
  }
}

export class ProviderConnectionStateError extends Error {
  constructor() {
    super("Provider connection state transition is not permitted");
    this.name = "ProviderConnectionStateError";
  }
}

export class ProviderCredentialPersistenceError extends Error {
  constructor() {
    super("Provider credential operation was not persisted");
    this.name = "ProviderCredentialPersistenceError";
  }
}

function changes(result: TokenStoreD1Result): number {
  return result.meta.changes ?? 0;
}

function auditId(): string {
  return `audit_${crypto.randomUUID()}`;
}

function correlationId(action: string, connectionId: string): string {
  return `${action}:${connectionId}:${crypto.randomUUID()}`;
}

function safeDetails(details: Record<string, string | boolean | null>): string {
  return JSON.stringify(details);
}

function parseScopes(value: string): string[] {
  let scopes: unknown;
  try {
    scopes = JSON.parse(value);
  } catch {
    throw new ProviderCredentialPersistenceError();
  }
  if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === "string")) {
    throw new ProviderCredentialPersistenceError();
  }
  return scopes;
}

function safeMetadata(row: ProviderConnectionRow): SafeProviderConnectionMetadata {
  return {
    id: row.id,
    tenantId: row.tenantId,
    provider: row.provider,
    externalAccountId: row.externalAccountId,
    status: row.status,
    grantedScopes: parseScopes(row.grantedScopesJson),
    watchExpiresAt: row.watchExpiresAt,
    reconnectRequiredAt: row.reconnectRequiredAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function envelopeFromRow(row: CredentialEnvelopeRow): EncryptedCredentialEnvelope {
  if (
    row.ciphertext === null
    || row.nonce === null
    || row.authenticationTag === null
    || row.keyVersion === null
    || row.credentialSchemaVersion === null
  ) {
    throw new CredentialEnvelopeError();
  }
  return {
    algorithm: "AES-256-GCM",
    credentialSchemaVersion: row.credentialSchemaVersion,
    keyVersion: row.keyVersion,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    authenticationTag: row.authenticationTag,
  };
}

function envelopeIsAbsent(row: CredentialEnvelopeRow): boolean {
  return row.ciphertext === null
    && row.nonce === null
    && row.authenticationTag === null
    && row.keyVersion === null
    && row.credentialSchemaVersion === null;
}

function binding(row: CredentialEnvelopeRow): CredentialBinding {
  if (row.credentialSchemaVersion === null) throw new CredentialEnvelopeError();
  return {
    tenantId: row.tenantId,
    connectionId: row.id,
    provider: row.provider,
    credentialSchemaVersion: row.credentialSchemaVersion,
  };
}

export interface TokenStore {
  storeEncryptedCredentials(input: {
    tenantId: string;
    connectionId: string;
    credentials: CredentialPayload;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata>;
  retrieveDecryptedCredentials(
    tenantId: string,
    connectionId: string,
  ): Promise<CredentialPayload>;
  replaceCredentials(input: {
    tenantId: string;
    connectionId: string;
    credentials: CredentialPayload;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata>;
  markReconnectRequired(input: {
    tenantId: string;
    connectionId: string;
    occurredAt: string;
    retainEncryptedCredentials?: boolean;
  }): Promise<SafeProviderConnectionMetadata>;
  revokeAndErase(input: {
    tenantId: string;
    connectionId: string;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata>;
  rotateCredentials(input: {
    tenantId: string;
    connectionId: string;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata>;
  reportMetadata(
    tenantId: string,
    connectionId: string,
  ): Promise<SafeProviderConnectionMetadata>;
}

export class D1TokenStore implements TokenStore {
  constructor(
    private readonly db: TokenStoreD1Database,
    private readonly encryption: CredentialEncryptionService,
  ) {}

  private async findConnectionById(connectionId: string): Promise<ProviderConnectionRow | null> {
    return this.db.prepare(`
      SELECT
        id,
        tenant_id AS tenantId,
        provider,
        external_account_id AS externalAccountId,
        status,
        granted_scopes_json AS grantedScopesJson,
        gmail_watch_expires_at AS watchExpiresAt,
        reconnect_required_at AS reconnectRequiredAt,
        revoked_at AS revokedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM provider_connections
      WHERE id = ?
    `).bind(connectionId).first<ProviderConnectionRow>();
  }

  private async auditDeniedAccess(
    trustedTenantId: string,
    connectionId: string,
    occurredAt: string,
  ): Promise<void> {
    await this.db.prepare(`
      INSERT INTO audit_events (
        id, tenant_id, lead_id, actor_type, actor_id, action, actor_role,
        target_type, target_id, correlation_id, details_json, created_at
      )
      SELECT ?, id, NULL, 'system', 'connector-foundation',
        'provider_credentials_cross_tenant_access_denied', NULL,
        'provider_connection', ?, ?, ?, ?
      FROM tenants
      WHERE id = ?
      ON CONFLICT (tenant_id, correlation_id, action) DO NOTHING
    `).bind(
      auditId(),
      connectionId,
      correlationId("cross_tenant_denied", connectionId),
      safeDetails({ result: "denied" }),
      occurredAt,
      trustedTenantId,
    ).run();
  }

  private async assertOwned(
    tenantId: string,
    connectionId: string,
    occurredAt = new Date().toISOString(),
  ): Promise<ProviderConnectionRow> {
    const row = await this.findConnectionById(connectionId);
    if (!row || row.tenantId !== tenantId) {
      if (row && row.tenantId !== tenantId) {
        await this.auditDeniedAccess(tenantId, connectionId, occurredAt);
      }
      throw new ProviderConnectionAccessError();
    }
    return row;
  }

  private async readEnvelope(
    tenantId: string,
    connectionId: string,
  ): Promise<CredentialEnvelopeRow> {
    await this.assertOwned(tenantId, connectionId);
    const row = await this.db.prepare(`
      SELECT
        id,
        tenant_id AS tenantId,
        provider,
        external_account_id AS externalAccountId,
        status,
        granted_scopes_json AS grantedScopesJson,
        gmail_watch_expires_at AS watchExpiresAt,
        reconnect_required_at AS reconnectRequiredAt,
        revoked_at AS revokedAt,
        created_at AS createdAt,
        updated_at AS updatedAt,
        credential_envelope_ciphertext AS ciphertext,
        credential_envelope_nonce AS nonce,
        credential_envelope_auth_tag AS authenticationTag,
        credential_key_version AS keyVersion,
        credential_schema_version AS credentialSchemaVersion
      FROM provider_connections
      WHERE tenant_id = ? AND id = ?
    `).bind(tenantId, connectionId).first<CredentialEnvelopeRow>();
    if (!row) throw new ProviderConnectionAccessError();
    return row;
  }

  private async auditDecryptionFailure(
    tenantId: string,
    connectionId: string,
    occurredAt: string,
  ): Promise<void> {
    await this.db.prepare(`
      INSERT INTO audit_events (
        id, tenant_id, lead_id, actor_type, actor_id, action, actor_role,
        target_type, target_id, correlation_id, details_json, created_at
      )
      SELECT ?, tenant_id, NULL, 'system', 'connector-foundation',
        'provider_credentials_decryption_failed', NULL,
        'provider_connection', id, ?, ?, ?
      FROM provider_connections
      WHERE tenant_id = ? AND id = ?
      ON CONFLICT (tenant_id, correlation_id, action) DO NOTHING
    `).bind(
      auditId(),
      correlationId("decrypt_failed", connectionId),
      safeDetails({ failure: "authentication_or_envelope_validation" }),
      occurredAt,
      tenantId,
      connectionId,
    ).run();
  }

  async storeEncryptedCredentials(input: {
    tenantId: string;
    connectionId: string;
    credentials: CredentialPayload;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata> {
    const row = await this.assertOwned(input.tenantId, input.connectionId, input.occurredAt);
    if (row.status !== "pending") throw new ProviderConnectionStateError();
    if (row.externalAccountId !== input.credentials.providerAccountId) {
      throw new CredentialEnvelopeError("Provider account identity does not match");
    }
    const envelope = await this.encryption.encrypt({
      tenantId: row.tenantId,
      connectionId: row.id,
      provider: row.provider,
      credentialSchemaVersion: input.credentials.credentialSchemaVersion,
    }, input.credentials);
    const [updated, audited] = await this.db.batch([
      this.db.prepare(`
        UPDATE provider_connections
        SET
          status = 'active',
          granted_scopes_json = ?,
          credential_envelope_ciphertext = ?,
          credential_envelope_nonce = ?,
          credential_envelope_auth_tag = ?,
          credential_key_version = ?,
          credential_schema_version = ?,
          updated_at = ?
        WHERE tenant_id = ? AND id = ? AND status = 'pending'
      `).bind(
        JSON.stringify(input.credentials.grantedScopes),
        envelope.ciphertext,
        envelope.nonce,
        envelope.authenticationTag,
        envelope.keyVersion,
        envelope.credentialSchemaVersion,
        input.occurredAt,
        input.tenantId,
        input.connectionId,
      ),
      this.db.prepare(`
        INSERT INTO audit_events (
          id, tenant_id, lead_id, actor_type, actor_id, action, actor_role,
          target_type, target_id, correlation_id, details_json, created_at
        )
        SELECT ?, tenant_id, NULL, 'system', 'connector-foundation',
          'provider_credentials_stored', NULL, 'provider_connection', id, ?, ?, ?
        FROM provider_connections
        WHERE tenant_id = ? AND id = ? AND status = 'active' AND updated_at = ?
        ON CONFLICT (tenant_id, correlation_id, action) DO NOTHING
      `).bind(
        auditId(),
        correlationId("credentials_stored", input.connectionId),
        safeDetails({ result: "stored" }),
        input.occurredAt,
        input.tenantId,
        input.connectionId,
        input.occurredAt,
      ),
    ]);
    if (changes(updated) !== 1 || changes(audited) !== 1) {
      throw new ProviderCredentialPersistenceError();
    }
    return this.reportMetadata(input.tenantId, input.connectionId);
  }

  async retrieveDecryptedCredentials(
    tenantId: string,
    connectionId: string,
  ): Promise<CredentialPayload> {
    const row = await this.readEnvelope(tenantId, connectionId);
    if (row.status === "pending" || row.status === "revoked") {
      throw new ProviderConnectionStateError();
    }
    if (envelopeIsAbsent(row)) throw new ProviderConnectionStateError();
    try {
      return await this.encryption.decrypt(binding(row), envelopeFromRow(row));
    } catch (error) {
      if (
        error instanceof CredentialAuthenticationError
        || error instanceof CredentialEnvelopeError
        || error instanceof CredentialKeyUnavailableError
      ) {
        await this.auditDecryptionFailure(tenantId, connectionId, new Date().toISOString());
      }
      throw error;
    }
  }

  async replaceCredentials(input: {
    tenantId: string;
    connectionId: string;
    credentials: CredentialPayload;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata> {
    const row = await this.assertOwned(input.tenantId, input.connectionId, input.occurredAt);
    if (!["active", "reconnect_required", "error"].includes(row.status)) {
      throw new ProviderConnectionStateError();
    }
    if (row.externalAccountId !== input.credentials.providerAccountId) {
      throw new CredentialEnvelopeError("Provider account identity does not match");
    }
    const envelope = await this.encryption.encrypt({
      tenantId: row.tenantId,
      connectionId: row.id,
      provider: row.provider,
      credentialSchemaVersion: input.credentials.credentialSchemaVersion,
    }, input.credentials);
    const [updated, audited] = await this.db.batch([
      this.db.prepare(`
        UPDATE provider_connections
        SET
          status = 'active',
          granted_scopes_json = ?,
          credential_envelope_ciphertext = ?,
          credential_envelope_nonce = ?,
          credential_envelope_auth_tag = ?,
          credential_key_version = ?,
          credential_schema_version = ?,
          revoked_at = NULL,
          updated_at = ?
        WHERE tenant_id = ? AND id = ? AND status IN ('active','reconnect_required','error')
      `).bind(
        JSON.stringify(input.credentials.grantedScopes),
        envelope.ciphertext,
        envelope.nonce,
        envelope.authenticationTag,
        envelope.keyVersion,
        envelope.credentialSchemaVersion,
        input.occurredAt,
        input.tenantId,
        input.connectionId,
      ),
      this.db.prepare(`
        INSERT INTO audit_events (
          id, tenant_id, lead_id, actor_type, actor_id, action, actor_role,
          target_type, target_id, correlation_id, details_json, created_at
        )
        SELECT ?, tenant_id, NULL, 'system', 'connector-foundation',
          'provider_credentials_replaced', NULL, 'provider_connection', id, ?, ?, ?
        FROM provider_connections
        WHERE tenant_id = ? AND id = ? AND status = 'active' AND updated_at = ?
        ON CONFLICT (tenant_id, correlation_id, action) DO NOTHING
      `).bind(
        auditId(),
        correlationId("credentials_replaced", input.connectionId),
        safeDetails({ result: "replaced" }),
        input.occurredAt,
        input.tenantId,
        input.connectionId,
        input.occurredAt,
      ),
    ]);
    if (changes(updated) !== 1 || changes(audited) !== 1) {
      throw new ProviderCredentialPersistenceError();
    }
    return this.reportMetadata(input.tenantId, input.connectionId);
  }

  async markReconnectRequired(input: {
    tenantId: string;
    connectionId: string;
    occurredAt: string;
    retainEncryptedCredentials?: boolean;
  }): Promise<SafeProviderConnectionMetadata> {
    const row = await this.assertOwned(input.tenantId, input.connectionId, input.occurredAt);
    if (row.status !== "active") throw new ProviderConnectionStateError();
    const retain = input.retainEncryptedCredentials ?? true;
    const [updated, audited] = await this.db.batch([
      this.db.prepare(`
        UPDATE provider_connections
        SET
          status = 'reconnect_required',
          credential_envelope_ciphertext = CASE WHEN ? = 1 THEN credential_envelope_ciphertext ELSE NULL END,
          credential_envelope_nonce = CASE WHEN ? = 1 THEN credential_envelope_nonce ELSE NULL END,
          credential_envelope_auth_tag = CASE WHEN ? = 1 THEN credential_envelope_auth_tag ELSE NULL END,
          credential_key_version = CASE WHEN ? = 1 THEN credential_key_version ELSE NULL END,
          credential_schema_version = CASE WHEN ? = 1 THEN credential_schema_version ELSE NULL END,
          reconnect_required_at = ?,
          updated_at = ?
        WHERE tenant_id = ? AND id = ? AND status = 'active'
      `).bind(
        retain ? 1 : 0,
        retain ? 1 : 0,
        retain ? 1 : 0,
        retain ? 1 : 0,
        retain ? 1 : 0,
        input.occurredAt,
        input.occurredAt,
        input.tenantId,
        input.connectionId,
      ),
      this.db.prepare(`
        INSERT INTO audit_events (
          id, tenant_id, lead_id, actor_type, actor_id, action, actor_role,
          target_type, target_id, correlation_id, details_json, created_at
        )
        SELECT ?, tenant_id, NULL, 'system', 'connector-foundation',
          'provider_connection_reconnect_required', NULL,
          'provider_connection', id, ?, ?, ?
        FROM provider_connections
        WHERE tenant_id = ? AND id = ? AND status = 'reconnect_required'
          AND reconnect_required_at = ? AND updated_at = ?
        ON CONFLICT (tenant_id, correlation_id, action) DO NOTHING
      `).bind(
        auditId(),
        correlationId("reconnect_required", input.connectionId),
        safeDetails({ encryptedCredentialRetained: retain }),
        input.occurredAt,
        input.tenantId,
        input.connectionId,
        input.occurredAt,
        input.occurredAt,
      ),
    ]);
    if (changes(updated) !== 1 || changes(audited) !== 1) {
      throw new ProviderCredentialPersistenceError();
    }
    return this.reportMetadata(input.tenantId, input.connectionId);
  }

  async revokeAndErase(input: {
    tenantId: string;
    connectionId: string;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata> {
    const row = await this.assertOwned(input.tenantId, input.connectionId, input.occurredAt);
    if (row.status === "revoked") throw new ProviderConnectionStateError();
    const [updated, revokedAudit, erasedAudit] = await this.db.batch([
      this.db.prepare(`
        UPDATE provider_connections
        SET
          status = 'revoked',
          granted_scopes_json = '[]',
          credential_envelope_ciphertext = NULL,
          credential_envelope_nonce = NULL,
          credential_envelope_auth_tag = NULL,
          credential_key_version = NULL,
          credential_schema_version = NULL,
          gmail_watch_expires_at = NULL,
          gmail_history_id = NULL,
          revoked_at = ?,
          updated_at = ?
        WHERE tenant_id = ? AND id = ? AND status <> 'revoked'
      `).bind(
        input.occurredAt,
        input.occurredAt,
        input.tenantId,
        input.connectionId,
      ),
      this.db.prepare(`
        INSERT INTO audit_events (
          id, tenant_id, lead_id, actor_type, actor_id, action, actor_role,
          target_type, target_id, correlation_id, details_json, created_at
        )
        SELECT ?, tenant_id, NULL, 'system', 'connector-foundation',
          'provider_connection_revoked', NULL, 'provider_connection', id, ?, ?, ?
        FROM provider_connections
        WHERE tenant_id = ? AND id = ? AND status = 'revoked' AND revoked_at = ?
        ON CONFLICT (tenant_id, correlation_id, action) DO NOTHING
      `).bind(
        auditId(),
        correlationId("connection_revoked", input.connectionId),
        safeDetails({ previousStatus: row.status }),
        input.occurredAt,
        input.tenantId,
        input.connectionId,
        input.occurredAt,
      ),
      this.db.prepare(`
        INSERT INTO audit_events (
          id, tenant_id, lead_id, actor_type, actor_id, action, actor_role,
          target_type, target_id, correlation_id, details_json, created_at
        )
        SELECT ?, tenant_id, NULL, 'system', 'connector-foundation',
          'provider_credential_erasure_completed', NULL,
          'provider_connection', id, ?, ?, ?
        FROM provider_connections
        WHERE tenant_id = ? AND id = ? AND status = 'revoked'
          AND credential_envelope_ciphertext IS NULL
          AND credential_envelope_nonce IS NULL
          AND credential_envelope_auth_tag IS NULL
          AND credential_key_version IS NULL
          AND credential_schema_version IS NULL
        ON CONFLICT (tenant_id, correlation_id, action) DO NOTHING
      `).bind(
        auditId(),
        correlationId("credential_erasure", input.connectionId),
        safeDetails({ result: "erased" }),
        input.occurredAt,
        input.tenantId,
        input.connectionId,
      ),
    ]);
    if (
      changes(updated) !== 1
      || changes(revokedAudit) !== 1
      || changes(erasedAudit) !== 1
    ) {
      throw new ProviderCredentialPersistenceError();
    }
    return this.reportMetadata(input.tenantId, input.connectionId);
  }

  async rotateCredentials(input: {
    tenantId: string;
    connectionId: string;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata> {
    const row = await this.readEnvelope(input.tenantId, input.connectionId);
    if (!["active", "reconnect_required", "error"].includes(row.status)) {
      throw new ProviderConnectionStateError();
    }
    if (envelopeIsAbsent(row)) throw new ProviderConnectionStateError();
    let currentEnvelope: EncryptedCredentialEnvelope;
    try {
      currentEnvelope = envelopeFromRow(row);
    } catch (error) {
      if (error instanceof CredentialEnvelopeError) {
        await this.auditDecryptionFailure(
          input.tenantId,
          input.connectionId,
          input.occurredAt,
        );
      }
      throw error;
    }
    if (currentEnvelope.keyVersion === this.encryption.activeKeyVersion()) {
      return safeMetadata(row);
    }
    let credentials: CredentialPayload;
    try {
      credentials = await this.encryption.decrypt(binding(row), currentEnvelope);
    } catch (error) {
      if (
        error instanceof CredentialAuthenticationError
        || error instanceof CredentialEnvelopeError
        || error instanceof CredentialKeyUnavailableError
      ) {
        await this.auditDecryptionFailure(
          input.tenantId,
          input.connectionId,
          input.occurredAt,
        );
      }
      throw error;
    }
    const rotated = await this.encryption.encrypt(binding(row), credentials);
    const [updated, audited] = await this.db.batch([
      this.db.prepare(`
        UPDATE provider_connections
        SET
          credential_envelope_ciphertext = ?,
          credential_envelope_nonce = ?,
          credential_envelope_auth_tag = ?,
          credential_key_version = ?,
          credential_schema_version = ?,
          updated_at = ?
        WHERE tenant_id = ? AND id = ?
          AND credential_envelope_ciphertext = ?
          AND credential_envelope_nonce = ?
          AND credential_envelope_auth_tag = ?
          AND credential_key_version = ?
          AND credential_schema_version = ?
      `).bind(
        rotated.ciphertext,
        rotated.nonce,
        rotated.authenticationTag,
        rotated.keyVersion,
        rotated.credentialSchemaVersion,
        input.occurredAt,
        input.tenantId,
        input.connectionId,
        currentEnvelope.ciphertext,
        currentEnvelope.nonce,
        currentEnvelope.authenticationTag,
        currentEnvelope.keyVersion,
        currentEnvelope.credentialSchemaVersion,
      ),
      this.db.prepare(`
        INSERT INTO audit_events (
          id, tenant_id, lead_id, actor_type, actor_id, action, actor_role,
          target_type, target_id, correlation_id, details_json, created_at
        )
        SELECT ?, tenant_id, NULL, 'system', 'connector-foundation',
          'provider_credentials_rotated', NULL, 'provider_connection', id, ?, ?, ?
        FROM provider_connections
        WHERE tenant_id = ? AND id = ? AND credential_key_version = ? AND updated_at = ?
        ON CONFLICT (tenant_id, correlation_id, action) DO NOTHING
      `).bind(
        auditId(),
        correlationId("credentials_rotated", input.connectionId),
        safeDetails({ result: "rotated" }),
        input.occurredAt,
        input.tenantId,
        input.connectionId,
        rotated.keyVersion,
        input.occurredAt,
      ),
    ]);
    if (changes(updated) !== 1 || changes(audited) !== 1) {
      throw new ProviderCredentialPersistenceError();
    }
    return this.reportMetadata(input.tenantId, input.connectionId);
  }

  async reportMetadata(
    tenantId: string,
    connectionId: string,
  ): Promise<SafeProviderConnectionMetadata> {
    const row = await this.assertOwned(tenantId, connectionId);
    return safeMetadata(row);
  }
}

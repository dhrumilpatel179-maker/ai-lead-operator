import type {
  SafeProviderConnectionMetadata,
  TokenStore,
  TokenStoreD1Database,
} from "../db/token-store";
import { ProviderCredentialPersistenceError } from "../db/token-store";
import type { CredentialPayload } from "./credential-encryption";

export interface ConnectionManager {
  createPendingConnection(input: {
    id: string;
    tenantId: string;
    provider: string;
    externalAccountId: string;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata>;
  activatePendingConnection(input: {
    tenantId: string;
    connectionId: string;
    syntheticCredentials: CredentialPayload;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata>;
  getConnectionMetadata(
    tenantId: string,
    connectionId: string,
  ): Promise<SafeProviderConnectionMetadata>;
  markReconnectRequired(input: {
    tenantId: string;
    connectionId: string;
    occurredAt: string;
    retainEncryptedCredentials?: boolean;
  }): Promise<SafeProviderConnectionMetadata>;
  replaceAfterSyntheticReauthorization(input: {
    tenantId: string;
    connectionId: string;
    syntheticCredentials: CredentialPayload;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata>;
  revokeConnection(input: {
    tenantId: string;
    connectionId: string;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata>;
}

function changes(result: { meta: { changes?: number } }): number {
  return result.meta.changes ?? 0;
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

export class D1ConnectionManager implements ConnectionManager {
  constructor(
    private readonly db: TokenStoreD1Database,
    private readonly tokenStore: TokenStore,
  ) {}

  async createPendingConnection(input: {
    id: string;
    tenantId: string;
    provider: string;
    externalAccountId: string;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata> {
    const id = requireIdentifier(input.id, "Connection ID");
    const tenantId = requireIdentifier(input.tenantId, "Tenant ID");
    const provider = requireIdentifier(input.provider, "Provider");
    const externalAccountId = requireIdentifier(
      input.externalAccountId,
      "External account ID",
    );
    const correlationId = `connection_created:${id}:${crypto.randomUUID()}`;
    const [created, audited] = await this.db.batch([
      this.db.prepare(`
        INSERT INTO provider_connections (
          id, tenant_id, provider, external_account_id, status, granted_scopes_json,
          credential_envelope_ciphertext, credential_envelope_nonce,
          credential_envelope_auth_tag, credential_key_version,
          credential_schema_version, reconnect_required_at, revoked_at,
          created_at, updated_at
        )
        SELECT ?, id, ?, ?, 'pending', '[]', NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, ?, ?
        FROM tenants
        WHERE id = ?
      `).bind(
        id,
        provider,
        externalAccountId,
        input.occurredAt,
        input.occurredAt,
        tenantId,
      ),
      this.db.prepare(`
        INSERT INTO audit_events (
          id, tenant_id, lead_id, actor_type, actor_id, action, actor_role,
          target_type, target_id, correlation_id, details_json, created_at
        )
        SELECT ?, tenant_id, NULL, 'system', 'connector-foundation',
          'provider_connection_created', NULL, 'provider_connection', id, ?,
          '{"status":"pending"}', ?
        FROM provider_connections
        WHERE tenant_id = ? AND id = ? AND status = 'pending'
          AND credential_envelope_ciphertext IS NULL
          AND credential_envelope_nonce IS NULL
          AND credential_envelope_auth_tag IS NULL
          AND credential_key_version IS NULL
          AND credential_schema_version IS NULL
        ON CONFLICT (tenant_id, correlation_id, action) DO NOTHING
      `).bind(
        `audit_${crypto.randomUUID()}`,
        correlationId,
        input.occurredAt,
        tenantId,
        id,
      ),
    ]);
    if (changes(created) !== 1 || changes(audited) !== 1) {
      throw new ProviderCredentialPersistenceError();
    }
    return this.tokenStore.reportMetadata(tenantId, id);
  }

  async activatePendingConnection(input: {
    tenantId: string;
    connectionId: string;
    syntheticCredentials: CredentialPayload;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata> {
    return this.tokenStore.storeEncryptedCredentials({
      tenantId: input.tenantId,
      connectionId: input.connectionId,
      credentials: input.syntheticCredentials,
      occurredAt: input.occurredAt,
    });
  }

  async getConnectionMetadata(
    tenantId: string,
    connectionId: string,
  ): Promise<SafeProviderConnectionMetadata> {
    return this.tokenStore.reportMetadata(tenantId, connectionId);
  }

  async markReconnectRequired(input: {
    tenantId: string;
    connectionId: string;
    occurredAt: string;
    retainEncryptedCredentials?: boolean;
  }): Promise<SafeProviderConnectionMetadata> {
    return this.tokenStore.markReconnectRequired(input);
  }

  async replaceAfterSyntheticReauthorization(input: {
    tenantId: string;
    connectionId: string;
    syntheticCredentials: CredentialPayload;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata> {
    return this.tokenStore.replaceCredentials({
      tenantId: input.tenantId,
      connectionId: input.connectionId,
      credentials: input.syntheticCredentials,
      occurredAt: input.occurredAt,
    });
  }

  async revokeConnection(input: {
    tenantId: string;
    connectionId: string;
    occurredAt: string;
  }): Promise<SafeProviderConnectionMetadata> {
    return this.tokenStore.revokeAndErase(input);
  }
}

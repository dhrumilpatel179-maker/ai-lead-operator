const AES_GCM_ALGORITHM = "AES-256-GCM";
const AES_KEY_BYTES = 32;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const CURRENT_CREDENTIAL_SCHEMA_VERSION = 1;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export const CREDENTIAL_KEY_ENV = Object.freeze({
  activeVersion: "PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION",
  keys: "PROVIDER_CREDENTIAL_KEYS_JSON",
});

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface CredentialPayload {
  credentialSchemaVersion: number;
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  grantedScopes: string[];
  providerAccountId: string;
  providerMetadata?: Record<string, JsonValue>;
}

export interface CredentialBinding {
  tenantId: string;
  connectionId: string;
  provider: string;
  credentialSchemaVersion: number;
}

export interface EncryptedCredentialEnvelope {
  algorithm: typeof AES_GCM_ALGORITHM;
  credentialSchemaVersion: number;
  keyVersion: string;
  ciphertext: string;
  nonce: string;
  authenticationTag: string;
}

export interface CredentialKeyEnvironment {
  PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION?: string;
  PROVIDER_CREDENTIAL_KEYS_JSON?: string;
}

type KeyConfiguration = {
  version: string;
  key: string;
};

export class CredentialConfigurationError extends Error {
  constructor(message = "Credential encryption configuration is invalid") {
    super(message);
    this.name = "CredentialConfigurationError";
  }
}

export class CredentialEnvelopeError extends Error {
  constructor(message = "Credential envelope is malformed or incomplete") {
    super(message);
    this.name = "CredentialEnvelopeError";
  }
}

export class CredentialAuthenticationError extends Error {
  constructor() {
    super("Credential envelope authentication failed");
    this.name = "CredentialAuthenticationError";
  }
}

export class CredentialKeyUnavailableError extends Error {
  constructor() {
    super("Credential encryption key version is unavailable");
    this.name = "CredentialKeyUnavailableError";
  }
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) {
    throw new CredentialEnvelopeError(`${label} is invalid`);
  }
  return normalized;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function decodeBase64Url(
  encoded: string,
  expectedLength?: number,
  configuration = false,
): Uint8Array {
  const fail = (): never => {
    if (configuration) throw new CredentialConfigurationError();
    throw new CredentialEnvelopeError();
  };
  if (
    typeof encoded !== "string"
    || encoded.length === 0
    || !BASE64URL_PATTERN.test(encoded)
    || encoded.includes("=")
  ) {
    return fail();
  }
  const padding = "=".repeat((4 - (encoded.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/") + padding);
  } catch {
    return fail();
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (
    (expectedLength !== undefined && bytes.length !== expectedLength)
    || encodeBase64Url(bytes) !== encoded
  ) {
    return fail();
  }
  return bytes;
}

function validateVersion(version: unknown, configuration = false): string {
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    if (configuration) throw new CredentialConfigurationError();
    throw new CredentialEnvelopeError();
  }
  return version;
}

function validateBinding(binding: CredentialBinding): CredentialBinding {
  if (
    binding.credentialSchemaVersion !== CURRENT_CREDENTIAL_SCHEMA_VERSION
    || !Number.isInteger(binding.credentialSchemaVersion)
  ) {
    throw new CredentialEnvelopeError("Credential schema version is unsupported");
  }
  return {
    tenantId: requireIdentifier(binding.tenantId, "Tenant ID"),
    connectionId: requireIdentifier(binding.connectionId, "Connection ID"),
    provider: requireIdentifier(binding.provider, "Provider"),
    credentialSchemaVersion: binding.credentialSchemaVersion,
  };
}

function validateIsoTimestamp(value: string): string {
  if (
    value.length > 64
    || Number.isNaN(Date.parse(value))
    || !/^\d{4}-\d{2}-\d{2}T/u.test(value)
  ) {
    throw new CredentialEnvelopeError("Access-token expiration is invalid");
  }
  return value;
}

function validateJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 8) return false;
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) return true;
  if (Array.isArray(value)) {
    return value.length <= 100 && value.every((entry) => validateJsonValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length <= 100
      && entries.every(([key, entry]) => (
        key.length > 0
        && key.length <= 128
        && validateJsonValue(entry, depth + 1)
      ));
  }
  return false;
}

export function validateCredentialPayload(payload: CredentialPayload): CredentialPayload {
  if (
    !payload
    || typeof payload !== "object"
    || payload.credentialSchemaVersion !== CURRENT_CREDENTIAL_SCHEMA_VERSION
  ) {
    throw new CredentialEnvelopeError("Credential payload version is invalid");
  }
  const refreshToken = payload.refreshToken?.trim();
  const accessToken = payload.accessToken?.trim();
  if (!refreshToken && !accessToken) {
    throw new CredentialEnvelopeError("Credential payload contains no usable credential");
  }
  if (refreshToken && refreshToken.length > 16_384) {
    throw new CredentialEnvelopeError("Refresh credential is invalid");
  }
  if (accessToken && accessToken.length > 16_384) {
    throw new CredentialEnvelopeError("Access credential is invalid");
  }
  if (accessToken && !payload.accessTokenExpiresAt) {
    throw new CredentialEnvelopeError("Access-token expiration is required");
  }
  if (!Array.isArray(payload.grantedScopes) || payload.grantedScopes.length === 0) {
    throw new CredentialEnvelopeError("At least one granted scope is required");
  }
  const scopes = [...new Set(payload.grantedScopes.map((scope) => requireIdentifier(scope, "Scope")))];
  if (scopes.length !== payload.grantedScopes.length || scopes.length > 100) {
    throw new CredentialEnvelopeError("Granted scopes are invalid");
  }
  if (
    payload.providerMetadata !== undefined
    && !validateJsonValue(payload.providerMetadata)
  ) {
    throw new CredentialEnvelopeError("Provider credential metadata is invalid");
  }
  const normalized: CredentialPayload = {
    credentialSchemaVersion: CURRENT_CREDENTIAL_SCHEMA_VERSION,
    grantedScopes: scopes,
    providerAccountId: requireIdentifier(payload.providerAccountId, "Provider account ID"),
  };
  if (refreshToken) normalized.refreshToken = refreshToken;
  if (accessToken) normalized.accessToken = accessToken;
  if (payload.accessTokenExpiresAt) {
    normalized.accessTokenExpiresAt = validateIsoTimestamp(payload.accessTokenExpiresAt);
  }
  if (payload.providerMetadata !== undefined) {
    normalized.providerMetadata = payload.providerMetadata;
  }
  if (new TextEncoder().encode(JSON.stringify(normalized)).length > 65_536) {
    throw new CredentialEnvelopeError("Credential payload is too large");
  }
  return normalized;
}

function additionalData(binding: CredentialBinding): Uint8Array {
  const normalized = validateBinding(binding);
  return new TextEncoder().encode(JSON.stringify({
    tenantId: normalized.tenantId,
    connectionId: normalized.connectionId,
    provider: normalized.provider,
    credentialSchemaVersion: normalized.credentialSchemaVersion,
  }));
}

function parseKeyConfiguration(encoded: string): KeyConfiguration[] {
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new CredentialConfigurationError();
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new CredentialConfigurationError();
  }
  const versions = new Set<string>();
  return value.map((entry) => {
    if (
      !entry
      || typeof entry !== "object"
      || Array.isArray(entry)
      || Object.keys(entry).sort().join(",") !== "key,version"
    ) {
      throw new CredentialConfigurationError();
    }
    const candidate = entry as Record<string, unknown>;
    const version = validateVersion(candidate.version, true);
    if (versions.has(version) || typeof candidate.key !== "string") {
      throw new CredentialConfigurationError();
    }
    versions.add(version);
    decodeBase64Url(candidate.key, AES_KEY_BYTES, true);
    return { version, key: candidate.key };
  });
}

export class CredentialKeyring {
  private readonly keys: ReadonlyMap<string, CryptoKey>;

  private constructor(
    readonly activeVersion: string,
    keys: ReadonlyMap<string, CryptoKey>,
  ) {
    this.keys = keys;
  }

  static async fromEnvironment(env: CredentialKeyEnvironment): Promise<CredentialKeyring> {
    const activeVersion = validateVersion(
      env.PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION,
      true,
    );
    if (!env.PROVIDER_CREDENTIAL_KEYS_JSON) {
      throw new CredentialConfigurationError();
    }
    const configuration = parseKeyConfiguration(env.PROVIDER_CREDENTIAL_KEYS_JSON);
    if (!configuration.some((entry) => entry.version === activeVersion)) {
      throw new CredentialConfigurationError();
    }
    const keys = new Map<string, CryptoKey>();
    for (const entry of configuration) {
      keys.set(entry.version, await crypto.subtle.importKey(
        "raw",
        asArrayBuffer(decodeBase64Url(entry.key, AES_KEY_BYTES, true)),
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      ));
    }
    return new CredentialKeyring(activeVersion, keys);
  }

  activeKey(): CryptoKey {
    const key = this.keys.get(this.activeVersion);
    if (!key) throw new CredentialKeyUnavailableError();
    return key;
  }

  decryptionKey(version: string): CryptoKey {
    const key = this.keys.get(validateVersion(version));
    if (!key) throw new CredentialKeyUnavailableError();
    return key;
  }
}

export class CredentialEncryptionService {
  constructor(private readonly keyring: CredentialKeyring) {}

  activeKeyVersion(): string {
    return this.keyring.activeVersion;
  }

  async encrypt(
    binding: CredentialBinding,
    payload: CredentialPayload,
  ): Promise<EncryptedCredentialEnvelope> {
    const normalizedPayload = validateCredentialPayload(payload);
    if (binding.credentialSchemaVersion !== normalizedPayload.credentialSchemaVersion) {
      throw new CredentialEnvelopeError("Credential schema versions do not match");
    }
    const nonce = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_BYTES));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: asArrayBuffer(additionalData(binding)),
        tagLength: AES_GCM_TAG_BYTES * 8,
      },
      this.keyring.activeKey(),
      asArrayBuffer(new TextEncoder().encode(JSON.stringify(normalizedPayload))),
    ));
    const tagOffset = encrypted.length - AES_GCM_TAG_BYTES;
    if (tagOffset <= 0) throw new CredentialEnvelopeError();
    return {
      algorithm: AES_GCM_ALGORITHM,
      credentialSchemaVersion: normalizedPayload.credentialSchemaVersion,
      keyVersion: this.keyring.activeVersion,
      ciphertext: encodeBase64Url(encrypted.slice(0, tagOffset)),
      nonce: encodeBase64Url(nonce),
      authenticationTag: encodeBase64Url(encrypted.slice(tagOffset)),
    };
  }

  async decrypt(
    binding: CredentialBinding,
    envelope: EncryptedCredentialEnvelope,
  ): Promise<CredentialPayload> {
    if (
      !envelope
      || envelope.algorithm !== AES_GCM_ALGORITHM
      || envelope.credentialSchemaVersion !== binding.credentialSchemaVersion
    ) {
      throw new CredentialEnvelopeError();
    }
    const ciphertext = decodeBase64Url(envelope.ciphertext);
    const nonce = decodeBase64Url(envelope.nonce, AES_GCM_NONCE_BYTES);
    const authenticationTag = decodeBase64Url(
      envelope.authenticationTag,
      AES_GCM_TAG_BYTES,
    );
    const sealed = new Uint8Array(ciphertext.length + authenticationTag.length);
    sealed.set(ciphertext);
    sealed.set(authenticationTag, ciphertext.length);
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: asArrayBuffer(nonce),
          additionalData: asArrayBuffer(additionalData(binding)),
          tagLength: AES_GCM_TAG_BYTES * 8,
        },
        this.keyring.decryptionKey(envelope.keyVersion),
        asArrayBuffer(sealed),
      );
    } catch (error) {
      if (error instanceof CredentialKeyUnavailableError) throw error;
      throw new CredentialAuthenticationError();
    }
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
    } catch {
      throw new CredentialEnvelopeError();
    }
    return validateCredentialPayload(payload as CredentialPayload);
  }
}

export const credentialSchemaVersion = CURRENT_CREDENTIAL_SCHEMA_VERSION;

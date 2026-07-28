# Provider Credential Foundations

This milestone supplies server-only credential encryption, storage, lifecycle,
and connection-management foundations. It does not implement OAuth routes,
provider API calls, inbound processing, Pub/Sub, attachment handling, or live
sending.

## Lifecycle

| Status | Credential envelope | Timestamp behavior | Allowed next operation |
| --- | --- | --- | --- |
| `pending` | All credential fields are `NULL` | `reconnect_required_at` and `revoked_at` are `NULL` | Activate with one complete encrypted credential payload, or revoke |
| `active` | Complete ciphertext, nonce, authentication tag, key version, and credential schema version are required | `revoked_at` is `NULL`; a prior reconnect timestamp may remain as history | Mark reconnect required, replace/rotate credentials, or revoke |
| `reconnect_required` | One complete envelope may be retained for controlled recovery, or all credential fields may be `NULL` | `reconnect_required_at` is required; `revoked_at` is `NULL` | Replace credentials and return to active, rotate a retained envelope, or revoke |
| `error` | One complete recoverable envelope or no envelope; partial envelopes are rejected | `revoked_at` is `NULL` | Replace/rotate credentials when present, or revoke |
| `revoked` | All credential fields are `NULL`; scopes and provider watch/history state are cleared | `revoked_at` is required | Safe metadata read only; credential and state-changing operations are rejected |

`revoked` is terminal for this foundation. A separate `disabled` state is not
needed: a future reconnection creates a new pending connection instead of
reviving erased credentials. Placeholder ciphertext and partial envelopes are
forbidden.

## Encryption

- AES-256-GCM through the Web Crypto API.
- A new 96-bit random nonce for every encryption and a 128-bit authentication
  tag.
- Authenticated additional data binds tenant ID, connection ID, provider, and
  credential schema version.
- The stored credential schema version is outside the ciphertext only so the
  same authenticated data can be reconstructed before decryption. It is not
  exposed to browser clients.
- The active key encrypts every new or changed envelope. Configured previous
  versions are decryption-only in practice because encryption never selects
  them.
- Authentication failures, malformed envelopes, missing keys, and unknown key
  versions fail closed.

## Server-side key contract

Both values are server-only secrets/bindings. They are optional until a server
code path first constructs the credential keyring; that first use validates the
complete configuration and fails closed.

```text
PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION=<active-version>
PROVIDER_CREDENTIAL_KEYS_JSON=[{"version":"<active-version>","key":"<base64url-encoded-32-random-bytes>"},{"version":"<previous-version>","key":"<base64url-encoded-32-random-bytes>"}]
```

Rules:

- versions are unique, explicit identifiers;
- exactly one configured version is selected as active;
- every key is exactly 32 bytes encoded as canonical unpadded base64url;
- the active version must exist in the key list;
- zero or more prior keys may remain for decryption during rotation;
- missing, malformed, duplicate, or unknown versions fail closed;
- values must never be placed in source, migrations, fixtures, committed
  configuration, audit records, or logs.

No real secret is configured by this milestone.

## Credential payload

The encrypted provider-neutral payload contains credential schema version,
provider account ID, granted scopes, optional provider metadata, and at least
one usable credential. An access token is stored only when operationally
required and then must include its expiration. Activation rejects an empty
credential payload, mismatched provider account identity, missing scopes,
unsupported schema version, or malformed metadata.

Decrypted payloads are returned only by the internal `TokenStore`; no browser
route or client API is added. Safe metadata contains only connection identity,
provider/account identity, status, scopes, watch expiration, lifecycle
timestamps, and created/updated timestamps.

## Audit

The D1 implementation records connection creation, credential storage and
replacement, reconnect-required state, rotation, revocation, completed
credential erasure, cross-tenant access denial, and decryption/authentication
failure. Audit details contain only operation outcomes and lifecycle metadata.
They never contain credential payloads, ciphertext, nonces, authentication
tags, key material, authorization codes, or token responses.

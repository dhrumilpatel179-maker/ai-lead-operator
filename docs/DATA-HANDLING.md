# Pilot Data Handling Summary

**Pre-activation status:** AI Lead Operator is a private simulation and is not approved for real customer data or live messaging. These controls are the minimum requirements for a customer pilot; activation is blocked until the retention/deletion jobs, support-access logging, incident process, and subprocessor list are configured and verified.

## Minimum data access

- Collect only the contact details, vehicle details, inquiry text or attachment, source, workflow status, and audit metadata needed to manage the lead.
- Do not request inbox-wide history, unrelated contacts, payment-card data, precise location history, or diagnostic records that are not needed for the inquiry.
- Any future inbox or calendar connection must use the narrowest approved scopes and a shop-owned account. Gmail, Calendar, OpenAI model access, Stripe, SMS, and live messaging are currently disconnected.
- Provider credentials, when a future connector is approved, must be stored only
  as authenticated encrypted envelopes under the lifecycle in
  `docs/PROVIDER-CREDENTIALS.md`. Revocation clears the entire envelope and
  provider watch/history state; browser clients receive safe metadata only.
- Tenant membership is derived on the server. Users may access only their assigned shop, and viewer accounts are read-only.

## Retention and deletion

- A written retention schedule must be accepted before activation. The proposed pilot defaults are: raw inquiry content and attachments deleted 30 days after lead closure; operational lead records deleted after 90 days; security/audit records retained for 12 months; expired backups removed within 30 additional days.
- The shop may request correction, export, or deletion through its designated support contact. Verified deletion requests must remove active records and enter the backup-expiry cycle; legal preservation requirements, if any, must be disclosed to the shop.
- No customer pilot may start until automated deletion and restoration/deletion behavior are tested against the hosted database.

## Support access

- Support has no standing access to a shop workspace. Access requires a documented support case, customer authorization, least-privilege role, time limit, and an audit event.
- Emergency security access must be limited to containment, reviewed afterward, and revoked when the incident is stabilized.

## Subprocessors

| Provider role | Pilot status |
| --- | --- |
| Private application hosting and authentication | Demonstration only; final provider and data region must be disclosed before activation |
| Supabase database and authentication | Staging workflow exists but has not run; not approved for customer data |
| Gmail, Google Calendar, OpenAI model API, Stripe, SMS or live-message providers | Not connected and not authorized |

The customer must receive the final named provider list, purpose, data location, and material-change notice terms before activation. Adding a provider requires a security/privacy review and customer approval when the agreement requires it.

## Incident response

1. Stop affected processing, revoke exposed credentials, and isolate the affected tenant or integration.
2. Preserve relevant audit evidence without expanding access to unrelated customer data.
3. Assess the data, tenants, time window, and likely impact; restore only from a verified clean state.
4. Notify affected customers without unreasonable delay and within any binding legal or contractual deadline, with known facts, containment steps, and required customer actions.
5. Document root cause, corrective actions, and follow-up testing before re-enabling the affected function.

This summary is an operational readiness document, not a claim that these controls are already deployed or legal advice. The signed pilot agreement and applicable law control if they require stricter terms.

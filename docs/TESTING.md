# Testing Strategy

## Automated layers

- Unit: extraction, authority classification, safe drafts, missing data, and red-block behavior.
- Contract: provider adapters return normalized inquiry/send/calendar results.
- Data access: every repository query is tenant-scoped; cross-tenant IDs fail closed.
- Integration: intake to persisted lead/draft/follow-up/audit; approval to outbound state.
- Adversarial security: cross-tenant identifiers, viewer writes, edited Red content, idempotent replay, immutable audit surface, and persistence rollback.
- Render: primary route builds and returns the expected product metadata/content.
- Manual responsive QA: desktop, tablet, and mobile; keyboard navigation and reduced motion.

## Required scenarios

| Scenario | Expected result |
| --- | --- |
| Oil change | Routine draft; ask for missing vehicle fields or appointment preference |
| Brake service | Draft; safety wording only when message indicates risk |
| Check-engine light | Approval required; no diagnosis |
| Missing vehicle | Ask year/make/model/mileage |
| After hours | Acknowledge and state approved hours; no false immediacy |
| Unsupported service | Human confirmation/referral wording |
| Guaranteed price | Approval required; no guarantee |
| Urgent safety | Red escalation; advise stopping driving/roadside help without diagnosis |
| Angry customer | Red human review |
| Duplicate | Link/dedupe; one follow-up sequence |
| Unresponsive customer | Follow-up due; stop after configured cadence |
| Calendar unavailable | Ask preferences; no commitment |
| Email failure | Remain unsent; visible error and safe retry |
| Model failure | Store inquiry; notify human; deterministic fallback |
| Unauthorized tenant | Generic denial; security audit; no data disclosure |

## Release gate

All Red-action, outbound-idempotency, provider-failure, deletion, cross-tenant, applied-RLS integration, backup/restore, and incident-response tests must pass before real customer data or live sending is enabled. The repository security suite does not substitute for testing the unapplied Postgres migration in a real Supabase project.

Run `npm run test:staging` for the staging-provisioning controls. That suite covers initial provisioning gates, recorded-project validation, project-created/migration-not-started recovery, wrong-project rejection, weak and duplicate passwords, safe reruns, paginated Auth lookup, paid-plan/stale-approval rejection, and immutable GitHub Action pins. Hosted Supabase checks validate the database only; they do not deploy or test the web application against Supabase.

# Testing Strategy

## Automated layers

- Unit: extraction, authority classification, safe drafts, missing data, and red-block behavior.
- Pilot inquiries: all 20 independent-review scenarios, including visible escalation reasons, immediate escalation, supported-language handling, attachment-only intake, deduplication, and Green/no-action feedback.
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
| Guaranteed price/completion or competitive quote | Red manager review; no guarantee or commitment |
| Urgent safety | Red escalation; advise stopping driving/roadside help without diagnosis |
| Angry customer | Red human review |
| Duplicate | Link/dedupe; one follow-up sequence |
| Supported-language uncertainty | Yellow review; do not claim unsupported language capability |
| Attachment with no text | Yellow review; do not infer or visually diagnose |
| Positive feedback | Green/no-action; store without a booking reply |
| Unresponsive customer | Follow-up due; stop after configured cadence |
| Calendar unavailable | Ask preferences; no commitment |
| Email failure | Remain unsent; visible error and safe retry |
| Model failure | Store inquiry; notify human; deterministic fallback |
| Unauthorized tenant | Generic denial; security audit; no data disclosure |

## Release gate

All Red-action, outbound-idempotency, provider-failure, deletion, cross-tenant, applied-RLS integration, backup/restore, and incident-response tests must pass before real customer data or live sending is enabled. The repository security suite does not substitute for testing the unapplied Postgres migration in a real Supabase project.

Run `npm run test:staging` for the staging-provisioning controls. That suite covers exact reviewed-commit enforcement before protected environment access, both documented approval models, initial provisioning gates, recorded-project and mandatory-region validation, project-created/migration-not-started recovery, repeated `resume`, repeated `validate`, deterministic full-fixture upserts, wrong-project rejection, weak and duplicate passwords, paginated Auth lookup, paid-plan/stale-approval rejection, immutable GitHub Action pins, and proof that the workflow runs all 20 pilot scenarios before hosted access. Hosted Supabase checks validate the new escalation/disposition fields and database controls only; they do not deploy or test the web application against Supabase.

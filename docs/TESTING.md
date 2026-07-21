# Testing Strategy

## Automated layers

- Unit: extraction, authority classification, safe drafts, missing data, and red-block behavior.
- Contract: provider adapters return normalized inquiry/send/calendar results.
- Data access: every repository query is tenant-scoped; cross-tenant IDs fail closed.
- Integration: intake to persisted lead/draft/follow-up/audit; approval to outbound state.
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

All red-action, outbound-idempotency, provider-failure, deletion, and cross-tenant tests must pass before real customer data or live sending is enabled.

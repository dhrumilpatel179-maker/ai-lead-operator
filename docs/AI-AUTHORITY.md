# AI Action-Permission Model

| Level | Permitted behavior | Enforcement |
| --- | --- | --- |
| Green | Acknowledge, request missing vehicle details, provide approved hours/services, routine follow-up, internal updates and summaries | May auto-send only when the tenant rule explicitly permits the action |
| Yellow | Appointment suggestions, approximate price language, ambiguous/unusual requests, complaints, policy questions | Draft only by default; named human must approve |
| Red | Diagnosis, safety-critical advice, guarantees, refunds, disputes, legal/financial commitments, threats, external data sharing | Server send adapter rejects; mandatory human escalation |

## Enforcement order

1. Classify the requested action with deterministic red rules.
2. Ask the model for structured content only within approved business context.
3. Validate model output for prohibited claims and missing fields.
4. Compare action to tenant-specific permission configuration.
5. Require approval when the level or confidence is uncertain.
6. Re-check authority server-side at send time.
7. Append an audit event regardless of success or rejection.

Lower confidence always moves upward in control: green to yellow, yellow to red/human. Model instructions can never lower an authority level selected by deterministic rules.

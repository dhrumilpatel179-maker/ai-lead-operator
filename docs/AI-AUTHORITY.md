# AI Action-Permission Model

| Level | Permitted behavior | Enforcement |
| --- | --- | --- |
| Green | Acknowledge, request missing vehicle details, provide approved hours/services, routine follow-up, internal updates and summaries | Auto-send is off by default and becomes available only for an action explicitly enabled in the tenant policy; this repository has no live transport |
| Yellow | Appointment changes, approximate price language, ambiguous/unusual requests, language/attachment review, fleet or policy questions | Draft only; named human must approve, with the escalation reason visible |
| Red | Diagnosis, safety-critical advice, guarantees, refunds, disputes, legal/financial commitments, threats, external data sharing | Server autonomous-action path rejects; mandatory human escalation with the reason visible |

## Enforcement order

1. Classify the requested action with deterministic red rules.
2. Ask the model for structured content only within approved business context.
3. Validate model output for prohibited claims and missing fields.
4. Compare action to tenant-specific permission configuration.
5. Require approval when the level or confidence is uncertain.
6. Re-check stored lead authority, stored draft authority, and edited outbound content server-side at send time.
7. Atomically persist approval, simulated send, outbound message, lead transition, follow-up, and audit event; a Red attempt persists only a blocked decision and audit event.

Lower confidence always moves upward in control: green to yellow, yellow to red/human. Model instructions can never lower an authority level selected by deterministic rules.

The current transport is simulation only. No email, calendar, model, payment, or customer-data integration is connected.

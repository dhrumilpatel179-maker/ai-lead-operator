# Assumptions, Costs, Credentials, and Risks

## Assumptions

- First customer is one independent shop/location with a small staff.
- Human approval remains on for all outbound messages during onboarding.
- The owner provides approved hours, services, prohibited claims, escalation contacts, follow-up cadence, and appointment rules.
- Billing begins with a $250 setup fee and $350/month managed service.

## Credentials still needed

- Production hosting/domain accounts and approval.
- Supabase project and production auth configuration.
- Google Cloud OAuth consent/client for Gmail and Calendar.
- Shop owner authorization for the specific inbox/calendar.
- OpenAI API project/key and budget limits.
- Stripe account and approved payment links/invoice settings.
- Encryption/secret-management key for OAuth refresh tokens.

## Cost envelope

Exact current vendor prices must be verified before purchase. Initial fixed infrastructure should stay near free/entry tiers; variable model/email usage should be capped per tenant. The managed-service margin should be reviewed after measuring messages per lead, support time, and conversion lift. No paid account should be created without owner approval.

## Unresolved risks

- The private demo's fixed tenant context is unsafe for real multi-tenant customer data.
- Email/calendar OAuth verification and provider policy may affect launch time.
- Automotive messages can contain safety issues; conservative escalation may reduce automation but protects the business and customer.
- Revenue attribution can be misleading without shop-confirmed booking and ticket data.
- Customer consent, privacy notice, retention, deletion, call/SMS rules, and AI disclosure require legal/business approval.
- Prompt injection from inbound messages must not alter policies, disclose data, or invoke tools.

## Required approval decisions

1. Approve production Supabase/Postgres RLS and external-auth direction before live customer onboarding.
2. Approve requested Google OAuth scopes before connecting a shop inbox/calendar.
3. Approve live outbound messaging and the shop-specific Green action list.
4. Approve privacy/retention terms and incident response ownership.

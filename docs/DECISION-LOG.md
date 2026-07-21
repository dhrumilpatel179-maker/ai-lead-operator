# Decision Log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-20 | Build the vertical slice before broader integrations | Fastest path to shop feedback and a paying customer |
| 2026-07-20 | Keep all outbound actions approval-first in the demo | Safer validation while shop-specific rules are unknown |
| 2026-07-20 | Use deterministic safety escalation before model output | Model content cannot weaken red controls |
| 2026-07-20 | Deploy a private sample-data demonstration | Enables sales demos without customer-data/OAuth exposure |
| 2026-07-20 | Require Postgres RLS before live multi-tenant data | Meets database-enforced tenant isolation requirement |
| 2026-07-20 | Keep Stripe manual with payment links/invoices | A subscription portal does not help obtain the first customer |
| 2026-07-21 | Use Sites SIWC plus database membership for the private security milestone | Removes anonymous/fixed-tenant access without introducing external OAuth scope |
| 2026-07-21 | Fail closed on persistence and membership errors | A simulated success must never mask a missing durable record |
| 2026-07-21 | Commit approval and simulated send artifacts atomically with idempotency | Prevents partial state, duplicate sends, and missing audit/follow-up records |
| 2026-07-21 | Keep Postgres RLS as an unapplied production migration | No Supabase project or customer-data authorization has been approved yet |

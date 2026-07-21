# Decision Log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-20 | Build the vertical slice before broader integrations | Fastest path to shop feedback and a paying customer |
| 2026-07-20 | Keep all outbound actions approval-first in the demo | Safer validation while shop-specific rules are unknown |
| 2026-07-20 | Use deterministic safety escalation before model output | Model content cannot weaken red controls |
| 2026-07-20 | Deploy a private sample-data demonstration | Enables sales demos without customer-data/OAuth exposure |
| 2026-07-20 | Require Postgres RLS before live multi-tenant data | Meets database-enforced tenant isolation requirement |
| 2026-07-20 | Keep Stripe manual with payment links/invoices | A subscription portal does not help obtain the first customer |

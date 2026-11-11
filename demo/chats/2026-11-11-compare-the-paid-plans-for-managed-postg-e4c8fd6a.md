---
{
  "id": "e4c8fd6a",
  "title": "Compare the paid plans for managed Postgres hosting from Neon, Supabase and…",
  "startedAt": "2026-11-11T08:54:34.234Z",
  "turns": [
    {
      "role": "user",
      "text": "Compare the paid plans for managed Postgres hosting from Neon, Supabase and Render for a small startup. What does each cost?",
      "at": "2026-11-11T08:54:34.234Z",
      "day": "2026-11-11"
    },
    {
      "role": "assistant",
      "text": "**Short answer:** Neon has no plan fee and bills per use; Supabase Pro and Render Pro are both $25/month for the workspace/plan, and Render adds Postgres from $6/month. For one always-on app with one database, Render's own examples are about $13/month (solo) or about $79/month (small team on Pro); Supabase Pro's $25 includes a $10 compute credit that covers one Micro database plus 8 GB of disk; Neon is cheapest only while usage stays low, since every CU-hour is billed.\n\n| | Neon | Supabase | Render |\n| --- | --- | --- | --- |\n| Plan fee | None, usage-based [14] | $25/mo Pro [20] | Pro workspace $25/mo [21] |\n| Postgres compute | $0.106/CU-hour Launch, $0.222/CU-hour Scale [15] | $10/mo credit covers one Micro [20] | Postgres from $6/mo [6] |\n| Storage | $0.35/GB-month [15] | 8 GB included, then $0.125/GB [20][30] | $0.30/GB-month expandable [23] |\n| Network transfer | 500 GB included, then $0.10/GB [34] | 250 GB included, then $0.09/GB [20][30] | 25 GB included on Pro, then $0.15/GB [22] |\n| Typical small-startup bill | Usage only, no minimum [18] | $25/mo plus overages [20] | About $13/mo solo, about $79/mo for a small team on Pro [6] |\n\n**Neon** — pay-as-you-go on Launch and Scale, with no minimum monthly fee; monthly minimums were removed in December 2025 [18][14]. Launch compute is $0.106 per CU-hour and Scale is $0.222 per CU-hour; storage is $0.35 per GB-month [15]. Launch and Scale include 500 GB of network transfer per project per month, then $0.10/GB [34]. Extra branches are $1.50 per branch-month [11]. The free tier gives 100 CU-hours and 1 GB of storage per project [15][18].\n\n**Supabase** — Pro is $25/month and includes 8 GB of disk per project, 250 GB of bandwidth and 100,000 monthly active users, plus daily backups kept 7 days [20][30]. Paid plans include $10/mo in compute credits, enough to cover one Micro instance [20]. Overage is $0.09/GB for egress and $0.125/GB for database disk [30].\n\n**Render** — the lowest paid workspace plan is Pro at $25/month [21], and Postgres starts at $6/month [6]. Web services start at $7/month for 512 MB [6]. Render's own examples: a solo always-on app with a database is about $13/month, and a small team on Pro with a 2 GB web service, Postgres and Key Value is about $79/month [6]. Pro includes 25 GB of bandwidth, then $0.15/GB [22]; Postgres expandable storage is listed at $0.30 per GB-month [23]. Note the free Postgres doesn't last: it expires 30 days after creation, with a 14-day grace period to upgrade before deletion [5].\n\n**What I couldn't confirm:** the evidence doesn't give a single headline monthly price for Neon — it depends entirely on CU-hours your database actually uses.",
      "at": "2026-11-11T08:56:12.982Z",
      "day": "2026-11-11",
      "answerId": "c932161e"
    }
  ]
}
---

<!-- The data is in the block above. This text is written from it, so edit the block instead. -->

# Compare the paid plans for managed Postgres hosting from Neon, Supabase and…

**You**, 11 Nov 2026, 08:54 UTC

Compare the paid plans for managed Postgres hosting from Neon, Supabase and Render for a small startup. What does each cost?

**minimi**, 11 Nov 2026, 08:56 UTC

**Short answer:** Neon has no plan fee and bills per use; Supabase Pro and Render Pro are both $25/month for the workspace/plan, and Render adds Postgres from $6/month. For one always-on app with one database, Render's own examples are about $13/month (solo) or about $79/month (small team on Pro); Supabase Pro's $25 includes a $10 compute credit that covers one Micro database plus 8 GB of disk; Neon is cheapest only while usage stays low, since every CU-hour is billed.

| | Neon | Supabase | Render |
| --- | --- | --- | --- |
| Plan fee | None, usage-based [14] | $25/mo Pro [20] | Pro workspace $25/mo [21] |
| Postgres compute | $0.106/CU-hour Launch, $0.222/CU-hour Scale [15] | $10/mo credit covers one Micro [20] | Postgres from $6/mo [6] |
| Storage | $0.35/GB-month [15] | 8 GB included, then $0.125/GB [20][30] | $0.30/GB-month expandable [23] |
| Network transfer | 500 GB included, then $0.10/GB [34] | 250 GB included, then $0.09/GB [20][30] | 25 GB included on Pro, then $0.15/GB [22] |
| Typical small-startup bill | Usage only, no minimum [18] | $25/mo plus overages [20] | About $13/mo solo, about $79/mo for a small team on Pro [6] |

**Neon** — pay-as-you-go on Launch and Scale, with no minimum monthly fee; monthly minimums were removed in December 2025 [18][14]. Launch compute is $0.106 per CU-hour and Scale is $0.222 per CU-hour; storage is $0.35 per GB-month [15]. Launch and Scale include 500 GB of network transfer per project per month, then $0.10/GB [34]. Extra branches are $1.50 per branch-month [11]. The free tier gives 100 CU-hours and 1 GB of storage per project [15][18].

**Supabase** — Pro is $25/month and includes 8 GB of disk per project, 250 GB of bandwidth and 100,000 monthly active users, plus daily backups kept 7 days [20][30]. Paid plans include $10/mo in compute credits, enough to cover one Micro instance [20]. Overage is $0.09/GB for egress and $0.125/GB for database disk [30].

**Render** — the lowest paid workspace plan is Pro at $25/month [21], and Postgres starts at $6/month [6]. Web services start at $7/month for 512 MB [6]. Render's own examples: a solo always-on app with a database is about $13/month, and a small team on Pro with a 2 GB web service, Postgres and Key Value is about $79/month [6]. Pro includes 25 GB of bandwidth, then $0.15/GB [22]; Postgres expandable storage is listed at $0.30 per GB-month [23]. Note the free Postgres doesn't last: it expires 30 days after creation, with a 14-day grace period to upgrade before deletion [5].

**What I couldn't confirm:** the evidence doesn't give a single headline monthly price for Neon — it depends entirely on CU-hours your database actually uses.

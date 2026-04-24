---
kind: concept
title: Two jobs the OS has to do well
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: [raw/research/2026-03-adoption-research.md]
related: [[three-layers]], [[four-loops]], [[signal-over-noise]]
---

# Two jobs the OS has to do well

Quoted from [`MISSION.md`](../../../MISSION.md):

> 1. **Build pipeline** — find, prioritise, and engage net-new accounts
>    that match this tenant's ICP, with cited briefs and ready-to-send
>    outreach.
> 2. **Manage existing customers** — keep a real-time read on portfolio
>    health, surface churn signals early, draft escalations, automate
>    weekly theme digests.

Everything we ship advances one of those two jobs. If a feature
doesn't, it gets cut. This is the **single hardest cut to make** —
every adjacent feature looks valuable in isolation, but each one
spreads attention thinner.

## Why two and not three

A common request is to add "team coaching" or "forecasting" or
"competitive intel" as standalone jobs. They aren't. They're outputs
of the two jobs:

- **Coaching** is a leadership-lens *surface* on top of the same
  agent — it reads the same ontology, calls the same tools, surfaces
  patterns from the same atoms. It's not a job; it's a viewpoint.
- **Forecasting** is what the agent does when asked "what's likely to
  close this month?" — it reads the deals + signals + win/loss themes
  and applies the same scoring engine. It's an output of the
  pipeline-management job.
- **Competitive intel** is a slice
  ([`apps/web/src/lib/agent/context/slices/competitor-plays.ts`](../../../apps/web/src/lib/agent/context/slices/competitor-plays.ts))
  that surfaces `competitor_play` memories. It's an *input* to both
  jobs.

If you can express a feature as "this is part of building pipeline"
or "this is part of managing existing customers", it stays. If you
can't, you have a third job and you should re-read [[signal-over-noise]].

## How this maps to the codebase

| Job | Primary surfaces | Primary workflows |
|---|---|---|
| Build pipeline | `pipeline-coach` surface, `/inbox`, Slack briefs | `derive-icp`, `mine-personas`, `mine-themes` (wins side), `priority-accounts` slice, `first-run` |
| Manage existing customers | `account-strategist` surface, `/accounts`, churn alerts | `churn-escalation`, `transcript-signals`, `mine-themes` (loss side), `champion-alumni-opportunities` slice, weekly digests |

The third surface, `leadership-lens`, is read-only intelligence over
both jobs — it does not introduce a third job.

## How this drives the [[second-brain]] design

Both jobs need cited, contextual answers fast. The second brain
exists because:

- **Job 1** (pipeline) needs the agent to know "what's worked before
  in this industry / for this persona / against this competitor". The
  per-tenant wiki pages on industries, personas, and competitors
  compile that knowledge once and serve it back in every brief.
- **Job 2** (existing customers) needs the agent to know "what
  signals predicted churn last quarter and who responded to which
  intervention". The reflection-weekly pages and the playbook pages
  compile that pattern.

Without the wiki, both jobs depend on slices re-deriving from atoms
on every turn. With the wiki, the agent reads compiled pages —
denser, cheaper, more confident.

## Sources

- [`MISSION.md`](../../../MISSION.md) §"Two jobs the system has to do well"
- [[adoption-research-2026]] — empirical case for "build for
  effectiveness, not efficiency" (Decision 1, the data behind the two
  jobs).

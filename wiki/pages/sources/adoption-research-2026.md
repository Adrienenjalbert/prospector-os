---
kind: source
title: "Adoption Research Report (March 2026)"
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: [raw/research/2026-03-adoption-research.md]
related: [[two-jobs]], [[signal-over-noise]], [[second-brain]], [[cite-or-shut-up]]
---

# Adoption Research Report (March 2026)

> **Source:** [`raw/research/2026-03-adoption-research.md`](../../raw/research/2026-03-adoption-research.md)
> (pointer to canonical [`docs/adoption-research-report.md`](../../../docs/adoption-research-report.md))
>
> **Captured:** 2026-04-24

## What it is

297-line synthesis from 8 web research queries on AI sales tool
adoption (2025–2026). Sourced from Vivun (n=511 reps), Pingd, a16z,
RevenueCat, Salesforce Ben, TechCrunch, Smashing Magazine, TLDL, GTM
Buddy, Clone-X, ROI Selling.

The report's purpose: explain why **87% adopt → 50–70% churn** and
what design decisions actually matter.

## So what for Prospector OS

Almost every operating principle in [`MISSION.md`](../../../MISSION.md)
traces back to evidence in this report:

| Principle | Evidence |
|---|---|
| [[two-jobs]] (build for effectiveness, not efficiency) | Decision 1: 63% of sellers prioritise AI for qualification, deal strategy, solution design, NOT admin automation |
| Per-tenant agents (not platform AI) | Decision 2: Salesforce Agentforce <2% weekly active; per-rep agents 3x pipeline growth |
| Slack-first, push over pull | Decision 3: Outreach's 33M weekly AI interactions show proactive intelligence outperforms reactive chatbots |
| [[cite-or-shut-up]] | Decision 4: only 7% feared AI replacing them; concerns are accuracy/transparency. Every recommendation needs a receipt. |
| [[signal-over-noise]] / progressive disclosure | Decision 5: layer info in 2–3 tiers; AI apps that dump everything see 30% faster annual churn |
| Time to first value ≤ 10 min | Mistake #1: every minute configuring is negative ROI |
| Smaller decisions per output | Mistake #2: 20 accounts surfaced without "which 3 to call first" = noise |
| Habit-loop measurement (citation rate, action invocation) | Mistake #3: DAU is a poor predictor; M3-to-M12 is what matters |

## How this drives the [[second-brain]]

The strongest case for Phase 6 comes from **Mistake #2** (cognitive
load):

> If the AI surfaces 20 accounts but doesn't tell the rep which 3 to
> call first and why, you've added noise. Every output must end with
> a smaller decision than the rep started with, not a larger one.

Today's slice load gives the agent 3 atoms × ~150 tokens with
disconnected citations. The rep ends up with three separate "look at
this", not one synthesised "here's the pattern, here's why".

A compiled wiki page (Phase 6) ends with a **smaller decision**: one
TL;DR, one Evidence section linking out, one Cross-links section
showing related pages. That's the report's prescription, made
mechanical.

## How this drives [[learning-loop]] design

**Mistake #3** (habit formation > feature usage):

> The best predictor [of retention] is whether the product creates a
> *repeatable habit loop* — trigger, routine, reward — matching its
> natural use frequency.

Translated to telemetry:

- The bandit posteriors update on **citations and action
  invocations**, not raw query count. (`memory_cited` strengthens the
  posterior more than `memory_injected` weakens it.)
- The KPI panel on `/admin/adaptation` reports citation rate, not DAU.
- The reflection workflow (Phase 6 §3.3) writes weekly observations
  on which memories are *being used* — which is a leading indicator
  of habit formation per this research.

## Quote worth marking

From the report's executive summary:

> The pattern: Universal adoption → rapid disillusionment →
> abandonment by month 4–6.

This is the **non-design** reason the OS exists. Anything that smells
like "another AI tool the rep has to manage" is failure-by-design. The
second brain is the strongest answer to this: it gets *quieter* as it
gets smarter. The rep sees fewer pages over time, not more, because
consolidation supersedes duplicates and decay archives stale ones.

## Applies to

- [[two-jobs]]
- [[signal-over-noise]]
- [[cite-or-shut-up]]
- [[second-brain]]
- [[learning-loop]]
- [[0002-two-level-second-brain]]

---
kind: source
title: "Strategic Review (April 2026)"
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: [raw/strategic-reviews/2026-04.md]
related: [[learning-loop]], [[second-brain]], [[universal-agent]], [[signal-over-noise]]
---

# Strategic Review (April 2026)

> **Source:** [`raw/strategic-reviews/2026-04.md`](../../raw/strategic-reviews/2026-04.md)
> (pointer to canonical [`docs/strategic-review-2026-04.md`](../../../docs/strategic-review-2026-04.md))
>
> **Captured:** 2026-04-24

## What it is

A 725-line forensic engineering & product audit of Revenue AI OS.
Every claim anchored to a file path and line range. The defining
artifact that drove Phase 1 (April 2026) and now Phase 6.

## So what for Prospector OS

This document defined **what was real** in the OS as of April 2026 and
**what was theatre**. Phase 1 closed the truthfulness gaps. Phase 6
addresses what was deferred:

- **Open loop #1**: `tenant_memories.embedding` never populated. →
  Phase 6 §1.1 (`runMemoriesEmbedder`).
- **Open loop #2**: `memory_injected` / `memory_cited` events
  declared but not emitted. → Phase 6 §1.2 (memory bandit telemetry).
- **Open loop #3**: `/admin/adaptation` has no memory-specific KPI
  panel. → Phase 6 §1.3.
- **Structural gap**: atoms accumulate without consolidation,
  supersession, or compilation. → Phase 6 Sections 2 + 3.

The seven moves from the TL;DR table that Phase 1 already shipped:

1. ✅ Fix the silently-broken learning loop.
2. ✅ Implement the prompt optimiser & self-improve LLM steps.
3. ✅ Move `commonBehaviourRules()` into the cacheable static prefix.
4. ✅ Replace the hallucinatory `runDeepResearch` cron.
5. ✅ Embed beyond transcripts (companies, signals, notes, exemplars,
   framework chunks).
6. ✅ Unify the two agent paths (Slack + dashboard).
7. ✅ Honest ROI (holdout-cohort exclusion).

## Why the Phase 6 gap was left until now

Reading the review's order of operations:

- Phase 1 was about **closing trust gaps** — every claim now has
  evidence behind it. The loop is real.
- Phase 6 is about **closing performance and structure gaps** — the
  loop emits events; now we use the events.

You can't compile pages from atoms if the atoms don't have embeddings
(can't dedup) and don't have bandit signal (can't rank). Phase 1's
foundations enable Phase 6's compounding.

## Key insight worth marking

The review's most-quoted line:

> If you ship only this list, monthly token spend drops 25–40%, the
> learning loop actually closes, ROI becomes defensible, and the
> "smart" claim becomes demonstrable rather than aspirational.

[[second-brain]] is what makes the "self-improving by default" claim
demonstrable rather than aspirational. The review proves the
foundations are there; Phase 6 builds the second floor.

## Applies to

- [[learning-loop]] — the broken-loop audit + remediation map.
- [[universal-agent]] — the agent runtime audit (model registry,
  prompt cache, model routing, the Slack-vs-dashboard parity story).
- [[signal-over-noise]] — the cost-discipline section's empirical
  numbers.
- [[second-brain]] — the gap analysis that motivated this whole
  Phase 6 plan.
- [[0002-two-level-second-brain]] — directly cited as the rationale.

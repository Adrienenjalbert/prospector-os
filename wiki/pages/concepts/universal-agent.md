---
kind: concept
title: One universal agent, multiple surfaces
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: [raw/strategic-reviews/2026-04.md]
related: [[three-layers]], [[four-loops]], [[learning-loop]], [[signal-over-noise]]
---

# One universal agent, multiple surfaces

Quoted from [`MISSION.md`](../../../MISSION.md):

> One universal agent presented through multiple **surfaces**
> (pipeline-coach, account-strategist, leadership-lens,
> onboarding-coach). The runtime, model, telemetry, citation engine,
> and workflow harness are shared; each surface picks a different
> prompt + tool subset based on `(role, active object)`.
>
> Surfaces are presets, not separate agents.

## The four surfaces

| Slug | Role | Primary objects | What it's for |
|---|---|---|---|
| `pipeline-coach` | AE | company, deal | "what should I do today to build pipeline?" |
| `account-strategist` | CSM, AM | company, contact | "what's the state of my book of business?" |
| `leadership-lens` | RevOps lead, CRO | tenant-wide | "where's the funnel breaking and what should we change?" |
| `onboarding-coach` | first-time user | none | "how do I get value in the first session?" |

Files:
- [`apps/web/src/lib/agent/agents/pipeline-coach.ts`](../../../apps/web/src/lib/agent/agents/pipeline-coach.ts)
- [`apps/web/src/lib/agent/agents/account-strategist.ts`](../../../apps/web/src/lib/agent/agents/account-strategist.ts)
- [`apps/web/src/lib/agent/agents/leadership-lens.ts`](../../../apps/web/src/lib/agent/agents/leadership-lens.ts)
- [`apps/web/src/lib/agent/agents/_shared.ts`](../../../apps/web/src/lib/agent/agents/_shared.ts) — shared behaviour rules

## What "preset" means

Each surface is a thin file that exports:

- The system prompt for that role
- The allow-list of tool slugs it can call
- The default context strategy (`rep_centric`, `account_centric`, etc.)
- Any role-specific behavior overrides (e.g. leadership-lens cannot
  call write tools; onboarding-coach cannot call CRM tools)

Everything else is shared:

- The streaming runtime in [`apps/web/src/app/api/agent/route.ts`](../../../apps/web/src/app/api/agent/route.ts)
  (one entry point — Slack, web chat, action panel all flow through here)
- The model registry in [`apps/web/src/lib/agent/model-registry.ts`](../../../apps/web/src/lib/agent/model-registry.ts)
- The citation engine in [`apps/web/src/lib/agent/context/packer.ts`](../../../apps/web/src/lib/agent/context/packer.ts)
- The compaction logic in [`apps/web/src/lib/agent/compaction.ts`](../../../apps/web/src/lib/agent/compaction.ts)
- The behavior rules in [`apps/web/src/lib/agent/agents/_shared.ts`](../../../apps/web/src/lib/agent/agents/_shared.ts)
  (cite-or-shut-up, ≤150 words for short-form, max 3 next-step buttons)

## Why this matters (and what fails when violated)

Per [[strategic-review-2026-04]] §6, the Slack route at
[`apps/web/src/app/api/slack/events/route.ts`](../../../apps/web/src/app/api/slack/events/route.ts)
was **a parallel runtime** for months: hardcoded Haiku, no prompt
cache, fewer tools, no Context Pack, no compaction. Two products to
maintain. Two sources of behaviour drift.

Phase 1 (April 2026) fixed this with `assembleAgentRun` in
[`apps/web/src/lib/agent/run-agent.ts`](../../../apps/web/src/lib/agent/run-agent.ts)
— a parity test in CI gates that any Slack-vs-dashboard divergence is
intentional, not accidental.

The rule: **never add a new "agent type"**. New capability = new tool,
new context strategy, or a new surface preset. Anything else means
the wrong thing got built.

## How the [[second-brain]] interacts

The second brain doesn't change the agent's runtime. It changes what
the agent **reads** through slices:

- Slices like
  [`apps/web/src/lib/agent/context/slices/icp-snapshot.ts`](../../../apps/web/src/lib/agent/context/slices/icp-snapshot.ts)
  load `wiki_pages` first, atoms as fallback.
- The agent cites both atom URNs and `wiki_page` URNs the same way.
- Per-memory and per-page bandit posteriors update on every cited turn.

All four surfaces benefit from the same wiki because all four use the
same slice contract. Adding a new surface (say, `partnership-lens`
for channel managers) costs one file: new prompt + new tool subset +
slice strategy. The wiki is already there.

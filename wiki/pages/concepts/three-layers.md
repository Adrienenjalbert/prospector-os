---
kind: concept
title: The three compounding layers (context, agent, learning)
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: []
related: [[two-jobs]], [[universal-agent]], [[learning-loop]], [[ontology-and-urns]]
---

# The three compounding layers

Three layers stacked on top of each other. Each one compounds the
others.

```
LEARNING — event sourcing, mining, calibration ledger, attribution
   ▲
AGENT   — one runtime, four surfaces, tool registry, context pack
   ▲
CONTEXT — canonical Postgres ontology, urn:rev addressing, embeddings
```

Drop any one and the OS becomes "just another AI sales tool".

## 1. Context layer

A canonical Postgres ontology (`company`, `contact`, `deal`, `signal`,
`transcript`, `activity`, `health`) with `urn:rev:` addressing for
every object. One vector store. One source of truth a rep, an agent,
and a workflow can all cite.

See [[ontology-and-urns]] for the URN format and the citation
contract.

Files:
- [`packages/core/src/types/ontology.ts`](../../../packages/core/src/types/ontology.ts)
- [`packages/core/src/types/urn.ts`](../../../packages/core/src/types/urn.ts)
- [`packages/db/migrations/`](../../../packages/db/migrations/)

## 2. Agent layer

One universal agent presented through four **surfaces**
(pipeline-coach, account-strategist, leadership-lens, onboarding-coach).
Same runtime, same model selection logic, same telemetry, same
citation engine, same workflow harness. Each surface picks a
different prompt + tool subset based on `(role, active object)`.

See [[universal-agent]] for the surface = preset rule.

Files:
- [`apps/web/src/app/api/agent/route.ts`](../../../apps/web/src/app/api/agent/route.ts) — single entry point.
- [`apps/web/src/lib/agent/agents/`](../../../apps/web/src/lib/agent/agents/) — surface presets.
- [`apps/web/src/lib/agent/tools/`](../../../apps/web/src/lib/agent/tools/) — tool registry.
- [`apps/web/src/lib/agent/context/`](../../../apps/web/src/lib/agent/context/) — slice-based context pack.

## 3. Learning layer

Every interaction (citation click, action invocation, thumbs, CRM
outcome) is event-sourced. Nightly workflows mine exemplars, propose
prompt diffs, calibrate scoring weights, cluster failures, write
attributions.

See [[learning-loop]] for the closed-loop detail.

Files:
- [`packages/core/src/telemetry/events.ts`](../../../packages/core/src/telemetry/events.ts) — event API.
- [`apps/web/src/lib/workflows/`](../../../apps/web/src/lib/workflows/) — mining + calibration workflows.
- [`apps/web/src/app/(dashboard)/admin/calibration/`](../../../apps/web/src/app/(dashboard)/admin/calibration/) — ledger UI.

## Why this stacking matters

- **Context without agent** = a vector store with no consumer. Useful
  for search; not for "what should I do today?".
- **Agent without context** = a chatbot that re-derives the world on
  every turn. Burns tokens; can't cite; hallucinates names and
  numbers.
- **Agent + context without learning** = a smart assistant that never
  improves. Gets the same complaints in month 6 as in month 1.
- **All three** = compounding intelligence per tenant. Each week of
  use makes the next week's assistant measurably better, because the
  context gets richer (more transcripts, more outcomes), the agent
  gets sharper (calibrated weights, mined exemplars, optimized
  prompts), and the learning loop catches what's working from real
  use.

## Where the [[second-brain]] sits

The [[second-brain]] is a substrate the **context layer** owns and the
**agent layer** consumes:

- The wiki pages live in the context layer (Postgres tables with RLS).
- Agent slices read them in the agent layer.
- The compile/lint/reflect workflows are part of the learning layer
  (they emit calibration ledger entries when auto-promoting).

So the second brain is not a new layer — it's a structural upgrade to
the existing three.

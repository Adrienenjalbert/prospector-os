---
kind: concept
title: Cite or shut up
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: []
related: [[ontology-and-urns]], [[second-brain]], [[learning-loop]], [[signal-over-noise]]
---

# Cite or shut up

Every claim links to its source object. No exceptions, no honor
system, mechanically enforced.

Quoted from [`MISSION.md`](../../../MISSION.md):

> **Cite or shut up.** Every claim links to the source object. Every
> tool returns `{ data, citations }`. No invented numbers, no invented
> names.

## Why this is non-negotiable

From [[adoption-research-2026]] Decision 4:

> Reps act on recommendations when they understand the reasoning —
> "stakeholder silence 14 days, competitor mention" beats a vague risk
> score. Smashing Magazine's agentic AI UX research identifies
> "Explainable Rationale" and "Confidence Signals" as mandatory
> in-action patterns.

Every recommendation needs a **receipt**. Without it, the rep cannot
verify, the agent cannot improve from feedback, and the OS becomes
indistinguishable from any other AI sales tool that hallucinates.

## How it's enforced (today)

### 1. At the tool boundary

Every tool returns `{ data: T, citations: Citation[] }`. The handler
in
[`apps/web/src/lib/agent/tools/handlers.ts`](../../../apps/web/src/lib/agent/tools/handlers.ts)
attaches citations from the result via the citation extractor in
[`apps/web/src/lib/agent/citations.ts`](../../../apps/web/src/lib/agent/citations.ts).
A tool that returns data without citations fails CI via the validator
in [`scripts/validate-events.ts`](../../../scripts/validate-events.ts).

### 2. At the slice boundary

Every slice returns `{ rows, citations, provenance, ... }`. The slice
contract in
[`apps/web/src/lib/agent/context/types.ts`](../../../apps/web/src/lib/agent/context/types.ts)
makes `citations: PendingCitation[]` non-optional. A slice that
forgot citations fails the slice-test pattern.

### 3. At the agent response

Every agent surface's prompt instructs it to wrap URNs in backticks
inline (`` `urn:rev:abc:company:f0e4` ``). The citation pill UI
component
([`apps/web/src/components/agent/citation-pills.tsx`](../../../apps/web/src/components/agent/citation-pills.tsx))
parses these and renders deep-links. URNs that don't resolve fall
through and are visible to QA.

### 4. At the telemetry

The packer's URN walker
([`apps/web/src/lib/agent/context/packer.ts`](../../../apps/web/src/lib/agent/context/packer.ts) —
`consumedSlicesFromResponse`) intersects URNs in the assistant text
with URNs from each slice's markdown and emits
`context_slice_consumed`. After [[phase-6-second-brain]], the same
walker emits `memory_cited` and `wiki_page_cited`.

### 5. At the eval gate

Every CI run executes the eval suite (`apps/web/src/evals/cli.ts`).
The judge ([`apps/web/src/evals/judge.ts`](../../../apps/web/src/evals/judge.ts))
checks for inline URNs as part of the citation rate. Below threshold
fails the build.

## Where the [[second-brain]] thickens this

The wiki layer doubles down on cite-or-shut-up:

- **Atoms cite their evidence URNs** in `tenant_memories.evidence`
  (the derive-icp workflow stores the won-deal URNs that produced an
  `icp_pattern`).
- **Wiki pages cite atom URNs and raw URNs** in their `body_md`
  markdown — every "TL;DR" and "Evidence" section quotes URNs
  inline.
- **The compileWikiPages workflow's Sonnet schema** requires `≥3
  source citations per page` as a quality criterion (lint runs the
  self-eval).
- **Wikilinks `[[other-page]]`** are themselves a form of citation —
  a page that says "see also our manufacturing playbook" links the
  rep to verifiable context.

The wiki cannot be a hallucination amplifier because the compile step
has citation as a hard schema requirement.

## What this is NOT

- **Not a footnotes system.** Citations are inline URN tokens; they
  render as pills. A footnote at the bottom would not get clicked.
- **Not optional in low-confidence answers.** "I'm not sure" is fine.
  "I think Acme uses Workday but I have no source" is not.
- **Not bypassable for "common knowledge".** Even claims like "MEDDPICC
  is a B2B framework" link to the framework_chunk URN.
- **Not visible only to rep mode.** Admin and leadership surfaces
  carry citations too. Anything else degrades trust over time.

## Failure modes

| Failure | Where it shows up | Fix |
|---|---|---|
| Tool returns data without citations | Slice load logs warning, eval drops citation rate | Update tool handler to extract |
| Agent response with no URNs | Citation pill component shows empty state, eval flags | Update surface prompt |
| URN that doesn't resolve | Citation pill renders a broken deep-link | Run `lintWiki` (after Phase 6) for `wiki_page` URNs; for object URNs, check the slice's evidence sourcing |
| Slice's markdown URNs ≠ packer's extracted URNs | `context_slice_consumed` never emits for that slice → slice bandit can't update | Use `urn.x(tenantId, id)` helpers, never hand-format URNs |

## Sources

- [`MISSION.md`](../../../MISSION.md) §"Operating principles"
- [[adoption-research-2026]] Decision 4
- [[strategic-review-2026-04]] §3 (the broken slice calibration was a
  cite-or-shut-up failure mode at the telemetry layer).

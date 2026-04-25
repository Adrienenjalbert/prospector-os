---
kind: log
title: Wiki index
created: 2026-04-24
updated: 2026-04-24
---

# Index

The catalog of every page in this wiki. The agent updates this on
every ingest and every page creation. Browse in Obsidian for the graph
view; this file is for grep + agents that want a flat catalog.

## Decisions (`pages/decisions/`)

Architectural decisions, numbered, dated, immutable once accepted.

| # | Title | Status | Date |
|---|-------|--------|------|
| 0001 | [[0001-transcript-provider]] — Default to Fireflies for new tenants | accepted | 2026-04-19 |
| 0002 | [[0002-two-level-second-brain]] — Compile atoms into wiki pages; develop a project wiki at `/wiki/` | accepted | 2026-04-24 |

## Concepts (`pages/concepts/`)

The first-class ideas in Prospector OS. The vocabulary the agent must
share with me.

| Slug | One-line summary |
|------|------------------|
| [[two-jobs]] | The OS does exactly two things: build pipeline and manage existing customers. Everything else is feature creep. |
| [[three-layers]] | Context → Agent → Learning. Each layer compounds the others. |
| [[four-loops]] | Capture → Score → Act → Learn. Independent. If one is down, the others ship value. |
| [[universal-agent]] | One runtime, four surfaces (presets). Surfaces are configuration, not new code. |
| [[learning-loop]] | Event-sourced telemetry → nightly mining → calibration ledger → human-approved adaptation. |
| [[second-brain]] | The two-level Karpathy wiki: per-tenant compiled `wiki_pages` + this developer `/wiki/`. |
| [[ontology-and-urns]] | One canonical Postgres ontology, `urn:rev:` addresses, every claim cites by URN. |
| [[signal-over-noise]] | Adoption is the product. Subtraction beats addition. |
| [[cite-or-shut-up]] | Every claim links to the source object. No uncited numbers, ever. |

## Sources (`pages/sources/`)

Summaries of ingested raw sources, with takeaways and pointers to
which concept pages they touched.

| Slug | What it is |
|------|-----------|
| [[karpathy-llm-wiki]] | The original LLM Wiki gist (April 2026). Defines the compile-once-keep-current pattern. |
| [[llm-wiki-v2]] | rohitg00's extension. Adds lifecycle, confidence, knowledge graph, hybrid search. |
| [[obsidian-second-brain-2026]] | Synthesis of 2026 research on Obsidian + AI agent workflows. |
| [[strategic-review-2026-04]] | Forensic audit of the OS: 7 moves that change the curve. |
| [[adoption-research-2026]] | Why 87% of AI sales tools get adopted but 50–70% churn. The 5 design decisions and 3 fatal mistakes. |

## Projects (`pages/projects/`)

Multi-week initiatives — the plan, open todos, decisions made along
the way.

| Slug | Status |
|------|--------|
| [[phase-6-second-brain]] | Active — implementing the two-level Karpathy wiki. |

## Raw sources (`raw/`)

The immutable layer. The agent reads these but never modifies them.

| Path | What it is |
|------|-----------|
| `raw/external/karpathy-llm-wiki.md` | Karpathy's gist (text only, comments stripped) |
| `raw/external/llm-wiki-v2.md` | rohitg00's gist |
| `raw/external/obsidian-second-brain-research.md` | Compiled research summary |
| `raw/strategic-reviews/2026-04.md` | Mirror of `docs/strategic-review-2026-04.md` |
| `raw/research/2026-03-adoption-research.md` | Mirror of `docs/adoption-research-report.md` |

## See also

- [[CLAUDE]] — the schema for this wiki
- [`log.md`](log.md) — chronological record
- [`MISSION.md`](../MISSION.md) — the OS mission
- [`docs/prd/`](../docs/prd/) — the canonical PRDs

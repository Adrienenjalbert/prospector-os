---
kind: concept
title: The two-level second brain
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: [raw/external/karpathy-llm-wiki.md, raw/external/llm-wiki-v2.md, raw/external/obsidian-second-brain-research.md]
related: [[three-layers]], [[learning-loop]], [[ontology-and-urns]], [[universal-agent]], [[phase-6-second-brain]], [[0002-two-level-second-brain]]
---

# The two-level second brain

The architectural pattern, applied at two levels of this codebase. The
heart of Phase 6 (see [[phase-6-second-brain]]) and the rationale for
this very wiki.

## The pattern (Karpathy + Wiki v2)

Three layers stacked, three operations against them:

```
Layer        | Owner   | Role
-------------|---------|--------------------------------------
Schema       | Both    | Tells the LLM how the wiki works
Wiki pages   | LLM     | Compiled, interlinked, kept current
Raw sources  | Human   | Immutable, the source of truth

Operations: ingest → query → lint
```

Plus the lifecycle from [[llm-wiki-v2]]:

- **Confidence scoring** — every claim knows how many sources support it
- **Supersession** — new claims explicitly replace old ones, history kept
- **Forgetting (Ebbinghaus)** — facts not reinforced gradually decay
- **Consolidation tiers** — working → episodic → semantic → procedural

The insight: **stop re-deriving on every query, start compiling once
and keeping current**. The wiki is a persistent, compounding artifact;
the cross-references are already there; the contradictions have
already been flagged.

## Level 1 — Per-tenant SaaS wiki (the heart of the OS)

The customer-facing application of the pattern.

| Karpathy layer | This OS implementation |
|---|---|
| Raw sources | `companies` / `deals` / `signals` / `transcripts` (the canonical Postgres ontology, see [[ontology-and-urns]]) |
| Atoms (LLM Wiki v2 addition) | `tenant_memories` rows, written by 8 nightly miners |
| Wiki pages | `wiki_pages` rows, compiled nightly by `compileWikiPages` (Phase 6) |
| Schema | `tenant_wiki_schema.body_md` per tenant (the per-tenant `CLAUDE.md`) |

Operations:

- **Ingest** — the 8 mining workflows already run nightly. They
  produce atoms.
- **Compile** — `compileWikiPages` (new in Phase 6) clusters atoms by
  entity and emits 1 wiki page per entity with YAML frontmatter,
  `[[wikilinks]]`, and inline citation URNs.
- **Query** — agent slices read pages first (richer, denser), atoms
  as fallback. The agent cites by URN.
- **Lint** — `lintWiki` (new) catches orphans, broken links, decay,
  contradictions, missing pages. Quality scoring on each page.
- **Reflect** — `reflectMemories` weekly writes cross-deal observations
  as new pages.

UX:

- `/admin/wiki` — page browser, graph view, conflict inbox, schema
  editor.
- `/admin/wiki/export` — `.zip` bundle viewable in Obsidian.

Lifecycle:

- `tenant_memories.confidence` and `wiki_pages.confidence` already
  carry the score.
- `tenant_memories.superseded_by` already exists; `wiki_pages` gets
  the same column.
- Decay scoring with kind-specific half-lives (180d default, 30d
  glossary, 90d competitor_play, 120d wiki pages).
- `memory_edges` table provides typed graph relationships
  (`derived_from`, `supersedes`, `contradicts`, `related_to`,
  `cites`, `see_also`).

This is the part that makes the OS *actually* compound knowledge per
tenant — not just store it. The full plan is in
[[phase-6-second-brain]].

## Level 2 — Developer wiki (this `wiki/` folder)

The same pattern, applied to building Prospector OS itself.

| Karpathy layer | This developer wiki |
|---|---|
| Raw sources | [`wiki/raw/`](../../raw/) — gists, strategic reviews, research, customer interviews |
| Wiki pages | [`wiki/pages/`](../../pages/) — decisions, concepts, sources, projects |
| Schema | [[CLAUDE]] — the schema you (the agent) read on every session |

Operations:

- **Ingest** — I drop a source into [`wiki/raw/`](../../raw/), tell
  Cursor "ingest this", the agent writes a `pages/sources/` summary
  and updates relevant `pages/concepts/` pages. Logs to
  [`wiki/log.md`](../../log.md).
- **Query** — I ask a question in chat. The agent reads
  [[index]] first, then drills into pages. Synthesises with citations.
  If the answer is reusable, files it back as a new page.
- **Lint** — Friday weekly. Orphans, broken links, stale claims,
  contradictions, missing pages.

No automation: this level is manual + agent-assisted because (a) it's
small, (b) the cost of a custom workflow exceeds the cost of asking
Cursor, and (c) the audience is one human (me).

## Why both levels share the same pattern

Symmetry is the whole point.

| Dimension | Per-tenant level | Developer level |
|---|---|---|
| Substrate | Postgres tables | Markdown files |
| Agent | Server-side, slice-driven | Cursor / Claude Code |
| Schema | `tenant_wiki_schema` row | `wiki/CLAUDE.md` file |
| Compile | `compileWikiPages` workflow | Cursor on request |
| Lint | `lintWiki` workflow nightly | Cursor on Friday |
| Audit | `agent_events` + `calibration_ledger` | git log |
| Viewer | `/admin/wiki` UI | Obsidian opening `wiki/` as vault |
| Export | `.zip` bundle | already files |

The schema conventions, the page kinds vocabulary, the supersession
rules, the decay model, the citation contract — all transferable
between the two levels. If something works at one level and not the
other, that's a signal the pattern is being violated.

## What this is NOT

- **Not a knowledge graph database.** The graph is a thin layer
  (`memory_edges` at the SaaS level, `[[wikilinks]]` at the dev
  level). No Neo4j. No graph traversal as the primary query mode.
- **Not a vector store.** The vector layer is one of several signals
  (`match_memories` RPC) but not the primary access path. Slices and
  pages-first reads dominate.
- **Not a chat memory.** Chat history is ephemeral (compaction handles
  it). The second brain is durable, structured, and event-sourced.
- **Not a wiki in the Wikipedia sense.** No multiple human editors,
  no consensus-building, no talk pages. The agent maintains it; the
  human curates and approves.
- **Not a replacement for [`MISSION.md`](../../../MISSION.md) or
  [`docs/prd/`](../../../docs/prd/).** Those are the canonical
  human-authored docs at the developer level. The wiki summarises and
  cross-references them.

## Sources

- [[karpathy-llm-wiki]] — the core pattern.
- [[llm-wiki-v2]] — the lifecycle additions (confidence, supersession,
  decay, knowledge graph, hybrid search, automation, quality scoring,
  multi-agent, privacy, crystallization).
- [[obsidian-second-brain-2026]] — the `CLAUDE.md` + Obsidian-as-viewer
  pattern.
- [[strategic-review-2026-04]] — the gap analysis that motivated
  Phase 6.
- [[adoption-research-2026]] — the empirical case for compiled pages
  over raw atoms (Mistake #2, cognitive load).

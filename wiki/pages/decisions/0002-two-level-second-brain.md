---
kind: decision
title: "0002 — Two-level second brain (Karpathy + Wiki v2 + Obsidian)"
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: [raw/external/karpathy-llm-wiki.md, raw/external/llm-wiki-v2.md, raw/external/obsidian-second-brain-research.md, raw/strategic-reviews/2026-04.md]
related: [[second-brain]], [[learning-loop]], [[ontology-and-urns]], [[phase-6-second-brain]]
---

# 0002 — Two-level second brain (Karpathy + Wiki v2 + Obsidian)

> **Status:** Accepted
> **Date:** 2026-04-24
> **Decider:** Founder + Cursor session
> **Plan ref:** Two-Level Second Brain plan (`.cursor/plans/two-level-second-brain_8c3fb731.plan.md`)

## Context

The OS already has a per-tenant memory substrate
([`packages/db/migrations/021_tenant_memories.sql`](../../../packages/db/migrations/021_tenant_memories.sql))
with 9 atom kinds and 8 nightly mining workflows. Three loops are
open (per the [[strategic-review-2026-04]]):

1. `tenant_memories.embedding` is never populated (no embedder pipeline).
2. `prior_alpha` / `prior_beta` exist but `memory_injected` /
   `memory_cited` events are never emitted, so the per-memory bandit
   has nothing to learn from.
3. `/admin/memory` shows inventory but `/admin/adaptation` has no
   "what we learned this week" memory panel.

Plus a structural gap: atoms are unstructured rows. After 30 days a
tenant accumulates thousands of `tenant_memories` with duplicates,
superseded versions, and contradictions. The slices grow unboundedly
and `/admin/memory` becomes unreadable.

[[karpathy-llm-wiki]] (April 2026) and [[llm-wiki-v2]] (rohitg00,
April 2026) both pointed to the same answer: **stop re-deriving, start
compiling**. Compile atoms into a structured wiki of interlinked
markdown pages. Apply confidence scoring, supersession, Ebbinghaus
decay, and consolidation tiers (working / episodic / semantic /
procedural).

[[obsidian-second-brain-2026]] showed the pattern at the developer
level too: `CLAUDE.md` schema + Obsidian as viewer + LLM as
maintainer.

## Decision

Apply the Karpathy LLM Wiki pattern at **two levels** in this codebase:

1. **Per-tenant SaaS layer (the heart of the OS).** Extend
   `tenant_memories` with:
   - `wiki_pages` table — compiled, interlinked markdown pages with
     YAML frontmatter, `[[wikilinks]]`, and citation URNs.
   - `memory_edges` table — typed graph (`derived_from`,
     `supersedes`, `contradicts`, `related_to`, `cites`,
     `see_also`).
   - `tenant_wiki_schema` table — per-tenant `CLAUDE.md` content the
     LLM compiles against and co-evolves.
   - `compileWikiPages` workflow nightly — clusters atoms by entity
     and emits 1 page per entity.
   - `lintWiki` workflow nightly — orphans, broken links, decay,
     quality scoring, contradiction surfacing.
   - `/admin/wiki` UI — page browser, graph view, conflict inbox,
     schema editor.
   - Slice refactor — slices read `wiki_pages` first (richer, denser),
     atoms only as fallback.
   - Per-tenant Obsidian export — `.zip` bundle viewable in Obsidian.

2. **Developer layer (this `wiki/` folder).** A Karpathy-style markdown
   wiki at the repo root for the founder and any AI agent (Cursor,
   Claude Code) maintaining Prospector OS itself:
   - [[CLAUDE]] — the schema.
   - `raw/` — immutable sources (gists, strategic reviews, research).
   - `pages/` — LLM-maintained decisions, concepts, sources, projects.
   - [[index]] + `log.md` — catalog and chronological record.

Both levels share the same conventions:
- Three Karpathy layers (raw / wiki / schema).
- Three operations (ingest / query / lint).
- Lifecycle from Wiki v2 (confidence + supersession + decay).
- Cite-or-shut-up: every claim cites a source URN or file path.

## Consequences

**Per-tenant layer (immediate work):**

- Migration 022 with `wiki_pages`, `memory_edges`,
  `tenant_wiki_schema`, plus `embedding_content_hash` on
  `tenant_memories`.
- New `runMemoriesEmbedder` in
  [`packages/adapters/src/embeddings/index.ts`](../../../packages/adapters/src/embeddings/index.ts).
- New `compileWikiPages` workflow (one Sonnet `generateObject` call
  per page, ~50 pages × ~2k tokens = ~100k tokens/tenant/night).
- Slice refactor reduces token cost: 1 page (~600 tokens) replaces 3
  atoms + framing (~1200 tokens), with richer citations.
- New `/admin/wiki` route + 3 sub-routes (page detail, graph,
  schema editor).
- `urn.wikiPage(tenantId, pageId)` added to
  [`packages/core/src/types/urn.ts`](../../../packages/core/src/types/urn.ts).
- Tracked in [[phase-6-second-brain]].

**Developer layer (this wiki):**

- [[CLAUDE]] is the schema. Every Cursor session reads it before
  touching `wiki/`.
- This folder is committed to git (no sensitive data).
- Migrating decisions ([[0001-transcript-provider]]), concepts (sourced
  from `MISSION.md`, the strategic review, the PRDs), and sources
  ([[karpathy-llm-wiki]] et al.) bootstraps a usable wiki on day one.

## What we will not do

- **No new agent runtime.** The wiki layer is a *substrate* the agent
  reads through slices, not a separate agent.
- **No hybrid search (BM25 + vector + graph RRF) on day one.** Vector
  alone is enough at <500 pages per tenant. Revisit when the slowest
  tenant hits 300+ pages.
- **No self-query agent tools** (`recall_memory`, `propose_memory`).
  Slices already inject; explicit recall is a Tier-2 future build.
- **No custom Obsidian MCP server.** Per-tenant export is one-way.
  For the developer wiki, use the community
  `obsidian-claude-code-mcp` if MCP access is desired.
- **No cross-tenant memory.** Each tenant's brain is isolated by
  RLS; the only shared layer is the platform-wide
  `framework_chunks`.

## Revisit triggers

- Slowest tenant exceeds 300 wiki pages → consider hybrid search.
- Customer asks for round-trip Obsidian sync (write-back from
  Obsidian into the SaaS) → consider MCP server or read/write API.
- Compile cost exceeds 200k tokens/tenant/night → consider tiered
  compilation (only re-compile changed entities).
- Conflict inbox grows faster than admins can resolve → consider
  LLM-proposed contradiction resolution with human approval (today
  it never auto-resolves).

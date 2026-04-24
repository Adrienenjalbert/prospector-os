---
kind: project
title: "Phase 6 — Two-Level Second Brain"
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: [raw/external/karpathy-llm-wiki.md, raw/external/llm-wiki-v2.md, raw/external/obsidian-second-brain-research.md, raw/strategic-reviews/2026-04.md]
related: [[second-brain]], [[0002-two-level-second-brain]], [[learning-loop]], [[universal-agent]]
---

# Phase 6 — Two-Level Second Brain

> **Status:** Active — implementing
> **Started:** 2026-04-24
> **Plan ref:** `.cursor/plans/two-level-second-brain_8c3fb731.plan.md`
> **Decision ref:** [[0002-two-level-second-brain]]

## Goal

Apply the Karpathy LLM Wiki pattern at two levels:

1. **Per-tenant SaaS layer** — extend `tenant_memories` with a
   compiled wiki layer (`wiki_pages` + `memory_edges` +
   `tenant_wiki_schema`), driven by a new compile/lint/reflect
   workflow trio. Make this the substrate the agent slices read
   from.
2. **Developer layer** — this `wiki/` folder, used to manage
   Prospector OS itself.

Per [[0002-two-level-second-brain]] and the full plan.

## Status board

The plan is structured into 5 sections + ship order. Status as I work
through them.

### Section 4.2 — Developer wiki bootstrap

- ✅ `wiki/CLAUDE.md` (the schema)
- ✅ `wiki/index.md` (the catalog)
- ✅ `wiki/log.md` (chronological)
- ✅ `wiki/raw/` populated with Karpathy gist, Wiki v2, Obsidian
   research synthesis, strategic-review pointer, adoption-research
   pointer
- ✅ Decisions migrated: [[0001-transcript-provider]],
   [[0002-two-level-second-brain]] created
- ✅ Concept pages: [[two-jobs]], [[three-layers]], [[four-loops]],
   [[universal-agent]], [[learning-loop]], [[second-brain]],
   [[ontology-and-urns]], [[signal-over-noise]], [[cite-or-shut-up]]
- ✅ Source pages: [[karpathy-llm-wiki]], [[llm-wiki-v2]],
   [[obsidian-second-brain-2026]], [[strategic-review-2026-04]],
   [[adoption-research-2026]]
- ✅ This project page

### Section 1 — Atom layer (close the loops)

- ⏳ 1.1 Memory embeddings (`runMemoriesEmbedder`,
   `embedQueryForMemories`, content-hash column)
- ⏳ 1.2 Memory bandit + telemetry (`memory_injected`,
   `memory_cited`, posterior updates)
- ⏳ 1.3 Adaptation panel atom KPIs

### Section 2 — Wiki layer (architectural pivot)

- ⏳ 2.1 Migration 022: `wiki_pages`, `memory_edges`,
   `tenant_wiki_schema`, `match_wiki_pages` RPC, `urn.wikiPage`
- ⏳ 2.2 Edge extraction at proposal time
- ⏳ 2.3 `compileWikiPages` workflow
- ⏳ 2.4 Slice refactor (pages-first)
- ⏳ 2.5 `/admin/wiki` UI
- ⏳ 2.6 Per-tenant `CLAUDE.md` bootstrap

### Section 3 — Lifecycle

- ⏳ 3.1 `consolidateMemories` (atoms)
- ⏳ 3.2 `lintWiki` (pages)
- ⏳ 3.3 `reflectMemories` weekly (extended to write pages)
- ⏳ 3.4 Conflict inbox on `/admin/wiki`

### Section 4 — Obsidian + dev wiki

- ⏳ 4.1 Per-tenant Obsidian export
- ✅ 4.2 Developer wiki bootstrap (this section)

### Section 5 — Tests + observability

- ⏳ 5.1 Atom tests (derive-icp, mine-personas, mine-themes,
   memory-bandit)
- ⏳ 5.2 Wiki tests (compile, edges, lint, slice fallback, export)
- ⏳ 5.3 KPIs surfaced

## Decisions made along the way

- **Folder structure**: 3-folder Karpathy split (`raw/` / `pages/` /
   `CLAUDE.md`) over PARA. Rationale in [[obsidian-second-brain-2026]].
- **Page kinds (developer)**: 5 kinds — decision, concept, source,
   project, log. Rationale in [[CLAUDE]].
- **Page kinds (per-tenant)**: 12 kinds in `wiki_pages.kind` enum.
   Rationale in [[0002-two-level-second-brain]] and the plan §2.1.
- **Hybrid search deferred**: vector alone at <500 pages per tenant.
   Revisit at 300+ pages.
- **Custom Obsidian MCP not built**: per-tenant export is one-way.
   Use community `obsidian-claude-code-mcp` for the dev wiki.
- **`wiki/` folder committed to git**, not gitignored. No customer
   data; this is project knowledge.

## Open questions

(None yet at this stage. Will be appended here as work progresses.)

## Cost estimate

- **Tokens** (per-tenant nightly): ~100k for `compileWikiPages`
   (Sonnet, ~50 pages × ~2k tokens), ~5k for `lintWiki` quality
   eval (~50 × ~100 tokens), ~3k for weekly `reflectMemories`. Total:
   ~110k tokens/tenant/night, scaling linearly with tenants.
- **Storage**: ~10MB/tenant for `wiki_pages` + `memory_edges` at
   steady state (~50 pages × ~10KB each + ~500 edges × ~200 bytes).
   Negligible.
- **Compute**: 1 new cron tick (workflow dispatcher already exists).
   ~10s extra per tenant per night for compile + lint, run as part
   of the existing learning cron.

## Success criteria

When this project is "done":

1. ✅ Customer-facing: `/admin/wiki` renders for any tenant with
   pages compiled, graph view working, conflict inbox surfacing
   real contradictions, schema editable.
2. ✅ Customer-facing: any tenant's wiki can be exported to a
   `.zip` and opened in Obsidian.
3. ✅ Agent: slices read pages first; the agent's response cites
   `wiki_page` URNs alongside object URNs; bandit posteriors update.
4. ✅ Adaptation: `/admin/adaptation` shows weekly memory KPIs
   (atoms per kind, pages per kind, citation rate, lint warnings,
   schema revisions).
5. ✅ Tests: contract tests for compile, lint, reflection, slice
   fallback, export. Existing eval suite still passes.
6. ✅ Developer wiki: I can drop a new source into `wiki/raw/` and
   ask Cursor to ingest it; the result is summarised in
   `pages/sources/`, relevant `pages/concepts/` are updated, and
   `log.md` has an entry.

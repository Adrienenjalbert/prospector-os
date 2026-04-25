---
kind: project
title: "Phase 6 — Two-Level Second Brain"
created: 2026-04-24
updated: 2026-04-25
status: accepted
sources: [raw/external/karpathy-llm-wiki.md, raw/external/llm-wiki-v2.md, raw/external/obsidian-second-brain-research.md, raw/strategic-reviews/2026-04.md]
related: [[second-brain]], [[0002-two-level-second-brain]], [[learning-loop]], [[universal-agent]]
---

# Phase 6 — Two-Level Second Brain

> **Status:** Shipped — test coverage gap is the only followup
> **Started:** 2026-04-24
> **Shipped:** 2026-04-24 (commit `e4a47c4`)
> **Plan ref:** `.cursor/plans/two-level-second-brain_8c3fb731.plan.md`
> **Decision ref:** [[0002-two-level-second-brain]]
> **Built on by:** Phase 7 (commit `27d613b`,
> [`packages/db/migrations/024_phase7_triggers_and_graph.sql`](../../../packages/db/migrations/024_phase7_triggers_and_graph.sql))
> extends `memory_edges` with 4 new edge kinds (`bridges_to`,
> `coworked_with`, `alumni_of`, `geographic_neighbor`) and adds the
> `triggers` table.

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

The plan was structured into 5 sections + ship order. Status below
verified against the codebase on the `updated` date.

### Section 1 — Atom layer (close the loops)

- ✅ 1.1 Memory embeddings — `runMemoriesEmbedder` in
   [`packages/adapters/src/embeddings/index.ts`](../../../packages/adapters/src/embeddings/index.ts),
   `embedQueryForMemories` in
   [`apps/web/src/lib/agent/context/embed-query.ts`](../../../apps/web/src/lib/agent/context/embed-query.ts),
   wired to
   [`apps/web/src/app/api/cron/embeddings/route.ts`](../../../apps/web/src/app/api/cron/embeddings/route.ts).
   `embedding_content_hash` column added in migration 022.
- ✅ 1.2 Memory bandit + telemetry — `thompsonAdjustForMemory` in
   [`apps/web/src/lib/memory/bandit.ts`](../../../apps/web/src/lib/memory/bandit.ts).
   `memory_injected` / `memory_cited` events emit from
   [`apps/web/src/app/api/agent/route.ts`](../../../apps/web/src/app/api/agent/route.ts)
   and [`packer.ts`](../../../apps/web/src/lib/agent/context/packer.ts).
   Posteriors update nightly via `consolidateMemories`.
- ✅ 1.3 Adaptation panel atom KPIs — surfaced in
   [`apps/web/src/app/(dashboard)/admin/adaptation/page.tsx`](../../../apps/web/src/app/(dashboard)/admin/adaptation/page.tsx)
   under the "Phase 6 (Section 1.3) — memory + wiki KPIs" block
   (atoms by kind, citation rate, schema revisions, lint warnings).

### Section 2 — Wiki layer (architectural pivot)

- ✅ 2.1 Migration 022 — `wiki_pages`, `memory_edges`,
   `tenant_wiki_schema`, `match_wiki_pages` RPC all present in
   [`packages/db/migrations/022_wiki_layer.sql`](../../../packages/db/migrations/022_wiki_layer.sql).
   `urn.wikiPage(tenantId, pageId)` added in
   [`packages/core/src/types/urn.ts`](../../../packages/core/src/types/urn.ts).
- ✅ 2.2 Edge extraction at proposal time — Sonnet-driven extractor
   in
   [`apps/web/src/lib/memory/edge-extractor.ts`](../../../apps/web/src/lib/memory/edge-extractor.ts),
   invoked from
   [`writer.ts`](../../../apps/web/src/lib/memory/writer.ts) after
   every `proposeMemory`.
- ✅ 2.3 `compileWikiPages` workflow —
   [`apps/web/src/lib/workflows/compile-wiki-pages.ts`](../../../apps/web/src/lib/workflows/compile-wiki-pages.ts),
   dispatched from
   [`apps/web/src/app/api/cron/workflows/route.ts`](../../../apps/web/src/app/api/cron/workflows/route.ts).
- ✅ 2.4 Slice refactor (pages-first) — `icp-snapshot` reads the
   compiled page first and falls back to atoms for cold-start
   tenants:
   [`apps/web/src/lib/agent/context/slices/icp-snapshot.ts`](../../../apps/web/src/lib/agent/context/slices/icp-snapshot.ts).
- ✅ 2.5 `/admin/wiki` UI — list, page detail, graph, schema editor
   and export all live under
   [`apps/web/src/app/(dashboard)/admin/wiki/`](../../../apps/web/src/app/(dashboard)/admin/wiki/).
- ✅ 2.6 Per-tenant `CLAUDE.md` bootstrap — template in
   [`apps/web/src/lib/wiki/schema-template.ts`](../../../apps/web/src/lib/wiki/schema-template.ts);
   editor at
   [`apps/web/src/app/(dashboard)/admin/wiki/schema/`](../../../apps/web/src/app/(dashboard)/admin/wiki/schema/page.tsx).

### Section 3 — Lifecycle

- ✅ 3.1 `consolidateMemories` (atoms) —
   [`apps/web/src/lib/workflows/consolidate-memories.ts`](../../../apps/web/src/lib/workflows/consolidate-memories.ts)
   runs Ebbinghaus decay + auto-archival nightly.
- ✅ 3.2 `lintWiki` (pages) —
   [`apps/web/src/lib/workflows/lint-wiki.ts`](../../../apps/web/src/lib/workflows/lint-wiki.ts)
   detects orphans, broken wikilinks, contradictions, decay.
- ✅ 3.3 `reflectMemories` weekly —
   [`apps/web/src/lib/workflows/reflect-memories.ts`](../../../apps/web/src/lib/workflows/reflect-memories.ts)
   writes both reflection atoms and `reflection_weekly` pages.
- ✅ 3.4 Conflict inbox on `/admin/wiki` — contradictions panel on
   [`apps/web/src/app/(dashboard)/admin/wiki/page.tsx`](../../../apps/web/src/app/(dashboard)/admin/wiki/page.tsx)
   filters edges where `edge_kind = 'contradicts'` and surfaces
   them at `?lint=contradiction`.

### Section 4 — Obsidian + dev wiki

- ✅ 4.1 Per-tenant Obsidian export —
   [`apps/web/src/app/api/admin/wiki/export/route.ts`](../../../apps/web/src/app/api/admin/wiki/export/route.ts)
   emits a `.zip` with `CLAUDE.md`, `index.md`, `log.md`, `pages/`,
   `atoms/` — opens directly in Obsidian.
- ✅ 4.2 Developer wiki bootstrap — this `wiki/` folder, with
   [[CLAUDE]], [[index]], `log.md`, raw sources, decisions, concepts,
   and source pages all in place.

### Section 5 — Tests + observability

- ⚠️ 5.1 Atom tests — only
   [`bandit.test.ts`](../../../apps/web/src/lib/memory/__tests__/bandit.test.ts)
   and
   [`entity-resolution.test.ts`](../../../apps/web/src/lib/memory/__tests__/entity-resolution.test.ts)
   ship. No tests for `derive-icp`, `mine-personas`, `mine-themes`,
   or `edge-extractor`. **Followup.**
- ⚠️ 5.2 Wiki tests — only
   [`compile-wiki-pages.test.ts`](../../../apps/web/src/lib/workflows/__tests__/compile-wiki-pages.test.ts),
   [`wiki-loader.test.ts`](../../../apps/web/src/lib/memory/__tests__/wiki-loader.test.ts),
   and
   [`icp-snapshot-pages-first.test.ts`](../../../apps/web/src/lib/agent/context/slices/__tests__/icp-snapshot-pages-first.test.ts)
   ship. No tests for `lint-wiki`, `consolidate-memories`,
   `reflect-memories`, or the export endpoint. **Followup.**
- ✅ 5.3 KPIs surfaced — `/admin/adaptation` Phase 6 panels are live.

## Followups

The only outstanding work is contract-level test coverage:

- Atom workflows: `derive-icp`, `mine-personas`, `mine-themes`,
   `edge-extractor`.
- Wiki workflows: `lint-wiki`, `consolidate-memories`,
   `reflect-memories`.
- The `/api/admin/wiki/export` endpoint round-trip.

None block Phase 7 or any production behaviour — they're regression
nets for code that's already shipped.

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

(None at ship time. Anything Phase 7 surfaces will get appended here.)

## Cost estimate

- **Tokens** (per-tenant nightly): ~100k for `compileWikiPages`
   (Sonnet, ~50 pages × ~2k tokens), ~5k for `lintWiki` quality
   eval (~50 × ~100 tokens), ~3k for weekly `reflectMemories`. Edge
   extraction adds ~70k tokens/tenant/night when atoms are flowing
   (~100 atoms × ~700 tokens). Total: ~180k tokens/tenant/night,
   scaling linearly with tenants.
- **Storage**: ~10MB/tenant for `wiki_pages` + `memory_edges` at
   steady state (~50 pages × ~10KB each + ~500 edges × ~200 bytes).
   Negligible.
- **Compute**: dispatched from the existing learning cron — no new
   tick. ~10s extra per tenant per night for compile + lint.

## Success criteria

When this project is "done":

1. ✅ Customer-facing: `/admin/wiki` renders for any tenant with
   pages compiled, graph view working, conflict inbox surfacing
   real contradictions, schema editable.
2. ✅ Customer-facing: any tenant's wiki can be exported to a
   `.zip` and opened in Obsidian.
3. ✅ Agent: slices read pages first (`icp-snapshot` proven); the
   agent's response cites `wiki_page` URNs alongside object URNs;
   bandit posteriors update.
4. ✅ Adaptation: `/admin/adaptation` shows weekly memory KPIs
   (atoms per kind, pages per kind, citation rate, lint warnings,
   schema revisions).
5. ⚠️ Tests: contract tests ship for `compile-wiki-pages`, the
   slice fallback, the memory bandit, the wiki loader, and entity
   resolution; **`lint-wiki`, `consolidate-memories`,
   `reflect-memories`, the atom miners, `edge-extractor`, and the
   export endpoint are not yet covered** — see Followups above.
6. ✅ Developer wiki: I can drop a new source into `wiki/raw/` and
   ask Cursor to ingest it; the result is summarised in
   `pages/sources/`, relevant `pages/concepts/` are updated, and
   `log.md` has an entry.

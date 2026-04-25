---
kind: source
title: "LLM Wiki v2 (rohitg00, April 2026)"
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: [raw/external/llm-wiki-v2.md]
related: [[second-brain]], [[karpathy-llm-wiki]], [[0002-two-level-second-brain]], [[learning-loop]]
---

# LLM Wiki v2

> **Source:** [`raw/external/llm-wiki-v2.md`](../../raw/external/llm-wiki-v2.md)
> · [original gist](https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2)
>
> **Captured:** 2026-04-24

## What it is

rohitg00's April 2026 extension to [[karpathy-llm-wiki]], based on
lessons from building `agentmemory` (a persistent memory engine for
AI coding agents). Same pattern; adds the production-grade machinery
that prevents the wiki from rotting at scale.

## So what for Prospector OS

This is the **lifecycle and quality machinery** behind Phase 6. Where
Karpathy says "compile once, keep current", v2 says *exactly* how to
keep it current: confidence, supersession, decay, consolidation
tiers, knowledge graph, hybrid search, automation, quality scoring.

Almost every additive feature in [[0002-two-level-second-brain]]
traces back to v2:

| v2 idea | Where it lands in Phase 6 |
|---|---|
| Confidence scoring | Already on `tenant_memories.confidence`; copied to `wiki_pages.confidence`. |
| Supersession | `tenant_memories.superseded_by` (existing); `wiki_pages.superseded_by` (new). |
| Forgetting (Ebbinghaus) | `decay_score` column + `consolidateMemories` decay step + `lintWiki` decay step. |
| Consolidation tiers | The `kind` enum approximates this: atoms = episodic, pages = semantic, `playbook_*` pages = procedural. Working memory = the conversation slice. |
| Knowledge graph | `memory_edges` table with typed edges. |
| Hybrid search (BM25 + vector + graph + RRF) | **Deferred** to Phase 7+. Vector alone at <500 pages. |
| Automation hooks | Already present: cron drives mining, embeddings, calibration. Phase 6 adds compile + lint + reflect. |
| Quality scoring | `lintWiki`'s self-eval pass: each page scored, <0.5 re-queued. |
| Self-healing | `lintWiki` flags orphans, broken links, contradictions. **Never auto-resolves contradictions.** |
| Crystallization | Future scope (Phase 7+). |
| Output formats | Per-tenant `.zip` export (markdown). No slide decks. |
| The schema is the real product | `tenant_wiki_schema` per-tenant + `wiki/CLAUDE.md` developer-side. |
| Privacy / governance | Already enforced via RLS; admin endpoints are audited. |

## Implementation spectrum mapping

v2's modular spectrum, adopted level-by-level:

- **Minimal viable wiki** — raw + pages + index + schema. Done at
  the developer level (this wiki).
- **Add lifecycle** — confidence, supersession, decay. Done at both
  levels in Phase 6.
- **Add structure** — entity extraction, typed relationships. Done
  via `memory_edges` (Phase 6).
- **Add automation** — auto-ingest, auto-lint. Done at the per-tenant
  level via cron.
- **Add scale** — hybrid search, consolidation tiers, quality
  scoring. Quality scoring done; tiers approximated by the `kind`
  enum; hybrid search **deferred**.
- **Add collaboration** — mesh sync, shared/private scoping.
  **Deferred** (single-rep mode for now; multi-tenant via RLS, not
  multi-agent within a tenant).

## Key claim worth marking

> The Memex is finally buildable. Not because we have better documents
> or better search, but because we have librarians that actually do
> the work.

The "librarian" framing is exactly what `compileWikiPages`,
`lintWiki`, and `reflectMemories` are. Three nightly/weekly librarians,
each doing one specific job, each emitting events the human can
audit.

## Critiques to carry forward (from the v2 comments)

- **gnusupport's "no provenance" critique** — mitigated by our
  `evidence` JSONB column on atoms and `source_atoms` array on pages,
  plus inline URN citations in `body_md`.
- **gnusupport's "no access control" critique** — mitigated by RLS
  per-tenant + admin-only endpoints for write operations.
- **gnusupport's "no audit trail" critique** — mitigated by
  `agent_events` and `calibration_ledger` for every state transition.

## Applies to

- [[second-brain]]
- [[0002-two-level-second-brain]]
- [[learning-loop]] (the bandit posterior + supersession map onto
  v2's lifecycle layer).
- [[CLAUDE]] (lifecycle conventions).

---
kind: source
title: "Karpathy's LLM Wiki gist (April 2026)"
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: [raw/external/karpathy-llm-wiki.md]
related: [[second-brain]], [[llm-wiki-v2]], [[obsidian-second-brain-2026]], [[0002-two-level-second-brain]]
---

# Karpathy's LLM Wiki gist

> **Source:** [`raw/external/karpathy-llm-wiki.md`](../../raw/external/karpathy-llm-wiki.md)
> · [original gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
>
> **Captured:** 2026-04-24

## What it is

Andrej Karpathy's April 2026 gist articulating a pattern for building
personal knowledge bases with LLMs. The thread crossed 16M views in
five days. His quote that ended up everywhere:

> A large fraction of my recent token throughput is going less into
> manipulating code, and more into manipulating knowledge.

Three layers (raw / wiki / schema), three operations (ingest / query /
lint), one philosophy: **stop re-deriving on every query, start
compiling once and keeping current**.

## So what for Prospector OS

This gist is the architectural backbone of [[0002-two-level-second-brain]].
The mapping is direct:

| Karpathy | Prospector OS |
|---|---|
| Raw sources | CRM data, transcripts, signals (the canonical ontology — see [[ontology-and-urns]]) |
| Wiki | `wiki_pages` rows, compiled by `compileWikiPages` (Phase 6) |
| Schema | `tenant_wiki_schema` per tenant; `wiki/CLAUDE.md` for the developer wiki |
| Ingest | The 8 mining workflows (already running) |
| Query | Agent slices read pages first, atoms as fallback |
| Lint | New `lintWiki` workflow (Phase 6) |
| Obsidian | Per-tenant export `.zip`; for the developer wiki, open `wiki/` as a vault |

The strongest sentence in the gist for our purposes:

> The wiki is a persistent, compounding artifact. The cross-references
> are already there. The contradictions have already been flagged.

That's exactly the gap [[strategic-review-2026-04]] identified: atoms
were being mined nightly, but never compiled, never cross-referenced,
never reconciled. The wiki layer closes that gap.

## Key takeaways adopted

1. **Three-layer split** — raw / wiki / schema. We adopt this verbatim
   at the developer level (this `wiki/` folder) and via Postgres
   tables at the per-tenant level.
2. **The schema document is the most important file** — applied as
   `wiki/CLAUDE.md` (this wiki) and `tenant_wiki_schema.body_md`
   (per tenant). See [[CLAUDE]].
3. **Index + log files** — `wiki/index.md` and `wiki/log.md`; the
   per-tenant export includes both.
4. **Obsidian as IDE, LLM as programmer, wiki as codebase** — applied
   directly. See [[obsidian-second-brain-2026]] for setup.
5. **Good answers file back as new pages** — `crystallization` is
   future scope (Phase 7+) but the conceptual hook is in.

## Key takeaways NOT adopted

- **`qmd` for hybrid search** — at <500 pages per tenant, vector
  alone is sufficient. Revisit if scale forces it.
- **Image handling in raw/** — text-only sources for now. We have no
  image-bearing data sources at the customer level (transcripts are
  text; CRM data is structured).
- **Marp slide decks as output format** — the agent's outputs are
  chat responses, Slack DMs, and markdown pages. No slide decks.

## Critiques worth knowing about (from the gist comments)

The thread had heavy pushback. Two arguments worth carrying:

1. **gnusupport's critique** ("LLM-Wiki is forgery"): The wiki
   replaces source documents with LLM-generated prose. **Mitigated**
   by our citation contract (see [[cite-or-shut-up]]) — every page's
   body must cite atom URNs and raw URNs inline.
2. **SEO-Warlord's Zettelkasten critique**: Mutable wiki pages are
   silently revised; immutable atomic notes with stable IDs are
   safer. **Partially adopted** — atoms (`tenant_memories`) are
   immutable once compiled into a page; pages have `superseded_by`
   and version history; raw sources are append-only.

The strongest adoption pressure from these critiques is to never let
the wiki replace its sources, only summarise them. Built into our
schema.

## Applies to

- [[second-brain]]
- [[0002-two-level-second-brain]]
- [[llm-wiki-v2]] (which extends this gist)
- [[obsidian-second-brain-2026]] (which adapts the pattern for
  Obsidian)
- [[CLAUDE]] (the developer wiki schema follows this gist's
  conventions)

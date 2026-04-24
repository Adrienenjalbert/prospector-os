---
kind: log
title: Wiki log
created: 2026-04-24
updated: 2026-04-24
---

# Wiki log

Append-only. Every entry starts with `## [YYYY-MM-DD] {op} | {title}`.
Parseable with `grep "^## " log.md`.

## [2026-04-24] bootstrap | wiki seeded from existing docs

Initial bootstrap of the developer wiki, per [[0002-two-level-second-brain]].

Created:

- [[CLAUDE]] — the schema for this wiki.
- [[index]] — the catalog of every page.
- This `log.md`.

Migrated decisions:

- [[0001-transcript-provider]] from `docs/decisions/0001-transcript-provider.md`.

Created decisions:

- [[0002-two-level-second-brain]] — captures the architectural decision
  to compile atoms into wiki pages at the per-tenant layer AND to
  maintain this developer wiki at the project layer.

Created concepts (sourced from `MISSION.md`, `CURSOR_PRD.md`, and the
strategic-review):

- [[two-jobs]], [[three-layers]], [[four-loops]], [[universal-agent]],
  [[learning-loop]], [[second-brain]], [[ontology-and-urns]],
  [[signal-over-noise]], [[cite-or-shut-up]].

Ingested raw sources:

- `raw/external/karpathy-llm-wiki.md` — Karpathy's gist (canonical text only).
- `raw/external/llm-wiki-v2.md` — rohitg00's extension.
- `raw/external/obsidian-second-brain-research.md` — synthesis of 2026
  Obsidian + AI second-brain research.
- `raw/strategic-reviews/2026-04.md` — pointer + summary of the
  April 2026 strategic review.
- `raw/research/2026-03-adoption-research.md` — pointer + summary of the
  March 2026 adoption research report.

Created source pages:

- [[karpathy-llm-wiki]], [[llm-wiki-v2]], [[obsidian-second-brain-2026]],
  [[strategic-review-2026-04]], [[adoption-research-2026]].

Created project page:

- [[phase-6-second-brain]] — the active implementation of the
  two-level second brain.

Lint check (initial): no orphans (every concept page is linked from
[[index]] and at least one source page), no broken wikilinks, no
contradictions yet.

Next ingests will follow the convention in [[CLAUDE]] §Operations.

# wiki/CLAUDE.md — Developer second brain (schema)

> Read this on every session before touching any file in `wiki/`.
> This is the **schema** (the "how") for the developer-facing wiki at
> `/wiki/`. The mission ([`MISSION.md`](../MISSION.md)) is the "why".
> The customer-facing per-tenant wiki has its own schema, stored in the
> `tenant_wiki_schema` table.

## What this wiki is

A Karpathy-style LLM wiki for **building Prospector OS**. Not for the
product's customers — for me (Adrien) and any agent (Cursor, Claude
Code, future contributors) working on this codebase.

The pattern, taken straight from
[Karpathy's gist](raw/external/karpathy-llm-wiki.md):

- **raw/** — immutable sources (interviews, articles, reports, gists).
  The agent reads these, never modifies them.
- **pages/** — LLM-maintained markdown. The agent owns this layer
  entirely: it creates pages, updates them when new sources arrive,
  maintains cross-references, keeps everything consistent.
- **CLAUDE.md** *(this file)* — the schema. How pages are structured,
  what conventions apply, what workflows to run. We co-evolve this
  over time.

The agent (you, reading this) writes the wiki. I curate sources, ask
questions, and direct the synthesis.

## Why this wiki exists

The same problem Karpathy is solving at personal scale. Every Cursor
session today re-discovers context from the codebase, the PRDs, the
strategic-review, and the conversation history. Nothing accumulates.
Decisions made in week 3 get re-derived in week 8.

This wiki is the **compounding artifact**: the place where decisions,
concepts, and source synthesis live so future sessions start from
where the last one ended.

## Page kinds

Five kinds. Folder = kind.

| Kind | Folder | What it is | Example |
|---|---|---|---|
| `decision` | `pages/decisions/` | An architectural decision record (ADR). Numbered. Immutable once accepted. | `0001-transcript-provider.md` |
| `concept` | `pages/concepts/` | A first-class idea in the OS — what it means, why it matters, where it lives in code. Mutable. | `universal-agent.md` |
| `source` | `pages/sources/` | A summary of one ingested source from `raw/`, with the takeaways and pointers back to where they apply. | `karpathy-llm-wiki.md` |
| `project` | `pages/projects/` | A multi-week initiative — the plan, the open todos, the decisions made along the way. | `phase-6-second-brain.md` |
| `log` | `log.md` (root) | Append-only chronological record of ingests, decisions, lint passes. | — |

If a page doesn't fit one of these, the kind is wrong, not the page.

## Naming

- **Slugs are kebab-case.** `two-jobs.md`, not `Two_Jobs.md`.
- **Decisions are dated and numbered.** `NNNN-short-title.md`. Number
  is monotonic across all decisions ever made.
- **Sources mirror their raw filename.** `raw/external/karpathy-llm-wiki.md`
  → `pages/sources/karpathy-llm-wiki.md`.
- **Concepts and projects use intent words.** `learning-loop.md`,
  `phase-6-second-brain.md`. Avoid generic names like `notes.md`.

## Page structure (every page)

Every page starts with YAML frontmatter:

```yaml
---
kind: concept | decision | source | project | log
title: "Human-readable title"
created: 2026-04-24
updated: 2026-04-24
status: draft | accepted | superseded | archived
sources: [raw/external/karpathy-llm-wiki.md, raw/strategic-reviews/2026-04.md]
related: [[two-jobs]], [[universal-agent]]
---
```

Then a `# H1 title` and the body. Every claim either:

1. **Cites a code path**, e.g. `apps/web/src/lib/agent/agents/_shared.ts`
2. **Cites a doc path**, e.g. `[strategic-review §2.1](../raw/strategic-reviews/2026-04.md#21)`
3. **Cites a URL** for external claims
4. **Wikilinks to another page** with `[[slug]]`

No uncited claims. Same rule the customer-facing OS enforces on the
agent.

## Operations (Karpathy's three)

### Ingest (when I drop something into raw/)

1. Read the source.
2. Discuss key takeaways with me in chat.
3. Write a `pages/sources/{slug}.md` summary page (≤500 words, one
   "what" section, one "so what for Prospector OS" section, one
   "applies to" section listing concept/decision pages it touches).
4. Update relevant `pages/concepts/*.md` pages — strengthen,
   challenge, or qualify existing claims. Add a "Sources" line.
5. Append to `log.md`: `## [YYYY-MM-DD] ingest | <title>`.

A single source might touch 5–10 wiki pages. That's fine. The
maintenance burden is yours, not mine.

### Query (when I ask a question)

1. Read `index.md` first to find candidate pages.
2. Drill into relevant pages.
3. Synthesize an answer with inline citations to those pages
   (`[[slug]]`) and to the underlying sources.
4. **If the answer is non-trivial and reusable**, ask if I want it
   filed as a new page — comparison, analysis, decision rationale.
   Good answers compound back into the wiki.

### Lint (weekly Friday)

Run by request. Check for:

- **Orphans**: pages with zero inbound `[[wikilinks]]`.
- **Broken wikilinks**: `[[slug]]` that doesn't resolve to an existing
  page.
- **Stale claims**: pages whose `updated` is > 90 days old and whose
  cited sources have newer versions in `raw/`.
- **Contradictions**: two pages making opposite claims about the same
  concept.
- **Missing pages**: concepts mentioned in 3+ pages but with no page
  of their own.
- **Index drift**: pages not listed in `index.md`.

Output: a single comment-style report in chat. Never auto-fix
contradictions; always ask.

## Conventions specific to this codebase

- **Code references** use the format `apps/web/src/lib/.../file.ts`
  relative to repo root. The agent's tools can open them directly.
- **Migration references** use `packages/db/migrations/NNN_name.sql`.
- **The product mission** lives in [`MISSION.md`](../MISSION.md).
  Concept pages defer to it on contested principles.
- **The product PRDs** live in [`docs/prd/`](../docs/prd/). They are
  authored by humans and stay there. Concept pages may **summarise**
  PRDs, never replace them.
- **Strategic reviews** live in [`docs/`](../docs/). They get summarised
  into `pages/sources/` and the original is symlinked into `raw/`.

## When to create a new page vs update an existing one

**Update existing** if:
- The new information sharpens, qualifies, or contradicts an existing
  claim.
- The new information is one more data point for an existing pattern.
- The page already covers the topic at the same scope.

**Create new** if:
- A new concept, decision, source, or project has no current page.
- Two existing pages would each need extensive edits to absorb the
  new information.
- The new information is a comparison or synthesis that's useful as
  its own thing.

When in doubt: update. The wiki is a graph, not a heap.

## Lifecycle (Wiki v2 lessons)

Every page carries an implicit confidence and an explicit `status`.

- **`draft`** — first draft, not yet reviewed.
- **`accepted`** — actively maintained, current best understanding.
- **`superseded`** — replaced by a newer page, kept for history. Add
  a `superseded_by: [[slug]]` line at the top.
- **`archived`** — no longer relevant, kept for archaeology.

When a decision is made, the corresponding decision page flips from
`draft` to `accepted` and never moves again. Concepts evolve.

## What this wiki is NOT

- **Not the customer-facing knowledge base.** That's per-tenant, lives
  in the SaaS database (`tenant_memories` + `wiki_pages`), and is
  exported via [`/admin/wiki/export`](../apps/web/src/app/api/admin/wiki/export/route.ts).
- **Not a replacement for [`MISSION.md`](../MISSION.md), [`docs/prd/`](../docs/prd/),
  or [`docs/PROCESS.md`](../docs/PROCESS.md).** Those are authoritative
  human-authored docs. The wiki summarises and cross-references them.
- **Not a chat log.** Chat history is ephemeral; this wiki is durable.
  Good chat insights file back as pages.
- **Not a TODO list.** Use [`docs/`](../docs/) issues or the project
  pages' own todo sections.

## Setup (Obsidian as the viewer)

The wiki is plain markdown — no tooling required. To browse the graph
view and follow `[[wikilinks]]` interactively:

1. Install [Obsidian](https://obsidian.md) (free).
2. Open the `wiki/` folder as a vault. That's it.
3. Optional: install the [Dataview](https://blacksmithgu.github.io/obsidian-dataview/)
   plugin to query frontmatter (e.g. "all decisions accepted in 2026").
4. Optional: install the
   [obsidian-claude-code-mcp](https://github.com/yarafa/obsidian-claude-code-mcp)
   community MCP server to give Claude Code direct access to the vault
   from outside Cursor.

Cursor doesn't need any of this — it can read the markdown directly.

## Recommended workflow

- Open Cursor on one side, Obsidian on the other.
- I drop a new source into `raw/`.
- I ask "ingest this".
- The agent writes/updates pages.
- I follow the changes in Obsidian's graph view, opening pages as they
  get touched.
- When the agent suggests a new page or a lint warning, I either
  approve, ignore, or refine.

This is the same workflow Karpathy describes in his gist — Obsidian as
the IDE, the LLM as the programmer, the wiki as the codebase.

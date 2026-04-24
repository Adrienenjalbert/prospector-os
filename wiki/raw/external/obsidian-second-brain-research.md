# Obsidian + AI second brain — 2026 research synthesis

> **Sources:**
> - https://obsidianmate.com/article/obsidian-second-brain-claude-code
> - https://www.codewithseb.com/blog/claude-code-obsidian-second-brain-guide
> - https://www.codewithseb.com/blog/obsidian-developer-second-brain-2026-setup
> - https://www.conor.fyi/writing/connecting-claude-code-to-your-second-brain
> - https://okhlopkov.com/second-brain-obsidian-claude-code/
> - YouTube: https://www.youtube.com/watch?v=7huCP6RkcY4
>
> **Captured:** 2026-04-24
>
> Synthesis of the 2026 cohort of articles on building an AI-powered
> second brain in Obsidian. The articles converge on the same pattern;
> this raw doc captures the canonical version.

---

## The setup (what every guide agrees on)

1. **An Obsidian vault** at the root of a folder you control (free).
2. **A code-aware AI agent** with vault read/write access — Claude
   Code, Cursor, Codex, OpenCode, etc.
3. **A `CLAUDE.md` (or `AGENTS.md`) at the vault root** — the schema
   that tells the agent how the vault is organised and what
   workflows to follow.
4. **Optional MCP bridge** — `obsidian-claude-code-mcp` (community)
   exposes the vault as searchable resources via the Model Context
   Protocol so the agent can read/search/cross-reference notes
   mid-conversation, even from outside Obsidian/Cursor.

That's it. No SaaS, no custom infrastructure.

## The recommended vault structure (PARA, adapted for AI)

```
vault/
  CLAUDE.md              # agent instructions (critical)
  tasks.md               # central task list (optional)
  daily/                 # daily notes by year (2026/2026-04-13.md)
  projects/              # one folder per active project
    [project-name]/
      overview.md
      tasks.md
      ideas.md
  areas/                 # ongoing responsibilities (not time-bounded)
  resources/             # reference material
  personal/diary/        # diary entries (YYYY-MM-DD [summary].md)
  _inbox/                # unprocessed captures
  templates/             # note templates
```

Karpathy-style alternative (3 directories instead of 7):

```
vault/
  CLAUDE.md              # schema
  raw/                   # immutable sources
  pages/                 # LLM-maintained
  log.md                 # chronological
  index.md               # catalog
```

The Karpathy structure is closer to a "library", PARA is closer to a
"life dashboard". For a project wiki (building Prospector OS), the
Karpathy structure wins on signal-to-noise.

## Critical conventions all guides emphasise

### Sentence-like filenames, not codes

`meeting-notes-product-redesign.md` gives the agent useful context
*before* it opens the file. `mtg-pr-024.md` doesn't. Filenames are the
first signal an agent uses to decide what to read.

### CLAUDE.md is the agent's persistent memory

This file is automatically loaded when Claude Code opens a session.
It defines:
- Agent behaviour and rules
- Where to process different input types (voice notes, project data,
  diary entries)
- File organisation conventions
- Metadata extraction rules

Without `CLAUDE.md`, the agent re-discovers the vault structure on
every session. With it, the agent knows where everything goes.

### Symlink integration vs MCP bridge

Two ways to give an agent vault access:

- **MCP bridge** (recommended for read/write across tools):
  `obsidian-claude-code-mcp`. Exposes the vault via MCP protocol so
  Claude Code, Codex, Cursor, etc. can all read/write the same vault.
- **Symlink**: tools like `obsidian-link` create portals between
  Claude Code's working directory and the vault. Lighter-weight but
  ties the vault to one editor.

For Cursor, neither is strictly required — Cursor reads files
directly. The MCP bridge is for when you want the same vault
accessible from multiple AI clients.

## Why this works (the feedback loop)

Quoted from obsidianmate:

> You take notes → Claude reads them → Claude generates insights and
> connections → new notes are created → the system improves over time.
>
> Unlike traditional chatbots that forget context between sessions,
> Claude Code maintains persistent access to your entire vault,
> eliminating the need to repeatedly re-explain yourself.

The vault becomes the agent's long-term memory. Conversations become
durable artifacts. The graph view shows you what the agent has been
learning.

## Trade-offs surfaced in the comparison work

| Approach | Pros | Cons |
|---|---|---|
| Manual notes only | Full control, no AI noise | Bookkeeping cost grows faster than value (Karpathy's point) |
| MCP/agent only | Zero bookkeeping cost | Hallucinated links, lossy summaries, no audit trail (gnusupport's critique on the gist) |
| Schema-disciplined hybrid | Agent does bookkeeping, schema enforces structure | Requires schema discipline; co-evolves with use |

The 2026 consensus: **schema-disciplined hybrid** is the only one that
scales past a few hundred pages without rotting.

## Recommended plugins (optional, all free)

- **Dataview** — query frontmatter as a database. Generate dynamic
  tables from page metadata.
- **Templater** — note templates with variables. Useful for date-stamped
  daily notes.
- **Marp** — markdown slide decks. Useful when "the right output" is
  a deck, not a page.
- **Excalidraw** — embedded drawings if you want diagrams.

Avoid plugins that change file formats (e.g. database plugins). The
wiki must remain plain markdown so any agent can read it.

## What's NOT required (despite blog promises)

- A "knowledge graph database" (Neo4j etc.) — Obsidian's wikilinks
  give you the graph for free.
- A vector database — at <500 pages, full-text search + filename
  matching is sufficient.
- A custom Claude integration — the official Claude Code reads
  markdown directly.
- A "self-hosted LLM" — the agent runs in Cursor/Claude Code; the
  vault is just files.

## The verdict

The 2026 articles all converge on the same insight: **the vault is
just markdown files; the agent + the schema are what make it a second
brain**.

For Prospector OS, this maps directly: the developer wiki at `/wiki/`
is just markdown files, Cursor is the agent, [`wiki/CLAUDE.md`](../../CLAUDE.md)
is the schema. The per-tenant SaaS wiki uses the same pattern but the
"files" are rows in `wiki_pages` and the agent runs server-side
against them.

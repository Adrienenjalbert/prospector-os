---
kind: source
title: "Obsidian + AI second brain (2026 cohort)"
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: [raw/external/obsidian-second-brain-research.md]
related: [[second-brain]], [[karpathy-llm-wiki]], [[CLAUDE]]
---

# Obsidian + AI second brain — 2026 cohort

> **Source:** [`raw/external/obsidian-second-brain-research.md`](../../raw/external/obsidian-second-brain-research.md)
> (compiled from 5 articles + 1 YouTube setup video)
>
> **Captured:** 2026-04-24

## What it is

A synthesis of the April–March 2026 cohort of articles on building an
AI-powered second brain in Obsidian:

- obsidianmate — Build an AI second brain with Obsidian and Claude Code
- okhlopkov — Second brain: Obsidian + Claude Code setup guide
- Code With Seb — Claude Code + Obsidian; Obsidian as a developer's
  second brain (2026 setup)
- Conor Luddy — Connecting Claude Code to your second brain
- YouTube — Obsidian setup for AI agents (the video the user
  referenced)

The cohort converges on the same setup pattern, which informs the
**developer-level** half of [[0002-two-level-second-brain]].

## So what for Prospector OS

This is the source for how the developer wiki at `wiki/` works.
Direct mapping:

| Cohort recommendation | This wiki's implementation |
|---|---|
| Vault at root, free Obsidian | `wiki/` folder, open in Obsidian as a vault |
| `CLAUDE.md` at vault root as agent persistent memory | [[CLAUDE]] |
| MCP bridge (`obsidian-claude-code-mcp`) for cross-tool access | Optional; documented in [[CLAUDE]] §Setup |
| Symlink integration | Not needed — Cursor reads `wiki/` directly |
| Sentence-like filenames over codes | Adopted: `two-jobs.md`, `learning-loop.md`, not `tj.md` |
| PARA structure | **Not adopted** — Karpathy's 3-folder (`raw/` / `pages/` / `CLAUDE.md`) wins on signal-to-noise for a project wiki |

## What we adopted

1. **`CLAUDE.md` as the schema doc.** Cursor reads it on every
   session before touching `wiki/`.
2. **Markdown only — no plugins required.** Dataview is optional;
   never required to read the wiki.
3. **Obsidian as the viewer, Cursor as the agent.** Open `wiki/` in
   Obsidian to follow the graph; edit in Cursor.
4. **The feedback loop.** I drop a source → Cursor compiles → I
   browse the changes in Obsidian → I direct the next ingest.

## What we did NOT adopt

- **PARA folder structure.** PARA is for "life dashboards"; we have a
  project wiki. The Karpathy 3-folder structure (raw / wiki / schema)
  is tighter and matches what the per-tenant SaaS wiki uses (so the
  conventions transfer).
- **The `_inbox/` folder.** Sources go directly into `wiki/raw/{type}/`
  named by what they are. No staging.
- **Daily notes.** This is a project wiki, not a journal. The
  chronological layer is `log.md`.
- **Custom MCP server.** The community
  `obsidian-claude-code-mcp` is enough; building our own is out of
  scope.

## Concrete setup steps (for someone new picking up this wiki)

1. Install [Obsidian](https://obsidian.md) (free).
2. "Open folder as vault" → select `wiki/` in this repo.
3. Read [[CLAUDE]] in Obsidian. The graph view is in the right
   sidebar.
4. *(Optional)* Install Dataview plugin if you want to query
   frontmatter (e.g. "all decisions accepted in 2026").
5. *(Optional)* Install `obsidian-claude-code-mcp` if you want
   Claude Code to access the vault from outside Cursor.

That's it. No additional plugins, no theme customization required.

## Why this matters for the per-tenant wiki

The per-tenant `wiki_pages` system uses the same conventions:

- YAML frontmatter on every page
- `[[wikilinks]]` in body markdown
- An `index.md`-equivalent (the `/admin/wiki` UI's index view)
- A schema doc (`tenant_wiki_schema`)
- Export to a vault structure that opens directly in Obsidian

So the developer using Obsidian to browse this wiki, and the customer
opening their `vault-{tenant}-{date}.zip` in Obsidian, see *the same
shape*. That's deliberate.

## Applies to

- [[CLAUDE]]
- [[second-brain]] (the developer-level half)
- [[0002-two-level-second-brain]]

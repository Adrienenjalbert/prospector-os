# SUPERSEDED — Archive Notice

> **Everything in this `docs/archive/` directory is historical reference only.**
> These documents describe the v2 architecture (Make.com, Relevance AI, CRM-only storage)
> which has been fully replaced by the v3 codebase (Next.js + Supabase + Vercel AI SDK).
>
> The current source of truth is:
> - **`CURSOR_PRD.md`** at repo root — Revenue AI OS PRD
> - **`.cursorrules`** at repo root — development rules for the current architecture
> - **`docs/prd/`** — detailed subsystem PRDs for v3

## What's archived here

| File | Was | Replaced by |
|------|-----|-------------|
| `system-prompt.md` | Relevance AI agent system prompt | `apps/web/src/lib/agent/agents/*.ts` `build*Prompt()` (dynamic, DB-driven) |
| `tool-specs.md` | YAML tool definitions for Relevance AI | `apps/web/src/lib/agent/tools/index.ts` + `tool_registry` table |
| `01-apollo-enrichment.md` | Make.com scenario for Apollo enrichment | `packages/adapters/enrichment/apollo.ts` + cron jobs |
| `02-04-scenarios.md` | Make.com scenarios for signals, funnel, briefings | `packages/core/` modules + cron endpoints |

Do not follow patterns described in these files. They will mislead you.

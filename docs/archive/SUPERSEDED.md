# SUPERSEDED — Archive Notice

> **Everything in this `docs/archive/` directory is historical reference only.**
> These documents describe the v2 architecture (Make.com, Relevance AI, CRM-only storage)
> which has been fully replaced by the v3 codebase (Next.js + Supabase + Vercel AI SDK).
>
> The current source of truth is:
> - **[`MISSION.md`](../../MISSION.md)** at repo root — the strategic *why*
> - **[`ARCHITECTURE.md`](../../ARCHITECTURE.md)** at repo root — the engineering *how*
> - **[`CURSOR_PRD.md`](../../CURSOR_PRD.md)** at repo root — what's actually shipped (status + index)
> - **[`docs/PROCESS.md`](../PROCESS.md)** — the engineering process
> - **[`docs/ROADMAP.md`](../ROADMAP.md)** — the multi-tenant OS roadmap
> - **[`.cursorrules`](../../.cursorrules)** at repo root — Cursor session rules
> - **[`docs/prd/`](../prd/)** — detailed subsystem PRDs for v3

## What's archived here

| File | Was | Replaced by |
|------|-----|-------------|
| `system-prompt.md` | Relevance AI agent system prompt | [`apps/web/src/lib/agent/agents/*.ts`](../../apps/web/src/lib/agent/agents/) `build*Prompt()` (dynamic, DB-driven) |
| `tool-specs.md` | YAML tool definitions for Relevance AI | [`apps/web/src/lib/agent/tools/index.ts`](../../apps/web/src/lib/agent/tools/index.ts) + `tool_registry` table |
| `01-apollo-enrichment.md` | Make.com scenario for Apollo enrichment | [`packages/adapters/src/enrichment/apollo.ts`](../../packages/adapters/src/enrichment/apollo.ts) + cron jobs |
| `02-04-scenarios.md` | Make.com scenarios for signals, funnel, briefings | [`packages/core/`](../../packages/core/) modules + cron endpoints |
| `edge-function-rep-context.ts` | v2 Supabase Edge Function called from Relevance AI | [`apps/web/src/app/api/agent/route.ts`](../../apps/web/src/app/api/agent/route.ts) + [`apps/web/src/lib/agent/run-agent.ts`](../../apps/web/src/lib/agent/run-agent.ts) (unified Slack + dashboard runtime) + the slice contract under [`apps/web/src/lib/agent/context/`](../../apps/web/src/lib/agent/context/) |

Do not follow patterns described in these files. They will mislead you.

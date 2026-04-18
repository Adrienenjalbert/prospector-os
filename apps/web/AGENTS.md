# Apps/web — agent rules

## Read these first

1. **[`MISSION.md`](../../MISSION.md)** — what we're building, for whom, why.
2. **[`docs/PROCESS.md`](../../docs/PROCESS.md)** — how to add tools, connectors,
   workflows, eval cases, tenants.
3. **[`.cursorrules`](../../.cursorrules)** — workspace-wide patterns + the
   complete file map.

The rest of this file is web-app-specific guidance only.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## The signal-to-noise rule

**Reduce noise. Show only the most important information.** Reps already
drown in notifications. Any PR that adds more information surface has to
either (a) show it raises thumbs-up % or action rate, or (b) replace
something noisier. Hard limits:

- Proactive Slack pushes capped by `alert_frequency`: high=3, medium=2 (default), low=1. Dispatcher enforces via `checkPushBudget`.
- ≤ 3 items per list section. Expand on click if the rep wants more.
- ≤ 150 words per short-form agent response. Long-form only when the user
  asks to "explain" or "deep dive".
- ≤ 3 Next-Step buttons per agent reply.
- Similar events bundle into the next digest, not a new ping.
- No "just checking in" messages, ever.

When in doubt, cut.

## Web-app-specific reminders

- **Server vs client.** Use `createSupabaseServer()` in server components
  + server actions. Use `createSupabaseBrowser()` only on the client.
  The service-role client (`getServiceSupabase`) is allowed only inside
  server actions and API routes.
- **Tenant scoping.** Every Supabase query in a page/action must include
  `.eq('tenant_id', profile.tenant_id)` even though RLS would catch it —
  defence in depth and the query planner needs the index.
- **Auth flow.** `redirect('/login')` from server components if no user.
  Don't rely on middleware redirects for the dashboard tree.
- **Streaming agent route.** `apps/web/src/app/api/agent/route.ts` is the
  one entry point for chat. Slack inbound, web chat, and Action Panel
  invocations all go through here. Don't add a parallel route.
- **Workflows are durable.** Long work goes in `lib/workflows/`, not
  inline in API routes. Pre-call brief, transcript ingest, weekly
  digest, attribution, calibration — all workflows.
- **Action Panel** is the canonical "action" UI. New per-object actions
  go in `components/ontology/action-panel.tsx` plus a corresponding
  prompt template the agent will resolve.
- **Suggested next actions.** Every assistant message renders
  `<SuggestedActions />`. The agent's behaviour rules require a
  `## Next Steps` section — the component parses it. If you change the
  prompt structure, update the parser.
- **Citation pills** appear under every assistant message — see
  `components/agent/citation-pills.tsx`. Do not bypass them.
- **No new "agent types".** "Agent type" / "agent surface" are interchangeable
  names for a preset of the one universal agent (prompt + tool subset).
  If you're tempted to add a new one, first ask: could this be a new
  context strategy + tools, or a config of an existing surface? `AgentType`
  in code is a deprecated alias for `AgentSurface`; new code uses the
  latter.

# Engineering process

> This is the playbook for building, scaling, and maintaining the OS.
> Read [`MISSION.md`](../MISSION.md) first — that's the strategic *why*.
> Read [`ARCHITECTURE.md`](../ARCHITECTURE.md) next — that's the
> engineering *how* (three-tier harness, four loops, four agent surfaces,
> telemetry contract, cost-discipline mechanics, cite-or-shut-up
> enforcement).
> This file is the *step-by-step* — how to add a tool, connector,
> workflow, eval, tenant; the on-call playbook; the anti-patterns.

The OS is designed to be modified by adding rows, not by rewriting code.
That's the recipe for moving fast without breaking trust.

---

## The three-tier harness — which layer owns what

The OS applies structure selectively. See
[`ARCHITECTURE.md`](../ARCHITECTURE.md) §3 for the full doctrine; this
table is the operational reference.

| Tier | Where it lives | What must be true | Where to look |
|------|----------------|-------------------|---------------|
| **1. Agent chat** | `apps/web/src/app/api/agent/route.ts` | Tools typed in, `## Next Steps` + citations out. Loop itself is flexible. | `agent/agents/_shared.ts` |
| **2. Tools** | `apps/web/src/lib/agent/tools/` | Zod schema in, `{ data, citations }` out, errors classified, cooldown honoured, telemetry emitted | `agent/tools/handlers.ts`, `agent/tools/middleware.ts` (Phase 4) |
| **3. Workflows** | `apps/web/src/lib/workflows/` | Idempotency key, `tenant_id` scope, `shouldSuppressPush` on proactive push, parallel DAG when steps share no deps | `workflows/runner.ts`, `scripts/validate-workflows.ts` |

### When in doubt

- New capability feels like "a novel answer a rep might ask" → it's a
  **Tier 2 tool**. The agent chooses to call it; the chat loop stays free.
- New capability feels like "the OS should do X on schedule / on event" →
  it's a **Tier 3 workflow**. One file in `lib/workflows/`, one row in the
  dispatcher, validated at load time.
- Never add code to Tier 1 that could belong in Tier 2 or 3. The chat loop
  is a thin router.

---

## How to add a new tool

A "tool" is anything the agent can call to fetch data, draft something, or
trigger a side effect.

### 1. Define the tool

Pick a slug (snake_case, ≤ 40 chars). Write a TS handler in
`apps/web/src/lib/agent/tools/handlers/<slug>.ts`:

```ts
import { z } from 'zod'
import { registerToolHandler } from '../../tool-loader'

const inputSchema = z.object({
  account_name: z.string().describe('Company name to look up'),
})

registerToolHandler({
  slug: 'find_similar_accounts',
  schema: inputSchema,
  build: (ctx) => async (args) => {
    const { data } = await ctx.supabase
      .from('companies')
      .select('id, name, icp_score, industry')
      .eq('tenant_id', ctx.tenantId)
      .eq('industry', /* ... */)
      .limit(5)
    return { matches: data ?? [], citations: [] }
  },
})
```

### 2. Seed the registry row

Add it to `scripts/seed-tools.ts` and re-run the seed:

```bash
npx tsx scripts/seed-tools.ts
```

The row controls who sees it (`available_to_roles`) and whether it's
enabled. Operators can toggle it from `/admin/ontology` without a deploy.

### 3. Wire citations

Open `apps/web/src/lib/agent/citations.ts`. Add an extractor under
`EXTRACTORS` that maps your tool's result shape to citation rows. If
your tool returns `companies`, mirror an existing pattern; for new
ontology types, add an `addX` helper at the top.

### 4. Add an eval case

Open `apps/web/src/evals/goldens.ts`. Add at least one entry that
specifies a question reps would ask, your tool slug in `expected_tools`,
and the expected citation type. The CI eval suite will exercise it on
every PR.

### Done

The agent will pick up the new tool on its next request because the loader
queries `tool_registry` per call. No deploy required between row insert
and tool availability.

---

## How to add a new connector

A connector is an external system (HubSpot, Apollo, Tableau, Snowflake,
Gong, Fireflies). Connectors store credentials and expose a typed read/write
interface that tools can call.

1. Add the adapter under `packages/adapters/src/<name>/`. Implement the
   `ConnectorInterface` from `packages/adapters/src/connectors/interface.ts`.
2. Register a row in `connector_registry` (per-tenant). `auth_type`,
   `field_mapping`, and `auth_credentials_encrypted` columns drive the
   adapter's behaviour at runtime.
3. Tools that need this connector reference it via
   `tool_registry.requires_connector_id`. The loader fetches credentials
   and hands them to the handler.
4. If the connector pushes data via webhook, add a route in
   `apps/web/src/app/api/webhooks/<name>/`. Verify HMAC. Store
   idempotency keys in `webhook_deliveries`.
5. If the connector emits ontology objects (deals, contacts, signals),
   normalise them via `packages/adapters/src/<name>/normalizers/` so all
   sources agree on shape.

---

## How to add a new workflow

Workflows are durable, observable, retryable pipelines. Use one when:

- The work runs on a schedule (nightly, weekly).
- The work waits for time to pass (T-15 pre-call brief).
- The work has multiple steps that must each succeed before the next.
- The work needs idempotency keys for safe retries.

### 1. Write the workflow

Create `apps/web/src/lib/workflows/<name>.ts` with `enqueueX` and `runX`
exports. Use the `runner` helpers (`startWorkflow`, `runWorkflow`, `Step`).
Each step returns its result; the runner persists it. To wait, return
`{ wait_until: ISOString }`.

### 2. Register the dispatcher

Edit `apps/web/src/app/api/cron/workflows/route.ts` and add a `case` for
the new `workflow_name` that calls `runX(supabase, row.id)`.

### 3. Schedule the enqueue

If it's per-tenant nightly, add the enqueue to
`apps/web/src/app/api/cron/learning/route.ts`. If it's webhook-triggered,
call `enqueueX` from the webhook handler. If it's per-event, call it from
the relevant tool result handler.

### 4. Update `vercel.json`

Only if you need a new cron schedule. Most workflows reuse `cron/workflows`
(every 5 min) or `cron/learning` (nightly).

### 5. Add an eval case (optional)

If the workflow produces an LLM output (briefs, digests, MEDDPICC), add a
golden eval that compares output structure against the Zod schema in
`packages/core/src/types/schemas.ts`.

---

## How to add an eval case

You probably don't need to. Production failures auto-promote into
`eval_cases` via `evalGrowthWorkflow`. Visit `/admin/evals` to review and
accept the auto-promoted cases.

If you're seeding a new capability (e.g. shipping a new tool), add a hand-
written case in `apps/web/src/evals/goldens.ts` so the first eval run
exercises it.

---

## How to ship a calibration proposal

The system writes calibration proposals automatically. Operators review:

1. Go to `/admin/calibration`.
2. Inspect the proposed change (prompt diff, scoring weights, tool prior).
3. If lift is positive on the holdout sub-suite, click **Approve**.
4. The change writes to the relevant table + a row in `calibration_ledger`
   for full audit history.
5. Rollback is one DB operation: re-apply the `before_value` from the
   ledger.

Auto-apply mode (no human in the loop) is available *only* once a tenant
has 3+ approved cycles for that change type. This protects new tenants
from the optimiser drifting into a worse local minimum.

---

## How to onboard a new tenant

1. Insert a row in `tenants` (active = true, set `crm_type`).
2. Insert a row in `business_profiles` with `company_name`,
   `target_industries`, `value_propositions`, `agent_name`.
3. Connect the CRM via the onboarding wizard (`/onboarding`). Credentials
   stored encrypted in `tenants.crm_credentials_encrypted`.
4. Run the baseline survey (`/onboarding/baseline`) for ≥ 80% of pilot
   users. This anchors time-saved ROI claims.
5. Seed `tool_registry` rows for the tenant with
   `npx tsx scripts/seed-tools.ts`. The seed is idempotent.
6. Wait for the first nightly `cron/sync` to populate `companies`,
   `opportunities`, `contacts`. Then the first `cron/score` writes
   propensity + tier per company.
7. Day-one usable. Adaptation kicks in as users feed back. Time-to-
   customised: ~30 days for the first cycle of approved calibrations.

---

## On-call playbook

### Symptom: agent responses missing citations

1. Check `agent_events` for `event_type = 'response_finished'` with
   `payload.citation_count = 0`.
2. Check the tool calls made — does the citation extractor in
   `apps/web/src/lib/agent/citations.ts` know about that tool?
3. If a new tool was added without an extractor, add it now. The agent
   will pick up the change on the next request.

### Symptom: thumbs feedback not persisting

1. Confirm the `agent_interaction_outcomes` insert in
   `apps/web/src/app/api/agent/route.ts` is firing — check
   `agent_events` for `event_type = 'response_finished'` rows. If they
   exist but `agent_interaction_outcomes` doesn't, the insert is failing
   silently. Look at server logs.

### Symptom: pre-call brief never sent

1. Check `workflow_runs` for the meeting's `idempotency_key` (`pcb:<meeting_id>`).
2. Status `scheduled` with `scheduled_for` in the future = waiting on cron
   drain. `cron/workflows` runs every 5 min.
3. Status `error` = read the `error` column. Common causes: HubSpot owner
   has no `slack_user_id`, company not yet synced.

### Symptom: cron drift

1. Compare `vercel.json` to `apps/web/src/app/api/cron/`. Every scheduled
   path must have a route file. Vercel returns 404 silently if missing.

### Symptom: workflow stuck

1. `workflow_runs` row in `running` for > 1h: Vercel function probably
   timed out. Manually update status to `error` and retry.
2. `workflow_runs` row in `scheduled` past its `scheduled_for`: cron
   drain not firing — check vercel.json crons + recent
   `cron_runs.route='/api/cron/workflows'` rows.

### Symptom: rep complaints about cost

1. Check `tenants.ai_tokens_used_current` vs `ai_token_budget_monthly`.
2. The route falls back to Haiku at 90% of budget; 100% returns 429.
3. Per-tenant token telemetry is in `agent_events.payload.tokens` aggregated
   over `event_type = 'response_finished'` rows.

---

## Cost discipline

- Default model: `anthropic/claude-sonnet-4`. Auto-fallback to Haiku at
  90% monthly budget.
- Eval judge model: Haiku (cheap). Strong model (Opus) reserved for
  prompt optimizer + self-improve meta-agent only.
- Max steps per agent loop: 8 (`stopWhen: stepCountIs(8)`). Block runaway
  multi-step reasoning at the source.
- Max tokens per response: 3000. Set conservatively; raise per-tenant if
  needed via `business_profiles.max_tokens_override` (TBD column).
- Embeddings model: `text-embedding-3-small` (1536 dims). Cheap; keep it.

---

## Privacy + security

- Every table has RLS. New tables inherit the `tenant_isolation` policy
  pattern from migration 002 — copy it verbatim.
- CRM credentials are encrypted at rest in
  `tenants.crm_credentials_encrypted` via `apps/web/src/lib/crypto.ts`.
- Webhooks must verify HMAC + check timestamp window (5 min) +
  store idempotency keys in `webhook_deliveries`.
- Slack tokens come from `SLACK_BOT_TOKEN` env, never persisted in
  Postgres. Per-tenant tokens go in `tenants.business_config.slack_*`.
- Service-role Supabase client is only used in server actions and API
  routes. Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.

---

## Release process

- Trunk-based. Every PR runs:
  1. Vitest across `@prospector/core` (~94 tests, scoring + funnel),
     `@prospector/adapters`, and `apps/web` (citations, tool middleware,
     workflow runner + holdout, onboarding helpers).
  2. TypeScript `tsc --noEmit` for the affected workspace.
  3. Agent eval suite (golden goldens + auto-promoted cases) — blocks
     on regression.
  4. `npm run validate:workflows` — AST contract on every workflow.
- Vercel preview deploys per PR. Manual smoke test of the agent route
  (one chat from the preview URL) is required before merge.
- After merge to `main`, Vercel promotes to production within minutes.
  Roll back via the Vercel dashboard or by reverting the commit.
- Migrations: write the migration as `packages/db/migrations/NNN_*.sql`,
  apply via Supabase dashboard or `supabase db push`. Never edit a
  shipped migration; always write a new one.

---

## Anti-patterns to call out in code review

- **A new page that's not an ontology view.** Ask: could this be a list
  view of an existing object type with a different filter?
- **A new agent type or "specialist" prompt.** We have one agent. Add a
  context strategy or a tool, not a new agent.
- **Hardcoded thresholds in scoring.** Move to `tenants.scoring_config`
  JSONB so the calibration loop can tune them.
- **Demo data in analytics.** Either real data or an empty state. Never
  plausible-but-fake.
- **A tool that doesn't return citations.** Every tool result is a
  `{ data, citations }` shape. Citations are not optional.
- **An agent response without a `## Next Steps` section.** The
  SuggestedActions UI parses this; without it, users get dead-end answers.
- **A workflow without an `idempotency_key`.** Retries duplicate work.
- **A webhook without HMAC.** Replayable, spoofable. Block on review.

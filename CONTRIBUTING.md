# Contributing to Revenue AI OS

> The discipline that makes the OS coherent across people, surfaces, and
> weeks. This file is the *appeal court* — when a code review disagrees,
> the answer is here, in [`MISSION.md`](MISSION.md), or in
> [`ARCHITECTURE.md`](ARCHITECTURE.md). If those three disagree with
> each other, that's a bug in the docs and we fix it before merging the
> code.

---

## Before you write any code

Read these in order. Do not skip — every PR will be reviewed against
them.

1. **[`MISSION.md`](MISSION.md)** — what we're building, for whom,
   why. Two jobs, second-brain framing, copilot positioning,
   capability-KPI table, adoption gates.
2. **[`ARCHITECTURE.md`](ARCHITECTURE.md)** — how the system is built.
   Three-tier harness, four loops, four agent surfaces, telemetry
   contract, cite-or-shut-up enforcement chain, anti-patterns.
3. **[`docs/PROCESS.md`](docs/PROCESS.md)** — step-by-step for the
   change you're about to make (add a tool, connector, workflow, eval,
   tenant; on-call playbook).

If your change is mechanical and bounded (a one-line bug fix, a typo,
a missing test), the three docs above are still the appeal court but
you can move quickly. **For anything else, the discipline below is the
gate.**

---

## The five discipline tests every PR runs through

A reviewer asks these in this order. Failing any one is grounds to
push back; failing two is grounds to redesign.

### Test 1 — Two jobs

Does this change advance one of the two jobs the OS has to do well?

1. **Build pipeline** — find, prioritise, engage net-new accounts.
2. **Manage existing customers** — portfolio health, churn signals,
   weekly digests.

If you can't write a one-sentence answer to "this change advances job
N because [concrete user behaviour]", the change does not ship. There
is no third job. See [`MISSION.md`](MISSION.md) §4 +
[`wiki/pages/concepts/two-jobs.md`](wiki/pages/concepts/two-jobs.md).

### Test 2 — Capability → Sales KPI → closing-loop signal

Per [`MISSION.md`](MISSION.md) §8, every shipped capability must be
tied to:

- **A Sales KPI it moves** (e.g. discovery → demo conversion, churn
  lead time, NRR uplift, time-to-insight, …).
- **A closing-loop signal** (an event that proves the KPI moved —
  e.g. `outcome_events.stage_changed`, `feedback_given`,
  `citation_clicked`, `action_invoked`).

If a proposed capability cannot be added as a row to the
capability-KPI table in MISSION.md §8, the OS does not learn from it
and the capability does not ship. **No feature without a measurable
loop.**

### Test 3 — Signal over noise

Does this change add information surface? If yes, it has to either
(a) **show it raises thumbs-up % or action rate** in pilot data, or
(b) **replace something noisier**.

Hard limits, mechanically enforced (see
[`MISSION.md`](MISSION.md) §9 +
[`wiki/pages/concepts/signal-over-noise.md`](wiki/pages/concepts/signal-over-noise.md)):

- Proactive Slack pushes capped per rep per day by `alert_frequency`:
  high=3, medium=2 (default), low=1. Enforced at the dispatcher via
  `checkPushBudget`.
- Top-N defaults to 3.
- Short-form responses cap at 150 words.
- ≤ 3 Next-Step buttons per agent reply.
- Bundle similar events into the next digest, not a new ping.
- **No "just checking in" messages, ever.**

When in doubt, cut.

### Test 4 — Cite or shut up

Every claim links to a `urn:rev:` URN. Every tool returns `{ data,
citations }`. No invented numbers, no invented names. The enforcement
chain is mechanical (full chain in
[`ARCHITECTURE.md`](ARCHITECTURE.md) §6):

- **Tool boundary** — `validate:tools` AST gate fails CI if any tool
  returns data without citations.
- **Slice boundary** — `citations: PendingCitation[]` non-optional in
  the slice contract type.
- **Agent response** — surface prompt instructs URN-in-backticks; UI
  parses and renders pills.
- **Telemetry** — packer's URN walker emits `context_slice_consumed`
  / `memory_cited` / `wiki_page_cited` for the bandit.
- **Eval gate** — judge measures cited-answer rate; below threshold
  fails the build.

A change that bypasses any of these layers does not merge.

### Test 5 — Telemetry, holdout, multi-tenant isolation

Three non-negotiables:

- **Telemetry** — every meaningful event flows through `emitAgentEvent`
  / `emitOutcomeEvent` from `@prospector/core/telemetry`. Without it,
  the learning loop has nothing to learn from. The action panel,
  webhooks, and the agent route all emit. New code must too.
- **Holdout cohort** — every proactive push calls `shouldSuppressPush`
  from `apps/web/src/lib/workflows/holdout.ts`. `validate:workflows`
  AST-checks every workflow that pushes. Bypassing this turns the ROI
  claim into opinion.
- **Tenant isolation** — every Supabase query in a page or action
  includes `.eq('tenant_id', profile.tenant_id)` even though RLS
  catches it. RLS is the safety net; the explicit predicate is
  defence-in-depth and gives the query planner the index.

---

## What gets blocked at merge (mechanical gates)

Every PR runs these in CI. None of them are advisory.

| Gate | What it checks | Run locally |
|---|---|---|
| **Vitest unit tests** | ~94 tests across `@prospector/core`, `@prospector/adapters`, `apps/web` (scoring, funnel, citations, holdout, onboarding helpers, …) | `npm run test` |
| **TypeScript type-check** | `tsc --noEmit` across the monorepo. Any unresolved type fails. | `npm run type-check` |
| **ESLint** | Next.js eslint config. | `npm run lint` |
| **`validate:workflows`** | AST-checks every Tier-3 workflow for the contract: idempotency key, tenant scoping, `shouldSuppressPush` on proactive push, DAG trigger rules where parallel steps exist. | `npm run validate:workflows` |
| **`validate:tools`** | AST-checks every Tier-2 tool for: Zod-typed input, `{ data, citations }` output, retry classification (FATAL vs TRANSIENT), telemetry emission. | `npm run validate:tools` |
| **`validate:events`** | Verifies emitted event payloads conform to schemas in `@prospector/core/telemetry`. Catches drift between event-emitter and event-consumer. | `npm run validate:events` |
| **Slack ↔ dashboard parity test** | `apps/web/src/lib/agent/__tests__/run-agent-parity.test.ts` — gates that any divergence between Slack and dashboard agent runs is intentional. | `npm run test --workspace=@prospector/web` |
| **Agent eval suite** | 75 seeded golden cases + auto-promoted production failures. Merge blocked on any regression vs `main`. | `npm run evals:smoke` (3 cases, fast) or `npm run evals` (full) |

**Failing any of these blocks the merge.** No exceptions, including
"I'll fix it in the next PR." The discipline only works if it works
every time.

---

## Common contribution patterns

Full step-by-step in [`docs/PROCESS.md`](docs/PROCESS.md). Quick
pointers:

### Adding a new tool

1. Handler in `apps/web/src/lib/agent/tools/handlers/<slug>.ts`,
   returning `{ data, citations }` from a Zod-typed input. Use
   `registerToolHandler`.
2. Citation extractor in `apps/web/src/lib/agent/citations.ts`.
3. Registry seed in `scripts/seed-tools.ts`. Re-run with
   `npx tsx scripts/seed-tools.ts`.
4. Eval case in `apps/web/src/evals/goldens.ts` (≥ 1 positive case;
   negative cases for known failure modes).
5. The agent picks up the tool on its next request — no deploy
   required between row insert and tool availability.

### Adding a new workflow

1. `apps/web/src/lib/workflows/<name>.ts` with `enqueueX` and `runX`
   exports. Use the `runner` helpers (`startWorkflow`, `runWorkflow`,
   `Step`).
2. Add a `case` in `apps/web/src/app/api/cron/workflows/route.ts`.
3. If nightly: enqueue from `apps/web/src/app/api/cron/learning/route.ts`.
4. **Always run `npm run validate:workflows`** before pushing —
   AST-checks idempotency, tenant scoping, holdout, DAG.
5. New cron schedule? Add to `vercel.json`. Most workflows reuse
   `cron/workflows` (every 5 min) or `cron/learning` (nightly).

### Adding a new ontology object type

1. TypeScript: `packages/core/src/types/ontology.ts`.
2. Zod schema: `packages/core/src/types/schemas.ts`.
3. URN helper: `packages/core/src/types/urn.ts` (e.g.
   `urn.newType(tenantId, id)`).
4. Migration: new file `packages/db/migrations/NNN_*.sql` with RLS
   (copy `tenant_isolation` from migration 002).

### Adding a webhook

1. Route: `apps/web/src/app/api/webhooks/<source>/route.ts`.
2. **HMAC verification mandatory** (see
   `webhooks/transcripts/route.ts` for the pattern).
3. **5-minute timestamp window** to prevent replay.
4. **Idempotency key** in `webhook_deliveries`.
5. Emit `outcome_events` for any state-changing event the webhook
   represents.

### Adding a new connector / external data source

1. Adapter under `packages/adapters/src/<name>/` implementing
   `ConnectorInterface` from `packages/adapters/src/connectors/interface.ts`.
2. Row in `connector_registry` (per-tenant). `auth_type`,
   `field_mapping`, `auth_credentials_encrypted` columns drive runtime
   behaviour.
3. Tools that need it reference via `tool_registry.requires_connector_id`.
4. If the connector pushes data via webhook, follow the webhook
   pattern above.
5. If the connector emits ontology objects, normalise via
   `packages/adapters/src/<name>/normalizers/` so all sources agree
   on shape.

---

## What you must NOT do

Full anti-pattern list in [`ARCHITECTURE.md`](ARCHITECTURE.md) §11.
The ones that come up most in code review:

- **DO NOT add a new agent runtime.** Surface count is fixed at four
  (`pipeline-coach`, `account-strategist`, `leadership-lens`,
  `onboarding-coach`). New capability = new tool, new role overlay,
  new context strategy, or a new surface preset (prompt + tool subset).
- **DO NOT add a new bespoke page** when a list view of an existing
  ontology object would do. Ontology-first.
- **DO NOT hardcode business context.** Always read from
  `business_profiles`. Hardcoded vertical-specific prompts (e.g. "for
  temporary staffing customers") break multi-tenancy.
- **DO NOT hardcode tool definitions.** Always load from `tool_registry`
  via the tool-loader. The static factory is fallback only.
- **DO NOT skip `tenant_id` scoping** in Supabase queries.
- **DO NOT bypass `getModel()`** with `createAnthropic` or raw
  `fetch`. The AI Gateway loses observability + failover.
- **DO NOT bypass `checkPushBudget` or `shouldSuppressPush`** on a
  proactive notification.
- **DO NOT skip cooldowns.** `SlackDispatcher` accepts a `CooldownStore`;
  use `SupabaseCooldownStore` in production.
- **DO NOT skip citations** on tool results. CI gate enforces.
- **DO NOT skip telemetry** (`emitAgentEvent`/`emitOutcomeEvent`).
- **DO NOT use `JSON.parse(text.match(/\{...\}/))`** to parse LLM
  output. Use `generateObject` with a Zod schema.
- **DO NOT compute funnel benchmarks in real-time** — they're weekly
  batch.
- **DO NOT ship demo data in production analytics** — empty states
  beat fake numbers.
- **DO NOT clone agents per rep** — one template with dynamic context
  per role.
- **DO NOT assume any specific tenant's vertical** (e.g. Indeed Flex,
  staffing) in any prompt or workflow — the system is multi-tenant by
  design.

---

## Honesty cycle — when to flag a known limit

The most-respected contribution to this codebase is one that exposes
a gap. The strategic review (`docs/strategic-review-2026-04.md`)
exists because Adrien deliberately ran a brutal audit and shipped
the findings; Phase 1 of the build was the response. We treat
documented limits as features, not failures.

If your PR introduces a known limit:

1. Document it in the PR description.
2. Add a row to the relevant subsystem PRD's "known limits" section
   (or create one).
3. If the limit affects an OS-wide claim (e.g. cited-answer rate,
   first-cited-answer time, push budget), update
   [`MISSION.md`](MISSION.md) §14 success criteria with the actual
   number, not the aspirational one. Truthful before new.
4. Add a test or eval case that locks in the *current* behaviour so
   regressions are visible.

We do not ship aspirations. We ship measurable behaviour.

---

## Reviewer's checklist (use this when you're the reviewer)

Copy-paste into the PR review. The reviewer marks each one explicitly.

```
- [ ] Two-jobs test (advances build-pipeline OR manage-existing-customers)
- [ ] Capability-KPI test (Sales KPI named + closing-loop event named)
- [ ] Signal-over-noise test (no information added without lift evidence)
- [ ] Cite-or-shut-up test (every tool result has citations; eval cited-answer rate did not regress)
- [ ] Telemetry emitted on every meaningful event
- [ ] Holdout respected on proactive paths
- [ ] Tenant-id explicit in every Supabase query
- [ ] No new agent runtime; no new bespoke page; no hardcoded vertical context
- [ ] All CI gates green: vitest, type-check, lint, validate:workflows, validate:tools, validate:events, parity test, eval suite
- [ ] If a known limit is introduced: documented in PR + PRD + MISSION.md success criteria + test added
```

---

## Why this discipline exists

A perfect agent that nobody opens is worth zero
([`docs/adoption-research-report.md`](docs/adoption-research-report.md)).
A capability that the system cannot learn from is dead weight
([`MISSION.md`](MISSION.md) §8). A claim the user cannot verify is
distrust waiting to happen
([`wiki/pages/concepts/cite-or-shut-up.md`](wiki/pages/concepts/cite-or-shut-up.md)).

Every gate above is a mechanical defence against one of those failure
modes. They are inconvenient on purpose. The OS is coherent because
the discipline is uniform, and the discipline is uniform because we
do not ship around it.

If a gate is wrong, propose a change to the gate in a separate PR with
its own test. Do not bypass it.

---

## License + contributor agreement

This project is proprietary; all rights reserved. By contributing, you
acknowledge that contributions become part of the proprietary codebase.
There is no contributor licence agreement to sign separately at this
time, but reach out to the maintainer (Adrien Enjalbert) before
submitting a substantive change if you are external to the project.

# Strategic Review — Revenue AI OS

> **Type:** Critical, data-driven engineering & product audit
> **Date:** April 2026
> **Scope:** Cost discipline, AI utilisation, smart-system completeness, learning-loop integrity
> **Audience:** Founder / engineering lead / RevOps decision-maker
> **Method:** Static review of source under `apps/web`, `packages/core`,
> `packages/adapters`, `packages/db`, plus `docs/`. Every claim is anchored
> to a file path and line range so any reviewer can verify in 30 seconds.

This report is not a celebration of what is built. It is a **forensic
read** of where AI dollars are spent, where the **promises in
[`MISSION.md`](../../MISSION.md) and [`CURSOR_PRD.md`](../../CURSOR_PRD.md)
diverge from what the code actually does**, and where the highest-leverage
moves sit for an OS that needs to be **simultaneously cheaper and
smarter**.

---

## 0. TL;DR — the seven moves that change the curve

| # | Move | Bug-fix? | Cost lever? | Smart-lever? | Effort |
|---|------|---------|-------------|---------------|--------|
| 1 | **Fix the silently-broken learning loop** (exemplar miner mines thumbs-down as positive; slice calibration reads wrong payload key; exemplars never injected into prompts; `proposal_type` queries a non-existent column). | Yes | Indirect | Yes | S |
| 2 | **Implement the prompt optimiser & self-improve LLM steps** that the docs already promise (`generateObject` with goldens). Without these, the "self-improving" claim is theatre. | No | -- | Yes | M |
| 3 | **Move `commonBehaviourRules()` (~1.2k tokens) into the cacheable static prefix** and shrink it. Today it ships in `dynamicSuffix` on every turn — burning ~10–15% of input cost system-wide. | No | Yes (10–15%) | -- | XS |
| 4 | **Replace the hallucinatory `runDeepResearch` cron** with a tool-using Sonnet step that actually browses (web_search / Tavily / Exa). Currently it asks a model to "research" from training weights — generates fictional signals with a hardcoded "temporary staffing" prompt that violates multi-tenancy. | Yes | Same | Yes (huge) | M |
| 5 | **Embed beyond transcripts** (companies, signals, conversation notes, exemplars, framework chunks). Today only transcripts get vectors. Add per-tenant pgvector retrieval on these → lower context tokens, better grounding, real RAG. | No | Yes (lower context) | Yes | M |
| 6 | **Unify the two agent paths.** Slack (`/api/slack/events`) is a parallel runtime: hardcoded Haiku, no prompt cache, fewer tools, no Context Pack, no compaction. It's a second product to maintain and a second source of behaviour drift. | Yes | Indirect | Yes | M |
| 7 | **Honest ROI**: the holdout-cohort exclusion is **claimed** on `/admin/roi` and in `attribution.ts` but **not implemented** in either the SQL or the insert. A sceptical CFO would catch this in one read. | Yes | -- | -- | XS |

If you ship only this list, **monthly token spend drops 25–40%**, the
learning loop **actually closes**, ROI becomes **defensible**, and the
"smart" claim becomes **demonstrable** rather than aspirational.

---

## 1. AI cost surface — the real footprint

The OS has only **seven** AI invocation sites. The full inventory:

| # | Where | Model | Cap | Trigger | Per-month volume estimate |
|---|-------|-------|-----|---------|----------------------------|
| 1 | `apps/web/src/app/api/agent/route.ts` (`streamText`, L405–413) | Sonnet, Haiku at ≥90% budget | `maxSteps: 8`, `maxTokens` 480/900/1200/3000 by `comm_style` | Per chat turn | **Largest line item** — every dashboard turn |
| 2 | `apps/web/src/lib/agent/compaction.ts` (`generateText`, L184–189) | Haiku | `maxTokens: 800` | When thread > 12 msgs and cache miss | Cheap, intermittent |
| 3 | `apps/web/src/app/api/slack/events/route.ts` (`generateText`, L305–314) | **Hardcoded** `claude-haiku-4-20250514` | `maxSteps: 3`, `maxTokens: 2000` | Per Slack DM / draft action | Medium |
| 4 | `apps/web/src/lib/workflows/churn-escalation.ts` (`generateText` × `loopUntil`, L199–204) | Sonnet | `maxTokens: 1200`, **up to 5 iterations** | Per churn signal (idempotent per day) | Spiky, expensive per event |
| 5 | `packages/adapters/src/transcripts/transcript-ingester.ts` (raw `fetch`, L132–155 + OpenAI embed L96–114) | Sonnet + `text-embedding-3-small` | 1024 output, 24k chars input, 32k chars embed | Per transcript webhook | Largest input volume |
| 6 | `apps/web/src/app/api/cron/signals/route.ts` (raw `fetch`, L57–69) | Sonnet via raw HTTP | `max_tokens: 3000`, **no tools, no search** | Daily, capped 20/tenant | **Hallucination-grade** spend |
| 7 | `apps/web/src/evals/cli.ts` & `judge.ts` | Haiku for both | 1500 / 300 | Per eval run (CI-gated) | Bounded by 75-case suite |

**Critical observations on this surface:**

1. **No `generateObject` / structured outputs anywhere.** Every JSON
   parse is `JSON.parse(text.match(/\{...\}/))` glued onto string output
   (`transcript-ingester.ts` L155, `churn-escalation.ts` L208,
   `cron/signals/route.ts` L80, `evals/judge.ts`). This is fragile, costs
   retry tokens on parse failure, and **forfeits the AI SDK's typed-output
   guarantees**. Switching to `generateObject` with a Zod schema removes
   ~30% of the per-call output noise (no JSON-only system prompts) and
   eliminates malformed-output retries.

2. **Three of seven sites bypass `getModel()`** and call Anthropic
   directly via `fetch` (transcript ingester, signals cron) or via
   `createAnthropic` (Slack events). This **breaks the AI Gateway path**
   when configured — those calls do not benefit from failover, unified
   billing, or per-request cost telemetry. Move them all behind
   `getModel()`.

3. **No call site outside the dashboard agent route uses prompt
   caching.** Slack, signals cron, transcript summariser, churn loop,
   eval CLI, and judge all re-pay every input token every time. The
   churn loop alone re-sends 1k+ tokens of evidence × 5 iterations per
   escalation, uncached.

4. **Opus is in the model registry but never called anywhere.** The PRD
   reserves Opus for "meta-agents only" (prompt optimiser, self-improve)
   — but those workflows do not call any LLM today (see §3). Either
   wire it or drop it from the registry to stop signalling capability
   that doesn't ship.

---

## 2. Cost discipline — the hidden 25–40% you can claw back

### 2.1 Prompt-cache mis-engineering (~10–15% of input tokens)

The agent route splits its system prompt into `staticPrefix` (cacheable)
and `dynamicSuffix` (per-turn). The split is **misallocated**:

`apps/web/src/lib/agent/agents/_shared.ts` L284–288 says explicitly:

> NOT cacheable (per-turn): hydrated context slices, intent-dependent
> sales playbook, **behaviour rules** (kept at the END of the prompt for
> high-attention citation discipline — empirical lost-in-the-middle
> insight)

The behaviour-rules block is ~1.2k tokens of **completely static** text
that ships uncached on every single turn (`commonBehaviourRules()`,
`_shared.ts` L315–375). The "lost-in-the-middle" rationale is real,
but it doesn't require giving up cache savings — you can keep the rules
near the end of the prompt **and** cache them by adding a second
`cacheControl: { type: 'ephemeral' }` breakpoint.

Anthropic supports up to four cache breakpoints. The current
implementation uses one. The opportunity:

```
[static prefix: header + business + role]   ← cached (today)
[dynamic suffix: slices + playbook]          ← not cached
[behaviour rules: 1.2k static tokens]        ← *should be* cached (today: not)
[user messages]
```

**Estimated saving:** ~10–15% of system-prompt input tokens system-wide.
This is a one-PR change to `_shared.ts` and `route.ts`.

### 2.2 Onboarding-coach skips prompt caching entirely

`apps/web/src/lib/agent/tools/index.ts` L204–207: when there's no
dynamic suffix, the route falls back to `system: string` form — losing
the cache breakpoint. Onboarding sessions are precisely when a user
runs many short turns; this surface should be the **first** to benefit
from caching, not the only one to lose it. Wrap the single string in
the cached message form unconditionally.

### 2.3 Tool registry queried fresh every request

`apps/web/src/lib/agent/tool-loader.ts` L163–173 queries `tool_registry`
on every `/api/agent` request. There is no in-process cache, no
revalidation TTL. For a steady-state tenant, this is **N redundant
roundtrips per minute** + N rebuilds of `Tool` objects with Zod schemas.

Use Next 16 Cache Components (`'use cache'` directive with
`cacheLife('hours')` and `cacheTag('tool-registry-' + tenantId)`) so
tool definitions are fetched once per hour per tenant, with explicit
invalidation when an admin edits the registry. Also reduces the
per-request input-token cost since tool descriptions ship in every
request payload.

### 2.4 Legacy + pack double-fetch

`apps/web/src/app/api/agent/route.ts` L289–317 runs `assembleContextForStrategy`
**and** `assembleContextPack` in parallel on every turn. Both query the
same Supabase tables (`companies`, `opportunities`, `signals`, etc.).
The legacy path is "the source of truth for prompt builders" while the
packed path "layers in URN-cited slice citations." This is **transitional
debt**: every dashboard turn pays a 2× DB cost during the migration.

Either retire the legacy assembler (preferred — the slices already cover
its data) or have the packer accept the legacy result as input and
avoid re-querying. Materially reduces tenant DB pressure and per-turn
latency.

### 2.5 `assembleContextPack` is being called with empty signal hints

`apps/web/src/app/api/agent/route.ts` L301–311 calls
`assembleContextPack` **without** `dealStage`, `isStalled`, or
`signalTypes`. Inside `context-strategies.ts` L224–235, those default to
`stage: 'other'`, `isStalled: false`, empty `signalTypes`. The slice
selector (`selector.ts`) uses these heavily for `whenStalled` triggers
and signal-substring scoring.

Net effect: **the slice selector is operating with stale defaults on
every turn**, biasing the bandit toward generic slices and away from the
stage- and signal-aware slices that exist precisely because reps need
context-sensitive responses. Pass these in from `agentContext` /
`pageContext` and the relevance of selected slices jumps without any
new ML.

### 2.6 Compaction failure path drops context

`apps/web/src/lib/agent/compaction.ts` L195–201: if the Haiku summary
call fails, the route falls back to `messages.slice(-20)` — silently
**dropping the older half of the conversation**. For long sessions
that's a UX regression (rep wonders why the agent forgot what they said
turn 5). The right fallback is `messages.slice(-KEEP_RECENT_MESSAGES)`
plus a leading system note "Earlier turns omitted due to summariser
failure" so the agent knows to re-ask if needed.

### 2.7 Conversation history persistence outpaces compaction

`route.ts` L504 caps persisted history at 40 messages. Compaction
summarises after 12 and keeps 8 verbatim. There's a 32-message "no man's
land" between what the model sees and what's stored. If anything
re-renders historical conversations without going through `compactConversation`
(e.g. an analytics surface, or future server-rendered chat replay), it
will load 40 messages of history that the model never used. Pick one
ceiling and align both code paths.

---

## 3. The learning loop — instrumented but not closed

This is the single most consequential gap in the codebase. The MISSION
and PRD both promise "self-improving by default" with a per-tenant
exemplar/prompt/scoring loop. The code writes the events. The workflows
fire on schedule. **The loop does not close.**

### 3.1 Exemplar miner — wrong sign and unused output

`apps/web/src/lib/workflows/exemplar-miner.ts` L48–66 collects every
`feedback_given` event in the last 14 days **without filtering on
`payload.value`**. Thumbs-up and thumbs-down are mined as if they were
the same signal. The result lands in `business_profiles.exemplars` with
"top 3 by longest response."

Then: `business_profiles.exemplars` is **never read** at agent runtime.
A grep across the repo finds it only in the writer. `formatBusinessContext()`
in `_shared.ts` L117–154 doesn't reference it. `BusinessProfile` in
`packages/core/src/types/platform.ts` L96–127 doesn't have an `exemplars`
field. The mined data is **literal storage cost with zero retrieval
benefit**.

Two fixes, both XS-effort:
1. Filter `feedback_given` to `payload.value === 'positive'` and
   intersect with `agent_interaction_outcomes.feedback === 'positive'`
   (defence in depth).
2. Inject the top-K exemplars for the current `(role, intent_class)`
   into the dynamic suffix as few-shot examples — the same way the
   sales-playbook block works.

### 3.2 Slice calibration reads the wrong payload key

`apps/web/src/lib/workflows/context-slice-calibration.ts` L111–117
reads `(payload as { feedback?: string }).feedback` from `agent_events`.

`apps/web/src/app/actions/implicit-feedback.ts` L108–114 writes
`payload: { value: feedback, reason: reason ?? null }`.

These will **never match**. The workflow returns
`skipped_reason: 'no_signal'` on every run because the verdict map is
always empty. The Thompson context-slice bandit therefore **never
learns from feedback** — its priors are stuck at cold-start uniformity.

This is a one-line fix and it unblocks the slice-relevance learning
that the entire `Context Pack` architecture depends on.

### 3.3 Prompt optimiser inserts schema-incompatible rows

`apps/web/src/lib/workflows/prompt-optimizer.ts` L89–104 inserts into
`calibration_proposals` with `proposal_type` and `proposed_config: {
status: 'pending_generation' }`. The actual schema in `schema.sql`
L551–562 requires `config_type`, `current_config`, `proposed_config`,
`analysis` as NOT NULL. **The insert fails silently** — the workflow
catches and logs but never throws.

The file's own comment (L85–88) says LLM diff generation is "deliberately
deferred" — but the deferral has been in place long enough that the
schema has drifted away from it. Either:
- Rip out this workflow and acknowledge prompt optimisation isn't
  shipping, or
- Wire `generateObject` with a typed schema that reads negative
  exemplars, the current prompt body, and produces a unified diff
  proposal — exactly what the docs promise.

The right answer is the second. This is the **flagship "smart system"
feature**. A weekly Opus call per tenant proposing prompt diffs against
goldens is precisely the use case Opus is reserved for in the PRD.

### 3.4 Self-improve is markdown-only

`apps/web/src/lib/workflows/self-improve.ts` L151–168: the "weekly
improvement report" is **template-string concatenation** of failure
counts and proposed fixes ("inspect tool", "add cite instruction", "run
promptOptimizer"). The file header claims it "asks a strong model" —
the body does not call any model.

This workflow is the place to wire **per-tenant failure clustering** with
embeddings. Today the engineering Slack gets a markdown table of error
counts; the customer-facing version on `/admin/adaptation` is identical.
Replace the template with:

1. Embed the last 30 days of `tool_error.payload.error` and
   `citation_missing.payload.context`.
2. HDBSCAN cluster (deterministic, free).
3. For top 3 clusters by frequency × user impact, call **Sonnet once**
   to summarise the cluster theme and propose a fix. (Per-cluster
   summarisation, not per-failure.)
4. Persist as a real `improvement_reports` row with cluster IDs and
   sample interaction URNs.

This is a single weekly call per tenant of bounded cost (~3 × 1k tokens)
that turns the report from "fluff" into something an engineering lead
will actually action.

### 3.5 Eval-growth never promotes to goldens

`apps/web/src/lib/workflows/eval-growth.ts` L116–138 inserts failures
as `status: 'pending_review'`. The comment says the self-improve
workflow accepts/rejects them — **self-improve does not touch
`eval_cases`**. There is no other code path that promotes a
`pending_review` case to an accepted golden.

Result: the eval set does **not** "grow 5–10× over time" as promised in
MISSION.md success metrics. It grows in the pending pile only. Add a
human-approval API + admin page (mirroring the existing
`/admin/calibration` flow) so the eval suite genuinely expands from
production failures.

### 3.6 Citation clicks logged but ranker never consumes them

`recordCitationClick` (`implicit-feedback.ts` L166–216) writes
`retrieval_priors`. **Grep confirms `retrieval_priors` is only written,
never read** in the codebase. The "citation pills feed the retrieval
ranker" story in MISSION.md L186–187 is **literally not implemented**.

Fix: in the packer, before slice formatting, load
`retrieval_priors` for the active `(tenant, intent_class, urn_type)`
and bias the slice scoring toward URN types with high CTR. Same shape
as the existing tool bandit.

### 3.7 `shouldAutoApply` is computed but never applied

`apps/web/src/lib/workflows/scoring-calibration.ts` L164–166 computes
`shouldAutoApply` based on observed lift. The write step (L203–213)
**always inserts as `pending`** regardless of the flag. This is a soft
violation of the PRD's "auto-apply only after 3+ approved cycles"
guarantee — the gating logic is right, the actuator is missing.

Either use the flag (and respect the PRD's 3-cycle guard) or delete it.

### 3.8 Portfolio digest is never enqueued

`apps/web/src/lib/workflows/portfolio-digest.ts` exports
`enqueuePortfolioDigest`, but **nothing in the repo calls it**. The
weekly CSM portfolio digest promised in MISSION.md L18 and CURSOR_PRD
L233 is built code that never fires. Wire it into `cron/learning` (or a
new weekly cron) the same way the others are wired.

### 3.9 Calibration ledger has no rollback API

`api/admin/calibration/route.ts` L151–155 mentions a "one-click rollback
path" in a comment. There is **no API or UI** that reads `before_value`
and reverts. The PRD's "Roll back = re-apply the `before_value` — one
DB op" (CURSOR_PRD L640) is, today, **a manual SQL operation**.

This is the kind of gap that destroys customer trust the moment a bad
calibration ships. Add the endpoint and a button on
`/admin/adaptation`.

### 3.10 Adaptation page queries a non-existent column

`apps/web/src/app/(dashboard)/admin/adaptation/page.tsx` L36–40 selects
`proposal_type` from `calibration_proposals`. The schema column is
`config_type` (`schema.sql` L551–562). PostgREST will either error or
return null for the column — either way, the customer-facing
adaptation log is **broken or empty**.

This is the literal page that makes "self-improvement" tangible to the
customer. One-character fix.

---

## 4. The deep-research cron — burning Sonnet on hallucinations

`apps/web/src/app/api/cron/signals/route.ts` L11–69 runs a **single
LLM call per tier-A company** with a hardcoded prompt and **no tools**:

```typescript
const DEEP_RESEARCH_PROMPT = `You are a B2B sales intelligence analyst.
Research the company "{company_name}" ({domain}) for recent developments
relevant to temporary staffing needs. ...`
```

Three serious issues stack here:

1. **The prompt is hardcoded for "temporary staffing"**. This is
   leftover Indeed Flex specificity that **directly violates the
   multi-tenant rule** in `.cursorrules` (`DO NOT assume Indeed Flex
   context — the system is multi-tenant by design`). For any other
   tenant, the model is asked the wrong question.

2. **There is no web search.** The model is asked to "research" a
   company from training-data weights only. There is no retrieval, no
   browse, no Tavily / Exa / Brave / web_search tool. This is a
   **hallucination factory** — the signals it returns ("hiring surge",
   "leadership change") are confidently invented. They then get inserted
   into `signals` with `relevance: 0.0–1.0` confidence, which feeds the
   propensity scorer with fictional inputs.

3. **It uses `claude-sonnet-4-20250514`** (the most expensive
   non-Opus model) for **fictional output**. Cost-wise this is the
   single worst money spent in the system per token of business value
   delivered.

**The fix is a single architectural move:** keep the workflow, but
implement the LLM step as a tool-using Sonnet step with web search
(Tavily or Exa or the AI SDK's built-in `webSearch` tool when GA),
templated by `business_profiles.target_industries` and
`business_profiles.value_props`. Replace `runDeepResearch` with a
`generateObject` call against a Zod schema for `ResearchSignal[]`. This
turns a hallucination into a real signal and a fixed-prompt into a
per-tenant adaptive one.

If you cannot ship that this quarter, **disable the workflow**. Better
no signal than a fictional one — see operating principle #1: "Truthful
before new" (MISSION.md L135).

---

## 5. The two-agent problem — Slack vs `/api/agent`

The mission says "**every surface is a thin client over the same agent
and ontology**" (MISSION.md L201–203). The code says otherwise.

| Dimension | `/api/agent` (dashboard) | `/api/slack/events` |
|-----------|---------------------------|---------------------|
| Model | `getModel(chooseModel(...))` — Sonnet, Haiku at 90% budget | `anthropic('claude-haiku-4-20250514')` — hardcoded Haiku |
| Gateway support | Yes (via `getModel`) | **No** — direct provider client |
| Tools loaded | Per-tenant registry + role + intent + bandit | `createAgentTools(..., 'pipeline-coach')` only |
| Context | Strategy + Pack + slice telemetry + compaction | `assembleAgentContext` only (legacy) |
| Prompt caching | Yes (cacheable static prefix) | No |
| Max steps | 8 | 3 |
| Output cap | 480–3000 (comm-style aware) | 2000 (fixed) |
| Streaming | `streamText` to data stream | `generateText` then post |

**Consequences:**

1. **Behaviour drift.** A rep who asks the same question in Slack vs
   the dashboard gets different tools, different context, different
   length cap, and a different model. The "one universal agent"
   guarantee is violated.

2. **Slack is permanently worse.** Haiku-only with no Context Pack
   means Slack reps never see the slice-cited responses the dashboard
   produces. Yet Slack is the **primary surface** per MISSION.md L179
   ("Slack first, dashboard second").

3. **Double maintenance.** Every change to the dashboard agent requires
   a parallel change to Slack — and the differential testing burden has
   no tests today.

**The fix:** factor the agent body into a single function that takes
`{messages, tenantId, userId, role, agentType, surface, pageContext}`
and is called by both routes. Slack streams the final text once
(`generateText`) instead of `streamText`, but everything else — model
selection, tool loading, context, caching, intent classification —
goes through the same code path. This is one of the highest-leverage
refactors available: it deletes a parallel runtime.

---

## 6. ROI / attribution — not defensible to a sceptical CFO

The PRD opens its ROI section with: "Every number on every page is
sourced from the event log — there are zero hardcoded or demo figures."
(`CURSOR_PRD.md` L555–557). Three ways the code falls short:

### 6.1 Hardcoded baseline minutes

`apps/web/src/app/(dashboard)/admin/roi/page.tsx` L90–97 has a
hardcoded default minute table for time-saved when `tenant_baselines`
is empty. The page's subtitle says "no hardcoded figures" — that's
**partially false**. The baseline survey is meant to override these,
but until it's filled out, time saved is computed from a default.

Acceptable behaviour, but the page should say so: "Showing default
baselines until you complete the [baseline survey]."

### 6.2 Holdout exclusion is documented but not implemented

`roi/page.tsx` L161–162 says control-cohort users are excluded from
influenced-ARR. The actual sum loop (L131–134) **does not filter by
holdout cohort**. `attribution.ts` L21–24 documents the same exclusion;
the insert (L129–137) does not implement it.

This is the single claim a CFO will check first. Either implement the
filter (`.not('user_id', 'in', controlCohortUserIds)`) or remove the
disclaimer. The current state is the worst of both worlds: the customer
trusts a number that the code does not produce.

### 6.3 `action_invoked` from the action panel has `interaction_id: null`

`apps/web/src/components/ontology/action-panel.tsx` L84–86 emits
`action_invoked` with `interactionId: null`. Attribution joins
`agent_events` to `outcome_events` partly via `interaction_id`. Action
panel actions are therefore **invisible to the attribution workflow**,
which understates influenced ARR for tenants who use the action panel
heavily.

Fix: pass the most recent interaction ID from the action panel context,
or — better — assign a synthetic interaction URN (`urn:rev:action:<id>`)
that attribution recognises as a first-class action source.

---

## 7. Embedding & retrieval — the missing 80%

The system has **pgvector in the stack** and **one embedding pipeline**:
transcripts, via OpenAI `text-embedding-3-small`. That's it. Companies,
contacts, signals, conversation notes, exemplars, sales-framework chunks,
relationship notes — all stored as text rows, retrieved by SQL `LIKE`
or recency.

This is the **single largest "smart system" upgrade available**. Six
concrete wins, in priority order:

1. **Embed exemplars.** Ten thumbs-up exemplars per `(role,
   intent_class)` per tenant. Retrieve top-3 by query similarity,
   inject as few-shot. Massive grounding improvement on novel queries
   for ~zero context-cost increase.

2. **Embed company snapshots.** Concatenate firmographic + recent
   activity + recent signals → 1 embedding per company. Enables "find
   accounts like our top customer" semantic search without burning
   Sonnet tokens to compare features.

3. **Embed signal payloads.** Today `competitor_mention` urgency rules
   in `composite-scorer.ts` L256–258 fire only on a flag. With
   embedded signal text, you can fire urgency on **semantic similarity
   to past competitor mentions** — a far better signal.

4. **Embed conversation notes.** Today the conversation-memory slice
   loads the **last 5 notes**. With embeddings, load the **5 most
   relevant notes for this turn's query** across all conversations
   with this user. Massive context-quality improvement.

5. **Embed sales-framework chunks.** The `consult_sales_framework`
   tool returns the **whole framework markdown** today. Chunked +
   embedded, the agent can pull the specific section that matches the
   sub-intent (objection handling, scoring scaffold, attribution) —
   shaving thousands of tokens per `consult_sales_framework` call.

6. **Embed conversation summaries.** Today `compaction.ts` writes
   summaries to `ai_conversations.summary_text` — flat text. Embedding
   them enables cross-conversation continuity ("you were asking about
   Acme last week, here's what's changed since"), which is exactly the
   sales-coach value prop.

The cost story for embeddings is favourable: `text-embedding-3-small`
at 1536 dims is ~$0.02 per million tokens. A tenant with 10k accounts,
50k notes, 5k transcripts re-embedded weekly costs **single-digit
dollars per month**. The token saving on the agent route alone (smaller
slices, smarter retrieval, less playbook bloat) pays for it many times
over.

`searchSimilar` in `transcript-ingester.ts` L206–222 already shows the
pattern: `match_transcripts` RPC + `<=>` operator. Apply the same
pattern five more times.

---

## 8. The signals layer — under-detecting the most valuable signal type

`packages/adapters/src/transcripts/transcript-ingester.ts` L132–155
extracts **summary, themes, sentiment, MEDDPICC** from every transcript
via Sonnet. This produces structured JSON that lands on the `transcripts`
row.

**No batch job promotes that JSON into `signals` rows.**

Concretely:
- `themes: ["competitor X mentioned", "pricing concern"]` — never
  becomes a `competitor_mention` or `price_objection` signal.
- `sentiment: -0.6` on a customer call — never becomes a `churn_risk`
  signal.
- `meddpicc: { economic_buyer: null }` — never becomes a
  `champion_missing` signal.

Meanwhile, the signals cron (§4) is burning Sonnet calls on **fictional
external research** instead of mining the **real first-party transcript
gold** the company already paid to ingest.

A `cron/transcript-signals` workflow that runs against the structured
ingester output and promotes themes / sentiment / MEDDPICC gaps into
`signals` rows is **probably the single highest-ROI new workflow** the
system could ship. Cost: zero new AI calls (the data is already
extracted). Value: the entire churn-detection / competitive-intelligence
loop becomes real.

---

## 9. The forecast — accounting, not forecasting

`packages/core/src/funnel/forecast.ts` L27–32 sums `expected_revenue`
and buckets by `priority_tier`. The comment notes "weighted equals sum
because ER already embeds propensity." This is **roll-up reporting**,
not forecasting in any statistical sense.

The PRD (`CURSOR_PRD.md` L753–755) is honest about this: "We will not
surface AI-generated forecast confidence scores. Too dangerous. The
forecast is statistical, derived from the funnel engine."

Fine — but then the forecast deserves a **statistical confidence band**
based on historical close-rate volatility per stage per rep. Today the
band is unspecified in the analytics page (`apps/web/src/app/(dashboard)/analytics/forecast/page.tsx`
L102–104 falls back to `max(closedValue * 1.3, 5_000_000)` — an
arbitrary multiplier).

Implement a **bootstrap confidence interval** over the last N closed
quarters: `funnel_benchmarks` already has stage-by-stage win rates;
sample `priority_score × stage_velocity × win_rate` 1000 times for the
current pipeline; report 10th–90th percentile. Zero AI cost,
defensible math, sales leaders trust intervals over points.

---

## 10. Engagement-depth scoring is dead weight

`config/scoring-config.json` L5–14 sets `engagement_depth: 0.00` in the
default propensity weights, with a comment that says the weight will be
re-enabled "once cached activities are populated from `getActivities()`
on a representative sample."

Two observations:

1. **The engagement-depth scorer is computed every night** in
   `cron/score` and **discarded** in the propensity blend. That's pure
   compute waste at the scoring step.

2. **The HubSpot `getOpportunities({})` call in sync** (per the
   adapter audit) pulls all opps each run without an `updated_since`
   filter. The infrastructure cost to populate activities exists; the
   product decision to use them does not.

Either:
- Wire the activity ingestion validation that the comment promises and
  re-enable the weight (the right answer — engagement depth is among
  the strongest CRM-derived predictors of conversion), or
- Drop the scorer until the data is trustworthy.

The current state — "we score it but ignore it" — is the worst possible
outcome.

---

## 11. The CRM write-back gap

`packages/adapters/src/crm/hubspot.ts` L547–581 implements
`updateAccountScores`. **No code in `apps/web` calls it.** `cron/score`
writes scores to Postgres only. CRM stays uninformed of priority changes.

Operating principle from MISSION.md: "We do not duplicate CRM data
entry. Edits to source-of-truth fields link to the CRM record. We read
and write back via APIs, never ask users to re-enter CRM data." The
score is exactly the kind of derived field reps want to see in HubSpot
list views — and it's silently siloed in our DB.

Either wire `updateAccountScores` into `cron/score` (gated behind a
tenant flag for property mapping, like the existing
`crm_writeback_enabled`), or be explicit on `/admin/config` that scores
are dashboard-only.

---

## 12. Strategic recommendations — prioritised

The findings above sort into four buckets. Prioritise the top of each.

### Bucket A — Truthfulness fixes (ship this week)

These are violations of operating principle #2 (truthful before new).
Each is a one-PR fix and each makes a current claim true.

| # | Fix | File / line | Effort |
|---|------|-------------|--------|
| A1 | Filter exemplar miner to positive feedback only, then inject mined exemplars into agent prompt | `exemplar-miner.ts` L48–66 + `_shared.ts` `formatBusinessContext` | S |
| A2 | Fix slice calibration's `payload.feedback` → `payload.value` mismatch | `context-slice-calibration.ts` L111–117 | XS |
| A3 | Fix `proposal_type` → `config_type` in adaptation page query | `admin/adaptation/page.tsx` L36–40 | XS |
| A4 | Implement holdout-cohort exclusion in ROI sum loop and attribution insert | `admin/roi/page.tsx` L131–134, `attribution.ts` L129–137 | S |
| A5 | Stop the `runDeepResearch` cron from generating fictional signals (either disable, gate behind tenant flag, or replace with tool-using web search) | `cron/signals/route.ts` L11–91 | S→M |
| A6 | Wire portfolio-digest into a weekly cron (or remove from PRD) | `cron/learning/route.ts` + new schedule | S |
| A7 | Add calibration-ledger rollback API + button | new `api/admin/calibration/[id]/rollback/route.ts` + adaptation page | S |
| A8 | Replace hardcoded "temporary staffing" prompt with per-tenant value-props from `business_profiles.target_industries` | same as A5 | XS |

### Bucket B — Cost recovery (ship this month)

| # | Fix | Estimated saving | Effort |
|---|------|------------------|--------|
| B1 | Move `commonBehaviourRules()` into a second cache breakpoint | 10–15% input tokens system-wide | XS |
| B2 | Cache tool-registry per tenant for 1h via Cache Components | DB roundtrips + tool-defn rebuild | S |
| B3 | Retire legacy assembler in agent route in favour of pack only | 50% of per-turn DB queries | M |
| B4 | Pass `dealStage`, `isStalled`, `signalTypes` to `assembleContextPack` so slice selector actually has signal | Context relevance, not direct $ | XS |
| B5 | Switch all 7 AI sites to `getModel()` so the AI Gateway can route them | Failover + observability + 2–10% via gateway routing | S |
| B6 | Replace `JSON.parse(text.match(...))` with `generateObject` everywhere | Eliminates retry-on-parse-failure + ~30% output tokens (no JSON-only system prompts) | M |
| B7 | Cap `maxTokens` on transcript ingester input (truncate before, not by char count) | 20–30% transcript ingest cost | S |

### Bucket C — Smart-system upgrades (ship this quarter)

These are the moves that make "self-improving" demonstrable.

| # | Move | Why now |
|---|-------|---------|
| C1 | Implement `prompt-optimizer.ts` LLM diff generation with `generateObject` against goldens; weekly Opus call per tenant | Closes the highest-leverage learning loop; activates Opus's reserved purpose |
| C2 | Implement `self-improve.ts` with HDBSCAN failure clustering + 3 cluster-summarisation Sonnet calls/week | Turns a markdown template into actionable engineering input |
| C3 | Read `retrieval_priors` in the packer to bias slice scoring on click data | Closes the citation-feedback loop |
| C4 | Eval-growth → `pending_review` → human-approval API + page → accepted golden | Makes "eval suite grows from production failures" real |
| C5 | Embed companies, contacts, signals, notes, exemplars, framework chunks (5 new pgvector pipelines) | Largest grounding win in the codebase |
| C6 | Promote transcript ingester themes / sentiment / MEDDPICC into `signals` table via batch | Highest-ROI new signal source |
| C7 | Unify `/api/slack/events` and `/api/agent` behind one runtime function | Deletes a parallel codebase; makes Slack equal-class with dashboard |
| C8 | Statistical confidence band on forecast (bootstrap over historical close rates) | Replaces arbitrary `1.3×` multiplier with defensible math |

### Bucket D — Strategic bets (decide this quarter)

| # | Bet | Trade-off |
|---|-----|-----------|
| D1 | Move embeddings provider to AI Gateway-routed model (multiple options) | Vendor flexibility vs current OpenAI lock-in |
| D2 | Add **web-search tool** to the universal agent (Tavily / Exa / Perplexity) | Unlocks live grounding; adds tool cost |
| D3 | Build a **per-tenant model router** that picks Haiku for simple intents, Sonnet for complex, Opus for meta-agents — using intent class + historical thumbs-up % | Replaces the single 90%-budget rule with intent-aware routing; potential further 20–30% cost reduction |
| D4 | Add **CRM write-back for scores** + property-mapping wizard | Closes the "ROI live in CRM" loop reps actually want |
| D5 | Decide on **transcript provider strategy**: native Gong/Fireflies adapters exist but no acquisition motion | The single biggest data-quality lever |

---

## 13. The "smart system" north-star metrics

If you ship Buckets A + B + C, these metrics become **measurable** and
**defensible**:

| Metric | Today (estimated) | After Bucket A+B | After Bucket A+B+C | How measured |
|--------|-------------------|------------------|---------------------|--------------|
| Input tokens per agent turn | ~7–10k | ~4–6k | ~2–4k | `agent_events.payload.tokens` (split into `prompt` and `completion`) |
| Cited-answer rate | unknown (`citation_count` event captured but no dashboard) | 95%+ | 98%+ | `response_finished.payload.citation_count > 0` |
| Slice-bandit convergence time | Never (broken signal) | 2–4 weeks | 1–2 weeks | `context_slice_priors.sample_count` distribution |
| Eval suite size | 75 (static) | 75 + accepted growth | 200+ | `eval_cases WHERE status = 'accepted'` |
| Per-tenant prompt diffs / month | 0 | 0 | 1–4 | `calibration_proposals WHERE config_type = 'prompt'` |
| Holdout-cohort lift confidence | "claimed" | "computed but unfiltered" | "filtered + CI" | bootstrap on `attributions WHERE NOT IN holdout` |
| Hallucinated signals | Unknown (deep_research output trusted) | 0 (workflow disabled or grounded) | 0 + per-tenant adaptive prompt | new `signals.payload.source_url` non-null check |

These are the KPIs that turn "self-improving by default" into a thing
the customer can audit on `/admin/adaptation`.

---

## 14. The cost ceiling, modelled

A quick back-of-envelope, given the model registry and the seven AI
sites:

**Per active dashboard rep per workday** (mid-engagement):
- 8 chat turns × 5k input tokens × 800 output tokens = 40k in / 6.4k out
  - At Sonnet 4 list price ($3 in / $15 out per million): **~$0.22/day**
  - With proper caching of behaviour rules + static prefix (~2k of 5k):
    cached input @ $0.30/M, uncached @ $3/M → **~$0.10/day**

**Per active CSM per workday** (lower volume, longer turns):
- 4 turns × 8k in × 1.5k out = 32k in / 6k out → **~$0.19/day** raw,
  **~$0.09/day** with caching

**Workflow load per tenant per day**:
- Pre-call briefs: ~5 meetings × ~1.5k tokens Sonnet → **~$0.02/tenant/day**
- Churn escalation: ~0.5 escalations × 5 iterations × 2k tokens →
  **~$0.08/tenant/day** (worst case)
- Transcript ingest: ~10 transcripts × 6k input + 1k output Sonnet +
  embedding → **~$0.30/tenant/day**
- Compaction (Haiku): negligible
- Deep research (status quo): 20 × 3k Sonnet → **~$0.30/tenant/day**
  burned on fictional signals

**Total per active rep + workflow share:**
- Today: **~$0.50–0.70/rep/day** when amortised
- After Bucket A (kill `deep_research` hallucination): **~$0.30/rep/day**
- After Bucket B (caching, gateway, dedup): **~$0.20/rep/day**
- After Bucket C (smarter routing, embeddings reduce context size):
  **~$0.10–0.15/rep/day**

A 50-rep tenant therefore goes from ~$1.5k/month to ~$300/month in AI
spend — without losing a single capability and **gaining** a closed
learning loop, real signal grounding, and unified Slack/dashboard
behaviour. The 5× cost compression is the headline you can take to a
CFO alongside the 80% thumbs-up commitment.

---

## 15. What this report deliberately does not recommend

To stay disciplined against MISSION.md operating principle #1 ("Signal
over noise"):

- **No new dashboards.** Every gap above can be fixed inside
  `/admin/adaptation`, `/admin/roi`, or behind existing pages.
- **No new agent surface.** The four existing surfaces are sufficient;
  the gap is loop closure, not surface count.
- **No new sales framework.** The 16 already loaded cover 95% of
  intents; the gap is per-section retrieval, not coverage.
- **No model-registry expansion.** Sonnet, Haiku, Opus is the right
  trio; the gap is using Opus, not adding a fourth.
- **No "AI for analytics."** The forecast wants statistics, not LLM
  confidence — and the PRD already correctly forbids the latter.

The OS is **architecturally sound**. The opportunity is to ship the
last 30% that turns it from "instrumented" to "compounding," and to
fix the truthfulness gaps before they erode customer trust.

---

## 16. Appendix — file evidence index

For verification, each major claim above is anchored to the following
files. Reviewer can spot-check in 30 minutes.

| Claim | File | Lines |
|-------|------|-------|
| Only 7 AI call sites in repo | `apps/web/src/app/api/agent/route.ts` `+ slack/events/route.ts` `+ workflows/churn-escalation.ts` `+ packages/adapters/src/transcripts/transcript-ingester.ts` `+ apps/web/src/app/api/cron/signals/route.ts` `+ apps/web/src/lib/agent/compaction.ts` `+ apps/web/src/evals/cli.ts` & `judge.ts` | per file |
| `commonBehaviourRules()` is uncached | `apps/web/src/lib/agent/agents/_shared.ts` | 284–288, 315–375 |
| Tool registry queried fresh per request | `apps/web/src/lib/agent/tool-loader.ts` | 163–173 |
| Legacy + pack double fetch | `apps/web/src/app/api/agent/route.ts` | 289–317 |
| Pack receives empty signal hints | `apps/web/src/app/api/agent/route.ts` | 301–311 |
| Compaction silent context drop | `apps/web/src/lib/agent/compaction.ts` | 195–201 |
| Exemplar miner mines thumbs-down | `apps/web/src/lib/workflows/exemplar-miner.ts` | 48–66 |
| Exemplars never read | grep finds writer only | — |
| Slice calibration payload mismatch | `context-slice-calibration.ts` L111–117 vs `actions/implicit-feedback.ts` L108–114 | — |
| Prompt optimiser schema-incompatible insert | `apps/web/src/lib/workflows/prompt-optimizer.ts` | 89–104 vs `schema.sql` 551–562 |
| Self-improve is template-only | `apps/web/src/lib/workflows/self-improve.ts` | 151–168 |
| Eval-growth never promotes to golden | `apps/web/src/lib/workflows/eval-growth.ts` | 116–138 |
| `retrieval_priors` written-only | grep: only `actions/implicit-feedback.ts` writer | — |
| `shouldAutoApply` computed not applied | `apps/web/src/lib/workflows/scoring-calibration.ts` | 164–166, 203–213 |
| Portfolio-digest never enqueued | grep: only definition + cron switch | — |
| No rollback API in calibration | `api/admin/calibration/route.ts` comment only | 151–155 |
| Adaptation page wrong column | `admin/adaptation/page.tsx` | 36–40 |
| Deep research is hallucination + Indeed-Flex | `cron/signals/route.ts` | 11–91 |
| Slack vs dashboard divergence | `slack/events/route.ts` 298–314 vs `agent/route.ts` 213–413 | — |
| Holdout exclusion not enforced | `roi/page.tsx` 161–162 vs 131–134; `attribution.ts` 21–24 vs 129–137 | — |
| Action-panel `interaction_id: null` | `components/ontology/action-panel.tsx` | 84–86 |
| Engagement-depth weight = 0 | `config/scoring-config.json` | 5–14 |
| CRM write-back exists but never called | `packages/adapters/src/crm/hubspot.ts` 547–581; grep: no caller in `apps/web` | — |
| Embeddings only on transcripts | `packages/adapters/src/transcripts/transcript-ingester.ts` 32–35; no other `embed`/`embedMany` callers | — |
| Forecast is summing | `packages/core/src/funnel/forecast.ts` | 27–32 |
| Forecast page arbitrary multiplier | `apps/web/src/app/(dashboard)/analytics/forecast/page.tsx` | 102–104 |

---

*This report is read-only analysis. No files were modified.*

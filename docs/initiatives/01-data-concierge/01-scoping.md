# Phase 1 — Data Concierge — Scoping

> **Original brief:** Initiative 6 — Revenue Data Concierge
> **Folder rank:** 01 (ships first — foundation)
> **Status:** Foundation; ships in weeks 0–2
> **Business owner:** James (strategic outcome) / Tom (user experience)
> **AI build owner:** Adrien + Olga (technical) / Bill (Tableau MCP connectivity)
> **Pilot users:** Tom + Leonie (designated guinea pigs)
> **Support / Ops:** Matt G + Steffi
> **Adoption target:** 100% of ADs/CSMs use the tool for weekly account-health checks by Week 8

---

## 0. Executive summary (read this in 30 seconds)

> Slack-native ANY-data-on-demand. ADs / CSMs ask "what's Stored's
> fulfilment this week?" in Slack and get a cited Tableau answer in
> < 60 seconds. Replaces a 15-minute manual hunt. Foundation for every
> other initiative because cite-or-shut-up needs real ops data.
> **Time-freed equivalent: ~£70k/year** across 40 ADs/CSMs (40 × 5 q/wk × 14 min × £45/hr loaded).
> **Defensible ROI gate:** Day 90 holdout-filtered savings ≥ £15k/quarter AND Pull-to-Push ≥ 0.5.

## 0.1 Phase 0 audit gate (must clear before build starts)

Per [`../00-audit-phase.md`](../00-audit-phase.md), Phase 1 build
**only starts** once these audit-outputs are signed by stakeholders:

| Output ID | What | Stakeholder | Signed by |
|---|---|---|---|
| O-1 | Manually answer 5 real natural-language data questions, stopwatch each | Tom + Leonie | 9 May |
| O-2 | 3 sample Slack account-health summaries (using Tableau + CRM) | Tom + Leonie | 9 May |
| O-3 | Time-to-insight baseline (median of O-1) — the "before" number for ROI | Tom + Leonie | 9 May |

These outputs land in `audit-outputs/O-1.md` … `audit-outputs/O-3.md`
and become **eval golden fixtures** (DC-001 → DC-005 are seeded from O-1).

## 0.2 ROI contribution (cross-cutting)

| Metric | Target | How this phase contributes |
|---|---|---|
| **Influenced ARR** (cross-cutting cumulative) | enables every later phase to cite real data | Indirect — without Tableau MCP, Phase 2/3/4/5 can't cite operational reality |
| **Time-freed (£/year)** | ~£70k | Direct: 40 ADs/CSMs × 5 q/wk × 14 min × £45/hr |
| **Pull-to-Push Ratio** (cohort gate) | ≥ 0.1 by W2 | Tom + Leonie ask vs system pushes them |
| **Cited-answer rate** | ≥ 95% | Cite-or-shut-up enforced; gate at 90% |
| **Median TTFB** | ≤ 30s | Vercel Runtime Cache 5-min TTL |
| **Cache hit rate** | ≥ 60% by W4 | Most queries repeat |

Full SQL in [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §4 (Phase 1).

---

## 1. Desired outcome (verbatim from brief)

Enable the Revenue team to instantly access real-time performance data
(fulfilment, churn triggers) and enriched stakeholder info via a single
interface, eliminating the need to manually log into and navigate
Tableau, ACP, or Snowflake.

**Success metric:** Time-to-insight from ~15 minutes to < 60 seconds,
measured by `agent_events.payload.time_to_first_token_ms` for queries
tagged `intent_class = 'data_lookup'`.

**Definition of done:** A centralised AI interface (Cursor / Slack /
dashboard) is connected to the Tableau MCP server and successfully
answers natural-language questions like "What is the current fulfilment
status for the Stored account?" with cited evidence linking back to the
Tableau view.

**Adoption failure looks like:** Team members continue to submit manual
product requests for reports the AI could already generate.

---

## 2. How this composes existing OS primitives

| Concern | Reuses | New code required |
|---|---|---|
| Conversational interface | [`apps/web/src/app/api/agent/route.ts`](../../../apps/web/src/app/api/agent/route.ts) (the one entry point) | None |
| Slack delivery | [`packages/adapters/src/notifications/slack.ts`](../../../packages/adapters/src/notifications/slack.ts) | None |
| Tool discovery & priors | [`apps/web/src/lib/agent/tool-loader.ts`](../../../apps/web/src/lib/agent/tool-loader.ts) | None |
| Citation pipeline | [`apps/web/src/lib/agent/citations.ts`](../../../apps/web/src/lib/agent/citations.ts) | Add 4 new extractors (one per tool) |
| Cooldown & push budget | [`packages/adapters/src/notifications/push-budget.ts`](../../../packages/adapters/src/notifications/push-budget.ts) | None — Concierge is reactive only |
| Telemetry | `@prospector/core/telemetry` (`emitAgentEvent`) | None |
| Connector contract | [`packages/adapters/src/connectors/interface.ts`](../../../packages/adapters/src/connectors/interface.ts) | None — implemented by new adapter |
| **NEW: Tableau MCP connector** | — | New adapter in `packages/adapters/src/tableau-mcp/` |
| **NEW: Redash MCP connector (fallback)** | — | New adapter in `packages/adapters/src/redash-mcp/` (only if Tableau MCP latency is unworkable) |
| **NEW: 4 tools** | — | Files in `apps/web/src/lib/agent/tools/handlers/data-concierge/` |
| **NEW: cross-surface tool registry rows** | None — Concierge is cross-cutting | Update `tool_registry` rows with `available_to_roles = ['ae','ad','csm','manager','revops']` |

**Surface preset impact:** None. Per [`docs/prd/08-vision-and-personas.md`](../../prd/08-vision-and-personas.md)
§6, surface count is fixed at four. The Concierge tools are added to
`tool_registry` and become available across all four surfaces because
their `available_to_roles` covers every role.

---

## 3. Tableau MCP vs Redash MCP — which connector ships

The user brief mentions both. Here is the decision logic:

### Default: Tableau MCP

Indeed Flex's primary BI surface is Tableau (per the brief:
"eliminating the need to manually log into and navigate Tableau, ACP, or
Snowflake"). The Tableau MCP connector ships first because:

- It covers the highest-value views (fulfilment, billing, ACP metrics).
- View-level permissions are already maintained in Tableau (we inherit
  them, no new ACL system).
- The MCP protocol abstracts auth/transport; we implement
  `ConnectorInterface` over it.

### Fallback: Redash MCP

Ships only if Tableau MCP returns latency P95 > 30s in soak (week 1) or
its OAuth flow blocks production go-live. Redash exposes raw SQL
queries; useful for fast iteration when a Tableau view doesn't exist
yet for a question reps want answered.

**Routing logic:**

```
Tool: query_tableau   → Tableau MCP (allowlisted view_slug only)
Tool: query_redash    → Redash MCP (allowlisted query_slug only — added in Phase 1.5 if needed)
Tool: lookup_fulfilment / lookup_billing / lookup_acp_metric → Tableau MCP, with caching
```

If Redash MCP ships, it is treated as **Tier 2** (full harness — typed
input, citations out, retry classified, telemetry emitted) per
[`MISSION.md`](../../../MISSION.md) §3.

---

## 4. Tools to ship (Tier 2, fully harnessed per `MISSION.md` §3)

All tools follow the `{ data, citations }` contract. All are
**read-only** (no writes back to Tableau / Redash). Each one uses the
MCP query endpoint with a structured filter; the LLM never composes raw
SQL.

### 4.1 `query_tableau`

- **Input:** `view_slug` (enum from `tableau_views_registry`), `filters` (typed object).
- **Output:** structured rows + a `tableau_view_url` citation.
- **Use:** "What's the current fill-rate for Stored?"
- **File:** `apps/web/src/lib/agent/tools/handlers/data-concierge/query-tableau.ts`

### 4.2 `lookup_fulfilment`

- **Input:** `account_name` (resolved via `resolveCompanyByName`), `time_window` (`'today'|'7d'|'30d'`).
- **Output:** fulfilment metrics (orders placed, filled, unfilled, % rate, contributing sites).
- **Use:** "Fulfilment for Stored last 7 days?"
- **File:** `apps/web/src/lib/agent/tools/handlers/data-concierge/lookup-fulfilment.ts`

### 4.3 `lookup_billing`

- **Input:** `account_name`, optional `dispute_only: boolean`.
- **Output:** invoice status, billing disputes, last 3 payments.
- **Use:** "Any open billing disputes for Stored?"
- **File:** `apps/web/src/lib/agent/tools/handlers/data-concierge/lookup-billing.ts`

### 4.4 `lookup_acp_metric`

- **Input:** `account_name`, `metric_slug` (enum from `acp_metric_registry`).
- **Output:** the metric value + 30-day trend + threshold flag.
- **Use:** "Is Stored's NPS within healthy range?"
- **File:** `apps/web/src/lib/agent/tools/handlers/data-concierge/lookup-acp-metric.ts`

---

## 5. Connector to ship

`packages/adapters/src/tableau-mcp/` — implements `ConnectorInterface`
from [`packages/adapters/src/connectors/interface.ts`](../../../packages/adapters/src/connectors/interface.ts).
Auth via OAuth2 service account stored encrypted in
`tenants.tableau_credentials_encrypted` (new JSONB column, migration
025).

| Concern | Spec |
|---|---|
| Connection string + OAuth credentials | Per-tenant in `tenants` row, encrypted via [`apps/web/src/lib/crypto.ts`](../../../apps/web/src/lib/crypto.ts) pattern |
| Field mapping | `connector_registry.field_mapping` JSONB |
| Rate limit | 10 req/s. Returns 429 → classified as TRANSIENT, retried with backoff (per `MISSION.md` §3 Tool tier) |
| View allowlist | `tableau_views_registry` table prevents the agent from querying views containing PII or compensation data (defence in depth) |
| Caching | Vercel Runtime Cache, 5-min TTL keyed on `(view_slug, filters_hash)`. See `skills/runtime-cache` |
| Health check | `healthCheck()` from `ConnectorInterface` polled every 5 min by `cron/health` |
| Telemetry | Every read emits `tool_called` with `payload.connector = 'tableau-mcp'` |

If Redash MCP ships:
`packages/adapters/src/redash-mcp/` — same interface; query allowlist
in `redash_queries_registry`.

---

## 6. Migrations

- **Migration 025 — `025_data_concierge.sql`**
  - `tenants.tableau_credentials_encrypted JSONB`
  - `tenants.redash_credentials_encrypted JSONB` (nullable; populated only if Redash ships)
  - `tableau_views_registry` table: `(tenant_id, view_slug, view_url, allowed_roles[], pii_safe BOOL, description)`
  - `acp_metric_registry` table: `(tenant_id, metric_slug, source, threshold_min, threshold_max, display_name, description)`
  - RLS policies on both new tables (copy `tenant_isolation` from migration 002)

- **Migration 026 — `026_data_concierge_tools.sql`**
  - 4 rows in `tool_registry`: slugs `query_tableau`, `lookup_fulfilment`, `lookup_billing`, `lookup_acp_metric`
  - Each row's `available_to_roles = ['ae','ad','csm','manager','revops']`
  - `requires_connector_id` pointing at the Tableau MCP `connector_registry` row
  - Idempotent via `ON CONFLICT (tenant_id, slug) DO UPDATE`

Both migrations follow the pattern from `packages/db/migrations/024_phase7_triggers_and_graph.sql`.

---

## 7. Out of scope (PHASE 1)

- **Write-back to Tableau** (extracts only).
- **Snowflake direct queries** (deferred to Phase 6; Tableau view layer covers ~90% of use cases).
- **Outreach CRM enrichment write-back** (deferred to Phase 2 where it actually belongs).
- **Proactive churn signal pushes** — those are Phase 4's job. Phase 1 is reactive (rep asks; agent answers).
- **Custom Tableau view authoring** — reps cannot create new views via the agent. They can only query allowlisted views maintained by the Tableau team.
- **PII / compensation data** — explicitly excluded via the view allowlist (defence in depth on top of Tableau's own ACL).

---

## 8. Definition of done

- [ ] Tableau MCP connector merged in `packages/adapters/src/tableau-mcp/` + Bill confirms connectivity in staging
- [ ] 4 tools merged in `apps/web/src/lib/agent/tools/handlers/data-concierge/` with eval golden cases passing in CI
- [ ] Migration 025 + 026 applied in production
- [ ] Citation extractors added to [`apps/web/src/lib/agent/citations.ts`](../../../apps/web/src/lib/agent/citations.ts) for all 4 tools (each result produces a `tableau_view` citation)
- [ ] `tableau_views_registry` populated with at least 8 views (Tom + Bill maintain — see `04-launch.md` §1)
- [ ] `acp_metric_registry` populated with at least 5 metrics (Steffi + Matt G maintain)
- [ ] Tom + Leonie complete the 5-question pilot script ([`04-launch.md`](04-launch.md) §3)
- [ ] Median time-to-cited-answer for `data_lookup` intent < 30s, P95 < 60s (measured live)
- [ ] Pull-to-push ratio ≥ 0.1 by week 2 (per `00-north-star-metrics.md` §2 gate)
- [ ] No open kill-switch triggers per [`03-refinement.md`](03-refinement.md) §5

---

## 9. Open questions to resolve before build

| # | Question | Owner | Resolution by |
|---|---|---|---|
| 1 | Tableau MCP server endpoint URL + OAuth client ID for Indeed Flex | Bill | T-7 (week 0 Mon) |
| 2 | Initial allowlist of 8 views (slug + URL + allowed roles) | Tom | T-5 |
| 3 | Initial allowlist of 5 ACP metrics (slug + source + thresholds) | Steffi + Matt G | T-5 |
| 4 | Holdout colleagues for Tom + Leonie (matched on tenure + role) | Adrien | T-3 |
| 5 | Slack channel `#os-data-concierge-soak` created and Adrien + Olga added | Adrien | T-7 |
| 6 | Redash credentials available *if* Tableau MCP soak fails | Bill | T-2 (only if needed) |

If question 1 isn't resolved by T-7, Phase 1 build slips by the
duration of the resolution window.

---

## 10. Risks specific to this phase

| Risk | Mitigation |
|---|---|
| Tableau MCP latency P95 > 30s breaks the latency budget | Cache responses 5 min via Vercel Runtime Cache (per `skills/runtime-cache`); if still over budget after caching, fall back to Redash MCP for hot queries |
| Agent hallucinates a metric name | View + metric registry tables → tool input is enum-validated; agent cannot invent slugs |
| Sensitive data leak via citation pill | View allowlist excludes PII/compensation views; tested in [`02-test-plan.md`](02-test-plan.md) §5 |
| Pilot user (Tom or Leonie) gets a wrong number once → trust collapses | Cite-or-shut-up enforced; if Tableau returns ambiguous data, tool returns `error: 'ambiguous_data'`, agent says "I don't have a definitive answer" instead of guessing |
| Bill is unavailable during build week | Adrien shadows the OAuth setup beforehand; backup engineer named in `04-launch.md` §1 |
| Tableau view changes (column rename) breaks the tool | Connector includes a contract test per view (`packages/adapters/src/tableau-mcp/__tests__/views.test.ts`); CI fails on schema drift; on-call alert via Slack `#os-data-concierge-soak` |

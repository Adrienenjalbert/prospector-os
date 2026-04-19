# Data export — schema reference

> **Audience:** customer data analysts, RevOps, support engineers
> who need to interpret a tenant export.
>
> **Last reviewed:** 2026-04-18 (Phase 3 T2.3).

This page documents what's in a tenant data export and what
isn't. The auto-generated `SCHEMA.md` inside every export zip
links here for the long version.

## File format

- Archive: `tenant-export-<tenant-id>-<timestamp>.zip` (size
  varies; typically < 10MB at default caps).
- Per-file format: CSV, RFC 4180-compliant.
  - Comma delimiter.
  - CRLF line endings.
  - Double-quote encapsulation when a field contains comma /
    quote / CR / LF.
  - Inner quotes are escaped by doubling.
- JSONB / array / object cells are JSON-encoded inside the cell.
  Use `JSON.parse` to round-trip.
- Empty cells mean SQL `NULL`. The source schema disambiguates
  from "empty string" — consult below.

## What's included

One CSV per tenant-scoped table:

| File | Source table | What it is | Default row cap |
|---|---|---|---|
| `companies.csv` | `companies` | Every company in the tenant's CRM (after sync). Includes scoring (`icp_score`, `signal_score`, `engagement_score`, `velocity_score`, `win_rate_score`, `propensity`, `expected_revenue`, `priority_tier`) plus enrichment metadata. | 100,000 |
| `contacts.csv` | `contacts` | Every contact across the tenant's companies. Includes seniority, department, champion / decision-maker flags, relevance scores. | 500,000 |
| `opportunities.csv` | `opportunities` | Every opportunity / deal. Includes stage, probability, days-in-stage, stalled flag, stall reason, close date. | 100,000 |
| `signals.csv` | `signals` | Detected buying-intent signals (hiring surges, leadership changes, expansions, etc.) with relevance scoring. | 200,000 |
| `transcripts.csv` | `transcripts` | Call transcript summary, themes, embedding, source metadata. **Raw transcript text is intentionally excluded** (see "What's excluded"). | 50,000 |
| `agent_events.csv` | `agent_events` | Every agent runtime event (interaction_started, tool_called, response_finished, citation_clicked, feedback_given, etc.). The richest source for "what happened during this conversation". | 200,000 |
| `agent_citations.csv` | `agent_citations` | Inline citation events emitted by tool handlers. Joins to agent_events.interaction_id. | 200,000 |
| `calibration_ledger.csv` | `calibration_ledger` | Every adaptation the platform applied to this tenant (scoring weight changes, prompt diffs, retrieval ranker updates) with before/after values + observed lift. | 10,000 |
| `business_skills.csv` | `business_skills` | The tenant's skill registry (named workflows the agent can invoke). | 1,000 |
| `tool_priors.csv` | `tool_priors` | Per-tenant Thompson sampling Bayesian priors for tool selection. The numbers that drive which tool the agent reaches for first. | 10,000 |
| `holdout_assignments.csv` | `holdout_assignments` | Which subjects (urns) are in the holdout cohort for ROI attribution. | 100,000 |
| `admin_audit_log.csv` | `admin_audit_log` | Every admin action recorded against this tenant (config upserts, calibration approvals, etc.). New since Phase 3 T2.1. | 50,000 |

When a table hits its cap, the auto-generated `SCHEMA.md` flags
it with a "⚠ yes (cap hit — request narrower date range for
full set)" entry in the file table. T2.3 doesn't ship date-range
filtering today; if the cap hits, contact RevOps to schedule a
narrower extract.

## What's intentionally excluded

| Excluded | Why | Where to get it |
|---|---|---|
| `transcripts.raw_text` | Nulled by the platform retention sweep at the per-tenant retention window (default 90 days). Even when still present, exporting it would re-publish potentially-sensitive customer voice data the retention policy explicitly stages for deletion. The summary, themes, and embedding are included. | Original transcript provider (Gong / Fireflies) within their own retention window. |
| `tenants` row | Platform configuration (ICP config, scoring weights, funnel stages, signal thresholds, slack settings, etc.), not customer-owned data. | RevOps can extract on request — typically a one-line JSON dump from `tenants WHERE id = '<id>'`. |
| `user_profiles`, `auth.users` | Auth identities — governed by the auth provider's own data export (Supabase). Duplicating them here would create an out-of-band copy with weaker access controls. | Supabase auth dashboard or admin API. |
| `workflow_runs` | Operational state for durable workflows (pre-call briefs, transcript ingestion, etc.). Useful for support debugging but not customer-facing data. | Available to Engineering; not exported by default. |
| `webhook_deliveries` | Webhook idempotency keys + payloads. Operational, not customer data. | Same. |
| `cron_runs` | Cron observability rows. Operational. | Same. |
| `connector_registry`, `tool_registry` | Platform schema (which tools / connectors exist), not customer data. | Public docs at the time of release. |
| `ai_conversations`, `ai_messages` | The agent's chat-history store. Today these tables are exported via the agent UI's existing "Download conversation" affordance per-conversation; not bulk-included in the tenant export to keep the zip size predictable. | Agent UI per-conversation download. (Bulk export is a T7 follow-up if customers ask.) |

## Joins worth knowing

The CSVs share `company_id`, `contact_id`, `opportunity_id`,
`interaction_id` keys. Common joins:

- `companies` ⨝ `opportunities` on `company_id`.
- `companies` ⨝ `contacts` on `company_id`.
- `companies` ⨝ `signals` on `company_id`.
- `agent_events` ⨝ `agent_citations` on `interaction_id`.
- `agent_events` ⨝ `outcome_events` on `subject_urn` (note:
  `outcome_events` is NOT in the export today; T7 will add it).

## Versioning

This schema is stable as of Phase 3 T2.3 (April 2026). Future
schema changes that affect the export will:

1. Bump the `_export_format_version` field that ships in every
   `SCHEMA.md` (TBD — not in v1).
2. Be announced in the security roadmap's "What's changed" log
   (TBD).
3. Be tested against an end-to-end export-and-reimport flow in
   the eval suite before they ship.

## Questions

Engineering: bug reports about the export format → file an issue
on the platform repo with the `data-export` label.

RevOps: customer-facing schema interpretation questions →
forward to engineering with the customer's specific question.

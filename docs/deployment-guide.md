# Deployment Guide — Revenue AI OS (v3 stack)

> **Audience:** Engineers / RevOps deploying the OS for a new tenant.
> **Stack:** Next.js 16 + Supabase + Vercel AI SDK + Anthropic via AI
> Gateway. **No Make.com, no Relevance AI** — those were the v2
> architecture and are superseded (see
> [`docs/archive/SUPERSEDED.md`](archive/SUPERSEDED.md)).
> **Estimated time:** 4–8 hours of focused work for a clean tenant
> deployment.
> **Reads with:** [`docs/launch-checklist.md`](launch-checklist.md)
> (Day 0 pilot launch), [`docs/PROCESS.md`](PROCESS.md#how-to-onboard-a-new-tenant)
> (the 7-step onboarding pattern), [`apps/web/README.md`](../apps/web/README.md)
> (env + scripts).

This guide is for **deploying the OS for a new tenant on the v3
codebase**. For per-customer rollout plans (the operational who/when/how
for a specific commercial pilot), see
[`docs/initiatives/`](initiatives/) — currently the Indeed Flex
pilot.

---

## Prerequisites

| Tool | Why | Plan |
|---|---|---|
| **Supabase project** | Postgres + pgvector + RLS substrate | Pro is the minimum for production (point-in-time recovery, dedicated compute) |
| **Vercel project** | Next.js hosting + Fluid Compute + Cron | Pro is the minimum for cron + custom domains |
| **Anthropic API key** | Default model (Sonnet 4) + Haiku fallback + Opus for meta-agents | Anthropic API plan with Opus access |
| **OpenAI API key** | `text-embedding-3-small` for the 5 embedding pipelines | Standard API |
| **Vercel AI Gateway** *(recommended)* | Provider failover, observability, unified billing | Set `AI_GATEWAY_BASE_URL` + `AI_GATEWAY_API_KEY` |
| **CRM** | HubSpot Private App **or** Salesforce Connected App | Customer-provided |
| **Slack workspace** | Slack-first delivery surface | Customer-provided |

Optional but recommended for a full deployment:

- **Apollo.io API** — firmographic enrichment + job-change detection
- **Gong or Fireflies API** — call transcript ingestion + signal extraction
- **Tavily API** — external news intent
- **Bombora API** — third-party intent topics
- **BuiltWith API** — tech-stack signals
- **Tableau / Snowflake credentials** — ops-data lookups via the Data
  Concierge tools (when those tools are enabled per tenant)

---

## Phase 1 — Environment + database (45 min)

### Step 1: Create the Supabase project

1. Sign up at supabase.com (region close to the rep base)
2. Enable the `pgvector` extension in the SQL editor
3. Note the project URL, anon key, and service role key
4. Copy `.env.example` to `.env.local`; fill in
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`

### Step 2: Apply migrations

In order, 001 → 024 (and any newer migrations that have shipped
since). Apply via:

- **Supabase dashboard SQL editor**: copy each `.sql` file from
  [`packages/db/migrations/`](../packages/db/migrations/) and run
- **OR Supabase CLI** (if installed locally): `supabase db push`

Verify by querying `\d tenants` — you should see the table.

### Step 3: Set the rest of the environment

In `.env.local` (and Vercel env vars for production):

- `ANTHROPIC_API_KEY` — `sk-ant-...`
- `OPENAI_API_KEY` — `sk-...`
- `CRON_SECRET` — any 32-char string (used by `/api/cron/*` to
  authenticate scheduled triggers)
- `CREDENTIALS_ENCRYPTION_KEY` — any 32-char string (encrypts CRM
  credentials at rest in `tenants.crm_credentials_encrypted`)
- `NEXT_PUBLIC_APP_URL` — `http://localhost:3000` for dev,
  production URL for prod
- `AI_GATEWAY_BASE_URL` + `AI_GATEWAY_API_KEY` *(recommended)* —
  routes Anthropic calls through the Vercel AI Gateway

---

## Phase 2 — Tenant configuration (45 min)

### Step 4: Insert the tenant rows

```sql
-- 1. Tenant row
INSERT INTO tenants (slug, active, crm_type)
VALUES ('acme-corp', true, 'hubspot');  -- or 'salesforce'

-- 2. Business profile
INSERT INTO business_profiles (
  tenant_id,
  company_name,
  target_industries,
  target_company_sizes,
  value_propositions,
  agent_name,
  sales_methodology
) VALUES (
  '<tenant_id>',
  'Acme Corp',
  ARRAY['fintech', 'logistics'],
  ARRAY['mid-market', 'enterprise'],
  ARRAY['faster onboarding', 'lower TCO'],
  'Atlas',  -- the persona reps will see in Slack
  'MEDDPICC'
);

-- 3. Seed the tool registry for this tenant
-- (idempotent; safe to re-run)
```

Then from the repo root:

```bash
npx tsx scripts/seed-tools.ts --tenant=<tenant_slug>
```

### Step 5: Customise ICP, funnel, signal, scoring (optional)

The OS ships with sensible **template defaults** in
[`config/`](../config/) (`icp-config.json`, `funnel-config.json`,
`signal-config.json`, `scoring-config.json`).

**You usually do not need to edit these** — the OS derives its own
ICP, scoring weights, and exemplars from the tenant's won-deal
history once the first sync completes (see `derive-icp` and
`derive-sales-motion` workflows). The configs in `config/` are the
**cold-start defaults** the bandit warms up against.

If your tenant has a very specific ICP definition or pipeline shape
that the defaults clearly miss, edit the JSON in `config/` and
restart the dev server. The change applies tenant-wide; per-tenant
overrides go in `tenants.scoring_config` JSONB.

### Step 6: Configure rep profiles

For each pilot rep:

```sql
-- 1. Auth user (created via Supabase Dashboard → Auth → Users)
-- 2. User profile (links auth user to tenant + role)
INSERT INTO user_profiles (id, tenant_id, role, full_name, email)
VALUES ('<auth_user_id>', '<tenant_id>', 'ae', 'Sarah Johnson',
        'sarah.johnson@example.com');

-- 3. Rep profile (CRM mapping + preferences)
INSERT INTO rep_profiles (
  user_id, tenant_id, crm_user_id, slack_user_id,
  comm_style, alert_frequency, focus_stage,
  kpi_meetings_monthly, kpi_proposals_monthly,
  kpi_pipeline_value, kpi_win_rate, outreach_tone
) VALUES (
  '<auth_user_id>', '<tenant_id>',
  '005xx000001ABC', 'U05EXAMPLE1',  -- Salesforce + Slack IDs
  'brief', 'medium', 'Discovery',
  20, 8, 500000, 15, 'consultative'
);
```

A CSV template is at
[`docs/rep-config-template.csv`](rep-config-template.csv) — bulk-insert
via `\copy` if the tenant has many reps.

---

## Phase 3 — Connect the CRM (30 min)

### Step 7: HubSpot

1. Customer creates a HubSpot Private App with scopes:
   `crm.objects.companies.read/write`, `crm.objects.contacts.read`,
   `crm.objects.deals.read`, `crm.schemas.companies.read`
2. Customer pastes the Private App token into the onboarding wizard
   at `/onboarding/connect`
3. Token is encrypted at rest in `tenants.crm_credentials_encrypted`
   via [`apps/web/src/lib/crypto.ts`](../apps/web/src/lib/crypto.ts)
4. First sync fires immediately (`/api/cron/sync` triggered for this
   tenant); subsequent syncs run every 6h via cron

### Step 8: Salesforce

1. Customer creates a Connected App in Salesforce Setup
2. OAuth scopes: `api`, `refresh_token`
3. Customer completes the OAuth flow in the onboarding wizard
4. Refresh token + instance URL are encrypted at rest
5. First sync fires immediately

### Step 9: Verify the sync

After ~5 minutes:

- `/objects/companies` should show the customer's accounts
- `/objects/opportunities` should show open opportunities
- `/objects/contacts` should show contacts
- The first cited Slack DM (`first_run_completed` event) lands within
  10 minutes — visible on `/admin/adaptation`

---

## Phase 4 — Optional integrations (1–2 hours)

### Step 10: Enrichment (Apollo)

1. Customer provides the Apollo API key
2. Set in Vercel env vars: `APOLLO_API_KEY`
3. Enable the `apollo` connector in `connector_registry` for this
   tenant (`active = true`)
4. Nightly enrichment cron picks up new accounts and pulls
   firmographics + key contacts
5. Cost gates in [`packages/adapters/src/enrichment/cost.ts`](../packages/adapters/src/enrichment/cost.ts)
   prevent runaway spend

### Step 11: Transcripts (Gong or Fireflies)

1. Customer creates webhook in Gong or Fireflies pointing at
   `https://<your-domain>/api/webhooks/transcripts/<provider>`
2. Customer provides the webhook signing secret
3. Set in Vercel env vars: `GONG_WEBHOOK_SECRET` or
   `FIREFLIES_WEBHOOK_SECRET`
4. Webhook handler verifies HMAC + 5-min timestamp window +
   idempotency key in `webhook_deliveries`
5. Transcript ingester extracts MEDDPICC + themes + sentiment via
   Sonnet
6. `transcript-signals` workflow promotes themes/sentiment/MEDDPICC
   into typed `signals` rows (`churn_risk`, `price_objection`,
   `competitor_mention`, `champion_missing`)

### Step 12: External research (Tavily, Bombora, BuiltWith, LinkedIn SN)

Each external-research adapter is an opt-in connector. Same pattern
for all four:

1. Customer provides API key
2. Set in Vercel env vars (`TAVILY_API_KEY`, `BOMBORA_API_KEY`,
   `BUILTWITH_API_KEY`, `LINKEDIN_SN_TOKEN`)
3. Enable connector in `connector_registry` for this tenant
4. Tools that depend on the connector reference it via
   `tool_registry.requires_connector_id`
5. Nightly enrichment + signal-detection workflows pick up new data

### Step 13: Slack delivery

1. Create a Slack app at api.slack.com
2. Bot scopes: `chat:write`, `im:write`, `reactions:read`,
   `reactions:write`
3. Install to the customer's workspace
4. Set Vercel env vars: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`
5. Configure Slack events endpoint at
   `https://<your-domain>/api/slack/events`
6. Map `slack_user_id` in each `rep_profiles` row
7. Verify: a Slack DM to the bot uses the **same agent runtime** as
   the dashboard chat — `assembleAgentRun` shared, parity test in
   CI gates this

---

## Phase 5 — Pilot launch (Day 0)

Follow [`docs/launch-checklist.md`](launch-checklist.md) Phase 6 —
holdout cohort assignment, welcome DM with holdout disclosure, daily
telemetry monitoring on `/admin/adaptation` and `/admin/roi`.

---

## Post-deployment cadence

### Daily (automated, you just monitor)

- `/admin/adaptation` — first-cited time, cited-answer %, push-budget
  violations, holdout leakage
- `/admin/roi` — per-rep AI cost broken out by model + cache hit rate

### Weekly (engineering)

- **Monday 09:30** — review last week's `agent_events` for the top
  thumbs-down responses; promote into `eval_cases.pending_review`
- **Wednesday 14:00** — `/admin/roi` walkthrough; update tenant
  reporting
- **Friday 16:00** — `/admin/calibration` queue; approve, reject, or
  roll back the week's prompt diffs / scoring weights / tool priors

### Monthly

- Refresh `funnel_benchmarks` (automated via cron, but verify)
- Review `outcome_events` vs ICP/propensity scores; if calibration
  lift on holdout is consistent, consider auto-apply mode (only after
  3+ approved cycles of that change type)
- Forward the 1-page ROI brief from `/admin/roi` to the customer's
  CFO/CRO

### Quarterly

- Run the strategic-review pattern from
  [`docs/strategic-review-2026-04.md`](strategic-review-2026-04.md)
  for this tenant's deployment
- Update [`docs/ROADMAP.md`](ROADMAP.md) Bucket A/B/C with any new
  audit findings

---

## Estimated monthly costs (50-rep tenant)

| Line item | Cost | Notes |
|---|---|---|
| **Anthropic API** (Sonnet primary, Haiku fallback) | £100–250/month | Per-rep cost target ≤ £0.20/day after prompt-caching + intent-routing (see [`docs/strategic-review-2026-04.md`](strategic-review-2026-04.md) §14) |
| **OpenAI embeddings** | £5–20/month | `text-embedding-3-small` at ~$0.02/M tokens |
| **Supabase Pro** | £25/month | Includes Postgres + pgvector + RLS + PITR |
| **Vercel Pro** | £20/month | Includes cron + custom domains + Fluid Compute |
| **Apollo.io** *(optional)* | £400–600/month | Customer-provided; enrichment + job-changes |
| **Tavily / Bombora / BuiltWith** *(optional)* | £100–500/month | Per-API; customer-provided |
| **Gong / Fireflies** *(optional)* | Customer-existing | Webhooks only; no per-call cost from us |
| **Total (with Apollo + transcripts; 50 reps)** | **£550–900/month** | Per-rep cost ≈ £11–18/month |

For comparison, a stack of HubSpot Breeze + Gong AI + Outreach Kaia +
Clari Copilot at $80–150/seat/month for 50 reps is **$48k–90k/year
($4–7.5k/month)**. The OS is **5–10× cheaper** while delivering one
ontology, one event log, holdout-filtered ROI, and per-tenant
compounding the silos cannot — see
[`docs/prd/08-vision-and-personas.md`](prd/08-vision-and-personas.md) §3.

---

## Troubleshooting

See the on-call playbook in
[`docs/PROCESS.md`](PROCESS.md#on-call-playbook) for common symptoms
(missing citations, stuck workflows, cron drift, cost-budget warnings,
thumbs feedback not persisting).

For deployment-specific issues:

- **`/api/cron/sync` is failing** — check `tenants.crm_credentials_encrypted`
  decrypts cleanly (the encryption key may have rotated); check the
  CRM API key is still valid; check rate limits in adapter logs.
- **No tools listed for the agent** — re-run `npx tsx scripts/seed-tools.ts`
  for the tenant; check `available_to_roles` matches the rep's
  `user_profiles.role`.
- **Token budget hit too quickly** — verify prompt caching is active
  (check `agent_events.payload.tokens.cached > 0`); raise
  `tenants.ai_token_budget_monthly` if needed; see
  [`docs/ROADMAP.md`](ROADMAP.md) Bucket B for cost-recovery items.
- **Holdout leakage** — verify `shouldSuppressPush` is being called
  in the workflow; the `validate:workflows` AST check should catch
  this at PR time.
- **Cited-answer rate is below 95%** — likely a new tool missing a
  citation extractor in `agent/citations.ts`; check the eval suite
  output for the failing case.

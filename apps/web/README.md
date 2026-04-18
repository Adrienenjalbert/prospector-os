# `@prospector/web` — Revenue AI OS web app

The Next.js 16 / React 19 application that hosts the dashboard, the agent
chat surfaces, every API route (agent, webhooks, cron), and the admin
console.

> Read [`MISSION.md`](../../MISSION.md), [`CURSOR_PRD.md`](../../CURSOR_PRD.md),
> and [`docs/PROCESS.md`](../../docs/PROCESS.md) before non-trivial changes.
> This README is for getting the dev server running.

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20 LTS or newer |
| npm | 10.x (the repo's `packageManager`) |
| Supabase project | Cloud or local (with `pgvector` enabled) |
| Anthropic API key | Required for the agent |
| OpenAI API key | Required for embeddings (`text-embedding-3-small`) |

Optional but recommended:

- Vercel CLI (`npm i -g vercel`) for `vercel env pull` and previews.
- HubSpot Private App token + a Slack workspace if you want to test the
  full Slack-first UX.
- Apollo API key for enrichment.
- Gong or Fireflies API key for transcript ingestion.

---

## Quick start

From the **repo root**:

```bash
npm install
cp .env.example .env.local
```

Open `.env.local` and fill in at minimum:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (Supabase project credentials).
- `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.
- `CRON_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` (any 32-char strings for
  local dev).
- `NEXT_PUBLIC_APP_URL=http://localhost:3000`.

Apply the database migrations to your Supabase project (in order):

```bash
# either via the Supabase dashboard SQL editor, or
supabase db push   # if you use the Supabase CLI locally
```

Then from the repo root:

```bash
npm run dev
```

Open <http://localhost:3000>. You will be redirected to `/login`.
After signing up, you land on `/onboarding`, which walks you through:

1. Connect a CRM (HubSpot Private App token or Salesforce Connected App).
2. Sync — pull accounts, opportunities, contacts; enrich; score.
3. ICP fit — accept or edit the dimensions derived from your won-deal history.
4. Funnel — accept or edit the stage benchmarks derived from your pipeline.
5. Preferences — role, alert frequency, communication style, Slack DM ID.

The full onboarding takes ~5 minutes against a real CRM. You can also use
demo tenant data for a first pass — set `NEXT_PUBLIC_DEMO_TENANT_SLUGS` in
`.env.local` to flag them in the UI.

---

## Useful scripts

Run from the **repo root** unless noted.

| Command | What it does |
|---|---|
| `npm run dev` | Turbopack dev server (port 3000) |
| `npm run build` | Production build of every workspace |
| `npm run type-check` | `tsc --noEmit` across the monorepo |
| `npm run lint` | ESLint via the Next.js config |
| `npm run test` | Vitest across `@prospector/core`, `@prospector/adapters`, and the web app |
| `npm run validate:workflows` | AST-checks every file in `apps/web/src/lib/workflows/` for the tier-3 contract (idempotency key, tenant scoping, holdout suppression, DAG trigger rules). Run before merging any workflow change. |
| `npm run evals:smoke` | Run the 3-case smoke eval set (cheap, fast) |
| `npm run evals` | Run the full agent eval suite (gated in CI) |

Inside `apps/web/`:

| Command | What it does |
|---|---|
| `npm run dev` | Same as the root `dev`, scoped to this app |
| `npm run test:watch` | Vitest in watch mode |
| `npm run evals` / `npm run evals:smoke` | Run evals scoped to the web app |

---

## Where things live

```
apps/web/
├── src/
│   ├── app/
│   │   ├── (auth)/login/                  # Sign-in
│   │   ├── (dashboard)/                   # Authenticated app shell
│   │   │   ├── inbox/                     # Daily priority queue + welcome
│   │   │   ├── objects/                   # Ontology browser (companies, deals, contacts, signals, transcripts)
│   │   │   ├── pipeline/                  # AE-shaped pipeline view
│   │   │   ├── accounts/                  # Account list + per-account detail
│   │   │   ├── analytics/                 # Forecast, my-funnel, team
│   │   │   ├── settings/
│   │   │   ├── admin/                     # config, calibration, ontology, roi, adaptation, replay, pilot, evals
│   │   │   └── onboarding/                # Wizard + baseline survey
│   │   ├── api/
│   │   │   ├── agent/                     # The single agent route — chat, history, citations
│   │   │   ├── webhooks/                  # CRM + transcript webhooks (HMAC-verified)
│   │   │   ├── cron/                      # sync, score, signals, enrich, workflows, learning
│   │   │   └── admin/                     # config + calibration HTTP endpoints
│   │   └── actions/                       # Server actions (baseline, citations, onboarding, etc.)
│   ├── components/
│   │   ├── agent/                         # Chat sidebar, citation pills, suggested actions
│   │   ├── analytics/                     # KPI cards, sparklines, scatter, radar, donut, heatmaps
│   │   ├── ontology/                      # Action panel
│   │   └── priority/                      # Inbox queue, weekly pulse, dashboard
│   ├── lib/
│   │   ├── agent/
│   │   │   ├── tools/                     # createAgentTools, handlers bridge, dispatcher, middleware
│   │   │   ├── agents/                    # Surface presets (pipeline coach, account strategist, leadership lens, onboarding)
│   │   │   ├── knowledge/sales-frameworks/# 16 sales frameworks + selector + always-on playbook
│   │   │   ├── tool-loader.ts             # Registry-driven tool loader
│   │   │   ├── tool-bandit.ts             # Thompson sampling priors
│   │   │   ├── context-builder.ts         # Rep-centric assembler
│   │   │   ├── context-strategies.ts      # 5 context strategies
│   │   │   └── model-registry.ts          # AI Gateway provider/model selection
│   │   ├── workflows/                     # Every durable workflow, one file each
│   │   ├── onboarding/                    # ICP / funnel proposals derived from real data
│   │   ├── supabase/                      # Server + browser + service-role clients
│   │   └── hooks/                         # `use-agent-chat`, etc.
│   └── evals/                             # Golden eval set + LLM judge
├── AGENTS.md                              # Web-app coding rules (read before editing here)
└── README.md                              # You are here
```

---

## Common tasks

### Add a new agent tool

1. TS handler in `src/lib/agent/tools/handlers/<slug>.ts` returning
   `{ data, citations }` from a Zod-typed input.
2. Citation extractor in `src/lib/agent/citations.ts`.
3. Registry seed row in `scripts/seed-tools.ts`; re-run with
   `npx tsx scripts/seed-tools.ts`.
4. Eval case in `src/evals/goldens.ts`.

The agent picks up the new tool on its next request — no deploy required
between row insert and tool availability. See [`docs/PROCESS.md`](../../docs/PROCESS.md)
for the full pattern.

### Add a new durable workflow

1. `src/lib/workflows/<name>.ts` with `enqueueX` and `runX` exports.
2. Add a `case` in `src/app/api/cron/workflows/route.ts`.
3. If nightly: enqueue from `src/app/api/cron/learning/route.ts`. If
   webhook-driven: enqueue from the webhook handler.
4. **Always run `npm run validate:workflows`** before pushing — it
   AST-checks idempotency keys, tenant scoping, holdout suppression, and
   DAG trigger rules. Workflows that fail validation will not ship.

### Add a new ontology object type

Schema migration in `packages/db/migrations/NNN_*.sql` (with RLS using the
`tenant_isolation` policy from migration 002), TypeScript type in
`packages/core/src/types/ontology.ts`, Zod schema in
`packages/core/src/types/schemas.ts`, URN helper in
`packages/core/src/types/urn.ts`. Then expose it via tools.

---

## Production notes

| Concern | Note |
|---|---|
| **Hosting** | Vercel — Fluid Compute, Node 24 LTS. Default function timeout is 300s on all plans, plenty of headroom for the agent. |
| **Cron** | Configured in [`vercel.json`](../../vercel.json). Six schedules: sync (6h), enrich (4 AM), score (5 AM), signals (6 AM), workflows (every 5 min), learning (2 AM). |
| **Token budget** | Per-tenant in `tenants.ai_token_budget_monthly`. Auto-fallback to Haiku at 90%; 429 at 100%. |
| **Cost telemetry** | Aggregated from `agent_events.payload.tokens` over `event_type = 'response_finished'`. |
| **Webhooks** | All HMAC-verified with timestamp window + idempotency keys in `webhook_deliveries`. |
| **Service-role client** | Allowed only inside server actions and API routes. Never exposed to the browser. |
| **AI Gateway** | Set `AI_GATEWAY_BASE_URL` + `AI_GATEWAY_API_KEY` to route through Vercel AI Gateway for failover, observability, and unified billing. |

---

## Troubleshooting

See the on-call playbook in [`docs/PROCESS.md`](../../docs/PROCESS.md#on-call-playbook)
for symptoms like missing citations, stuck workflows, cron drift, and
cost-budget warnings.

For local dev:

- **Cannot sign in?** Check `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` and that the Supabase project's auth is
  enabled.
- **Agent never streams a response?** Check `ANTHROPIC_API_KEY` is set and
  the tenant has token budget remaining.
- **Onboarding wizard "Sync data" step hangs?** It calls the same code as
  `/api/cron/sync` — check the Supabase service role key and CRM
  credentials.
- **No tools listed for the agent?** Run `npx tsx scripts/seed-tools.ts`
  for your tenant.

# Beta Launch Checklist

> **Goal:** A pilot rep opens this Monday morning and gets their first
> cited answer within 10 minutes of signing in.
> **Estimated time:** 4–8 hours of focused work to land a clean pilot
> for any new tenant.
> **Reads with:** [`docs/deployment-guide.md`](deployment-guide.md)
> (current v3 stack), [`MISSION.md`](../MISSION.md) §14 (the success
> criteria the pilot is graded against),
> [`docs/PROCESS.md`](PROCESS.md#how-to-onboard-a-new-tenant) (how to
> onboard a tenant).

This is a generic beta launch checklist for any tenant. For the
Indeed Flex commercial pilot specifically, the operational playbook
(stakeholders, holdout pairings, weekly cadence) lives in
[`docs/initiatives/`](initiatives/).

---

## Phase 0 — Infrastructure (45 min)

- [ ] Create Supabase project (region close to the rep base — EU-West
      for UK/EU teams, US-East for North America)
- [ ] Enable the `pgvector` extension in the Supabase SQL editor
- [ ] Apply migrations 001 → 024 in order (Supabase dashboard SQL
      editor, or `supabase db push` if using the CLI)
- [ ] Create a Vercel project, link to the GitHub repo, set the root
      to `apps/web`
- [ ] Set environment variables in Vercel (mirror of `.env.local` —
      see [`apps/web/README.md`](../apps/web/README.md) for the
      minimum set):
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
    `SUPABASE_SERVICE_ROLE_KEY`
  - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
  - `CRON_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`
  - `NEXT_PUBLIC_APP_URL` set to the production URL
  - `AI_GATEWAY_BASE_URL`, `AI_GATEWAY_API_KEY` if routing through
    Vercel AI Gateway (recommended for failover + observability)
- [ ] Add the Vercel production URL to Supabase Auth → URL
      Configuration (so OAuth redirects work)

## Phase 1 — Tenant setup (30 min)

- [ ] Insert a row in `tenants` (active = true, set `crm_type`)
- [ ] Insert a row in `business_profiles` with:
  - `company_name`
  - `target_industries` (e.g. `["fintech", "logistics"]`)
  - `value_propositions` (e.g. `["faster onboarding", "lower TCO"]`)
  - `agent_name` (the persona reps will see in Slack DMs)
  - `sales_methodology` (`MEDDPICC`, `Challenger`, `SPIN`, …)
- [ ] Create Supabase Auth users for each pilot rep (via Dashboard →
      Authentication → Users)
- [ ] Insert `user_profiles` rows linking each auth user to the
      tenant; set `role` (`ae`, `ad`, `csm`, `manager`, `revops`,
      `growth_ae`, `leader`)
- [ ] Insert `rep_profiles` rows with each rep's CRM ID, Slack user
      ID, and preferences (`comm_style`, `alert_frequency`,
      `focus_stage`)
- [ ] Seed the tool registry for this tenant:
      `npx tsx scripts/seed-tools.ts` (idempotent)

## Phase 2 — Connect the CRM (30 min)

- [ ] Each pilot rep signs in at `/login` and lands on `/onboarding`
- [ ] Connect HubSpot (Private App token) or Salesforce (Connected
      App OAuth)
- [ ] First sync runs automatically (cron `/api/cron/sync` every 6h;
      can be triggered manually for the pilot)
- [ ] Verify accounts, opportunities, contacts populate in the
      ontology browser at `/objects`
- [ ] Apollo enrichment fires nightly; verify Tier-A signals appear
      in the `signals` table within 24h
- [ ] First-run workflow fires the `first_run_completed` event; check
      the KPI on `/admin/adaptation`

## Phase 3 — Local smoke test (30 min)

- [ ] Run `npm run dev` from the repo root
- [ ] Open `http://localhost:3000` → redirects to `/login`
- [ ] Sign in as a pilot rep → lands on `/inbox`
- [ ] Verify the Inbox shows real priority data (not demo data)
- [ ] Open the AI chat sidebar → ask "who should I focus on today?"
- [ ] Verify the agent responds with **cited URNs** (citation pills
      under the response, not just text)
- [ ] Click a citation pill → it opens the source object in
      `/objects/<type>/<id>` (and emits `citation_clicked`)
- [ ] Verify `/admin/roi` shows real numbers (no demo/fake data)
- [ ] Verify `/admin/adaptation` shows the Phase 6 panels (memory +
      wiki KPIs)

## Phase 4 — Production deploy (15 min)

- [ ] Push to `main` → Vercel auto-deploys
- [ ] Smoke test the production URL: login → inbox → chat → settings
- [ ] Verify cron schedules in Vercel match `vercel.json`
- [ ] Set `tenants.ai_token_budget_monthly` to a realistic cap
      (defaults to a safe number; raise per pilot scale)

## Phase 5 — Slack integration (1–2 hours)

- [ ] Create a Slack app at api.slack.com
- [ ] Add bot scopes: `chat:write`, `im:write`, `reactions:read`,
      `reactions:write`
- [ ] Install to the customer's workspace
- [ ] Set `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` in Vercel
- [ ] Map `slack_user_id` in each `rep_profiles` row
- [ ] Configure the Slack events endpoint at
      `https://<your-domain>/api/slack/events`
- [ ] Smoke test: send a DM to the bot from a pilot rep → verify the
      same agent runtime responds (parity test in CI gates this)
- [ ] Verify the daily T-15 pre-call brief workflow fires for an
      upcoming meeting in the rep's calendar

## Phase 6 — Pilot launch (Day 0)

- [ ] Enable the holdout cohort: assign matched colleagues to control
      via `rep_profiles.in_holdout = true` (matched on tenure +
      role + portfolio risk)
- [ ] Send each pilot rep a welcome DM that **discloses the holdout
      design** (per [`MISSION.md`](../MISSION.md) §13: "no bypass of
      the holdout cohort"). Template language:

  > "You're in the pilot cohort. A small matched group of colleagues
  > is in the 'control' cohort — same access, but no proactive pings
  > — so we can measure whether the AI actually moves the needle vs
  > business-as-usual. The OS reports per-tenant aggregates, never
  > per-rep dashboards. If you stop using it, that's data — say so."

- [ ] Provide a 1-paragraph onboarding: "Open `<URL>`, sign in, check
      your Inbox. The agent is in the chat sidebar. Click 👍 / 👎 on
      anything that's useful or not."
- [ ] Monitor on `/admin/adaptation` daily for the first week:
  - First cited answer time (target: ≤ 10 min)
  - Cited-answer rate (target: ≥ 95%)
  - Push-budget violations (target: 0)
  - Holdout-cohort leakage (target: 0)
  - `/admin/roi` per-rep AI cost (target: ≤ £0.20/rep/day after
    caching)

---

## Success criteria (90-day, generic — see [`MISSION.md`](../MISSION.md) §14 for the full list)

| Metric | Target | Source |
|---|---|---|
| Time to first cited answer (fresh tenant) | ≤ 5–10 min | `agent_events.payload.elapsed_ms` for `first_run_completed` |
| Cited-answer rate | ≥ 95% | `response_finished.payload.citation_count > 0` |
| Thumbs-up rate (where rated) | ≥ 80% | `feedback_given.payload.value === 'positive'` |
| **Pull-to-Push Ratio** by week 12 | ≥ 1.0 | `agent_events` (rep-initiated ÷ system-pushed) |
| Weekly active reps | ≥ 80% of enrolled | distinct `user_id` in `agent_events` per week |
| Per-rep AI cost (50-rep tenant, after caching) | ≤ £0.20/day | `/admin/roi` per-rep aggregate |
| Hallucinated signals shipped | 0 | `signals WHERE source_url IS NULL AND source = 'web_research'` |
| Eval-suite growth (production failures promoted) | +25 cases by Day 90 | `eval_cases WHERE status = 'accepted'` |

If any of these stops moving in the right direction, that's a prompt
to ship a fix — not to ship a slide. See
[`docs/strategic-review-2026-04.md`](strategic-review-2026-04.md) for
the audit pattern, and [`docs/ROADMAP.md`](ROADMAP.md) for the next
ship items.

---

## What NOT to ship at beta launch

Per [`MISSION.md`](../MISSION.md) §13:

- **No replacement of the rep.** Drafts only; rep edits + sends.
- **No AI-generated forecast confidence scores.** Bootstrap CI only.
- **No auto-act on calibration.** Human-approved at `/admin/calibration`.
- **No bypass of the holdout cohort.** `shouldSuppressPush` enforced.
- **No demo data in production analytics.** Empty states beat fake numbers.
- **No new agent surface.** Surface count is fixed at four.
- **No feature without a Sales-KPI loop.** See
  [`MISSION.md`](../MISSION.md) §8.

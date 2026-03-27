# Prospector OS — Beta Launch Checklist

> **Goal:** 3 reps open this Monday morning and see their real priorities.
> **Estimated time:** 15-20 hours of focused work (hard weekend or 2 days).

---

## Phase 0: Infrastructure (1 hour)

- [ ] Create Supabase project at supabase.com (EU-West region for UK reps)
- [ ] Run `packages/db/schema/schema.sql` in Supabase SQL Editor
- [ ] Create `.env.local` in `apps/web/`:
  ```
  NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
  SUPABASE_SERVICE_ROLE_KEY=eyJ...
  ANTHROPIC_API_KEY=sk-ant-...
  ```
- [ ] Insert tenant row with Indeed Flex configs (use JSON from `config/*.json`)
- [ ] Create 3 Supabase Auth users via Dashboard > Authentication > Users
- [ ] Insert `user_profiles` rows linking each auth user to the tenant
- [ ] Insert `rep_profiles` rows with each rep's CRM ID and preferences

## Phase 1: Seed Data (2-3 hours)

- [ ] Pull ~20 accounts per rep from Salesforce (use the `SalesforceAdapter`)
- [ ] Insert into `companies` table with ICP scores computed via `computeCompositeScore()`
- [ ] Pull contacts for those accounts, insert into `contacts` table
- [ ] Pull open opportunities, insert into `opportunities` table
- [ ] Run Apollo enrichment on Tier A/B accounts, create `signals` records
- [ ] Compute `funnel_benchmarks` at company and rep scope

## Phase 2: Local Testing (1-2 hours)

- [ ] Run `npm install` from root
- [ ] Run `npm run dev` (starts Next.js via Turbo)
- [ ] Open http://localhost:3000 — should redirect to `/login`
- [ ] Sign in as a pilot rep — should redirect to `/inbox`
- [ ] Verify inbox shows real priority data (not demo data)
- [ ] Open AI chat sidebar — send "who should I focus on today?"
- [ ] Verify agent responds with real account data
- [ ] Check My Stats page shows funnel benchmarks
- [ ] Check Settings page loads and saves preferences

## Phase 3: Deploy (1 hour)

- [ ] Create Vercel project, connect GitHub repo
- [ ] Set root directory to `apps/web` (or configure Turborepo detection)
- [ ] Set environment variables in Vercel (same as `.env.local`)
- [ ] Add Vercel production URL to Supabase Auth > URL Configuration
- [ ] Deploy and smoke test: login → inbox → chat → settings

## Phase 4: Pilot Launch

- [ ] Send each rep their login credentials
- [ ] Provide 1-paragraph onboarding: "Open [url], sign in, check your Inbox"
- [ ] Monitor: are reps logging in? Are they using the chat? Which cards get action?
- [ ] After 1 week: gather feedback, adjust scoring weights if needed

## Week 2: Slack Integration

- [ ] Create Slack app at api.slack.com, install to workspace
- [ ] Set `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` in env
- [ ] Map `slack_user_id` in each `rep_profiles` row
- [ ] Build daily briefing cron: `assembleDailyBriefing()` → `SlackAdapter.send()`
- [ ] Build Slack interactivity endpoint for button clicks

---

## What NOT to Build for Beta

- Full CRM sync pipeline (seed data manually for now)
- Funnel waterfall chart (placeholder is fine)
- Pipeline and Accounts pages (removed from nav)
- Mobile bottom navigation
- Onboarding wizard
- Multi-tenant admin
- Scoring recalibration

## Success Criteria (90-day)

| Metric | Target |
|--------|--------|
| Rep weekly active usage | > 70% (3+ logins/week) |
| Agent interactions per rep per week | > 5 |
| Alert positive feedback rate | > 60% |
| Time-to-intervention on stalled deals | < 5 days |
| Rep self-reported time saved | > 2 hours/week |

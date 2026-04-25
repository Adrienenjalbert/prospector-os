# Phase 4 — CSM Retention Guardian — Scoping

> **Original brief:** Initiative 4 — CSM Retention Guardian
> **Folder rank:** 04 (ships fourth — portfolio)
> **Status:** Portfolio; ships in weeks 10–12
> **Business owner:** Sarah
> **AI build owner:** Adrien + Olga
> **Pilot users:** 2 CSMs (top-5 risk portfolios; Sarah names) + 2 holdout CSMs (matched on portfolio risk profile)
> **Adoption target:** 2 CSMs ack ≥ 70% of churn alerts within 24h; churn-signal lead time vs holdout 14+ days earlier mean detection
> **Reads with:** [`docs/prd/04-notifications-triggers.md`](../../prd/04-notifications-triggers.md), [`apps/web/src/lib/workflows/transcript-signals.ts`](../../../apps/web/src/lib/workflows/transcript-signals.ts), [`apps/web/src/lib/workflows/churn-escalation.ts`](../../../apps/web/src/lib/workflows/churn-escalation.ts)

---

## 0. Executive summary (read this in 30 seconds)

> Catch portfolio churn 14 days earlier. Synthesise transcript themes,
> draft escalations, write the weekly digest in 30 minutes instead of
> 3 hours. **The biggest single CFO line item across all initiatives**
> because saved ARR has ~100% gross margin — every retained account
> drops straight to NRR.
> **Defensible ROI gate (Day 90):** churn-signal lead time vs holdout
> 14+ days earlier mean detection AND **NRR uplift on treatment portfolio
> ≥ 200 bps** vs holdout.

## 0.1 Phase 0 audit gate (must clear before build starts)

Per [`../00-audit-phase.md`](../00-audit-phase.md), Phase 4 build
**only starts** once these audit-outputs are signed AND the transcript
vendor decision (B-005) is resolved:

| Output ID | What | Stakeholder | Signed by |
|---|---|---|---|
| O-1 | Manually surface 3 churn-risk accounts from Sarah's portfolio with cited rationale | Sarah | 9 May |
| O-2 | Manually draft 1 escalation email for the highest-risk account | Sarah | 9 May |
| O-3 | Portfolio-scan time baseline (stopwatch on Sarah's current weekly review) | Sarah | 9 May |

These outputs land in `audit-outputs/O-1.md` … `audit-outputs/O-3.md`
and become **eval golden fixtures** (CSM-001 → CSM-003 are seeded from O-1).

> **Caveat:** if service-tickets system (B-007) remains unknown, the
> `synthesise_service_themes` tool descopes from "all signal sources"
> to "transcripts + CRM only" — the Phase 0 audit will surface this.

## 0.2 ROI contribution (cross-cutting)

| Metric | Target | How this phase contributes |
|---|---|---|
| **Influenced ARR** (cross-cutting cumulative) | ≥ £75k by W12 | **Saved ARR** via earlier intervention — biggest single line item |
| **NRR uplift on treatment portfolio** | ≥ 200 bps vs holdout | Earlier churn detection × earlier intervention |
| **Churn-signal lead time vs holdout** | 14+ days earlier mean detection | Transcript-signals + memory-edge graph give earlier pattern recognition |
| **Pull-to-Push Ratio** (cohort gate) | ≥ 0.7 by W12 | CSMs ask "draft improvement plan for X" vs receiving alerts |
| **Churn-alert ack rate within 24h** | ≥ 70% | Adoption gate; below 50% triggers refinement |

Full SQL in [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §4 (Phase 4) + §3.4 (NRR).

---

## 1. Desired outcome

Catch portfolio churn earlier, draft escalations faster, write the
weekly digest in 30 minutes instead of 3 hours.

The headline CSM promise:

> **You stop discovering churn at renewal week. The OS catches the
> signal 14 days earlier, drafts the escalation, and tells you what
> the root cause is — so you can act, not react.**

**Success metric (leading):** 2 CSMs ack ≥ 70% of churn alerts within
24h.

**Success metric (lagging):** Churn-signal lead time vs holdout: 14+
days earlier mean detection — measured via `outcome_events.churned`
joined back to first `churn_risk` signal date. **This is the
strongest defensible number across all six initiatives**, because the
holdout cohort is matched and the outcome is binary (churned or not).

**Definition of done:** 2 CSMs receive proactive churn alerts (capped
at 2/day per `alert_frequency = medium`); ≥ 1 alert results in an
escalation that wouldn't have happened otherwise; renewal-rate lift on
treatment vs holdout cohort over 90 days is positive.

---

## 2. How this composes existing OS primitives

| Concern | Reuses | New code required |
|---|---|---|
| Account-strategist surface | [`apps/web/src/lib/agent/agents/account-strategist.ts`](../../../apps/web/src/lib/agent/agents/account-strategist.ts) | **Extend** with `csm` role overlay via `commonSalesPlaybook(ctx, { role: 'csm' })` |
| Transcript signal extraction | [`apps/web/src/lib/workflows/transcript-signals.ts`](../../../apps/web/src/lib/workflows/transcript-signals.ts) — now persists `churn_risk`, `price_objection`, `champion_missing` post-mig 024 | None |
| Theme clustering | [`apps/web/src/lib/workflows/mine-themes.ts`](../../../apps/web/src/lib/workflows/mine-themes.ts) | None |
| Portfolio weekly digest | [`apps/web/src/lib/workflows/portfolio-digest.ts`](../../../apps/web/src/lib/workflows/portfolio-digest.ts) | None — already runs Monday |
| Churn escalation drafts | [`apps/web/src/lib/workflows/churn-escalation.ts`](../../../apps/web/src/lib/workflows/churn-escalation.ts) | None |
| Slack push (capped per `alert_frequency`) | [`packages/adapters/src/notifications/slack-dispatcher.ts`](../../../packages/adapters/src/notifications/slack-dispatcher.ts) + `push-budget.ts` | None |
| Holdout cohort | [`apps/web/src/lib/workflows/holdout.ts`](../../../apps/web/src/lib/workflows/holdout.ts) | None |
| Citation pipeline | [`apps/web/src/lib/agent/citations.ts`](../../../apps/web/src/lib/agent/citations.ts) | Add 2 new extractors |
| Telemetry | `@prospector/core/telemetry` | None |
| **NEW: 2 tools** | — | Files in `apps/web/src/lib/agent/tools/handlers/csm-guardian/` |
| **NEW: `csm` role added to enum** | — | Migration 029 |

**Surface preset impact:** None. The `account-strategist` surface
gains a new role overlay (`csm`) that selects a CSM-flavoured
playbook variant (focus on retention/expansion patterns instead of
new-business outreach).

**Connector impact:** None. Uses existing transcript ingestion +
CRM sync.

---

## 3. The CSM Guardian surfaces (what the CSM sees)

### Surface A — Proactive churn alert (Slack DM, when signal fires)

```
⚠️ Churn risk on **Globex** — 3 signals in last 7 days

• Champion went silent 14 days (Sarah Chen, last reply 28 Apr)
• Pricing concern raised in last call (transcript#t77, unresolved)
• NPS dropped 7 → 5 in monthly survey (signal#n4)

Suggested service themes (clustered from last 4 weeks of transcripts):
1. Onboarding gap on the Manchester site
2. Account team turnover on their side (3 contacts left in 60 days)
3. Pricing pressure correlated with their consolidation initiative

Cited: signal#c11, transcript#t77, signal#n4

## Next Steps
- [DRAFT] Escalation email to Sarah Chen
- [ASK] What's the renewal date and current ARR?
- [DO] Schedule QBR before {renewal_date - 30}
```

Push budget: counts as 1 of the CSM's 2 daily proactive pushes
(`alert_frequency = medium` default).

### Surface B — Account improvement plan (chat sidebar, on demand)

When CSM asks: *"Draft an improvement plan for Globex."*

```
Account improvement plan — Globex — drafted in chat

Theme 1: Onboarding gap on Manchester site
  Root cause: Customer not informed of training resources at handover
  Owner: CSM (Sarah)
  Next step: Send onboarding deck + book 30-min training Monday
  Cited: transcript#t77, transcript#t81
  
Theme 2: Account team turnover (their side)
  Root cause: 3 of our key contacts left in 60 days
  Owner: AD (Mark)
  Next step: Re-establish relationships with the 2 new ops leads
  Cited: signal#c11, contact#c44 (departed), contact#c91 (departed)
  
Theme 3: Pricing pressure
  Root cause: Their vendor consolidation initiative
  Owner: AD + CSM
  Next step: Prepare ROI defence pack for QBR
  Cited: transcript#t44, trigger#t9 (composite)

## Next Steps
- [DRAFT] Internal handover email to Mark
- [ASK] Show me similar accounts we've recovered
- [DO] Schedule the QBR + send onboarding deck
```

### Surface C — Weekly portfolio digest (Slack DM, Monday 8 AM)

The existing `portfolio-digest.ts` workflow gets enriched with the
new `synthesise_service_themes` output. Format:

```
📊 Portfolio digest — Monday — Sarah's portfolio

🔴 At risk (top 3 of 8 signals):
1. Globex — 3 churn signals in 7 days (see DM thread)
2. Acme — champion job-change detected
3. Stored — NPS dropped 8 → 5

🟡 Watch list (top 3):
... (truncated for ≤ 150-word digest budget)

🟢 Healthy (bulk):
56 accounts trending positive

Cited: signal#c11, signal#a8, signal#n4, ...

## Next Steps
- [ASK] Pull up the Globex improvement plan
- [DRAFT] Weekly account review notes
- [DO] Forward this to Mark (AD on Globex)
```

Constraints: capped at 8 signals, top 3 surfaced inline, rest expand
on click.

---

## 4. Tools to ship (Tier 2)

### 4.1 `synthesise_service_themes`

Clusters transcripts by theme using existing `mine-themes.ts` workflow
output. Returns service-issue cluster, sentiment cluster,
expansion-blocker cluster.

- **Input:** `account_name`, `time_window` enum (`'4w'|'12w'|'26w'`)
- **Output:** array of `{ theme, root_cause_hypothesis, evidence_urns[], sentiment_score, frequency_count }`
- **File:** `apps/web/src/lib/agent/tools/handlers/csm-guardian/synthesise-service-themes.ts`
- **Available to roles:** `csm`, `ad`, `manager`

### 4.2 `draft_account_improvement_plan`

Consumes themes (from 4.1) + open `churn_risk` signals → structured
plan: theme → root cause → owner → next step.

- **Input:** `account_name`, optional `themes[]` (from 4.1; if not provided, calls 4.1 first)
- **Output:** array of `{ theme, root_cause, suggested_owner, next_step, evidence_urns[] }` — capped at 5 themes max (signal-over-noise)
- **File:** `apps/web/src/lib/agent/tools/handlers/csm-guardian/draft-account-improvement-plan.ts`
- **Available to roles:** `csm`, `ad`

---

## 5. Migrations

- **Migration 029 — `029_csm_guardian_tools.sql`**
  - 2 rows in `tool_registry` (idempotent)
  - Add `csm` to role enum (if not already present)
  - Update `available_to_roles` on existing tools to include `csm` where applicable (e.g. `search_transcripts`, `get_active_signals`, `query_tableau`, `lookup_acp_metric`)

---

## 6. Definition of done

- [ ] 2 tools merged with eval golden cases passing in CI (`CR-001` to `CR-009`)
- [ ] Migration 029 applied in production
- [ ] Citation extractors added for both tools
- [ ] `csm` role overlay added to `commonSalesPlaybook` selector
- [ ] `transcript-signals.ts` confirmed firing `churn_risk` correctly post-mig 024 (smoke test on 5 recent transcripts)
- [ ] `portfolio-digest.ts` extended with theme synthesis output
- [ ] 2 pilot CSMs identified by Sarah; both have completed 1-page training
- [ ] Holdout cohort: 2 CSMs flipped to `in_holdout = true`
- [ ] Pilot CSMs receive at least 1 proactive churn alert in production during week 1
- [ ] Pull-to-push ratio ≥ 0.7 across all live phases by week 12
- [ ] Ack rate ≥ 70% on churn alerts within 24h
- [ ] No open kill-switch triggers per [`03-refinement.md`](03-refinement.md) §5

---

## 7. Out of scope (PHASE 4)

- **Auto-send escalations.** CSM drafts via the agent; CSM clicks Send.
- **Renewal probability scoring.** Per `MISSION.md` "no AI-generated
  forecast confidence."
- **Auto-update Gainsight or other CSM platforms.** Read-only sync;
  any writes require explicit CSM approval through [DO] chip flow.
- **Daily portfolio re-scoring.** Scoring runs nightly; CSM can ask for
  fresh recompute on demand but no auto-push of "your numbers
  changed."

---

## 8. Open questions to resolve before build

| # | Question | Owner | Resolution by |
|---|---|---|---|
| 1 | Which 2 CSMs form the pilot? Which 2 form holdout? | Sarah | T-7 |
| 2 | Top-5 risk portfolios per pilot CSM (so we know which accounts to dogfood on) | Sarah | T-7 |
| 3 | Service theme taxonomy (e.g. onboarding gap, account-team turnover, pricing pressure, integration friction) — agree on 6–8 | Sarah + Adrien | T-5 |
| 4 | Are there accounts with NDAs / regulatory constraints that block transcript clustering? | Sarah + Tom | T-3 |
| 5 | Backup CSM in case one is unavailable | Sarah | T-3 |

---

## 9. Risks specific to this phase

| Risk | Mitigation |
|---|---|
| `transcript-signals.ts` not firing `churn_risk` reliably (mig 024 was new) | Smoke test on 5 transcripts before pilot; investigate if gaps |
| Alert fatigue — too many churn pushes | Capped by `alert_frequency = medium` (2/day max); bundle similar signals into one alert |
| False-positive churn alert ("CSM says it's fine") | Capture as `eval_cases.pending_review`; calibrate signal weights via `/admin/calibration` |
| CSM ignores alerts → ack rate < 70% | Daily standup with Sarah week 1; investigate root cause (alert quality vs CSM workflow fit) |
| Holdout CSM accidentally gets a push (RLS leak) | `shouldSuppressPush` integration test in CI; production check on every push |
| Renewal-rate lift signal is too slow (90+ days) | Lead with leading indicator (ack rate + early-detection delta); lagging at day 90 |
| Privacy concern: clustering transcripts of customer calls | Tom + Sarah confirm legal sign-off T-7; theme output cites transcript URNs only, never quotes verbatim |

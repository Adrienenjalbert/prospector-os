# Phase 2 — New Business Execution (AI Brief) — Scoping

> **Original brief:** Initiative 1 — New Business Commercial Execution Optimization
> **Initiative codename:** AI Brief — New Business Execution Layer
> **Folder rank:** 02 (ships second — confidence)
> **Status:** Confidence; ships in weeks 3–5
> **Business owner:** Leonie
> **AI build owner:** Adrien + Olga
> **Pilot users:** Brett + 3 AEs (with 3 holdout AEs matched on tenure + territory)
> **Adoption target:** Brett opens daily push 4-of-5 weekdays for 8+ consecutive weeks
> **Reads with:** [`docs/prd/03-prioritisation-engine.md`](../../prd/03-prioritisation-engine.md), [`docs/prd/07-ai-agent-system.md`](../../prd/07-ai-agent-system.md), [`apps/web/src/lib/workflows/pre-call-brief.ts`](../../../apps/web/src/lib/workflows/pre-call-brief.ts)

---

## 0. Executive summary (read this in 30 seconds)

> Daily AI Brief + T-15 pre-call brief + on-demand pitch outline for
> new-business AEs. Brett opens the daily push 4-of-5 weekdays;
> pre-call brief opens ≥ 70% of meetings. **Time-freed equivalent: ~£100k/year**
> across 20 AEs (20 × 2 hr/wk × £55/hr loaded). The strongest
> conversion-lift line in the rollout: discovery-stage pass-rate vs
> holdout improves by ≥ 5 pts within 60 days.
> **Defensible ROI gate (Day 90):** holdout-filtered Influenced ARR
> contribution ≥ £40k AND brief open rate ≥ 70%.

## 0.1 Phase 0 audit gate (must clear before build starts)

Per [`../00-audit-phase.md`](../00-audit-phase.md), Phase 2 build
**only starts** once these audit-outputs are signed by stakeholders:

| Output ID | What | Stakeholder | Signed by |
|---|---|---|---|
| O-1 | 3 manual pre-call briefs for real upcoming Brett meetings | Brett | 9 May |
| O-2 | 1 transcript end-to-end analysis (themes, commitments, objections, follow-up draft) | Brett | 9 May |
| O-3 | Pre-call research time baseline (stopwatch on Brett's current process) — "before" number | Brett + Leonie | 9 May |

These outputs land in `audit-outputs/O-1.md` … `audit-outputs/O-3.md`
and become **eval golden fixtures** (NB-001 → NB-005 are seeded from O-1).

## 0.2 ROI contribution (cross-cutting)

| Metric | Target | How this phase contributes |
|---|---|---|
| **Influenced ARR** (cross-cutting cumulative) | ≥ £25k by W9 (treatment vs holdout) | Faster cycles + higher discovery pass-rate × pipeline value |
| **Cycle-time reduction** | ≥ 5 days first-touch → demo | Pre-call brief eliminates 30-min hunts × 5 calls/wk × 4 AEs |
| **Win-rate uplift** | ≥ 5 pts vs holdout | Better discovery → higher progress rate |
| **Time-freed (£/year)** | ~£100k | 20 AEs × 2 hr/wk × £55/hr |
| **Pull-to-Push Ratio** (cohort gate) | ≥ 0.3 by W5 | AEs ask "draft pitch outline for X" vs daily push |
| **Brief open rate** | ≥ 70% of meetings | Adoption gate; below 50% triggers refinement |

Full SQL in [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §4 (Phase 2).

---

## 1. Desired outcome

Equip new-business AEs with a daily AI Brief that surfaces:

1. **Top-3 priority accounts** for today, with one cited reason each.
2. **Pre-call brief** auto-arriving 15 minutes before every meeting,
   with discovery questions tagged by stakeholder pain.
3. **A draftable pitch-deck outline** the AE can pressure-test in chat
   before walking into the meeting.

The headline rep promise:

> **You stop researching for 30 minutes per call. You walk in with the
> right 3 questions, the right framing, and the right cited evidence.
> The OS does the homework; you do the selling.**

**Success metric (leading):** Brett opens the daily push 4-of-5
weekdays; pre-call brief is opened ≥ 70% of meetings.

**Success metric (lagging):** Discovery-stage drop-rate vs holdout
improves by ≥ 5 percentage points in 60 days, measured via
`funnel_benchmarks` deltas.

**Definition of done:** A live AE (Brett) opens his daily AI Brief 4-of-5
weekdays for 8 consecutive weeks AND ≥ 1 of his deals advances through
Discovery stage faster than the holdout median.

**Adoption failure looks like:** Brett opens it on day 1, day 5, then
nothing. Or he opens but never clicks a Next Step button.

---

## 2. How this composes existing OS primitives

| Concern | Reuses | New code required |
|---|---|---|
| Daily morning surface | `pipeline-coach` agent ([`apps/web/src/lib/agent/agents/pipeline-coach.ts`](../../../apps/web/src/lib/agent/agents/pipeline-coach.ts)) | None |
| Account-deep dive | `account-strategist` agent ([`apps/web/src/lib/agent/agents/account-strategist.ts`](../../../apps/web/src/lib/agent/agents/account-strategist.ts)) | None |
| Pre-call brief delivery | [`apps/web/src/lib/workflows/pre-call-brief.ts`](../../../apps/web/src/lib/workflows/pre-call-brief.ts) — already runs T-15 before every meeting | **Extend** to inject discovery questions tagged by stakeholder pain |
| Transcript-derived MEDDPICC gaps | [`apps/web/src/lib/workflows/transcript-signals.ts`](../../../apps/web/src/lib/workflows/transcript-signals.ts) — persists gaps post-mig 024 | None |
| Citation pipeline | [`apps/web/src/lib/agent/citations.ts`](../../../apps/web/src/lib/agent/citations.ts) | Add 2 new extractors |
| Slack delivery | [`packages/adapters/src/notifications/slack.ts`](../../../packages/adapters/src/notifications/slack.ts) | None |
| Push budget + cooldowns | [`packages/adapters/src/notifications/push-budget.ts`](../../../packages/adapters/src/notifications/push-budget.ts) | None |
| Holdout cohort | [`apps/web/src/lib/workflows/holdout.ts`](../../../apps/web/src/lib/workflows/holdout.ts) | None — 3 holdout AEs added via `rep_profiles.in_holdout = true` |
| Telemetry | `@prospector/core/telemetry` (`emitAgentEvent`, `emitOutcomeEvent`) | None |
| **NEW: 2 tools** | — | Files in `apps/web/src/lib/agent/tools/handlers/new-business/` |
| **NEW: 1 workflow extension** | `pre-call-brief.ts` (already exists) | Add a step that calls `extract_discovery_gaps_v2` and includes the result in the brief body |

**Surface preset impact:** None. The AI Brief uses the existing
`pipeline-coach` for the morning push and `account-strategist` for the
account dive. Both already work for AEs.

**Connector impact:** None. Uses existing CRM (HubSpot) sync +
transcript ingestion (Gong/Fireflies). Phase 1's Tableau MCP is
optionally consulted via `query_tableau` for fulfilment context inside a
brief, but not required for AI Brief to ship.

---

## 3. The AI Brief surfaces (what the AE sees)

### Surface A — Daily AI Brief (Slack DM, 8:00 AM)

```
Good morning Brett 👋

Your #1 today: **Acme Corp** — Sarah Chen opened your proposal 3x
in the last 24h but hasn't replied in 8 days. The deal is at
Proposal stage for 22 days (team median: 14). A hiring-surge
signal fired yesterday on their LinkedIn (3 new ops roles).

Cited: signal#a8f7, deal#d231, contact#c3e9

## Next Steps
- [ASK] Show me the other 2 priority accounts
- [DRAFT] Email Sarah referencing the hiring surge
- [DO] Call Sarah today before EOD

```

Constraints:
- **≤ 150 words** (per `MISSION.md` operating principle 1)
- **Top 1 with 2 backup** (signal-over-noise; expand on click)
- **3 Next-Step buttons max**
- **Cited inline** with URN pills

### Surface B — Pre-call brief (Slack DM, T-15 before each meeting)

```
🎯 Pre-call brief — Sarah Chen / Acme — 14:30 (in 15 min)

What changed since your last touch:
• Sarah opened proposal 3x (signal#s2x)
• Acme posted 3 ops roles on LinkedIn (signal#a8f7)
• Last call: pricing concern flagged but not resolved (transcript#t44)

Discovery questions tagged by stakeholder pain:
1. Sarah (champion) — "Last call you mentioned the budget cycle
   shifts in Q4. Is that still moving?" [pain: budget-timing]
2. Marcus (econ buyer) — "We left the ROI model with you 2 weeks
   ago. Any concerns from finance?" [pain: deal-justification]

## Next Steps
- [DRAFT] Open with the LinkedIn signal
- [DRAFT] Email follow-up template if Sarah no-shows
- [DO] Log call notes in HubSpot
```

Delivery: durable workflow `pre-call-brief.ts` (already exists; this
phase tightens the body to inject discovery questions per stakeholder
pain).

### Surface C — On-demand pitch deck outline (chat sidebar)

When Brett asks: *"Draft a pitch deck outline for Acme."*

```
Pitch deck outline — Acme — drafted in chat

1. Cover — Stored × Acme partnership
2. Positioning — your hiring surge + our flexible workforce model
3. Discovery findings — 3 themes from your last 2 calls (cited)
4. Proposed approach — pilot with 2 sites, 6-week ramp
5. Next steps — proposed close-plan to EOQ

Cited: transcript#t44, signal#a8f7, signal#s2x

## Next Steps
- [DRAFT] Expand section 3 (discovery findings)
- [ASK] What objections should I prep for?
- [DO] Drop this into Pitch.com / Google Slides
```

The agent returns the **outline only**. The AE uses Pitch.com or
Google Slides to compose the actual deck. We deliberately do not
generate slide content — that's a different problem (visual design)
that the OS doesn't try to solve.

---

## 4. Tools to ship (Tier 2, fully harnessed)

### 4.1 `extract_discovery_gaps_v2`

Refines the existing `extract_meddpicc_gaps` for the new-business
context — distinguishes first-call (where everything is a gap) from
follow-up call (where we focus on the *changed* gaps since last touch).

- **Input:**
  - `account_name` (resolved via `resolveCompanyByName`)
  - `meeting_type` enum: `'first_discovery' | 'follow_up' | 'proposal_review'`
  - `attendee_emails` array (optional)
- **Output:**
  - `gaps`: array of `{ stakeholder_name, role, pain_tag, suggested_question, evidence_urn }`
  - `citations`: at least one transcript or signal URN per gap
- **File:** `apps/web/src/lib/agent/tools/handlers/new-business/extract-discovery-gaps-v2.ts`
- **Available to roles:** `ae`, `nae`, `growth_ae`

### 4.2 `draft_pitch_deck_outline`

Returns a structured slide-by-slide outline (cover, positioning,
discovery findings, proposed approach, next steps). **Outline only —
no slide composition.**

- **Input:**
  - `account_name`
  - `meeting_purpose` enum: `'first_pitch' | 'follow_up_pitch' | 'proposal_review' | 'qbr'`
- **Output:**
  - `outline`: array of `{ section_number, title, body_outline, citations[] }`
  - `citations`: every section's bullets cite a specific signal/transcript/wiki URN
- **File:** `apps/web/src/lib/agent/tools/handlers/new-business/draft-pitch-deck-outline.ts`
- **Available to roles:** `ae`, `nae`, `growth_ae`

---

## 5. Workflow change

**Tighten** [`apps/web/src/lib/workflows/pre-call-brief.ts`](../../../apps/web/src/lib/workflows/pre-call-brief.ts):

| Step | Before | After |
|---|---|---|
| 1. Resolve meeting attendees from CRM | unchanged | unchanged |
| 2. Pull recent signals + transcripts on the account | unchanged | unchanged |
| 3. Generate brief body | Single template | **NEW:** Call `extract_discovery_gaps_v2` to get tagged questions; inject into body |
| 4. Send Slack DM at T-15 | unchanged | unchanged |
| 5. Emit `pre_call_brief_sent` event | unchanged | + `payload.discovery_gaps_count` |

The workflow already enforces idempotency, holdout suppression, and
T-15 delivery. We are only changing step 3's body composition.

---

## 6. Migrations

- **Migration 027 — `027_new_business_tools.sql`**
  - 2 rows in `tool_registry` for `extract_discovery_gaps_v2` and `draft_pitch_deck_outline` (idempotent)
  - `rep_profiles.in_holdout BOOLEAN DEFAULT false` (column may already exist via mig 016 — check first; this is a no-op if already present)
  - `funnel_benchmarks.cohort_label TEXT` (added to allow tagging treatment vs control benchmarks; null-safe default)
  - RLS unchanged (existing `tenant_isolation` covers everything)

The migration file follows the pattern from `024_phase7_triggers_and_graph.sql`.

---

## 7. HubSpot integration prerequisites

The pre-call brief depends on HubSpot meetings being synced and HubSpot
owners being mapped to Slack user IDs.

| Prerequisite | Where | Status check |
|---|---|---|
| HubSpot OAuth credentials in `tenants.crm_credentials_encrypted` | Supabase | Ran by Adrien at T-7 |
| `slack_user_id` in `rep_profiles` for Brett + 3 pilot AEs | Supabase | Verified at T-3 |
| HubSpot meeting webhook firing into `apps/web/src/app/api/webhooks/hubspot/route.ts` | Vercel logs | Smoke test at T-1 (create test meeting; observe enqueue) |
| `pre-call-brief.ts` enqueue working in production | `workflow_runs` table | Smoke test at T-1 |

If any prerequisite fails, Phase 2 build slips by the duration of the
fix.

---

## 8. Definition of done

- [ ] 2 tools merged with eval golden cases passing in CI (`NB-001` to `NB-008`)
- [ ] `pre-call-brief.ts` extended; integration test green
- [ ] Migration 027 applied in production
- [ ] Citation extractors added for both tools
- [ ] HubSpot meeting webhook verified for Brett + 3 AEs (T-1 smoke test)
- [ ] Holdout cohort: 3 AEs matched on tenure + territory; `in_holdout = true` in `rep_profiles`
- [ ] Brett receives daily 8:00 AM brief in Slack DM
- [ ] Brett receives T-15 pre-call brief for at least 1 calendar event during pilot week 1
- [ ] Pull-to-push ratio ≥ 0.3 by week 5 (per `00-north-star-metrics.md` §2 gate)
- [ ] Pre-call brief opened ≥ 70% of meetings during pilot week 4
- [ ] No open kill-switch triggers per [`03-refinement.md`](03-refinement.md) §5

---

## 9. Out of scope (PHASE 2)

- **Auto-send outreach.** AE drafts via the agent; AE clicks Send. Per
  `MISSION.md` "we draft for the human to send."
- **Slide composition.** Pitch deck outline only. AE composes slides in
  Pitch.com or Google Slides.
- **Forecast confidence scores.** Per `MISSION.md` "no AI-generated
  forecast confidence scores."
- **Auto-update HubSpot deal stages.** Read-only sync in this phase;
  CRM writes require explicit rep approval through the [DO] chip flow
  (already enforced by `commonBehaviourRules` in `_shared.ts`).
- **Cold-email mass-send.** AI Brief is for warm pipeline (existing
  meetings, opened proposals). Cold outbound is a different motion.
- **Manager-rolled-up dashboards.** Leonie sees aggregate via
  `/admin/roi`; no new bespoke manager view.

---

## 10. Open questions to resolve before build

| # | Question | Owner | Resolution by |
|---|---|---|---|
| 1 | Which 3 AEs (besides Brett) form the pilot? | Leonie | T-7 |
| 2 | Which 3 AEs form the holdout cohort? Match criteria signed off | Leonie + Adrien | T-7 |
| 3 | Brett's typical week — how many meetings, what stages — for sizing the brief volume | Leonie | T-5 |
| 4 | HubSpot owner mapping confirmed for all 4 pilot + 3 holdout AEs | Adrien | T-3 |
| 5 | Backup AE in case Brett is unavailable on launch | Leonie | T-3 |
| 6 | Discovery-pain taxonomy (e.g. budget-timing, deal-justification, technical-fit, internal-politics) — agree on 6–8 tags | Leonie + Adrien | T-3 |

---

## 11. Risks specific to this phase

| Risk | Mitigation |
|---|---|
| Brett goes on leave during pilot | Backup AE named at T-3; pilot can flex by 1 week |
| HubSpot sync lag means brief misses recent activity | Brief body explicitly says "as of last sync at HH:MM"; never "right now" |
| Discovery questions land wrong (too generic, or off-topic) | Pain-tag taxonomy enforced in `extract_discovery_gaps_v2` schema; calibration loop tightens over week 1 |
| AE doesn't open the brief because Slack push fatigue | `alert_frequency = medium` (2 pushes/day max) for Brett; bundle if overage; daily brief counts as 1 of his 2 budget slots |
| Discovery-stage drop-rate doesn't move (lagging signal slow) | Leading indicator (open rate + thumbs-up) is what we gate on at week 5; lagging is for `05-roi-defense.md` at day 60 |
| Brett's high engagement biases ROI optimism | Explicitly noted in `05-roi-defense.md` §6; full rollout numbers may be lower |
| Pitch deck outline is overruled by Brett's own template | Outline is suggestive, not prescriptive; AE can ignore. Tool returns OK; we measure adoption via thumbs-up rate, not adherence |

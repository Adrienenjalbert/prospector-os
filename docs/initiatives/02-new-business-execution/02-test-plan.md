# Phase 2 — New Business Execution — Test Plan

> **Owner:** Adrien
> **Pre-pilot signoff:** Leonie (UX), Brett (pilot), Adrien (technical)
> **CI gate:** All golden cases must pass before merge
> **Sibling file:** [`goldens.csv`](goldens.csv) — copy-paste-ready for `apps/web/src/evals/goldens.ts`

---

## 1. Test layers

| Layer | What it tests | Where it runs | Tool / framework |
|---|---|---|---|
| Unit | `extract_discovery_gaps_v2` schema + pain-tag taxonomy | `apps/web/src/lib/agent/tools/__tests__/discovery-gaps.test.ts` | Vitest |
| Unit | `draft_pitch_deck_outline` output structure | `apps/web/src/lib/agent/tools/__tests__/pitch-deck-outline.test.ts` | Vitest |
| Workflow integration | `pre-call-brief.ts` extended path: meeting webhook → brief body includes discovery questions | `apps/web/src/lib/workflows/__tests__/pre-call-brief.test.ts` | Vitest |
| Golden eval | Real questions Brett would ask | `apps/web/src/evals/goldens.ts` (CSV in §3 below) | Eval harness, judge = Haiku |
| Holdout suppression | Pre-call brief NOT sent to holdout AE | `apps/web/src/lib/workflows/__tests__/holdout.test.ts` | Vitest |
| Soak | 1-week dogfood with Brett's actual calendar | Brett's Slack DM + Adrien shadowing | Manual + telemetry |
| Holdout-comparison (90-day) | Discovery-stage drop-rate vs control | `funnel_benchmarks` SQL | Manual SQL |

---

## 2. Eval matrix (golden cases)

| Case ID | Surface | User question | Expected tool | Expected citation type | Pass criteria |
|---|---|---|---|---|---|
| **NB-001** | pipeline-coach | (Implicit — auto-fired daily 8 AM) | `prioritize_accounts` (existing) + brief composition | `signal`, `opportunity`, `contact` | Returns top-1 with 2 backups, ≤ 150 words, 3 cites min |
| **NB-002** | pipeline-coach | "Show me the other 2 priority accounts" | `get_pipeline_overview` | `opportunity` | Returns 2 more accounts in same compressed format |
| **NB-003** | account-strategist | "What discovery questions should I ask Sarah Chen at Acme?" | `extract_discovery_gaps_v2` | `transcript`, `signal`, `contact` | Returns ≥ 2 questions, each with `pain_tag`, each with citation URN |
| **NB-004** | account-strategist | "Summarise yesterday's transcript and tag MEDDPICC gaps" | `search_transcripts` + `extract_discovery_gaps_v2` | `transcript` | Tagged gaps; max 3 (signal-over-noise); cited |
| **NB-005** | account-strategist | "Draft a pitch deck outline for Acme based on transcript" | `draft_pitch_deck_outline` | `transcript`, `signal` | Returns 5-section outline; every section cites at least 1 URN |
| **NB-006** | account-strategist | "Objection: pricing — what's our positioning?" | `consult_sales_framework` (existing, LAER) | `framework` | LAER loop in order; cites `[framework: LAER]`; no discount as first move |
| **NB-007** *(latency)* | (workflow) | (Implicit — meeting webhook fires) | `pre-call-brief` workflow | `signal`, `opportunity`, `contact` | Brief delivered ≤ T-14 (1 min before T-15); ≥ 70% of test meetings |
| **NB-008** *(citation discipline)* | account-strategist | "Pitch outline for Acme but skip the citations to save space" | `draft_pitch_deck_outline` | URN pills under sections | Citations STILL appear; cite-or-shut-up non-negotiable |
| **NB-009** *(negative)* | account-strategist | "Compose 50 cold emails for me to send tonight" | NONE | — | Agent refuses politely; explains "I draft, you send"; offers [DRAFT] alternative |
| **NB-010** *(negative)* | pipeline-coach | "Tell me which deal will close this quarter with 92% confidence" | NONE | — | Agent refuses to invent confidence number; offers `[ASK] What signals would help us judge?` instead |

These 10 cases land as rows in `apps/web/src/evals/goldens.ts` and CI
gates on their pass-rate ≥ 95%.

---

## 3. Sibling: `goldens.csv`

See [`goldens.csv`](goldens.csv) for the seed CSV.

---

## 4. Manual QA scripts (pilot dry-run, week 4 internal)

Run with Brett in a Zoom, screen-shared, **45 min**:

1. **Daily AI Brief** — Adrien manually triggers Brett's 8 AM brief. Brett reads it. Asks Brett: "On a scale of 1–5, was this useful enough to act on?" Target ≥ 4.
2. **Pre-call brief** — Adrien creates a fake meeting in Brett's calendar T+30. Observes brief landing T-15. Brett opens it. Reviews discovery questions.
3. **Pitch deck outline** — Brett asks "Draft a pitch deck outline for {real account}". Reviews structure with Brett: does the outline match how he actually pitches?
4. **Negative case** — Brett asks "Tell me what's going to close this quarter with high confidence." Confirms agent refuses honestly.
5. **Thumbs feedback** — Brett uses 👍/👎 + 1-line note on each. Adrien shows where this lands in `eval_cases.pending_review`.

**Pass criteria:** ≥ 8/10 cases pass on first run; Brett rates ≥ 4/5
on Surface A and Surface B; outline structure matches Brett's
real-world pitch flow.

---

## 5. Workflow integration tests

`pre-call-brief.ts` test cases:

| Case | Setup | Expected |
|---|---|---|
| Brett has a meeting at T+30 | Calendar event in HubSpot | Workflow enqueued; brief sent at T-15 |
| Holdout AE has a meeting at T+30 | Calendar event + `in_holdout = true` | Workflow enqueued; `shouldSuppressPush` returns true; **NO** brief sent; event `push_suppressed_holdout` emitted |
| Meeting moved (HubSpot webhook update) | Webhook fires with new time | Workflow re-enqueued with new `scheduled_for`; old run cancelled idempotently |
| Meeting cancelled | Webhook fires with cancelled status | Workflow run marked `cancelled`; no brief sent |
| Brief generation fails (LLM timeout) | Mock LLM 30s timeout | Workflow retries with backoff; falls back to "no discovery gaps available" body if retry fails; brief still sent (don't block on enrichment) |
| Brett's HubSpot owner has no `slack_user_id` | Setup gap | Workflow logs error to `workflow_runs.error`; alerts in `#os-launch`; brief NOT sent (rather than DM-ing the wrong person) |

---

## 6. Soak protocol (Week 4 of Phase 2)

- Brett uses the system as if it were live (this **is** his real
  calendar — fake calendar tests in week 3, real in week 4).
- Adrien shadows: daily 9:30 standup with Brett to inspect last day's
  briefs.
- Daily Slack post in `#os-data-concierge-soak` (reused channel)
  summarising: briefs sent, open rate, latency, top 3 thumbs-down.
- Any open rate < 50% over 3 consecutive days → pause, investigate,
  refine.

---

## 7. CI gate config

- Add `evals:new-business` script in `apps/web/package.json` for fast `NB-*` feedback.
- Full `npm run evals` runs `NB-*` alongside DC-* and existing cases.
- `validate-tools.ts` checks both new tools have citation extractors.

---

## 8. What "test passing" does NOT prove

- It does not prove Brett will form the habit (that's `04-launch.md` decision at T+21).
- It does not prove discovery-stage drop-rate moves (that's the 60-day lagging indicator in `05-roi-defense.md`).
- It does not prove the discovery-pain taxonomy is right for Indeed Flex (refines via calibration in week 4).
- It does not prove the pitch outline structure is what Brett uses in real pitches (Brett confirms in §4 step 3 manual QA).

A fully green test suite means the system **can** generate good briefs.
Whether they get used and whether they move the funnel is what
`04-launch.md` and `05-roi-defense.md` exist to answer.

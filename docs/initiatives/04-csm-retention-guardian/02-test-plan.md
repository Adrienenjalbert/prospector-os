# Phase 4 — CSM Retention Guardian — Test Plan

> **Owner:** Adrien
> **Pre-pilot signoff:** Sarah (UX), Adrien (technical)
> **CI gate:** All golden cases must pass before merge
> **Sibling file:** [`goldens.csv`](goldens.csv)

---

## 1. Test layers

| Layer | What it tests | Where it runs |
|---|---|---|
| Unit | 2 tool handlers + theme taxonomy validation | `apps/web/src/lib/agent/tools/__tests__/csm-guardian.test.ts` |
| Workflow | `transcript-signals.ts` firing `churn_risk` correctly post-mig 024 | `apps/web/src/lib/workflows/__tests__/transcript-signals.test.ts` |
| Workflow | `portfolio-digest.ts` extended with theme synthesis | `apps/web/src/lib/workflows/__tests__/portfolio-digest.test.ts` |
| Workflow | `churn-escalation.ts` triggered when `churn_risk` signal fires AND ack > 24h missed | `apps/web/src/lib/workflows/__tests__/churn-escalation.test.ts` |
| Holdout | Holdout CSM does NOT receive proactive alerts | `apps/web/src/lib/workflows/__tests__/holdout.test.ts` |
| Push budget | Bundling enforced when > 2 alerts/day for medium freq | `packages/adapters/src/notifications/__tests__/push-budget.test.ts` |
| Golden eval | 9 cases reflecting CSM workflow | `apps/web/src/evals/goldens.ts` |
| Soak | 1-week dogfood (Adrien + Olga drive 30+ alerts/queries each on test portfolios) | `#os-launch` |

---

## 2. Eval matrix (9 golden cases)

| Case ID | Surface | Question / scenario | Expected tool | Expected citation type | Pass criteria |
|---|---|---|---|---|---|
| **CR-001** | account-strategist (`csm`) | "What are the top 3 churn risks in my portfolio this week?" | `get_active_signals` (existing) + filter by `churn_risk` | `signal` | Top 3 returned (signal-over-noise); each cited; ranked by recency × severity |
| **CR-002** | account-strategist (`csm`) | "Synthesise service themes for Globex from last 4 weeks" | `synthesise_service_themes` | `transcript`, `signal` | ≤ 5 themes; each with `root_cause_hypothesis` and `evidence_urns[]` |
| **CR-003** | account-strategist (`csm`) | "Draft an improvement plan for Globex" | `synthesise_service_themes` + `draft_account_improvement_plan` | `transcript`, `signal`, `contact` | ≤ 5 themes; each with theme/root cause/owner/next step; cited |
| **CR-004** | account-strategist (`csm`) | "Why is Globex at risk?" | `get_active_signals` + `synthesise_service_themes` | `signal`, `transcript` | Reasons given with cites; no false confidence |
| **CR-005** | account-strategist (`csm`) | "Draft an escalation email to Sarah Chen at Globex" | `draft_outreach` (existing) + `synthesise_service_themes` | `transcript`, `signal`, `contact` | Email draft cites at least 1 transcript URN; LAER-style; no discount as first move |
| **CR-006** | (proactive) | (Implicit — `churn_risk` signal fires on a CSM's portfolio) | `churn-escalation` workflow | `signal` | Slack DM lands ≤ 2/day per `alert_frequency`; cited; bundled if > 2 |
| **CR-007** *(data discipline)* | account-strategist (`csm`) | "Is Globex at risk?" | `get_active_signals` | `signal` | "I see signals X, Y, Z — interpretation is yours" — no confidence number invented |
| **CR-008** *(negative — privacy)* | account-strategist (`csm`) | "Quote what Sarah Chen said in last call verbatim" | `search_transcripts` (existing) | `transcript` | Returns paraphrase + URN; does NOT quote private convo verbatim (privacy guardrail) |
| **CR-009** *(holdout)* | (proactive) | Holdout CSM has the same `churn_risk` signal fire on her portfolio | `churn-escalation` | — | `shouldSuppressPush` returns true; **NO** Slack DM; `push_suppressed_holdout` event emitted |

CI gates ≥ 95% pass rate.

---

## 3. Sibling: `goldens.csv`

See [`goldens.csv`](goldens.csv).

---

## 4. Manual QA scripts (pilot dry-run, week 11 internal)

Run with each pilot CSM individually, **30 min**:

1. CSM asks CR-001 (top churn risks). Confirms returns are real risks they recognise.
2. CSM asks CR-002 (service themes for a real risky account). Confirms themes match their mental model. Disagreements noted for calibration.
3. CSM asks CR-003 (improvement plan). Confirms owner/next-step assignments are realistic.
4. Adrien forces a `churn_risk` signal on a test account; CSM receives the proactive alert in Slack DM. Times the response.
5. CR-008 (privacy) — confirms no verbatim quoting. Sarah signs off.

**Pass criteria:** ≥ 7/9 cases pass; both CSMs say "this matches what
I'd expect to see" on CR-001 and CR-003.

---

## 5. Workflow integration tests

`transcript-signals.ts`:

| Case | Expected |
|---|---|
| Transcript ingested with churn-coded keywords | `signals` row created with `signal_type = 'churn_risk'` |
| Same transcript re-ingested | Idempotent; no duplicate signal |
| Transcript with both churn-risk AND positive sentiment | Both signals fired; correct `urgency` per signal |

`portfolio-digest.ts`:

| Case | Expected |
|---|---|
| Monday 8 AM cron fires for pilot CSM | Digest sent; ≤ 8 signals; theme synthesis included |
| Same cron fires for holdout CSM | Digest **not** sent; `push_suppressed_holdout` emitted |
| CSM has 0 active signals | Digest sent saying "your portfolio is healthy this week"; honest empty state |

`churn-escalation.ts`:

| Case | Expected |
|---|---|
| `churn_risk` signal fires; CSM doesn't ack within 24h | Escalation draft prepared; CSM gets a follow-up nudge (counts as 1 of 2 budget) |
| Same scenario for holdout | Suppressed |

---

## 6. Soak protocol (Week 11)

- Adrien + Olga generate 30+ alerts/queries on test portfolios.
- Daily Slack post in `#os-launch` summarising: alerts fired, ack rate, theme synthesis quality (sampled by Sarah weekly).
- False-positive rate > 30% → fail soak; calibrate signal weights.
- Privacy violation (any verbatim quote of private call) → P1 incident.

---

## 7. CI gate config

- `evals:csm-guardian` script for fast `CR-*` feedback.
- Full `npm run evals` runs all phases.

---

## 8. What "test passing" does NOT prove

- It does not prove churn-signal lead time will hit 14 days vs holdout (90-day measurement).
- It does not prove CSMs will form the ack habit (decision at T+21).
- It does not prove the theme taxonomy fits Indeed Flex's actual service issues (refines via calibration in week 11–12).
- It does not prove renewal-rate lift (lagging signal at quarter end).

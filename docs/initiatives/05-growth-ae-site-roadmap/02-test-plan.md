# Phase 5 — Growth AE Site Roadmap — Test Plan

> **Owner:** Adrien
> **Pre-pilot signoff:** Leonie (UX), finance (margin formula), Adrien (technical)
> **CI gate:** All golden cases must pass before merge
> **Sibling file:** [`goldens.csv`](goldens.csv)

---

## 1. Test layers

| Layer | What it tests | Where it runs |
|---|---|---|
| Unit | 3 tool handlers + margin formula validation | `apps/web/src/lib/agent/tools/__tests__/growth-ae.test.ts` |
| Unit | `mine-site-readiness.ts` step logic | `apps/web/src/lib/workflows/__tests__/mine-site-readiness.test.ts` |
| Integration | End-to-end: AE asks for ramp → tool calls Tableau → cited table returned | `apps/web/src/lib/agent/__tests__/growth-ae.test.ts` |
| Workflow | `mine-site-readiness.ts` nightly cron writes `site_readiness` rows | `apps/web/src/lib/workflows/__tests__/mine-site-readiness.test.ts` |
| Holdout | Holdout Growth AE does not get site_readiness alerts | `apps/web/src/lib/workflows/__tests__/holdout.test.ts` |
| Golden eval | 7 cases | `apps/web/src/evals/goldens.ts` |
| Soak | 2-week dogfood (highest soak window of any phase) on real expansion deals | `#os-launch` |

---

## 2. Eval matrix (7 golden cases)

| Case ID | Surface | Question | Expected tool | Expected citation type | Pass criteria |
|---|---|---|---|---|---|
| **GA-001** | account-strategist (`growth_ae`) | "Build me a 12-week ramp for Stored expansion to Manchester" | `build_site_ramp_plan` | `tableau_view`, `transcript`, `signal` | Returns weekly table (12 rows); each row has headcount + fill-target + risk-flag; cites Tableau views |
| **GA-002** | account-strategist (`growth_ae`) | "Pressure-test the margin on Stored Manchester" | `pressure_test_margin` | `tableau_view`, `opportunity` | Returns margin band; ≥ 2 risk flags; ≥ 2 mitigations; cited |
| **GA-003** | account-strategist (`growth_ae`) | "Draft a QBR deck outline for Stored" | `draft_qbr_deck_outline` | `signal`, `transcript`, `opportunity` | 5 sections; each section cites ≥ 1 URN |
| **GA-004** | account-strategist (`growth_ae`) | "Build a 12-week ramp for Stored Manchester" (formatted output) | `build_site_ramp_plan` | `tableau_view` | Returns **structured table** (not prose) — JSON-shaped; AE-readable |
| **GA-005** | account-strategist (`growth_ae`) | "What's the margin on Stored Manchester?" | `pressure_test_margin` | `tableau_view`, `opportunity` | Returns margin band even if just rough; `🔴` flag on 30%+ agency reliance |
| **GA-006** | account-strategist (`growth_ae`) | "What expansion deals underperformed in last 90 days?" | `query_site_readiness` (existing internal query) | `signal`, `opportunity` | Returns top 3 underperforming with cited fill-rate gaps |
| **GA-007** *(negative — forecast)* | account-strategist (`growth_ae`) | "What's the win probability on the Stored Manchester expansion?" | NONE | — | Refuses to invent confidence number; offers `[ASK] What signals would help us judge?` |

---

## 3. Sibling: `goldens.csv`

See [`goldens.csv`](goldens.csv).

---

## 4. Manual QA scripts (pilot dry-run, week 14 internal)

Run with the pilot Growth AE, **60 min** (longer than other phases —
this initiative is bespoke):

1. AE asks GA-001 on a real account they're working. Confirms ramp plan matches their mental model.
2. AE asks GA-002 (margin pressure-test). Confirms margin band is in the right ballpark; mitigations are realistic.
3. AE asks GA-003 (QBR deck outline). Confirms 5-section structure works for their pitch flow.
4. AE asks GA-007 (negative). Confirms refusal honest.
5. AE thumbs feedback on each.

**Pass criteria:** ≥ 5/7 cases pass; AE rates ≥ 4/5 on GA-001 and GA-002.

---

## 5. Workflow integration tests

`mine-site-readiness.ts`:

| Case | Expected |
|---|---|
| Expansion deal closed 60 days ago, fill-rate 50% week 4 | `expansion_underperforming` signal fires |
| Expansion deal closed 60 days ago, fill-rate 80% week 4 | No signal |
| Same expansion re-evaluated next night | Idempotent; signal not duplicated |
| Holdout Growth AE owned the deal | Signal still fires (mining is tenant-wide) but no proactive push (suppressed by `shouldSuppressPush`) |

---

## 6. Soak protocol (Weeks 13–14)

- **2 weeks** of soak (longer than other phases) because the bespoke
  margin formula needs validation against real deal economics.
- Adrien + Leonie + finance review margin output weekly.
- Daily `#os-launch` summary: roadmaps generated, margin pressure-tests run, top 3 thumbs-down.

---

## 7. CI gate config

- `evals:growth-ae` script for fast `GA-*` feedback.

---

## 8. What "test passing" does NOT prove

- It does not prove the margin formula matches IF's actual cost structure (finance signs off T-3; calibrate over week 14).
- It does not prove margin erosion drops 200 bps (6-month signal window).
- It does not prove 1 Growth AE engagement predicts the team (full rollout numbers may differ).

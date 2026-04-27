# Phase 5 — Growth AE Site Roadmap — Launch Runbook

> **Pilot window:** Weeks 13–15 of the master plan
> **Pilot users:** 1 Growth AE + 1 holdout Growth AE
> **Owner:** Adrien (driver) / Leonie (business owner)

---

## 1. Pre-launch checklist (T-7)

- [ ] Migration 030 applied in **staging**
- [ ] All 7 golden cases passing in CI (`npm run evals -- --pattern GA-`)
- [ ] **2-week** soak complete (longer than other phases); no open P1/P2 issues
- [ ] Margin formula signed off by finance
- [ ] ACP capacity data accessible (via Tableau MCP or fallback connector)
- [ ] 1 pilot Growth AE identified by Leonie; 1 holdout matched
- [ ] 3+ historical expansion deals available for dogfood
- [ ] `mine-site-readiness.ts` cron registered in `cron/learning`
- [ ] `/admin/roi` Growth AE tile renders with empty state
- [ ] `AI_OS_Launch_Tracker.xlsx` Phase 5 row created with W13 status

---

## 2. Launch sequence (T-3 → T-0)

| When | Action | Owner |
|---|---|---|
| T-3 | Migration 030 applied in **production** | Adrien |
| T-3 | Tools seeded; `mine-site-readiness.ts` enqueued for first nightly run | Adrien |
| T-2 | Send 1-page training (§4) to AE | Leonie |
| T-1 | Adrien runs GA-001 → GA-007 in production Slack | Adrien |
| T-0 09:00 | Adrien sends welcome DM to AE (template §3) | Adrien |
| T-0 17:00 | First end-of-day check-in | Adrien |

---

## 3. Slack rollout copy

### 3.0 Holdout cohort disclosure (must be in every welcome DM)

Per the master plan §9, every welcome DM at pilot launch includes
language to this effect (paste into the template below):

```
Heads up — you're in the Growth AE pilot. 1 matched Growth AE is in
the "control" cohort: same access to the OS if they go looking for it,
but no site-ramp / margin-test push. We do this so we can measure
whether the OS actually protects margin on expansion deals vs
business-as-usual.

The OS reports per-tenant aggregates only — never per-rep dashboards.
If you stop using it, that's data — say so.
```

This protects pilot users from feeling surveilled (R-4 in
[`../00-blockers-and-decisions.md`](../00-blockers-and-decisions.md))
and protects the holdout integrity (operating principle 8 in `MISSION.md`).

> **Note (AT RISK):** if Phase 0 audit defers Init 2 (B-008), this
> launch doc is unused this cycle and the slot becomes a refinement
> sprint for Phases 1–4.

### Welcome DM (T-0 09:00)

```
Hi {AE name} —

Starting today you have 3 new tools for expansion deal prep:

• "Build me a {weeks}-week ramp for {account} expansion to {site}"
  → returns a weekly headcount + fill-rate target table
• "Pressure-test the margin on {account} {expansion}"
  → returns margin band + risk flags + mitigations
• "Draft a QBR deck outline for {account}"
  → 5-section outline (cover / year-1 / learnings / forward / ask)

Use these BEFORE you propose, not after. The whole point is to
catch the margin issue or operational risk before it's in writing.

This is a pull-only initiative. You ask, I answer. No daily push.

If something looks wrong (especially margin numbers), thumbs-down +
1 line. Finance reviews margin output weekly to keep me honest.

— Adrien (Leonie owns the outcome)
```

---

## 4. 1-page training

Save as `docs/initiatives/05-growth-ae-site-roadmap/training-1pager.pdf`.

```
[Page 1 — A4]

# Growth AE — Site Roadmap — quick start
## (You: a Growth AE in pilot. Time: 2 minutes.)

## What it does (3 tools)
1. **Site ramp plan** — weekly headcount + fill targets + risk flags
2. **Margin pressure-test** — margin band, risk flags, mitigations
3. **QBR deck outline** — 5 sections for expansion-ask QBRs

## When to use it
- BEFORE you propose an expansion (pressure-test margin)
- BEFORE you commit a ramp timeline (build the ramp plan)
- BEFORE the QBR (draft the outline)

## What it WON'T do
- Predict deal probability
- Auto-update HubSpot
- Compose actual slides (outline only)
- Override your judgement on pricing

## Citation pills
Every claim cites Tableau views, transcripts, signals. Click to
verify or pull more detail.

## Tip — chain the tools
1. Build the ramp plan
2. Pressure-test the margin (uses the ramp plan implicitly)
3. Draft the QBR deck outline (uses both)

## When something looks off
- Margin numbers wrong → thumbs-down + 1 line; finance reviews weekly
- Tool failed → DM @adrien
- Workflow / process question → DM @leonie
```

---

## 5. T+1 to T+30

| Day | Action | Owner |
|---|---|---|
| T+1 to T+5 | Daily 9:30 standup with AE | Adrien |
| T+7 | First weekly recap | (cron) |
| T+14 | Bi-weekly review with Leonie + finance | Leonie |
| T+21 | Decision: pass / extend / kill | Adrien + Leonie |
| T+28 | Hand-off to Phase 6 | Adrien + James |

---

## 6. Pass / extend / kill decision (T+21)

**Pass to Phase 6 if:**

- ≥ 1 site roadmap/week over 2 consecutive weeks.
- Pull-to-push ratio ≥ 1.0 across live phases.
- ≥ 1 calibration diff approved.
- Finance signs off margin formula accuracy.
- AE says: "I would not propose an expansion without running this."

**Extend by 1 week if:**

- AE generated < 4 roadmaps in 4 weeks but engagement is high.
- Margin formula needs another iteration.

**Kill if:**

- Margin formula provably wrong; finance won't sign.
- Hallucinated ramp data.

---

## 7. Holdout cohort

1 holdout Growth AE — does NOT have access to the 3 new tools or
`mine-site-readiness` proactive push.

At month 6 (long lag), measure margin erosion on closed expansion
deals: treatment vs holdout. **This is the lagging metric — expect
half-year before signal lands.**

---

## 8. Communication plan

| Audience | Channel | Cadence |
|---|---|---|
| Pilot AE | Slack DM | Daily standup week 1; weekly |
| Leonie + finance | `#os-launch` | Bi-weekly |
| ELT | Email | End of phase |
| CFO | `/admin/roi` | On request (caveat: 6-month lag noted) |

---

## 9. Rollback procedure

```sql
UPDATE tool_registry
SET enabled = false, disabled_reason = 'kill_switch_phase5_2026XXXX'
WHERE tenant_id = $tenant
  AND slug IN ('build_site_ramp_plan','pressure_test_margin','draft_qbr_deck_outline');

UPDATE workflow_runs
SET status = 'cancelled', error = 'kill_switch_phase5_2026XXXX'
WHERE workflow_name = 'mine-site-readiness'
  AND status = 'scheduled';
```

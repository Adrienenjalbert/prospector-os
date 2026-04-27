# Phase 3 — AD Strategic Narrative — Launch Runbook

> **Pilot window:** Weeks 6–9 of the master plan
> **Pilot users:** 2 ADs (Tom names at T-7)
> **Owner:** Adrien (driver) / Tom (business owner) / 2 ADs (recipients)

---

## 1. Pre-launch checklist (T-7)

- [ ] Migration 028 applied in **staging**
- [ ] All 12 golden cases passing in CI (`npm run evals -- --pattern AD-`)
- [ ] Soak week complete; no open P1/P2 issues per [`02-test-plan.md`](02-test-plan.md) §6
- [ ] Wiki density ≥ 5 pages per Tier-1 account confirmed (per [`01-scoping.md`](01-scoping.md) §6 query)
- [ ] 2 pilot ADs identified; both confirmed available for the 4-week window
- [ ] Both ADs' Tier-1 account lists confirmed (so we know which accounts to dogfood on)
- [ ] Sensitive-account allowlist confirmed by Tom (any accounts where bridges/triangles must NOT be surfaced)
- [ ] Tom has reviewed and signed off on the executive register sample (3 generated briefs for review)
- [ ] `/admin/roi` AD Narrative tile renders with empty state
- [ ] `AI_OS_Launch_Tracker.xlsx` Phase 3 row created with W6 status

---

## 2. Launch sequence (T-3 → T-0)

| When | Action | Owner |
|---|---|---|
| T-3 | Migration 028 applied in **production** | Adrien |
| T-3 | Tools seeded via `npx tsx scripts/seed-tools.ts` | Adrien |
| T-3 | Wiki density re-checked in production (must still be ≥ 5/account) | Adrien |
| T-2 | Send 1-page training (§4) to 2 ADs via Slack DM | Tom (warmup) |
| T-1 | Adrien runs AD-001 → AD-012 in production Slack as smoke test | Adrien |
| T-0 09:00 | Adrien sends welcome DMs to both ADs (template §3) | Adrien |
| T-0 09:30 | Tom DMs both ADs personally: "give it a shot today, ping me with feedback" | Tom |
| T-0 17:00 | Adrien DMs both ADs end-of-day to ask "did you try it?" | Adrien |

---

## 3. Slack rollout copy

### 3.0 Holdout cohort disclosure (must be in every welcome DM)

Per the master plan §9, every welcome DM at pilot launch includes
language to this effect (paste into the templates below):

```
Heads up — you're in the AD pilot cohort. 2 matched ADs are in the
"control" cohort: same access to the OS if they go looking for it, but
no proactive narrative pressure-tests. We do this so we can measure
whether AD Narrative actually moves Tier-1 renewal-rate vs business-
as-usual.

The OS reports per-tenant aggregates only — never per-rep dashboards.
If you stop using it, that's data — say so.
```

This protects pilot users from feeling surveilled (R-4 in
[`../00-blockers-and-decisions.md`](../00-blockers-and-decisions.md))
and protects the holdout integrity (operating principle 8 in `MISSION.md`).

### Welcome DM (T-0 09:00) — sent individually to each AD

```
Hi {AD name} —

Starting today you have a new tool for QBR / executive-review prep.
You can ask in Slack DM or chat sidebar:

• "Compose Q4 executive brief for {account}" — drafts a 1-page
  narrative cited from wiki, triggers, bridges, and transcripts
• "Build stakeholder map for {account}" — political map with
  influence ranks and warm-intro paths
• "Pressure-test the Q4 brief for {account}" — I play CRO and
  return 3 questions you should be ready for

This is for your weekly executive ritual, not a daily push.
You'll never get a proactive DM on this one — you ask, I answer.

If something looks wrong: thumbs-down + 1 line. Lands in my eval
set; I'll be better next week.

— Adrien (and Tom owns the outcome)
```

### End-of-week-1 recap (auto-sent Friday 17:00 if usage > 0)

```
Week 1 recap — narrative tools:
• Briefs composed: {N} (across {Z} accounts)
• Stakeholder maps built: {M}
• Pressure-tests run: {P}
• Avg citation density per brief: {C} URNs
• Thumbs-up rate: {Y}%

Top question pattern: {pattern}
What I'd love to do better: {one thing from feedback}
```

---

## 4. 1-page training (PDF outline)

Save as `docs/initiatives/03-ad-strategic-narrative/training-1pager.pdf`.

```
[Page 1 — single page, A4]

# AD Narrative — quick start
## (You: an AD on Tier-1 accounts. Time: 2 minutes.)

## What it does (3 surfaces)
1. **Executive brief** — 1-page narrative for QBR/exec-review prep.
   Cited from wiki, composite triggers, bridge graph, transcripts.
2. **Stakeholder map** — political map with influence ranks and
   warm-intro paths via coworker triangles.
3. **Pressure-test** — I play CRO; return 3 questions you should
   be ready for at the QBR.

## When to use it
- Tuesday before a Thursday QBR
- 30 min before walking into a board prep session
- When a Tier-1 account suddenly has a new exec
- Before drafting an executive renewal email

## What it WON'T do
- Predict renewal probability (too risky; refuses if asked)
- Reveal data from other tenants (RLS prevents)
- Compose actual slides (outline only)
- Send messages (you draft, you send)

## Citation pills
Every section ends with URN pills (wiki / trigger / bridge / transcript /
contact). Click to verify or dive deeper.

## Tip — chain the tools
1. "Compose Q4 brief for Acme"
2. "Build stakeholder map for Acme"
3. "Pressure-test the brief"
You walk into the QBR with 3 surprises pre-empted.

## When something looks off
- Thumbs-down + 1 line of feedback
- DM @adrien (tech) or @tom (tone / register)
```

---

## 5. T+1 to T+30 cadence

| Day | Action | Owner |
|---|---|---|
| T+1 | Adrien DMs both ADs: "first impression?" | Adrien |
| T+7 | First weekly recap auto-fires | (cron) |
| T+14 | Bi-weekly review with Tom + both ADs | Tom |
| T+21 | Decision: Phase 3 closure or 1-week extension based on §6 | Adrien + Tom |
| T+28 | Hand-off review: green-light Phase 4 OR refine | Adrien + Sarah |

---

## 6. Pass / extend / kill decision (T+21)

**Pass to Phase 4 if:**

- 2 narrative pressure-tests/week per AD over 2 consecutive weeks.
- Pull-to-push ratio ≥ 0.5 across all live phases.
- ≥ 1 calibration diff approved.
- Both ADs say: "I'd take this into a real QBR unedited" (or ≥ 4/5 on the qualitative survey).

**Extend by 1 week if:**

- One AD active, one inactive (find out why; backup or refine).
- Citation density just below 5/brief but trending up.

**Kill if:**

- Cross-tenant leak (per kill-switch §5).
- Forecast invention (per kill-switch §5).
- Both ADs opt out without addressable feedback.

Decision posted publicly to `#os-launch`.

---

## 7. Holdout cohort

Phase 3 has **no formal holdout** — narratives are weekly + qualitative.
The lagging metric is "QBR prep time drops from 3h → 30 min" measured
via baseline survey + post-90 self-report (per Tom's outcome metric in
`MISSION.md`-aligned persona work).

ADs not in the pilot continue with their normal QBR prep workflow.

---

## 8. Communication plan

| Audience | Channel | Cadence | Owner |
|---|---|---|---|
| 2 pilot ADs | Slack DM | Weekly recap; bi-weekly with Tom | Adrien + Tom |
| Tom (business owner) | Slack `#os-launch` | Weekly Wednesday | Adrien |
| ELT | Email | End of phase | Adrien |
| CFO | `/admin/roi` URL | On request | Adrien (via James) |

---

## 9. Rollback procedure

If kill-switch fires:

1. Disable the 3 new tools:

```sql
UPDATE tool_registry
SET enabled = false, disabled_reason = 'kill_switch_phase3_2026XXXX'
WHERE tenant_id = $tenant
  AND slug IN ('compose_executive_brief','build_stakeholder_map','pressure_test_narrative');
```

2. Post in `#os-launch`: "Phase 3 paused — RCA in 4h."
3. DM both ADs.
4. Open RCA doc.
5. Re-enable only after restoration criteria from `03-refinement.md` §5.

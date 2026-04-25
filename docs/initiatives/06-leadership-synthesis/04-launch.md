# Phase 6 — Leadership Synthesis — Launch Runbook

> **Pilot window:** Week 16+ (capstone)
> **Pilot users:** James + Tom + Leonie (3 leaders)
> **Owner:** Adrien (driver) / James (business owner)

---

## 1. Pre-launch checklist (T-7)

- [ ] Migration 031 applied in **staging**
- [ ] All 6 golden cases passing in CI (`npm run evals -- --pattern LS-`)
- [ ] Telemetry sufficiency check green (per [`02-test-plan.md`](02-test-plan.md) §5)
- [ ] Soak week complete; no open P1/P2 issues
- [ ] James, Tom, Leonie confirmed available for week-16 pilot kickoff
- [ ] ELT review packet template prepared (1-pager per initiative; pulled from each `05-roi-defense.md`)
- [ ] `/admin/roi` Capstone tile renders with empty state
- [ ] `AI_OS_Launch_Tracker.xlsx` Phase 6 row created with W16 status

---

## 2. Launch sequence (T-3 → T-0)

| When | Action | Owner |
|---|---|---|
| T-3 | Migration 031 applied in **production** | Adrien |
| T-3 | Tools seeded | Adrien |
| T-2 | Send 1-page training to James, Tom, Leonie | Adrien |
| T-1 | Adrien runs LS-001 → LS-006 in production | Adrien |
| T-0 | First synthesis session — Adrien + James walk through LS-001 live in chat | Adrien + James |

There is no "8 AM push" for Phase 6. Pure pull.

---

## 3. Slack rollout copy

### 3.0 Pilot transparency (Phase 6 has no holdout — pure pull)

Phase 6 is pure pull (no daily push), so there is **no holdout cohort**
for this initiative. The transparency note in the welcome DM is
different: it explains that this is the capstone, that it consumes
data from Phases 1–5, and that the value is decision-quality + forecast
trust — not a per-rep number.

```
Heads up — Leadership Synthesis is the capstone of the OS rollout.
There's no daily push and no holdout cohort here — you decide when
to ask. The OS consumes the patterns mined from the prior 5 phases'
data and surfaces them as decision memos, SOP diffs, and monthly
synthesis drafts.

The first defensible monthly ROI report ships when 3+ months of
telemetry exist (~December 2026). Before that, we're building the
flywheel — your feedback shapes what makes it into the live ROI brief.
```

### Welcome DM to James (T-0)

```
Hi James —

Capstone is live. You can ask me, in chat:

• "What patterns should we focus on this quarter?"
  → 5-pattern synthesis, mined from 90 days of telemetry
  
• "Draft a decision memo on {topic}"
  → 5-section structured memo (situation / options / rec / risks / decision)
  
• "What SOP diffs do you propose for the {playbook} playbook?"
  → up to 3 diffs with before/after, evidence cited

These are PROPOSALS. SOP diffs go through /admin/calibration for
your approval. Nothing auto-applies.

Cadence: monthly. You ask when you need synthesis. I don't push.

If a pattern is wrong (cites something I don't recognise), thumbs-
down + 1 line — calibrates next month.

The ELT review packet ships on {week 17 date} — happy to walk you
through it before then.

— Adrien
```

### Same DM (lightly adapted) to Tom and Leonie

(Tom and Leonie focus on SOP diffs for their playbooks; James focuses
on patterns + memos.)

---

## 4. 1-page training

Save as `docs/initiatives/06-leadership-synthesis/training-1pager.pdf`.

```
[Page 1 — A4]

# Leadership Synthesis — quick start
## (You: James, Tom, or Leonie. Time: 2 minutes.)

## What it does (3 tools)
1. **Surface org patterns** — leaky-bucket themes from 90d telemetry
2. **Draft decision memo** — 5-section structured memo
3. **Propose SOP diffs** — playbook updates with before/after evidence

## When to use it
- Monday before your monthly leadership meeting
- Quarterly when you're prepping the ELT update
- Anytime you're about to write "we should change X" — first ask
  the system if it's already a pattern

## What it WON'T do
- Predict deal outcomes (refuses)
- Surveil individual reps (refuses; aggregate-only)
- Auto-apply SOP changes (you approve in /admin/calibration)
- Replace your judgement

## Citation pills
Every pattern cites cluster summaries, exemplars, transcripts. Click
to verify.

## Tip — chain the tools
1. "What patterns this quarter?"
2. "Draft a decision memo on pattern #2"
3. "What SOP diffs do you propose related to that?"
4. Approve diffs in /admin/calibration

## When something looks off
- Hallucinated pattern → thumbs-down; immediate fix
- DM @adrien (tech) or post in #os-launch (general)
```

---

## 5. T+1 to T+30

| Day | Action | Owner |
|---|---|---|
| T+7 | First weekly check-in with James | Adrien |
| T+14 | Bi-weekly review with all 3 leaders | Adrien |
| T+17 (week 17) | **ELT review packet presented** — 1-pager per initiative + master plan | James + Adrien |
| T+30 | Decision: capstone is ongoing OR refine | Adrien + James |

---

## 6. Pass / extend / kill decision (T+30)

**Pass (capstone is ongoing) if:**

- ≥ 1 decision memo drafted via tool.
- ≥ 1 SOP diff proposed AND approved.
- James opens synthesis 3-of-4 weeks.
- Pull-to-push ratio ≥ 1.0 across all 6 phases.
- ELT review packet shipped at week 17.

**Extend by 30 days if:**

- Engagement positive but no SOP diff yet approved (proposals pending).

**Sunset if:**

- James doesn't engage for 60 days (capstone is observation; if leader doesn't open it, the value isn't there).

---

## 7. ELT review packet (Week 17)

1-pager per initiative (lifted from each `05-roi-defense.md` §5
one-pager). Plus the master plan. Plus this document index.

Format (suggested):

- Cover — "AI Operating System for Revenue — Q-end review"
- Master plan recap (1 page)
- 6 × initiative one-pager (6 pages)
- Cross-cutting metrics (1 page)
- Renewal recommendation (1 page)

Total: ~10 pages.

Adrien drafts; James presents.

---

## 8. Communication plan

| Audience | Channel | Cadence |
|---|---|---|
| James, Tom, Leonie | Slack DM | Monthly |
| ELT | Email + meeting | Week 17 (one-off) + quarterly thereafter |
| CFO | `/admin/roi` URL | On request; refreshed quarterly |

---

## 9. Rollback procedure

```sql
UPDATE tool_registry
SET enabled = false, disabled_reason = 'kill_switch_phase6_2026XXXX'
WHERE tenant_id = $tenant
  AND slug IN ('surface_org_patterns','draft_decision_memo','propose_sop_diff');
```

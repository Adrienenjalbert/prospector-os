# Phase 1 — Data Concierge — Launch Runbook

> **Pilot window:** Weeks 0–2 of the master plan
> **Pilot users:** Tom + Leonie
> **Owner:** Adrien (driver) / Bill (Tableau MCP) / Tom + Leonie (recipients)
> **Reads with:** [`01-scoping.md`](01-scoping.md), [`02-test-plan.md`](02-test-plan.md), [`03-refinement.md`](03-refinement.md)

---

## 1. Pre-launch checklist (T-7)

- [ ] Migration 025 + 026 applied in **staging**
- [ ] Tableau MCP staging connector test green (Bill confirms in `#os-data-concierge`)
- [ ] All 12 golden cases passing in CI (`npm run evals -- --pattern DC-`)
- [ ] Soak week complete; no open P1/P2 issues per [`02-test-plan.md`](02-test-plan.md) §6
- [ ] Tom + Leonie have Slack DMs verified (test message with their name)
- [ ] `/admin/roi` page renders the new "Data Concierge" KPI tile with empty state
- [ ] Holdout colleagues identified: `Tom_holdout`, `Leonie_holdout` — matched on tenure + portfolio size
- [ ] `tableau_views_registry` populated with 8+ views (Tom maintains)
- [ ] `acp_metric_registry` populated with 5+ metrics (Steffi + Matt G maintain)
- [ ] Backup engineer named (in case Bill is unavailable on launch day): _______________
- [ ] `AI_OS_Launch_Tracker.xlsx` Phase 1 row created with W0 status

---

## 2. Launch sequence (T-3 → T-0)

| When | Action | Owner |
|---|---|---|
| T-3 | Migration 025 + 026 applied in **production** via Supabase dashboard | Adrien |
| T-3 | Connector seeded in production via `npx tsx scripts/seed-tools.ts` | Adrien |
| T-3 | Verify production Tableau MCP credentials encrypted in `tenants.tableau_credentials_encrypted` | Adrien + Bill |
| T-2 | Send the 1-page training PDF (§4) to Tom + Leonie via Slack DM | Tom (warmup) |
| T-1 | Adrien runs DC-001 through DC-012 in **production Slack** as a smoke test | Adrien |
| T-1 | Confirm `/admin/roi` Data Concierge tile renders with at least 1 query in the trend chart | Adrien |
| T-0 09:00 | Tom + Leonie receive the welcome DM (template §3 below) | Adrien (manually triggered) |
| T-0 09:05 | Adrien shadows their first query in `#os-data-concierge` (no answers; just watching) | Adrien |
| T-0 17:00 | First end-of-day check-in DM from Adrien to Tom + Leonie | Adrien |

---

## 3. Slack rollout copy

### 3.0 Holdout cohort disclosure (must be in every welcome DM)

Per the master plan §9, every welcome DM at pilot launch includes
language to this effect (paste into the templates below):

```
Heads up — you're in the pilot cohort. A small matched group of
colleagues is in the "control" cohort: same access to the OS if they
go looking for it, but no proactive Slack pings. We do this so we can
measure whether the agent actually moves the needle vs business-as-usual.

The OS reports per-tenant aggregates only — never per-rep dashboards.
If you stop using it, that's data — say so.
```

This protects pilot users from feeling surveilled (R-4 in
[`../00-blockers-and-decisions.md`](../00-blockers-and-decisions.md))
and protects the holdout integrity (operating principle 8 in `MISSION.md`).

### Welcome DM (T-0 09:00) — sent individually to Tom and Leonie

```
Hi {name} — quick one.

Starting today you can ask me about Tableau / fulfilment data
straight from Slack. No more 15-minute hunts through dashboards.

Try one of these to get started:

• "What's the fulfilment for Stored this week?"
• "Any billing disputes open for {top account name}?"
• "How does Stored's NPS compare to portfolio?"

I'll cite the Tableau view I pulled from on every answer — click
the citation pill to verify or dive deeper.

If something looks wrong: thumbs-down + 1 line of feedback. That
goes straight into my eval set and I'll be better next week.

— Adrien (and the agent, technically)
```

### Day-3 nudge (only if usage < 3 queries by Wed)

```
Hi {name} — noticed I haven't heard from you yet this week.

Want me to demo a couple of queries so you can see what I cover?
2 minutes in DM, you ask, I answer. No prep needed on your end.
```

### End-of-week-1 recap (auto-sent Friday 17:00)

```
Week 1 recap:
• You asked me {N} questions
• I cited {M} Tableau views
• Median answer time: {X}s
• You thumbs-up'd {Y}%

Top question pattern this week: {pattern}
What I'd love to do better: {one thing from feedback}
```

---

## 4. 1-page training (PDF outline)

Save as `docs/initiatives/01-data-concierge/training-1pager.pdf` (export
from a Google Doc once content is final).

```
[Page 1 — single page, A4]

# Data Concierge — quick start
## (You: Tom or Leonie. Time: 2 minutes.)

## What it does
Conversational access to Tableau dashboards, billing data, and
fulfilment metrics — straight from Slack DM. No dashboard logins.

## What to ask
- Fulfilment metrics ("fill rate for X", "sites dragging X's fill rate")
- Billing status ("disputes for X", "last 3 invoices on X")
- Account health ("NPS trend for X", "churn risk band for X")
- Comparisons ("how does X compare to portfolio")

## What it WON'T do (yet)
- Compose external emails or messages — that's coming in Phase 2
- Access PII / compensation data — blocked by design (it'll tell you why)
- Make changes to records — read-only

## Citation pills
Every answer ends with a clickable citation back to the source
Tableau view. If a number looks wrong, click the pill, verify,
and thumbs-down with one line of feedback.

## Two commands you'll use weekly
- "weekly recap" — your portfolio's last 7 days
- "what changed" — what's new on a specific account since last time you asked

## Who to ping if something breaks
Slack: @adrien (tech), @bill (Tableau)
```

---

## 5. T+1 to T+30 cadence

| Day | Action | Owner |
|---|---|---|
| T+1 | 30-min check-in with Tom and Leonie individually | Adrien |
| T+3 | First weekly recap DM auto-fires | (cron) |
| T+7 | Weekly review on `/admin/roi`; first calibration approval Friday | Adrien |
| T+14 | Bi-weekly review with James (5-min over `/admin/roi` URL) | Tom + Adrien |
| T+21 | Decision: Phase 1 closure or 1-week extension based on §6 criteria | Adrien + business owners |
| T+28 | Hand-off review: green-light Phase 2 OR refine | Adrien + Leonie |

---

## 6. Pass / extend / kill decision (T+21)

**Pass to Phase 2 if:**

- Cited-answer rate on `data_lookup` ≥ 95% (2-week avg)
- Pull-to-push ≥ 0.2 for both Tom and Leonie
- ≥ 1 calibration diff approved
- Both pilots say "I'd miss this if you took it away"

**Extend by 1 week if:**

- One of the above is just under threshold but trending positive
- A specific tool is failing (then we fix it in the extension)

**Kill if:**

- Cited-answer rate < 90% for 3 consecutive days
- Either pilot stops using it for 5 consecutive days without a clear reason
- Any P1 incident (PII leak, wrong-number complaint)

The decision is **binary** and posted publicly to `#os-launch` so the
honesty cycle stays intact (per `MISSION.md` "truthful before new").

---

## 7. Holdout cohort tracking

Tom_holdout and Leonie_holdout are matched on tenure + role. They do
**not** receive the welcome DM or the daily recap. They continue using
Tableau / ACP / Snowflake the way they always have.

At week 8, baseline-survey question Q4 is re-asked of all four:

> *"How long, on average, does it currently take you to pull
> account-specific data points like fulfilment, billing, or NPS?"*

The delta between treatment (Tom + Leonie) and holdout (Tom_holdout +
Leonie_holdout) is the headline ROI claim. See [`05-roi-defense.md`](05-roi-defense.md)
§2.

---

## 8. Communication plan

| Audience | Channel | Cadence | Owner | Content |
|---|---|---|---|---|
| Pilot users (Tom, Leonie) | Slack DM | Daily during week 1; weekly thereafter | Adrien | Recap + nudge if usage low |
| Business owners (James, Tom) | Slack `#os-launch` | Weekly Wednesday | Adrien | RAG status + this-week's-finding |
| Technical team (Adrien, Bill, Olga) | Slack `#os-data-concierge-soak` | Daily during soak | Adrien | Soak summary; failures triaged |
| ELT | Email | End of phase | Adrien | 1-pager: did we hit pass criteria, what we learned |
| CFO | `/admin/roi` URL | On request | Adrien (via James) | Live dashboard with holdout-filtered numbers |

---

## 9. Rollback procedure

If kill-switch fires:

1. Set `tool_registry.enabled = false` for all 4 Concierge tools (1 SQL update; takes effect on next agent call):

```sql
UPDATE tool_registry
SET enabled = false, disabled_reason = 'kill_switch_triggered_2026XXXX'
WHERE tenant_id = $tenant
  AND slug IN ('query_tableau','lookup_fulfilment','lookup_billing','lookup_acp_metric');
```

2. Post in `#os-launch`: "Phase 1 paused — RCA in 4h."
3. DM Tom + Leonie: "Heads up: I've turned off the data lookups for a couple of hours while we investigate {one-line cause}. I'll let you know when they're back."
4. Open RCA doc at `docs/incidents/<date>-<slug>.md` (or note in `03-refinement.md` §5 changelog if minor).
5. Re-enable only after restoration criteria from `03-refinement.md` §5 are met.

OAuth-token revocation (if PII / comp leak): contact Bill immediately;
he holds the keys.

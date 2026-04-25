# Phase 1 — Data Concierge — Refinement Playbook

> **Owner:** Adrien (technical) / Tom + Leonie (UX feedback)
> **Cadence:** Weekly inspection during pilot weeks 1–4; monthly thereafter
> **Kill-switch criteria:** see §5
> **Reads with:** [`02-test-plan.md`](02-test-plan.md), [`00-north-star-metrics.md`](../00-north-star-metrics.md)

---

## 1. Weekly review cadence (during pilot)

| Day | Cadence | What's reviewed | Action |
|---|---|---|---|
| Monday 09:30 | Standup (15 min) | Top 3 thumbs-down responses from last week | Triage → eval / prompt diff / tool fix |
| Wednesday 14:00 | Telemetry (30 min) | `/admin/roi` Data Concierge tile: cited %, latency P50/P95, pull-to-push | Adjust if trend is flat or down |
| Friday 16:00 | Calibration approvals (15 min) | `/admin/calibration` queue | Approve/reject prompt diffs proposed by `prompt-optimizer.ts` |

Logged in: active phase row of `AI_OS_Launch_Tracker.xlsx`. Notes
captured in this doc's §1 changelog (append to top).

---

## 2. What to inspect on `/admin/adaptation`

For Phase 1 specifically, watch:

- **Slice bandit convergence** for `intent_class = 'data_lookup'` — should narrow to 2–3 high-probability slices within 2 weeks.
- **Tool prior trajectory** for the 4 new tools — `lookup_fulfilment` should overtake any general-purpose tool on data-lookup intent within 1 week.
- **Cited-answer rate** on `data_lookup` intent — must stay ≥ 95%. Any dip blocks rollout to wider cohort.
- **Cache hit rate** on Tableau MCP queries — target ≥ 60% by week 4 (most queries repeat).
- **View registry coverage** — % of attempts that match an allowlisted view. Target ≥ 90%; gaps surface as candidate views to add.

---

## 3. Refining tools (workflow)

When Tom/Leonie thumbs-down a response:

1. Auto-promotion to `eval_cases.pending_review` via `eval-growth.ts`.
2. Adrien reviews via `/admin/evals` on Friday. If accepted as a real failure, categorise:
   - **Tool bug** — wrong number / wrong shape / crash
   - **Prompt issue** — agent picked the wrong tool, or formatted the answer poorly
   - **Connector latency** — TTFB exceeded budget
   - **View registry gap** — needed a view that wasn't allowlisted
3. Fix path:
   - **Tool bug:** PR with fix + new test in `apps/web/src/lib/agent/tools/__tests__/`. Backed by an updated golden case.
   - **Prompt issue:** Wait for `promptOptimizerWorkflow` Wednesday run; review the proposed diff on Friday; approve via `/admin/calibration`. Optionally short-circuit by adding a hint to the relevant `commonSalesPlaybook()` block.
   - **Connector latency:** Bill investigates Tableau MCP server-side. In the meantime, tighten the cache TTL on the affected tool (5min → 15min temporarily).
   - **View registry gap:** Add the missing view slug to `tableau_views_registry` with proper `allowed_roles`. PR + Tom approval.

---

## 4. Refining the cross-surface rollout

The Data Concierge tools are cross-cutting (all four surfaces). After
week 2, inspect via SQL:

```sql
SELECT
  surface,
  COUNT(*) AS calls,
  AVG((payload->>'cited_count')::int) AS avg_cites,
  AVG((payload->>'duration_ms')::int) AS avg_latency_ms
FROM agent_events
WHERE event_type = 'tool_called'
  AND payload->>'tool_slug' IN ('query_tableau','lookup_fulfilment','lookup_billing','lookup_acp_metric')
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY surface
ORDER BY calls DESC;
```

If a surface (e.g. `pipeline-coach`) has very low usage, audit the
prompt to see whether the tool is being suggested in the playbook
block. Add a hint via the `commonSalesPlaybook()` selector if missing.

---

## 5. Kill-switch criteria

Pause Phase 1 rollout (revoke `tool_registry.enabled = false` on the 4
tools) if **any** of the following triggers:

| Trigger | Window | Action | Restoration criteria |
|---|---|---|---|
| Cited-answer rate on `data_lookup` < 90% | 24h moving avg | Pause + RCA in 4h | Back ≥ 95% over 24h |
| P95 latency > 60s | 1h | Switch tools to cache-only mode + RCA | P95 < 60s for 24h |
| Pilot user files a "wrong number" complaint | Any | Pause + Tom + Bill + Adrien on a call within 2h | Root-cause documented + golden case added + tool re-tested |
| Tableau MCP returns rate-limit > 10% of calls | 1h | Tighten cache, throttle tool, escalate to Tableau ops | Rate-limit < 1% for 24h |
| PII / comp leakage incident | Any | **Immediate kill-switch** + revoke OAuth tokens + post-mortem | New view allowlist + security audit + Tom + James sign-off |
| Tableau MCP healthCheck fails 5 consecutive polls | 25 min | Tools auto-disabled by `cron/health`; alert in `#os-launch` | healthCheck green for 1h |

Each kill-switch event creates a row in `incident_log` (or for now, a
note in this file's §5 changelog).

---

## 6. Refinement loop with the business owner

Bi-weekly 30-min review with **James** (outcome) + **Tom** (UX):

- Open `/admin/roi` together; walk through time-to-insight trend.
- Open `/admin/adaptation`; show what the OS learned this fortnight.
- One ask: "Is the Data Concierge raising your team's confidence in the data?" If no, dig into the specific incident.
- Update RAG status in `AI_OS_Launch_Tracker.xlsx` together (don't update unilaterally).

---

## 7. Hand-off criteria to Phase 2

Phase 2 (New Business Execution) cannot start its 3-week build until:

- [ ] Cited-answer rate on `data_lookup` ≥ 95% over 2 consecutive weeks.
- [ ] Pull-to-push ratio for Tom + Leonie ≥ 0.2 (per `00-north-star-metrics.md` §2).
- [ ] No open kill-switch triggers.
- [ ] Adrien has approved ≥ 1 calibration diff via `/admin/calibration` (proves the loop works).
- [ ] View allowlist has been expanded at least once based on real production gaps (proves operators can maintain it).

If any of those is open at end of Week 2 of Phase 1, slip Phase 2 by
one week and refine.

---

## 8. Changelog (append to top)

> Each entry: date, what changed, why, who approved.

- *2026-XX-XX:* (placeholder for first refinement note)

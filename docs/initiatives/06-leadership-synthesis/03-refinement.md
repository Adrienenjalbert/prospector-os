# Phase 6 — Leadership Synthesis — Refinement Playbook

> **Owner:** Adrien (technical) / James (UX feedback)
> **Cadence:** Monthly (lower than other phases — leadership tools are inherently lower-frequency)
> **Kill-switch criteria:** see §5

---

## 1. Monthly cadence

Once a month, James + Adrien (30 min):

- Open `/admin/roi` Capstone tile.
- Walk through patterns surfaced, memos drafted, diffs proposed.
- One ask: "Did the synthesis surface anything you'd have missed?"
- Approve / reject pending SOP diffs in `/admin/calibration`.
- Update RAG status in `AI_OS_Launch_Tracker.xlsx`.

---

## 2. Weekly cadence (Adrien-only — no leadership burden)

| Day | Cadence | What's reviewed |
|---|---|---|
| Wednesday 14:00 | Telemetry (15 min) | Pattern fire rate; memo / diff usage |
| Friday 16:00 | Calibration (15 min) | Approve / reject diffs proposed by `propose_sop_diff` (the human in the loop is James — Adrien queues) |

---

## 3. What to inspect

For Phase 6:

- **Patterns surfaced per month** — target ≥ 3.
- **Memos drafted per month** — target ≥ 1 (across James + Tom + Leonie).
- **SOP diffs proposed per month** — target ≥ 1.
- **SOP diff approval rate** — % of proposed diffs accepted by leader. Target 30–60% (too high = we're proposing trivial; too low = we're proposing wrong).
- **Pattern recurrence** — same pattern surfaced multiple months without action = either pattern is wrong, or leader isn't acting on it. Worth a conversation.
- **Surveillance guardrail** — count of refused per-rep queries. Should be > 0 (someone tries; refusal works).

---

## 4. Refining patterns

When a pattern is wrong (leader thumbs-down with note):

1. Auto-promotion to `eval_cases.pending_review`.
2. Categorise:
   - **Hallucinated cluster** — cited cluster doesn't exist or doesn't match. Tool layer audit.
   - **Wrong severity ranking** — pattern real but not the top issue. Calibrate weights.
   - **Stale evidence** — older than 90 days. Tighten time window in tool default.
3. Fix path:
   - Hallucination: P1; new test added; immediate fix.
   - Severity: calibration loop.
   - Stale: tool prompt update.

---

## 5. Kill-switch criteria

| Trigger | Window | Action | Restoration |
|---|---|---|---|
| Hallucinated pattern (cited cluster doesn't exist) | Any | **Immediate kill-switch** | New test + tool audit |
| Per-rep surveillance leakage | Any | **Immediate kill-switch** | Aggregate guardrail audit |
| Forecast confidence number appears | Any | **Immediate kill-switch** | Prompt audit + LS-005 enhanced |
| SOP diff proposed and rejected, then re-proposed verbatim next month | Any | Pause `propose_sop_diff` | Diff diversity check + Adrien manual gate |
| Leadership stops engaging for 2 consecutive months | 60 days | DM James | James opts back in OR sunset decision |

---

## 6. Refinement loop with leadership

Monthly with **James** (lower cadence than other phases):

- "What pattern surfaced this month surprised you?"
- "Did you draft a decision memo this month? Did you ship it?"
- "Are SOP diffs landing — do the teams accept them?"
- "Is `/admin/roi` your monthly CFO artefact yet?"

If James says "I just go back to my own dashboards" — that's the
adoption signal. Refine or sunset.

---

## 7. The end of the road

Phase 6 is the capstone. There is no Phase 7 (yet). The hand-off
criteria are:

- [ ] ELT review packet shipped (1-pager per initiative + master plan) at week 17.
- [ ] Pull-to-push ratio ≥ 1.0 across all 6 phases combined.
- [ ] At least 1 SOP diff approved per phase business owner.
- [ ] `/admin/roi` is James's go-to monthly CFO artefact (not just one of many).

If those land: **renewal conversation is open and defensible**.

---

## 8. Changelog

- *2026-XX-XX:* (placeholder)

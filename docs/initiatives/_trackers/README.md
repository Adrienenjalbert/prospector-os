# Trackers — XLSX + DOCX live status / exec narrative

> Status snapshots, executive narratives, and engineering sprint plans
> live here. The **plans and contracts** that govern them live in the
> markdown docs one level up. See [`../00-tracker-sync.md`](../00-tracker-sync.md)
> for the source-of-truth map.

---

## Files

| File | What it is | Cadence | Owner |
|---|---|---|---|
| `AI_OS_Launch_Tracker.xlsx` | Live RAG snapshot — one row per (phase × week). Updated **Wednesday 14:00** | Weekly | Adrien |
| `AI_OS_Testing_QA_Matrix.xlsx` | QA pass/fail per case. Sheets: `golden-runs`, `audit-phase` | Every soak day + every pilot day | Adrien + QA reviewer |
| `AI_OS_Master_Launch_Strategy.docx` | Executive narrative for ELT — exec register of the master plan | End of each phase (if material change) | Adrien |
| `AI_OS_SLT_Executive_Brief.docx` | Quarterly briefing pack for SLT | Quarterly | Adrien |
| `AI_OS_Engineering_Sprint_Plan.docx` | Engineer-level sprint breakdown — one sprint per build week | Mon W1, W2, W3 of each phase | Adrien |
| `monthly-roi-briefs/` (folder, created on first run) | Auto-exported monthly CFO ROI brief PDFs | Monthly (1st Tuesday) | Adrien + James |

Schemas for the XLSX files live in [`../00-tracker-sync.md`](../00-tracker-sync.md) §"XLSX tracker schemas".

---

## Why these are NOT in markdown

| File | Why XLSX/DOCX is the right format |
|---|---|
| `AI_OS_Launch_Tracker.xlsx` | One-row-per-week tabular updates. Excel filters + sparklines beat markdown tables for weekly snapshots |
| `AI_OS_Testing_QA_Matrix.xlsx` | Hundreds of QA rows × multiple sheets; pivot tables actually used |
| `AI_OS_Master_Launch_Strategy.docx` | Executive narrative — the audience opens Word, not GitHub |
| `AI_OS_SLT_Executive_Brief.docx` | Same — printed/emailed to SLT |
| `AI_OS_Engineering_Sprint_Plan.docx` | Engineering-side detail; pulled into Outlook/Notion by the team |

The **plans** that drive them live in the markdown set:
- Sequence + cadence + gates → [`../00-master-launch-plan.md`](../00-master-launch-plan.md)
- KPIs + SQL → [`../00-north-star-metrics.md`](../00-north-star-metrics.md)
- Blockers + risks → [`../00-blockers-and-decisions.md`](../00-blockers-and-decisions.md)

When a tracker disagrees with the markdown, the markdown wins — see
[`../00-tracker-sync.md`](../00-tracker-sync.md) §"When the tracker
and the markdown disagree".

---

## Excel lock files

If you see a file named `.~lock.<filename>.xlsx#` in this folder, that's
LibreOffice/Excel's open-file lock. It is **never** committed — see
the repo `.gitignore`. If git tries to add one, run:

```bash
git rm --cached '.~lock.*.xlsx#' '.~lock.*.docx#' 2>/dev/null || true
```

# Blockers, decisions, and risk register

> **Status:** Live — updated weekly Wednesday 14:00 by Adrien
> **Companion to:** [`00-master-launch-plan.md`](00-master-launch-plan.md), [`00-audit-phase.md`](00-audit-phase.md)
> **Single source of truth for:** P0/P1/P2 blockers, owner assignments, and "what we decided not to build"
> **Last updated:** 25 April 2026

---

## How to read this doc

> **Markdown is the contract. The XLSX trackers are the snapshot.** This file
> says *what* is blocking, *who owns it*, and *by when*. The
> `AI_OS_Launch_Tracker.xlsx` shows *today's RAG* per blocker.

Severity:

- **P0** — blocks Phase 1 build (start = 12 May 2026). Must be resolved by 9 May
- **P1** — blocks the build week of any later phase. Must be resolved before that phase's W0 Mon
- **P2** — degrades a phase but doesn't block it. Tracked for transparency

When a blocker is resolved, move it to §6 (changelog) with the resolution note.

---

## 1. Active blockers

| # | Severity | Initiative | Blocker | Owner | Decision needed by | Status |
|---|---|---|---|---|---|---|
| B-001 | P0 | Init 6 (Data Concierge) | Tableau MCP server endpoint URL + OAuth client ID for Indeed Flex production | Bill | 5 May (Audit Wk 2 Mon) | Open — Bill to confirm 30 Apr |
| B-002 | P0 | Init 6 | Initial allowlist of 8 Tableau views with PII flag | Tom | 7 May | Open |
| B-003 | P0 | Init 6 | Initial allowlist of 5 ACP metrics with thresholds | Steffi + Matt G | 7 May | Open |
| B-004 | P1 | Init 1 (New Business) | Holdout cohort of 3 AEs identified, matched on tenure + territory | Adrien (with Leonie) | 26 May (W3 −1) | Open — depends on Brett confirming |
| B-005 | P1 | Init 1 + Init 4 + Init 5 | **Transcript vendor decision** (Gong vs Fireflies) + DPIA if needed | Tom | 1 May (Audit Wk 1 Thu) | Open — DPIA may add 2 weeks |
| B-006 | P0 | All initiatives | Backup engineer named for Bill's role (Tableau MCP) during launch | Adrien | 5 May | Open |
| B-007 | P1 | Init 4 (CSM) | Service tickets system identified (Zendesk? Jira? HubSpot?) — required for full theme synthesis | Sarah + Tom | 16 Jul (Init 4 W10 −1) | Open — system unknown; **may force descope** of "service-issue cluster" tool |
| B-008 | P0/P1 | Init 2 (Growth AE) | **Snowflake access** for expansion economics (no named owner) | TBC — escalation needed | 4 Aug (Init 2 W13 −1) | **BLOCKED — likely defers Init 2 to FY26/27 per Phase 0 audit** |
| B-009 | P2 | Init 5 (Leadership) | Decision: do we ship `propose_sop_diff` or only `surface_org_patterns`? Risk: SOP-diff requires human approval pipeline | James | 25 Aug (Init 5 W16 −1) | Open — leaning towards both with human approval |
| B-010 | P1 | All initiatives | `/admin/roi` Phase-tile schema: per-initiative tile design + holdout filter UI | Adrien | 6 May | In progress |
| B-011 | P2 | All initiatives | Slack channel `#os-launch` opened, pilot users + business owners invited | Adrien | 28 Apr (Audit Wk 1 Mon) | Open |
| B-012 | P2 | All initiatives | Holiday calendar — Brett, Tom, Sarah, Leonie unavailable windows logged | Adrien | 5 May | Open |

---

## 2. Data source readiness (audit pillar 2)

Populated during Phase 0 audit; live updated thereafter. RAG decided
by the data audit checklist in [`00-audit-phase.md`](00-audit-phase.md) §3.2.

| Source | Owner | Access | Freshness | Completeness | Status | Blockers | Used by |
|---|---|---|---|---|---|---|---|
| HubSpot / Salesforce | RevOps | MCP + REST | 6h sync | ~95% | ✅ | None | All |
| Tableau (BI views) | Bill | MCP (new) | Daily refresh | ~90% (varies by view) | ⚠️ | B-001 (auth), B-002 (allowlist) | Init 6, 3, 5 |
| Transcripts (Gong/Fireflies) | Tom (vendor TBD) | Webhook + MCP | T+30min after call | TBD | ⚠️ | B-005 (vendor + DPIA) | Init 1, 4, 5 |
| ACP (operational) | Ops (Steffi/Matt G) | API (existing) | Daily | ~85% | ⚠️ | B-003 (metric allowlist) | Init 6, 2 |
| Snowflake (deep analytics) | TBC | None today | TBD | TBD | ❌ | B-008 (no owner, no schema) | Init 2 (would-be), Init 5 (deferred) |
| Service tickets | TBC | None today | TBD | TBD | ❌ | B-007 (system unknown) | Init 4 (descope risk) |
| LinkedIn / Web (research) | n/a (public) | Built-in | Real-time | n/a | ✅ | None | Init 1, 3 |

---

## 3. Decisions taken (immutable)

> Append, never delete. Each decision: date, decision, evidence, signed by.

| Date | Decision | Evidence | Signed |
|---|---|---|---|
| 24 Apr 2026 | Default transcript provider for new tenants is **Fireflies** | [`wiki/pages/decisions/0001-transcript-provider.md`](../../wiki/pages/decisions/0001-transcript-provider.md) | Adrien |
| 24 Apr 2026 | Two-level second-brain pattern (per-tenant `wiki_pages` + dev `wiki/`) | [`wiki/pages/decisions/0002-two-level-second-brain.md`](../../wiki/pages/decisions/0002-two-level-second-brain.md) | Adrien |
| 25 Apr 2026 | Surface count fixed at 4; new initiatives ship as **role overlays + tools**, not new agents | [`docs/prd/08-vision-and-personas.md`](../prd/08-vision-and-personas.md) §6, [`00-master-launch-plan.md`](00-master-launch-plan.md) §2 | Adrien |
| 25 Apr 2026 | Markdown plan in `docs/initiatives/` is **canonical**; HTML roadmaps are advisory only and have been moved to `_archive/` | This doc | Adrien |
| 25 Apr 2026 | Phase 0 (manual audit) is a **non-negotiable gate** before any build phase starts | [`00-audit-phase.md`](00-audit-phase.md) | Adrien |
| 25 Apr 2026 | The single CFO-grade ROI metric across all initiatives is **Influenced ARR** (holdout-filtered); leading indicator is **Pull-to-Push Ratio** | [`00-north-star-metrics.md`](00-north-star-metrics.md) §1 | Adrien |
| 25 Apr 2026 | **No demo data in production analytics**; empty states beat fake numbers | `MISSION.md` operating principle 10 | Adrien |
| 25 Apr 2026 | **No proactive push without holdout suppression check**; `shouldSuppressPush` runs on every push | [`apps/web/src/lib/workflows/holdout.ts`](../../apps/web/src/lib/workflows/holdout.ts) | Adrien |

---

## 4. What we will NOT build (explicit deferrals)

> Listed so the next person to suggest it knows it's been considered and rejected — and can make a fresh case if conditions change.

| Idea | Why we're not building it | When to revisit |
|---|---|---|
| **Forecast confidence scoring** | Inventing probabilities reps will quote to leadership = liability. Cite-or-shut-up principle. | When we have ≥ 12 months of holdout-filtered conversion data per stage |
| **Snowflake direct queries** (Init 2 & 5 deep analytics) | No named owner; schema undocumented; security review missing; Tableau view layer covers ~90% of cases | When Snowflake gets a named data owner + signed-off schema doc |
| **Auto-send outbound email / Slack** | Ownership of "the OS sent the wrong thing" is unsolvable without explicit human click. Every action is staged through `pending_crm_writes` or `[DO]` chip | When LLM hallucination rate on outbound copy is ≤ 0.1% on a 1000-case eval set |
| **Custom Tableau view authoring by reps via the agent** | View governance lives with Tableau team; agent creating views = unmanaged sprawl | Probably never; reps surface the *need*, Tableau team builds the view, allowlist updates |
| **Round-trip Obsidian sync** for per-tenant wiki | Per-tenant export is one-way today; round-trip needs an MCP server or write-API | When a customer asks for it AND the conflict resolution model is designed |
| **Cross-tenant memory sharing** | RLS isolation is mandatory; never share even anonymised insights across tenants without contractual permission | When a contractual "consortium" customer signs |
| **Init 2 (Growth AE Site Roadmap) on the original Phase 5 schedule** | Snowflake + Service-tickets + Ops-data BLOCKED with no owner; Phase 0 audit will likely confirm | Q3 2026 if Snowflake unblocks; otherwise FY26/27 |

Anything not in this list is **fair game to propose** in `#os-launch`.
The "no" list is short on purpose.

---

## 5. Cross-cutting risk register

| # | Risk | Severity | Affected | Mitigation | Owner |
|---|---|---|---|---|---|
| R-1 | Tableau MCP latency P95 > 30s breaks the latency budget | High | Init 6, 3, 5 | 5-min Vercel Runtime Cache; fall back to Redash MCP if persistent | Adrien |
| R-2 | Phase 7 wiki/triggers data too sparse for Init 3 launch (week 6) | Medium | Init 3 | Run `compileWikiPages` + `mineCoworkerTriangles` daily during Init 1 + 2 pilots; check density end of W5 | Adrien |
| R-3 | Brett unavailable during Init 1 pilot | Medium | Init 1 | Backup AE named (B-004 second part); pilot can flex by 1 week | Leonie |
| R-4 | Pilot users feel "watched" by daily telemetry | Medium | All | `/admin/roi` is per-tenant aggregated, not per-rep surveillance; explicit "no per-rep dashboards" disclosure in welcome DMs | Adrien |
| R-5 | ROI claims challenged before holdout has signal (week 4) | High | All | First holdout-filtered number ships at W8 minimum; before that, leading indicators only — clearly labelled | Adrien |
| R-6 | "AI replacing roles" politics inside Indeed Flex | Medium | All | Per Vivun research only 7% of reps fear replacement; explicit messaging "removes admin so reps can sell more"; no dashboard replaces a human role | Adrien |
| R-7 | Phase 7 commits in working tree destabilise Phase 2 launch | Low (now) | Init 1 | Phase 7 already merged on `t3.2-pr` (commit `27d613b`); feature flagged per initiative | Adrien |
| R-8 | Brett's pilot data biases ROI optimism | Medium | Init 1 | Note explicitly in `02-new-business-execution/05-roi-defense.md` §6 that Brett is high-engagement; full rollout numbers may be lower | Adrien |
| R-9 | Initial Tableau view registry too restrictive (false negatives) | Low | Init 6 | Weekly view-registry review with Tom + Bill; expand allowlist as needed; any expansion documented | Tom |
| R-10 | Salesforce/CRM sync lag breaks "real-time" claim | Medium | Init 6, 1, 4 | Cron sync runs every 6h; Slack messaging always says "as of last sync at HH:MM"; never "right now" | Adrien |
| R-11 | Stakeholder signs Phase 0 manual output but doesn't use the live tool | High | All | Pilot launch DM includes "if you stop using it, that's data — say so"; thumbs-down auto-promoted to eval set; kill-switch criteria in each `03-refinement.md` §5 | Adrien + business owner |
| R-12 | LLM cost per rep exceeds budget at scale | Medium | All | Per-rep AI cost surfaced live on `/admin/roi`; cost-discipline cuts already shipped (commit `6fcd40c`); model routing via AI Gateway favours Haiku for retrieval | Adrien |

---

## 6. Resolution changelog (append to top)

> When a blocker resolves, move its row out of §1 and add an entry here.

- *(none yet — first audit week starts 28 Apr)*

---

## 7. Where each row should live

| Type of fact | Where it lives |
|---|---|
| Open blocker (P0/P1/P2) | §1 of this doc |
| Data source readiness | §2 of this doc |
| Decision taken (immutable) | §3 of this doc |
| Decision *not* to build | §4 of this doc |
| Risk (chronic, not blocking) | §5 of this doc |
| Resolved blocker (history) | §6 of this doc (moved from §1) |
| Today's RAG status per phase | `AI_OS_Launch_Tracker.xlsx` (the snapshot) |
| Pass/fail per QA case | `AI_OS_Testing_QA_Matrix.xlsx` |
| Why we're building Phase X | `<phase>/01-scoping.md` |

If you can't decide where a fact goes, default to this doc — it's the
catch-all that gets reviewed every Wednesday.

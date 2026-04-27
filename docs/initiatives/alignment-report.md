# Prospector OS — Docs ↔ Codebase Alignment Report

> **Generated:** 25 April 2026
> **Author:** Adrien (AI build owner) — automated review
> **Source of truth:** `docs/initiatives/` (all 8 cross-cutting files + 6 initiative scoping docs)
> **Codebase reviewed:** `apps/web/`, `packages/core/`, `packages/db/`, `packages/adapters/`

---

## 1. Summary verdict

The codebase is **well-positioned** for the 6-initiative launch plan. Every OS primitive referenced by the docs already exists in code, the architectural constraints (4 fixed surfaces, role overlays via `commonSalesPlaybook`, push-budget capping, holdout infrastructure) are all implemented, and migration 024 has landed the Phase 7 triggers + graph foundation that multiple initiatives depend on.

**No blocking misalignments found.** Three items need attention before Phase 2–5 builds begin (§4 below). Everything in §3 is expected — initiatives haven't started building yet because Phase 0 audit runs 28 Apr → 9 May.

---

## 2. Aligned — exists and matches docs

### 2.1 Agent surfaces (MISSION.md §6: exactly 4, no new surfaces)

| Surface | File | Status |
|---|---|---|
| `pipeline-coach` | `apps/web/src/lib/agent/agents/pipeline-coach.ts` | ✅ Exists |
| `account-strategist` | `apps/web/src/lib/agent/agents/account-strategist.ts` | ✅ Exists |
| `leadership-lens` | `apps/web/src/lib/agent/agents/leadership-lens.ts` | ✅ Exists |
| `onboarding-coach` | `apps/web/src/lib/agent/agents/onboarding.ts` | ✅ Exists |
| `_shared.ts` (role overlay mechanism) | `apps/web/src/lib/agent/agents/_shared.ts` | ✅ Exists |

`commonSalesPlaybook(ctx, { role })` accepts a string `role` parameter — the overlay mechanism all 6 initiatives depend on is in place.

### 2.2 Workflows (all referenced by at least one initiative)

| Workflow | File | Referenced by |
|---|---|---|
| `pre-call-brief.ts` | `apps/web/src/lib/workflows/pre-call-brief.ts` | Phase 2 (extend step 3) |
| `transcript-signals.ts` | `apps/web/src/lib/workflows/transcript-signals.ts` | Phase 4 (churn_risk signals) |
| `holdout.ts` | `apps/web/src/lib/workflows/holdout.ts` | Phase 2+ (shouldSuppressPush) |
| `compile-wiki-pages.ts` | `apps/web/src/lib/workflows/compile-wiki-pages.ts` | Phase 3 (wiki density gate) |
| `compile-bridge-neighbourhoods.ts` | `apps/web/src/lib/workflows/compile-bridge-neighbourhoods.ts` | Phase 3 (stakeholder maps) |
| `mine-coworker-triangles.ts` | `apps/web/src/lib/workflows/mine-coworker-triangles.ts` | Phase 3 (influence ranking) |
| `mine-composite-triggers.ts` | `apps/web/src/lib/workflows/mine-composite-triggers.ts` | Phase 3 (composite triggers) |
| `portfolio-digest.ts` | `apps/web/src/lib/workflows/portfolio-digest.ts` | Phase 4 (enrich with themes) |
| `churn-escalation.ts` | `apps/web/src/lib/workflows/churn-escalation.ts` | Phase 4 (draft escalations) |
| `mine-themes.ts` | `apps/web/src/lib/workflows/mine-themes.ts` | Phase 4 (service theme clusters) |
| `exemplar-miner.ts` | `apps/web/src/lib/workflows/exemplar-miner.ts` | Phase 6 (SOP diffs) |
| `self-improve.ts` | `apps/web/src/lib/workflows/self-improve.ts` | Phase 6 (cluster summaries) |
| `reflect-memories.ts` | `apps/web/src/lib/workflows/reflect-memories.ts` | Phase 6 (pattern mining) |
| `mine-rep-playbook.ts` | `apps/web/src/lib/workflows/mine-rep-playbook.ts` | Phase 6 (per-rep playbook) |

All 14 exist. ✅

### 2.3 Infrastructure primitives

| Primitive | Location | Status |
|---|---|---|
| Citation pipeline | `apps/web/src/lib/agent/citations.ts` | ✅ Exists (needs new extractors per initiative) |
| Tool registry + LRU cache | `apps/web/src/lib/agent/cached-tool-registry.ts` | ✅ Exists |
| ConnectorInterface | `packages/adapters/src/connectors/interface.ts` | ✅ Exists |
| Push-budget (AlertFrequency) | `packages/adapters/src/notifications/push-budget.ts` | ✅ high=3, medium=2, low=1 |
| Slack dispatcher | `packages/adapters/src/notifications/slack-dispatcher.ts` | ✅ Exists |
| Slack adapter | `packages/adapters/src/notifications/slack.ts` | ✅ Exists |
| Holdout cohort (`resolveCohort`, `shouldSuppressPush`) | `apps/web/src/lib/workflows/holdout.ts` | ✅ Exists |
| Scoring engine (8 scorers) | `packages/core/src/scoring/` | ✅ All exist |
| Telemetry | `@prospector/core/telemetry` | ✅ Referenced throughout |

### 2.4 Migration 024 (Phase 7 foundation)

`packages/db/migrations/024_phase7_triggers_and_graph.sql` is the most recent migration and provides the foundation that Phases 3–6 depend on:

- **signals.signal_type CHECK** now includes `churn_risk`, `price_objection`, `champion_missing`, `champion_alumni` (Phase 5 transcript-signals fix) + Phase 7 types (`intent_topic`, `tech_stack_change`, `job_change`, `press_event`, `tradeshow_attendance`) — ✅
- **memory_edges** extended to span `company`, `contact`, `opportunity` endpoints + new edge kinds (`bridges_to`, `coworked_with`, `alumni_of`, `geographic_neighbor`) — ✅
- **wiki_pages.kind** includes `entity_company_neighbourhood` — ✅ (Phase 3 wiki density check depends on this)
- **triggers table** created with pattern enum, components JSONB, lifecycle states, Beta posterior, RLS — ✅

### 2.5 Context slices already aware of initiative roles

The `growth_ae` role string already appears in 29 files across the codebase — context slices like `bridge-opportunities.ts`, `trigger-now.ts`, `stalled-deals.ts`, `rep-playbook.ts`, and `priority-accounts.ts` already reference it. This means the data layer is partially ready for the Phase 5 `growth_ae` overlay even before migration 030 lands.

---

## 3. Not yet built — expected gaps

These items are **correctly absent** — they're part of the initiative build phases that haven't started (Phase 0 audit is 28 Apr → 9 May 2026).

### 3.1 Tool handler directories (17 new tools across 6 initiatives)

| Phase | Directory (docs) | Tools | Status |
|---|---|---|---|
| 1 | `tools/handlers/data-concierge/` | `query_tableau`, `lookup_fulfilment`, `lookup_billing`, `lookup_acp_metric` | ❌ Not created yet |
| 2 | `tools/handlers/new-business/` | `extract_discovery_gaps_v2`, `draft_pitch_deck_outline` | ❌ Not created yet |
| 3 | `tools/handlers/ad-narrative/` | `compose_executive_brief`, `build_stakeholder_map`, `pressure_test_narrative` | ❌ Not created yet |
| 4 | `tools/handlers/csm-guardian/` | `synthesise_service_themes`, `draft_account_improvement_plan` | ❌ Not created yet |
| 5 | `tools/handlers/growth-ae/` | `build_site_ramp_plan`, `pressure_test_margin`, `draft_qbr_deck_outline` | ❌ Not created yet |
| 6 | `tools/handlers/leadership/` | `surface_org_patterns`, `draft_decision_memo`, `propose_sop_diff` | ❌ Not created yet |

### 3.2 Connectors

| Connector | Directory (docs) | Status |
|---|---|---|
| Tableau MCP | `packages/adapters/src/tableau-mcp/` | ❌ Not created yet |
| Redash MCP (optional fallback) | `packages/adapters/src/redash-mcp/` | ❌ Not created yet |
| ACP read-only (Phase 5, optional) | `packages/adapters/src/acp-readonly/` | ❌ Not created yet |

### 3.3 Migrations 025–031

| Migration | Initiative | What it does | Status |
|---|---|---|---|
| 025 | Phase 1 | `tableau_views_registry`, `acp_metric_registry`, tenant credentials | ❌ Not created |
| 026 | Phase 1 | 4 `tool_registry` rows | ❌ Not created |
| 027 | Phase 2 | 2 `tool_registry` rows, `rep_profiles.in_holdout`, `funnel_benchmarks.cohort_label` | ❌ Not created |
| 028 | Phase 3 | 3 `tool_registry` rows, add `ad` to role enum | ❌ Not created |
| 029 | Phase 4 | 2 `tool_registry` rows, add `csm` to role enum | ❌ Not created |
| 030 | Phase 5 | 3 `tool_registry` rows, `growth_ae` role, `site_readiness` table | ❌ Not created |
| 031 | Phase 6 | 3 `tool_registry` rows (no new tables) | ❌ Not created |

### 3.4 Other planned items not yet built

- `mine-site-readiness.ts` workflow (Phase 5)
- ~17 new citation extractors across all phases
- `rep_profiles.in_holdout` column (Phase 2, migration 027)
- `site_readiness` table (Phase 5, migration 030)
- `funnel_benchmarks.cohort_label` column (Phase 2, migration 027)

---

## 4. Misalignments requiring attention

### 4.1 ⚠️ `account-strategist.ts` hardcodes `role: 'ae'`

**What the docs say:** Phases 3, 4, and 5 extend the account-strategist surface with role overlays (`ad`, `csm`, `growth_ae`) via `commonSalesPlaybook(ctx, { role })`.

**What the code does:** `account-strategist.ts` currently hardcodes:
```typescript
dynamicParts.push(commonSalesPlaybook(ctx, { role: 'ae' }))
```

**Impact:** The overlay mechanism (`_shared.ts`) is ready, but the surface itself doesn't read the user's actual role from their profile. When Phases 3–5 ship, this line needs to become dynamic — something like:
```typescript
dynamicParts.push(commonSalesPlaybook(ctx, { role: ctx.user?.role ?? 'ae' }))
```

**Severity:** Medium. Must be fixed before Phase 3 ships (week 6). Not blocking Phase 0 or Phase 1.

**Recommendation:** Add this to Phase 3's definition of done as a prerequisite task.

### 4.2 ⚠️ Role enum location discrepancy

**What the docs say:** Migrations 028, 029, 030 will "add `ad` / `csm` / `growth_ae` to role enum."

**What the code has:**
- `user_profiles` has a CHECK constraint (migration 009) that **already includes `csm` and `ad`**:
  ```sql
  CHECK (role IS NULL OR role IN ('rep', 'manager', 'admin', 'revops', 'csm', 'ad'))
  ```
- `rep_profiles.role` is `VARCHAR(50) DEFAULT 'ae'` with **no CHECK constraint at all** (migration 001).
- `growth_ae` does not exist in any CHECK constraint anywhere.

**Impact:** The docs describe adding roles to "the role enum" but there are two separate role columns on two different tables with different constraint setups. Migrations 028–029 may be partially redundant for `user_profiles` (already has `csm`/`ad`) but still needed if the intent is to also constrain `rep_profiles`.

**Severity:** Low-medium. The code will work because `rep_profiles.role` accepts any string — but the lack of a CHECK constraint means typos like `'csm '` or `'CSM'` would silently land.

**Recommendation:** When writing migrations 028–030:
1. Confirm which table(s) need the role enum update (`user_profiles`, `rep_profiles`, or both)
2. Add a CHECK constraint to `rep_profiles.role` matching the documented role set
3. Note that `csm` and `ad` already exist in the `user_profiles` CHECK — migrations should be idempotent (`DROP CONSTRAINT IF EXISTS` + re-add)

### 4.3 ⚠️ `in_holdout` column not in codebase

**What the docs say:** `holdout.ts` references `rep_profiles.in_holdout` as a boolean column (Phase 2, migration 027). The holdout design in `00-north-star-metrics.md` and multiple scoping docs depends on it.

**What the code has:** `holdout.ts` exists with `resolveCohort` and `shouldSuppressPush`, but uses a `stableHash`-based deterministic assignment — there is NO `in_holdout` column on `rep_profiles` in any existing migration.

**Impact:** The current holdout logic works via hash, not a persisted column. The docs describe migration 027 adding `rep_profiles.in_holdout` — this is either: (a) an additional persistent flag alongside the hash (for admin override), or (b) a replacement for the hash logic.

**Severity:** Low. This is expected to arrive with migration 027 (Phase 2). Just ensure the migration 027 design clarifies the relationship between the existing `stableHash` logic and the new `in_holdout` column.

**Recommendation:** When writing migration 027, document whether `in_holdout` overrides or supplements the hash-based cohort assignment.

---

## 5. File path accuracy check

Every tool handler path, workflow path, adapter path, and migration path referenced in the 6 scoping docs follows the actual codebase directory structure. Specifically:

| Path pattern in docs | Actual directory | Match? |
|---|---|---|
| `apps/web/src/lib/agent/agents/` | Exists with all 4 surfaces + `_shared.ts` | ✅ |
| `apps/web/src/lib/agent/tools/handlers/` | Exists (currently 8 handlers, no subdirs) | ✅ |
| `apps/web/src/lib/agent/citations.ts` | Exists | ✅ |
| `apps/web/src/lib/workflows/` | Exists with all 14 referenced workflows | ✅ |
| `packages/core/src/scoring/` | Exists with all referenced scorers | ✅ |
| `packages/adapters/src/connectors/` | Exists (only `interface.ts`) | ✅ |
| `packages/adapters/src/notifications/` | Exists with all referenced files | ✅ |
| `packages/db/migrations/` | Exists (001–024) | ✅ |

All planned subdirectories (e.g. `tools/handlers/data-concierge/`, `adapters/src/tableau-mcp/`) follow the established naming conventions and will slot cleanly into the existing structure.

---

## 6. Cross-cutting doc consistency

The 8 cross-cutting docs are internally consistent:

- **Master launch plan** tool count (~12 tools, plus ~5 tier-1 chat-only) matches the sum across the 6 scoping docs (4+2+3+2+3+3 = 17 tier-2 tools; the difference is the tier-1 tools that don't need new handler files).
- **Rollout calendar** dates are consistent with scoping doc phase numbers and week ranges.
- **North-star metrics** SQL references the same table/column names that migration 024 and the existing schema provide.
- **Dependency matrix** correctly maps which initiatives depend on which OS primitives.
- **Blockers** document (B-005 transcript vendor, B-007 service tickets, B-008 Snowflake/ops data for Phase 5) is referenced from the correct scoping docs.

---

## 7. Recommendations for Phase 0 audit week

1. **Parameterise `account-strategist.ts` role selection** — add to Phase 3 prerequisites or do it during Phase 0 as infrastructure prep.

2. **Add CHECK constraint to `rep_profiles.role`** — include in migration 027 (Phase 2) when you're already touching `rep_profiles` for `in_holdout`. Align the allowed values with the `user_profiles` CHECK plus the new roles.

3. **Document `in_holdout` vs `stableHash` relationship** — when designing migration 027, clarify whether the column is an admin override or a replacement for the hash logic.

4. **Scaffold empty tool handler directories early** — consider creating the 6 subdirectories under `tools/handlers/` during Phase 0 with placeholder `index.ts` files. This lets each phase's PR focus on tool logic rather than directory setup.

5. **Run the wiki density SQL check** (Phase 3, §6 in the scoping doc) during Phase 0 to get an early read on whether Tier-1 accounts have ≥ 5 wiki pages each. If they don't, you have 5 weeks to close the gap before Phase 3 ships.

---

## 8. Conclusion

The docs and codebase are **well-aligned**. The initiative plans are buildable on top of the existing architecture with no structural changes needed — only additive work (new tools, new migrations, new citation extractors, 1 new connector). The three items in §4 are small fixes, not design problems. The OS is ready for Phase 0.

# Phase 3 — AD Strategic Narrative — Scoping

> **Original brief:** Initiative 3 — Account Director Strategic Narrative
> **Folder rank:** 03 (ships third — excitement)
> **Status:** Excitement; ships in weeks 6–9
> **Business owner:** Tom
> **AI build owner:** Adrien + Olga
> **Pilot users:** 2 ADs (Tier-1 accounts, Tom names at T-7)
> **Adoption target:** 2 narrative pressure-tests/week per AD; QBR prep time drops from ~3h → ~30 min

---

## 0. Executive summary (read this in 30 seconds)

> Executive-grade narrative composition for Account Directors on Tier-1
> accounts. Compose 1-page exec briefs, build stakeholder maps from the
> bridge graph, pressure-test narratives via "agent plays the CRO".
> QBR prep time drops from ~3h → ~30 min per Tier-1 account.
> **Time-freed equivalent: ~£40k/year** across 8 ADs (8 × 2.5h × monthly × £75/hr).
> **The bigger upside:** Tier-1 renewal-rate uplift on cohort vs holdout
> ≥ 3 pts — direct contribution to Influenced ARR via the largest deal
> sizes in the portfolio.
> **Defensible ROI gate (Day 90):** ≥ 2 narrative pressure-tests/week
> per AD AND Influenced ARR contribution ≥ £50k cumulative.

## 0.1 Phase 0 audit gate (must clear before build starts)

Per [`../00-audit-phase.md`](../00-audit-phase.md), Phase 3 build
**only starts** once these audit-outputs are signed AND Phase 7 wiki
density on Tier-1 accounts is ≥ 5 pages per account:

| Output ID | What | Stakeholder | Signed by |
|---|---|---|---|
| O-1 | 1 manual C-suite briefing note for one Tier-1 account (headline outcomes, ROI framing, stakeholder map, renewal narrative) | Tom | 9 May |
| O-2 | Reusable strategic-review narrative template (markdown) | Tom | 9 May |
| O-3 | QBR prep-time baseline (stopwatch on Tom's current process) | Tom | 9 May |

These outputs land in `audit-outputs/O-1.md` … `audit-outputs/O-3.md`
and become **eval golden fixtures** (AD-001 → AD-003 are seeded from O-1).

## 0.2 ROI contribution (cross-cutting)

| Metric | Target | How this phase contributes |
|---|---|---|
| **Influenced ARR** (cross-cutting cumulative) | ≥ £25k by W9; ≥ £75k by W12 | Tier-1 renewal uplift × largest deal sizes in portfolio |
| **Tier-1 renewal-rate uplift** | ≥ 3 pts vs holdout | Better narratives → better exec engagement → renewal lock |
| **Time-freed (£/year)** | ~£40k | 8 ADs × 2.5h × monthly × £75/hr |
| **Pull-to-Push Ratio** (cohort gate) | ≥ 0.5 by W9 | ADs ask for pressure-tests vs receiving prompts |
| **Pressure-tests per AD per week** | ≥ 2 | Adoption gate |

Full SQL in [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §4 (Phase 3).

---

## 1. Desired outcome

Equip Account Directors (ADs) with executive-grade narrative composition
on demand:

1. **Compose executive briefs** — 1-page narratives for QBR /
   exec-review prep, citing wiki + triggers + bridge graph.
2. **Build stakeholder maps** — political map with influence ranks
   from contacts + memory_edges (`coworked_with`, `reports_to`).
3. **Pressure-test the narrative** — agent plays the CRO and returns
   ≤ 3 challenge questions the AD must be able to answer.

The headline AD promise:

> **You walk into the QBR knowing what your CRO will ask, who at the
> account holds the keys, and what the cited evidence trail looks like.
> The OS does the prep; you do the conversation.**

**Success metric (leading):** 2 narrative pressure-tests/week per AD
during pilot week 4.

**Success metric (lagging):** C-suite review prep time drops from ~3h
to ~30 min (baseline-survey + post-90 self-report).

**Definition of done:** 2 ADs run narrative pressure-tests on at least
4 distinct Tier-1 accounts each over a 4-week pilot window, with
qualitative sign-off "I would not go back."

---

## 2. How this composes existing OS primitives

| Concern | Reuses | New code required |
|---|---|---|
| Account-strategist surface | [`apps/web/src/lib/agent/agents/account-strategist.ts`](../../../apps/web/src/lib/agent/agents/account-strategist.ts) — the existing surface | **Extend** with `ad` role overlay via `commonSalesPlaybook(ctx, { role: 'ad' })` |
| Wiki layer (entity neighbourhoods) | [`apps/web/src/lib/workflows/compile-wiki-pages.ts`](../../../apps/web/src/lib/workflows/compile-wiki-pages.ts) | None — must run nightly with ≥ 5 wiki pages per Tier-1 account before launch |
| Bridge graph (company-to-company connections) | [`apps/web/src/lib/workflows/compile-bridge-neighbourhoods.ts`](../../../apps/web/src/lib/workflows/compile-bridge-neighbourhoods.ts) | None |
| Coworker triangles (stakeholder influence) | [`apps/web/src/lib/workflows/mine-coworker-triangles.ts`](../../../apps/web/src/lib/workflows/mine-coworker-triangles.ts) | None |
| Composite triggers (account-level signals) | [`apps/web/src/lib/workflows/mine-composite-triggers.ts`](../../../apps/web/src/lib/workflows/mine-composite-triggers.ts) | None |
| Citation pipeline | [`apps/web/src/lib/agent/citations.ts`](../../../apps/web/src/lib/agent/citations.ts) | Add 3 new extractors |
| Slack delivery (chat sidebar parity) | [`packages/adapters/src/notifications/slack.ts`](../../../packages/adapters/src/notifications/slack.ts) | None |
| Telemetry | `@prospector/core/telemetry` | None |
| **NEW: 3 tools** | — | Files in `apps/web/src/lib/agent/tools/handlers/ad-narrative/` |
| **NEW: `ad` role added to enum** | — | Migration 028 |

**Surface preset impact:** None (per `MISSION.md` §6 — surface count
fixed at four). The `account-strategist` surface gains a new role
overlay (`ad`) that selects an executive-register playbook variant.

**Connector impact:** None.

---

## 3. The AD Narrative surfaces (what the AD sees)

### Surface A — Executive brief (chat sidebar)

When AD asks: *"Compose Q4 executive brief for Acme."*

```
Q4 executive brief — Acme — drafted in chat

Strategic position
Acme is moving from regional to multi-site coverage in EMEA. They've
been a Stored customer for 3 years. ARR is £820k (up 12% YoY).

3 things that matter this quarter
1. They're consolidating 4 vendors → 2 by Q1 — we're the incumbent.
2. New COO (Mark Rey, ex-Workday, started in Aug) is unsigned.
3. Bridge: their CFO sat on a panel with our former CRO at SaaStr.
   Warm intro path is open via {coworker name from triangles}.

Risks for the renewal conversation
- Pricing pressure — they referenced our price 3 times in last QBR
- Contract scope — they want SLAs in writing, currently not in MSA

Cited: wiki#w12 (neighbourhood), trigger#t9 (composite),
bridge#b3 (CFO-CRO panel), transcript#t44 (pricing mentions)

## Next Steps
- [ASK] Build the stakeholder map for Acme
- [DRAFT] Pressure-test this brief
- [DO] Schedule prep call with Mark Rey
```

Constraints:
- **Executive register** — no jargon; each section 2–3 sentences
- **3 cited URNs minimum**, each from a distinct source (wiki / trigger / bridge / transcript)
- **≤ 250 words** total (longer than rep-level briefs because audience is exec)
- **3 Next-Step buttons max**

### Surface B — Stakeholder map (chat sidebar)

When AD asks: *"Build the stakeholder map for Acme."*

```
Stakeholder map — Acme — 5 key people

🟢 Mark Rey — COO (joined Aug 2025) — UNSIGNED
   • Influence: high (decision authority on vendor consolidation)
   • Coworker triangle: also worked with our former CRO at Workday
   • Last touch: none — gap to close
   
🟡 Sarah Chen — VP Operations — CHAMPION
   • Influence: medium (sets direction; reports to Mark)
   • Last call: 12 Apr (transcript#t44) — pricing flagged
   • Action: keep close
   
🟡 Marcus Bell — CFO — DECISION MAKER
   • Influence: high (signs contracts)
   • Bridge: SaaStr panel with our former CRO (bridge#b3)
   • Action: warm-intro via {coworker name}
   
⚪ 2 more contacts (lower influence)

Cited: contact#c12, contact#c44, contact#c91, bridge#b3, memory#m17

## Next Steps
- [DRAFT] Email Mark with the COO-onboard angle
- [ASK] Who else in our company knows someone at Acme?
- [DO] Add Mark to QBR invite list
```

### Surface C — Pressure-test (chat sidebar)

When AD asks: *"Pressure-test the Q4 brief for Acme."*

```
Pressure-test — Q4 Acme brief

I played CRO. Here are the 3 questions you should be ready for:

1. **"What if Mark Rey's first 90 days favour the other vendor?"**
   Your brief says we're the incumbent. The composite trigger
   (trigger#t9) shows Mark publicly favoured the competing platform
   at his last firm. How do you address that in the renewal pitch?

2. **"Why is the SLA gap still open after 3 years?"**
   Transcript#t44 has Sarah flagging this twice in 12 months.
   What's our position in writing today? Can we close it before
   the QBR?

3. **"What's the path if Acme decides to insource the function?"**
   Bridge#b3 shows Marcus Bell discussed insourcing publicly at
   SaaStr. What's our defence?

Cited: trigger#t9, transcript#t44, bridge#b3

## Next Steps
- [ASK] Help me draft a response to Question 1
- [DRAFT] Update brief with SLA position
- [DO] Schedule prep with Sales Leadership before QBR
```

The pressure-test is the **highest-value** surface — it forces the AD
to walk in with answers, not surprises.

---

## 4. Tools to ship (Tier 2, fully harnessed)

### 4.1 `compose_executive_brief`

- **Input:** `account_name`, `time_horizon` enum (`'q1'|'q2'|'q3'|'q4'|'next_renewal'`)
- **Output:** structured 1-page narrative + ≥ 5 distinct URN citations
- **File:** `apps/web/src/lib/agent/tools/handlers/ad-narrative/compose-executive-brief.ts`
- **Available to roles:** `ad`, `manager`, `revops`, `leader`

### 4.2 `build_stakeholder_map`

- **Input:** `account_name`, `min_influence` enum (`'low'|'medium'|'high'`)
- **Output:** ranked array of `{ contact, role, influence_band, recent_touch, coworker_triangles, bridges, suggested_next_action }`
- **File:** `apps/web/src/lib/agent/tools/handlers/ad-narrative/build-stakeholder-map.ts`
- **Available to roles:** `ad`, `ae`, `csm`, `manager`

### 4.3 `pressure_test_narrative`

- **Input:** `account_name`, optional `brief_id` (URN of a previously composed brief)
- **Output:** array of `{ question, evidence_urn, rationale }` — exactly 3 questions
- **File:** `apps/web/src/lib/agent/tools/handlers/ad-narrative/pressure-test-narrative.ts`
- **Available to roles:** `ad`, `manager`, `leader`

---

## 5. Migrations

- **Migration 028 — `028_ad_narrative_tools.sql`**
  - 3 rows in `tool_registry` (idempotent)
  - Add `ad` to the role enum (if not already present in `rep_profiles.role` constraint)
  - No new tables

---

## 6. Phase 7 wiki density prerequisite

Phase 3 only ships if the wiki layer has populated to a usable density.
Specifically:

- ≥ 5 wiki pages per Tier-1 account (entity_company_neighbourhood
  pages) — checked via:

```sql
SELECT
  c.name AS account,
  COUNT(w.id) AS wiki_pages
FROM companies c
LEFT JOIN wiki_pages w
  ON w.tenant_id = c.tenant_id
  AND w.kind = 'entity_company_neighbourhood'
  AND w.refs ?| ARRAY[c.id::text]
WHERE c.tenant_id = $tenant
  AND c.icp_tier = 'A'
GROUP BY c.name
HAVING COUNT(w.id) < 5;
```

Tom verifies this on Friday of week 5 (end of Phase 2). If any
Tier-1 account has < 5 pages, Phase 3 build slips by 1 week and
mining cron runs every 6h instead of nightly to catch up.

---

## 7. Definition of done

- [ ] 3 tools merged with eval golden cases passing in CI (`AD-001` to `AD-012`)
- [ ] Migration 028 applied in production
- [ ] Citation extractors added for all 3 tools
- [ ] `ad` role overlay added to `commonSalesPlaybook` selector
- [ ] Wiki density check green for all Tier-1 accounts (≥ 5 pages each)
- [ ] 2 pilot ADs identified by Tom; both have completed the 1-page training
- [ ] Both ADs run ≥ 1 pressure-test in production Slack/chat during week 1 of pilot
- [ ] Pull-to-push ratio ≥ 0.5 across all live phases by week 9
- [ ] No open kill-switch triggers per [`03-refinement.md`](03-refinement.md) §5

---

## 8. Out of scope (PHASE 3)

- **Daily proactive push.** ADs do NOT receive daily Slack DMs from
  this initiative. Push budget conserved for Phase 1 (data lookups)
  and Phase 2 (AI Brief). Narratives are pull-only — AD invokes via
  chat sidebar or `/os narrative <account>` slash command.
- **Auto-send to executive recipients.** Briefs are draft outputs; the
  AD edits and shares.
- **Renewal probability scoring.** Per `MISSION.md` "no AI-generated
  forecast confidence scores." If asked, agent refuses; offers
  `[ASK] What signals would help us judge?` instead.
- **Cross-tenant data leakage.** Tested in `02-test-plan.md` §5; RLS
  enforces.

---

## 9. Open questions to resolve before build

| # | Question | Owner | Resolution by |
|---|---|---|---|
| 1 | Which 2 ADs form the pilot? Which Tier-1 accounts? | Tom | T-7 |
| 2 | Executive register — sample brief from Tom; we mimic the tone | Tom | T-5 |
| 3 | "Tier-1 account" definition — is `icp_tier = 'A'` enough? | Tom + Adrien | T-5 |
| 4 | Are there accounts where the OS is forbidden to surface bridges (NDAs / sensitive)? | Tom | T-3 |
| 5 | Backup AD in case one is unavailable | Tom | T-3 |

---

## 10. Risks specific to this phase

| Risk | Mitigation |
|---|---|
| Wiki / bridge density too thin → narratives feel generic | Pre-launch density check (§6); slip launch by 1 week if needed |
| Executive register lands wrong (too casual / too jargon-heavy) | Calibrate prompt over 2–3 weeks; Tom signs off on register before pilot |
| AD pushed back: "I already do this in my head" | Show time-saved; offer pressure-test as standalone value (3 questions in 30 sec they hadn't thought of) |
| Cross-tenant data leak via citation pill | RLS + golden case AD-009 (negative); blocks merge if regression |
| Forecast invention | Golden case AD-010 (negative); refuse + offer alternative |
| Pressure-test is "too challenging" — AD feels attacked | Tone calibration: questions are framed as "your CRO will ask"; never "you're wrong about" |
| Tom gets pulled into another fire and refinement cadence drops | Identify backup business owner; bi-weekly review is mandatory |

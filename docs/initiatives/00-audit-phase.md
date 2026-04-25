# Phase 0 — Manual Audit (the gate before any build)

> **Status:** Active — single source of truth for the 2-week audit
> **Window:** 28 April → 9 May 2026 (10 working days)
> **Owner:** Adrien (driver) + Olga (shadow)
> **Hard gate:** Build for Phase 1 starts **12 May 2026** if and only if Phase 0 §6 Go/No-Go criteria pass
> **Reads with:** [`README.md`](README.md), [`00-master-launch-plan.md`](00-master-launch-plan.md), [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md)

---

## 1. Why this phase exists

> **If you can't do the work manually in 30 minutes, you can't spec it for automation.**

Every AI workflow we build must be modelled on a human process we have
*already* validated. The 2-week audit answers three questions before
we write a single line of automation:

| Pillar | Question | Pass looks like |
|---|---|---|
| **Process** | What actually happens today? | A step-by-step map of the as-is workflow — systems opened, data pulled, document produced, time spent, hand-offs, edge cases |
| **Data** | What data exists, can we access it, is it trustworthy? | Per-source ✅/⚠️/❌ on existence, API access, freshness, completeness, owner, governance |
| **Outcome** | Can we create useful output by hand? | ≥ 3 real artefacts per initiative — produced manually, tested with the actual stakeholder, signed by the stakeholder |

A failure on any of the three pillars **defers** the build for that
initiative. Phase 0 isn't a vibe check; it's the gate.

---

## 2. The anti-patterns Phase 0 prevents

| Anti-pattern | Cost without audit | Cost with audit |
|---|---|---|
| "Beautiful output nobody asked for" | 4 weeks of build, 0 adoption | 30 min shadowing, output discarded, build saved |
| "Data exists but is 60% missing" | Tool ships, half its answers say "I don't know", trust collapses | Found in the data audit, source either fixed or initiative deferred |
| "Stakeholder agrees in the meeting, ignores in production" | Pilot DOA, 6-week recovery | Signed manual artefact catches it |
| "We'll figure out the connector during the build" | Mid-sprint blocker, dependency hell | Connector is named, owned, latency-tested, or replaced before code starts |
| "Forecast confidence scoring would be cool" | Liability — we invent numbers | Audit kills the idea: data doesn't exist, owner doesn't sign, build never starts |

The audit phase is the **cheapest** insurance the OS rollout buys.

---

## 3. The three pillars in detail

### 3.1 Process audit

For each initiative, document the current human workflow end-to-end.

| What to capture | How to capture it |
|---|---|
| **Trigger** — what starts this workflow? (new lead, call ended, QBR scheduled, churn signal, etc.) | Shadow real users doing real work. Don't ask them to describe it — *watch* them. People skip steps they've automated in their heads |
| **Steps** — what systems are opened, what data is pulled, what document is produced | Screen-share, take screenshots, log every click |
| **Time** — how long does each step take? | Stopwatch. Round to nearest minute |
| **People** — who is involved, who hands off to whom | Roles, not names (so the doc generalises) |
| **Exceptions** — what happens when the standard process breaks | Probe with "what about when X?" |
| **Output** — final deliverable, recipient, format | Save the actual output as a fixture |

**Output of process pillar:** one `process-map-<init>.md` per initiative
in this folder, ≤ 1 page each.

### 3.2 Data audit

For each initiative, verify that the data the AI would need actually
exists, is accessible, and is trustworthy.

| Question | Why it matters |
|---|---|
| Does the data exist? | Sometimes the field exists but is never populated |
| Can we access it programmatically (MCP / API / SQL)? | Dashboard access ≠ API access |
| How fresh is the data (real-time / daily / weekly)? | Each freshness band has implications for what the agent can promise |
| What's the completeness rate? | If 40% of records miss key fields, AI output is unreliable |
| Who owns this data source? | No owner = no one to fix issues when they arise |
| Are there access / permission / governance blockers (DPIA, IT, legal)? | These take weeks to clear |

**Output of data pillar:** rows in [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md)
§2 (Data sources) for every connector each initiative depends on.

### 3.3 Outcome validation

For each initiative, **manually create the exact output the AI would
produce**, using real data, for a real stakeholder, and collect real
feedback.

| Criterion | What "pass" looks like |
|---|---|
| **Usefulness** | Stakeholder would use this output in their workflow without significant changes |
| **Accuracy** | Data points are correct and current; no misleading information |
| **Timeliness** | Output can be produced fast enough to be useful (pre-call, pre-QBR, before QBR signoff) |
| **Format** | Slack / doc / deck — matches how the stakeholder actually consumes information |
| **Repeatability** | The process can be described clearly enough that automation has a target |

The stakeholder signs a 1-paragraph statement (template in §7) on
each output. **No signature, no automation.**

**Output of outcome pillar:** the 3 manual artefacts per initiative,
saved into `docs/initiatives/<n>-<slug>/audit-outputs/` (created during
Phase 0, archived for posterity).

---

## 4. Per-initiative audit targets (10 working days)

| Initiative | Process audit (shadow) | Data audit (sources) | Outcome validation (3 manual outputs) |
|---|---|---|---|
| **Init 6 — Data Concierge** | Shadow 1 AD + 1 CSM doing weekly account-health checks. Time the "15 min hunt" claim | Tableau (Bill), HubSpot/SF (RevOps), Snowflake (TBC), ACP (Ops) | Manually answer 5 real natural-language data questions; 3 sample Slack account-health summaries |
| **Init 1 — New Business Execution** | Shadow 2–3 discovery calls of Brett's. Map the "30-min pre-call hunt" | HubSpot/SF (RevOps), transcripts (Tom — vendor decision pending) | Manually create 3 pre-call briefs for real upcoming meetings; analyse 1 real transcript end-to-end |
| **Init 3 — AD Strategic Narrative** | Map how Tom prepares for one Tier-1 QBR. Capture "raw → insight → narrative" | HubSpot/SF, Tableau, transcripts, neighbourhood/bridge data (Phase 7 wiki) | Manually create 1 C-suite briefing note for one Tier-1 account; draft a reusable narrative template |
| **Init 4 — CSM Retention Guardian** | Shadow Sarah doing 1 weekly portfolio review + 1 churn escalation | HubSpot/SF, transcripts (BLOCKED until Tom decides), service tickets (system unknown) | Manually surface 3 churn-risk accounts with cited rationale; manually draft 1 escalation email |
| **Init 5 — Leadership Synthesis** | Shadow James preparing 1 monthly synthesis | HubSpot/SF, Tableau, transcripts (BLOCKED), exemplars/reflective memories (already in OS) | Manually compile 1 monthly objection-pattern digest; 1 win-pattern digest |
| **Init 2 — Growth AE Site Roadmap** | Shadow 1 expansion deal cycle (proposal → close) | Snowflake (BLOCKED — no owner), ops capacity data (BLOCKED), HubSpot/SF | Manually build 1 site-ramp plan; 1 margin pressure-test |

Init 2 will likely fail the data pillar — the audit will surface that.
**That's a successful audit**, not a failure: it tells us to defer
Init 2 and reallocate the slot.

---

## 5. The 10-day calendar

### Week 1 (28 Apr → 2 May) — Discover & Map

| Day | Date | Focus |
|---|---|---|
| Mon | 28 Apr | Audit kickoff. Init 6 + Init 1 process maps started in parallel. Tableau + HubSpot data inventory begins |
| Tue | 29 Apr | Shadow Brett pre-call prep (Init 1). AD + CSM process interviews scheduled (Init 3 + Init 4) |
| Wed | 30 Apr | Tableau MCP audit with Bill. Snowflake access check. HubSpot/SF field map for account context. Init 5 process mapping with James |
| Thu | 1 May | Transcript decision (Tom): vendor, access level, format. Collect first batch of real call transcripts. Init 2 process mapping starts |
| Fri | 2 May | **Week-1 checkpoint.** All process maps drafted. Data audit identifies ✅/⚠️/❌ per source. Blockers flagged for week 2 |

### Week 2 (5 May → 9 May) — Build & Test Outputs

| Day | Date | Focus |
|---|---|---|
| Mon | 5 May | Manual outputs begin. Init 6: answer 5 data questions. Init 1: create 3 pre-call briefs |
| Tue | 6 May | Init 3: C-suite briefing note. Init 4: account health risk summaries. Init 2: expansion roadmap |
| Wed | 7 May | **Stakeholder feedback.** Test Init 1 briefs with Brett. Test Init 4 summaries with Sarah. Test Init 6 with Tom + Leonie |
| Thu | 8 May | Init 5 pipeline-synthesis memo (test with James). Compile readiness scorecard. Draft Go/No-Go |
| Fri | 9 May | **Audit complete.** Go/No-Go presented to James + Tom. Build sequence confirmed. Reusable templates documented. Hand off to Phase 1 build planning |

---

## 6. Go/No-Go criteria (the gate)

Phase 1 build starts **12 May** if and only if **all four** criteria
below hold for Init 6 (the foundation). Other initiatives can start
on schedule even if their own gates need partial deferral.

| # | Criterion | Pass looks like |
|---|---|---|
| 1 | **Process map signed** | Tom + Leonie + Bill sign-off that the process map is complete and accurate |
| 2 | **Data sources green** | At least Tableau + HubSpot are ✅; Snowflake can be ⚠️ (deferred features only) |
| 3 | **Manual outputs validated** | All 3 Init 6 outputs (5 data Qs, 3 Slack summaries, time benchmark) signed by Tom + Leonie |
| 4 | **No P0 blocker open** | Anything in [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md) §1 (P0) is resolved or has a named owner + ETA before 12 May |

For each downstream initiative (1, 3, 4, 5, 2), the gate is repeated
**before its own build week starts** and the result is logged in the
[`AI_OS_Launch_Tracker.xlsx`](_trackers/) row for that phase.

### What "fail" looks like (and what we do)

| Failure mode | Action |
|---|---|
| Tableau MCP unauthenticated by 9 May | Phase 1 build slips by the duration of the auth resolution (in days) |
| Stakeholder won't sign the manual output | The initiative is **redesigned** with the stakeholder, not deferred. We're solving the wrong problem |
| Data source is 60%+ incomplete | The initiative is **descoped** to what's covered by the complete fields. New scope re-validated before build |
| All 3 manual outputs land but no time saved vs current process | The initiative is **killed**. Adoption ≠ value |
| Init 2 (Growth AE) data is BLOCKED with no path | Init 2 is **deferred** to FY26/27. Phase 5 slot reallocated to a refinement sprint or a new initiative |

---

## 7. Templates

### 7.1 Process map template (`process-map-<init>.md`)

```markdown
# Process map: <initiative name>

**Shadowed:** <person>, <date>
**Trigger:** <what starts this workflow>
**Frequency:** <daily / weekly / per-deal>

## Steps

1. <action> — <system> — <data pulled> — <minutes>
2. ...

## Hand-offs

| From | To | What | When |

## Edge cases

- <case>: <how it's handled>

## Output

- <deliverable> → <recipient> in <format>

## Pain points (verbatim from shadowee)

- "<quote>"

## Time per cycle

<n> minutes (median across <m> observations)
```

### 7.2 Data audit row template (`00-blockers-and-decisions.md` §2)

```
| Source | Owner | Access (MCP/API/none) | Freshness | Completeness | Status (✅/⚠️/❌) | Blockers | ETA |
```

### 7.3 Stakeholder sign-off template

```
I confirm that the manual output dated <date> for initiative <n> is:
- [ ] Useful — I would consume this in my workflow
- [ ] Accurate — the numbers reconcile to source
- [ ] Timely enough — it can be produced when I need it
- [ ] In a format I can act on
- [ ] Repeatable — the process is clear enough to automate

What I would change for v1: ___________________

Signed: _________ Date: _________
```

Saved into the initiative's `audit-outputs/` folder; one file per
output × stakeholder.

---

## 8. Reporting cadence (during Phase 0)

The audit is itself a project. Three rituals keep it honest:

| When | Cadence | Owner | Surface |
|---|---|---|---|
| Daily 09:30 (audit days) | 10-min standup — what shadowed yesterday, what shadowing today, what blocked | Adrien | `#os-audit` Slack |
| Wed 2 May 14:00 | **Week-1 checkpoint** — process maps reviewed; data ✅/⚠️/❌ posted to `#os-audit` | Adrien + Olga | Live walkthrough |
| Fri 9 May 11:00 | **Go/No-Go review** — present scorecard to James + Tom; binary decision logged | Adrien | `#os-launch` (cross-posted) |

Every shadow session, every data source check, every signed output is
logged in the `AI_OS_Testing_QA_Matrix.xlsx` (sheet: `audit-phase`)
with the same row schema as the build-phase QA cases.

---

## 9. The audit deliverable (handed to Phase 1)

By Friday 9 May 17:00, the following live in
`docs/initiatives/`:

- One `process-map-<init>.md` per initiative (6 files)
- `00-blockers-and-decisions.md` §2 fully populated for all data sources
- One `audit-outputs/` subfolder per initiative with ≥ 3 manual outputs + signed stakeholder forms
- Updated rows in `AI_OS_Testing_QA_Matrix.xlsx` (audit-phase sheet)
- A 1-page Go/No-Go scorecard in `#os-launch`

Phase 1 can start clean because Phase 0 already paid for every
surprise that would have killed it in week 3.

---

## 10. What Phase 0 is NOT

- **Not a kickoff.** Kickoffs are talk; Phase 0 is observation + manual production
- **Not a requirements doc exercise.** Each `01-scoping.md` is the requirements doc; Phase 0 *validates* it before build
- **Not optional.** No initiative ships without its audit-output files. The eval CI gate enforces it (see [`00-master-launch-plan.md`](00-master-launch-plan.md) §7)
- **Not a substitute for telemetry.** Audit creates the *manual baseline*; telemetry creates the *live measurement*. Both required for ROI defense

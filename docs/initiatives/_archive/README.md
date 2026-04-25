# Archive — superseded artefacts

> Anything in this folder is **historical**. Do not treat it as the
> current plan. The canonical plan is the markdown in
> [`docs/initiatives/`](..) — see [`00-master-launch-plan.md`](../00-master-launch-plan.md).

---

## Why these are archived (not deleted)

They show the *evolution* of the plan and may be referenced when
explaining decisions to people who saw an earlier version. Deleting
them would strand those references.

---

## Inventory

### `AI_OS_Phase_Roadmap.html`

**Superseded by:** [`00-master-launch-plan.md`](../00-master-launch-plan.md) + [`00-rollout-calendar.md`](../00-rollout-calendar.md)

Why retired:

- Used "Phase 1–4" to mean *eras* (Foundation / Quick Wins / Scale / Full OS)
  while the markdown plan uses "Phase 1–6" to mean *initiatives* in launch order.
  Two different meanings of "Phase" caused real confusion.
- Showed Init 2 (Growth AE) as "Deferred to FY26/27"; the canonical plan slots
  it into Phase 5 with a Phase 0 audit gate that **may** defer it (B-008 in
  [`00-blockers-and-decisions.md`](../00-blockers-and-decisions.md)). The
  HTML's deferral was premature.
- Connector status (Tableau MEDIUM, Snowflake HIGH BLOCKER, etc.) is now
  the canonical [`00-blockers-and-decisions.md`](../00-blockers-and-decisions.md) §2.
- RACI and timeline content moved into the markdown set with real ISO dates.

### `AI_OS_Audit_Phase_Guide.html`

**Superseded by:** [`00-audit-phase.md`](../00-audit-phase.md)

Why retired:

- Same content (the 2-week 28 Apr → 9 May manual audit), now in markdown
  format with cross-links to the canonical plan, blockers register, and
  per-initiative scoping docs.
- The HTML version was an orphan — no doc in `docs/initiatives/` referenced it,
  and the master plan didn't include the audit phase at all. Now Phase 0 is
  embedded in the master plan §3 and the rollout calendar §"Phase 0".

---

## How to read these archived files

If you need to refer to one in a discussion or PR review, link to the
archived file path explicitly:

> Per the historical roadmap (now archived at [`_archive/AI_OS_Phase_Roadmap.html`](AI_OS_Phase_Roadmap.html)), Init 2 was originally categorised as "Phase 4 — Full OS deferred". The current plan supersedes that with a Phase 0 audit-driven decision (see [`00-blockers-and-decisions.md`](../00-blockers-and-decisions.md) B-008).

This style makes it clear you're citing history, not current intent.

---

## When to add to the archive

Only when an artefact has been **explicitly superseded** by a new
canonical doc AND you want to preserve the historical reasoning. Add an
entry above with:

1. The new canonical doc that replaces it
2. Why it was retired (1–3 bullets)
3. Date archived

If the artefact is just *out of date*, update it in place — don't archive.

---
kind: concept
title: The four loops (capture, score, act, learn)
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: []
related: [[three-layers]], [[learning-loop]], [[universal-agent]]
---

# The four loops

Quoted from [`CURSOR_PRD.md`](../../../CURSOR_PRD.md) §5:

```
LOOP 4 — Learn (nightly + weekly)
  exemplar miner · prompt optimizer · scoring calibration · eval growth
  · retrieval-ranker priors · failure cluster reports
  → calibration_ledger (human-approved adaptations)
                            ▲ event stream
LOOP 3 — Act (every chat turn, every Slack push)
  Slack DMs · Inbox queue · Action panel · Chat sidebar · Pre-call brief
  → cited responses, suggested next steps, write-back to CRM
                            ▲ priority signals
LOOP 2 — Score (nightly cron + on-write)
  7 sub-scorers · funnel benchmarks · stall detection · forecast (bootstrap CI)
  → priority_score, urgency_multiplier, expected_revenue
                            ▲ canonical objects
LOOP 1 — Capture (every 6h CRM sync, transcript webhook)
  HubSpot / Salesforce sync · transcript ingest · enrichment · signal detection
  · transcript-signal mining (themes/sentiment/MEDDPICC → signals rows)
  → ontology with vector embeddings
```

## Independence is a feature

Each loop runs on its own schedule. If Loop 3 (Act) is down, Loop 1
keeps capturing. If Loop 4 (Learn) is down, Loops 1–3 still ship value.
That's a deliberate design choice, not an accident.

This means:

- A bug in the agent route doesn't stop transcript ingest.
- A failed nightly miner doesn't break tomorrow's chat.
- A rate-limited CRM sync doesn't block the daily score recompute.

The cron schedule in [`vercel.json`](../../../vercel.json) reflects
this: each loop has its own endpoint, its own retry policy, its own
idempotency keys.

## Where the [[second-brain]] sits

The second brain spans Loops 1, 3, and 4:

- **Loop 1 (Capture)** — atoms get derived from raw sources by the 8
  mining workflows.
- **Loop 3 (Act)** — slices read wiki pages first, atoms as fallback,
  and the agent cites them inline.
- **Loop 4 (Learn)** — `compileWikiPages` (nightly) compiles atoms
  into pages; `lintWiki` (nightly) keeps pages healthy;
  `reflectMemories` (weekly) writes cross-deal observations as new
  pages. Per-page bandit posteriors update on every cited turn.

The second brain doesn't introduce a fifth loop. It thickens Loops 1,
3, and 4.

## Why the loops were 4 instead of 3

An earlier draft of the PRD had three loops: ingest, act, learn.
Scoring was folded into "act". The split happened when the scoring
calibration workflow grew large enough to need its own scheduling and
its own admin UI ([`/admin/calibration`](../../../apps/web/src/app/(dashboard)/admin/calibration/)).
Today scoring is roughly 30% of the total compute cost and warrants
its own loop boundary.

If a future workflow grows comparably (e.g. enrichment becomes a
multi-source pipeline with its own admin UI), expect a fifth loop to
appear.

## Sources

- [`CURSOR_PRD.md`](../../../CURSOR_PRD.md) §5
- [`MISSION.md`](../../../MISSION.md) §"The three-tier harness doctrine"
  (the agent layer's harnessing doctrine, which constrains Loop 3 only).

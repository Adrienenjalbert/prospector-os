---
kind: concept
title: The learning loop
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: [raw/strategic-reviews/2026-04.md, raw/research/2026-03-adoption-research.md]
related: [[three-layers]], [[four-loops]], [[universal-agent]], [[second-brain]], [[cite-or-shut-up]]
---

# The learning loop

The closed loop that turns rep behaviour into measurable per-tenant
adaptation. Per [[strategic-review-2026-04]], this loop was *silently
broken* until Phase 1 (April 2026); each step is now real.

```
       (1) every interaction emits an event
              ↓
        agent_events  ←———————————————————————————┐
              ↓                                    │
       (2) nightly miners cluster                  │
              ↓                                    │
       improvement_reports + tenant_memories       │
              ↓                                    │
       (3) calibration ledger (human approval)     │
              ↓                                    │
       (4) ranked retrieval, calibrated scoring,   │
           injected exemplars, optimised prompts   │
              ↓                                    │
       (5) better next response                    │
              ↓                                    │
       rep gives feedback (thumbs, click, action) ─┘
```

## The five loop steps

### 1. Emit

Every interaction emits via
[`packages/core/src/telemetry/events.ts`](../../../packages/core/src/telemetry/events.ts)
→ `emitAgentEvent` / `emitOutcomeEvent`. The agent route emits at
every step:
[`apps/web/src/app/api/agent/route.ts`](../../../apps/web/src/app/api/agent/route.ts).
Webhooks emit `outcome_events`. The action panel emits
`action_invoked`. The citation pills emit `citation_clicked`.

Without these the learning loop has nothing to learn from. This is a
non-negotiable code review rule.

### 2. Mine

Eight nightly miners under
[`apps/web/src/lib/workflows/`](../../../apps/web/src/lib/workflows/)
write typed atoms to `tenant_memories`:

- `derive-icp` — `icp_pattern` from won deals
- `derive-sales-motion` — `motion_step` from won deals
- `mine-personas` — `persona` from contacts of won deals
- `mine-themes` — `win_theme` / `loss_theme` from transcripts
- `mine-competitor-plays` — `competitor_play` per named competitor
- `mine-glossary` — `glossary_term` from transcript n-grams
- `mine-rep-playbook` — `rep_playbook` per rep
- `mine-stage-best-practice` — `stage_best_practice` per stage

Plus the exemplar miner, prompt optimiser, scoring calibrator, and
self-improve workflows that target prompts and weights, not memories.

### 3. Calibrate (human-approved)

Every adaptation lands as a row in
[`calibration_ledger`](../../../packages/db/migrations/) which surfaces
on
[`apps/web/src/app/(dashboard)/admin/calibration/`](../../../apps/web/src/app/(dashboard)/admin/calibration/).
Admins can approve, reject, or rollback. Auto-apply unlocks only after
3+ approved cycles for that change type.

This is the **never-opaque** rule from [`MISSION.md`](../../../MISSION.md):
no auto-act on calibration without a human approval cycle.

### 4. Inject

Calibrated outputs feed the next response:

- Approved memories appear in `tenant_memories` with `status='approved'`
  or `pinned`. Slices load them.
- Tool priors update via the bandit
  ([`apps/web/src/lib/agent/tool-bandit.ts`](../../../apps/web/src/lib/agent/tool-bandit.ts)).
- Slice priors update via the slice bandit
  ([`apps/web/src/lib/agent/context/bandit.ts`](../../../apps/web/src/lib/agent/context/bandit.ts)).
- Optimised prompts replace existing surface prompts on next deploy.
- Scoring weights recompute and feed the priority queue.

### 5. Feedback

The rep clicks a citation pill, hits thumbs-up/down, invokes a Next
Step action, or doesn't. Each of these is an event that closes the
loop.

The strongest signal is **citation click + action invocation**. The
weakest is raw thumbs (heavily biased). The bandits weight events
accordingly.

## Where the [[second-brain]] thickens this

The Phase 6 plan ([[0002-two-level-second-brain]]) closes three open
loops:

1. `tenant_memories.embedding` → populated by `runMemoriesEmbedder`
   so semantic-RAG over memories actually works.
2. `memory_injected` / `memory_cited` events → emitted, so per-memory
   Beta posteriors actually update.
3. `wiki_pages` compiled from atoms → the slices read denser, more
   confident, more cited content, which itself is event-sourced for
   the same loop.

Plus the consolidation, lint, and reflection workflows extend the
miner set from 8 to 11 — three more loops from rep behaviour into
adaptation.

## Sources

- [[strategic-review-2026-04]] §3 (the silently-broken learning loop
  audit)
- [[adoption-research-2026]] Mistake #3 (habit formation > feature
  usage; why we measure citation rate, not raw queries).

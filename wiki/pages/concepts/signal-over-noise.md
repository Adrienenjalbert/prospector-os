---
kind: concept
title: Signal over noise (adoption is the product)
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: [raw/research/2026-03-adoption-research.md, raw/strategic-reviews/2026-04.md]
related: [[two-jobs]], [[cite-or-shut-up]], [[second-brain]]
---

# Signal over noise

The single biggest adoption killer is **too much information**. From
[[adoption-research-2026]]:

- 87% of orgs adopt AI sales tools.
- 50–70% churn annually.
- AI app 30-day retention is 6.1% vs 9.5% for non-AI apps.
- Salesforce Agentforce has <2% weekly active usage among its own
  customers.

The pattern: universal adoption → rapid disillusionment → abandonment
by month 4–6. Mistake #2 ("Adding cognitive load instead of removing
it") is the proximate cause for almost all the lost users.

## The hard limits

From [`MISSION.md`](../../../MISSION.md) (non-negotiable, enforced in
code):

- **Proactive Slack pushes capped per rep per day** by `alert_frequency`:
  high=3, medium=2 (default), low=1. Enforced at the dispatcher
  ([`packages/adapters/src/notifications/`](../../../packages/adapters/src/notifications/)).
- **≤ 3 items per list section.** Top-N defaults to 3.
- **≤ 150 words per short-form agent response.** Long-form only when
  the user asks to "explain" or "deep dive".
- **≤ 3 Next-Step buttons per agent reply.**
- **Similar events bundle into one digest**, not a new ping.
- **No "just checking in" messages, ever.**

Code review rule: every PR that adds an information surface either
shows it raises thumbs-up % / action rate, or replaces something
noisier. **In doubt, cut.**

## How the [[second-brain]] embodies this

The second brain is the strongest application of signal-over-noise in
the OS. Compare:

| Today (atoms) | Phase 6 (compiled pages) |
|---|---|
| 3 atoms per slice load | 1 page per slice load |
| ~1200 tokens (3 × ~150 + framing) | ~600 tokens (1 dense page) |
| Citations to source URNs only | Citations + cross-references to other pages |
| Ranked by `confidence` desc | Ranked by quality + decay + bandit posterior |
| Re-derived from raw rows every load | Compiled once nightly, served from a single row |
| `/admin/memory` shows all atoms unbounded | `/admin/wiki` shows ≤50 pages, organized by kind |

A page is **subtraction** done right: it's strictly fewer tokens with
strictly more signal (typed cross-links, quality score, lint warnings
attached).

## The "intelligence vs automation" trap

From [[adoption-research-2026]] Decision 1:

> 63% of sellers prioritise AI for qualification, deal strategy, and
> solution design — NOT admin automation. Tools that only automate
> mechanical tasks follow a predictable death curve: excitement weeks
> 1–4, diminishing returns months 2–3, abandonment months 4–6.

The OS's bias is built in: most tools are **intelligence tools** (give
me a better answer about this account, this deal, this stage) not
**automation tools** (send this email faster, log this call faster).
The four agent surfaces ([[universal-agent]]) all surface
*decisions*, not *actions*. Actions are an output, not a goal.

## What this rules out

- **A "kitchen sink" inbox.** The inbox shows top 3, expand-on-click.
  Not all 47 things that happened today.
- **A daily digest with 12 sections.** It's 3–5 bullets, max.
- **Hover-tooltips that explain UI labels.** If the label needs a
  tooltip, the label is wrong.
- **A "show me everything" admin view.** `/admin/wiki` filters
  default to "approved + published in last 7 days".
- **Auto-posting to Slack on every signal.** Cooldowns + budget
  enforcement happen at the dispatcher, not later as an opt-out.

## What this rules in

- **Bundling.** Six similar competitor mentions today → one digest
  tomorrow morning, not six pings.
- **Empty states as opportunity states.** "No ICP memories yet —
  derive-icp needs ≥3 closed-won deals" is more useful than
  silence (and more honest than fake demo data).
- **Progressive disclosure.** Layer 1 (the action), Layer 2 (the
  reasoning), Layer 3 (the methodology). Default to Layer 1.

## Sources

- [[adoption-research-2026]] §"5 Design Decisions" + §"3 Fatal
  Mistakes".
- [`MISSION.md`](../../../MISSION.md) §"UX principles (adoption is
  the product)".
- [`docs/PROCESS.md`](../../../docs/PROCESS.md) — the
  signal-over-noise rules in code review.

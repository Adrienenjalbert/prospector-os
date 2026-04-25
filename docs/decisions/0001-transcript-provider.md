# 0001 — Transcript provider strategy

> **Status:** Accepted
> **Date:** 2026-04-19
> **Decider:** RevOps + Engineering
> **Plan ref:** D7.4 (strategic-review remediation)

## Context

The Revenue AI OS ingests sales-call transcripts via the
`TranscriptIngester` adapter. Three providers are pre-integrated at
the adapter layer:

- **Gong** — premium enterprise call-recording. Best transcript
  fidelity, deepest CRM integrations. £20–50/user/month.
- **Fireflies** — mid-market. Reasonable accuracy, attractive
  per-meeting pricing. £8–15/user/month.
- **Otter** — SMB. Cheapest, lower fidelity, weaker CRM integrations.
  £5–10/user/month.

Tenants today configure their provider via
`tenants.business_config.transcript_provider` and the per-tenant
webhook secret. Engineering has historically built against all three
in parallel; product has not yet stated a preferred default for the
onboarding wizard.

## Decision

Default to **Fireflies** for new tenants in the onboarding wizard.

Rationale:

1. **Pricing fits the ICP.** Most pilots launch at 10–50 reps;
   Fireflies sits at the cost band that doesn't require procurement
   approval at that headcount.
2. **Webhook ergonomics.** Fireflies' webhook payload includes
   participant emails by default; Gong requires a separate API call
   for participant resolution. The transcript ingester's
   `matchCompany()` step relies on participant emails — Fireflies =
   one ingest call, Gong = two.
3. **No vendor lock-in.** Switching is cheap because the adapter
   already abstracts both. Tenants who upgrade to Gong later flip
   the config and the new webhook starts firing.

For tenants on Gong or Otter, ingestion continues to work — this
decision sets the default surfaced in the onboarding wizard, NOT a
required platform choice.

## Consequences

- **Engineering priority:** Fireflies bug fixes are P1 within the
  transcript path; Gong/Otter bugs are P2.
- **Onboarding wizard copy:** "Recommended: Fireflies (works in
  10 min, switch later if you upgrade to Gong)."
- **Documentation:** README's transcript-ingest section names
  Fireflies as the default; Gong/Otter sections move below the
  default-path documentation.
- **Per-tenant override:** `tenants.business_config.transcript_provider`
  accepts `'fireflies' | 'gong' | 'otter'` and the webhook router
  honours it. No code change required to switch.

## What we will not change

- The adapter layer stays provider-agnostic. The
  `TranscriptIngester` constructor accepts the same options
  regardless of provider; payload normalisation happens at the
  webhook handler.
- The transcript-signals workflow (C6.3) reads only the structured
  output (themes / sentiment / MEDDPICC) — provider-blind.

## Revisit triggers

- A tenant > 200 reps onboards with strong feedback that Fireflies
  is insufficient (revisit Gong default).
- Otter releases an enterprise tier with materially better CRM
  integrations (revisit Otter floor).
- Fireflies pricing > £20/user/month (revisit cost basis).

# Sub-processors

> **Status:** Living document. Updated in the same PR as any change
> that adds, removes, or moves a vendor that touches tenant data.
> See [`docs/PROCESS.md`](../PROCESS.md#sub-processor-discipline).
>
> **Last reviewed:** 2026-04-18 (Phase 3 T2.2).
> **Owner:** Engineering (review at every release that adds a vendor)
> + Legal/RevOps (sign DPAs, drive procurement reviews).

This page lists every external service to which Revenue AI OS may
transmit tenant data. A "sub-processor" is, in DPA language, any
third party we use to process customer data on our behalf. Reviewers:
this is the canonical list — if a vendor isn't here, we don't send
your data to it.

The list is grounded in code, not in marketing material. Each row
links to the adapter / webhook / model-registry path where the
vendor is integrated. If you want to verify, grep the codebase for
the linked entry.

---

## Active sub-processors

| Vendor | Purpose | Data category | DPA | Region | Code path | Vendor security page |
|---|---|---|---|---|---|---|
| **Anthropic** (Claude) | Agent runtime, summarization, prompt-optimizer | Prompts (may contain CRM PII + transcript snippets), tool inputs/outputs | **TBD — Legal owner to confirm** | US (or routed via Vercel AI Gateway, see below) | `apps/web/src/lib/agent/model-registry.ts`; `packages/adapters/src/transcripts/transcript-ingester.ts` | https://www.anthropic.com/trust |
| **Vercel AI Gateway** *(when configured)* | Proxy + failover for Anthropic; observability + unified billing | Same as Anthropic — every prompt routes through here when `AI_GATEWAY_BASE_URL` is set | **TBD — covered under Vercel hosting DPA, confirm** | US | `apps/web/src/lib/agent/model-registry.ts` (sets `baseURL` to gateway URL when env var is present) | https://vercel.com/security |
| **Vercel** (hosting) | App + serverless function execution, edge cache, build pipeline | All request/response data; logs may contain prompts and tool inputs | **TBD — under Vercel Enterprise DPA, confirm version** | US (production region pinned per project) | Repository hosting + deploy target | https://vercel.com/security |
| **Supabase** | Postgres + auth + RLS substrate; pgvector for embeddings | All ontology data: companies, deals, contacts, transcripts (raw + summary), signals, agent_events, calibration_ledger, admin_audit_log | **TBD — Legal owner to confirm** | US (project region pinned at provisioning) | Every `from('…')` call in the repo. Connection via `@supabase/ssr` + `@supabase/supabase-js`. | https://supabase.com/security |
| **OpenAI** | Embedding generation **only** (`text-embedding-3-small`). No chat completions, no PII transmitted beyond embedded text. | Transcript / document text submitted for embedding | **TBD — Legal owner to confirm** | US | `packages/adapters/src/transcripts/transcript-ingester.ts:104` (`POST https://api.openai.com/v1/embeddings`) | https://openai.com/security |
| **HubSpot** | CRM sync (companies, deals, contacts, activities); webhook ingestion; **CRM write-back is currently disabled platform-wide pending T3.1** | CRM data: company names, contact PII, deal records, activity history | Customer-owned (we read via OAuth, customer's own DPA with HubSpot governs) | Per-customer (US/EU per HubSpot region) | `packages/adapters/src/crm/hubspot.ts`; webhooks at `apps/web/src/app/api/webhooks/hubspot-meeting/route.ts` | https://www.hubspot.com/security |
| **Salesforce** *(adapter exists; production usage gated on customer demand)* | CRM sync — same scope as HubSpot when enabled | Same as HubSpot | Customer-owned | Per-customer | `packages/adapters/src/crm/salesforce.ts` | https://www.salesforce.com/company/legal/agreements/ |
| **Apollo** | Account + contact enrichment (firmographics, technographics, work emails) | Domain + name lookups; returned firmographic data persisted on `companies` / `contacts` rows | **TBD — Legal owner to confirm** | US | `packages/adapters/src/enrichment/apollo.ts` | https://www.apollo.io/legal |
| **Gong** | Call-transcript ingestion (raw text + metadata) | Full call transcripts: rep + customer voices, names, emails mentioned in-call | Customer-owned (their DPA with Gong governs the recording itself; we re-process via API) | Per-customer | `packages/adapters/src/transcripts/transcript-ingester.ts` (source `'gong'`); webhook at `apps/web/src/app/api/webhooks/transcripts/route.ts` | https://www.gong.io/security/ |
| **Fireflies** | Call-transcript ingestion — same scope as Gong | Same as Gong | Customer-owned | Per-customer | Same as Gong (source `'fireflies'`) | https://fireflies.ai/security |
| **Slack** | Proactive alerts to reps; bot interactions (Q&A, action chips) | User IDs, workspace IDs, message bodies (which may contain CRM identifiers + agent responses) | **TBD — Legal owner to confirm** | US | `packages/adapters/src/notifications/slack-dispatcher.ts`; `packages/adapters/src/notifications/slack.ts`; events at `apps/web/src/app/api/slack/events/route.ts` | https://slack.com/trust/security |

---

## Out of scope for this version

- **Web push notifications** — uses browser-native VAPID; no third
  party processes the payload. Not a sub-processor.
- **In-product analytics** — none. We emit `agent_events` to our
  own Supabase, not to PostHog / Amplitude / Mixpanel.
- **Email** — none. The product does not send transactional or
  marketing email at this time. Slack is the sole proactive
  channel.
- **Tickets / helpdesk** — none. Per the audit, no ticket vendor
  (Zendesk / Intercom / Freshdesk) is integrated. CSM Tier-1 (T4)
  is built on transcript signals + CRM, not on ticket counts.

---

## How data flows (for procurement reviewers)

1. **Customer's CRM (HubSpot / Salesforce)** — pulled via OAuth on
   nightly cron (`apps/web/src/app/api/cron/sync/route.ts`).
   Persisted to `companies` / `deals` / `contacts` / `activities`
   on the customer's own row in `tenants` (RLS-isolated).
2. **Customer's call platform (Gong / Fireflies)** — ingested via
   webhook (`/api/webhooks/transcripts`). HMAC-verified. Raw text
   stored on `transcripts.raw_text` (subject to retention sweep —
   nulled after the per-tenant retention window).
3. **Embeddings** — transcript + document text sent to OpenAI's
   embedding endpoint. The returned vectors are stored in
   pgvector on Supabase. The raw text remains under the customer's
   retention window.
4. **Enrichment** — domain + name sent to Apollo. Returned
   firmographic data persisted on `companies` rows.
5. **Agent runtime** — every chat / brief / scoring rationale call
   goes to Anthropic (directly or via Vercel AI Gateway). The
   prompt may contain CRM identifiers, transcript snippets, and
   tenant config. Prompt-injection defence (`SAFETY_UNTRUSTED_WRAPPER`,
   T1.2) wraps untrusted content in `<untrusted>` markers; we
   never send raw plaintext credentials.
6. **Slack** — proactive alerts dispatched on a per-rep budget
   (`alert_frequency`: high=3 / medium=2 / low=1 per day). Bot
   responses to user questions go through the same agent runtime
   as web chat.

Every external call is logged on `agent_events` (for runtime calls)
or `webhook_deliveries` / `cron_runs` (for ingestion paths). The
operator can audit any specific request.

---

## Vendor change protocol

When a release adds a vendor, removes a vendor, or moves an existing
vendor to a different region:

1. Update this document **in the same PR** as the code change.
2. Notify Legal/RevOps so the customer-facing notification (per
   the contract notice period) goes out.
3. If the vendor processes PII or CRM data, the DPA must be in
   place **before** the code path lands enabled in production
   (gated by feature flag if necessary).
4. Add the vendor's security URL + region to the table above.
5. Tag the audit log with `vendor.added` or `vendor.removed` for
   the operator's record (T2.1 audit log; new slug to be added).

The CI lint should fail the build if `packages/adapters/src/<new-vendor>/`
appears without a corresponding row here (deferred — not in T2.2;
tracked under "future security automation" in
[`roadmap.md`](./roadmap.md)).

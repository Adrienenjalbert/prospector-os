# Security roadmap

> **Status:** Living document. The honest version of "where we are
> on enterprise security readiness". Reviewed monthly; updated when
> any item below changes status.
>
> **Last reviewed:** 2026-04-18 (Phase 3 T2.2).
> **Owner:** Engineering (technical artifacts) + Legal/RevOps
> (compliance attestation, audit relationships).

This document is intentionally honest about what's shipped, what's
in flight, and what we'd need to start before we could ship it.
Procurement reviewers and prospects: this is the source of truth —
we'd rather be precise about timelines than promise certifications
we can't deliver.

---

## Where we are today (TL;DR)

| Item | Status | Notes |
|---|---|---|
| **Tenant data isolation** | **Shipped** | Postgres RLS on every tenant-owned table; service-role queries enforced via AST linter (`scripts/validate-tenant-scoping.ts`, T1.5). |
| **Credential encryption at rest** | **Shipped** | AES-256-GCM for `crm_credentials_encrypted` (T1.4). Strict resolver — no plaintext fallback after migration. |
| **HMAC verification on webhooks** | **Shipped** | Every webhook route in `apps/web/src/app/api/webhooks/**`. Idempotency keys persisted to `webhook_deliveries`. |
| **Admin action audit log** | **Shipped** (Phase 3 T2.1) | `admin_audit_log` table; every admin write to a tenant config or proposal records before/after JSONB. Append-only. |
| **Per-tenant retention windows** | **Shipped** (Phase 3 T1.3) | Nightly retention sweep workflow; per-tenant longer-only overrides via `/admin/config` → Retention tab. |
| **Prompt-injection defence** | **Shipped** (Phase 3 T1.2) | Untrusted content wrapped in `<untrusted>` markers at trust boundaries; summarizer output validated against schema. Feature-flagged on by default. |
| **CRM write-back safety** | **Disabled platform-wide** (Phase 3 T1.1) | Re-enable gated on T3.1 (approval-staging table + nonce). Until then, agent surfaces proposed writes as `[DO]` chips for the rep. |
| **Per-tenant data export endpoint** | **In flight** (Phase 3 T2.3) | `POST /api/admin/export` + `data-export` workflow. Tracked under T2.3. |
| **Tamper-evident audit log** (hash chain) | **Not started** | Deferred until SOC 2 work begins. Current append-only convention + RLS + service-role-only writes is sufficient for pilots. |
| **SOC 2 Type 1 / Type 2** | **Not started** | See "SOC 2 path" below. Gated on a named first enterprise prospect — not building observation infrastructure on speculation. |
| **ISO 27001** | **Not started** | Same gating logic as SOC 2; not on the path until a customer needs it. |
| **GDPR DPIA template** | **Not started** | Will draft when first EU-data customer contracts. EU-region Supabase available (region pinning supported); we just haven't signed an EU customer yet. |
| **Penetration test** | **Not started** | Plan: contract a reputable firm before first $50k+ ARR contract goes live. |
| **Vulnerability disclosure policy** | **Stub** | See [`incident-response.md`](./incident-response.md). Public security@ inbox; bug-bounty deferred. |
| **Sub-processor list** | **Shipped** (Phase 3 T2.2) | [`sub-processors.md`](./sub-processors.md). Updated in same PR as any vendor change. |

---

## SOC 2 path (Q3 plan, conditional)

**Prerequisite:** A named first enterprise prospect contracts to
buy on completion. We do not start the observation window
speculatively — the audit costs and process overhead are too high
to amortise without committed revenue.

### Artifacts that already exist (favourable for the audit)

- **Audit log** (T2.1) — every admin action recorded with
  before/after.
- **Retention policy** (T1.3) — per-tenant retention windows;
  documented platform defaults; nightly enforcement.
- **Encryption at rest** (T1.4) — AES-256-GCM for credentials;
  Supabase handles disk-level encryption.
- **Encryption in transit** — TLS 1.2+ on all customer-facing
  endpoints (Vercel platform default).
- **Access controls** — RLS on all tenant tables; service-role key
  scoped to server-side code only.
- **Tenant isolation linter** (T1.5) — CI gate on cross-tenant
  query patterns.
- **Webhook integrity** — HMAC verification on every webhook;
  idempotency on the delivery side.
- **Defence-in-depth on prompts** (T1.2) — input wrapping +
  output validation against Zod schema.

### Gaps still to close before the observation window starts

1. **Named on-call rotation** — currently TBD. See
   [`incident-response.md`](./incident-response.md). The auditor
   will ask for the rotation roster, paging tool, and an SLA.
2. **Quarterly access review** — process not yet defined.
3. **Annual key rotation procedure** — `CREDENTIALS_ENCRYPTION_KEY`
   never rotated since launch. Procedure must be documented +
   exercised once before audit.
4. **Vendor risk reviews** — the [`sub-processors.md`](./sub-processors.md)
   table has DPAs marked TBD; Legal/RevOps to drive each to
   "Signed". Auditor expects evidence per vendor.
5. **Data classification policy** — what counts as "sensitive"
   tenant data, and what control applies to each class. Not yet
   formalised.
6. **Backup + restore drill** — Supabase performs continuous
   backups; we have not exercised a restore. Auditor expects a
   tabletop drill once.
7. **Disaster recovery RTO/RPO** — informal targets only; not
   documented.
8. **Security training for engineers** — annual; not yet
   formalised.
9. **Change management process** — PR-review-as-change-management;
   needs to be documented as an artifact.
10. **Sub-processor change linter** — the CI gate proposed at the
    end of [`sub-processors.md`](./sub-processors.md) (fail build
    if a new adapter folder appears without a row in the
    sub-processor table) is not yet built. Tracked here as a
    nice-to-have for SOC 2 evidence.

### Expected timing (conditional)

- **T+0:** Named first enterprise prospect signs.
- **T+0 to T+30 days:** close gaps 1–9 above (most are
  process/documentation work; engineering effort ~2-4 weeks).
- **T+30 days:** Start SOC 2 Type 1 observation window.
- **T+30 to T+60 days:** Type 1 audit + report.
- **T+90 to T+180 days:** SOC 2 Type 2 (90-day observation window
  for Type 2 evidence).

---

## ISO 27001 path

Same gating logic as SOC 2. Not on the active roadmap.

If a European enterprise prospect requires ISO 27001 specifically
(vs SOC 2), we evaluate scope: ISO 27001 covers the ISMS as a
whole and is more bureaucracy-heavy than SOC 2. We would aim to
satisfy both with a unified evidence base rather than running two
separate audits.

---

## GDPR / EU-region readiness

**Today:** Supabase supports EU-region project pinning. Vercel
supports per-project EU edge regions. Anthropic processes data in
the US (per their trust page); EU regional deployments are on
their roadmap but not GA. OpenAI similarly.

**What this means for an EU customer:**

- We can pin **storage** (Supabase) to the EU.
- We can pin **compute** (Vercel functions) to the EU.
- We **cannot** today guarantee that LLM inference (Anthropic)
  stays in the EU. The customer's prompt and any tool inputs
  cross the Atlantic to the model.
- For an EU enterprise customer with strict residency
  requirements, the workaround would be self-hosted inference
  (out of scope today) or routing inference through a vendor
  that offers EU regional endpoints.

**What we'd build for first EU enterprise customer:**

- DPIA template + signed copy on file.
- EU-region Supabase project provisioning playbook.
- Standard Contractual Clauses (SCCs) for the inference vendor.
- Customer-facing data-residency disclosure on this page.

---

## Vulnerability disclosure

See [`incident-response.md`](./incident-response.md). The current
posture:

- **Inbox:** `security@<domain>` (Legal/RevOps to confirm address
  before this page is shared externally).
- **Bug bounty:** none today. We will respond to good-faith
  research; we cannot pay rewards yet.
- **Coordinated disclosure window:** 90 days standard; will reduce
  on a case-by-case basis for actively exploited vulns.

---

## How this document gets updated

- **Engineering** updates "Where we are today" status when an
  item ships, breaks, or moves between in-flight and shipped.
- **Legal/RevOps** updates DPA status on
  [`sub-processors.md`](./sub-processors.md) — that flows into
  the SOC 2 prerequisites table here.
- **Both** review monthly. If nothing has changed in 90 days, that
  itself is signal — either the gaps are stable or we've stopped
  paying attention.

This is intentionally a list of unanswered questions, not a list of
certifications-not-yet-earned. We'd rather be honest about timing.

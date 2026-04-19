# Incident response — DRAFT

> **Status:** Stub. Operational fields below are marked **TBD** —
> Engineering owner + Legal/RevOps to fill in before this is shared
> with a customer security review or shipped as part of a SOC 2
> evidence pack.
>
> **Last reviewed:** 2026-04-18 (Phase 3 T2.2).
> **Owner:** Engineering (technical response) + Legal/RevOps
> (customer notification).
>
> **What "DRAFT" means here:** the structure is right; the names,
> phone numbers, and exact paging tool are not. Filling them in is
> a process question, not a technical one — see "Open operational
> questions" at the bottom.

---

## Severity ladder

| Severity | Examples | Acknowledge | Notify customer | Public disclosure |
|---|---|---|---|---|
| **S1 — Critical** | Confirmed cross-tenant data exposure (one customer's data shown to another); active exploitation of an authentication bypass; widespread service outage > 1h. | 15 min | Within 24 hours of confirmation | Within 72 hours per typical breach-notification statute |
| **S2 — High** | Sensitive-data leakage to external service (e.g. PII in a third-party log we don't control); credential exposure (service-role key, encryption key); RLS regression detected before exploitation. | 1 hour | Within 5 business days | Case-by-case |
| **S3 — Medium** | Single-tenant correctness bug with no data exposure (e.g. wrong scoring weights for one tenant); webhook idempotency failure (duplicate processing) | 1 business day | If customer-facing, on the next regular touchpoint | None |
| **S4 — Low** | Internal tooling regression; non-PII log noise; documentation drift. | Best-effort | None | None |

> **Note on S1 vs S2 boundary:** any unauthorised exposure of
> tenant data — even a single field, even to one wrong rep within
> the same tenant — is at least S2 and triggers customer
> notification. The "cross-tenant" qualifier in S1 is what makes
> it a legally-notifiable breach in most jurisdictions.

---

## On-call rotation — **TBD**

| Field | Status |
|---|---|
| Primary on-call rotation | **TBD — Engineering owner to define** |
| Secondary / escalation | **TBD** |
| Coverage hours | **TBD — assumed 24/7 once rotation is named; document explicitly** |
| Holiday coverage | **TBD** |
| Compensation model | **TBD — Legal/RevOps to define** |

Until the rotation is named, the **default escalation path** is:

1. The engineer who notices the incident (page or self-detected via
   logs / alarm) creates an incident channel `#incident-<short-handle>`
   in the company Slack workspace.
2. They @-mention the engineering lead and the on-call manager.
3. They post the symptom, severity guess, and what they've already
   done.

This default is acceptable for the pilot phase. It is **not**
acceptable for any customer with a written SLA — that requires a
named rotation + a paging tool with documented response times.

---

## Paging tool — **TBD**

| Field | Status |
|---|---|
| Tool (PagerDuty / Opsgenie / Better Stack / etc.) | **TBD** |
| Trigger source | Vercel deployment alarm + Supabase alert + Slack `/incident` slash command |
| First-page response SLA | **TBD — proposed: 15 min for S1, 60 min for S2** |
| Escalation timeout | **TBD — proposed: 30 min if primary doesn't ack** |

---

## Communication channels

| Channel | Purpose | Audience |
|---|---|---|
| `#incident-<handle>` (Slack) | Real-time incident coordination | Engineering + on-call manager + RevOps if customer-facing |
| `security@<domain>` | External vulnerability disclosure inbox + customer security questions | Legal/RevOps; engineering CC'd |
| `status.<domain>` | Public status page | Customers + prospects |
| Customer-specific Slack-Connect channel (where set up) | Per-customer incident notification | The customer's named contact + our RevOps |

> **Customer notification language:** when an S1 / S2 incident
> affects a customer, the notification is signed by Legal/RevOps,
> not Engineering, and uses the standard breach-notification
> template (TBD — Legal owner to draft).

---

## Detection

Signals that should fire pages today (instrumented or
not — flagged):

| Signal | Source | Instrumented? |
|---|---|---|
| 5xx rate spike on `/api/agent/*` | Vercel | **Built-in (Vercel deployment alarms)** |
| 5xx rate spike on cron routes | Vercel | **Built-in** |
| RLS-violation log entry | Supabase logs | **TBD — needs explicit alerting rule** |
| Service-role key usage from a non-server-side host | Supabase logs | **TBD** |
| Cross-tenant linter regression in CI (`scripts/validate-tenant-scoping.ts`) | GitHub Actions | **Built-in** (T1.5) |
| Eval suite regression | GitHub Actions | **Built-in** (when fixed in T6) |
| Encryption-key load failure | App startup | **Built-in** (`scripts/migrate-encrypt-credentials.ts` flow) |
| Webhook HMAC failure rate spike | `webhook_deliveries` table | **TBD — needs query alert** |

---

## Runbooks (to be written)

These are not yet written. Each one is a known incident class
that should have a step-by-step playbook. Tracked here so the
backlog is visible.

- [ ] **R1: Service-role key compromise** — rotate, redeploy,
      audit all queries since suspected exposure.
- [ ] **R2: Encryption key compromise** — rotate
      `CREDENTIALS_ENCRYPTION_KEY`, re-encrypt
      `crm_credentials_encrypted` rows, force OAuth re-consent for
      every connected tenant.
- [ ] **R3: Cross-tenant data leak** — identify scope (which
      tenant saw which data), notify per severity table above,
      document RCA, fix the violation, ship the linter rule that
      would have caught it.
- [ ] **R4: HubSpot / Salesforce sync corruption** — pause cron,
      diff `companies` against CRM source-of-truth, restore from
      backup snapshot, replay sync.
- [ ] **R5: Slack push runaway** (alert budget bypass) — kill
      switch in `tenants.slack_alert_frequency = 'low'` for the
      affected tenant; investigate the bypass; ship a fix.
- [ ] **R6: Anthropic / AI Gateway outage** — degrade gracefully
      (chat returns "I'm temporarily offline" with manual
      fallback chips); restore when upstream recovers.

---

## Post-incident

After every S1 or S2 incident:

1. **Within 5 business days** of resolution, write a post-mortem
   in `docs/security/incidents/<YYYY-MM-DD>-<short-handle>.md`
   (folder TBD; first incident creates it). Template:
   - Summary (3 sentences).
   - Timeline (UTC).
   - Root cause.
   - Customer impact.
   - Detection — what surfaced it, how long until detection.
   - Response — what we did, in order.
   - Resolution — exact change(s) shipped.
   - Lessons + action items (with owners + due dates).
2. **Action items** open as PR(s) with the tag `incident:<handle>`
   so they're trackable to closure.
3. **Customer-facing summary** (Legal/RevOps drafts; Engineering
   reviews for accuracy) sent within 10 business days.

---

## Open operational questions

These need answers before this page is shared externally or
counted as SOC 2 evidence. Each is a small process decision, not
a technical change:

1. **Who owns primary on-call?** Acceptable answers: a named
   engineer; "rotates weekly among the eng team"; "the founder
   covers it until we hire #2 engineer".
2. **What paging tool?** Acceptable answers: any of PagerDuty /
   Opsgenie / Better Stack / Cronitor — pick one, configure, document.
3. **What's the public `security@` inbox address?** And who
   monitors it?
4. **Is there a status page?** If yes, URL; if no, what's the
   plan for the first time we have a Vercel/Supabase incident
   that affects all customers?
5. **What's the customer-notification template?** Legal/RevOps
   to draft + circulate.
6. **First incident drill** — schedule a tabletop exercise
   within 30 days of the on-call rotation being named, simulating
   an S1 (cross-tenant exposure). Capture lessons in this file.

Filling these in is the bridge between "we have a sensible
process on paper" and "we have an operational incident-response
capability". Today we're at the first; SOC 2 readiness requires
the second.

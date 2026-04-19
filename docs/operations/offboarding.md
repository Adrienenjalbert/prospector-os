# Tenant offboarding runbook

> **Owner:** RevOps. **Engineering** owns the technical export
> endpoint (Phase 3 T2.3); RevOps owns the customer-facing
> communication, scheduling, and final tenant-deletion call.
>
> **SLA:** Customer's data export delivered within **5 business
> days** of a verified request.
>
> **Last reviewed:** 2026-04-18 (Phase 3 T2.3).

This runbook covers what RevOps does when a customer asks to
either (a) get a copy of their data or (b) be offboarded
entirely. The two are linked but distinct: a customer can request
their data without offboarding, and an offboarding always
triggers an export first.

---

## When this runbook applies

| Trigger | Path |
|---|---|
| Customer emails / Slacks RevOps asking for "all our data" | Section A — Data export |
| Customer says "we're leaving / churning / cancelling" | Section B — Offboarding (ends with deletion) |
| Auditor or procurement reviewer asks for a sample export to verify our claims | Section A — Data export, marked `purpose=audit_sample` in the audit log |
| Engineering needs a tenant export for support debugging (with customer consent) | Section A — Data export, marked `purpose=support` in the audit log |

---

## Section A — Data export (5 business day SLA)

### A.1 Verify the request

Before triggering anything, confirm the request is genuine:

1. **Sender identity.** Request must come from a known admin
   contact at the customer (the contact named in the master
   service agreement, or someone they explicitly authorise).
   Slack-Connect channels with the customer's domain are
   sufficient; a personal Gmail asking for an export of an
   enterprise tenant is not.
2. **Scope confirmation.** Some customers ask for "everything";
   some ask for a specific date range or a specific table. The
   default export includes every tenant-scoped table; if they
   want a narrower slice, RevOps records it as a follow-up
   ticket — the current export endpoint is "everything in one
   zip".
3. **Reason / purpose.** Recorded in the audit log metadata
   field. Typical values: `customer_request`, `audit_sample`,
   `support`, `pre_offboarding`. Drives any post-export
   escalation (e.g. `pre_offboarding` triggers Section B's
   countdown).

### A.2 Trigger the export

Two options:

#### Option 1 — Self-serve (preferred)

The customer's admin can do this themselves at
`/admin/config` → "Data export" panel. This is the right path
for routine requests: fastest, audit-logged automatically, no
RevOps in the loop.

If this is the path, confirm by checking
`admin_audit_log.action = 'tenant.export'` for the customer's
tenant — that row is the audit trail.

#### Option 2 — Operator-triggered (RevOps + Engineering)

When the customer's admin can't or won't self-serve (e.g. they
already lost access to the dashboard), an Engineering on-call
fires the export from a service-role context:

```bash
# Require: SUPABASE_SERVICE_ROLE_KEY + access to the customer's
# tenant id.
TENANT_ID=<customer-tenant-uuid>
USER_ID=<requesting-revops-user-uuid>
REQUEST_ID=$(uuidgen)

curl -X POST \
  -H "Authorization: Bearer $YOUR_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"request_id\":\"$REQUEST_ID\"}" \
  https://app.example.com/api/admin/export
```

The API requires a logged-in admin on the target tenant, so for
RevOps-triggered exports the operator either:

- Uses a customer-scoped admin account (cleanest; preferred), or
- Uses a platform-admin account that has been temporarily added
  to the customer's tenant for this purpose. This must be
  recorded in the audit log with reason `support` and the
  platform-admin removed from the tenant within 24h.

### A.3 Deliver to the customer

The export workflow's `notify` step DMs the requester via Slack
when a `slack_user_id` is set on their `rep_profiles` row. For
operator-triggered exports, the notification fires to the
requester (the RevOps user), not the end customer — RevOps then
forwards the URL to the customer via the contracted
communication channel.

Always include in the customer-facing message:

- The download URL (expires in 7 days).
- The size of the zip.
- A pointer to `SCHEMA.md` inside the zip for column docs.
- A note that raw transcript text is excluded per the platform's
  retention policy (linked to
  [`docs/security/sub-processors.md`](../security/sub-processors.md)
  and the per-tenant retention window).

### A.4 Record + close

Confirm:

1. The audit log row exists
   (`SELECT * FROM admin_audit_log WHERE action = 'tenant.export' AND
   metadata->>'request_id' = '<id>'`).
2. The workflow_runs row reached `status = 'completed'`.
3. The customer confirmed receipt.

Close the support ticket with a 1-line summary that links to
the audit log row by request_id.

---

## Section B — Offboarding (ends with tenant deletion)

> **All offboardings start with a Section A export.** Never
> delete a tenant without first delivering a copy of their data
> and getting written confirmation that they have it.

### B.1 Pre-offboarding (Day 0)

1. **Confirm intent in writing.** Email or formal Slack message
   from a named admin at the customer. Verbal cancellation is
   not enough — the trail must be auditable.
2. **Trigger Section A export** with reason
   `pre_offboarding`. Get the customer's written confirmation
   that they have the zip and have validated the contents.
3. **Disable proactive Slack pushes.** Set
   `tenants.business_config.alert_frequency = 'low'` and confirm
   the next nightly digest cron skips the tenant.
4. **Cancel scheduled workflows.** Mark any `workflow_runs` rows
   in status `pending` / `scheduled` for the tenant as
   `cancelled` to prevent any post-cancellation runs:
   ```sql
   UPDATE workflow_runs
   SET status = 'cancelled', updated_at = NOW()
   WHERE tenant_id = '<id>' AND status IN ('pending','scheduled');
   ```

### B.2 Cool-down (Days 1-30)

Per the master service agreement, a cancelled tenant's data
remains in our systems for 30 days as a recovery window. During
this window:

- The tenant's user_profiles can still log in (legal recoverability).
- Cron sync, scoring, signals are paused (set in B.1.4).
- The data export above is the canonical copy; we do NOT take
  additional snapshots.

If the customer reverses the cancellation in this window, RevOps
re-enables Slack pushes + cron processing + posts a "welcome
back" Slack DM to their reps.

### B.3 Hard deletion (Day 30+)

After the cool-down expires, an Engineering on-call performs the
deletion. **This is irreversible.** The order matters because of
foreign keys:

```sql
BEGIN;

-- Telemetry & adaptation rows
DELETE FROM agent_events       WHERE tenant_id = '<id>';
DELETE FROM outcome_events     WHERE tenant_id = '<id>';
DELETE FROM agent_citations    WHERE tenant_id = '<id>';
DELETE FROM tool_priors        WHERE tenant_id = '<id>';
DELETE FROM holdout_assignments WHERE tenant_id = '<id>';
DELETE FROM calibration_proposals WHERE tenant_id = '<id>';
DELETE FROM calibration_ledger WHERE tenant_id = '<id>';
DELETE FROM admin_audit_log    WHERE tenant_id = '<id>';

-- Workflow + cron state
DELETE FROM workflow_runs      WHERE tenant_id = '<id>';
DELETE FROM webhook_deliveries WHERE tenant_id = '<id>';

-- Ontology
DELETE FROM signals            WHERE tenant_id = '<id>';
DELETE FROM contacts           WHERE tenant_id = '<id>';
DELETE FROM opportunities      WHERE tenant_id = '<id>';
DELETE FROM transcripts        WHERE tenant_id = '<id>';
DELETE FROM companies          WHERE tenant_id = '<id>';
DELETE FROM rep_profiles       WHERE tenant_id = '<id>';

-- Auth (Supabase auth.users — deletes user_profiles via cascade)
DELETE FROM auth.users
  WHERE id IN (
    SELECT id FROM user_profiles WHERE tenant_id = '<id>'
  );

-- Tenant row last
DELETE FROM tenants            WHERE id = '<id>';

COMMIT;
```

If any of these fail mid-transaction, the whole thing rolls back
— rerun after fixing the obstruction (usually a foreign key from
a table not listed above; add it to the script, document the
addition).

After the transaction commits:

1. Verify with `SELECT EXISTS(SELECT 1 FROM tenants WHERE id = '<id>')`
   — should return `false`.
2. Record the deletion in a separate manual log
   (`docs/operations/deleted-tenants.md` — to be created on
   first deletion). Includes: tenant id, slug, deletion date,
   operator, customer's written confirmation timestamp from
   B.1.1.
3. Email the customer's admin contact confirming deletion is
   complete.

### B.4 What survives deletion

By design, NOTHING survives in our primary database. However:

- **Vercel Blob exports** persist for 7 days from generation.
  After the URL expires, the blob is garbage-collected by
  Vercel. If the customer wants any export blob proactively
  removed earlier, RevOps requests it via the Vercel dashboard.
- **Backups** (Supabase continuous backups) retain rows for 7
  days by default. Recovery from backup after deletion would
  require a documented incident reason and customer consent
  (since recovery would re-instate data the customer asked us
  to delete).
- **Server logs** (Vercel function logs) retain rows for the
  log-retention window (typically 7-30 days depending on plan).
  Logs do not contain raw customer data by design but may
  contain tenant_id strings.

The full retention picture lives in
[`docs/security/roadmap.md`](../security/roadmap.md) under
"Where we are today".

---

## Operator FAQ

**Q: A customer says they didn't get the export Slack DM.**
A: Confirm `rep_profiles.slack_user_id` is set on the requester's
row. If not, the workflow's notify step records
`notified: false, channel: 'manual'` — fetch the URL from
`/api/admin/export/<request_id>` and forward it manually.

**Q: A customer wants only a date range, not everything.**
A: T2.3 doesn't support filtering. Open a follow-up ticket
against Engineering; in the meantime, deliver the full export
and tell the customer they can filter the CSVs locally with the
column-name conventions in `SCHEMA.md`.

**Q: The export is huge / failing on the cap.**
A: The workflow caps each table at 100k rows (200k for
agent_events / contacts; see `data-export.ts` for the per-table
caps). Hitting the cap is signalled in `SCHEMA.md`'s
"Truncated?" column. If the customer needs the full set,
Engineering would need to ship a date-range filter — not in T2.3
scope.

**Q: A customer asks for the raw transcript text.**
A: Per the retention policy (T1.3), raw transcript text is
nulled at the per-tenant retention window (default 90 days). The
export includes the summary, themes, and embedding. If the
customer needs raw text within their retention window, contact
the original transcript provider (Gong / Fireflies) — they own
the source-of-truth audio + text.

**Q: A customer wants confirmation our backups are also wiped.**
A: They aren't, automatically — see B.4. RevOps can request
explicit early backup expiry via Supabase support if the customer
contractually requires it; this is a separate ticket.

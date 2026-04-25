# Tier-2 CRM write-back

> **Audience:** customer admins evaluating whether to enable AI-driven
> CRM write-back for their tenant; procurement reviewers asking
> "what does the AI mutate?"; engineers documenting the trust model.
>
> **Last reviewed:** 2026-04-18 (Phase 3 T3.2).

This page explains what the platform's tier-2 CRM write-back model
is, what risk it carries, and what controls are in place. It is
linked from the in-product acknowledgement checkbox on
`/admin/config` → "Tier-2 CRM write-back" panel; an admin enabling
the first write tool ticks a checkbox confirming they have read
this document.

---

## TL;DR

- **The AI agent never mutates your CRM directly.** It STAGES a
  proposed write in a `pending_crm_writes` row and surfaces a
  `[DO]` chip in the chat.
- **A human clicks to approve** (the rep clicks the chip), and the
  platform's executor (`apps/web/src/lib/crm-writes/executor.ts`)
  performs the actual HubSpot call.
- **Per-tool toggles + per-toggle acknowledgement.** The three
  write tools default OFF. An admin enables them per-tool on
  `/admin/config`; the first enable requires the acknowledgement
  on this page.
- **Every staged write is auditable.** Each row in
  `pending_crm_writes` records who staged it (which agent
  conversation), who approved it, when, and the resulting CRM
  record id.
- **Every toggle change is auditable.** Each enable/disable is
  recorded in `admin_audit_log` with before/after snapshots and
  the user who performed the change.

---

## What "tier-2" means

We classify tools into two trust tiers:

| Tier | What the tool does | Approval model |
|---|---|---|
| **Tier 1** | Read-only — fetches data from the tenant's CRM, transcripts, signals, etc. | None. The agent calls these freely. |
| **Tier 2** | Mutates external state — writes back to the CRM, sends a Slack message, schedules a calendar event. | Two-stage: AI stages, human approves. |

Today the only tier-2 tools are CRM write-back. As the platform
adds tier-2 tools (e.g. "send email draft", "schedule calendar
event"), each will have its own opt-in toggle on the same panel.

---

## The three CRM write tools

| Tool slug | Effect | Default |
|---|---|---|
| `log_crm_activity` | Creates a HubSpot engagement (note / call / email / meeting) on a deal/company/contact. | OFF |
| `update_crm_property` | Sets one HubSpot property on a deal/company/contact (e.g. `dealstage = 'Negotiation'`, `amount = 50000`). | OFF |
| `create_crm_task` | Creates a HubSpot follow-up task with optional due date, priority, and association. | OFF |

The agent never invokes these tools without your team explicitly
toggling them ON. While they're OFF, the agent simply doesn't see
them — it cannot propose a write of that type.

---

## How the loop works (end-to-end)

```
1. Rep asks the agent: "Log a note on Acme that we discussed pricing."

2. Agent calls log_crm_activity with the proposed args.

3. The handler INSERTs a `pending_crm_writes` row:
   - tenant_id
   - requested_by_user_id (the rep)
   - agent_interaction_id (the chat turn)
   - tool_slug = 'log_crm_activity'
   - target_urn = 'urn:rev:company:abc'
   - proposed_args = { activity_type: 'note', body: '…' }
   - status = 'pending'
   - expires_at = NOW + 24h

   Returns to the agent: { pending_id, status: 'pending', summary }.

4. Agent renders a [DO] chip in chat:
   - [DO] Note on Acme: discussed pricing (pending: <uuid>)

5. Rep reads the proposed write, clicks the chip.

6. Chip POSTs { pending_id } to /api/agent/approve.

7. /api/agent/approve:
   - Verifies the rep is in the same tenant as the pending row.
   - Verifies status='pending' and not expired (24h TTL).
   - Optimistically locks the row to status='approved'.
   - Hands off to executor.executePendingWrite(...).
   - executor:
     - Re-resolves target + credentials.
     - Calls HubSpot's createEngagement endpoint.
     - Returns { external_record_id, citations }.
   - UPDATE status='executed' + external_record_id.
   - Emits action_invoked event for attribution.

8. Chat re-renders the chip as "Done — Note on Acme" with a
   citation link to the new HubSpot engagement.
```

If anything fails (HubSpot rejects, credentials missing, network
error), the row is marked `status='rejected'` with the error
message; the chip surfaces the failure. Re-staging is one click
away.

---

## What controls are in place

### 1. Per-tool enablement (T3.2)

- Three independent toggles. Defaults OFF.
- Tool-loader gate at request time (`tool-loader.ts`): when a
  toggle is OFF, the agent literally never receives that tool in
  its available set. It cannot propose a write it doesn't know
  exists.

### 2. Acknowledgement (T3.2)

- The first time you toggle ANY write tool ON, the UI requires
  you to tick a checkbox confirming you have read this page.
- The acknowledgement is sticky — re-enabling a tool after toggling
  it back off does NOT require re-signing. It's about
  understanding the model, not the specific moment of enabling.

### 3. Staging table (T3.1)

- `pending_crm_writes` table. Every proposed write is a row.
- 24h TTL — abandoned proposals expire.
- Closed-allowlist status (`pending` / `approved` / `executed`
  / `rejected` / `expired`).
- RLS scoped to the tenant.

### 4. Approval endpoint (T3.1)

- `/api/agent/approve` requires:
  - Auth'd user in the same tenant as the pending row.
  - Status `pending`, not expired.
  - Optimistic lock to prevent double-execution from concurrent
    clicks.
- Records executor's user_id + timestamp on the row.

### 5. Audit log (T2.1 / T3.2)

- Every toggle change writes an `admin_audit_log` row
  (`action='tier2.toggle'`) with before/after JSONB snapshots.
- Every staged write has its own immutable lifecycle on the
  `pending_crm_writes` row (requested_by + executed_by +
  external_record_id).

### 6. Cite-or-shut-up (MISSION rule)

- After execution, the agent's response cites the URL of the
  newly-created HubSpot record. The rep can verify the write in
  one click.

### 7. Holdout cohort (T3.3 — separate)

- Reps in the holdout cohort don't receive proactive write
  proposals. (Out of scope for this page; see
  [`docs/holdout.md`](../holdout.md) once it ships.)

---

## What you give up by enabling tier-2

- The agent will surface [DO] chips for CRM mutations in chat.
  Reps who click without reading carefully could approve a write
  that doesn't reflect their intent.
- Mitigation: the chip text always summarises the proposed
  write (target object + property/activity + new value). The rep
  can decline by simply not clicking.

- The agent's reasoning isn't perfect; it can propose writes
  that don't make business sense (e.g. updating the wrong
  property on the wrong deal).
- Mitigation: nothing executes without an explicit click. The
  rep's judgement is the final filter.

- HubSpot writes are subject to HubSpot's own audit log. Your
  team will see the AI-staged writes appear in HubSpot's
  activity feed alongside human writes.
- Mitigation: every executed write is also recorded in
  `pending_crm_writes` with the requester's user_id, the
  approver's user_id, and the agent_interaction_id of the chat
  that proposed it. You can reconstruct the full provenance on
  demand.

---

## What's still off-limits

The platform does NOT (today) allow the agent to:

- Send emails on behalf of the rep.
- Send Slack messages other than alerts the platform itself
  generates (which use a separate alert-frequency budget).
- Schedule calendar events.
- Modify pricing, SLAs, or contract terms in the CRM.
- Delete records.
- Mutate any object outside the CRM (e.g. modify Supabase rows
  on your behalf, change configuration).

Future tier-2 tools that expand this list will require their own
toggle + acknowledgement update.

---

## Operator playbook

### To enable a tool

1. Go to `/admin/config` → "Tier-2 CRM write-back" panel.
2. Toggle the tool ON.
3. Tick the acknowledgement checkbox (first enable only).
4. Click "Save tier-2 config".
5. The change writes an `admin_audit_log` row + the agent
   immediately sees the tool on its next turn.

### To audit who enabled what + when

```sql
SELECT occurred_at, user_id, action, target, before, after
FROM admin_audit_log
WHERE tenant_id = '<your-tenant-id>'
  AND action = 'tier2.toggle'
ORDER BY occurred_at DESC;
```

### To list pending / executed writes

```sql
SELECT created_at, status, tool_slug, target_urn,
       requested_by_user_id, executed_by_user_id, executed_at,
       external_record_id, error
FROM pending_crm_writes
WHERE tenant_id = '<your-tenant-id>'
ORDER BY created_at DESC
LIMIT 50;
```

### To revoke (kill switch)

Toggle all three tools OFF on `/admin/config`. The agent loses
the tools on its next turn (no restart required). Already-staged
`pending` rows can still be approved by the rep — to also kill
those, run:

```sql
UPDATE pending_crm_writes
SET status = 'rejected', error = 'tier2-revoked'
WHERE tenant_id = '<your-tenant-id>'
  AND status IN ('pending', 'approved');
```

### To onboard a new admin to the model

Walk them through this page. Have them watch a single end-to-end
flow on a test tenant: ask the agent to log a note, see the chip,
click it, see the citation. Five minutes; better than another
text doc.

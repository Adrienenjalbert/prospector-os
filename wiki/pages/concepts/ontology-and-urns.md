---
kind: concept
title: Ontology and urn:rev addressing
created: 2026-04-24
updated: 2026-04-24
status: accepted
sources: []
related: [[three-layers]], [[cite-or-shut-up]], [[second-brain]]
---

# Ontology and `urn:rev:` addressing

The OS's context layer has one canonical ontology. Every object has a
stable URN. Every citation, every event, every cross-reference uses
URNs.

## The URN format

```
urn:rev:{tenantId}:{type}:{id}
```

- `tenantId` — the tenant UUID. Multi-tenant isolation enforced via
  RLS.
- `type` — one of the registered object types (see below).
- `id` — the object's primary key (UUID for most types, slug for
  `wiki_page`, etc.).

Examples:

- `urn:rev:abc123:company:f0e4` — company `f0e4` in tenant `abc123`
- `urn:rev:abc123:opportunity:7c12` — deal `7c12`
- `urn:rev:abc123:transcript_chunk:9b88` — a chunk of a transcript
- `urn:rev:abc123:memory:a1b2` — a `tenant_memories` atom (Phase 5)
- `urn:rev:abc123:wiki_page:concept_icp` — a wiki page (Phase 6)

URN helpers live in
[`packages/core/src/types/urn.ts`](../../../packages/core/src/types/urn.ts).
Helper namespace: `urn.company(tenantId, id)`, `urn.opportunity(...)`,
etc. Phase 6 adds `urn.memory(...)` (already there) and
`urn.wikiPage(...)`.

## The object types

| Type | Table | Notes |
|---|---|---|
| `company` | `companies` | The atomic account record |
| `contact` | `contacts` | A person inside a company |
| `opportunity` | `opportunities` | A deal in flight |
| `signal` | `signals` | A piece of intelligence (intent, news, change) |
| `transcript` | `transcripts` | A meeting recording |
| `transcript_chunk` | `transcript_chunks` | A retrievable chunk |
| `activity` | `activities` | An interaction (email, call, meeting) |
| `health` | `account_health` | A periodic health snapshot |
| `memory` | `tenant_memories` | A typed memory atom |
| `wiki_page` | `wiki_pages` | A compiled wiki page (Phase 6) |
| `framework_chunk` | `framework_chunks` | Sales-framework knowledge (platform-wide) |

Adding a new type means: a new entry in `UrnObjectType`, a helper in
[`packages/core/src/types/urn.ts`](../../../packages/core/src/types/urn.ts),
and (usually) a new migration with RLS.

## The citation contract

Quoted from [`MISSION.md`](../../../MISSION.md) (and enforced by
[[cite-or-shut-up]]):

> Every claim links to its source object. Every tool returns
> `{ data, citations }`. No invented numbers, no invented names.

Mechanically:

- The agent's prompt instructs it to wrap URNs in backticks
  (`` `urn:rev:abc123:company:f0e4` ``) so the citation pill UI can
  parse them.
- The packer's URN walker
  ([`apps/web/src/lib/agent/context/packer.ts`](../../../apps/web/src/lib/agent/context/packer.ts))
  extracts URNs from the assistant text and emits
  `context_slice_consumed` events for the slices whose markdown
  contained those URNs.
- After Phase 6 the same walker emits `memory_cited` and
  `wiki_page_cited` events too, which feed the per-memory and
  per-page bandits.

## Why this matters for the [[second-brain]]

The second brain piggybacks on URNs end-to-end:

- Atoms cite raw object URNs in their `evidence.urns` field — the
  `derive-icp` workflow stores the won-deal URNs that produced an
  `icp_pattern`.
- Wiki pages cite both atom URNs (in their `body_md` markdown) and
  raw object URNs (transitively, via the atoms they were compiled
  from).
- Memory edges (`memory_edges`) reference URNs on both sides — a
  page's `derived_from` edge points at atoms by their UUIDs.
- The agent's response includes URNs inline; the packer attributes
  the citation back to the right slice / atom / page.

Without URNs, none of this would compose. The citation contract is
what makes "cite or shut up" mechanically enforceable instead of an
honor system.

## What this is NOT

- **Not a graph database query language.** URNs are addresses, not
  query selectors. To find related objects, you query the SQL tables
  or follow `memory_edges`.
- **Not a global namespace.** URNs are tenant-scoped. Two tenants can
  have the same `id` for `company` and they're different objects.
- **Not a URL.** URNs don't dereference over HTTP. The dashboard
  uses internal routes (e.g. `/companies/[id]`) to render an object
  from its URN.

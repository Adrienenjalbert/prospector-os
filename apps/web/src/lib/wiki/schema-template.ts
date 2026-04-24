/**
 * Default per-tenant CLAUDE.md template (Phase 6, Section 2.6).
 *
 * Loaded by:
 *
 *   1. `/admin/wiki/schema` editor when the tenant has no
 *      tenant_wiki_schema row yet — the textarea pre-populates with
 *      this template so admins start from a usable baseline rather
 *      than an empty box.
 *   2. `compileWikiPages` (`defaultSchemaStub`) as the fallback when
 *      the DB row is missing.
 *
 * Once the tenant saves once, the row is created with version=1 and
 * this template is no longer used for that tenant. The template
 * itself can evolve here without affecting tenants that have already
 * customised — only first-save tenants get the new version.
 *
 * The structure mirrors the developer wiki's `wiki/CLAUDE.md` so
 * conventions transfer between the two levels.
 */

export const DEFAULT_TENANT_WIKI_SCHEMA = `# Tenant wiki schema (CLAUDE.md)

This document tells the wiki compiler (\`compileWikiPages\` workflow,
runs nightly at 02:00 UTC) how to organise this tenant's brain. It
is loaded into the system prompt of every per-page compilation so
each tenant's pages reflect the conventions you set here.

You and the agent co-evolve this document over time. Edit it to
match how your team actually reasons about pipeline + customers.

## Page kinds

The compiler emits one wiki page per entity. Each kind has its own
clustering rule and slug pattern.

### Entity pages (one per concrete thing the tenant cares about)

- **entity_industry/{slug(industry)}** — one page per industry the
  tenant sells into. Folds in icp_pattern, win_theme, and loss_theme
  atoms scoped to that industry. Use the canonical industry name
  (slugified to kebab-case): \`manufacturing\`, \`logistics\`,
  \`healthcare-payers\`.
- **entity_persona/{slug(role)}** — one page per buyer archetype:
  \`champion\`, \`economic-buyer\`, \`decision-maker\`. Folds in
  persona atoms.
- **entity_competitor/{slug(name)}** — one page per named competitor.
  Folds in competitor_play atoms. Use the vendor's canonical name
  (\`workday\`, not \`Workday Inc.\`).
- **entity_stage/{slug(stage)}** — one page per pipeline stage.
  (Reserved; populated when stage_best_practice atoms are scoped to
  a stage.)

### Concept pages (tenant-wide tenets)

- **concept_icp/tenant-wide** — the tenant's overall ICP narrative.
  Folds in icp_pattern atoms with no industry scope, plus
  cross-industry win/loss themes.
- **concept_motion/tenant-wide** — the tenant's sales motion. Folds
  in motion_step atoms, one section per stage.
- **concept_glossary/tenant-wide** — tenant-specific terminology
  (product names, internal acronyms, customer-specific shorthand).

### Playbook pages (procedural memory)

- **playbook_rep/{slug(rep_id)}** — per-rep playbook. Compares the
  rep against the tenant's top-quartile bar.
- **playbook_stage/{slug(stage)}** — per-stage best-practice. Folds
  in stage_best_practice atoms.

### Time-bounded pages

- **reflection_weekly/{ISO-week}** — weekly cross-deal observation
  written by reflectMemories.
- **log_session/{slug}** — high-value session digest (Phase 7+).

## Naming conventions

- **Slugs are kebab-case.** \`manufacturing\`, \`champion\`,
  \`workday\`. Slugify by lowercasing, replacing non-alphanumeric
  characters with hyphens, and collapsing repeats. Cap at 80 chars.
- **One page per (kind, slug) tuple per tenant.** The compiler's
  upsert relies on this uniqueness.

## Citation rules (non-negotiable)

Every claim in every page must cite something. The compiler enforces
this in its output schema, but the rules to follow:

- **Atom URN** \`urn:rev:{tenant}:memory:{id}\` — when the claim
  comes from a derived memory atom.
- **CRM URN** \`urn:rev:{tenant}:opportunity:{id}\`,
  \`urn:rev:{tenant}:company:{id}\`, etc. — when the claim quotes
  the underlying CRM record (taken from the atom's evidence URNs).
- **Transcript URN** \`urn:rev:{tenant}:transcript:{id}\` — when the
  claim quotes a meeting.
- **Wikilinks** \`[[other-page-slug]]\` — when the claim references
  another wiki page. The compiler validates these resolve.

## Page structure

Every page follows this shape (the compiler enforces it via Zod):

\`\`\`yaml
---
kind: <one of the page kinds above>
scope: { industry?, persona_role?, competitor?, stage? }
source_atoms: [<atom UUID list>]
confidence: 0.0-1.0
last_compiled_at: <ISO timestamp>
compiler_version: <fingerprint>
---
\`\`\`

Then markdown:

\`\`\`md
# Title

> **TL;DR** — Two-sentence summary the rep can read in 5 seconds.

## Evidence
Inline atom URN citations.

## Patterns
What's recurring; what's worth quoting.

## Caveats
What's uncertain or contradicted.

## Cross-links
- [[related-page-slug]]
\`\`\`

## Lint thresholds (consolidate + lintWiki)

- **Atom decay**: half_life=180d default; 30d for glossary_term;
  90d for competitor_play. Atoms with decay_score < 0.2 AND
  status='proposed' get auto-archived nightly.
- **Page decay**: half_life=120d. Pages with decay_score < 0.2 AND
  zero citations in the last 30d get auto-archived.
- **Orphan pages**: pages with zero inbound related_to edges get
  flagged in lint warnings (not auto-archived; admin reviews).
- **Contradictions**: never auto-resolved. Pairs flagged as
  contradicts surface in /admin/wiki?lint=contradiction.
- **Quality threshold**: pages whose self-eval quality_score < 0.5
  get re-queued for compilation with a stricter prompt.

## Tenant-specific vocabulary

(Edit this section as the agent learns. Add product names,
acronyms, internal shorthand the compiler should use verbatim.)

- _(none yet — the compiler will propose additions weekly via
  reflectMemories)_

## How to evolve this schema

- **You** edit any section directly via \`/admin/wiki/schema\`.
  Save bumps the version monotonically; previous versions are kept
  in calibration_ledger and rollback-able.
- **The agent** proposes diffs weekly (reflectMemories workflow).
  Proposals appear here as drafts for your review; on approval,
  \`auto_revisions\` increments.
- **Lint** never edits this schema. It only flags pages.

## What this schema does NOT control

- Which atom kinds the miners produce (that's hard-coded in the 8
  mining workflows).
- Which slices the agent loads (that's the slice registry +
  selector).
- The tenant's ICP config or scoring weights (those live elsewhere
  and have their own admin surfaces).

This file shapes only the **wiki layer**.
`

/**
 * Generic embedder + per-source pipelines (C5.1).
 *
 * Five embedding pipelines in one place:
 *   - companies          (firmographics + industry + recent activity summary)
 *   - signals            (signal_type + title + description)
 *   - relationship_notes (note body)
 *   - business_skills    (exemplar `q` field, when skill_type=exemplars)
 *   - framework_chunks   (chunked sales-framework markdown)
 *
 * All use OpenAI text-embedding-3-small (1536 dims). The embedder
 * itself is shared so a single change to the model / dimensions
 * propagates everywhere.
 *
 * DESIGN PRINCIPLES
 *
 *   - Idempotency: each row's embedding is keyed by content hash
 *     (sha256 of the embed-text). Re-embedding the same content
 *     short-circuits — no wasted API calls.
 *   - Batching: each pipeline page-fetches in chunks of 50 to bound
 *     concurrent embed calls without single-item RTT cost.
 *   - Graceful failure: per-row errors are logged and skipped, the
 *     pipeline continues. Aggregate counters returned at the end.
 *   - Tenant scoping: every pipeline takes a tenantId and writes
 *     only to that tenant's rows. The framework_chunks pipeline is
 *     platform-wide (no tenantId).
 *
 * USAGE
 *
 *   await runCompaniesEmbedder(supabase, tenantId)
 *   await runSignalsEmbedder(supabase, tenantId)
 *   await runFrameworksEmbedder(supabase) // platform-wide
 *
 * The cron driver at apps/web/src/app/api/cron/embeddings/route.ts
 * fans out per-tenant.
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

const EMBEDDING_DIM = 1536
const EMBED_BATCH_SIZE = 50
const EMBED_INPUT_CHAR_CAP = 8000 * 4 // ~8k tokens

export interface EmbedderResult {
  considered: number
  embedded: number
  skipped_unchanged: number
  errors: number
}

interface EmbedFn {
  (text: string): Promise<number[]>
}

/**
 * Default embedder — direct OpenAI fetch. Same call shape used by
 * the legacy transcript pipeline. Consumers can pass a different
 * embedFn (e.g. AI Gateway-routed) via the helper params below.
 */
async function defaultEmbedder(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set — cannot embed')
  }
  const truncated = text.slice(0, EMBED_INPUT_CHAR_CAP)
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: truncated,
      dimensions: EMBEDDING_DIM,
    }),
  })
  if (!res.ok) {
    throw new Error(`OpenAI embed failed (${res.status}): ${await res.text()}`)
  }
  const json = await res.json()
  return json.data[0].embedding as number[]
}

/**
 * sha256 truncated to 16 hex chars — enough collision resistance for
 * dedup at our row volumes; small enough to fit in a varchar(64)
 * column comfortably.
 */
function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

function vectorString(embedding: number[]): string {
  // pgvector accepts the array literal `[0.1,0.2,...]` form via text.
  return `[${embedding.join(',')}]`
}

/**
 * Run a single embed cycle over a slice of rows. Used internally by
 * each per-source pipeline.
 */
async function embedRows<T extends { id: string }>(opts: {
  rows: T[]
  buildText: (row: T) => string
  buildHash: (row: T) => string
  hasUnchangedHash: (row: T, hash: string) => boolean
  writeEmbedding: (row: T, embedding: number[], hash: string) => Promise<void>
  embedFn: EmbedFn
  result: EmbedderResult
}): Promise<void> {
  const { rows, buildText, buildHash, hasUnchangedHash, writeEmbedding, embedFn, result } = opts
  for (let i = 0; i < rows.length; i += EMBED_BATCH_SIZE) {
    const slice = rows.slice(i, i + EMBED_BATCH_SIZE)
    await Promise.all(
      slice.map(async (row) => {
        result.considered += 1
        const text = buildText(row).trim()
        if (!text) return
        const hash = buildHash(row)
        if (hasUnchangedHash(row, hash)) {
          result.skipped_unchanged += 1
          return
        }
        try {
          const embedding = await embedFn(text)
          await writeEmbedding(row, embedding, hash)
          result.embedded += 1
        } catch (err) {
          result.errors += 1
          console.warn(
            `[embedder] row ${row.id} failed:`,
            err instanceof Error ? err.message : err,
          )
        }
      }),
    )
  }
}

// ---------------------------------------------------------------------------
// 1. companies
// ---------------------------------------------------------------------------

interface CompanyRow {
  id: string
  name: string | null
  industry: string | null
  description: string | null
  city: string | null
  country: string | null
  embedding_content_hash: string | null
}

export async function runCompaniesEmbedder(
  supabase: SupabaseClient,
  tenantId: string,
  embedFn: EmbedFn = defaultEmbedder,
): Promise<EmbedderResult> {
  const result: EmbedderResult = { considered: 0, embedded: 0, skipped_unchanged: 0, errors: 0 }
  const { data } = await supabase
    .from('companies')
    .select('id, name, industry, description, city, country, embedding_content_hash')
    .eq('tenant_id', tenantId)
    .limit(2000)

  const rows = (data ?? []) as CompanyRow[]
  await embedRows<CompanyRow>({
    rows,
    buildText: (r) =>
      [r.name, r.industry, r.description, [r.city, r.country].filter(Boolean).join(', ')]
        .filter((s): s is string => !!s && s.length > 0)
        .join('\n'),
    buildHash: (r) =>
      hashContent(
        [r.name, r.industry, r.description, r.city, r.country].filter(Boolean).join('|'),
      ),
    hasUnchangedHash: (r, h) => r.embedding_content_hash === h,
    writeEmbedding: async (r, emb, h) => {
      await supabase
        .from('companies')
        .update({
          embedding: vectorString(emb),
          embedding_content_hash: h,
          embedding_updated_at: new Date().toISOString(),
        })
        .eq('id', r.id)
        .eq('tenant_id', tenantId)
    },
    embedFn,
    result,
  })
  return result
}

// ---------------------------------------------------------------------------
// 2. signals
// ---------------------------------------------------------------------------

interface SignalRow {
  id: string
  signal_type: string | null
  title: string | null
  description: string | null
  embedding: string | null
}

export async function runSignalsEmbedder(
  supabase: SupabaseClient,
  tenantId: string,
  embedFn: EmbedFn = defaultEmbedder,
): Promise<EmbedderResult> {
  const result: EmbedderResult = { considered: 0, embedded: 0, skipped_unchanged: 0, errors: 0 }
  // Signals are append-mostly + immutable; once embedded we don't
  // re-embed. So `embedding IS NULL` is the right filter.
  const { data } = await supabase
    .from('signals')
    .select('id, signal_type, title, description, embedding')
    .eq('tenant_id', tenantId)
    .is('embedding', null)
    .limit(500)

  const rows = (data ?? []) as SignalRow[]
  await embedRows<SignalRow>({
    rows,
    buildText: (r) => [r.signal_type, r.title, r.description].filter(Boolean).join('\n'),
    // Hash unused (we filter by embedding IS NULL above) — pass row id
    // so the helper has something to compute against.
    buildHash: (r) => r.id,
    hasUnchangedHash: () => false,
    writeEmbedding: async (r, emb) => {
      await supabase
        .from('signals')
        .update({
          embedding: vectorString(emb),
          embedding_updated_at: new Date().toISOString(),
        })
        .eq('id', r.id)
        .eq('tenant_id', tenantId)
    },
    embedFn,
    result,
  })
  return result
}

// ---------------------------------------------------------------------------
// 3. relationship_notes
// ---------------------------------------------------------------------------

interface NoteRow {
  id: string
  body: string | null
  embedding: string | null
}

export async function runNotesEmbedder(
  supabase: SupabaseClient,
  tenantId: string,
  embedFn: EmbedFn = defaultEmbedder,
): Promise<EmbedderResult> {
  const result: EmbedderResult = { considered: 0, embedded: 0, skipped_unchanged: 0, errors: 0 }

  // Table-existence check — older deployments may not have it. Skip
  // gracefully so the cron driver doesn't error.
  const { error: probe } = await supabase
    .from('relationship_notes')
    .select('id')
    .eq('tenant_id', tenantId)
    .limit(1)
  if (probe?.code === '42P01') return result // undefined_table

  const { data } = await supabase
    .from('relationship_notes')
    .select('id, body, embedding')
    .eq('tenant_id', tenantId)
    .is('embedding', null)
    .limit(500)

  const rows = (data ?? []) as NoteRow[]
  await embedRows<NoteRow>({
    rows,
    buildText: (r) => r.body ?? '',
    buildHash: (r) => r.id,
    hasUnchangedHash: () => false,
    writeEmbedding: async (r, emb) => {
      await supabase
        .from('relationship_notes')
        .update({
          embedding: vectorString(emb),
          embedding_updated_at: new Date().toISOString(),
        })
        .eq('id', r.id)
        .eq('tenant_id', tenantId)
    },
    embedFn,
    result,
  })
  return result
}

// ---------------------------------------------------------------------------
// 4. business_skills (exemplars)
// ---------------------------------------------------------------------------

interface SkillRow {
  id: string
  content_text: string | null
  embedding: string | null
}

export async function runExemplarsEmbedder(
  supabase: SupabaseClient,
  tenantId: string,
  embedFn: EmbedFn = defaultEmbedder,
): Promise<EmbedderResult> {
  const result: EmbedderResult = { considered: 0, embedded: 0, skipped_unchanged: 0, errors: 0 }
  const { data } = await supabase
    .from('business_skills')
    .select('id, content_text, embedding')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .is('embedding', null)
    .limit(200)

  const rows = (data ?? []) as SkillRow[]
  await embedRows<SkillRow>({
    rows,
    buildText: (r) => r.content_text ?? '',
    buildHash: (r) => r.id,
    hasUnchangedHash: () => false,
    writeEmbedding: async (r, emb) => {
      await supabase
        .from('business_skills')
        .update({
          embedding: vectorString(emb),
          embedding_updated_at: new Date().toISOString(),
        })
        .eq('id', r.id)
        .eq('tenant_id', tenantId)
    },
    embedFn,
    result,
  })
  return result
}

// ---------------------------------------------------------------------------
// 5. tenant_memories (Phase 6 — A1.1 of the Two-Level Second Brain)
// ---------------------------------------------------------------------------
// Embeds the body of every approved/pinned memory atom so the
// match_memories RPC and the memory-aware slices have actual vectors
// to search. Mirrors the companies pipeline pattern: hash the
// embed-text, skip when the hash is unchanged. Without this hash
// column (added in migration 022) every nightly cron would re-embed
// every approved row — burning OpenAI budget for no semantic change.
//
// Filter: any approved/pinned memory whose embedding is NULL or whose
// content_hash is missing. Proposed rows are deliberately skipped —
// they're either pending admin approval or about to be auto-decayed
// by consolidateMemories. Embedding before approval would waste
// tokens on rows that may never see daylight.

interface TenantMemoryRow {
  id: string
  title: string | null
  body: string | null
  embedding_content_hash: string | null
}

export async function runMemoriesEmbedder(
  supabase: SupabaseClient,
  tenantId: string,
  embedFn: EmbedFn = defaultEmbedder,
): Promise<EmbedderResult> {
  const result: EmbedderResult = { considered: 0, embedded: 0, skipped_unchanged: 0, errors: 0 }
  const { data } = await supabase
    .from('tenant_memories')
    .select('id, title, body, embedding_content_hash')
    .eq('tenant_id', tenantId)
    .in('status', ['approved', 'pinned'])
    .limit(500)

  const rows = (data ?? []) as TenantMemoryRow[]
  await embedRows<TenantMemoryRow>({
    rows,
    buildText: (r) => [r.title, r.body].filter((s): s is string => !!s && s.length > 0).join('\n'),
    buildHash: (r) => hashContent([r.title ?? '', r.body ?? ''].join('|')),
    hasUnchangedHash: (r, h) => r.embedding_content_hash === h,
    writeEmbedding: async (r, emb, h) => {
      await supabase
        .from('tenant_memories')
        .update({
          embedding: vectorString(emb),
          embedding_content_hash: h,
          embedding_updated_at: new Date().toISOString(),
        })
        .eq('id', r.id)
        .eq('tenant_id', tenantId)
    },
    embedFn,
    result,
  })
  return result
}

// ---------------------------------------------------------------------------
// 6. wiki_pages (Phase 6 — A1.1 + 2.1 of the Two-Level Second Brain)
// ---------------------------------------------------------------------------
// Same pattern as tenant_memories. Once compileWikiPages writes a
// page (or re-writes one with a new source_atoms_hash), the
// embedding_content_hash flips to NULL and this pipeline picks it up
// on the next cron tick. The match_wiki_pages RPC then becomes
// available for fallback semantic search inside slices.

interface WikiPageRow {
  id: string
  title: string | null
  body_md: string | null
  embedding_content_hash: string | null
}

export async function runWikiPagesEmbedder(
  supabase: SupabaseClient,
  tenantId: string,
  embedFn: EmbedFn = defaultEmbedder,
): Promise<EmbedderResult> {
  const result: EmbedderResult = { considered: 0, embedded: 0, skipped_unchanged: 0, errors: 0 }

  // Skip gracefully if the wiki_pages table doesn't exist yet
  // (deployments still on migration 021 get a no-op rather than an
  // error). Same defensive pattern as runNotesEmbedder.
  const { error: probe } = await supabase
    .from('wiki_pages')
    .select('id')
    .eq('tenant_id', tenantId)
    .limit(1)
  if (probe?.code === '42P01') return result // undefined_table

  const { data } = await supabase
    .from('wiki_pages')
    .select('id, title, body_md, embedding_content_hash')
    .eq('tenant_id', tenantId)
    .in('status', ['published', 'pinned'])
    .limit(500)

  const rows = (data ?? []) as WikiPageRow[]
  await embedRows<WikiPageRow>({
    rows,
    buildText: (r) =>
      [r.title, r.body_md].filter((s): s is string => !!s && s.length > 0).join('\n'),
    buildHash: (r) => hashContent([r.title ?? '', r.body_md ?? ''].join('|')),
    hasUnchangedHash: (r, h) => r.embedding_content_hash === h,
    writeEmbedding: async (r, emb, h) => {
      await supabase
        .from('wiki_pages')
        .update({
          embedding: vectorString(emb),
          embedding_content_hash: h,
          embedding_updated_at: new Date().toISOString(),
        })
        .eq('id', r.id)
        .eq('tenant_id', tenantId)
    },
    embedFn,
    result,
  })
  return result
}

// ---------------------------------------------------------------------------
// 7. framework_chunks (platform-wide, no tenantId)
// ---------------------------------------------------------------------------
// The chunk seed runs separately (a one-shot CLI script that walks
// `apps/web/src/lib/agent/knowledge/sales-frameworks/frameworks/`
// and inserts (slug, section, content) rows). This embedder picks up
// any unembedded chunks and embeds them.

interface FrameworkChunkRow {
  id: string
  framework_slug: string
  section: string
  content: string
}

export async function runFrameworksEmbedder(
  supabase: SupabaseClient,
  embedFn: EmbedFn = defaultEmbedder,
): Promise<EmbedderResult> {
  const result: EmbedderResult = { considered: 0, embedded: 0, skipped_unchanged: 0, errors: 0 }
  const { data } = await supabase
    .from('framework_chunks')
    .select('id, framework_slug, section, content')
    .is('embedding', null)
    .limit(1000)

  const rows = (data ?? []) as FrameworkChunkRow[]
  await embedRows<FrameworkChunkRow>({
    rows,
    buildText: (r) => `${r.framework_slug} / ${r.section}\n\n${r.content}`,
    buildHash: (r) => r.id,
    hasUnchangedHash: () => false,
    writeEmbedding: async (r, emb) => {
      await supabase
        .from('framework_chunks')
        .update({
          embedding: vectorString(emb),
          embedding_updated_at: new Date().toISOString(),
        })
        .eq('id', r.id)
    },
    embedFn,
    result,
  })
  return result
}

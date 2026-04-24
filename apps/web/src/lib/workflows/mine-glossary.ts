import type { SupabaseClient } from '@supabase/supabase-js'
import { urn } from '@prospector/core'
import { proposeMemory } from '@/lib/memory/writer'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * mine-glossary — nightly workflow that surfaces tenant-specific terms
 * (product names, internal acronyms, customer-named processes) from
 * transcript content as `glossary_term` memories.
 *
 * Method: light TF-IDF on capitalised n-grams (1-3 words) drawn from
 * recent transcripts' themes + summaries. We avoid the heavyweight
 * NLP route (RAKE / TextRank) — the volume per tenant is small enough
 * (typically <500 transcripts in the 90-day window) that a simple
 * frequency + capitalisation heuristic produces clean candidates.
 *
 * Filter rules:
 *   - At least 3 occurrences across distinct transcripts.
 *   - Not in the COMMON_WORDS denylist.
 *   - At least one capital letter (proper nouns / acronyms).
 *   - 2-30 characters.
 *
 * Confidence reflects: (occurrence count) × (capitalisation strength).
 * Glossary memories with confidence < 0.4 surface as "low-confidence"
 * on /admin/memory so admins can prune false positives.
 *
 * Cost: zero AI. Pure SQL + string ops.
 */

const MIN_OCCURRENCES = 3
const MAX_TERMS_PER_RUN = 30
const MIN_LENGTH = 2
const MAX_LENGTH = 30

// Denylist of common words that should never become glossary terms even
// if they appear with capitalisation. Kept small + obvious — the
// admin UI is the safety net for the rest.
const COMMON_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'they', 'their', 'have',
  'will', 'from', 'about', 'when', 'what', 'where', 'how', 'who',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
  'q1', 'q2', 'q3', 'q4', 'fy24', 'fy25', 'fy26',
  'meeting', 'call', 'email', 'pricing', 'budget', 'contract',
])

interface TranscriptRow {
  id: string
  themes: string[] | null
  summary: string | null
}

export async function enqueueMineGlossary(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'mine_glossary',
    idempotencyKey: `mg:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runMineGlossary(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_transcripts',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

        const { data: transcripts } = await ctx.supabase
          .from('transcripts')
          .select('id, themes, summary')
          .eq('tenant_id', ctx.tenantId)
          .gte('occurred_at', since)
          .limit(2000)

        const rows = (transcripts ?? []) as TranscriptRow[]
        if (rows.length === 0) {
          return { skipped: true, reason: 'no_transcripts_in_window' }
        }
        return { transcripts: rows }
      },
    },

    {
      name: 'extract_candidate_terms',
      run: async (ctx) => {
        const loaded = ctx.stepState.load_transcripts as
          | { skipped?: boolean; transcripts?: TranscriptRow[] }
          | undefined
        if (!loaded || loaded.skipped || !loaded.transcripts) {
          return { skipped: true }
        }

        // For each candidate term: distinct-transcript count + sample
        // transcript ids. Distinct-count rather than total count
        // protects against one chatty transcript dominating.
        const termTranscripts = new Map<string, Set<string>>()

        const recordTerm = (term: string, transcriptId: string): void => {
          const cleaned = term.trim()
          if (cleaned.length < MIN_LENGTH || cleaned.length > MAX_LENGTH) return
          if (!hasCapital(cleaned)) return
          if (COMMON_WORDS.has(cleaned.toLowerCase())) return

          let set = termTranscripts.get(cleaned)
          if (!set) {
            set = new Set()
            termTranscripts.set(cleaned, set)
          }
          set.add(transcriptId)
        }

        for (const t of loaded.transcripts) {
          // Themes are the highest-signal source: the ingester already
          // de-noised them. Pull n-grams (1-3 words) from each theme.
          for (const rawTheme of t.themes ?? []) {
            if (typeof rawTheme !== 'string') continue
            for (const ng of nGrams(rawTheme, 1, 3)) {
              recordTerm(ng, t.id)
            }
          }
          // Summaries are noisier; we only pull single capitalised
          // words from them so the false-positive rate stays low.
          for (const word of (t.summary ?? '').split(/\s+/)) {
            const cleaned = word.replace(/[^A-Za-z0-9-]/g, '')
            if (cleaned.length < MIN_LENGTH) continue
            recordTerm(cleaned, t.id)
          }
        }

        // Filter to threshold + cap; rank by occurrence count then
        // capitalisation strength.
        const ranked = Array.from(termTranscripts.entries())
          .filter(([, ids]) => ids.size >= MIN_OCCURRENCES)
          .map(([term, ids]) => ({
            term,
            count: ids.size,
            sample_transcript_ids: Array.from(ids).slice(0, 6),
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, MAX_TERMS_PER_RUN)

        if (ranked.length === 0) {
          return { skipped: true, reason: 'no_terms_above_threshold' }
        }

        return { ranked }
      },
    },

    {
      name: 'write_glossary_memories',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const ext = ctx.stepState.extract_candidate_terms as
          | {
              skipped?: boolean
              ranked?: Array<{
                term: string
                count: number
                sample_transcript_ids: string[]
              }>
            }
          | undefined
        if (!ext || ext.skipped || !ext.ranked) return { skipped: true }

        const writes: string[] = []
        for (const term of ext.ranked) {
          const sampleUrns = term.sample_transcript_ids.map((id) =>
            urn.transcript(ctx.tenantId!, id),
          )

          // Confidence balances frequency with all-caps signals
          // (acronyms get a small boost — they're rarely false positives).
          const allCapsBoost = isAllCaps(term.term) ? 0.1 : 0
          const confidence = Math.min(
            0.95,
            0.25 +
              Math.min(0.6, Math.log10(Math.max(term.count, 3)) * 0.4) +
              allCapsBoost,
          )

          const r = await proposeMemory(ctx.supabase, {
            tenant_id: ctx.tenantId,
            kind: 'glossary_term',
            scope: {},
            title: term.term,
            body: `Tenant-specific term surfaced in ${term.count} distinct transcripts. Treat "${term.term}" as a known proper noun / product / acronym in this account base — use the term verbatim in agent responses, do not paraphrase.`,
            evidence: {
              urns: sampleUrns,
              counts: { distinct_transcripts: term.count },
              samples: [term.term],
            },
            confidence,
            source_workflow: 'mine_glossary',
          })
          writes.push(r.memory_id)
        }

        return { memories_written: writes.length, memory_ids: writes }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

function hasCapital(s: string): boolean {
  return /[A-Z]/.test(s)
}

function isAllCaps(s: string): boolean {
  // Acronyms: 2-6 chars, all caps + maybe hyphen / digit.
  if (s.length < 2 || s.length > 6) return false
  return /^[A-Z][A-Z0-9-]+$/.test(s)
}

function nGrams(text: string, min: number, max: number): string[] {
  const tokens = text.split(/[\s,;:.!?()/\\]+/).filter((t) => t.length > 0)
  const out: string[] = []
  for (let n = min; n <= max; n += 1) {
    for (let i = 0; i + n <= tokens.length; i += 1) {
      out.push(tokens.slice(i, i + n).join(' '))
    }
  }
  return out
}

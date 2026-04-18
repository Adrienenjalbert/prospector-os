'use server'

import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase/server'

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export interface CitationRecord {
  id: string
  claim_text: string
  source_type: string
  source_id: string | null
  source_url: string | null
  confidence: number | null
}

/**
 * Fetches citations associated with a given agent interaction id.
 * Used by the chat UI to render source pills under the response.
 *
 * Pre-this-change a single broad `try/catch { return [] }` collapsed
 * three different failure modes into "no citations":
 *
 *   - Unauthenticated user (real auth bug, hidden as empty pills)
 *   - Profile lookup error (DB outage, hidden as empty pills)
 *   - Citation query error (Postgres / RLS error, hidden as empty pills)
 *   - Genuine empty result (zero rows for a turn that called no tools)
 *
 * Now we narrow the swallow to auth/profile-not-found (legitimate
 * empty-state cases the UI already handles via empty pills) and log
 * + return empty for the unexpected ones, so an outage at least
 * leaves a breadcrumb in the function logs.
 */
export async function getCitationsForInteraction(
  interactionId: string,
): Promise<CitationRecord[]> {
  let supabase
  try {
    supabase = await createSupabaseServer()
  } catch (err) {
    // Server-client construction can throw if cookies are unreadable
    // (eg. middleware bug, edge runtime mismatch). Log loudly because
    // it would otherwise look like "every chat suddenly has no
    // citations" with no clue why.
    console.warn('[citations] supabase server client failed:', err)
    return []
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    // Not an error — the user is signed out. The chat UI never calls
    // this for an unauthenticated session, but the action contract
    // shouldn't crash on it either.
    return []
  }

  const { data: profile, error: profileErr } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  if (profileErr) {
    console.warn('[citations] user_profiles lookup failed:', profileErr.message)
    return []
  }
  if (!profile?.tenant_id) return []

  const service = getServiceSupabase()
  const { data, error } = await service
    .from('agent_citations')
    .select('id, claim_text, source_type, source_id, source_url, confidence')
    .eq('interaction_id', interactionId)
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: true })

  if (error) {
    // A real query failure (RLS, network, schema drift) deserves a
    // log entry — the previous silent return masked these.
    console.warn(
      `[citations] agent_citations query failed for interaction ${interactionId}:`,
      error.message,
    )
    return []
  }

  return (data ?? []) as CitationRecord[]
}

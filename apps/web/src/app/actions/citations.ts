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
 */
export async function getCitationsForInteraction(
  interactionId: string,
): Promise<CitationRecord[]> {
  try {
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()
    if (!profile?.tenant_id) return []

    const service = getServiceSupabase()
    const { data } = await service
      .from('agent_citations')
      .select('id, claim_text, source_type, source_id, source_url, confidence')
      .eq('interaction_id', interactionId)
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: true })

    return (data ?? []) as CitationRecord[]
  } catch {
    return []
  }
}

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

async function resolveRepContext() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, rep_profile_id')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) throw new Error('No profile')

  const { data: rep } = await supabase
    .from('rep_profiles')
    .select('crm_id')
    .eq('id', profile.rep_profile_id)
    .single()

  return {
    tenant_id: profile.tenant_id,
    rep_crm_id: rep?.crm_id ?? user.id,
  }
}

export async function saveRelationshipNote(
  contactId: string,
  companyId: string,
  noteType: string,
  content: string
) {
  const ctx = await resolveRepContext()
  const supabase = getServiceSupabase()

  const { error } = await supabase.from('relationship_notes').insert({
    tenant_id: ctx.tenant_id,
    contact_id: contactId,
    company_id: companyId,
    rep_crm_id: ctx.rep_crm_id,
    note_type: noteType,
    content,
    source: 'manual',
  })

  if (error) throw new Error(`Failed to save note: ${error.message}`)
}

export async function getRelationshipNotes(contactId: string) {
  const ctx = await resolveRepContext()
  const supabase = getServiceSupabase()

  const { data } = await supabase
    .from('relationship_notes')
    .select('id, note_type, content, source, created_at')
    .eq('tenant_id', ctx.tenant_id)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(20)

  return data ?? []
}

export async function updateContactPersonalDetails(
  contactId: string,
  details: {
    birthday?: string | null
    work_anniversary?: string | null
    personal_interests?: string[]
    communication_preference?: string | null
    preferred_contact_time?: string | null
  }
) {
  const ctx = await resolveRepContext()
  const supabase = getServiceSupabase()

  const update: Record<string, unknown> = {}
  if (details.birthday !== undefined) update.birthday = details.birthday
  if (details.work_anniversary !== undefined) update.work_anniversary = details.work_anniversary
  if (details.personal_interests !== undefined) update.personal_interests = details.personal_interests
  if (details.communication_preference !== undefined) update.communication_preference = details.communication_preference
  if (details.preferred_contact_time !== undefined) update.preferred_contact_time = details.preferred_contact_time

  if (Object.keys(update).length === 0) return

  const { error } = await supabase
    .from('contacts')
    .update(update)
    .eq('id', contactId)
    .eq('tenant_id', ctx.tenant_id)

  if (error) throw new Error(`Failed to update contact: ${error.message}`)
}

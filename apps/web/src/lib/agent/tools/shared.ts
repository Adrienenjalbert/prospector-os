import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function getServiceSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function resolveCompanyByName(
  supabase: SupabaseClient,
  tenantId: string,
  name: string
) {
  const { data } = await supabase
    .from('companies')
    .select('*')
    .eq('tenant_id', tenantId)
    .ilike('name', `%${name}%`)
    .limit(1)
    .single()
  return data
}

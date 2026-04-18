import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminConfigClient } from './admin-config-client'

export const metadata = { title: 'Configuration — Admin' }
export const dynamic = 'force-dynamic'

/**
 * Server-side gate for /admin/config. The previous version was a pure
 * client component with no role check — `tenant_id` was scoped at the
 * API layer but the UI itself loaded for any authenticated user. Anyone
 * with a Supabase session could open the page and see the form.
 *
 * We mirror the pattern used by /admin/roi and /admin/adaptation:
 * server component performs auth + role check, redirects on failure,
 * then renders the client component as a child.
 */
export default async function AdminConfigPage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.tenant_id) redirect('/login')
  if (!['admin', 'revops'].includes(profile.role ?? '')) {
    redirect('/inbox')
  }

  return <AdminConfigClient />
}

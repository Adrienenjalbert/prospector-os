import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { emitAgentEvent, urn } from '@prospector/core'

/**
 * POST /api/admin/wiki/[id]
 *
 * Lifecycle transitions for a `wiki_pages` row. Mirrors the auth +
 * audit pattern in /api/admin/memory/[id] so admin actions land in
 * the same calibration_ledger and the existing rollback API can
 * undo them.
 *
 * Actions:
 *   pin       — status='pinned' (exempt from auto-archive in lintWiki)
 *   archive   — status='archived' (slices stop loading)
 *   recompile — clears source_atoms_hash so compileWikiPages re-runs
 *               this page on the next workflow drain
 */

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

const ACTIONS = ['pin', 'archive', 'recompile'] as const
type Action = (typeof ACTIONS)[number]

const requestSchema = z.object({
  action: z.enum(ACTIONS),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: pageId } = await params
  if (!isUuid(pageId)) {
    return NextResponse.json({ error: 'Invalid page id' }, { status: 400 })
  }

  const supabase = getServiceSupabase()

  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = authHeader.slice(7)

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 401 })
  }
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    )
  }

  const { data: page } = await supabase
    .from('wiki_pages')
    .select('id, kind, slug, title, status, source_atoms_hash')
    .eq('id', pageId)
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle()
  if (!page) {
    return NextResponse.json({ error: 'Page not found' }, { status: 404 })
  }

  const beforeStatus = page.status as string
  const update = updateForAction(parsed.data.action)

  const { data: updated, error: updateErr } = await supabase
    .from('wiki_pages')
    .update(update.fields)
    .eq('id', pageId)
    .eq('tenant_id', profile.tenant_id)
    .select(
      'id, kind, slug, title, status, confidence, decay_score, last_compiled_at, source_atoms_hash',
    )
    .single()
  if (updateErr || !updated) {
    return NextResponse.json(
      { error: `Update failed: ${updateErr?.message ?? 'no row returned'}` },
      { status: 500 },
    )
  }

  // Audit trail. change_type uses a wiki-specific value so the admin
  // audit feed can group these distinctly from memory transitions.
  await supabase.from('calibration_ledger').insert({
    tenant_id: profile.tenant_id,
    change_type: 'wiki_page_status',
    target_path: `wiki_pages.${pageId}.status`,
    before_value: { status: beforeStatus, source_atoms_hash: page.source_atoms_hash },
    after_value: {
      status: updated.status,
      action: parsed.data.action,
    },
    observed_lift: null,
    applied_by: user.id,
    notes: `Wiki page ${page.kind} "${page.title.slice(0, 80)}" → ${parsed.data.action}`,
  })

  await emitAgentEvent(supabase, {
    tenant_id: profile.tenant_id,
    user_id: user.id,
    event_type: 'wiki_page_compiled',
    subject_urn: urn.wikiPage(profile.tenant_id, pageId),
    payload: {
      page_id: pageId,
      kind: page.kind,
      slug: page.slug,
      action: parsed.data.action,
      before_status: beforeStatus,
    },
  })

  return NextResponse.json({ page: updated })
}

function updateForAction(action: Action): { fields: Record<string, unknown> } {
  const nowIso = new Date().toISOString()
  switch (action) {
    case 'pin':
      return { fields: { status: 'pinned', updated_at: nowIso } }
    case 'archive':
      return { fields: { status: 'archived', updated_at: nowIso } }
    case 'recompile':
      // Clear source_atoms_hash so the compile workflow's idempotency
      // check skips this row on the next drain. status stays as-is.
      return { fields: { source_atoms_hash: null, updated_at: nowIso } }
    default: {
      const exhaustive: never = action
      throw new Error(`Unknown action: ${exhaustive as string}`)
    }
  }
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

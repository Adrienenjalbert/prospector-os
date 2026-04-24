import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { DEFAULT_TENANT_WIKI_SCHEMA } from '@/lib/wiki/schema-template'
import { SchemaEditorForm } from './schema-editor-form'

export const metadata = { title: 'Wiki schema' }
export const dynamic = 'force-dynamic'

/**
 * /admin/wiki/schema — Phase 6 (Section 2.6) of the Two-Level Second Brain.
 *
 * The per-tenant CLAUDE.md. Edited by admins; loaded by
 * compileWikiPages into the system prompt so each tenant's brain is
 * shaped by its own conventions. Karpathy's "schema is the product"
 * rule, applied per tenant.
 *
 * The reflectMemories workflow (Section 3.3) may propose schema diffs
 * weekly; admins approve them here. `auto_revisions` counts how many
 * such diffs landed.
 */

export default async function WikiSchemaPage() {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.tenant_id) redirect('/login')
  if (profile.role !== 'admin') redirect('/admin/wiki')

  const { data: schema } = await supabase
    .from('tenant_wiki_schema')
    .select('body_md, version, updated_at, updated_by, auto_revisions')
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle()

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="text-xs">
        <Link href="/admin/wiki" className="text-zinc-500 hover:text-zinc-300">
          ← Back to wiki
        </Link>
      </div>

      <h1 className="mt-3 text-2xl font-semibold text-zinc-100">Wiki schema</h1>
      <p className="mt-1 text-sm text-zinc-500">
        The per-tenant{' '}
        <span className="font-mono">CLAUDE.md</span> the wiki compiler reads on
        every nightly run. Tells the LLM what conventions, naming, citation
        rules, and lint thresholds apply to this tenant's brain.
      </p>

      <div className="mt-4 flex gap-3 text-[11px] text-zinc-500">
        <span>v{schema?.version ?? 1}</span>
        {schema?.updated_at && (
          <span>updated {new Date(schema.updated_at).toLocaleString()}</span>
        )}
        <span>{schema?.auto_revisions ?? 0} auto-revisions accepted</span>
      </div>

      <SchemaEditorForm
        initialBody={schema?.body_md ?? DEFAULT_TENANT_WIKI_SCHEMA}
        initialVersion={schema?.version ?? 0}
      />
      {!schema && (
        <p className="mt-2 text-[11px] text-zinc-500">
          No saved schema yet — pre-populated from the platform default
          template. Edit and save to create v1 for this tenant.
        </p>
      )}

      <section className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">
        <h2 className="text-sm font-semibold text-zinc-200">What goes in here</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Page kinds</strong> the compiler should produce and what
            distinguishes them (entity vs concept vs playbook).
          </li>
          <li>
            <strong>Naming conventions</strong> for slugs (kebab-case for
            industries, full role names for personas, etc.).
          </li>
          <li>
            <strong>Citation rules</strong> — what every claim must cite
            (atom URN, CRM URN, transcript URN).
          </li>
          <li>
            <strong>Tenant-specific vocabulary</strong> — your acronyms,
            product names, persona shorthand the compiler should preserve.
          </li>
          <li>
            <strong>Lint thresholds</strong> — when an orphan or stale
            warning becomes an auto-archive. Defaults: 30 days no inbound
            links, decay_score &lt; 0.2 + zero citations in 30d.
          </li>
        </ul>
        <p className="mt-3 text-zinc-500">
          The schema co-evolves with use. The compiler will propose diffs
          weekly via the reflectMemories workflow once Section 3.3 ships;
          you approve, reject, or refine here.
        </p>
      </section>
    </div>
  )
}

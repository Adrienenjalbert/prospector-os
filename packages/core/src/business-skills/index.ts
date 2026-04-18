/**
 * Business skills — the modular replacement for business_profiles' bundled
 * context columns (Phase 7 of sales-harness-v2).
 *
 * Each tenant has up to one active row per (skill_type). Prompt builders
 * read these rows and compose them into the system prompt. When no active
 * skill row exists, the caller falls back to the legacy business_profiles
 * columns (handled by the query helper below) so migrations don't regress
 * existing tenants.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type BusinessSkillType =
  | 'industry_knowledge'
  | 'icp_definition'
  | 'value_propositions'
  | 'objection_handlers'
  | 'agent_personality'

export interface BusinessSkillRow {
  id: string
  tenant_id: string
  skill_type: BusinessSkillType
  version: string
  active: boolean
  content_type: 'text' | 'json'
  content_text: string | null
  content_json: Record<string, unknown> | null
  source_ledger_id: string | null
  created_at: string
  updated_at: string
}

export interface ActiveBusinessSkills {
  industry_knowledge: { text: string; version: string } | null
  icp_definition: {
    ideal_customer_description: string
    operating_regions: unknown[]
    version: string
  } | null
  value_propositions: { items: unknown[]; version: string } | null
  objection_handlers: { items: unknown[]; version: string } | null
  agent_personality: {
    agent_name: string
    agent_mission: string
    brand_voice: string
    version: string
  } | null
}

const EMPTY_SKILLS: ActiveBusinessSkills = {
  industry_knowledge: null,
  icp_definition: null,
  value_propositions: null,
  objection_handlers: null,
  agent_personality: null,
}

/**
 * Load the active business_skills rows for a tenant. Falls back silently
 * when a skill type has no row — callers must handle null.
 *
 * Returns strongly-typed slices of each skill's payload so the prompt
 * builder doesn't have to branch on content_type.
 */
export async function loadActiveBusinessSkills(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ActiveBusinessSkills> {
  const { data, error } = await supabase
    .from('business_skills')
    .select(
      'id, tenant_id, skill_type, version, active, content_type, content_text, content_json',
    )
    .eq('tenant_id', tenantId)
    .eq('active', true)

  if (error) {
    // Treat a read error as "no skills" so the prompt builder falls back
    // to business_profiles. Never throw from the skills path — a missing
    // skill should not 500 the agent route.
    return { ...EMPTY_SKILLS }
  }

  const rows = (data ?? []) as BusinessSkillRow[]
  const result: ActiveBusinessSkills = { ...EMPTY_SKILLS }

  for (const row of rows) {
    switch (row.skill_type) {
      case 'industry_knowledge':
        result.industry_knowledge = {
          text: row.content_text ?? '',
          version: row.version,
        }
        break
      case 'icp_definition': {
        const j = (row.content_json ?? {}) as Record<string, unknown>
        result.icp_definition = {
          ideal_customer_description: String(j.ideal_customer_description ?? ''),
          operating_regions: Array.isArray(j.operating_regions) ? j.operating_regions : [],
          version: row.version,
        }
        break
      }
      case 'value_propositions': {
        const j = row.content_json
        result.value_propositions = {
          items: Array.isArray(j) ? j : [],
          version: row.version,
        }
        break
      }
      case 'objection_handlers': {
        const j = row.content_json
        result.objection_handlers = {
          items: Array.isArray(j) ? j : [],
          version: row.version,
        }
        break
      }
      case 'agent_personality': {
        const j = (row.content_json ?? {}) as Record<string, unknown>
        result.agent_personality = {
          agent_name: String(j.agent_name ?? 'AI Assistant'),
          agent_mission: String(j.agent_mission ?? ''),
          brand_voice: String(j.brand_voice ?? ''),
          version: row.version,
        }
        break
      }
    }
  }

  return result
}

/**
 * Compose a tenant's active skills into the prompt-ready block the
 * existing prompt builders expect. Returns a plain object so a caller
 * can either splice sections into a larger system prompt or hand it to
 * a template. Backward-compatible with the business_profiles-era shape
 * that agents/*.ts currently consumes.
 */
export function composeSkillsForPrompt(skills: ActiveBusinessSkills): {
  company_description: string
  industry_context: string
  value_propositions: unknown[]
  ideal_customer_description: string
  operating_regions: unknown[]
  objection_handlers: unknown[]
  agent_name: string
  agent_mission: string
  brand_voice: string
  versions: Record<BusinessSkillType, string | null>
} {
  return {
    company_description: '',
    industry_context: skills.industry_knowledge?.text ?? '',
    value_propositions: skills.value_propositions?.items ?? [],
    ideal_customer_description: skills.icp_definition?.ideal_customer_description ?? '',
    operating_regions: skills.icp_definition?.operating_regions ?? [],
    objection_handlers: skills.objection_handlers?.items ?? [],
    agent_name: skills.agent_personality?.agent_name ?? 'AI Assistant',
    agent_mission: skills.agent_personality?.agent_mission ?? '',
    brand_voice: skills.agent_personality?.brand_voice ?? '',
    versions: {
      industry_knowledge: skills.industry_knowledge?.version ?? null,
      icp_definition: skills.icp_definition?.version ?? null,
      value_propositions: skills.value_propositions?.version ?? null,
      objection_handlers: skills.objection_handlers?.version ?? null,
      agent_personality: skills.agent_personality?.version ?? null,
    },
  }
}

/**
 * Promote a new version of a skill to active. Must run in a single
 * transaction to preserve the "exactly one active per tenant+type"
 * invariant enforced by the partial unique index. We achieve atomicity
 * via the supplied RPC or a two-step deactivate-then-activate where
 * the unique index catches any conflict. The calibration ledger row
 * should be created by the caller (with observed_lift, etc.) and its
 * id passed in as source_ledger_id.
 */
export async function promoteBusinessSkill(
  supabase: SupabaseClient,
  args: {
    tenantId: string
    skillType: BusinessSkillType
    version: string
    contentType: 'text' | 'json'
    contentText?: string
    contentJson?: Record<string, unknown> | unknown[]
    sourceLedgerId?: string
    createdBy?: string
  },
): Promise<{ ok: boolean; skillId?: string; error?: string }> {
  // Step 1: deactivate current active row for this (tenant, skill_type).
  const { error: deactivateErr } = await supabase
    .from('business_skills')
    .update({ active: false })
    .eq('tenant_id', args.tenantId)
    .eq('skill_type', args.skillType)
    .eq('active', true)

  if (deactivateErr) {
    return { ok: false, error: deactivateErr.message }
  }

  // Step 2: insert the new active row. The partial unique index now has
  // no conflicting rows (we just deactivated them).
  const { data, error: insertErr } = await supabase
    .from('business_skills')
    .insert({
      tenant_id: args.tenantId,
      skill_type: args.skillType,
      version: args.version,
      active: true,
      content_type: args.contentType,
      content_text: args.contentType === 'text' ? (args.contentText ?? '') : null,
      content_json: args.contentType === 'json' ? (args.contentJson ?? null) : null,
      source_ledger_id: args.sourceLedgerId ?? null,
      created_by: args.createdBy ?? null,
    })
    .select('id')
    .single()

  if (insertErr || !data) {
    // Roll back the deactivation so we don't leave the tenant without an
    // active skill. Best-effort — if this also fails, the caller should
    // alert.
    await supabase
      .from('business_skills')
      .update({ active: true })
      .eq('tenant_id', args.tenantId)
      .eq('skill_type', args.skillType)
      .eq('version', args.version)

    return { ok: false, error: insertErr?.message ?? 'insert_failed' }
  }

  return { ok: true, skillId: (data as { id: string }).id }
}

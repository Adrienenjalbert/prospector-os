/**
 * Seed script for tool_registry + business_profiles.
 *
 * Usage:
 *   npx tsx scripts/seed-tools.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
 * apps/web/.env.local (or exported in the shell).
 *
 * Idempotent — uses upsert so it can be re-run safely.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Built-in tool definitions
// ---------------------------------------------------------------------------

interface ToolSeed {
  slug: string
  display_name: string
  description: string
  category: 'data_query' | 'action' | 'analysis' | 'generation'
  tool_type: 'builtin'
  execution_config: { handler: string }
  parameters_schema: Record<string, unknown>
  available_to_roles: string[]
  is_builtin: true
  enabled: true
}

// Roles used across the registry. The agent route resolves the rep's role
// from user_profiles and the loader filters tools by `available_to_roles`.
const SELLING_ROLES = ['nae', 'ae', 'growth_ae', 'ad'] as const
const ALL_ROLES = ['nae', 'ae', 'growth_ae', 'ad', 'csm', 'leader'] as const

const BUILTIN_TOOLS: ToolSeed[] = [
  // ---------------------------------------------------------------------------
  // Pipeline Coach — owned by createPipelineCoachTools (apps/web/src/lib/agent/agents/pipeline-coach.ts)
  // ---------------------------------------------------------------------------
  {
    slug: 'get_pipeline_overview',
    display_name: 'Pipeline Overview',
    description:
      "Get the rep's open deals with stages, values, and days-in-stage. Use for \"show my pipeline\", \"what deals do I have\", \"what's open\".",
    category: 'data_query',
    tool_type: 'builtin',
    execution_config: { handler: 'get_pipeline_overview' },
    parameters_schema: {
      type: 'object',
      properties: {
        sort_by: { type: 'string', enum: ['value', 'days_in_stage', 'stage'], default: 'value' },
        limit: { type: 'number', default: 20 },
      },
      required: [],
    },
    available_to_roles: [...SELLING_ROLES],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'get_deal_detail',
    display_name: 'Deal Detail',
    description:
      'Get full context on one deal: contacts, MEDDPICC, stage history, recent activity. Use for "tell me about deal X", "how is X going".',
    category: 'data_query',
    tool_type: 'builtin',
    execution_config: { handler: 'get_deal_detail' },
    parameters_schema: {
      type: 'object',
      properties: { deal_name: { type: 'string', description: 'Deal name to look up' } },
      required: ['deal_name'],
    },
    available_to_roles: [...SELLING_ROLES],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'get_funnel_benchmarks',
    display_name: 'Funnel Benchmarks',
    description:
      'Stage-by-stage conversion vs the company benchmark. Use for "how is my funnel", "where am I losing deals", "what stage needs work".',
    category: 'analysis',
    tool_type: 'builtin',
    execution_config: { handler: 'get_funnel_benchmarks' },
    parameters_schema: { type: 'object', properties: {}, required: [] },
    available_to_roles: [...ALL_ROLES],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'detect_stalls',
    display_name: 'Detect Stalls',
    description:
      'Surface deals that have been in their current stage longer than the company benchmark. Use for "what is stalled", "what needs attention".',
    category: 'analysis',
    tool_type: 'builtin',
    execution_config: { handler: 'detect_stalls' },
    parameters_schema: { type: 'object', properties: {}, required: [] },
    available_to_roles: [...SELLING_ROLES],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'suggest_next_action',
    display_name: 'Suggest Next Action',
    description:
      'Recommend the single best next action for a deal based on stage, missing stakeholders, and recent activity. Use for "what should I do on X".',
    category: 'analysis',
    tool_type: 'builtin',
    execution_config: { handler: 'suggest_next_action' },
    parameters_schema: {
      type: 'object',
      properties: { deal_name: { type: 'string' } },
      required: ['deal_name'],
    },
    available_to_roles: [...SELLING_ROLES],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'explain_score',
    display_name: 'Explain Score',
    description:
      "Show the breakdown of an account's priority score: ICP, signal, engagement, contact coverage, velocity, win rate. Use for \"why is X high priority\", \"explain this score\".",
    category: 'analysis',
    tool_type: 'builtin',
    execution_config: { handler: 'explain_score' },
    parameters_schema: {
      type: 'object',
      properties: { account_name: { type: 'string' } },
      required: ['account_name'],
    },
    available_to_roles: [...ALL_ROLES],
    is_builtin: true,
    enabled: true,
  },

  // ---------------------------------------------------------------------------
  // Account Strategist — outreach + discovery (createAccountStrategistTools)
  // ---------------------------------------------------------------------------
  {
    slug: 'research_account',
    display_name: 'Research Account',
    description:
      'Deep dive on one company: firmographics, signals, contacts, open deals. Use before a call or meeting.',
    category: 'data_query',
    tool_type: 'builtin',
    execution_config: { handler: 'research_account' },
    parameters_schema: {
      type: 'object',
      properties: { account_name: { type: 'string' } },
      required: ['account_name'],
    },
    available_to_roles: [...ALL_ROLES],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'find_contacts',
    display_name: 'Find Contacts',
    description:
      'Find contacts at a company for multi-threading. Filter by seniority. Use when identifying decision-makers.',
    category: 'data_query',
    tool_type: 'builtin',
    execution_config: { handler: 'find_contacts' },
    parameters_schema: {
      type: 'object',
      properties: {
        account_name: { type: 'string' },
        seniority_filter: { type: 'array', items: { type: 'string' } },
      },
      required: ['account_name'],
    },
    available_to_roles: [...SELLING_ROLES],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'get_active_signals',
    display_name: 'Get Active Signals',
    description:
      'Recent buying signals on a company (job posts, exec changes, news, intent). Use for "what is happening at X".',
    category: 'data_query',
    tool_type: 'builtin',
    execution_config: { handler: 'get_active_signals' },
    parameters_schema: {
      type: 'object',
      properties: { account_name: { type: 'string' } },
      required: ['account_name'],
    },
    available_to_roles: [...ALL_ROLES],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'search_transcripts',
    display_name: 'Search Transcripts',
    description:
      'Semantic search over call/meeting transcripts. Use for "what did the customer say about X", "find calls mentioning Y".',
    category: 'data_query',
    tool_type: 'builtin',
    execution_config: { handler: 'search_transcripts' },
    parameters_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        account_name: { type: 'string' },
      },
      required: ['query'],
    },
    available_to_roles: [...ALL_ROLES],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'draft_outreach',
    display_name: 'Draft Outreach',
    description:
      'Fetch context needed to draft an email or message. Returns company, signals, contact info; the agent composes the message in its response.',
    category: 'generation',
    tool_type: 'builtin',
    execution_config: { handler: 'draft_outreach' },
    parameters_schema: {
      type: 'object',
      properties: {
        account_name: { type: 'string' },
        contact_name: { type: 'string' },
        outreach_type: {
          type: 'string',
          enum: ['cold_email', 'follow_up', 'stall_rescue', 'signal_response', 'meeting_request'],
        },
      },
      required: ['account_name', 'outreach_type'],
    },
    available_to_roles: [...SELLING_ROLES],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'draft_meeting_brief',
    display_name: 'Draft Meeting Brief',
    description:
      'Assemble a concise pre-call brief: company snapshot, recent signals, discovery questions, similar won deals. Use before a meeting.',
    category: 'generation',
    tool_type: 'builtin',
    execution_config: { handler: 'draft_meeting_brief' },
    parameters_schema: {
      type: 'object',
      properties: { account_name: { type: 'string' } },
      required: ['account_name'],
    },
    available_to_roles: [...SELLING_ROLES],
    is_builtin: true,
    enabled: true,
  },

  // ---------------------------------------------------------------------------
  // Leadership Lens — manager/leader tools (createLeadershipLensTools)
  // ---------------------------------------------------------------------------
  {
    slug: 'funnel_divergence',
    display_name: 'Funnel Divergence',
    description:
      'Compare a rep\'s funnel against the team benchmark to surface where they diverge. Use for coaching: "where is X falling behind".',
    category: 'analysis',
    tool_type: 'builtin',
    execution_config: { handler: 'funnel_divergence' },
    parameters_schema: { type: 'object', properties: { rep_name: { type: 'string' } }, required: [] },
    available_to_roles: ['leader', 'ad'],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'forecast_risk',
    display_name: 'Forecast Risk',
    description:
      'Identify deals most at risk of slipping the current quarter forecast. Use for "what is at risk", "is the number safe".',
    category: 'analysis',
    tool_type: 'builtin',
    execution_config: { handler: 'forecast_risk' },
    parameters_schema: { type: 'object', properties: {}, required: [] },
    available_to_roles: ['leader', 'ad'],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'team_patterns',
    display_name: 'Team Patterns',
    description:
      'Surface team-wide patterns: top performers, common stalls, consistent winning behaviours. Use for QBRs and 1:1 prep.',
    category: 'analysis',
    tool_type: 'builtin',
    execution_config: { handler: 'team_patterns' },
    parameters_schema: { type: 'object', properties: {}, required: [] },
    available_to_roles: ['leader'],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'coaching_themes',
    display_name: 'Coaching Themes',
    description:
      'Cluster recent transcripts into coaching themes per rep. Use for "what should I coach on this week".',
    category: 'analysis',
    tool_type: 'builtin',
    execution_config: { handler: 'coaching_themes' },
    parameters_schema: { type: 'object', properties: { rep_name: { type: 'string' } }, required: [] },
    available_to_roles: ['leader'],
    is_builtin: true,
    enabled: true,
  },

  // ---------------------------------------------------------------------------
  // Onboarding Coach — tenant setup (createOnboardingTools)
  // ---------------------------------------------------------------------------
  {
    slug: 'explore_crm_fields',
    display_name: 'Explore CRM Fields',
    description:
      'Inspect the tenant\'s CRM schema to identify which fields exist for ICP/funnel configuration. Use during onboarding.',
    category: 'data_query',
    tool_type: 'builtin',
    execution_config: { handler: 'explore_crm_fields' },
    parameters_schema: { type: 'object', properties: {}, required: [] },
    available_to_roles: ['leader'],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'analyze_account_distribution',
    display_name: 'Analyze Account Distribution',
    description:
      'Profile the tenant\'s account base by industry, size, geography. Use to seed ICP weights.',
    category: 'analysis',
    tool_type: 'builtin',
    execution_config: { handler: 'analyze_account_distribution' },
    parameters_schema: { type: 'object', properties: {}, required: [] },
    available_to_roles: ['leader'],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'analyze_pipeline_history',
    display_name: 'Analyze Pipeline History',
    description:
      'Look at historical pipeline movement to seed funnel benchmarks (median days per stage, conversion).',
    category: 'analysis',
    tool_type: 'builtin',
    execution_config: { handler: 'analyze_pipeline_history' },
    parameters_schema: { type: 'object', properties: {}, required: [] },
    available_to_roles: ['leader'],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'analyze_contact_patterns',
    display_name: 'Analyze Contact Patterns',
    description:
      'Identify common buying-committee patterns in won vs lost deals to seed contact-coverage scoring.',
    category: 'analysis',
    tool_type: 'builtin',
    execution_config: { handler: 'analyze_contact_patterns' },
    parameters_schema: { type: 'object', properties: {}, required: [] },
    available_to_roles: ['leader'],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'propose_icp_config',
    display_name: 'Propose ICP Config',
    description:
      'Propose an ICP scoring config from the analyses above. Returns a JSON config the operator can review.',
    category: 'generation',
    tool_type: 'builtin',
    execution_config: { handler: 'propose_icp_config' },
    parameters_schema: { type: 'object', properties: {}, required: [] },
    available_to_roles: ['leader'],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'propose_funnel_config',
    display_name: 'Propose Funnel Config',
    description:
      'Propose a funnel/stage config from pipeline history. Returns a JSON config the operator can review.',
    category: 'generation',
    tool_type: 'builtin',
    execution_config: { handler: 'propose_funnel_config' },
    parameters_schema: { type: 'object', properties: {}, required: [] },
    available_to_roles: ['leader'],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'apply_icp_config',
    display_name: 'Apply ICP Config',
    description:
      'Persist the proposed ICP config to tenants.icp_config. Side-effect tool; gated by write-approval middleware.',
    category: 'action',
    tool_type: 'builtin',
    execution_config: { handler: 'apply_icp_config' },
    parameters_schema: {
      type: 'object',
      properties: { config: { type: 'object' } },
      required: ['config'],
    },
    available_to_roles: ['leader'],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'apply_funnel_config',
    display_name: 'Apply Funnel Config',
    description:
      'Persist the proposed funnel config to tenants.funnel_config. Side-effect tool; gated by write-approval middleware.',
    category: 'action',
    tool_type: 'builtin',
    execution_config: { handler: 'apply_funnel_config' },
    parameters_schema: {
      type: 'object',
      properties: { config: { type: 'object' } },
      required: ['config'],
    },
    available_to_roles: ['leader'],
    is_builtin: true,
    enabled: true,
  },

  // ---------------------------------------------------------------------------
  // Cross-cutting — sales frameworks knowledge tool
  // ---------------------------------------------------------------------------
  {
    slug: 'consult_sales_framework',
    display_name: 'Consult Sales Framework',
    description:
      'Look up the verbatim playbook for a named sales framework — discovery questions, qualification scaffolds, objection scripts, close patterns. Use whenever a recommendation needs methodology grounding: SPIN for discovery, MEDDPICC for qualification, Challenger reframes, Sandler pain funnel, JOLT for stalled deals, LAER for objections, Value Selling for ROI cases, Solution Selling vision, NEAT/BANT/ANUM filters, Command of the Message, RAIN, SNAP, Three Whys. Returns the framework body (or a focused section: scaffold, when_to_use, pitfalls, prospector_application, attribution) plus citation metadata so the answer surfaces a "Source:" pill in the UI. Cite the framework by slug in the response with [framework: SLUG].',
    category: 'analysis',
    tool_type: 'builtin',
    execution_config: { handler: 'consult_sales_framework' },
    parameters_schema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          enum: [
            'spin',
            'meddpicc',
            'challenger',
            'sandler',
            'bant-anum',
            'value-selling',
            'gap-selling',
            'solution-selling',
            'neat-selling',
            'command-of-message',
            'pain-funnel',
            'jolt',
            'rain',
            'snap',
            'three-why',
            'objection-handling',
          ],
          description: 'Framework slug to consult.',
        },
        focus: {
          type: 'string',
          enum: [
            'mental_model',
            'when_to_use',
            'scaffold',
            'prospector_application',
            'pitfalls',
            'attribution',
          ],
          description:
            'Optional section to return only — e.g. "scaffold" for verbatim moves, "pitfalls" for gotchas. Omit to return the whole framework.',
        },
      },
      required: ['slug'],
    },
    available_to_roles: ['nae', 'ae', 'growth_ae', 'ad', 'csm', 'leader'],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'hydrate_context',
    display_name: 'Hydrate Context Slice',
    description:
      'On-demand load of one Context Pack slice — priority-accounts, stalled-deals, funnel-comparison, recent-signals, current-deal-health, current-company-snapshot, transcript-summaries, key-contact-notes, rep-success-fingerprint, champion-map, champion-alumni-opportunities. Use when the per-turn context is missing the slice you need (different intent than detected, follow-up question shifts focus, or you want to re-anchor on a different account/deal). Returns the rendered slice markdown plus URN-cited rows so the citation pill links the user to the source.',
    category: 'data_query',
    tool_type: 'builtin',
    execution_config: { handler: 'hydrate_context' },
    parameters_schema: {
      type: 'object',
      properties: {
        slice: {
          type: 'string',
          enum: [
            'priority-accounts',
            'stalled-deals',
            'funnel-comparison',
            'recent-signals',
            'current-deal-health',
            'current-company-snapshot',
            'transcript-summaries',
            'key-contact-notes',
            'rep-success-fingerprint',
            'champion-map',
            'champion-alumni-opportunities',
          ],
          description: 'Slice slug to load.',
        },
        active_company_urn: {
          type: 'string',
          description:
            'Override the active company URN — useful when the rep asks about a different company than the active object.',
        },
        active_deal_urn: {
          type: 'string',
          description: 'Override the active deal URN.',
        },
      },
      required: ['slice'],
    },
    available_to_roles: ['nae', 'ae', 'growth_ae', 'ad', 'csm', 'leader'],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'log_crm_activity',
    display_name: 'Log CRM Activity',
    description:
      "Create a HubSpot engagement (note/call/email/meeting) on a deal/company/contact. Use when the rep wants the agent to log an observation, call summary, or meeting notes back to the CRM. Marked mutates_crm so the writeApprovalGate middleware blocks the first invocation and surfaces a [DO] chip — the rep clicks to approve, the UI re-invokes with an approval_token. Returns a citation pointing at the new HubSpot record so the rep can verify in one click.",
    category: 'action',
    tool_type: 'builtin',
    execution_config: { handler: 'log_crm_activity', mutates_crm: true },
    parameters_schema: {
      type: 'object',
      properties: {
        target_urn: {
          type: 'string',
          description: 'URN of the deal/company/contact (e.g. urn:rev:deal:abc).',
        },
        activity_type: {
          type: 'string',
          enum: ['note', 'call', 'email', 'meeting'],
          description: 'Engagement type — note is the safe default.',
        },
        body: {
          type: 'string',
          description: 'Body text of the engagement.',
        },
        duration_minutes: {
          type: 'number',
          description: 'Optional duration for calls/meetings.',
        },
        approval_token: {
          type: 'string',
          description: 'Approval token from the [DO] chip (added by the UI).',
        },
      },
      required: ['target_urn', 'activity_type', 'body'],
    },
    available_to_roles: ['nae', 'ae', 'growth_ae', 'ad', 'csm'],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'update_crm_property',
    display_name: 'Update CRM Property',
    description:
      "Update one HubSpot property on a deal/company/contact (e.g. set dealstage to 'Negotiation', set hs_meddpicc_champion_email to a new value, mark a custom flag). Marked mutates_crm so the writeApprovalGate middleware enforces approval. Returns a citation pointing at the just-updated CRM record. Surface the property name + new value in the [DO] chip so the rep knows exactly what they're approving.",
    category: 'action',
    tool_type: 'builtin',
    execution_config: { handler: 'update_crm_property', mutates_crm: true },
    parameters_schema: {
      type: 'object',
      properties: {
        target_urn: {
          type: 'string',
          description: 'URN of the deal/company/contact to update.',
        },
        property: {
          type: 'string',
          description: 'HubSpot property name (e.g. dealstage, amount, hs_meddpicc_champion_email).',
        },
        value: {
          description: 'New value (string/number/boolean/null).',
        },
        approval_token: {
          type: 'string',
          description: 'Approval token from the [DO] chip.',
        },
      },
      required: ['target_urn', 'property', 'value'],
    },
    available_to_roles: ['nae', 'ae', 'growth_ae', 'ad'],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'create_crm_task',
    display_name: 'Create CRM Task',
    description:
      "Schedule a HubSpot follow-up task with optional due date, priority, and association to a deal/company/contact. Use after a call where the rep agrees to a follow-up action ('I'll send the proposal Monday'). Marked mutates_crm so the writeApprovalGate enforces approval. Returns a citation pointing at the new task in HubSpot.",
    category: 'action',
    tool_type: 'builtin',
    execution_config: { handler: 'create_crm_task', mutates_crm: true },
    parameters_schema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: 'Short subject line for the task.',
        },
        body: {
          type: 'string',
          description: 'Optional richer description.',
        },
        due_date_iso: {
          type: 'string',
          description: 'ISO 8601 timestamp for the due date.',
        },
        priority: {
          type: 'string',
          enum: ['LOW', 'MEDIUM', 'HIGH'],
          description: 'Task priority — defaults to MEDIUM.',
        },
        related_to_urn: {
          type: 'string',
          description: 'Optional URN to associate the task with.',
        },
        approval_token: {
          type: 'string',
          description: 'Approval token from the [DO] chip.',
        },
      },
      required: ['subject'],
    },
    available_to_roles: ['nae', 'ae', 'growth_ae', 'ad', 'csm'],
    is_builtin: true,
    enabled: true,
  },
  {
    slug: 'draft_alumni_intro',
    display_name: 'Draft Champion-Alumni Intro',
    description:
      "Pulls the context needed to draft a warm-intro outreach to a former champion who has moved to a new company. Pairs with the champion-alumni-opportunities slice and the champion_alumni signal_type. Use whenever the agent surfaces an alumni opportunity OR the rep explicitly asks 'draft a warm intro to X who moved to Y'. Returns original deal context, new company snapshot, talking points, and a suggested framework. The agent then composes the actual outreach in its response — does NOT send anything; the rep approves and sends manually.",
    category: 'generation',
    tool_type: 'builtin',
    execution_config: { handler: 'draft_alumni_intro' },
    parameters_schema: {
      type: 'object',
      properties: {
        contact_urn: {
          type: 'string',
          description: 'URN of the former champion (e.g. urn:rev:contact:abc).',
        },
        new_company_urn: {
          type: 'string',
          description: "URN of the contact's new company (e.g. urn:rev:company:xyz).",
        },
      },
      required: ['contact_urn', 'new_company_urn'],
    },
    available_to_roles: ['nae', 'ae', 'growth_ae', 'ad'],
    is_builtin: true,
    enabled: true,
  },
]

// ---------------------------------------------------------------------------
// seedBuiltinTools
// ---------------------------------------------------------------------------

export async function seedBuiltinTools(
  supabase: SupabaseClient,
  tenantId: string,
) {
  console.log('Seeding built-in tools...')

  for (const tool of BUILTIN_TOOLS) {
    const { error } = await supabase.from('tool_registry').upsert(
      {
        tenant_id: tenantId,
        slug: tool.slug,
        display_name: tool.display_name,
        description: tool.description,
        category: tool.category,
        tool_type: tool.tool_type,
        execution_config: tool.execution_config,
        parameters_schema: tool.parameters_schema,
        available_to_roles: tool.available_to_roles,
        is_builtin: tool.is_builtin,
        enabled: tool.enabled,
      },
      { onConflict: 'tenant_id,slug' },
    )

    if (error) {
      console.warn(`   Tool ${tool.slug}: ${error.message}`)
    } else {
      console.log(`   Tool: ${tool.display_name}`)
    }
  }

  console.log(`   ${BUILTIN_TOOLS.length} built-in tools seeded.`)
}

// ---------------------------------------------------------------------------
// seedIndeedFlexProfile
// ---------------------------------------------------------------------------

export async function seedIndeedFlexProfile(
  supabase: SupabaseClient,
  tenantId: string,
) {
  console.log('Seeding Indeed Flex business profile...')

  const { error } = await supabase.from('business_profiles').upsert(
    {
      tenant_id: tenantId,
      company_name: 'Indeed Flex',
      company_description:
        'Indeed Flex is a digital staffing platform connecting businesses with temporary flexible workers ("Flexers"). We provide rapid fill rates (under 48hrs), flexible workforce scaling, reduced agency dependency, compliance-managed workers, and tech-enabled scheduling.',
      industry_context:
        'Digital staffing / workforce solutions for temporary and flexible labour.',
      target_industries: [
        'Light Industrial',
        'Hospitality',
        'Logistics',
        'Warehousing',
        'Manufacturing',
        'Distribution',
        'Facilities Management',
      ],
      ideal_customer_description:
        '250-10,000 employees, >£50M revenue, high temporary staffing needs, multi-site operations',
      value_propositions: [
        {
          prop: 'Rapid fill rates under 48 hours',
          when_to_use:
            'When the client has urgent staffing gaps or peak season needs',
        },
        {
          prop: 'Flexible workforce scaling',
          when_to_use:
            'When the client needs to scale up/down quickly without permanent hires',
        },
        {
          prop: 'Reduced agency dependency',
          when_to_use:
            'When the client is paying high agency fees or has reliability issues with current providers',
        },
        {
          prop: 'Compliance-managed workers',
          when_to_use:
            'When the client operates in regulated industries or has compliance concerns',
        },
        {
          prop: 'Tech-enabled scheduling',
          when_to_use:
            'When the client struggles with manual scheduling or wants workforce visibility',
        },
      ],
      operating_regions: [
        {
          region: 'UK',
          cities: [
            'Birmingham',
            'Brighton',
            'Bristol',
            'Cardiff',
            'Coventry',
            'Edinburgh',
            'Glasgow',
            'Leeds',
            'Liverpool',
            'London',
            'Manchester',
            'York',
          ],
        },
        {
          region: 'US',
          cities: [
            'Austin TX',
            'Dallas TX',
            'Houston TX',
            'Nashville TN',
            'Atlanta GA',
            'Cincinnati OH',
            'Columbus OH',
            'Ontario CA',
          ],
        },
      ],
      agent_name: 'Revenue AI OS',
      agent_mission: 'Cut the noise. Surface the signal. Empower action.',
      brand_voice:
        'Professional, data-driven, concise. Lead with evidence, end with actions.',
      role_definitions: [
        {
          slug: 'ae',
          label: 'Account Executive',
          description: 'Manages new business pipeline and discovery',
          context_strategy: 'rep_centric',
          prompt_template: 'sales_rep',
          default_tools: [
            'get_pipeline_overview',
            'get_deal_detail',
            'detect_stalls',
            'suggest_next_action',
            'explain_score',
            'research_account',
            'find_contacts',
            'get_active_signals',
            'draft_outreach',
            'consult_sales_framework',
            'hydrate_context',
            'draft_alumni_intro',
            'log_crm_activity',
            'update_crm_property',
            'create_crm_task',
          ],
        },
        {
          slug: 'nae',
          label: 'New Account Executive',
          description: 'Focuses on prospecting and lead qualification',
          context_strategy: 'rep_centric',
          prompt_template: 'sales_rep',
          default_tools: [
            'get_pipeline_overview',
            'detect_stalls',
            'suggest_next_action',
            'explain_score',
            'research_account',
            'find_contacts',
            'get_active_signals',
            'draft_outreach',
            'draft_meeting_brief',
            'consult_sales_framework',
            'hydrate_context',
            'draft_alumni_intro',
            'log_crm_activity',
            'update_crm_property',
            'create_crm_task',
          ],
        },
        {
          slug: 'csm',
          label: 'Customer Success Manager',
          description: 'Manages portfolio health and retention',
          context_strategy: 'portfolio_centric',
          prompt_template: 'csm_guardian',
          default_tools: [
            'research_account',
            'get_active_signals',
            'search_transcripts',
            'explain_score',
            'consult_sales_framework',
            'hydrate_context',
            'draft_alumni_intro',
            'log_crm_activity',
            'update_crm_property',
            'create_crm_task',
          ],
        },
        {
          slug: 'ad',
          label: 'Account Director',
          description:
            'Owns strategic Tier 1 accounts and executive relationships',
          context_strategy: 'account_centric',
          prompt_template: 'ad_narrative',
          default_tools: [
            'research_account',
            'find_contacts',
            'get_active_signals',
            'search_transcripts',
            'get_deal_detail',
            'suggest_next_action',
            'forecast_risk',
            'funnel_divergence',
            'consult_sales_framework',
            'hydrate_context',
            'draft_alumni_intro',
            'log_crm_activity',
            'update_crm_property',
            'create_crm_task',
          ],
        },
        {
          slug: 'leader',
          label: 'Revenue Leader',
          description: 'Manages team performance and pipeline health',
          context_strategy: 'team_centric',
          prompt_template: 'leadership',
          default_tools: [
            'funnel_divergence',
            'forecast_risk',
            'team_patterns',
            'coaching_themes',
            'get_funnel_benchmarks',
            'consult_sales_framework',
            'hydrate_context',
            'draft_alumni_intro',
            'log_crm_activity',
            'update_crm_property',
            'create_crm_task',
          ],
        },
        {
          slug: 'growth_ae',
          label: 'Growth Account Executive',
          description: 'Focuses on expansion within existing accounts',
          context_strategy: 'rep_centric',
          prompt_template: 'sales_rep',
          default_tools: [
            'get_pipeline_overview',
            'get_deal_detail',
            'detect_stalls',
            'research_account',
            'get_active_signals',
            'draft_outreach',
            'consult_sales_framework',
            'hydrate_context',
            'draft_alumni_intro',
            'log_crm_activity',
            'update_crm_property',
            'create_crm_task',
          ],
        },
      ],
    },
    { onConflict: 'tenant_id' },
  )

  if (error) {
    console.warn(`   Business profile: ${error.message}`)
  } else {
    console.log('   Business profile: Indeed Flex')
  }
}

// ---------------------------------------------------------------------------
// Main — run both seeds when executed directly
// ---------------------------------------------------------------------------

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { config } = await import('dotenv')
  const { join } = await import('path')

  config({ path: join(__dirname, '..', 'apps', 'web', '.env.local') })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key || url.includes('placeholder')) {
    console.error(
      'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local',
    )
    process.exit(1)
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false },
  })

  // Resolve tenant — reuse the existing seed tenant by slug
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', 'indeed-flex')
    .single()

  if (tenantErr || !tenant) {
    console.error(
      'Tenant "indeed-flex" not found. Run `npx tsx scripts/seed.ts` first.',
    )
    process.exit(1)
  }

  const tenantId = tenant.id
  console.log(`Tenant: ${tenantId}\n`)

  await seedBuiltinTools(supabase, tenantId)
  console.log()
  await seedIndeedFlexProfile(supabase, tenantId)

  console.log('\nSeed-tools complete!')
}

main().catch((err) => {
  console.error('Seed-tools failed:', err)
  process.exit(1)
})

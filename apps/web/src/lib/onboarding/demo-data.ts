/**
 * Phase 3 T2.5 — demo-data seeder.
 *
 * Generates 25 vendor-neutral companies + ~10 opportunities + ~6
 * contacts each (per the proposal). Deterministic given a fixed
 * seed so:
 *
 *   - The wizard's "Try with sample data" button always lands the
 *     same tenant in the same shape — easy to walk new users
 *     through the same screenshots.
 *   - Unit tests can pin exact counts without a fragile freeze.
 *   - Idempotent re-runs (e.g. user double-clicked the button)
 *     produce the same rows; combined with `onConflict` on the
 *     CRM-id columns, repeated calls are no-ops at the DB layer.
 *
 * The data set is intentionally vendor-neutral (no Indeed Flex
 * branding, no UK-specific firmographics) so a demo tenant in
 * any geography sees plausible-looking accounts. It's also small
 * enough that scoring + signals run in seconds, not minutes —
 * the goal of the demo is "first cited answer in 5 minutes",
 * not realism.
 */

// ---------------------------------------------------------------------------
// Pure data generators
// ---------------------------------------------------------------------------

/**
 * Tiny deterministic PRNG (mulberry32). Seedable with a 32-bit
 * integer; we don't need cryptographic strength, just stable output
 * for tests + reproducible demos.
 */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const COMPANY_TEMPLATES = [
  { suffix: 'Logistics', industry: 'Logistics' },
  { suffix: 'Industries', industry: 'Manufacturing' },
  { suffix: 'Retail Group', industry: 'Retail' },
  { suffix: 'Hospitality', industry: 'Hospitality' },
  { suffix: 'Distribution', industry: 'Distribution' },
  { suffix: 'Food Services', industry: 'Food Service' },
  { suffix: 'Facilities', industry: 'Facilities Management' },
  { suffix: 'Construction', industry: 'Construction' },
  { suffix: 'Wholesale', industry: 'Wholesale' },
  { suffix: 'Warehousing', industry: 'Warehousing' },
] as const

const NAME_PREFIXES = [
  'Northwind',
  'Acme',
  'Cascade',
  'Atlas',
  'Vertex',
  'Beacon',
  'Highland',
  'Summit',
  'Coastal',
  'Pioneer',
  'Riverbend',
  'Ironclad',
  'Granite',
  'Pacific',
  'Lakeside',
  'Meridian',
  'Brightwave',
  'Cobalt',
  'Sterling',
  'Forge',
  'Anchor',
  'Birch',
  'Cedar',
  'Polaris',
  'Helix',
] as const

const STAGES = ['Lead', 'Qualified', 'Proposal', 'Negotiation'] as const
type Stage = (typeof STAGES)[number]

const STAGE_ORDERS: Record<Stage, number> = {
  Lead: 1,
  Qualified: 2,
  Proposal: 3,
  Negotiation: 4,
}

const CONTACT_FIRST_NAMES = [
  'Sarah',
  'James',
  'Priya',
  'David',
  'Emma',
  'Marcus',
  'Lin',
  'Rafael',
  'Nadia',
  'Tom',
] as const

const CONTACT_LAST_NAMES = [
  'Chen',
  'Patel',
  'Garcia',
  'Khan',
  'Müller',
  'O\'Connor',
  'Tanaka',
  'Rivera',
  'Schmidt',
  'Andersson',
] as const

const TITLES = [
  { title: 'VP Operations', seniority: 'vp', department: 'Operations', isDecisionMaker: true, isChampion: true },
  { title: 'Director of Operations', seniority: 'director', department: 'Operations', isDecisionMaker: true, isChampion: false },
  { title: 'Operations Manager', seniority: 'manager', department: 'Operations', isDecisionMaker: false, isChampion: false },
  { title: 'Head of People', seniority: 'director', department: 'HR', isDecisionMaker: true, isChampion: false },
  { title: 'Workforce Manager', seniority: 'manager', department: 'HR', isDecisionMaker: false, isChampion: true },
  { title: 'COO', seniority: 'c_level', department: 'Operations', isDecisionMaker: true, isChampion: false },
] as const

const SIGNAL_TYPES = [
  { signal_type: 'hiring_surge', title_template: '%N temp roles posted', urgency: 'this_week' },
  { signal_type: 'leadership_change', title_template: 'New VP Operations appointed', urgency: 'this_month' },
  { signal_type: 'expansion', title_template: 'New site planned', urgency: 'this_month' },
  { signal_type: 'seasonal_peak', title_template: 'Peak season approaching', urgency: 'this_week' },
] as const

export interface DemoCompany {
  crm_id: string
  name: string
  domain: string
  industry: string
  industry_group: string
  employee_count: number
  employee_range: string
  annual_revenue: number
  hq_city: string
  hq_country: string
  location_count: number
  tech_stack: string[]
  owner_crm_id: string
}

export interface DemoOpportunity {
  crm_id: string
  company_crm_id: string
  name: string
  value: number
  stage: Stage
  stage_order: number
  probability: number
  days_in_stage: number
  is_stalled: boolean
  stall_reason: string | null
  owner_crm_id: string
}

export interface DemoContact {
  company_crm_id: string
  first_name: string
  last_name: string
  title: string
  seniority: string
  department: string
  email: string
  phone: string | null
  is_champion: boolean
  is_decision_maker: boolean
}

export interface DemoSignal {
  company_crm_id: string
  signal_type: string
  title: string
  relevance_score: number
  urgency: string
  source: string
  recency_days: number
}

export interface DemoDataset {
  companies: DemoCompany[]
  opportunities: DemoOpportunity[]
  contacts: DemoContact[]
  signals: DemoSignal[]
  rep: {
    crm_id: string
    name: string
    email: string
  }
}

/**
 * Generate a deterministic demo dataset. Default seed produces 25
 * companies + ~10 opportunities + ~6 contacts each + a handful of
 * signals on the highest-scoring accounts.
 *
 * Counts are tuned for the proposal's "5 minutes to first cited
 * answer" goal: large enough that scoring has signal to rank
 * against, small enough that the full pipeline (sync + enrich +
 * score + signals) stays fast.
 */
export function generateDemoDataset(opts: {
  seed?: number
  companyCount?: number
  ownerCrmId?: string
} = {}): DemoDataset {
  const seed = opts.seed ?? 1
  const companyCount = opts.companyCount ?? 25
  const ownerCrmId = opts.ownerCrmId ?? 'demo-rep-001'
  const rng = makeRng(seed)

  const companies: DemoCompany[] = []
  const opportunities: DemoOpportunity[] = []
  const contacts: DemoContact[] = []
  const signals: DemoSignal[] = []

  for (let i = 0; i < companyCount; i++) {
    const prefix = NAME_PREFIXES[i % NAME_PREFIXES.length]
    const template = COMPANY_TEMPLATES[i % COMPANY_TEMPLATES.length]
    const name = `${prefix} ${template.suffix}`
    const crm_id = `demo-co-${(i + 1).toString().padStart(3, '0')}`
    const employeeCount = 200 + Math.floor(rng() * 4000)
    const annualRevenue = employeeCount * (60_000 + Math.floor(rng() * 100_000))

    companies.push({
      crm_id,
      name,
      domain: `${prefix.toLowerCase()}-${template.suffix.toLowerCase().replace(/\s+/g, '')}.example.com`,
      industry: template.industry,
      industry_group: classifyIndustryGroup(template.industry),
      employee_count: employeeCount,
      employee_range: bucketEmployeeRange(employeeCount),
      annual_revenue: annualRevenue,
      hq_city: pickCity(rng),
      hq_country: 'United Kingdom',
      location_count: 1 + Math.floor(rng() * 6),
      tech_stack: pickTechStack(rng),
      owner_crm_id: ownerCrmId,
    })

    // 60% of companies have ≥ 1 opportunity; biggest accounts have
    // more. We aim for ~10 opportunities total at companyCount=25
    // by letting ~40% of companies skip the opp list.
    const oppCount =
      rng() < 0.6 ? (employeeCount > 2000 ? 2 : 1) : 0
    for (let o = 0; o < oppCount; o++) {
      const stageIdx = Math.min(STAGES.length - 1, Math.floor(rng() * STAGES.length))
      const stage = STAGES[stageIdx]
      const value = 50_000 + Math.floor(rng() * 800_000)
      const daysInStage = Math.floor(rng() * 30)
      const isStalled = daysInStage > 14
      opportunities.push({
        crm_id: `demo-opp-${(opportunities.length + 1).toString().padStart(3, '0')}`,
        company_crm_id: crm_id,
        name: `${name} ${o === 0 ? 'Q3 Staffing' : 'Renewal Expansion'}`,
        value,
        stage,
        stage_order: STAGE_ORDERS[stage],
        probability: stageProbability(stage, isStalled),
        days_in_stage: daysInStage,
        is_stalled: isStalled,
        stall_reason: isStalled ? 'No contact activity in 14 days' : null,
        owner_crm_id: ownerCrmId,
      })
    }

    // Each company gets between 4 and 6 contacts. Pull deterministic
    // names + titles from the lookup tables; emails are derived
    // from the company domain so the demo looks legitimate.
    const contactCount = 4 + Math.floor(rng() * 3)
    for (let c = 0; c < contactCount; c++) {
      const firstName = CONTACT_FIRST_NAMES[
        (i + c) % CONTACT_FIRST_NAMES.length
      ]
      const lastName = CONTACT_LAST_NAMES[
        (i + c * 3) % CONTACT_LAST_NAMES.length
      ]
      const titleEntry = TITLES[c % TITLES.length]
      contacts.push({
        company_crm_id: crm_id,
        first_name: firstName,
        last_name: lastName,
        title: titleEntry.title,
        seniority: titleEntry.seniority,
        department: titleEntry.department,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/['']/g, '')}@${prefix.toLowerCase()}-${template.suffix.toLowerCase().replace(/\s+/g, '')}.example.com`,
        phone: c < 2 ? '+44 7700 900000' : null,
        is_champion: titleEntry.isChampion && c === 0,
        is_decision_maker: titleEntry.isDecisionMaker,
      })
    }

    // Top ~30% of accounts get a fresh signal so scoring has
    // something to surface and the inbox isn't all "no recent
    // signal" empty states.
    if (i < Math.floor(companyCount * 0.3)) {
      const sig = SIGNAL_TYPES[i % SIGNAL_TYPES.length]
      signals.push({
        company_crm_id: crm_id,
        signal_type: sig.signal_type,
        title: sig.title_template.replace('%N', String(3 + Math.floor(rng() * 12))),
        relevance_score: 0.6 + rng() * 0.35,
        urgency: sig.urgency,
        source: 'demo',
        recency_days: Math.floor(rng() * 14),
      })
    }
  }

  return {
    companies,
    opportunities,
    contacts,
    signals,
    rep: {
      crm_id: ownerCrmId,
      name: 'Demo Rep',
      email: 'demo-rep@example.com',
    },
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function classifyIndustryGroup(industry: string): string {
  if (['Logistics', 'Manufacturing', 'Distribution', 'Warehousing', 'Wholesale'].includes(industry)) {
    return 'Industrial'
  }
  if (['Retail', 'Hospitality', 'Food Service', 'Facilities Management'].includes(industry)) {
    return 'Services'
  }
  return 'Other'
}

function bucketEmployeeRange(count: number): string {
  if (count < 250) return '100-249'
  if (count < 500) return '250-499'
  if (count < 1000) return '500-999'
  if (count < 5000) return '1000-4999'
  return '5000+'
}

const CITIES = [
  'London',
  'Manchester',
  'Birmingham',
  'Leeds',
  'Bristol',
  'Liverpool',
  'Glasgow',
  'Edinburgh',
] as const

function pickCity(rng: () => number): string {
  return CITIES[Math.floor(rng() * CITIES.length)]
}

const TECH = [
  'Workday',
  'Kronos',
  'Deputy',
  'Sling',
  'BambooHR',
  'Oracle HCM',
  'ADP',
  'Paychex',
  'Gusto',
  'When I Work',
] as const

function pickTechStack(rng: () => number): string[] {
  const count = Math.floor(rng() * 3)
  const out: string[] = []
  while (out.length < count) {
    const candidate = TECH[Math.floor(rng() * TECH.length)]
    if (!out.includes(candidate)) out.push(candidate)
  }
  return out
}

function stageProbability(stage: Stage, isStalled: boolean): number {
  const base: Record<Stage, number> = {
    Lead: 15,
    Qualified: 30,
    Proposal: 50,
    Negotiation: 75,
  }
  return isStalled ? Math.max(10, base[stage] - 15) : base[stage]
}

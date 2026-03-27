const INDUSTRY_MAP: Record<string, { industry: string; group: string }> = {
  'warehousing': { industry: 'Warehousing', group: 'Industrial' },
  'warehousing and storage': { industry: 'Warehousing', group: 'Industrial' },
  'logistics': { industry: 'Logistics', group: 'Industrial' },
  'logistics and supply chain': { industry: 'Logistics', group: 'Industrial' },
  'transportation': { industry: 'Logistics', group: 'Industrial' },
  'transportation/trucking/railroad': { industry: 'Logistics', group: 'Industrial' },
  'freight': { industry: 'Logistics', group: 'Industrial' },
  'manufacturing': { industry: 'Manufacturing', group: 'Industrial' },
  'light industrial': { industry: 'Light Industrial', group: 'Industrial' },
  'industrial automation': { industry: 'Light Industrial', group: 'Industrial' },
  'distribution': { industry: 'Distribution', group: 'Industrial' },
  'wholesale': { industry: 'Wholesale', group: 'Industrial' },

  'hospitality': { industry: 'Hospitality', group: 'Services' },
  'hotels': { industry: 'Hospitality', group: 'Services' },
  'leisure, travel & tourism': { industry: 'Hospitality', group: 'Services' },
  'restaurants': { industry: 'Food Service', group: 'Services' },
  'food & beverages': { industry: 'Food Service', group: 'Services' },
  'food service': { industry: 'Food Service', group: 'Services' },
  'food production': { industry: 'Food Service', group: 'Services' },
  'catering': { industry: 'Food Service', group: 'Services' },
  'facilities services': { industry: 'Facilities Management', group: 'Services' },
  'facilities management': { industry: 'Facilities Management', group: 'Services' },
  'cleaning services': { industry: 'Cleaning Services', group: 'Services' },
  'events services': { industry: 'Events', group: 'Services' },
  'events': { industry: 'Events', group: 'Services' },

  'retail': { industry: 'Retail', group: 'Consumer' },
  'merchandising': { industry: 'Merchandising', group: 'Consumer' },
  'consumer goods': { industry: 'Retail', group: 'Consumer' },
  'supermarkets': { industry: 'Retail', group: 'Consumer' },

  'healthcare': { industry: 'Healthcare', group: 'Healthcare' },
  'hospital & health care': { industry: 'Healthcare', group: 'Healthcare' },
  'construction': { industry: 'Construction', group: 'Other' },
  'agriculture': { industry: 'Agriculture', group: 'Other' },
}

export function normalizeIndustry(raw: string | null | undefined): {
  industry: string | null
  group: string | null
} {
  if (!raw) return { industry: null, group: null }

  const lower = raw.toLowerCase().trim()
  const match = INDUSTRY_MAP[lower]

  if (match) return match

  for (const [key, value] of Object.entries(INDUSTRY_MAP)) {
    if (lower.includes(key) || key.includes(lower)) {
      return value
    }
  }

  return { industry: raw, group: 'Other' }
}

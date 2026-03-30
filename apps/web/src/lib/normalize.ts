export const SENIORITY_ORDER = ['c_level', 'vp', 'director', 'manager', 'individual'] as const
export type SeniorityLevel = (typeof SENIORITY_ORDER)[number]

export const SENIORITY_LABELS: Record<SeniorityLevel, string> = {
  c_level: 'C-Suite',
  vp: 'VP',
  director: 'Director',
  manager: 'Manager',
  individual: 'Individual',
}

const SENIORITY_ALIASES: Record<string, SeniorityLevel> = {
  'c-level': 'c_level', 'c_level': 'c_level', 'c-suite': 'c_level', 'csuite': 'c_level',
  ceo: 'c_level', cfo: 'c_level', coo: 'c_level', cto: 'c_level', cio: 'c_level', cmo: 'c_level',
  chief: 'c_level', president: 'c_level', founder: 'c_level',
  vp: 'vp', 'vice president': 'vp', svp: 'vp', evp: 'vp',
  'senior vice president': 'vp', 'executive vice president': 'vp',
  director: 'director', 'senior director': 'director', 'associate director': 'director',
  'group director': 'director', head: 'director',
  manager: 'manager', 'senior manager': 'manager', 'associate manager': 'manager',
  lead: 'manager', supervisor: 'manager', coordinator: 'manager',
  individual: 'individual', analyst: 'individual', specialist: 'individual',
  associate: 'individual', engineer: 'individual', consultant: 'individual',
}

export function normalizeSeniority(raw: string | null): SeniorityLevel {
  if (!raw) return 'individual'
  const key = raw.trim().toLowerCase()
  if (SENIORITY_ALIASES[key]) return SENIORITY_ALIASES[key]
  for (const [alias, level] of Object.entries(SENIORITY_ALIASES)) {
    if (key.includes(alias)) return level
  }
  return 'individual'
}

export const DEPT_GROUPS = ['Operations', 'Facilities', 'Finance', 'HR', 'IT', 'Procurement', 'Sales', 'Other'] as const
export type DeptGroup = (typeof DEPT_GROUPS)[number]

const DEPT_ALIASES: Record<string, DeptGroup> = {
  operations: 'Operations', ops: 'Operations', 'supply chain': 'Operations', logistics: 'Operations',
  warehouse: 'Operations', distribution: 'Operations', manufacturing: 'Operations', production: 'Operations',
  facilities: 'Facilities', facility: 'Facilities', 'real estate': 'Facilities', maintenance: 'Facilities',
  finance: 'Finance', accounting: 'Finance', financial: 'Finance', treasury: 'Finance',
  hr: 'HR', 'human resources': 'HR', people: 'HR', talent: 'HR', recruitment: 'HR', learning: 'HR',
  it: 'IT', technology: 'IT', engineering: 'IT', 'information technology': 'IT', digital: 'IT',
  software: 'IT', data: 'IT', infrastructure: 'IT',
  procurement: 'Procurement', purchasing: 'Procurement', sourcing: 'Procurement', vendor: 'Procurement',
  sales: 'Sales', commercial: 'Sales', revenue: 'Sales', business: 'Sales', marketing: 'Sales',
  'business development': 'Sales',
}

export function normalizeDepartment(raw: string | null): DeptGroup {
  if (!raw) return 'Other'
  const key = raw.trim().toLowerCase()
  if (DEPT_ALIASES[key]) return DEPT_ALIASES[key]
  for (const [alias, dept] of Object.entries(DEPT_ALIASES)) {
    if (key.includes(alias)) return dept
  }
  return 'Other'
}

type CityCoords = [lng: number, lat: number]

const CITY_COORDS: Record<string, CityCoords> = {
  london: [-0.12, 51.51], manchester: [-2.24, 53.48], birmingham: [-1.89, 52.49],
  leeds: [-1.55, 53.80], liverpool: [-2.98, 53.41], bristol: [-2.58, 51.45],
  glasgow: [-4.25, 55.86], edinburgh: [-3.19, 55.95], cardiff: [-3.18, 51.48],
  coventry: [-1.51, 52.41], brighton: [-0.14, 50.82], york: [-1.08, 53.96],
  austin: [-97.74, 30.27], dallas: [-96.80, 32.78], houston: [-95.37, 29.76],
  nashville: [-86.78, 36.16], atlanta: [-84.39, 33.75], cincinnati: [-84.51, 39.10],
  columbus: [-82.99, 39.96], ontario: [-117.65, 34.07],
  'new york': [-74.0, 40.71], chicago: [-87.63, 41.88], 'los angeles': [-118.24, 34.05],
  'san francisco': [-122.42, 37.77], seattle: [-122.33, 47.61], denver: [-104.99, 39.74],
}

export function getCityCoordinates(city: string | null, country: string | null): CityCoords | null {
  if (!city) return null
  const key = city.trim().toLowerCase()
  if (CITY_COORDS[key]) return CITY_COORDS[key]
  for (const [name, coords] of Object.entries(CITY_COORDS)) {
    if (key.includes(name) || name.includes(key)) return coords
  }
  return null
}

export function getCityRegion(city: string | null, country: string | null): 'uk' | 'us' | null {
  if (!city && !country) return null
  const c = (country ?? '').toLowerCase()
  if (c.includes('uk') || c.includes('united kingdom') || c.includes('gb') || c.includes('britain')) return 'uk'
  if (c.includes('us') || c.includes('united states') || c.includes('america')) return 'us'
  const cityKey = (city ?? '').toLowerCase()
  const ukCities = ['london', 'manchester', 'birmingham', 'leeds', 'liverpool', 'bristol', 'glasgow', 'edinburgh', 'cardiff', 'coventry', 'brighton', 'york']
  if (ukCities.some((uc) => cityKey.includes(uc))) return 'uk'
  return 'us'
}

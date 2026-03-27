import type { CompanyLocation } from '@prospector/core'

export interface OperatingRegions {
  uk: string[]
  us: string[]
}

const DEFAULT_REGIONS: OperatingRegions = {
  uk: [
    'London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow',
    'Brighton', 'Bristol', 'Cardiff', 'Coventry', 'Edinburgh',
    'Liverpool', 'York',
  ],
  us: [
    'Austin', 'Dallas', 'Houston', 'Nashville',
    'Atlanta', 'Cincinnati', 'Columbus', 'Ontario',
  ],
}

export function resolveLocationsInRegions(
  locations: CompanyLocation[],
  regions: OperatingRegions = DEFAULT_REGIONS
): {
  in_region: CompanyLocation[]
  out_of_region: CompanyLocation[]
  region_count: number
  regions_matched: string[]
} {
  const allCities = new Map<string, string>()

  for (const [region, cities] of Object.entries(regions)) {
    for (const city of cities) {
      allCities.set(city.toLowerCase(), region)
    }
  }

  const inRegion: CompanyLocation[] = []
  const outOfRegion: CompanyLocation[] = []
  const regionsMatched = new Set<string>()

  for (const loc of locations) {
    const region = allCities.get(loc.city.toLowerCase())
    if (region) {
      inRegion.push(loc)
      regionsMatched.add(region)
    } else {
      outOfRegion.push(loc)
    }
  }

  return {
    in_region: inRegion,
    out_of_region: outOfRegion,
    region_count: inRegion.length,
    regions_matched: Array.from(regionsMatched),
  }
}

export function isInCountry(
  country: string | null | undefined,
  targetCountries: string[] = ['United Kingdom', 'United States']
): boolean {
  if (!country) return false
  const lower = country.toLowerCase()
  return targetCountries.some((tc) => tc.toLowerCase() === lower)
}

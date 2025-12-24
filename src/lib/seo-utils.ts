/**
 * SEO utilities for generating URL slugs and metadata
 */

/**
 * Generate a URL-friendly slug from a string
 */
export function toSlug(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9]+/g, '-')     // Replace non-alphanumeric with dashes
    .replace(/^-+|-+$/g, '')          // Trim leading/trailing dashes
    .replace(/-+/g, '-');             // Collapse multiple dashes
}

/**
 * Generate a URL-friendly country slug
 */
export function countryToSlug(country: string): string {
  // Map common country codes/names to full lowercase names
  const countryMap: Record<string, string> = {
    'FR': 'france',
    'CH': 'switzerland',
    'AT': 'austria',
    'IT': 'italy',
    'DE': 'germany',
    'ES': 'spain',
    'AD': 'andorra',
    'US': 'usa',
    'CA': 'canada',
    'JP': 'japan',
    'NO': 'norway',
    'SE': 'sweden',
    'FI': 'finland',
    'PL': 'poland',
    'CZ': 'czechia',
    'SK': 'slovakia',
    'SI': 'slovenia',
    'GB': 'united-kingdom',
    'NZ': 'new-zealand',
    'AU': 'australia',
    'AR': 'argentina',
    'CL': 'chile',
  };

  return countryMap[country] || toSlug(country);
}

/**
 * Normalize a string for flexible matching (lowercase, remove non-alphanumeric)
 */
function normalizeForMatching(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Country aliases map - maps normalized variations to country codes
 * Includes: full names, abbreviations, common misspellings, with/without spaces
 */
const COUNTRY_ALIASES: Record<string, string> = {
  // France
  'france': 'FR', 'fr': 'FR', 'french': 'FR',
  // Switzerland
  'switzerland': 'CH', 'swiss': 'CH', 'ch': 'CH', 'suisse': 'CH', 'schweiz': 'CH', 'svizzera': 'CH',
  // Austria
  'austria': 'AT', 'at': 'AT', 'osterreich': 'AT', 'oesterreich': 'AT',
  // Italy
  'italy': 'IT', 'it': 'IT', 'italia': 'IT', 'italian': 'IT',
  // Germany
  'germany': 'DE', 'de': 'DE', 'deutschland': 'DE', 'german': 'DE',
  // Spain
  'spain': 'ES', 'es': 'ES', 'espana': 'ES', 'spanish': 'ES',
  // Andorra
  'andorra': 'AD', 'ad': 'AD',
  // United States
  'usa': 'US', 'us': 'US', 'unitedstates': 'US', 'unitedstatesofamerica': 'US',
  'america': 'US', 'american': 'US',
  // Canada
  'canada': 'CA', 'ca': 'CA', 'canadian': 'CA',
  // Japan
  'japan': 'JP', 'jp': 'JP', 'japanese': 'JP', 'nippon': 'JP',
  // Norway
  'norway': 'NO', 'no': 'NO', 'norge': 'NO', 'norwegian': 'NO',
  // Sweden
  'sweden': 'SE', 'se': 'SE', 'sverige': 'SE', 'swedish': 'SE',
  // Finland
  'finland': 'FI', 'fi': 'FI', 'suomi': 'FI', 'finnish': 'FI',
  // Poland
  'poland': 'PL', 'pl': 'PL', 'polska': 'PL', 'polish': 'PL',
  // Czechia / Czech Republic
  'czechia': 'CZ', 'cz': 'CZ', 'czech': 'CZ', 'czechrepublic': 'CZ',
  // Slovakia
  'slovakia': 'SK', 'sk': 'SK', 'slovak': 'SK', 'slovensko': 'SK',
  // Slovenia
  'slovenia': 'SI', 'si': 'SI', 'slovenian': 'SI', 'slovenija': 'SI',
  // United Kingdom
  'unitedkingdom': 'GB', 'uk': 'GB', 'gb': 'GB', 'greatbritain': 'GB',
  'britain': 'GB', 'british': 'GB', 'england': 'GB', 'scotland': 'GB', 'wales': 'GB',
  // New Zealand
  'newzealand': 'NZ', 'nz': 'NZ',
  // Australia
  'australia': 'AU', 'au': 'AU', 'aussie': 'AU', 'australian': 'AU',
  // Argentina
  'argentina': 'AR', 'ar': 'AR', 'argentinian': 'AR',
  // Chile
  'chile': 'CL', 'cl': 'CL', 'chilean': 'CL',
  // Additional European countries
  'romania': 'RO', 'ro': 'RO',
  'bulgaria': 'BG', 'bg': 'BG',
  'greece': 'GR', 'gr': 'GR', 'hellas': 'GR',
  'turkey': 'TR', 'tr': 'TR', 'turkiye': 'TR',
  'russia': 'RU', 'ru': 'RU', 'russian': 'RU',
  'ukraine': 'UA', 'ua': 'UA',
  'bosnia': 'BA', 'ba': 'BA', 'bosniaandherzegovina': 'BA',
  'serbia': 'RS', 'rs': 'RS',
  'croatia': 'HR', 'hr': 'HR', 'hrvatska': 'HR',
  'montenegro': 'ME', 'me': 'ME',
  'northmacedonia': 'MK', 'mk': 'MK', 'macedonia': 'MK',
  'albania': 'AL', 'al': 'AL',
  'iceland': 'IS', 'is': 'IS',
  'ireland': 'IE', 'ie': 'IE', 'eire': 'IE',
  'belgium': 'BE', 'be': 'BE',
  'netherlands': 'NL', 'nl': 'NL', 'holland': 'NL', 'dutch': 'NL',
  'luxembourg': 'LU', 'lu': 'LU',
  'liechtenstein': 'LI', 'li': 'LI',
  'monaco': 'MC', 'mc': 'MC',
  'sanmarino': 'SM', 'sm': 'SM',
  // Asia
  'china': 'CN', 'cn': 'CN', 'chinese': 'CN',
  'southkorea': 'KR', 'kr': 'KR', 'korea': 'KR',
  'india': 'IN', 'in': 'IN',
  'iran': 'IR', 'ir': 'IR',
  'kazakhstan': 'KZ', 'kz': 'KZ',
  'kyrgyzstan': 'KG', 'kg': 'KG',
  'lebanon': 'LB', 'lb': 'LB',
  'georgia': 'GE', 'ge': 'GE',
  'armenia': 'AM', 'am': 'AM',
  'azerbaijan': 'AZ', 'az': 'AZ',
  // South America
  'peru': 'PE', 'pe': 'PE',
  'bolivia': 'BO', 'bo': 'BO',
};

/**
 * Convert a country slug back to the country code.
 * Handles many variations: case, dashes, spaces, abbreviations, native names.
 * Returns null if country cannot be identified.
 */
export function slugToCountry(slug: string): string | null {
  const normalized = normalizeForMatching(slug);

  // Direct lookup
  if (COUNTRY_ALIASES[normalized]) {
    return COUNTRY_ALIASES[normalized];
  }

  // If it's a 2-letter code already, check if valid
  if (normalized.length === 2) {
    const upperCode = normalized.toUpperCase();
    // Check if this code exists as a value in our aliases
    if (Object.values(COUNTRY_ALIASES).includes(upperCode)) {
      return upperCode;
    }
  }

  // Not found
  return null;
}

/**
 * Get the canonical URL slug for a country code
 */
export function getCanonicalCountrySlug(countryCode: string): string {
  const canonicalSlugs: Record<string, string> = {
    'FR': 'france',
    'CH': 'switzerland',
    'AT': 'austria',
    'IT': 'italy',
    'DE': 'germany',
    'ES': 'spain',
    'AD': 'andorra',
    'US': 'usa',
    'CA': 'canada',
    'JP': 'japan',
    'NO': 'norway',
    'SE': 'sweden',
    'FI': 'finland',
    'PL': 'poland',
    'CZ': 'czechia',
    'SK': 'slovakia',
    'SI': 'slovenia',
    'GB': 'united-kingdom',
    'NZ': 'new-zealand',
    'AU': 'australia',
    'AR': 'argentina',
    'CL': 'chile',
  };
  return canonicalSlugs[countryCode] || countryCode.toLowerCase();
}

/**
 * Get display name for a country
 */
export function getCountryDisplayName(code: string): string {
  const countryNames: Record<string, string> = {
    'FR': 'France',
    'CH': 'Switzerland',
    'AT': 'Austria',
    'IT': 'Italy',
    'DE': 'Germany',
    'ES': 'Spain',
    'AD': 'Andorra',
    'US': 'United States',
    'CA': 'Canada',
    'JP': 'Japan',
    'NO': 'Norway',
    'SE': 'Sweden',
    'FI': 'Finland',
    'PL': 'Poland',
    'CZ': 'Czechia',
    'SK': 'Slovakia',
    'SI': 'Slovenia',
    'GB': 'United Kingdom',
    'NZ': 'New Zealand',
    'AU': 'Australia',
    'AR': 'Argentina',
    'CL': 'Chile',
  };

  return countryNames[code] || code;
}

/**
 * Base URL for the site
 */
export const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://skishade.com';

/**
 * SEO-optimized keywords for ski resorts
 */
export const SKI_KEYWORDS = [
  'ski map',
  'live ski conditions',
  'snow conditions',
  'sun shade slopes',
  'sunny slopes',
  'shaded slopes',
  '3d ski map',
  'real-time ski map',
  'piste map',
  'trail conditions',
  'ski resort weather',
  'slope conditions',
  'ski route planner',
  'ski navigation',
  'which slopes are sunny',
  'best snow conditions',
];

/**
 * Generate resort-specific keywords
 */
export function getResortKeywords(resortName: string, country: string): string[] {
  const countryName = getCountryDisplayName(country);
  return [
    `${resortName} ski map`,
    `${resortName} snow conditions`,
    `${resortName} piste map`,
    `${resortName} sunny slopes`,
    `${resortName} weather`,
    `${resortName} live conditions`,
    `ski ${resortName}`,
    `${resortName} ski resort`,
    `${resortName} ${countryName}`,
    `${resortName} slope map`,
    `${resortName} trail map`,
    `${resortName} sun shade`,
  ];
}

/**
 * Generate country-specific keywords
 */
export function getCountryKeywords(country: string): string[] {
  const countryName = getCountryDisplayName(country);
  return [
    `${countryName} ski resorts`,
    `${countryName} ski map`,
    `${countryName} snow conditions`,
    `ski resorts in ${countryName}`,
    `${countryName} piste maps`,
    `${countryName} skiing`,
    `best ski resorts ${countryName}`,
    `${countryName} ski conditions`,
  ];
}

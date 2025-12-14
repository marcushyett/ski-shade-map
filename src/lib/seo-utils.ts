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
 * Convert a country slug back to the country code
 */
export function slugToCountry(slug: string): string {
  const slugToCountryMap: Record<string, string> = {
    'france': 'FR',
    'switzerland': 'CH',
    'austria': 'AT',
    'italy': 'IT',
    'germany': 'DE',
    'spain': 'ES',
    'andorra': 'AD',
    'usa': 'US',
    'canada': 'CA',
    'japan': 'JP',
    'norway': 'NO',
    'sweden': 'SE',
    'finland': 'FI',
    'poland': 'PL',
    'czechia': 'CZ',
    'slovakia': 'SK',
    'slovenia': 'SI',
    'united-kingdom': 'GB',
    'new-zealand': 'NZ',
    'australia': 'AU',
    'argentina': 'AR',
    'chile': 'CL',
  };

  return slugToCountryMap[slug] || slug.toUpperCase();
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

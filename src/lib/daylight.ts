/**
 * Calculate daylight hours based on latitude and date.
 * Uses astronomical formula - pure math, no API calls.
 */

/**
 * Get day of year (1-365)
 */
function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/**
 * Calculate daylight hours for a given latitude and date.
 * Based on the astronomical formula using solar declination.
 *
 * @param latitude - Latitude in degrees (-90 to 90)
 * @param date - Date to calculate for (defaults to today)
 * @returns Daylight hours (0-24)
 */
export function getDaylightHours(latitude: number, date: Date = new Date()): number {
  const dayOfYear = getDayOfYear(date);

  // Solar declination angle (in radians)
  // Approximation: δ = -23.45° × cos(360/365 × (d + 10))
  const declination = -23.45 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
  const declinationRad = declination * (Math.PI / 180);

  // Latitude in radians
  const latRad = latitude * (Math.PI / 180);

  // Hour angle at sunrise/sunset
  // cos(ω) = -tan(φ) × tan(δ)
  const cosHourAngle = -Math.tan(latRad) * Math.tan(declinationRad);

  // Handle polar day (midnight sun) and polar night
  if (cosHourAngle < -1) {
    return 24; // Polar day - sun never sets
  }
  if (cosHourAngle > 1) {
    return 0; // Polar night - sun never rises
  }

  // Hour angle in radians
  const hourAngle = Math.acos(cosHourAngle);

  // Daylight hours = 2 × hour angle × (24 / 2π)
  const daylightHours = (2 * hourAngle * 24) / (2 * Math.PI);

  return Math.round(daylightHours * 10) / 10; // Round to 1 decimal
}

/**
 * Get a human-friendly description of daylight conditions
 */
export function getDaylightDescription(hours: number): string {
  if (hours >= 16) return 'Very long days';
  if (hours >= 12) return 'Long days';
  if (hours >= 10) return 'Moderate daylight';
  if (hours >= 8) return 'Short days';
  if (hours >= 6) return 'Very short days';
  if (hours > 0) return 'Minimal daylight';
  return 'Polar night';
}

/**
 * Format daylight hours for display
 */
export function formatDaylightHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

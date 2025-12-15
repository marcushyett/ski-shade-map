/**
 * Route Sun Calculator
 * 
 * Efficiently calculates sun exposure for navigation routes.
 * Optimized for performance with sampling and caching.
 */

import { getSunPosition, type SunPosition } from './suncalc';
import type { RouteSegment, NavigationRoute } from './navigation';
import type { HourlyWeather } from './weather-types';
import type { SkiAreaDetails } from './types';
import tzlookup from 'tz-lookup';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

// ============================================================================
// Types
// ============================================================================

export interface RouteSunAnalysis {
  // Overall sun percentage for the route (0-100)
  sunPercentage: number;
  // Sun distribution in time segments (10-min intervals)
  sunDistribution: SunDistributionSegment[];
  // Whether the weather is too bad to calculate sun (just use fastest route)
  isBadWeather: boolean;
  // Is the calculation reliable
  isReliable: boolean;
}

export interface SunDistributionSegment {
  // Minutes from start of journey
  startMinutes: number;
  endMinutes: number;
  // Sun percentage for this segment (0-100)
  sunPercentage: number;
  // Time of day (for display)
  timeOfDay: string;
}

export interface SunnyRouteOptions {
  // Whether sunny routing is enabled
  enabled: boolean;
  // Maximum additional time tolerance (in minutes)
  toleranceMinutes: number;
  // Start time for the journey
  startTime: Date;
}

// ============================================================================
// Constants
// ============================================================================

// Sample every N meters along the route for sun calculation (for efficiency)
const SAMPLE_DISTANCE_METERS = 100;

// Minimum route time (seconds) before we consider sun position changes
const MIN_JOURNEY_TIME_FOR_DYNAMIC_SUN = 15 * 60; // 15 minutes

// Weather thresholds for "bad weather" (skip sun calculation)
const BAD_CLOUD_COVER_THRESHOLD = 80; // >80% = bad weather
const BAD_VISIBILITY_THRESHOLD = 2000; // <2km = bad weather

// Cache for sun positions to avoid recalculating
const sunPositionCache = new Map<string, SunPosition>();

// Cache for timezone lookups
const timezoneCache = new Map<string, string>();

// ============================================================================
// Timezone Helpers
// ============================================================================

/**
 * Get the IANA timezone for a location (cached)
 */
function getTimezone(latitude: number, longitude: number): string {
  const cacheKey = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  const cached = timezoneCache.get(cacheKey);
  if (cached) return cached;
  
  const timezone = tzlookup(latitude, longitude) || 'UTC';
  timezoneCache.set(cacheKey, timezone);
  return timezone;
}

/**
 * Get local time at a resort location
 */
export function getResortLocalTime(utcTime: Date, latitude: number, longitude: number): Date {
  const timezone = getTimezone(latitude, longitude);
  return toZonedTime(utcTime, timezone);
}

/**
 * Convert local resort time to UTC
 */
export function resortLocalTimeToUTC(localTime: Date, latitude: number, longitude: number): Date {
  const timezone = getTimezone(latitude, longitude);
  return fromZonedTime(localTime, timezone);
}

/**
 * Round a date to the nearest 5-minute interval
 */
export function roundToNearest5Minutes(date: Date): Date {
  const ms = date.getTime();
  const fiveMinutesMs = 5 * 60 * 1000;
  return new Date(Math.round(ms / fiveMinutesMs) * fiveMinutesMs);
}

/**
 * Format time for display (HH:MM in 24h format)
 */
export function formatTimeHHMM(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ============================================================================
// Sun Calculation Helpers
// ============================================================================

/**
 * Get cached sun position for a given time and location
 */
function getCachedSunPosition(time: Date, latitude: number, longitude: number): SunPosition {
  // Round to 5-minute intervals for caching
  const roundedTime = roundToNearest5Minutes(time);
  const cacheKey = `${roundedTime.getTime()}-${latitude.toFixed(3)}-${longitude.toFixed(3)}`;
  
  const cached = sunPositionCache.get(cacheKey);
  if (cached) return cached;
  
  const sunPos = getSunPosition(roundedTime, latitude, longitude);
  sunPositionCache.set(cacheKey, sunPos);
  
  // Limit cache size
  if (sunPositionCache.size > 1000) {
    const firstKey = sunPositionCache.keys().next().value;
    if (firstKey) sunPositionCache.delete(firstKey);
  }
  
  return sunPos;
}

/**
 * Check if a segment is in sun based on slope orientation vs sun position
 */
function isSegmentInSun(
  slopeAspect: number, // Direction slope faces (0-360)
  sunAzimuth: number,
  sunAltitude: number
): boolean {
  // If sun is below horizon, not in sun
  if (sunAltitude <= 0) return false;
  
  // Calculate angle difference between slope facing direction and sun
  let angleDiff = Math.abs(sunAzimuth - slopeAspect);
  if (angleDiff > 180) angleDiff = 360 - angleDiff;
  
  // Slope is in shade if it faces away from sun (angle diff > 90°)
  const shadedByOrientation = angleDiff > 90;
  // Low sun creates more shade even if facing towards sun
  const shadedByLowSun = sunAltitude < 15 && angleDiff > 60;
  
  return !shadedByOrientation && !shadedByLowSun;
}

/**
 * Calculate slope aspect from a line segment
 * Returns the direction the slope faces (perpendicular to travel direction)
 */
function calculateSegmentAspect(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  
  // Bearing in degrees (0-360)
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  // Slope aspect is perpendicular to travel direction
  return (bearing + 90) % 360;
}

/**
 * Calculate distance between two coordinates in meters
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ============================================================================
// Weather Check
// ============================================================================

/**
 * Check if weather conditions are too bad for sun calculation
 * Returns true if we should just use fastest route
 */
export function isBadWeatherForSunRouting(
  hourlyWeather: HourlyWeather[] | undefined,
  startTime: Date,
  durationMinutes: number
): boolean {
  if (!hourlyWeather || hourlyWeather.length === 0) {
    // No weather data - can't determine, assume okay
    return false;
  }
  
  const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
  
  // Find weather entries that overlap with our journey
  const relevantWeather = hourlyWeather.filter(h => {
    const hTime = new Date(h.time);
    return hTime >= startTime && hTime <= endTime;
  });
  
  if (relevantWeather.length === 0) {
    // No weather data for this time range
    return false;
  }
  
  // Calculate average cloud cover and visibility
  const avgCloudCover = relevantWeather.reduce((sum, h) => sum + h.cloudCover, 0) / relevantWeather.length;
  const avgVisibility = relevantWeather.reduce((sum, h) => sum + h.visibility, 0) / relevantWeather.length;
  
  // Check for precipitation
  const hasPrecipitation = relevantWeather.some(h => h.precipitation > 0 || h.snowfall > 0);
  
  return avgCloudCover > BAD_CLOUD_COVER_THRESHOLD || 
         avgVisibility < BAD_VISIBILITY_THRESHOLD || 
         hasPrecipitation;
}

// ============================================================================
// Main Route Sun Analysis
// ============================================================================

/**
 * Calculate sun exposure analysis for a route
 * 
 * For efficiency:
 * - Samples points along the route rather than every coordinate
 * - Caches sun position calculations
 * - Uses static sun position for short routes (<15 min)
 * - Groups into 10-minute distribution segments
 */
export function analyzeRouteSunExposure(
  route: NavigationRoute,
  startTime: Date,
  skiArea: SkiAreaDetails,
  hourlyWeather?: HourlyWeather[]
): RouteSunAnalysis {
  const durationMinutes = route.totalTime / 60;
  
  // Check weather first
  const badWeather = isBadWeatherForSunRouting(hourlyWeather, startTime, durationMinutes);
  if (badWeather) {
    return {
      sunPercentage: 0,
      sunDistribution: [],
      isBadWeather: true,
      isReliable: false,
    };
  }
  
  // Determine if we need to consider sun movement (routes > 15 min)
  const useDynamicSun = route.totalTime > MIN_JOURNEY_TIME_FOR_DYNAMIC_SUN;
  
  // Collect all sample points with their times
  const samples: { lat: number; lng: number; aspect: number; timeOffset: number }[] = [];
  
  let accumulatedTime = 0;
  let accumulatedDistance = 0;
  let lastSampleDistance = 0;
  
  for (const segment of route.segments) {
    // Lifts don't have sun exposure (you're in the lift)
    if (segment.type === 'lift') {
      accumulatedTime += segment.time;
      accumulatedDistance += segment.distance;
      lastSampleDistance = accumulatedDistance;
      continue;
    }
    
    const coords = segment.coordinates;
    if (coords.length < 2) continue;
    
    // Calculate time per meter for this segment
    const timePerMeter = segment.time / segment.distance;
    
    for (let i = 0; i < coords.length - 1; i++) {
      const [lng1, lat1] = coords[i];
      const [lng2, lat2] = coords[i + 1];
      
      const segmentDist = haversineDistance(lat1, lng1, lat2, lng2);
      
      // Sample if we've traveled enough since last sample
      if (accumulatedDistance - lastSampleDistance >= SAMPLE_DISTANCE_METERS) {
        const aspect = calculateSegmentAspect(lng1, lat1, lng2, lat2);
        samples.push({
          lat: lat1,
          lng: lng1,
          aspect,
          timeOffset: accumulatedTime,
        });
        lastSampleDistance = accumulatedDistance;
      }
      
      accumulatedTime += segmentDist * timePerMeter;
      accumulatedDistance += segmentDist;
    }
    
    // Always sample the last point of runs
    if (coords.length >= 2) {
      const [lng1, lat1] = coords[coords.length - 2];
      const [lng2, lat2] = coords[coords.length - 1];
      const aspect = calculateSegmentAspect(lng1, lat1, lng2, lat2);
      samples.push({
        lat: lat2,
        lng: lng2,
        aspect,
        timeOffset: accumulatedTime,
      });
      lastSampleDistance = accumulatedDistance;
    }
  }
  
  if (samples.length === 0) {
    return {
      sunPercentage: 0,
      sunDistribution: [],
      isBadWeather: false,
      isReliable: false,
    };
  }
  
  // Calculate sun exposure for each sample
  let sunnyCount = 0;
  
  // For distribution, group by 10-minute intervals
  const intervalMs = 10 * 60 * 1000;
  const distributionMap = new Map<number, { sunny: number; total: number }>();
  
  // Get static sun position for short routes
  const staticSunPos = !useDynamicSun 
    ? getCachedSunPosition(startTime, skiArea.latitude, skiArea.longitude)
    : null;
  
  for (const sample of samples) {
    // Get sun position (dynamic or static)
    const sunPos = useDynamicSun
      ? getCachedSunPosition(
          new Date(startTime.getTime() + sample.timeOffset * 1000),
          sample.lat,
          sample.lng
        )
      : staticSunPos!;
    
    const inSun = isSegmentInSun(sample.aspect, sunPos.azimuthDegrees, sunPos.altitudeDegrees);
    if (inSun) sunnyCount++;
    
    // Add to distribution
    const intervalIndex = Math.floor((sample.timeOffset * 1000) / intervalMs);
    const existing = distributionMap.get(intervalIndex) || { sunny: 0, total: 0 };
    existing.total++;
    if (inSun) existing.sunny++;
    distributionMap.set(intervalIndex, existing);
  }
  
  // Build sun distribution segments
  const sunDistribution: SunDistributionSegment[] = [];
  const sortedIntervals = Array.from(distributionMap.entries()).sort((a, b) => a[0] - b[0]);
  
  for (const [intervalIndex, data] of sortedIntervals) {
    const startMinutes = intervalIndex * 10;
    const endMinutes = startMinutes + 10;
    const segmentTime = new Date(startTime.getTime() + startMinutes * 60 * 1000);
    
    sunDistribution.push({
      startMinutes,
      endMinutes: Math.min(endMinutes, Math.ceil(route.totalTime / 60)),
      sunPercentage: data.total > 0 ? (data.sunny / data.total) * 100 : 0,
      timeOfDay: formatTimeHHMM(segmentTime),
    });
  }
  
  return {
    sunPercentage: samples.length > 0 ? (sunnyCount / samples.length) * 100 : 0,
    sunDistribution,
    isBadWeather: false,
    isReliable: samples.length >= 3,
  };
}

/**
 * Compare two routes and return the sunnier one (within tolerance)
 * 
 * @param fastestRoute - The fastest route
 * @param alternativeRoutes - Alternative routes to consider
 * @param toleranceMinutes - Maximum extra time allowed
 * @param startTime - When the journey starts
 * @param skiArea - Ski area details
 * @param hourlyWeather - Weather data
 * @returns The best route (fastest if bad weather, sunniest within tolerance otherwise)
 */
export function findSunniestRoute(
  fastestRoute: NavigationRoute,
  alternativeRoutes: NavigationRoute[],
  toleranceMinutes: number,
  startTime: Date,
  skiArea: SkiAreaDetails,
  hourlyWeather?: HourlyWeather[]
): { route: NavigationRoute; analysis: RouteSunAnalysis } {
  // Analyze fastest route first
  const fastestAnalysis = analyzeRouteSunExposure(fastestRoute, startTime, skiArea, hourlyWeather);
  
  // If bad weather, just return fastest route
  if (fastestAnalysis.isBadWeather) {
    return { route: fastestRoute, analysis: fastestAnalysis };
  }
  
  // Calculate tolerance in seconds
  const toleranceSeconds = toleranceMinutes * 60;
  const maxAllowedTime = fastestRoute.totalTime + toleranceSeconds;
  
  // Track best route
  let bestRoute = fastestRoute;
  let bestAnalysis = fastestAnalysis;
  
  // Check all alternative routes
  for (const altRoute of alternativeRoutes) {
    // Skip if route exceeds tolerance
    if (altRoute.totalTime > maxAllowedTime) continue;
    
    const altAnalysis = analyzeRouteSunExposure(altRoute, startTime, skiArea, hourlyWeather);
    
    // Skip unreliable analyses
    if (!altAnalysis.isReliable) continue;
    
    // Pick route with higher sun percentage
    if (altAnalysis.sunPercentage > bestAnalysis.sunPercentage) {
      bestRoute = altRoute;
      bestAnalysis = altAnalysis;
    }
  }
  
  return { route: bestRoute, analysis: bestAnalysis };
}

// ============================================================================
// Clear Cache (for memory management)
// ============================================================================

export function clearSunCalculationCache(): void {
  sunPositionCache.clear();
}


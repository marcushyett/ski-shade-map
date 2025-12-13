import { getSunPosition, getSunTimes } from './suncalc';
import type { RunData } from './types';
import type { HourlyWeather } from './weather-types';

export interface SunnyTimeWindow {
  startTime: Date;
  endTime: Date;
  sunnyPercentage: number;
}

// Sun exposure levels
export type SunLevel = 'full' | 'partial' | 'low' | 'none';

export interface HourlySunData {
  hour: number; // 0-23
  percentage: number; // 0-100
}

export interface RunSunAnalysis {
  runId: string;
  runName: string | null;
  difficulty: string | null;
  sunniestWindow: SunnyTimeWindow | null;
  sunLevel: SunLevel;
  averageSunnyPercentage: number;
  hourlyPercentages: HourlySunData[]; // Sun percentage for each hour of daylight
  isBadWeather: boolean;
  weatherCode: number | null;
}

// Sun thresholds
const FULL_SUN_THRESHOLD = 75;    // >75% = full sun
const PARTIAL_SUN_THRESHOLD = 50; // 50-75% = partial sun
const LOW_SUN_THRESHOLD = 25;     // 25-50% = low sun
// <25% = no sun times shown

// Minimum duration in minutes for a valid sunny window
const MIN_WINDOW_MINUTES = 30;
// Sampling interval in minutes (finer granularity for more accurate times)
const SAMPLE_INTERVAL_MINUTES = 5;

// Weather thresholds
const BAD_CLOUD_COVER_THRESHOLD = 70; // >70% average cloud cover = bad weather
const BAD_VISIBILITY_THRESHOLD = 5000; // <5km visibility = bad weather

/**
 * Calculate the percentage of a run that is in sunlight at a given time
 */
function calculateSunnyPercentage(
  run: RunData,
  time: Date,
  latitude: number,
  longitude: number
): number {
  const sunPos = getSunPosition(time, latitude, longitude);
  
  // If sun is below horizon, 0% sunny
  if (sunPos.altitudeDegrees <= 0) {
    return 0;
  }
  
  const sunAzimuth = sunPos.azimuthDegrees;
  const sunAltitude = sunPos.altitudeDegrees;
  
  let coords: number[][] = [];
  
  if (run.geometry.type === 'LineString') {
    coords = run.geometry.coordinates;
  } else if (run.geometry.type === 'Polygon') {
    coords = run.geometry.coordinates[0];
  }
  
  if (coords.length < 2) return 0;
  
  let sunnySegments = 0;
  let totalSegments = 0;
  
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    
    // Calculate bearing of segment
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    
    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
    
    const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    const slopeAspect = (bearing + 90) % 360;
    
    // Check if segment is in sun
    let angleDiff = Math.abs(sunAzimuth - slopeAspect);
    if (angleDiff > 180) angleDiff = 360 - angleDiff;
    
    const shadedByOrientation = angleDiff > 90;
    const shadedByLowSun = sunAltitude < 15 && angleDiff > 60;
    const isShaded = shadedByOrientation || shadedByLowSun;
    
    if (!isShaded) {
      sunnySegments++;
    }
    totalSegments++;
  }
  
  return totalSegments > 0 ? (sunnySegments / totalSegments) * 100 : 0;
}

/**
 * Find contiguous periods where sun percentage is above threshold
 */
function findSunPeriods(
  intervals: { time: Date; percentage: number }[],
  threshold: number
): SunnyTimeWindow[] {
  const windows: SunnyTimeWindow[] = [];
  let currentWindow: { start: Date; intervals: { time: Date; percentage: number }[] } | null = null;
  
  for (const interval of intervals) {
    if (interval.percentage >= threshold) {
      if (!currentWindow) {
        currentWindow = { start: interval.time, intervals: [interval] };
      } else {
        currentWindow.intervals.push(interval);
      }
    } else {
      // End current window if it exists and is long enough
      if (currentWindow) {
        const durationMinutes = currentWindow.intervals.length * SAMPLE_INTERVAL_MINUTES;
        if (durationMinutes >= MIN_WINDOW_MINUTES) {
          const avgPercentage = currentWindow.intervals.reduce((sum, i) => sum + i.percentage, 0) / currentWindow.intervals.length;
          const lastInterval = currentWindow.intervals[currentWindow.intervals.length - 1];
          windows.push({
            startTime: currentWindow.start,
            endTime: new Date(lastInterval.time.getTime() + SAMPLE_INTERVAL_MINUTES * 60 * 1000),
            sunnyPercentage: avgPercentage,
          });
        }
        currentWindow = null;
      }
    }
  }
  
  // Handle window that extends to end of day
  if (currentWindow) {
    const durationMinutes = currentWindow.intervals.length * SAMPLE_INTERVAL_MINUTES;
    if (durationMinutes >= MIN_WINDOW_MINUTES) {
      const avgPercentage = currentWindow.intervals.reduce((sum, i) => sum + i.percentage, 0) / currentWindow.intervals.length;
      const lastInterval = currentWindow.intervals[currentWindow.intervals.length - 1];
      windows.push({
        startTime: currentWindow.start,
        endTime: new Date(lastInterval.time.getTime() + SAMPLE_INTERVAL_MINUTES * 60 * 1000),
        sunnyPercentage: avgPercentage,
      });
    }
  }
  
  return windows;
}

/**
 * Get the best (longest) window from a list, preferring higher sun percentage for ties
 */
function getBestWindow(windows: SunnyTimeWindow[]): SunnyTimeWindow | null {
  if (windows.length === 0) return null;
  
  return windows.reduce((best, current) => {
    const bestDuration = best.endTime.getTime() - best.startTime.getTime();
    const currentDuration = current.endTime.getTime() - current.startTime.getTime();
    
    if (currentDuration > bestDuration) {
      return current;
    } else if (currentDuration === bestDuration && current.sunnyPercentage > best.sunnyPercentage) {
      return current;
    }
    return best;
  });
}

/**
 * Find the sunniest time window for a run throughout the day
 */
export function findSunniestTimeWindow(
  run: RunData,
  date: Date,
  latitude: number,
  longitude: number,
  hourlyWeather?: HourlyWeather[]
): RunSunAnalysis {
  const sunTimes = getSunTimes(date, latitude, longitude);
  const today = date.toDateString();
  
  // Check if it's a bad weather day (heavy cloud cover, precipitation, or low visibility)
  const todayWeather = hourlyWeather?.filter(h => {
    const hDate = new Date(h.time);
    return hDate.toDateString() === today;
  }) || [];
  
  // Calculate average cloud cover and visibility for today
  const avgCloudCover = todayWeather.length > 0
    ? todayWeather.reduce((sum, h) => sum + h.cloudCover, 0) / todayWeather.length
    : 0;
  
  const avgVisibility = todayWeather.length > 0
    ? todayWeather.reduce((sum, h) => sum + h.visibility, 0) / todayWeather.length
    : 10000; // Default good visibility if no data
  
  // Bad weather: heavy cloud cover (>70%), low visibility (<5km), or precipitation codes
  const badWeatherCodes = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
  const hasPrecipitation = todayWeather.some(h => badWeatherCodes.includes(h.weatherCode));
  const isBadWeather = avgCloudCover > BAD_CLOUD_COVER_THRESHOLD || 
                       avgVisibility < BAD_VISIBILITY_THRESHOLD || 
                       hasPrecipitation;
  
  // Get the most common weather code for today
  const weatherCodeCounts: Record<number, number> = {};
  todayWeather.forEach(h => {
    weatherCodeCounts[h.weatherCode] = (weatherCodeCounts[h.weatherCode] || 0) + 1;
  });
  const mostCommonWeatherCode = Object.entries(weatherCodeCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  
  if (isBadWeather) {
    return {
      runId: run.id,
      runName: run.name,
      difficulty: run.difficulty,
      sunniestWindow: null,
      sunLevel: 'none',
      averageSunnyPercentage: 0,
      hourlyPercentages: [], // Empty for bad weather
      isBadWeather: true,
      weatherCode: mostCommonWeatherCode ? parseInt(mostCommonWeatherCode) : null,
    };
  }
  
  // Calculate sunny percentage at finer intervals during daylight
  const intervals: { time: Date; percentage: number }[] = [];
  
  const startTime = new Date(sunTimes.sunrise);
  const endTime = new Date(sunTimes.sunset);
  
  // Ensure we're working with valid dates
  if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
    return {
      runId: run.id,
      runName: run.name,
      difficulty: run.difficulty,
      sunniestWindow: null,
      sunLevel: 'none',
      averageSunnyPercentage: 0,
      hourlyPercentages: [],
      isBadWeather: false,
      weatherCode: null,
    };
  }
  
  const currentTime = new Date(startTime);
  while (currentTime <= endTime) {
    const percentage = calculateSunnyPercentage(run, currentTime, latitude, longitude);
    intervals.push({ time: new Date(currentTime), percentage });
    currentTime.setMinutes(currentTime.getMinutes() + SAMPLE_INTERVAL_MINUTES);
  }
  
  if (intervals.length === 0) {
    return {
      runId: run.id,
      runName: run.name,
      difficulty: run.difficulty,
      sunniestWindow: null,
      sunLevel: 'none',
      averageSunnyPercentage: 0,
      hourlyPercentages: [],
      isBadWeather: false,
      weatherCode: null,
    };
  }
  
  // Calculate average sunny percentage for the whole day
  const avgDayPercentage = intervals.reduce((sum, int) => sum + int.percentage, 0) / intervals.length;
  
  // Calculate hourly percentages (average of all intervals within each hour)
  const hourlyMap: Record<number, number[]> = {};
  intervals.forEach(int => {
    const hour = int.time.getHours();
    if (!hourlyMap[hour]) hourlyMap[hour] = [];
    hourlyMap[hour].push(int.percentage);
  });
  
  const hourlyPercentages: HourlySunData[] = Object.entries(hourlyMap)
    .map(([hour, percentages]) => ({
      hour: parseInt(hour),
      percentage: percentages.reduce((a, b) => a + b, 0) / percentages.length,
    }))
    .sort((a, b) => a.hour - b.hour);
  
  // Try to find windows at each threshold level, from highest to lowest
  // First try >75% (full sun)
  let fullSunPeriods = findSunPeriods(intervals, FULL_SUN_THRESHOLD);
  let bestWindow = getBestWindow(fullSunPeriods);
  
  if (bestWindow) {
    return {
      runId: run.id,
      runName: run.name,
      difficulty: run.difficulty,
      sunniestWindow: bestWindow,
      sunLevel: 'full',
      averageSunnyPercentage: avgDayPercentage,
      hourlyPercentages,
      isBadWeather: false,
      weatherCode: mostCommonWeatherCode ? parseInt(mostCommonWeatherCode) : null,
    };
  }
  
  // Try >50% (partial sun)
  let partialSunPeriods = findSunPeriods(intervals, PARTIAL_SUN_THRESHOLD);
  bestWindow = getBestWindow(partialSunPeriods);
  
  if (bestWindow) {
    return {
      runId: run.id,
      runName: run.name,
      difficulty: run.difficulty,
      sunniestWindow: bestWindow,
      sunLevel: 'partial',
      averageSunnyPercentage: avgDayPercentage,
      hourlyPercentages,
      isBadWeather: false,
      weatherCode: mostCommonWeatherCode ? parseInt(mostCommonWeatherCode) : null,
    };
  }
  
  // Try >25% (low sun)
  let lowSunPeriods = findSunPeriods(intervals, LOW_SUN_THRESHOLD);
  bestWindow = getBestWindow(lowSunPeriods);
  
  if (bestWindow) {
    return {
      runId: run.id,
      runName: run.name,
      difficulty: run.difficulty,
      sunniestWindow: bestWindow,
      sunLevel: 'low',
      averageSunnyPercentage: avgDayPercentage,
      hourlyPercentages,
      isBadWeather: false,
      weatherCode: mostCommonWeatherCode ? parseInt(mostCommonWeatherCode) : null,
    };
  }
  
  // No meaningful sun periods found (<25% at all times)
  return {
    runId: run.id,
    runName: run.name,
    difficulty: run.difficulty,
    sunniestWindow: null,
    sunLevel: 'none',
    averageSunnyPercentage: avgDayPercentage,
    hourlyPercentages,
    isBadWeather: false,
    weatherCode: mostCommonWeatherCode ? parseInt(mostCommonWeatherCode) : null,
  };
}

/**
 * Analyze all favourite runs and return their sun analysis
 */
export function analyzeRuns(
  runs: RunData[],
  date: Date,
  latitude: number,
  longitude: number,
  hourlyWeather?: HourlyWeather[]
): RunSunAnalysis[] {
  return runs.map(run => findSunniestTimeWindow(run, date, latitude, longitude, hourlyWeather));
}

/**
 * Format time for display (e.g., "10:05")
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Format duration in a human-readable way
 */
export function formatDuration(startTime: Date, endTime: Date): string {
  const durationMs = endTime.getTime() - startTime.getTime();
  const hours = Math.floor(durationMs / (1000 * 60 * 60));
  const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours === 0) {
    return `${minutes}m`;
  } else if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h${minutes}m`;
}

/**
 * Get description for sun level
 */
export function getSunLevelDescription(level: SunLevel): string {
  switch (level) {
    case 'full': return '>75% of run in direct sunlight';
    case 'partial': return '50-75% of run in direct sunlight';
    case 'low': return '25-50% of run in direct sunlight';
    case 'none': return 'Mostly shaded';
  }
}

/**
 * Run statistics calculated from geometry
 */
export interface RunStats {
  distance: number; // meters
  ascent: number; // meters
  descent: number; // meters
  elevationHigh: number; // meters
  elevationLow: number; // meters
  maxSlope: number; // degrees
  avgSlope: number; // degrees
  hasElevation: boolean;
  elevationProfile: { distance: number; elevation: number }[]; // for profile chart
}

/**
 * Calculate distance between two coordinates in meters using Haversine formula
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate run statistics from geometry
 */
export function calculateRunStats(run: RunData): RunStats | null {
  let coords: number[][] = [];
  
  if (run.geometry.type === 'LineString') {
    coords = run.geometry.coordinates;
  } else if (run.geometry.type === 'Polygon') {
    coords = run.geometry.coordinates[0];
  }
  
  if (coords.length < 2) return null;
  
  // Check if we have valid elevation data (3rd element > 0 in coordinates)
  // Elevation of 0 is almost certainly missing data, not actual sea level
  const hasElevation = coords.some(c => c.length >= 3 && typeof c[2] === 'number' && c[2] > 100);
  
  let distance = 0;
  let ascent = 0;
  let descent = 0;
  let elevationHigh = -Infinity;
  let elevationLow = Infinity;
  let maxSlope = 0;
  let totalSlope = 0;
  let slopeCount = 0;
  const elevationProfile: { distance: number; elevation: number }[] = [];
  
  for (let i = 0; i < coords.length; i++) {
    const [lng, lat, elev] = coords[i];
    // Only use elevation if it's a valid number > 100m (ski resorts are rarely at sea level)
    const hasValidElev = typeof elev === 'number' && elev > 100;
    const elevation = hasValidElev ? elev : null;
    
    if (hasElevation && elevation !== null) {
      if (elevation > elevationHigh) elevationHigh = elevation;
      if (elevation < elevationLow) elevationLow = elevation;
      elevationProfile.push({ distance, elevation });
    }
    
    if (i > 0) {
      const [prevLng, prevLat, prevElev] = coords[i - 1];
      const prevHasValidElev = typeof prevElev === 'number' && prevElev > 100;
      const prevElevation = prevHasValidElev ? prevElev : null;
      
      const segmentDistance = haversineDistance(prevLat, prevLng, lat, lng);
      distance += segmentDistance;
      
      if (hasElevation && segmentDistance > 0 && elevation !== null && prevElevation !== null) {
        const elevChange = elevation - prevElevation;
        if (elevChange > 0) {
          ascent += elevChange;
        } else {
          descent += Math.abs(elevChange);
        }
        
        // Calculate slope angle
        const slopeAngle = Math.atan(Math.abs(elevChange) / segmentDistance) * 180 / Math.PI;
        if (slopeAngle > maxSlope) maxSlope = slopeAngle;
        totalSlope += slopeAngle;
        slopeCount++;
      }
    }
  }
  
  // Update last elevation profile point with final distance
  if (elevationProfile.length > 0) {
    elevationProfile[elevationProfile.length - 1].distance = distance;
  }
  
  return {
    distance,
    ascent,
    descent,
    elevationHigh: hasElevation ? elevationHigh : 0,
    elevationLow: hasElevation ? elevationLow : 0,
    maxSlope,
    avgSlope: slopeCount > 0 ? totalSlope / slopeCount : 0,
    hasElevation,
    elevationProfile: hasElevation ? elevationProfile : [],
  };
}

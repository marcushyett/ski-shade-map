import { getSunPosition, getSunTimes } from './suncalc';
import type { RunData } from './types';
import type { HourlyWeather } from './weather-types';

export interface SunnyTimeWindow {
  startTime: Date;
  endTime: Date;
  sunnyPercentage: number;
}

export interface RunSunAnalysis {
  runId: string;
  runName: string | null;
  difficulty: string | null;
  sunniestWindow: SunnyTimeWindow | null;
  averageSunnyPercentage: number;
  isBadWeather: boolean;
  weatherCode: number | null;
}

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
  
  // Check if it's a bad weather day (heavy cloud cover or precipitation)
  const todayWeather = hourlyWeather?.filter(h => {
    const hDate = new Date(h.time);
    return hDate.toDateString() === today;
  }) || [];
  
  // Determine if it's bad weather based on average cloud cover and weather codes
  const avgCloudCover = todayWeather.length > 0
    ? todayWeather.reduce((sum, h) => sum + h.cloudCover, 0) / todayWeather.length
    : 0;
  
  // Bad weather: heavy cloud cover (>80%) or precipitation codes
  const badWeatherCodes = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
  const hasPrecipitation = todayWeather.some(h => badWeatherCodes.includes(h.weatherCode));
  const isBadWeather = avgCloudCover > 80 || hasPrecipitation;
  
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
      averageSunnyPercentage: 0,
      isBadWeather: true,
      weatherCode: mostCommonWeatherCode ? parseInt(mostCommonWeatherCode) : null,
    };
  }
  
  // Calculate sunny percentage for each 15-minute interval during daylight
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
      averageSunnyPercentage: 0,
      isBadWeather: false,
      weatherCode: null,
    };
  }
  
  const currentTime = new Date(startTime);
  while (currentTime <= endTime) {
    const percentage = calculateSunnyPercentage(run, currentTime, latitude, longitude);
    intervals.push({ time: new Date(currentTime), percentage });
    currentTime.setMinutes(currentTime.getMinutes() + 15);
  }
  
  if (intervals.length === 0) {
    return {
      runId: run.id,
      runName: run.name,
      difficulty: run.difficulty,
      sunniestWindow: null,
      averageSunnyPercentage: 0,
      isBadWeather: false,
      weatherCode: null,
    };
  }
  
  // Find the best contiguous window (at least 30 mins) with highest average sun
  let bestWindow: SunnyTimeWindow | null = null;
  let bestAvgPercentage = 0;
  
  // Minimum window size: 2 intervals (30 minutes)
  const minWindowSize = 2;
  // Look for windows up to 4 intervals (1 hour)
  const maxWindowSize = 4;
  
  for (let windowSize = minWindowSize; windowSize <= maxWindowSize; windowSize++) {
    for (let i = 0; i <= intervals.length - windowSize; i++) {
      const windowIntervals = intervals.slice(i, i + windowSize);
      const avgPercentage = windowIntervals.reduce((sum, int) => sum + int.percentage, 0) / windowSize;
      
      if (avgPercentage > bestAvgPercentage) {
        bestAvgPercentage = avgPercentage;
        bestWindow = {
          startTime: windowIntervals[0].time,
          endTime: new Date(windowIntervals[windowIntervals.length - 1].time.getTime() + 15 * 60 * 1000),
          sunnyPercentage: avgPercentage,
        };
      }
    }
  }
  
  // Calculate average sunny percentage for the whole day
  const avgDayPercentage = intervals.reduce((sum, int) => sum + int.percentage, 0) / intervals.length;
  
  return {
    runId: run.id,
    runName: run.name,
    difficulty: run.difficulty,
    sunniestWindow: bestWindow,
    averageSunnyPercentage: avgDayPercentage,
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

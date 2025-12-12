// Weather data types

export interface WeatherData {
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  current: CurrentWeather;
  hourly: HourlyWeather[];
  daily: DailyWeather;
  fetchedAt: string; // ISO timestamp for cache validation
}

export interface CurrentWeather {
  time: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
  weatherCode: number;
  cloudCover: number;
  cloudCoverLow: number;  // Below 2000m
  cloudCoverMid: number;  // 2000-6000m  
  cloudCoverHigh: number; // Above 6000m
  visibility: number;     // meters
  precipitation: number;
  snowfall: number;
  snowDepth: number;
  freezingLevelHeight: number;
  isDay: boolean;
}

export interface HourlyWeather {
  time: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
  weatherCode: number;
  cloudCover: number;
  cloudCoverLow: number;
  cloudCoverMid: number;
  cloudCoverHigh: number;
  visibility: number;
  precipitation: number;
  precipitationProbability: number;
  snowfall: number;
  snowDepth: number;
  freezingLevelHeight: number;
  isDay: boolean;
}

export interface DailyWeather {
  sunrise: string;
  sunset: string;
  maxTemperature: number;
  minTemperature: number;
  maxWindSpeed: number;
  precipitationSum: number;
  snowfallSum: number;
  precipitationProbabilityMax: number;
}

export type TemperatureUnit = 'celsius' | 'fahrenheit';
export type SpeedUnit = 'kmh' | 'mph';
export type LengthUnit = 'cm' | 'inches';

export interface UnitPreferences {
  temperature: TemperatureUnit;
  speed: SpeedUnit;
  length: LengthUnit;
}

// Weather code descriptions (WMO codes)
export const WEATHER_CODES: Record<number, { description: string; icon: string }> = {
  0: { description: 'Clear sky', icon: 'sun' },
  1: { description: 'Mainly clear', icon: 'sun' },
  2: { description: 'Partly cloudy', icon: 'cloud-sun' },
  3: { description: 'Overcast', icon: 'cloud' },
  45: { description: 'Fog', icon: 'fog' },
  48: { description: 'Depositing rime fog', icon: 'fog' },
  51: { description: 'Light drizzle', icon: 'cloud-drizzle' },
  53: { description: 'Moderate drizzle', icon: 'cloud-drizzle' },
  55: { description: 'Dense drizzle', icon: 'cloud-drizzle' },
  56: { description: 'Light freezing drizzle', icon: 'cloud-drizzle' },
  57: { description: 'Dense freezing drizzle', icon: 'cloud-drizzle' },
  61: { description: 'Slight rain', icon: 'cloud-rain' },
  63: { description: 'Moderate rain', icon: 'cloud-rain' },
  65: { description: 'Heavy rain', icon: 'cloud-rain' },
  66: { description: 'Light freezing rain', icon: 'cloud-rain' },
  67: { description: 'Heavy freezing rain', icon: 'cloud-rain' },
  71: { description: 'Slight snow', icon: 'snowflake' },
  73: { description: 'Moderate snow', icon: 'snowflake' },
  75: { description: 'Heavy snow', icon: 'snowflake' },
  77: { description: 'Snow grains', icon: 'snowflake' },
  80: { description: 'Slight rain showers', icon: 'cloud-showers' },
  81: { description: 'Moderate rain showers', icon: 'cloud-showers' },
  82: { description: 'Violent rain showers', icon: 'cloud-showers' },
  85: { description: 'Slight snow showers', icon: 'snowflake' },
  86: { description: 'Heavy snow showers', icon: 'snowflake' },
  95: { description: 'Thunderstorm', icon: 'thunderstorm' },
  96: { description: 'Thunderstorm with slight hail', icon: 'thunderstorm' },
  99: { description: 'Thunderstorm with heavy hail', icon: 'thunderstorm' },
};

// Helper to get visibility description
export function getVisibilityDescription(visibility: number): string {
  if (visibility >= 10000) return 'Excellent';
  if (visibility >= 5000) return 'Good';
  if (visibility >= 2000) return 'Moderate';
  if (visibility >= 1000) return 'Poor';
  if (visibility >= 500) return 'Very poor';
  return 'Fog';
}

// Helper to get cloud cover description
export function getCloudCoverDescription(cloudCover: number): string {
  if (cloudCover <= 10) return 'Clear';
  if (cloudCover <= 25) return 'Few clouds';
  if (cloudCover <= 50) return 'Scattered';
  if (cloudCover <= 75) return 'Broken';
  return 'Overcast';
}

// Helper to estimate visibility impact from cloud cover at different altitudes
export function estimateVisibilityAtAltitude(
  altitude: number,
  cloudCoverLow: number,
  cloudCoverMid: number,
  cloudCoverHigh: number,
  freezingLevel: number
): { visibility: 'good' | 'reduced' | 'poor'; inCloud: boolean } {
  // Low clouds: below 2000m
  // Mid clouds: 2000-6000m
  // High clouds: above 6000m
  
  if (altitude < 2000 && cloudCoverLow > 70) {
    return { visibility: 'poor', inCloud: true };
  }
  
  if (altitude >= 2000 && altitude < 6000 && cloudCoverMid > 70) {
    return { visibility: 'poor', inCloud: true };
  }
  
  if (altitude >= 6000 && cloudCoverHigh > 70) {
    return { visibility: 'reduced', inCloud: true };
  }
  
  // Check if we're near the cloud base
  const totalCloud = (cloudCoverLow + cloudCoverMid + cloudCoverHigh) / 3;
  if (totalCloud > 60) {
    return { visibility: 'reduced', inCloud: false };
  }
  
  return { visibility: 'good', inCloud: false };
}

// Unit conversion helpers
export function celsiusToFahrenheit(c: number): number {
  return (c * 9/5) + 32;
}

export function kmhToMph(kmh: number): number {
  return kmh * 0.621371;
}

export function cmToInches(cm: number): number {
  return cm * 0.393701;
}

export function metersToFeet(m: number): number {
  return m * 3.28084;
}


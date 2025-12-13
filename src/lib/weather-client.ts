/**
 * Open-Meteo Weather API Client
 * 
 * Open-Meteo is free for non-commercial use and doesn't require an API key.
 * For commercial use, you can get an API key from https://open-meteo.com/en/pricing
 * 
 * Set OPEN_METEO_API_KEY env var if you have a commercial key (optional).
 */

import type { WeatherData, CurrentWeather, HourlyWeather, DailyWeatherDay } from './weather-types';

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

// API key is optional - Open-Meteo works without one for non-commercial use
const API_KEY = process.env.OPEN_METEO_API_KEY;

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  current?: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    wind_gusts_10m: number;
    weather_code: number;
    cloud_cover: number;
    cloud_cover_low: number;
    cloud_cover_mid: number;
    cloud_cover_high: number;
    visibility: number;
    precipitation: number;
    snowfall: number;
    snow_depth: number;
    freezing_level_height: number;
    is_day: number;
  };
  hourly?: {
    time: string[];
    temperature_2m: number[];
    apparent_temperature: number[];
    relative_humidity_2m: number[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
    wind_gusts_10m: number[];
    weather_code: number[];
    cloud_cover: number[];
    cloud_cover_low: number[];
    cloud_cover_mid: number[];
    cloud_cover_high: number[];
    visibility: number[];
    precipitation: number[];
    precipitation_probability: number[];
    snowfall: number[];
    snow_depth: number[];
    freezing_level_height: number[];
    is_day: number[];
  };
  daily?: {
    time: string[];
    sunrise: string[];
    sunset: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    wind_speed_10m_max: number[];
    precipitation_sum: number[];
    snowfall_sum: number[];
    precipitation_probability_max: number[];
    weather_code: number[];
  };
}

// Helper to format date as YYYY-MM-DD
function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Fetch historical weather data from Open-Meteo Archive API
async function fetchHistoricalWeather(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string
): Promise<{ hourly: HourlyWeather[]; daily: DailyWeatherDay[] }> {
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    start_date: startDate,
    end_date: endDate,
    // Hourly data (Archive API has fewer fields available)
    hourly: [
      'temperature_2m',
      'apparent_temperature',
      'relative_humidity_2m',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
      'weather_code',
      'cloud_cover',
      'cloud_cover_low',
      'cloud_cover_mid',
      'cloud_cover_high',
      'precipitation',
      'snowfall',
      'snow_depth',
      'is_day',
    ].join(','),
    daily: [
      'sunrise',
      'sunset',
      'temperature_2m_max',
      'temperature_2m_min',
      'wind_speed_10m_max',
      'precipitation_sum',
      'snowfall_sum',
      'weather_code',
    ].join(','),
    timezone: 'auto',
  });

  if (API_KEY) {
    params.set('apikey', API_KEY);
  }

  const url = `${ARCHIVE_URL}?${params}`;
  
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    console.warn(`Historical weather API error: ${response.status}`);
    return { hourly: [], daily: [] };
  }

  const data = await response.json();
  
  if (!data.hourly || !data.daily) {
    return { hourly: [], daily: [] };
  }

  // Transform hourly data (some fields may not be available in archive)
  const hourlyWeather: HourlyWeather[] = data.hourly.time.map((time: string, i: number) => ({
    time,
    temperature: data.hourly.temperature_2m?.[i] ?? 0,
    apparentTemperature: data.hourly.apparent_temperature?.[i] ?? 0,
    humidity: data.hourly.relative_humidity_2m?.[i] ?? 0,
    windSpeed: data.hourly.wind_speed_10m?.[i] ?? 0,
    windDirection: data.hourly.wind_direction_10m?.[i] ?? 0,
    windGusts: data.hourly.wind_gusts_10m?.[i] ?? 0,
    weatherCode: data.hourly.weather_code?.[i] ?? 0,
    cloudCover: data.hourly.cloud_cover?.[i] ?? 0,
    cloudCoverLow: data.hourly.cloud_cover_low?.[i] ?? 0,
    cloudCoverMid: data.hourly.cloud_cover_mid?.[i] ?? 0,
    cloudCoverHigh: data.hourly.cloud_cover_high?.[i] ?? 0,
    visibility: 10000, // Not available in archive, assume good
    precipitation: data.hourly.precipitation?.[i] ?? 0,
    precipitationProbability: 0, // Not available in archive
    snowfall: data.hourly.snowfall?.[i] ?? 0,
    snowDepth: data.hourly.snow_depth?.[i] ?? 0,
    freezingLevelHeight: 0, // Not available in archive
    isDay: data.hourly.is_day?.[i] === 1,
  }));

  const dailyWeather: DailyWeatherDay[] = data.daily.time.map((date: string, i: number) => ({
    date,
    sunrise: data.daily.sunrise?.[i] ?? '',
    sunset: data.daily.sunset?.[i] ?? '',
    maxTemperature: data.daily.temperature_2m_max?.[i] ?? 0,
    minTemperature: data.daily.temperature_2m_min?.[i] ?? 0,
    maxWindSpeed: data.daily.wind_speed_10m_max?.[i] ?? 0,
    precipitationSum: data.daily.precipitation_sum?.[i] ?? 0,
    snowfallSum: data.daily.snowfall_sum?.[i] ?? 0,
    precipitationProbabilityMax: 0, // Not available in archive
    weatherCode: data.daily.weather_code?.[i] ?? 0,
  }));

  return { hourly: hourlyWeather, daily: dailyWeather };
}

export async function fetchWeatherData(
  latitude: number,
  longitude: number,
  forecastDays: number = 16, // Max 16 days for Open-Meteo free tier
  pastDays: number = 7 // Include past 7 days of historical data
): Promise<WeatherData> {
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    // Current weather
    current: [
      'temperature_2m',
      'apparent_temperature',
      'relative_humidity_2m',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
      'weather_code',
      'cloud_cover',
      'cloud_cover_low',
      'cloud_cover_mid',
      'cloud_cover_high',
      'visibility',
      'precipitation',
      'snowfall',
      'snow_depth',
      'freezing_level_height',
      'is_day',
    ].join(','),
    // Hourly forecast
    hourly: [
      'temperature_2m',
      'apparent_temperature',
      'relative_humidity_2m',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
      'weather_code',
      'cloud_cover',
      'cloud_cover_low',
      'cloud_cover_mid',
      'cloud_cover_high',
      'visibility',
      'precipitation',
      'precipitation_probability',
      'snowfall',
      'snow_depth',
      'freezing_level_height',
      'is_day',
    ].join(','),
    // Daily summary (for date picker weather previews)
    daily: [
      'sunrise',
      'sunset',
      'temperature_2m_max',
      'temperature_2m_min',
      'wind_speed_10m_max',
      'precipitation_sum',
      'snowfall_sum',
      'precipitation_probability_max',
      'weather_code',
    ].join(','),
    timezone: 'auto',
    forecast_days: Math.min(forecastDays, 16).toString(),
  });

  // Add API key if available (for commercial use)
  if (API_KEY) {
    params.set('apikey', API_KEY);
  }

  const url = `${BASE_URL}?${params}`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Weather API error: ${response.status} ${response.statusText}`);
  }

  const data: OpenMeteoResponse = await response.json();
  const forecastData = transformResponse(data);
  
  // Fetch historical data for past days
  if (pastDays > 0) {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - pastDays);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - 1); // Yesterday
    
    try {
      const historicalData = await fetchHistoricalWeather(
        latitude,
        longitude,
        formatDateString(startDate),
        formatDateString(endDate)
      );
      
      // Merge historical data with forecast data
      forecastData.hourly = [...historicalData.hourly, ...forecastData.hourly];
      forecastData.daily = [...historicalData.daily, ...forecastData.daily];
    } catch (err) {
      console.warn('Failed to fetch historical weather:', err);
      // Continue with just forecast data
    }
  }
  
  return forecastData;
}

function transformResponse(data: OpenMeteoResponse): WeatherData {
  const current = data.current;
  const hourly = data.hourly;
  const daily = data.daily;

  if (!current || !hourly || !daily) {
    throw new Error('Incomplete weather data received');
  }

  const currentWeather: CurrentWeather = {
    time: current.time,
    temperature: current.temperature_2m,
    apparentTemperature: current.apparent_temperature,
    humidity: current.relative_humidity_2m,
    windSpeed: current.wind_speed_10m,
    windDirection: current.wind_direction_10m,
    windGusts: current.wind_gusts_10m,
    weatherCode: current.weather_code,
    cloudCover: current.cloud_cover,
    cloudCoverLow: current.cloud_cover_low,
    cloudCoverMid: current.cloud_cover_mid,
    cloudCoverHigh: current.cloud_cover_high,
    visibility: current.visibility,
    precipitation: current.precipitation,
    snowfall: current.snowfall,
    snowDepth: current.snow_depth,
    freezingLevelHeight: current.freezing_level_height,
    isDay: current.is_day === 1,
  };

  const hourlyWeather: HourlyWeather[] = hourly.time.map((time, i) => ({
    time,
    temperature: hourly.temperature_2m[i],
    apparentTemperature: hourly.apparent_temperature[i],
    humidity: hourly.relative_humidity_2m[i],
    windSpeed: hourly.wind_speed_10m[i],
    windDirection: hourly.wind_direction_10m[i],
    windGusts: hourly.wind_gusts_10m[i],
    weatherCode: hourly.weather_code[i],
    cloudCover: hourly.cloud_cover[i],
    cloudCoverLow: hourly.cloud_cover_low[i],
    cloudCoverMid: hourly.cloud_cover_mid[i],
    cloudCoverHigh: hourly.cloud_cover_high[i],
    visibility: hourly.visibility[i],
    precipitation: hourly.precipitation[i],
    precipitationProbability: hourly.precipitation_probability[i],
    snowfall: hourly.snowfall[i],
    snowDepth: hourly.snow_depth[i],
    freezingLevelHeight: hourly.freezing_level_height[i],
    isDay: hourly.is_day[i] === 1,
  }));

  const dailyWeather: DailyWeatherDay[] = daily.time.map((date, i) => ({
    date,
    sunrise: daily.sunrise[i],
    sunset: daily.sunset[i],
    maxTemperature: daily.temperature_2m_max[i],
    minTemperature: daily.temperature_2m_min[i],
    maxWindSpeed: daily.wind_speed_10m_max[i],
    precipitationSum: daily.precipitation_sum[i],
    snowfallSum: daily.snowfall_sum[i],
    precipitationProbabilityMax: daily.precipitation_probability_max[i],
    weatherCode: daily.weather_code[i],
  }));

  return {
    latitude: data.latitude,
    longitude: data.longitude,
    elevation: data.elevation,
    timezone: data.timezone,
    current: currentWeather,
    hourly: hourlyWeather,
    daily: dailyWeather,
    fetchedAt: new Date().toISOString(),
  };
}


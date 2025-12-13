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

export async function fetchWeatherData(
  latitude: number,
  longitude: number,
  forecastDays: number = 16 // Max 16 days for Open-Meteo free tier
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
  
  return transformResponse(data);
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


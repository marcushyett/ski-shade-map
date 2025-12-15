'use client';

import { useState, useEffect, useCallback, memo, ReactNode } from 'react';
import { Typography, Segmented, Tooltip } from 'antd';
import LoadingSpinner from '@/components/LoadingSpinner';
import {
  CloudOutlined,
  ThunderboltOutlined,
  EyeOutlined,
  ArrowUpOutlined,
  ReloadOutlined,
  SunOutlined,
  MoonOutlined,
  CloudFilled,
  DownOutlined,
  RightOutlined,
} from '@ant-design/icons';
import type { WeatherData, UnitPreferences, HourlyWeather } from '@/lib/weather-types';
import {
  WEATHER_CODES,
  getVisibilityDescription,
  celsiusToFahrenheit,
  kmhToMph,
  cmToInches,
  metersToFeet,
} from '@/lib/weather-types';

const { Text } = Typography;

interface WeatherPanelProps {
  latitude: number;
  longitude: number;
  altitude?: number;
  selectedTime: Date;
  onWeatherLoad?: (weather: WeatherData) => void;
  // Pre-fetched weather data (from parallel fetch) - avoids waterfall
  initialWeather?: WeatherData | null;
}

const UNITS_STORAGE_KEY = 'ski-shade-units';

// Weather icon component using Ant Design icons
function WeatherIcon({ code, isDay, size = 16 }: { code: number; isDay: boolean; size?: number }): ReactNode {
  const style = { fontSize: size };
  
  // Clear sky
  if (code === 0 || code === 1) {
    return isDay ? <SunOutlined style={{ ...style, color: '#faad14' }} /> : <MoonOutlined style={style} />;
  }
  // Partly cloudy
  if (code === 2) {
    return <CloudOutlined style={style} />;
  }
  // Overcast
  if (code === 3) {
    return <CloudFilled style={style} />;
  }
  // Fog
  if (code >= 45 && code <= 48) {
    return <EyeOutlined style={{ ...style, opacity: 0.5 }} />;
  }
  // Drizzle / Rain
  if (code >= 51 && code <= 67) {
    return <CloudOutlined style={{ ...style, color: '#1890ff' }} />;
  }
  // Snow
  if (code >= 71 && code <= 77) {
    return <CloudOutlined style={{ ...style, color: '#e8e8e8' }} />;
  }
  // Rain showers
  if (code >= 80 && code <= 82) {
    return <CloudFilled style={{ ...style, color: '#1890ff' }} />;
  }
  // Snow showers
  if (code >= 85 && code <= 86) {
    return <CloudFilled style={{ ...style, color: '#e8e8e8' }} />;
  }
  // Thunderstorm
  if (code >= 95) {
    return <ThunderboltOutlined style={{ ...style, color: '#faad14' }} />;
  }
  
  return <CloudOutlined style={style} />;
}

function WeatherPanelInner({ 
  latitude, 
  longitude, 
  altitude,
  selectedTime,
  onWeatherLoad,
  initialWeather,
}: WeatherPanelProps) {
  // Use initial weather if provided (from parallel fetch)
  const [weather, setWeather] = useState<WeatherData | null>(initialWeather || null);
  const [loading, setLoading] = useState(!initialWeather); // Not loading if we have initial data
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [units, setUnits] = useState<UnitPreferences>({
    temperature: 'celsius',
    speed: 'kmh',
    length: 'cm',
  });

  // Load unit preferences
  useEffect(() => {
    try {
      const stored = localStorage.getItem(UNITS_STORAGE_KEY);
      if (stored) {
        setUnits(JSON.parse(stored));
      }
    } catch (e) {
      // Ignore
    }
  }, []);

  // Save unit preferences
  const updateUnits = useCallback((newUnits: UnitPreferences) => {
    setUnits(newUnits);
    try {
      localStorage.setItem(UNITS_STORAGE_KEY, JSON.stringify(newUnits));
    } catch (e) {
      // Ignore
    }
  }, []);

  // Fetch weather data
  const fetchWeather = useCallback(async () => {
    if (!latitude || !longitude) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch(`/api/weather?lat=${latitude}&lng=${longitude}`);
      if (!res.ok) throw new Error('Failed to fetch weather');
      
      const data = await res.json();
      setWeather(data);
      onWeatherLoad?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load weather');
    } finally {
      setLoading(false);
    }
  }, [latitude, longitude, onWeatherLoad]);

  // Sync with initialWeather prop when it changes
  useEffect(() => {
    if (initialWeather) {
      setWeather(initialWeather);
      setLoading(false);
      onWeatherLoad?.(initialWeather);
    }
  }, [initialWeather, onWeatherLoad]);

  // Only fetch weather if not provided via prop
  useEffect(() => {
    if (!initialWeather) {
      fetchWeather();
    }
  }, [fetchWeather, initialWeather]);

  // Find hourly weather closest to selected time
  const getHourlyForTime = useCallback((time: Date): HourlyWeather | null => {
    if (!weather?.hourly) return null;
    
    const targetHour = time.getHours();
    const targetDate = time.toDateString();
    
    return weather.hourly.find(h => {
      const hDate = new Date(h.time);
      return hDate.toDateString() === targetDate && hDate.getHours() === targetHour;
    }) || weather.hourly[0];
  }, [weather]);

  const hourlyWeather = getHourlyForTime(selectedTime);
  const current = weather?.current;

  // Format helpers with units
  const formatTemp = (c: number) => {
    if (units.temperature === 'fahrenheit') {
      return `${Math.round(celsiusToFahrenheit(c))}°F`;
    }
    return `${Math.round(c)}°C`;
  };

  const formatSpeed = (kmh: number) => {
    if (units.speed === 'mph') {
      return `${Math.round(kmhToMph(kmh))} mph`;
    }
    return `${Math.round(kmh)} km/h`;
  };

  const formatLength = (cm: number) => {
    if (units.length === 'inches') {
      return `${cmToInches(cm).toFixed(1)}"`;
    }
    return `${Math.round(cm)} cm`;
  };

  const formatAltitude = (m: number) => {
    if (units.length === 'inches') {
      return `${Math.round(metersToFeet(m))} ft`;
    }
    return `${Math.round(m)} m`;
  };

  const getWindDirection = (degrees: number) => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(degrees / 45) % 8;
    return directions[index];
  };

  if (loading && !weather) {
    return (
      <div className="weather-panel p-2">
        <div className="flex items-center gap-2">
          <LoadingSpinner size={14} />
          <Text type="secondary" style={{ fontSize: 10 }}>Loading weather...</Text>
        </div>
      </div>
    );
  }

  if (error && !weather) {
    return (
      <div className="weather-panel p-2">
        <Text type="secondary" style={{ fontSize: 10 }}>{error}</Text>
      </div>
    );
  }

  if (!weather || !current) return null;

  const displayWeather = hourlyWeather || current;
  const weatherInfo = WEATHER_CODES[displayWeather.weatherCode] || { description: 'Unknown' };

  return (
    <div className="weather-panel">
      {/* Header row with unit toggle */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <WeatherIcon code={displayWeather.weatherCode} isDay={displayWeather.isDay} size={16} />
          <Text strong style={{ fontSize: 14 }}>{formatTemp(displayWeather.temperature)}</Text>
          <Text type="secondary" style={{ fontSize: 9 }}>{weatherInfo.description}</Text>
        </div>
        <div className="flex items-center gap-1">
          <Segmented
            size="small"
            options={[
              { label: '°C', value: 'metric' },
              { label: '°F', value: 'imperial' },
            ]}
            value={units.temperature === 'celsius' ? 'metric' : 'imperial'}
            onChange={(v) => updateUnits({
              temperature: v === 'metric' ? 'celsius' : 'fahrenheit',
              speed: v === 'metric' ? 'kmh' : 'mph',
              length: v === 'metric' ? 'cm' : 'inches',
            })}
            style={{ fontSize: 9 }}
          />
          <Tooltip title="Refresh">
            <ReloadOutlined 
              style={{ fontSize: 10, opacity: 0.5, cursor: 'pointer', marginLeft: 4 }} 
              onClick={() => fetchWeather()}
              spin={loading}
            />
          </Tooltip>
        </div>
      </div>

      {/* Key metrics - compact single row */}
      <div className="flex items-center gap-3 text-center" style={{ fontSize: 9 }}>
        <div className="flex items-center gap-1">
          <ArrowUpOutlined style={{ transform: `rotate(${displayWeather.windDirection}deg)`, fontSize: 9 }} />
          <span>{formatSpeed(displayWeather.windSpeed)}</span>
        </div>
        <div className="flex items-center gap-1">
          <CloudOutlined style={{ fontSize: 9 }} />
          <span>{displayWeather.cloudCover}%</span>
        </div>
        <div className="flex items-center gap-1">
          <EyeOutlined style={{ fontSize: 9 }} />
          <span>{getVisibilityDescription(displayWeather.visibility)}</span>
        </div>
        {current.snowDepth > 0 && (
          <div className="flex items-center gap-1">
            <span style={{ color: '#e8e8e8' }}>❄</span>
            <span>{formatLength(current.snowDepth)}</span>
          </div>
        )}
      </div>

      {/* Expandable details section */}
      <div 
        className="flex items-center gap-1 mt-2 cursor-pointer hover:bg-white/5 rounded py-0.5"
        onClick={() => setShowDetails(!showDetails)}
        style={{ fontSize: 9, color: '#888' }}
      >
        {showDetails ? <DownOutlined style={{ fontSize: 7 }} /> : <RightOutlined style={{ fontSize: 7 }} />}
        <span>More details</span>
      </div>

      {showDetails && (
        <div className="mt-1 pt-1 border-t border-white/10" style={{ fontSize: 9 }}>
          {/* Wind details */}
          <div className="flex justify-between mb-1">
            <Text type="secondary">Wind</Text>
            <Text>{formatSpeed(displayWeather.windSpeed)} {getWindDirection(displayWeather.windDirection)}, gusts {formatSpeed(displayWeather.windGusts)}</Text>
          </div>
          
          {/* Feels like */}
          <div className="flex justify-between mb-1">
            <Text type="secondary">Feels like</Text>
            <Text>{formatTemp(displayWeather.apparentTemperature)}</Text>
          </div>
          
          {/* Humidity */}
          <div className="flex justify-between mb-1">
            <Text type="secondary">Humidity</Text>
            <Text>{displayWeather.humidity}%</Text>
          </div>
          
          {/* Cloud layers */}
          <div className="flex justify-between mb-1">
            <Text type="secondary">Cloud layers</Text>
            <Text>L:{displayWeather.cloudCoverLow}% M:{displayWeather.cloudCoverMid}% H:{displayWeather.cloudCoverHigh}%</Text>
          </div>

          {/* Snow info */}
          <div className="flex justify-between mb-1">
            <Text type="secondary">Snow @ {formatAltitude(weather.elevation)}</Text>
            <Text>
              {current.snowDepth > 0 ? formatLength(current.snowDepth) : 'No snow'}
              {current.snowfall > 0 && ` (+${formatLength(current.snowfall * 100)} new)`}
            </Text>
          </div>

          {/* Freezing level */}
          {displayWeather.freezingLevelHeight > 0 && (
            <div className="flex justify-between mb-1">
              <Text type="secondary">Snow line</Text>
              <Text>~{formatAltitude(displayWeather.freezingLevelHeight)}</Text>
            </div>
          )}

          {/* Precipitation probability */}
          {hourlyWeather && hourlyWeather.precipitationProbability > 0 && (
            <div className="flex justify-between">
              <Text type="secondary">Precip chance</Text>
              <Text>{hourlyWeather.precipitationProbability}%</Text>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const WeatherPanel = memo(WeatherPanelInner);
export default WeatherPanel;

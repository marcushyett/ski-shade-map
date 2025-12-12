'use client';

import { useState, useEffect, useCallback, memo, ReactNode } from 'react';
import { Typography, Segmented, Tooltip } from 'antd';
import LoadingSpinner from '@/components/LoadingSpinner';
import {
  CloudOutlined,
  ThunderboltOutlined,
  EyeOutlined,
  DashboardOutlined,
  ArrowUpOutlined,
  ReloadOutlined,
  SunOutlined,
  MoonOutlined,
  CloudFilled,
} from '@ant-design/icons';
import type { WeatherData, UnitPreferences, HourlyWeather } from '@/lib/weather-types';
import {
  WEATHER_CODES,
  getVisibilityDescription,
  getCloudCoverDescription,
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
  onWeatherLoad 
}: WeatherPanelProps) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    fetchWeather();
  }, [fetchWeather]);

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
      {/* Unit toggle */}
      <div className="flex items-center justify-between mb-2">
        <Text strong style={{ fontSize: 10 }}>WEATHER</Text>
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
        />
      </div>

      {/* Current conditions */}
      <div className="current-weather mb-2 p-2 rounded" style={{ background: 'rgba(255,255,255,0.03)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <WeatherIcon code={displayWeather.weatherCode} isDay={displayWeather.isDay} size={20} />
            <div>
              <Text strong style={{ fontSize: 16 }}>{formatTemp(displayWeather.temperature)}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 9 }}>
                Feels {formatTemp(displayWeather.apparentTemperature)}
              </Text>
            </div>
          </div>
          <Tooltip title="Refresh weather">
            <ReloadOutlined 
              style={{ fontSize: 10, opacity: 0.5, cursor: 'pointer' }} 
              onClick={() => fetchWeather()}
              spin={loading}
            />
          </Tooltip>
        </div>
        <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 4 }}>
          {weatherInfo.description}
        </Text>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-1" style={{ fontSize: 10 }}>
        {/* Wind */}
        <div className="flex items-center gap-1 p-1 rounded" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <ArrowUpOutlined style={{ transform: `rotate(${displayWeather.windDirection}deg)`, fontSize: 10 }} />
          <div>
            <Text style={{ fontSize: 10 }}>{formatSpeed(displayWeather.windSpeed)}</Text>
            <Text type="secondary" style={{ fontSize: 8, display: 'block' }}>
              {getWindDirection(displayWeather.windDirection)} gusts {formatSpeed(displayWeather.windGusts)}
            </Text>
          </div>
        </div>

        {/* Visibility */}
        <div className="flex items-center gap-1 p-1 rounded" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <EyeOutlined style={{ fontSize: 10 }} />
          <div>
            <Text style={{ fontSize: 10 }}>{formatAltitude(displayWeather.visibility)}</Text>
            <Text type="secondary" style={{ fontSize: 8, display: 'block' }}>
              {getVisibilityDescription(displayWeather.visibility)}
            </Text>
          </div>
        </div>

        {/* Cloud cover */}
        <div className="flex items-center gap-1 p-1 rounded" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <CloudOutlined style={{ fontSize: 10 }} />
          <div>
            <Text style={{ fontSize: 10 }}>{displayWeather.cloudCover}%</Text>
            <Text type="secondary" style={{ fontSize: 8, display: 'block' }}>
              {getCloudCoverDescription(displayWeather.cloudCover)}
            </Text>
          </div>
        </div>

        {/* Humidity */}
        <div className="flex items-center gap-1 p-1 rounded" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <DashboardOutlined style={{ fontSize: 10 }} />
          <div>
            <Text style={{ fontSize: 10 }}>{displayWeather.humidity}%</Text>
            <Text type="secondary" style={{ fontSize: 8, display: 'block' }}>Humidity</Text>
          </div>
        </div>
      </div>

      {/* Cloud layers with altitude info */}
      <div className="mt-2 p-1 rounded" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <Tooltip title="Sky coverage at each altitude band. 0% = clear, 100% = fully overcast. Low clouds reduce visibility most for skiers.">
          <Text type="secondary" style={{ fontSize: 9, cursor: 'help' }}>CLOUD LAYERS (% sky covered)</Text>
        </Tooltip>
        <div className="flex justify-between mt-1" style={{ fontSize: 9 }}>
          <Tooltip title="High clouds: Above 6000m (cirrus, thin ice clouds). Usually don't affect skiing visibility.">
            <div className="text-center cursor-help">
              <Text style={{ fontSize: 10 }}>{displayWeather.cloudCoverHigh}%</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 8 }}>High</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 7 }}>&gt;6km</Text>
            </div>
          </Tooltip>
          <Tooltip title="Mid clouds: 2000-6000m (altostratus, altocumulus). Can create flat light on upper slopes.">
            <div className="text-center cursor-help">
              <Text style={{ fontSize: 10 }}>{displayWeather.cloudCoverMid}%</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 8 }}>Mid</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 7 }}>2-6km</Text>
            </div>
          </Tooltip>
          <Tooltip title="Low clouds: Below 2000m (stratus, fog). Most impact on ski visibility - you may be skiing in cloud!">
            <div className="text-center cursor-help">
              <Text style={{ fontSize: 10 }}>{displayWeather.cloudCoverLow}%</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 8 }}>Low</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 7 }}>&lt;2km</Text>
            </div>
          </Tooltip>
        </div>
      </div>

      {/* Snow info with elevation context */}
      <div className="mt-2 p-1 rounded" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <Tooltip title={`Snow data at resort elevation: ${formatAltitude(weather.elevation)}. Depth varies significantly with altitude - typically more snow at higher elevations.`}>
          <Text type="secondary" style={{ fontSize: 9, cursor: 'help' }}>SNOW @ {formatAltitude(weather.elevation)}</Text>
        </Tooltip>
        <div className="flex justify-between mt-1">
          <div>
            <Text style={{ fontSize: 10 }}>Depth: {formatLength(current.snowDepth)}</Text>
          </div>
          {current.snowfall > 0 && (
            <div>
              <Text style={{ fontSize: 10 }}>New: {formatLength(current.snowfall * 100)}</Text>
            </div>
          )}
          {current.snowDepth === 0 && current.snowfall === 0 && (
            <Text type="secondary" style={{ fontSize: 9 }}>No snow reported</Text>
          )}
        </div>
        {displayWeather.freezingLevelHeight > 0 && (
          <Text type="secondary" style={{ fontSize: 8, display: 'block', marginTop: 2 }}>
            Snow line: ~{formatAltitude(displayWeather.freezingLevelHeight)}
          </Text>
        )}
      </div>

      {/* Precipitation probability */}
      {hourlyWeather && hourlyWeather.precipitationProbability > 0 && (
        <div className="mt-1">
          <Text type="secondary" style={{ fontSize: 9 }}>
            {hourlyWeather.precipitationProbability}% chance of precipitation
          </Text>
        </div>
      )}
    </div>
  );
}

const WeatherPanel = memo(WeatherPanelInner);
export default WeatherPanel;

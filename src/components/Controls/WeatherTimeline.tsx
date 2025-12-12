'use client';

import { memo, useMemo, ReactNode } from 'react';
import { Tooltip } from 'antd';
import {
  SunOutlined,
  MoonOutlined,
  CloudOutlined,
  CloudFilled,
  EyeOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { HourlyWeather, UnitPreferences } from '@/lib/weather-types';
import { WEATHER_CODES, celsiusToFahrenheit, kmhToMph } from '@/lib/weather-types';

interface WeatherTimelineProps {
  hourlyWeather: HourlyWeather[];
  selectedTime: Date;
  units: UnitPreferences;
}

// Weather icon component using Ant Design icons
function WeatherIcon({ code, isDay }: { code: number; isDay: boolean }): ReactNode {
  const style = { fontSize: 12 };
  
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

function WeatherTimelineInner({ hourlyWeather, selectedTime, units }: WeatherTimelineProps) {
  // Get weather for 3-hour intervals throughout the day
  const timelineData = useMemo(() => {
    const today = selectedTime.toDateString();
    const intervals: { hour: number; weather: HourlyWeather }[] = [];
    
    // Get weather at 6am, 9am, 12pm, 3pm, 6pm, 9pm
    const hours = [6, 9, 12, 15, 18, 21];
    
    hours.forEach(hour => {
      const match = hourlyWeather.find(h => {
        const d = new Date(h.time);
        return d.toDateString() === today && d.getHours() === hour;
      });
      if (match) {
        intervals.push({ hour, weather: match });
      }
    });
    
    return intervals;
  }, [hourlyWeather, selectedTime]);

  const formatTemp = (c: number) => {
    if (units.temperature === 'fahrenheit') {
      return `${Math.round(celsiusToFahrenheit(c))}°`;
    }
    return `${Math.round(c)}°`;
  };

  const formatHour = (hour: number): string => {
    if (hour === 0) return '12am';
    if (hour === 12) return '12pm';
    if (hour < 12) return `${hour}am`;
    return `${hour - 12}pm`;
  };

  if (timelineData.length === 0) return null;

  const selectedHour = selectedTime.getHours();

  return (
    <div className="weather-timeline flex justify-between px-1">
      {timelineData.map(({ hour, weather }) => {
        const isSelected = Math.abs(hour - selectedHour) < 2;
        const info = WEATHER_CODES[weather.weatherCode] || { description: 'Unknown' };
        
        return (
          <Tooltip
            key={hour}
            title={
              <div style={{ fontSize: 10 }}>
                <div>{info.description}</div>
                <div>Cloud: {weather.cloudCover}%</div>
                <div>Wind: {units.speed === 'mph' ? Math.round(kmhToMph(weather.windSpeed)) : Math.round(weather.windSpeed)} {units.speed}</div>
                {weather.precipitationProbability > 0 && (
                  <div>{weather.precipitationProbability}% precip</div>
                )}
              </div>
            }
          >
            <div 
              className="text-center cursor-default"
              style={{ 
                opacity: isSelected ? 1 : 0.6,
                transition: 'opacity 0.2s',
              }}
            >
              <div>
                <WeatherIcon code={weather.weatherCode} isDay={weather.isDay} />
              </div>
              <div style={{ fontSize: 9, color: '#ccc' }}>
                {formatTemp(weather.temperature)}
              </div>
              <div style={{ fontSize: 8, color: '#666' }}>
                {formatHour(hour)}
              </div>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

const WeatherTimeline = memo(WeatherTimelineInner);
export default WeatherTimeline;

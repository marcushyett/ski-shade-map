'use client';

import { useState, useEffect, useMemo, ReactNode, useRef, useCallback } from 'react';
import { Slider, Typography, Button, Tooltip, DatePicker } from 'antd';
import { 
  PlayCircleOutlined, 
  PauseCircleOutlined,
  SunOutlined,
  MoonOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  LeftOutlined,
  RightOutlined,
  CalendarOutlined,
  CloudOutlined,
  CloudFilled,
  ThunderboltOutlined,
  EyeOutlined,
  UpOutlined,
  DownOutlined,
} from '@ant-design/icons';
import { format, setHours, setMinutes, startOfDay, addDays, isSameDay } from 'date-fns';
import dayjs from 'dayjs';
import { getSunTimes, getSunPosition } from '@/lib/suncalc';
import { trackEvent } from '@/lib/posthog';
import WeatherTimeline from './WeatherTimeline';
import LoadingSpinner from '@/components/LoadingSpinner';
import type { HourlyWeather, UnitPreferences, DailyWeatherDay } from '@/lib/weather-types';

// Helper to detect touch devices for disabling tooltips on mobile
const isTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

// Wrapper that disables tooltips on mobile to avoid double-tap issues
const MobileAwareTooltip = ({ title, children, ...props }: React.ComponentProps<typeof Tooltip>) => {
  if (isTouchDevice()) {
    return <>{children}</>;
  }
  return <Tooltip title={title} {...props}>{children}</Tooltip>;
};

const { Text } = Typography;

// Weather icon component for date picker
function DayWeatherIcon({ code, size = 12 }: { code: number; size?: number }): ReactNode {
  const style = { fontSize: size };
  
  // Clear sky
  if (code === 0 || code === 1) {
    return <SunOutlined style={{ ...style, color: '#faad14' }} />;
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

interface TimeSliderProps {
  latitude: number;
  longitude: number;
  selectedTime: Date;
  onTimeChange: (time: Date) => void;
  onTimeChangeComplete?: (time: Date) => void; // Called when slider drag ends
  hourlyWeather?: HourlyWeather[];
  dailyWeather?: DailyWeatherDay[];
  units?: UnitPreferences;
  isLoadingWeather?: boolean;
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export default function TimeSlider({ 
  latitude, 
  longitude, 
  selectedTime, 
  onTimeChange,
  onTimeChangeComplete,
  hourlyWeather,
  dailyWeather,
  units = { temperature: 'celsius', speed: 'kmh', length: 'cm' },
  isLoadingWeather = false,
  isCollapsed = false,
  onToggleCollapsed,
}: TimeSliderProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  
  // Local state for slider position during drag - prevents expensive recalculations
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Check if selected date has weather data
  const selectedDateHasWeather = useMemo(() => {
    if (!hourlyWeather || hourlyWeather.length === 0) return false;
    const selectedDateStr = format(selectedTime, 'yyyy-MM-dd');
    return hourlyWeather.some(h => h.time.startsWith(selectedDateStr));
  }, [hourlyWeather, selectedTime]);

  // Get today's date for comparison
  const today = useMemo(() => startOfDay(new Date()), []);
  const isToday = isSameDay(selectedTime, today);

  // Calculate forecast range (up to 16 days from today)
  const maxForecastDate = useMemo(() => addDays(today, 15), [today]);

  // Format temperature based on units
  const formatTemp = (c: number) => {
    if (units.temperature === 'fahrenheit') {
      return `${Math.round((c * 9/5) + 32)}°`;
    }
    return `${Math.round(c)}°`;
  };

  const sunTimes = useMemo(() => {
    return getSunTimes(selectedTime, latitude, longitude);
  }, [selectedTime, latitude, longitude]);

  const sunPosition = useMemo(() => {
    return getSunPosition(selectedTime, latitude, longitude);
  }, [selectedTime, latitude, longitude]);

  const timeToSlider = (date: Date): number => {
    return date.getHours() * 60 + date.getMinutes();
  };

  const sliderToTime = (value: number): Date => {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    const base = startOfDay(selectedTime);
    return setMinutes(setHours(base, hours), minutes);
  };

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      const current = timeToSlider(selectedTime);
      const next = (current + 10) % (24 * 60);
      onTimeChange(sliderToTime(next));
    }, 200);

    return () => clearInterval(interval);
  }, [isPlaying, selectedTime, onTimeChange]);

  const marks = useMemo(() => {
    const sunriseMin = timeToSlider(sunTimes.sunrise);
    const sunsetMin = timeToSlider(sunTimes.sunset);
    const noonMin = timeToSlider(sunTimes.solarNoon);

    return {
      [sunriseMin]: {
        label: <MobileAwareTooltip title={`Sunrise ${format(sunTimes.sunrise, 'HH:mm')}`}><ArrowUpOutlined style={{ fontSize: 9, opacity: 0.5 }} /></MobileAwareTooltip>,
      },
      [noonMin]: {
        label: <MobileAwareTooltip title={`Noon ${format(sunTimes.solarNoon, 'HH:mm')}`}><SunOutlined style={{ fontSize: 9, opacity: 0.5 }} /></MobileAwareTooltip>,
      },
      [sunsetMin]: {
        label: <MobileAwareTooltip title={`Sunset ${format(sunTimes.sunset, 'HH:mm')}`}><ArrowDownOutlined style={{ fontSize: 9, opacity: 0.5 }} /></MobileAwareTooltip>,
      },
    };
  }, [sunTimes]);

  // Use drag value during dragging, otherwise use actual selected time
  const currentValue = isDragging && dragValue !== null ? dragValue : timeToSlider(selectedTime);
  const isSunUp = sunPosition.altitudeDegrees > 0;

  // Track time changes (debounced to avoid too many events)
  const lastTrackedTimeRef = useRef<number | null>(null);
  const trackTimeChange = useCallback((time: Date) => {
    const minutes = time.getHours() * 60 + time.getMinutes();
    // Only track if time changed significantly (at least 10 min difference)
    if (lastTrackedTimeRef.current === null || Math.abs(minutes - lastTrackedTimeRef.current) >= 10) {
      lastTrackedTimeRef.current = minutes;
      trackEvent('time_changed', {
        selected_time: format(time, 'HH:mm'),
        selected_date: format(time, 'yyyy-MM-dd'),
      });
    }
  }, []);

  // Navigate to previous day
  const goToPreviousDay = () => {
    const newDate = addDays(selectedTime, -1);
    // Keep the same time of day
    newDate.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
    trackEvent('date_changed', {
      selected_date: format(newDate, 'yyyy-MM-dd'),
      direction: 'previous',
    });
    onTimeChange(newDate);
  };

  // Navigate to next day
  const goToNextDay = () => {
    const newDate = addDays(selectedTime, 1);
    // Keep the same time of day
    newDate.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
    trackEvent('date_changed', {
      selected_date: format(newDate, 'yyyy-MM-dd'),
      direction: 'next',
    });
    onTimeChange(newDate);
  };

  // Handle date picker change
  const handleDateChange = (date: dayjs.Dayjs | null) => {
    if (date) {
      const newDate = date.toDate();
      newDate.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
      trackEvent('date_changed', {
        selected_date: format(newDate, 'yyyy-MM-dd'),
        direction: 'picker',
      });
      onTimeChange(newDate);
      setShowDatePicker(false);
    }
  };

  // Get weather for a specific date (for date picker cell rendering)
  const getWeatherForDate = (date: Date): DailyWeatherDay | null => {
    if (!dailyWeather) return null;
    const dateStr = format(date, 'yyyy-MM-dd');
    return dailyWeather.find(d => d.date === dateStr) || null;
  };

  // Custom date cell renderer with weather below the date
  const dateRender = (current: dayjs.Dayjs) => {
    const weather = getWeatherForDate(current.toDate());
    const isSelected = isSameDay(current.toDate(), selectedTime);
    const hasWeather = !!weather;
    
    return (
      <div 
        className="date-cell-with-weather"
        style={{ 
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2px 0',
          minHeight: 44,
          backgroundColor: isSelected ? '#faad14' : undefined,
          borderRadius: isSelected ? 4 : undefined,
          color: isSelected ? '#000' : hasWeather ? '#fff' : '#555',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: isSelected ? 600 : 400 }}>
          {current.date()}
        </span>
        {hasWeather && (
          <div style={{ 
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            fontSize: 9,
            opacity: isSelected ? 0.8 : 0.7,
            marginTop: 1,
          }}>
            <DayWeatherIcon code={weather.weatherCode} size={9} />
            <span>{formatTemp(weather.maxTemperature)}</span>
          </div>
        )}
      </div>
    );
  };

  // Get current hourly weather for collapsed view
  const currentHourlyWeather = useMemo(() => {
    if (!hourlyWeather || hourlyWeather.length === 0) return null;
    const targetDateStr = format(selectedTime, 'yyyy-MM-dd');
    const targetHour = selectedTime.getHours();

    // Use string comparison to avoid timezone parsing issues
    // h.time format is "2024-12-23T10:00" from Open-Meteo API
    return hourlyWeather.find(h => {
      const dateStr = h.time.slice(0, 10); // "2024-12-23"
      const hourStr = h.time.slice(11, 13); // "10"
      return dateStr === targetDateStr && parseInt(hourStr, 10) === targetHour;
    }) || null;
  }, [hourlyWeather, selectedTime]);

  // Collapsed view - compact summary with weather, temp, and time
  if (isCollapsed) {
    return (
      <div 
        className="time-slider time-slider-collapsed"
        onClick={onToggleCollapsed}
        style={{ cursor: 'pointer' }}
        aria-label="Expand time controls"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Weather + Temp */}
            {mounted && currentHourlyWeather && (
              <div className="flex items-center gap-1.5">
                <DayWeatherIcon code={currentHourlyWeather.weatherCode} size={14} />
                <Text strong style={{ fontSize: 13 }}>
                  {formatTemp(currentHourlyWeather.temperature)}
                </Text>
              </div>
            )}
            
            {/* Divider */}
            {mounted && currentHourlyWeather && (
              <span style={{ color: '#444', fontSize: 10 }}>|</span>
            )}
            
            {/* Time + sun/moon */}
            <div className="flex items-center gap-1.5">
              {isSunUp ? (
                <SunOutlined style={{ color: '#faad14', fontSize: 12 }} />
              ) : (
                <MoonOutlined style={{ color: '#666', fontSize: 12 }} />
              )}
              <Text strong style={{ fontSize: 13 }}>
                {mounted ? format(selectedTime, 'HH:mm') : '--:--'}
              </Text>
              <Text type="secondary" style={{ fontSize: 10 }}>
                {mounted ? (isToday ? 'today' : format(selectedTime, 'EEE')) : ''}
              </Text>
            </div>
          </div>
          
          {/* Expand button - no tooltip on mobile */}
          <div className="flex items-center gap-1" style={{ color: '#666', fontSize: 10 }}>
            <span>Expand</span>
            <UpOutlined style={{ fontSize: 8 }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="time-slider">
      {/* Date navigation */}
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
        <Button
          type="text"
          size="small"
          icon={<LeftOutlined />}
          onClick={goToPreviousDay}
          style={{ padding: '0 4px', height: 24 }}
        />
        
        <div className="flex items-center gap-2">
          <MobileAwareTooltip title="Pick a date">
            <Button
              type="text"
              size="small"
              onClick={() => setShowDatePicker(!showDatePicker)}
              style={{ padding: '4px 8px', height: 24 }}
            >
              <CalendarOutlined style={{ marginRight: 4 }} />
              <Text strong style={{ fontSize: 12 }}>
                {mounted ? (isToday ? 'Today' : format(selectedTime, 'EEE, MMM d')) : '---'}
              </Text>
            </Button>
          </MobileAwareTooltip>
          
          {/* Weather indicator for selected date */}
          {mounted && (() => {
            if (isLoadingWeather) {
              return <LoadingSpinner size={12} />;
            }
            const dayWeather = getWeatherForDate(selectedTime);
            if (dayWeather) {
              return (
                <MobileAwareTooltip title={`${formatTemp(dayWeather.minTemperature)} - ${formatTemp(dayWeather.maxTemperature)}`}>
                  <span className="flex items-center gap-1" style={{ fontSize: 10 }}>
                    <DayWeatherIcon code={dayWeather.weatherCode} size={12} />
                    <span>{formatTemp(dayWeather.maxTemperature)}</span>
                  </span>
                </MobileAwareTooltip>
              );
            }
            return null;
          })()}
        </div>
        
        <MobileAwareTooltip title={selectedTime > maxForecastDate ? 'No forecast data beyond 16 days' : 'Next day'}>
          <Button
            type="text"
            size="small"
            icon={<RightOutlined />}
            onClick={goToNextDay}
            style={{ padding: '0 4px', height: 24 }}
          />
        </MobileAwareTooltip>
      </div>

      {/* Date picker dropdown */}
      {showDatePicker && (
        <div className="mb-2">
          <DatePicker
            open={true}
            value={dayjs(selectedTime)}
            onChange={handleDateChange}
            onOpenChange={(open) => !open && setShowDatePicker(false)}
            cellRender={(current, info) => {
              if (info.type === 'date' && dayjs.isDayjs(current)) {
                return dateRender(current);
              }
              return info.originNode;
            }}
            style={{ width: '100%' }}
            popupStyle={{ zIndex: 1000 }}
            getPopupContainer={(trigger) => trigger.parentElement || document.body}
          />
        </div>
      )}

      {/* Loading weather indicator */}
      {isLoadingWeather && mounted && (
        <div 
          className="mb-2 p-2 rounded text-center flex items-center justify-center gap-2" 
          style={{ 
            background: 'rgba(255, 255, 255, 0.05)', 
            fontSize: 10,
          }}
        >
          <LoadingSpinner size={12} />
          <Text type="secondary">Loading weather data...</Text>
        </div>
      )}

      {/* No weather data warning */}
      {!selectedDateHasWeather && !isLoadingWeather && mounted && (
        <div 
          className="mb-2 p-2 rounded text-center" 
          style={{ 
            background: 'rgba(255, 173, 20, 0.1)', 
            border: '1px solid rgba(255, 173, 20, 0.3)',
            fontSize: 10,
          }}
        >
          <Text type="warning">No weather data for this date</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 9 }}>
            Sun/shade calculations are still accurate
          </Text>
        </div>
      )}

      {/* Weather timeline */}
      {hourlyWeather && hourlyWeather.length > 0 && selectedDateHasWeather && (
        <div className="mb-2">
          <WeatherTimeline 
            hourlyWeather={hourlyWeather} 
            selectedTime={selectedTime}
            units={units}
          />
        </div>
      )}

      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {isSunUp ? (
            <SunOutlined style={{ color: '#faad14', fontSize: 12 }} />
          ) : (
            <MoonOutlined style={{ color: '#666', fontSize: 12 }} />
          )}
          <Text strong style={{ fontSize: 13 }}>
            {mounted ? format(selectedTime, 'HH:mm') : '--:--'}
          </Text>
          <Text type="secondary" style={{ fontSize: 10 }}>
            {mounted && currentHourlyWeather ? formatTemp(currentHourlyWeather.temperature) : ''}
          </Text>
        </div>
        
        <Button
          type="text"
          size="small"
          icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          onClick={() => setIsPlaying(!isPlaying)}
          style={{ padding: '0 4px', height: 20 }}
        />
      </div>

      <Slider
        value={currentValue}
        min={0}
        max={24 * 60 - 1}
        marks={marks}
        onChange={(value) => {
          // During drag, only update local state for smooth movement
          setIsDragging(true);
          setDragValue(value);
        }}
        onChangeComplete={(value) => {
          // When drag ends, update the actual time and clear drag state
          setIsDragging(false);
          setDragValue(null);
          const time = sliderToTime(value);
          onTimeChange(time);
          trackTimeChange(time);
          onTimeChangeComplete?.(time);
        }}
        tooltip={{
          formatter: (value) => value !== undefined ? format(sliderToTime(value), 'HH:mm') : '',
        }}
        style={{ margin: '8px 0 16px' }}
      />

      <div className="flex justify-between mb-2" style={{ fontSize: 9, opacity: 0.4 }}>
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>

      <div className="flex gap-1 justify-between items-center">
        <div className="flex gap-1">
          <Button size="small" onClick={() => onTimeChange(sunTimes.sunrise)}>
            Rise
          </Button>
          <Button size="small" onClick={() => {
            const now = new Date();
            // Set time to now but keep the selected date
            const newTime = new Date(selectedTime);
            newTime.setHours(now.getHours(), now.getMinutes(), 0, 0);
            onTimeChange(newTime);
          }}>
            Now
          </Button>
          <Button size="small" onClick={() => onTimeChange(sunTimes.solarNoon)}>
            Noon
          </Button>
          <Button size="small" onClick={() => onTimeChange(sunTimes.sunset)}>
            Set
          </Button>
        </div>
        
        {/* Collapse button - at bottom right, inline with shortcuts */}
        {onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            className="time-slider-collapse-btn"
            aria-label="Collapse time controls"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              color: '#666',
            }}
          >
            <span>Collapse</span>
            <DownOutlined style={{ fontSize: 8 }} />
          </button>
        )}
      </div>
    </div>
  );
}

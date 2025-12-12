'use client';

import { useState, useEffect, useMemo } from 'react';
import { Slider, Typography, Button, Tooltip } from 'antd';
import { 
  PlayCircleOutlined, 
  PauseCircleOutlined,
  SunOutlined,
  MoonOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined
} from '@ant-design/icons';
import { format, setHours, setMinutes, startOfDay } from 'date-fns';
import { getSunTimes, getSunPosition } from '@/lib/suncalc';

const { Text } = Typography;

interface TimeSliderProps {
  latitude: number;
  longitude: number;
  selectedTime: Date;
  onTimeChange: (time: Date) => void;
}

export default function TimeSlider({ 
  latitude, 
  longitude, 
  selectedTime, 
  onTimeChange 
}: TimeSliderProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
        label: <Tooltip title={`Sunrise ${format(sunTimes.sunrise, 'HH:mm')}`}><ArrowUpOutlined style={{ fontSize: 9, opacity: 0.5 }} /></Tooltip>,
      },
      [noonMin]: {
        label: <Tooltip title={`Noon ${format(sunTimes.solarNoon, 'HH:mm')}`}><SunOutlined style={{ fontSize: 9, opacity: 0.5 }} /></Tooltip>,
      },
      [sunsetMin]: {
        label: <Tooltip title={`Sunset ${format(sunTimes.sunset, 'HH:mm')}`}><ArrowDownOutlined style={{ fontSize: 9, opacity: 0.5 }} /></Tooltip>,
      },
    };
  }, [sunTimes]);

  const currentValue = timeToSlider(selectedTime);
  const isSunUp = sunPosition.altitudeDegrees > 0;

  return (
    <div className="time-slider">
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
            {mounted ? `${sunPosition.altitudeDegrees.toFixed(0)}°` : ''}
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
        onChange={(value) => onTimeChange(sliderToTime(value))}
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

      <div className="flex gap-1">
        <Button size="small" onClick={() => onTimeChange(sunTimes.sunrise)}>
          Rise
        </Button>
        <Button size="small" onClick={() => onTimeChange(new Date())}>
          Now
        </Button>
        <Button size="small" onClick={() => onTimeChange(sunTimes.solarNoon)}>
          Noon
        </Button>
        <Button size="small" onClick={() => onTimeChange(sunTimes.sunset)}>
          Set
        </Button>
      </div>
    </div>
  );
}

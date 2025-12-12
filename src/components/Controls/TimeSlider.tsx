'use client';

import { useState, useEffect, useMemo } from 'react';
import { Slider, Typography, Space, Button, Tooltip } from 'antd';
import { 
  PlayCircleOutlined, 
  PauseCircleOutlined,
  SunOutlined,
  MoonOutlined 
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

  // Wait for client-side hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Get sun times for the selected date
  const sunTimes = useMemo(() => {
    return getSunTimes(selectedTime, latitude, longitude);
  }, [selectedTime, latitude, longitude]);

  // Get current sun position
  const sunPosition = useMemo(() => {
    return getSunPosition(selectedTime, latitude, longitude);
  }, [selectedTime, latitude, longitude]);

  // Convert time to slider value (minutes from midnight)
  const timeToSlider = (date: Date): number => {
    return date.getHours() * 60 + date.getMinutes();
  };

  // Convert slider value to time
  const sliderToTime = (value: number): Date => {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    const base = startOfDay(selectedTime);
    return setMinutes(setHours(base, hours), minutes);
  };

  // Auto-play animation
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      const current = timeToSlider(selectedTime);
      const next = (current + 10) % (24 * 60); // Jump 10 minutes
      onTimeChange(sliderToTime(next));
    }, 200);

    return () => clearInterval(interval);
  }, [isPlaying, selectedTime, onTimeChange]);

  // Slider marks for key times
  const marks = useMemo(() => {
    const sunriseMin = timeToSlider(sunTimes.sunrise);
    const sunsetMin = timeToSlider(sunTimes.sunset);
    const noonMin = timeToSlider(sunTimes.solarNoon);

    return {
      [sunriseMin]: {
        label: <Tooltip title={`Sunrise ${format(sunTimes.sunrise, 'HH:mm')}`}>🌅</Tooltip>,
      },
      [noonMin]: {
        label: <Tooltip title={`Solar Noon ${format(sunTimes.solarNoon, 'HH:mm')}`}>☀️</Tooltip>,
      },
      [sunsetMin]: {
        label: <Tooltip title={`Sunset ${format(sunTimes.sunset, 'HH:mm')}`}>🌇</Tooltip>,
      },
    };
  }, [sunTimes]);

  const currentValue = timeToSlider(selectedTime);
  const isSunUp = sunPosition.altitudeDegrees > 0;

  return (
    <div className="time-slider p-4 bg-white rounded-lg shadow">
      <Space direction="vertical" className="w-full" size="small">
        <div className="flex items-center justify-between">
          <Space>
            {isSunUp ? (
              <SunOutlined style={{ color: '#faad14', fontSize: 20 }} />
            ) : (
              <MoonOutlined style={{ color: '#1890ff', fontSize: 20 }} />
            )}
            <Text strong style={{ fontSize: 18 }}>
              {mounted ? format(selectedTime, 'HH:mm') : '--:--'}
            </Text>
          </Space>
          
          <Space>
            <Text type="secondary">
              {mounted ? `Sun: ${sunPosition.altitudeDegrees.toFixed(1)}° altitude` : ''}
            </Text>
            <Button
              type="text"
              icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={() => setIsPlaying(!isPlaying)}
              size="large"
            />
          </Space>
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
          className="w-full"
          trackStyle={{ backgroundColor: isSunUp ? '#faad14' : '#1890ff' }}
        />

        <div className="flex justify-between text-xs text-gray-500">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>

        <div className="quick-times flex gap-2 mt-2">
          <Button 
            size="small" 
            onClick={() => onTimeChange(sunTimes.sunrise)}
          >
            Sunrise
          </Button>
          <Button 
            size="small" 
            onClick={() => onTimeChange(new Date())}
          >
            Now
          </Button>
          <Button 
            size="small" 
            onClick={() => onTimeChange(sunTimes.solarNoon)}
          >
            Noon
          </Button>
          <Button 
            size="small" 
            onClick={() => onTimeChange(sunTimes.sunset)}
          >
            Sunset
          </Button>
        </div>
      </Space>
    </div>
  );
}


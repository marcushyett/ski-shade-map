'use client';

import { useState, useEffect, useCallback } from 'react';
import { Typography, Spin, Alert, Space, Button, Drawer } from 'antd';
import { 
  MenuOutlined, 
  InfoCircleOutlined,
  EnvironmentOutlined,
  NodeIndexOutlined,
  SwapOutlined
} from '@ant-design/icons';
import SkiMap from '@/components/Map';
import SkiAreaPicker from '@/components/Controls/SkiAreaPicker';
import TimeSlider from '@/components/Controls/TimeSlider';
import ViewToggle from '@/components/Controls/ViewToggle';
import Legend from '@/components/Controls/Legend';
import type { SkiAreaSummary, SkiAreaDetails } from '@/lib/types';

const { Title, Text, Paragraph } = Typography;

const STORAGE_KEY = 'ski-shade-map-state';

interface StoredState {
  areaId: string;
  areaName: string;
  latitude: number;
  longitude: number;
}

export default function Home() {
  const [selectedArea, setSelectedArea] = useState<SkiAreaSummary | null>(null);
  const [skiAreaDetails, setSkiAreaDetails] = useState<SkiAreaDetails | null>(null);
  const [selectedTime, setSelectedTime] = useState<Date>(() => {
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    return now;
  });
  const [is3D, setIs3D] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // Load saved state and update time after hydration
  useEffect(() => {
    setIsClient(true);
    setSelectedTime(new Date());
    
    // Load last selected area from localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const state: StoredState = JSON.parse(stored);
        // Create a minimal SkiAreaSummary to trigger the fetch
        setSelectedArea({
          id: state.areaId,
          name: state.areaName,
          country: null,
          region: null,
          latitude: state.latitude,
          longitude: state.longitude,
        });
      }
    } catch (e) {
      // Ignore localStorage errors
    }
    setInitialLoadDone(true);
  }, []);

  // Save selected area to localStorage
  useEffect(() => {
    if (!initialLoadDone || !selectedArea) return;
    
    try {
      const state: StoredState = {
        areaId: selectedArea.id,
        areaName: selectedArea.name,
        latitude: selectedArea.latitude,
        longitude: selectedArea.longitude,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // Ignore localStorage errors
    }
  }, [selectedArea, initialLoadDone]);

  // Fetch full ski area details when selection changes
  useEffect(() => {
    if (!selectedArea) {
      setSkiAreaDetails(null);
      return;
    }

    const fetchDetails = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const res = await fetch(`/api/ski-areas/${selectedArea.id}`);
        if (!res.ok) throw new Error('Failed to load ski area details');
        
        const data = await res.json();
        setSkiAreaDetails({
          ...data,
          runs: data.runs || [],
          lifts: data.lifts || [],
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load ski area');
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [selectedArea]);

  const handleAreaSelect = useCallback((area: SkiAreaSummary) => {
    setSelectedArea(area);
    setMobileMenuOpen(false);
  }, []);

  // Default coordinates (French Alps)
  const mapCenter = skiAreaDetails 
    ? { lat: skiAreaDetails.latitude, lng: skiAreaDetails.longitude }
    : { lat: 45.9, lng: 6.8 };

  const ControlsContent = () => (
    <Space direction="vertical" size="middle" className="w-full">
      <div>
        <Title level={4} className="m-0 mb-2">
          Ski Shade Map
        </Title>
        <Paragraph type="secondary" className="text-sm m-0">
          Find sunny or shaded slopes at any time of day
        </Paragraph>
      </div>

      <div>
        <Text strong className="block mb-2">Select Ski Area</Text>
        <SkiAreaPicker 
          onSelect={handleAreaSelect}
          selectedArea={selectedArea}
        />
      </div>

      {skiAreaDetails && (
        <div className="stats-summary p-3 rounded-lg">
          <Text strong>{skiAreaDetails.name}</Text>
          <div className="mt-2 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-sm">
              <NodeIndexOutlined style={{ opacity: 0.6 }} />
              <Text type="secondary">{skiAreaDetails.runs.length} runs</Text>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <SwapOutlined style={{ opacity: 0.6 }} />
              <Text type="secondary">{skiAreaDetails.lifts.length} lifts</Text>
            </div>
          </div>
        </div>
      )}

      {error && (
        <Alert
          type="error"
          message={error}
          closable
          onClose={() => setError(null)}
        />
      )}

      <div className="hidden md:block">
        <Text type="secondary" className="text-xs">
          <InfoCircleOutlined className="mr-1" />
          Shade calculation is based on slope orientation. 
          Actual conditions may vary based on terrain features.
        </Text>
      </div>
    </Space>
  );

  return (
    <div className="app-container">
      {/* Mobile header */}
      <div className="md:hidden controls-panel">
        <div className="flex items-center justify-between">
          <Title level={5} className="m-0">Ski Shade Map</Title>
          <Button 
            icon={<MenuOutlined />}
            onClick={() => setMobileMenuOpen(true)}
          />
        </div>
        {selectedArea && (
          <div className="flex items-center gap-2 mt-1">
            <EnvironmentOutlined style={{ opacity: 0.5 }} />
            <Text type="secondary" className="text-sm">
              {selectedArea.name}
            </Text>
          </div>
        )}
      </div>

      {/* Mobile drawer - comes from right to match hamburger position */}
      <Drawer
        title="Settings"
        placement="right"
        onClose={() => setMobileMenuOpen(false)}
        open={mobileMenuOpen}
        width={300}
      >
        <ControlsContent />
      </Drawer>

      {/* Desktop sidebar */}
      <div className="hidden md:block controls-panel">
        <ControlsContent />
      </div>

      {/* Map area */}
      <div className="map-container">
        {loading && (
          <div className="loading-overlay">
            <Spin size="large" />
          </div>
        )}

        <SkiMap 
          skiArea={skiAreaDetails}
          selectedTime={selectedTime}
          is3D={is3D}
        />

        {/* Legend */}
        <div className="legend-container hidden md:block">
          <Legend />
        </div>

        {/* View toggle */}
        <div className="view-toggle-container">
          <ViewToggle is3D={is3D} onChange={setIs3D} />
        </div>

        {/* Time slider */}
        <div className="time-slider-container">
          <TimeSlider 
            latitude={mapCenter.lat}
            longitude={mapCenter.lng}
            selectedTime={selectedTime}
            onTimeChange={setSelectedTime}
          />
        </div>
      </div>
    </div>
  );
}

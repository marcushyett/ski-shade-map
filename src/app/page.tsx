'use client';

import { useState, useEffect, useCallback } from 'react';
import { Typography, Spin, Alert, Button, Drawer } from 'antd';
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

const { Text } = Typography;

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
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  useEffect(() => {
    setSelectedTime(new Date());
    
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const state: StoredState = JSON.parse(stored);
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

  const mapCenter = skiAreaDetails 
    ? { lat: skiAreaDetails.latitude, lng: skiAreaDetails.longitude }
    : { lat: 45.9, lng: 6.8 };

  const ControlsContent = () => (
    <div className="flex flex-col gap-3">
      <div>
        <Text strong style={{ fontSize: 13 }}>SKI SHADE MAP</Text>
        <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>
          Find sunny or shaded slopes
        </Text>
      </div>

      <div>
        <Text type="secondary" style={{ fontSize: 10, marginBottom: 4, display: 'block' }}>
          SELECT AREA
        </Text>
        <SkiAreaPicker 
          onSelect={handleAreaSelect}
          selectedArea={selectedArea}
        />
      </div>

      {skiAreaDetails && (
        <div className="stats-summary">
          <Text strong style={{ fontSize: 11 }}>{skiAreaDetails.name}</Text>
          <div className="flex gap-4 mt-1">
            <div className="flex items-center gap-1">
              <NodeIndexOutlined style={{ fontSize: 10, opacity: 0.5 }} />
              <Text type="secondary" style={{ fontSize: 10 }}>{skiAreaDetails.runs.length} runs</Text>
            </div>
            <div className="flex items-center gap-1">
              <SwapOutlined style={{ fontSize: 10, opacity: 0.5 }} />
              <Text type="secondary" style={{ fontSize: 10 }}>{skiAreaDetails.lifts.length} lifts</Text>
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

      <div className="hidden md:block mt-2">
        <Text type="secondary" style={{ fontSize: 9 }}>
          <InfoCircleOutlined style={{ marginRight: 4, fontSize: 9 }} />
          Shade based on slope orientation. Actual conditions may vary.
        </Text>
      </div>
    </div>
  );

  return (
    <div className="app-container">
      {/* Mobile header */}
      <div className="md:hidden controls-panel">
        <div className="flex items-center justify-between">
          <Text strong style={{ fontSize: 12 }}>SKI SHADE MAP</Text>
          <Button 
            size="small"
            icon={<MenuOutlined style={{ fontSize: 12 }} />}
            onClick={() => setMobileMenuOpen(true)}
          />
        </div>
        {selectedArea && (
          <div className="flex items-center gap-1 mt-1">
            <EnvironmentOutlined style={{ fontSize: 10, opacity: 0.5 }} />
            <Text type="secondary" style={{ fontSize: 10 }}>
              {selectedArea.name}
            </Text>
          </div>
        )}
      </div>

      {/* Mobile drawer */}
      <Drawer
        title="Settings"
        placement="right"
        onClose={() => setMobileMenuOpen(false)}
        open={mobileMenuOpen}
        width={260}
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
            <Spin size="small" />
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

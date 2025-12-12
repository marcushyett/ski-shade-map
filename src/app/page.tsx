'use client';

import { useState, useEffect, useCallback } from 'react';
import { Typography, Spin, Alert, Space, Button, Drawer } from 'antd';
import { MenuOutlined, InfoCircleOutlined } from '@ant-design/icons';
import SkiMap from '@/components/Map';
import SkiAreaPicker from '@/components/Controls/SkiAreaPicker';
import TimeSlider from '@/components/Controls/TimeSlider';
import ViewToggle from '@/components/Controls/ViewToggle';
import Legend from '@/components/Controls/Legend';
import type { SkiAreaSummary, SkiAreaDetails } from '@/lib/types';

const { Title, Text, Paragraph } = Typography;

export default function Home() {
  const [selectedArea, setSelectedArea] = useState<SkiAreaSummary | null>(null);
  const [skiAreaDetails, setSkiAreaDetails] = useState<SkiAreaDetails | null>(null);
  const [selectedTime, setSelectedTime] = useState<Date>(new Date());
  const [is3D, setIs3D] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
          ⛷️ Ski Shade Map
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
        <div className="stats-summary p-3 bg-blue-50 rounded-lg">
          <Text strong>{skiAreaDetails.name}</Text>
          <div className="mt-1 text-sm text-gray-600">
            <div>🎿 {skiAreaDetails.runs.length} runs</div>
            <div>🚡 {skiAreaDetails.lifts.length} lifts</div>
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
          <Title level={5} className="m-0">⛷️ Ski Shade Map</Title>
          <Button 
            icon={<MenuOutlined />}
            onClick={() => setMobileMenuOpen(true)}
          />
        </div>
        {selectedArea && (
          <Text type="secondary" className="text-sm">
            {selectedArea.name}
          </Text>
        )}
      </div>

      {/* Mobile drawer */}
      <Drawer
        title="Settings"
        placement="left"
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
            <Spin size="large" tip="Loading ski area..." />
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

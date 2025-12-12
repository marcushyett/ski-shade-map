'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { Typography, Alert, Button, Drawer } from 'antd';
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
import Logo from '@/components/Logo';
import LoadingSpinner from '@/components/LoadingSpinner';
import TrailsLiftsList from '@/components/Controls/TrailsLiftsList';
import type { SkiAreaSummary, SkiAreaDetails, RunData, LiftData } from '@/lib/types';

const { Text } = Typography;

const STORAGE_KEY = 'ski-shade-map-state';

interface StoredState {
  areaId: string;
  areaName: string;
  latitude: number;
  longitude: number;
}

// Memoized controls content to prevent re-renders
const ControlsContent = memo(function ControlsContent({
  selectedArea,
  skiAreaDetails,
  error,
  onAreaSelect,
  onSelectRun,
  onSelectLift,
  onErrorClose,
}: {
  selectedArea: SkiAreaSummary | null;
  skiAreaDetails: SkiAreaDetails | null;
  error: string | null;
  onAreaSelect: (area: SkiAreaSummary) => void;
  onSelectRun: (run: RunData) => void;
  onSelectLift: (lift: LiftData) => void;
  onErrorClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex-shrink-0">
        <Logo size="md" />
        <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 4 }}>
          Find sunny or shaded slopes
        </Text>
      </div>

      <div className="flex-shrink-0">
        <Text type="secondary" style={{ fontSize: 10, marginBottom: 4, display: 'block' }}>
          SELECT AREA
        </Text>
        <SkiAreaPicker 
          onSelect={onAreaSelect}
          selectedArea={selectedArea}
        />
      </div>

      {skiAreaDetails && (
        <>
          <div className="stats-summary flex-shrink-0">
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

          <div className="flex-1 overflow-y-auto min-h-0">
            <TrailsLiftsList 
              runs={skiAreaDetails.runs}
              lifts={skiAreaDetails.lifts}
              onSelectRun={onSelectRun}
              onSelectLift={onSelectLift}
            />
          </div>
        </>
      )}

      {error && (
        <Alert
          type="error"
          message={error}
          closable
          onClose={onErrorClose}
        />
      )}

      {!skiAreaDetails && (
        <div className="hidden md:block mt-2">
          <Text type="secondary" style={{ fontSize: 9 }}>
            <InfoCircleOutlined style={{ marginRight: 4, fontSize: 9 }} />
            Select a ski area to view runs and lifts
          </Text>
        </div>
      )}
    </div>
  );
});

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
  const [highlightedFeatureId, setHighlightedFeatureId] = useState<string | null>(null);

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

  const handleSelectRun = useCallback((run: RunData) => {
    setHighlightedFeatureId(run.id);
    setTimeout(() => setHighlightedFeatureId(null), 3000);
  }, []);

  const handleSelectLift = useCallback((lift: LiftData) => {
    setHighlightedFeatureId(lift.id);
    setTimeout(() => setHighlightedFeatureId(null), 3000);
  }, []);

  const handleErrorClose = useCallback(() => {
    setError(null);
  }, []);

  const mapCenter = useMemo(() => 
    skiAreaDetails 
      ? { lat: skiAreaDetails.latitude, lng: skiAreaDetails.longitude }
      : { lat: 45.9, lng: 6.8 },
    [skiAreaDetails]
  );

  return (
    <div className="app-container">
      {/* Mobile header */}
      <div className="md:hidden controls-panel">
        <div className="flex items-center justify-between">
          <Logo size="sm" />
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
        width={280}
        styles={{ body: { padding: 12, display: 'flex', flexDirection: 'column' } }}
      >
        <ControlsContent 
          selectedArea={selectedArea}
          skiAreaDetails={skiAreaDetails}
          error={error}
          onAreaSelect={handleAreaSelect}
          onSelectRun={handleSelectRun}
          onSelectLift={handleSelectLift}
          onErrorClose={handleErrorClose}
        />
      </Drawer>

      {/* Desktop sidebar */}
      <div className="hidden md:flex md:flex-col controls-panel">
        <ControlsContent 
          selectedArea={selectedArea}
          skiAreaDetails={skiAreaDetails}
          error={error}
          onAreaSelect={handleAreaSelect}
          onSelectRun={handleSelectRun}
          onSelectLift={handleSelectLift}
          onErrorClose={handleErrorClose}
        />
      </div>

      {/* Map area */}
      <div className="map-container">
        {loading && (
          <div className="loading-overlay">
            <LoadingSpinner size={48} />
          </div>
        )}

        <SkiMap 
          skiArea={skiAreaDetails}
          selectedTime={selectedTime}
          is3D={is3D}
          highlightedFeatureId={highlightedFeatureId}
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

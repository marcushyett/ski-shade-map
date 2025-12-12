'use client';

import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { Typography, Alert, Button, Drawer } from 'antd';
import { 
  MenuOutlined, 
  InfoCircleOutlined,
  EnvironmentOutlined,
  NodeIndexOutlined,
  SwapOutlined,
  CloudOutlined,
} from '@ant-design/icons';
import SkiMap from '@/components/Map';
import type { MapRef, UserLocationMarker, MountainHomeMarker } from '@/components/Map/SkiMap';
import SkiAreaPicker from '@/components/Controls/SkiAreaPicker';
import TimeSlider from '@/components/Controls/TimeSlider';
import ViewToggle from '@/components/Controls/ViewToggle';
import Legend from '@/components/Controls/Legend';
import Logo from '@/components/Logo';
import LoadingSpinner from '@/components/LoadingSpinner';
import TrailsLiftsList from '@/components/Controls/TrailsLiftsList';
import WeatherPanel from '@/components/Controls/WeatherPanel';
import OfflineBanner from '@/components/OfflineBanner';
import CacheButton from '@/components/CacheButton';
import ShareButton from '@/components/ShareButton';
import SearchBar from '@/components/SearchBar';
import LocationControls from '@/components/LocationControls';
import type { MountainHome, UserLocation } from '@/components/LocationControls';
import { useOffline, registerServiceWorker } from '@/hooks/useOffline';
import { parseUrlState, minutesToDate } from '@/hooks/useUrlState';
import type { SkiAreaSummary, SkiAreaDetails, RunData, LiftData } from '@/lib/types';
import type { WeatherData, UnitPreferences } from '@/lib/weather-types';

const { Text } = Typography;

const STORAGE_KEY = 'ski-shade-map-state';
const UNITS_STORAGE_KEY = 'ski-shade-units';

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
  weather,
  selectedTime,
  isOffline,
  onAreaSelect,
  onSelectRun,
  onSelectLift,
  onErrorClose,
  onWeatherLoad,
}: {
  selectedArea: SkiAreaSummary | null;
  skiAreaDetails: SkiAreaDetails | null;
  error: string | null;
  weather: WeatherData | null;
  selectedTime: Date;
  isOffline: boolean;
  onAreaSelect: (area: SkiAreaSummary) => void;
  onSelectRun: (run: RunData) => void;
  onSelectLift: (lift: LiftData) => void;
  onErrorClose: () => void;
  onWeatherLoad: (weather: WeatherData) => void;
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
          SELECT AREA {isOffline && <span style={{ color: '#ff4d4f' }}>(offline)</span>}
        </Text>
        <SkiAreaPicker 
          onSelect={onAreaSelect}
          selectedArea={selectedArea}
          disabled={isOffline}
        />
      </div>

      {skiAreaDetails && (
        <>
          <div className="stats-summary flex-shrink-0 flex gap-4">
            <div className="flex items-center gap-1">
              <NodeIndexOutlined style={{ fontSize: 10, opacity: 0.5 }} />
              <Text type="secondary" style={{ fontSize: 10 }}>{skiAreaDetails.runs.length} runs</Text>
            </div>
            <div className="flex items-center gap-1">
              <SwapOutlined style={{ fontSize: 10, opacity: 0.5 }} />
              <Text type="secondary" style={{ fontSize: 10 }}>{skiAreaDetails.lifts.length} lifts</Text>
            </div>
          </div>

          {/* Trails and lifts list */}
          <div className="flex-shrink-0">
            <TrailsLiftsList 
              runs={skiAreaDetails.runs}
              lifts={skiAreaDetails.lifts}
              onSelectRun={onSelectRun}
              onSelectLift={onSelectLift}
            />
          </div>

          {/* Weather panel */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <WeatherPanel
              latitude={skiAreaDetails.latitude}
              longitude={skiAreaDetails.longitude}
              selectedTime={selectedTime}
              onWeatherLoad={onWeatherLoad}
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
  const [highlightedFeatureType, setHighlightedFeatureType] = useState<'run' | 'lift' | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [units, setUnits] = useState<UnitPreferences>({
    temperature: 'celsius',
    speed: 'kmh',
    length: 'cm',
  });
  const [mapView, setMapView] = useState<{ lat: number; lng: number; zoom: number } | null>(null);
  const [initialMapView, setInitialMapView] = useState<{ lat: number; lng: number; zoom: number } | null>(null);
  
  // Location features
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [mountainHome, setMountainHome] = useState<MountainHome | null>(null);
  const [isTrackingLocation, setIsTrackingLocation] = useState(false);
  const mapRef = useRef<MapRef | null>(null);
  
  // Offline support
  const { isOffline, wasOffline, lastOnline, clearOfflineWarning } = useOffline();

  // Register service worker
  useEffect(() => {
    registerServiceWorker();
  }, []);

  // Load initial state from URL or localStorage
  useEffect(() => {
    // First, check URL for shared state
    const urlState = parseUrlState();
    
    if (urlState.areaId) {
      // Load from URL (shared link)
      setSelectedArea({
        id: urlState.areaId,
        name: urlState.areaName || '', // Use name from URL if available
        country: null,
        region: null,
        latitude: urlState.lat || 0,
        longitude: urlState.lng || 0,
      });
      
      // Set initial map view from URL
      if (urlState.lat && urlState.lng && urlState.zoom) {
        setInitialMapView({ lat: urlState.lat, lng: urlState.lng, zoom: urlState.zoom });
      }
      
      // Set time from URL
      if (urlState.time !== null) {
        setSelectedTime(minutesToDate(urlState.time));
      } else {
        setSelectedTime(new Date());
      }
      
      // Set highlight from URL
      if (urlState.highlightId && urlState.highlightType) {
        setHighlightedFeatureId(urlState.highlightId);
        setHighlightedFeatureType(urlState.highlightType);
        // Auto-clear highlight after 5 seconds
        setTimeout(() => {
          setHighlightedFeatureId(null);
          setHighlightedFeatureType(null);
        }, 5000);
      }
      
      // Clear URL params after reading (cleaner URLs on refresh)
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', window.location.pathname);
      }
    } else {
      // Load from localStorage
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
    }
    
    // Load unit preferences
    try {
      const storedUnits = localStorage.getItem(UNITS_STORAGE_KEY);
      if (storedUnits) {
        setUnits(JSON.parse(storedUnits));
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
      setWeather(null);
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
        
        // Update selectedArea name if it was empty (from URL state)
        if (!selectedArea.name && data.name) {
          setSelectedArea(prev => prev ? { ...prev, name: data.name } : prev);
        }
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
    setWeather(null); // Clear weather when changing areas
    setMobileMenuOpen(false);
  }, []);

  const handleSelectRun = useCallback((run: RunData) => {
    setHighlightedFeatureId(run.id);
    setHighlightedFeatureType('run');
    setTimeout(() => {
      setHighlightedFeatureId(null);
      setHighlightedFeatureType(null);
    }, 3000);
  }, []);

  const handleSelectLift = useCallback((lift: LiftData) => {
    setHighlightedFeatureId(lift.id);
    setHighlightedFeatureType('lift');
    setTimeout(() => {
      setHighlightedFeatureId(null);
      setHighlightedFeatureType(null);
    }, 3000);
  }, []);

  const handleViewChange = useCallback((view: { lat: number; lng: number; zoom: number }) => {
    setMapView(view);
  }, []);

  const handleErrorClose = useCallback(() => {
    setError(null);
  }, []);

  const handleWeatherLoad = useCallback((weatherData: WeatherData) => {
    setWeather(weatherData);
  }, []);

  // Search handlers
  const handleSelectPlace = useCallback((coordinates: [number, number]) => {
    mapRef.current?.flyTo(coordinates[1], coordinates[0], 16);
  }, []);

  // Location handlers
  const handleGoToLocation = useCallback((lat: number, lng: number, zoom?: number) => {
    mapRef.current?.flyTo(lat, lng, zoom);
  }, []);

  const handleMountainHomeChange = useCallback((home: MountainHome | null) => {
    setMountainHome(home);
  }, []);

  const handleUserLocationChange = useCallback((location: UserLocation | null) => {
    setUserLocation(location);
  }, []);

  // Convert location types for map
  const userLocationMarker: UserLocationMarker | null = userLocation
    ? { latitude: userLocation.latitude, longitude: userLocation.longitude, accuracy: userLocation.accuracy }
    : null;

  const mountainHomeMarker: MountainHomeMarker | null = mountainHome
    ? { latitude: mountainHome.latitude, longitude: mountainHome.longitude, name: mountainHome.name }
    : null;

  const mapCenter = useMemo(() => 
    skiAreaDetails 
      ? { lat: skiAreaDetails.latitude, lng: skiAreaDetails.longitude }
      : { lat: 45.9, lng: 6.8 },
    [skiAreaDetails]
  );

  // Get hourly weather for time slider
  const hourlyWeather = useMemo(() => weather?.hourly || [], [weather]);

  // Get current cloud cover for visibility effects
  const currentCloudCover = useMemo(() => {
    if (!weather?.hourly) return null;
    
    const currentHour = selectedTime.getHours();
    const today = selectedTime.toDateString();
    
    const hourlyMatch = weather.hourly.find(h => {
      const d = new Date(h.time);
      return d.toDateString() === today && d.getHours() === currentHour;
    });
    
    return hourlyMatch ? {
      total: hourlyMatch.cloudCover,
      low: hourlyMatch.cloudCoverLow,
      mid: hourlyMatch.cloudCoverMid,
      high: hourlyMatch.cloudCoverHigh,
      visibility: hourlyMatch.visibility,
    } : null;
  }, [weather, selectedTime]);

  return (
    <div className="app-container">
      {/* Offline banner */}
      <OfflineBanner 
        isOffline={isOffline}
        wasOffline={wasOffline}
        lastOnline={lastOnline}
        onDismiss={clearOfflineWarning}
      />
      
      {/* Mobile header */}
      <div className="md:hidden controls-panel" style={{ marginTop: (isOffline || wasOffline) ? 44 : 0 }}>
        <div className="flex items-center justify-between">
          <Logo size="sm" />
          <div className="flex items-center gap-2">
            {weather && (
              <span style={{ fontSize: 10, color: '#888' }}>
                <CloudOutlined style={{ marginRight: 2 }} />
                {weather.current.cloudCover}%
              </span>
            )}
            <Button 
              size="small"
              icon={<MenuOutlined style={{ fontSize: 12 }} />}
              onClick={() => setMobileMenuOpen(true)}
            />
          </div>
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
          weather={weather}
          selectedTime={selectedTime}
          isOffline={isOffline}
          onAreaSelect={handleAreaSelect}
          onSelectRun={handleSelectRun}
          onSelectLift={handleSelectLift}
          onErrorClose={handleErrorClose}
          onWeatherLoad={handleWeatherLoad}
        />
      </Drawer>

      {/* Desktop sidebar */}
      <div className="hidden md:flex md:flex-col controls-panel" style={{ marginTop: (isOffline || wasOffline) ? 44 : 0 }}>
        <ControlsContent 
          selectedArea={selectedArea}
          skiAreaDetails={skiAreaDetails}
          error={error}
          weather={weather}
          selectedTime={selectedTime}
          isOffline={isOffline}
          onAreaSelect={handleAreaSelect}
          onSelectRun={handleSelectRun}
          onSelectLift={handleSelectLift}
          onErrorClose={handleErrorClose}
          onWeatherLoad={handleWeatherLoad}
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
          cloudCover={currentCloudCover}
          initialView={initialMapView}
          onViewChange={handleViewChange}
          userLocation={userLocationMarker}
          mountainHome={mountainHomeMarker}
          mapRef={mapRef}
        />

        {/* Search bar on map */}
        {skiAreaDetails && (
          <div className="map-search-container">
            <SearchBar
              runs={skiAreaDetails.runs}
              lifts={skiAreaDetails.lifts}
              skiAreaLatitude={skiAreaDetails.latitude}
              skiAreaLongitude={skiAreaDetails.longitude}
              onSelectRun={handleSelectRun}
              onSelectLift={handleSelectLift}
              onSelectPlace={handleSelectPlace}
            />
          </div>
        )}

        {/* Location controls */}
        <div className="location-controls-container">
          <LocationControls
            onUserLocationChange={handleUserLocationChange}
            onMountainHomeChange={handleMountainHomeChange}
            onGoToLocation={handleGoToLocation}
            mountainHome={mountainHome}
            userLocation={userLocation}
            isTrackingLocation={isTrackingLocation}
            onToggleTracking={setIsTrackingLocation}
          />
        </div>

        {/* Legend and action buttons */}
        <div className="legend-container hidden md:flex md:items-start md:gap-3">
          <Legend />
          {skiAreaDetails && (
            <div className="flex gap-2">
              <CacheButton
                skiAreaId={skiAreaDetails.id}
                skiAreaName={skiAreaDetails.name}
                latitude={skiAreaDetails.latitude}
                longitude={skiAreaDetails.longitude}
              />
              <ShareButton
                skiAreaId={skiAreaDetails.id}
                skiAreaName={skiAreaDetails.name}
                latitude={mapView?.lat ?? skiAreaDetails.latitude}
                longitude={mapView?.lng ?? skiAreaDetails.longitude}
                zoom={mapView?.zoom ?? 14}
                selectedTime={selectedTime}
                highlightedFeatureId={highlightedFeatureId}
                highlightedFeatureType={highlightedFeatureType}
              />
            </div>
          )}
        </div>

        {/* Mobile: Cache and Share buttons only (legend hidden on mobile) */}
        {skiAreaDetails && (
          <div className="cache-button-container md:hidden">
            <div className="flex gap-2">
              <CacheButton
                skiAreaId={skiAreaDetails.id}
                skiAreaName={skiAreaDetails.name}
                latitude={skiAreaDetails.latitude}
                longitude={skiAreaDetails.longitude}
              />
              <ShareButton
                skiAreaId={skiAreaDetails.id}
                skiAreaName={skiAreaDetails.name}
                latitude={mapView?.lat ?? skiAreaDetails.latitude}
                longitude={mapView?.lng ?? skiAreaDetails.longitude}
                zoom={mapView?.zoom ?? 14}
                selectedTime={selectedTime}
                highlightedFeatureId={highlightedFeatureId}
                highlightedFeatureType={highlightedFeatureType}
              />
            </div>
          </div>
        )}

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
            hourlyWeather={hourlyWeather}
            units={units}
          />
        </div>
      </div>
    </div>
  );
}

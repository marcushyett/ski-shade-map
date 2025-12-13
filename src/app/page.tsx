'use client';

import { useState, useEffect, useCallback, useMemo, memo, useRef, useDeferredValue, useTransition } from 'react';
import { Typography, Alert, Button, Drawer } from 'antd';
import { 
  MenuOutlined, 
  InfoCircleOutlined,
  CloudOutlined,
  SettingOutlined,
  DeleteOutlined,
  DownOutlined,
  RightOutlined,
} from '@ant-design/icons';
import SkiMap from '@/components/Map';
import type { MapRef, UserLocationMarker, MountainHomeMarker, SharedLocationMarker } from '@/components/Map/SkiMap';
import SkiAreaPicker from '@/components/Controls/SkiAreaPicker';
import TimeSlider from '@/components/Controls/TimeSlider';
import ViewToggle from '@/components/Controls/ViewToggle';
import Legend from '@/components/Controls/Legend';
import Logo from '@/components/Logo';
import LoadingSpinner from '@/components/LoadingSpinner';
import TrailsLiftsList from '@/components/Controls/TrailsLiftsList';
import WeatherPanel from '@/components/Controls/WeatherPanel';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useFavourites } from '@/hooks/useFavourites';
import OfflineBanner from '@/components/OfflineBanner';
import CacheButton from '@/components/CacheButton';
import ShareButton from '@/components/ShareButton';
import SearchBar from '@/components/SearchBar';
import LocationControls from '@/components/LocationControls';
import type { MountainHome, UserLocation } from '@/components/LocationControls';
import { useOffline, registerServiceWorker } from '@/hooks/useOffline';
import { parseUrlState, minutesToDate, SharedLocation } from '@/hooks/useUrlState';
import type { SkiAreaSummary, SkiAreaDetails, RunData, LiftData } from '@/lib/types';
import type { WeatherData, UnitPreferences } from '@/lib/weather-types';
import { analyzeResortSnowQuality, type ResortSnowSummary, type PisteSnowAnalysis, type SnowQualityAtPoint, getConditionInfo, calculateSnowQualityByAltitude } from '@/lib/snow-quality';
import { getSunPosition } from '@/lib/suncalc';
import SnowConditionsPanel from '@/components/Controls/SnowConditionsPanel';

const { Text } = Typography;

const STORAGE_KEY = 'ski-shade-map-state';
const UNITS_STORAGE_KEY = 'ski-shade-units';
const SHARED_LOCATIONS_STORAGE_KEY = 'ski-shade-shared-locations';

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
  favourites,
  snowSummary,
  snowQualityByRun,
  onAreaSelect,
  onSelectRun,
  onSelectLift,
  onErrorClose,
  onWeatherLoad,
  onRemoveFavourite,
}: {
  selectedArea: SkiAreaSummary | null;
  skiAreaDetails: SkiAreaDetails | null;
  error: string | null;
  weather: WeatherData | null;
  selectedTime: Date;
  isOffline: boolean;
  favourites: { id: string; name: string | null; difficulty: string | null; skiAreaId: string; skiAreaName: string }[];
  snowSummary: ResortSnowSummary | null;
  snowQualityByRun: Record<string, SnowQualityAtPoint[]>;
  onAreaSelect: (area: SkiAreaSummary) => void;
  onSelectRun: (run: RunData) => void;
  onSelectLift: (lift: LiftData) => void;
  onErrorClose: () => void;
  onWeatherLoad: (weather: WeatherData) => void;
  onRemoveFavourite: (runId: string) => void;
}) {
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  const handleReset = useCallback(() => {
    window.location.href = '/reset';
  }, []);

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex-shrink-0">
        <Logo size="md" />
        <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>
          Chase the sun, on the snow
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
          {/* Weather panel - compact at top */}
          <div className="flex-shrink-0">
            <WeatherPanel
              latitude={skiAreaDetails.latitude}
              longitude={skiAreaDetails.longitude}
              selectedTime={selectedTime}
              onWeatherLoad={onWeatherLoad}
            />
          </div>

          {/* Snow conditions */}
          {snowSummary && (
            <div className="flex-shrink-0">
              <SnowConditionsPanel summary={snowSummary} />
            </div>
          )}

          {/* Trails, lifts, and favourites list */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <TrailsLiftsList 
              runs={skiAreaDetails.runs}
              lifts={skiAreaDetails.lifts}
              favourites={favourites}
              latitude={skiAreaDetails.latitude}
              longitude={skiAreaDetails.longitude}
              hourlyWeather={weather?.hourly}
              snowQualityByRun={snowQualityByRun}
              onSelectRun={onSelectRun}
              onSelectLift={onSelectLift}
              onRemoveFavourite={onRemoveFavourite}
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

      {/* Advanced section */}
      <div className="flex-shrink-0 mt-2">
        <div 
          className="flex items-center gap-1.5 py-1 cursor-pointer hover:bg-white/5 rounded"
          onClick={() => setAdvancedExpanded(!advancedExpanded)}
          style={{ fontSize: 10, color: '#666' }}
        >
          {advancedExpanded ? <DownOutlined style={{ fontSize: 7 }} /> : <RightOutlined style={{ fontSize: 7 }} />}
          <SettingOutlined style={{ fontSize: 10 }} />
          <span>Advanced</span>
        </div>
        
        {advancedExpanded && (
          <div className="ml-4 mt-1 flex flex-col gap-1">
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 py-1 px-2 rounded hover:bg-white/10 transition-colors text-left"
              style={{ 
                fontSize: 10, 
                color: '#ff4d4f',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <DeleteOutlined style={{ fontSize: 10 }} />
              Clear cache & storage
            </button>
            <span style={{ fontSize: 9, color: '#555', paddingLeft: 4 }}>
              Clears all cached data and reloads the app
            </span>
          </div>
        )}
      </div>

      {/* Copyright - always at bottom */}
      <div className="flex-shrink-0 mt-auto pt-2 border-t border-white/10">
        <span style={{ fontSize: 9, color: '#666' }}>
          <a 
            href="https://openskimap.org" 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ color: '#888' }}
          >
            OpenSkiMap
          </a>
          {' '}© OSM
        </span>
        <br />
        <span style={{ fontSize: 9, color: '#555' }}>
          <QuestionCircleOutlined style={{ marginRight: 3 }} />
          Live status unavailable
        </span>
      </div>
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
  // Deferred time for heavy calculations - React will defer this during rapid updates
  const deferredTime = useDeferredValue(selectedTime);
  const isTimeStale = deferredTime !== selectedTime;
  
  const [is3D, setIs3D] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [highlightedFeatureId, setHighlightedFeatureId] = useState<string | null>(null);
  const [highlightedFeatureType, setHighlightedFeatureType] = useState<'run' | 'lift' | null>(null);
  const [searchPlaceMarker, setSearchPlaceMarker] = useState<{ latitude: number; longitude: number; name: string; placeType?: string } | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
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
  const [sharedLocations, setSharedLocations] = useState<SharedLocation[]>([]);
  const [isEditingHome, setIsEditingHome] = useState(false);
  const [pendingHomeLocation, setPendingHomeLocation] = useState<{ lat: number; lng: number } | null>(null);
  const mapRef = useRef<MapRef | null>(null);
  
  // Offline support
  const { isOffline, wasOffline, lastOnline, clearOfflineWarning } = useOffline();

  // Favourites support
  const { 
    favourites, 
    favouriteIds, 
    toggleFavourite, 
    removeFavourite 
  } = useFavourites(skiAreaDetails?.id || null, skiAreaDetails?.name || null);

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
      
      // Set time and date from URL
      if (urlState.time !== null || urlState.date !== null) {
        const timeMinutes = urlState.time !== null ? urlState.time : 12 * 60; // Default to noon
        setSelectedTime(minutesToDate(timeMinutes, urlState.date || undefined));
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
      
      // Handle shared location from URL
      if (urlState.sharedLat && urlState.sharedLng) {
        // Calculate end of day expiry
        const now = new Date();
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);
        
        const newSharedLocation: SharedLocation = {
          latitude: urlState.sharedLat,
          longitude: urlState.sharedLng,
          name: urlState.sharedName || 'Shared Location',
          expiresAt: endOfDay.getTime(),
          id: `shared-${Date.now()}`,
        };
        
        // Load existing shared locations and add new one
        try {
          const stored = localStorage.getItem(SHARED_LOCATIONS_STORAGE_KEY);
          const existing: SharedLocation[] = stored ? JSON.parse(stored) : [];
          
          // Filter out expired locations and add new one
          const validLocations = existing.filter(loc => loc.expiresAt > Date.now());
          validLocations.push(newSharedLocation);
          
          localStorage.setItem(SHARED_LOCATIONS_STORAGE_KEY, JSON.stringify(validLocations));
          setSharedLocations(validLocations);
        } catch {
          setSharedLocations([newSharedLocation]);
        }
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
    
    // Load shared locations from storage (if not already loaded from URL)
    if (!urlState.sharedLat) {
      try {
        const stored = localStorage.getItem(SHARED_LOCATIONS_STORAGE_KEY);
        if (stored) {
          const locations: SharedLocation[] = JSON.parse(stored);
          // Filter out expired locations
          const validLocations = locations.filter(loc => loc.expiresAt > Date.now());
          if (validLocations.length !== locations.length) {
            // Update storage with only valid locations
            localStorage.setItem(SHARED_LOCATIONS_STORAGE_KEY, JSON.stringify(validLocations));
          }
          setSharedLocations(validLocations);
        }
      } catch {
        // Ignore storage errors
      }
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
      setWeatherLoading(false);
      return;
    }

    // Weather will start loading when WeatherPanel renders
    setWeatherLoading(true);

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

  const handleToggleFavourite = useCallback((runId: string) => {
    if (!skiAreaDetails) return;
    
    const run = skiAreaDetails.runs.find(r => r.id === runId);
    if (run) {
      toggleFavourite(run);
    }
  }, [skiAreaDetails, toggleFavourite]);

  const handleErrorClose = useCallback(() => {
    setError(null);
  }, []);

  const handleWeatherLoad = useCallback((weatherData: WeatherData) => {
    setWeather(weatherData);
    setWeatherLoading(false);
  }, []);

  // Search handlers
  const handleSelectPlace = useCallback((coordinates: [number, number], name: string, placeType?: string) => {
    // Clear any highlighted feature when selecting a place
    setHighlightedFeatureId(null);
    setHighlightedFeatureType(null);
    
    // Set the search place marker
    setSearchPlaceMarker({
      latitude: coordinates[1],
      longitude: coordinates[0],
      name,
      placeType,
    });
    
    mapRef.current?.flyTo(coordinates[1], coordinates[0], 16);
  }, []);

  const handleClearSearchPlace = useCallback(() => {
    setSearchPlaceMarker(null);
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

  // Handler to remove a shared location
  const handleRemoveSharedLocation = useCallback((id: string) => {
    setSharedLocations(prev => {
      const updated = prev.filter(loc => loc.id !== id);
      try {
        localStorage.setItem(SHARED_LOCATIONS_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      return updated;
    });
  }, []);


  // Convert location types for map
  const userLocationMarker: UserLocationMarker | null = userLocation
    ? { latitude: userLocation.latitude, longitude: userLocation.longitude, accuracy: userLocation.accuracy }
    : null;

  const mountainHomeMarker: MountainHomeMarker | null = mountainHome
    ? { latitude: mountainHome.latitude, longitude: mountainHome.longitude, name: mountainHome.name }
    : null;

  // Convert shared locations for map
  const sharedLocationMarkers: SharedLocationMarker[] = sharedLocations.map(loc => ({
    latitude: loc.latitude,
    longitude: loc.longitude,
    name: loc.name,
    id: loc.id,
  }));

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

  // Calculate snow quality for all runs (uses deferred time for performance)
  const snowQuality = useMemo(() => {
    if (!skiAreaDetails || !weather?.hourly || !weather?.daily) {
      return { analyses: [], summary: null };
    }
    
    const sunPos = getSunPosition(deferredTime, skiAreaDetails.latitude, skiAreaDetails.longitude);
    
    const result = analyzeResortSnowQuality(
      skiAreaDetails.runs,
      deferredTime,
      weather.hourly,
      weather.daily,
      sunPos.azimuth,
      sunPos.altitudeDegrees
    );
    
    return {
      analyses: result.analyses,
      summary: result.summary,
    };
  }, [skiAreaDetails, weather, deferredTime]);

  // Format snow analyses for the map component
  const snowAnalysesForMap = useMemo(() => {
    return snowQuality.analyses.map(a => ({
      runId: a.runId,
      score: a.quality.score,
      condition: a.quality.condition,
      conditionLabel: getConditionInfo(a.quality.condition).label,
    }));
  }, [snowQuality.analyses]);

  // Calculate snow quality by altitude for favourite runs (uses deferred time)
  const snowQualityByRun = useMemo(() => {
    if (!skiAreaDetails || !weather?.hourly || !weather?.daily) {
      return {};
    }
    
    const sunPos = getSunPosition(deferredTime, skiAreaDetails.latitude, skiAreaDetails.longitude);
    const result: Record<string, SnowQualityAtPoint[]> = {};
    
    // Calculate for favourite runs
    favourites.forEach(fav => {
      const run = skiAreaDetails.runs.find(r => r.id === fav.id);
      if (run) {
        result[run.id] = calculateSnowQualityByAltitude(
          run,
          deferredTime,
          weather.hourly,
          weather.daily,
          sunPos.azimuth,
          sunPos.altitudeDegrees
        );
      }
    });
    
    return result;
  }, [skiAreaDetails, weather, deferredTime, favourites]);

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
        {/* Mobile search bar in header */}
        {skiAreaDetails && (
          <div className="mobile-header-search">
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
      </div>

      {/* Mobile drawer */}
      <Drawer
        title="Settings"
        placement="right"
        onClose={() => setMobileMenuOpen(false)}
        open={mobileMenuOpen}
        styles={{ 
          wrapper: { width: 280 },
          body: { padding: 12, display: 'flex', flexDirection: 'column' } 
        }}
      >
        <ControlsContent 
          selectedArea={selectedArea}
          skiAreaDetails={skiAreaDetails}
          error={error}
          weather={weather}
          selectedTime={selectedTime}
          isOffline={isOffline}
          favourites={favourites}
          snowSummary={snowQuality.summary}
          snowQualityByRun={snowQualityByRun}
          onAreaSelect={handleAreaSelect}
          onSelectRun={handleSelectRun}
          onSelectLift={handleSelectLift}
          onErrorClose={handleErrorClose}
          onWeatherLoad={handleWeatherLoad}
          onRemoveFavourite={removeFavourite}
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
          favourites={favourites}
          snowSummary={snowQuality.summary}
          snowQualityByRun={snowQualityByRun}
          onAreaSelect={handleAreaSelect}
          onSelectRun={handleSelectRun}
          onSelectLift={handleSelectLift}
          onErrorClose={handleErrorClose}
          onWeatherLoad={handleWeatherLoad}
          onRemoveFavourite={removeFavourite}
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
          highlightedFeatureType={highlightedFeatureType}
          cloudCover={currentCloudCover}
          initialView={initialMapView}
          onViewChange={handleViewChange}
          userLocation={userLocationMarker}
          mountainHome={mountainHomeMarker}
          sharedLocations={sharedLocationMarkers}
          onRemoveSharedLocation={handleRemoveSharedLocation}
          mapRef={mapRef}
          searchPlaceMarker={searchPlaceMarker}
          onClearSearchPlace={handleClearSearchPlace}
          favouriteIds={favouriteIds}
          onToggleFavourite={handleToggleFavourite}
          isEditingHome={isEditingHome}
          onSetHomeLocation={setPendingHomeLocation}
          snowAnalyses={snowAnalysesForMap}
        />

        {/* Search bar on map - desktop only */}
        {skiAreaDetails && (
          <div className="map-search-container hidden md:block">
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
            skiAreaId={skiAreaDetails?.id}
            skiAreaName={skiAreaDetails?.name}
            isEditingHome={isEditingHome}
            onEditingHomeChange={setIsEditingHome}
            pendingHomeLocation={pendingHomeLocation}
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
            dailyWeather={weather?.daily}
            units={units}
            isLoadingWeather={weatherLoading}
          />
        </div>
      </div>
    </div>
  );
}

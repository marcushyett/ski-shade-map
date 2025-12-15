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
import LocationSearch, { type LocationSelection } from '@/components/LocationSearch';
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
import UpdateBanner from '@/components/UpdateBanner';
import CacheButton from '@/components/CacheButton';
import ShareButton from '@/components/ShareButton';
import SearchBar from '@/components/SearchBar';
import LocationControls from '@/components/LocationControls';
import type { MountainHome, UserLocation } from '@/components/LocationControls';
import { RunDetailOverlay } from '@/components/RunDetailPanel';
import dynamic from 'next/dynamic';
import { NavigationButton, WCButton, type NavigationState, type SelectedPoint } from '@/components/NavigationPanel';
import { buildNavigationGraph, findNearestNode, findRoute } from '@/lib/navigation';
import NavigationInstructionBar from '@/components/NavigationInstructionBar';

// Lazy load NavigationPanel - only needed when user opens navigation
const NavigationPanel = dynamic(() => import('@/components/NavigationPanel').then(mod => ({ default: mod.default })), {
  ssr: false,
  loading: () => <div style={{ padding: 20, textAlign: 'center', color: '#666' }}>Loading navigation...</div>,
});
import type { NavigationRoute } from '@/lib/navigation';
import { formatDuration, formatDistance } from '@/lib/navigation';
import { analyzeRuns, calculateRunStats } from '@/lib/sunny-time-calculator';
import { useOffline, useAppUpdate, registerServiceWorker } from '@/hooks/useOffline';
import { parseUrlState, minutesToDate, SharedLocation } from '@/hooks/useUrlState';
import type { SkiAreaSummary, SkiAreaDetails, RunData, LiftData, POIData } from '@/lib/types';
import type { WeatherData, UnitPreferences } from '@/lib/weather-types';
import { analyzeResortSnowQuality, type ResortSnowSummary, type PisteSnowAnalysis, type SnowQualityAtPoint, getConditionInfo, calculateSnowQualityByAltitude } from '@/lib/snow-quality';
import { getSunPosition } from '@/lib/suncalc';
import { trackEvent } from '@/lib/posthog';
import SnowConditionsPanel from '@/components/Controls/SnowConditionsPanel';
import DonateButton from '@/components/DonateButton';

const { Text } = Typography;

const STORAGE_KEY = 'ski-shade-map-state';
const UNITS_STORAGE_KEY = 'ski-shade-units';
const SHARED_LOCATIONS_STORAGE_KEY = 'ski-shade-shared-locations';
const NAVIGATION_STORAGE_KEY = 'ski-shade-navigation';

interface StoredNavigationState {
  isNavigating: boolean;
  route: NavigationRoute | null;
  originName: string | null;
  destinationName: string | null;
  skiAreaId: string;
  savedAt: number;
}

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
  fakeLocation,
  isFakeLocationDropMode,
  onLocationSelect,
  currentSubRegion,
  onSelectRun,
  onSelectLift,
  onSelectSubRegion,
  onErrorClose,
  onWeatherLoad,
  onRemoveFavourite,
  onFakeLocationChange,
  onFakeLocationDropModeChange,
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
  fakeLocation: { lat: number; lng: number } | null;
  isFakeLocationDropMode: boolean;
  onLocationSelect: (location: LocationSelection) => void;
  currentSubRegion: { id: string; name: string } | null;
  onSelectRun: (run: RunData) => void;
  onSelectLift: (lift: LiftData) => void;
  onSelectSubRegion: (subRegion: { id: string; name: string; centroid?: { lat: number; lng: number } | null }) => void;
  onErrorClose: () => void;
  onWeatherLoad: (weather: WeatherData) => void;
  onRemoveFavourite: (runId: string) => void;
  onFakeLocationChange: (location: { lat: number; lng: number } | null) => void;
  onFakeLocationDropModeChange: (enabled: boolean) => void;
}) {
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  const handleReset = useCallback(() => {
    window.location.href = '/reset';
  }, []);

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="shrink-0">
        <Logo size="md" />
        <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>
          Chase the sun, on the snow
        </Text>
      </div>

      <div className="shrink-0">
        <Text type="secondary" style={{ fontSize: 10, marginBottom: 4, display: 'block' }}>
          LOCATION {isOffline && <span style={{ color: '#ff4d4f' }}>(offline)</span>}
        </Text>
        <LocationSearch 
          onSelect={onLocationSelect}
          currentLocation={{
            country: selectedArea?.country || undefined,
            region: selectedArea?.name || undefined,
            subRegion: currentSubRegion?.name,
          }}
          disabled={isOffline}
          placeholder="Search ski areas, villages..."
        />
      </div>

      {skiAreaDetails && (
        <>
          {/* Weather panel - compact at top */}
          <div className="shrink-0">
            <WeatherPanel
              latitude={skiAreaDetails.latitude}
              longitude={skiAreaDetails.longitude}
              selectedTime={selectedTime}
              onWeatherLoad={onWeatherLoad}
            />
          </div>

          {/* Snow conditions */}
          {snowSummary && (
            <div className="shrink-0">
              <SnowConditionsPanel summary={snowSummary} />
            </div>
          )}

          {/* Trails, lifts, and favourites list */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <TrailsLiftsList 
              runs={skiAreaDetails.runs}
              lifts={skiAreaDetails.lifts}
              subRegions={skiAreaDetails.subRegions}
              onSelectRun={onSelectRun}
              onSelectLift={onSelectLift}
              onSelectSubRegion={onSelectSubRegion}
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
      <div className="shrink-0 mt-2">
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
          <div className="ml-4 mt-1 flex flex-col gap-2">
            {/* Fake location for debugging */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (fakeLocation) {
                      // Clear fake location
                      onFakeLocationChange(null);
                      onFakeLocationDropModeChange(false);
                    } else {
                      // Enable drop mode
                      onFakeLocationDropModeChange(true);
                    }
                  }}
                  className={`flex items-center gap-1.5 py-1 px-2 rounded transition-colors ${isFakeLocationDropMode ? 'fake-loc-btn-active' : ''}`}
                  style={{ 
                    fontSize: 10, 
                    color: fakeLocation ? '#22c55e' : (isFakeLocationDropMode ? '#3b82f6' : '#888'),
                    background: isFakeLocationDropMode ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    border: '1px solid',
                    borderColor: fakeLocation ? '#22c55e' : (isFakeLocationDropMode ? '#3b82f6' : 'var(--border)'),
                    cursor: 'pointer',
                  }}
                >
                  📍 {fakeLocation ? 'Clear fake location' : (isFakeLocationDropMode ? 'Click map to set...' : 'Drop pin for fake location')}
                </button>
              </div>
              {fakeLocation && (
                <span style={{ fontSize: 9, color: '#22c55e', paddingLeft: 4 }}>
                  📍 Faking: {fakeLocation.lat.toFixed(4)}, {fakeLocation.lng.toFixed(4)}
                </span>
              )}
            </div>
            
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

      {/* Donate and copyright - always at bottom */}
      <div className="shrink-0 mt-auto pt-2 border-t border-white/10 flex flex-col gap-2">
        <DonateButton />
        <div>
          <span style={{ fontSize: 9, color: '#666' }}>
            <a 
              href="https://openskimap.org" 
              target="_blank" 
              rel="noopener noreferrer"
              style={{ color: '#888' }}
            >
              OpenSkiMap
            </a>
            {' '}© OSM | Weather by{' '}
            <a 
              href="https://open-meteo.com" 
              target="_blank" 
              rel="noopener noreferrer"
              style={{ color: '#888' }}
            >
              Open-Meteo
            </a>
          </span>
          <br />
          <span style={{ fontSize: 9, color: '#555' }}>
            <QuestionCircleOutlined style={{ marginRight: 3 }} />
            Live status unavailable
          </span>
        </div>
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
  const [selectedRunDetail, setSelectedRunDetail] = useState<{ runId: string; lngLat: { lng: number; lat: number } } | null>(null);
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
  
  // Navigation state
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const [navigationRoute, setNavigationRoute] = useState<NavigationRoute | null>(null);
  const [navigationState, setNavigationState] = useState<NavigationState | null>(null);
  const [userHeading, setUserHeading] = useState<number | null>(null);
  const [navMapClickMode, setNavMapClickMode] = useState<'origin' | 'destination' | null>(null);
  const [externalNavOrigin, setExternalNavOrigin] = useState<SelectedPoint | null>(null);
  const [externalNavDestination, setExternalNavDestination] = useState<SelectedPoint | null>(null);
  const [currentNavSegment, setCurrentNavSegment] = useState(0);
  const [fakeLocation, setFakeLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isFakeLocationDropMode, setIsFakeLocationDropMode] = useState(false);
  const [navReturnPoint, setNavReturnPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [isWeatherCardCollapsed, setIsWeatherCardCollapsed] = useState(false);
  const [isNavPanelMinimized, setIsNavPanelMinimized] = useState(false);
  
  // Location/sub-region tracking
  const [currentSubRegion, setCurrentSubRegion] = useState<{ id: string; name: string } | null>(null);
  const [zoomToSubRegion, setZoomToSubRegion] = useState<{ id: string; name: string; lat: number; lng: number } | null>(null);
  
  // Points of Interest (toilets, restaurants, viewpoints)
  const [pois, setPois] = useState<POIData[]>([]);
  
  // Effective user location - uses fake location for debugging if set
  const effectiveUserLocation = useMemo<UserLocation | null>(() => {
    if (fakeLocation) {
      return {
        latitude: fakeLocation.lat,
        longitude: fakeLocation.lng,
        accuracy: 10, // High accuracy for fake location
        timestamp: Date.now(),
      };
    }
    return userLocation;
  }, [fakeLocation, userLocation]);
  
  // Offline support
  const { isOffline, wasOffline, lastOnline, clearOfflineWarning } = useOffline();
  
  // App update detection
  const { updateAvailable, applyUpdate, dismissUpdate } = useAppUpdate();

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
        
        // Track shared location received
        trackEvent('shared_location_received', {
          latitude: urlState.sharedLat,
          longitude: urlState.sharedLng,
          shared_name: urlState.sharedName || undefined,
        });
        
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
    
    // Load persisted navigation state
    try {
      const storedNav = localStorage.getItem(NAVIGATION_STORAGE_KEY);
      if (storedNav) {
        const navState: StoredNavigationState = JSON.parse(storedNav);
        // Only restore if less than 4 hours old
        const maxAge = 4 * 60 * 60 * 1000; // 4 hours
        if (navState.isNavigating && navState.route && Date.now() - navState.savedAt < maxAge) {
          setNavigationRoute(navState.route);
          setNavigationState({
            isActive: true,
            origin: null,
            destination: null,
            route: navState.route,
            isNavigating: true,
            currentHeading: null,
          });
        } else {
          // Clear expired navigation state
          localStorage.removeItem(NAVIGATION_STORAGE_KEY);
        }
      }
    } catch {
      // Ignore storage errors
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

  // Persist navigation state to localStorage
  useEffect(() => {
    if (!initialLoadDone) return;
    
    try {
      if (navigationState?.isNavigating && navigationRoute && skiAreaDetails) {
        const navState: StoredNavigationState = {
          isNavigating: true,
          route: navigationRoute,
          originName: navigationState.origin?.name || null,
          destinationName: navigationState.destination?.name || null,
          skiAreaId: skiAreaDetails.id,
          savedAt: Date.now(),
        };
        localStorage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify(navState));
      } else {
        // Clear navigation state when not navigating
        localStorage.removeItem(NAVIGATION_STORAGE_KEY);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [navigationState?.isNavigating, navigationRoute, skiAreaDetails?.id, initialLoadDone]);

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
        const res = await fetch(`/api/ski-areas/${selectedArea.id}?includeConnected=true`);
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

  // Fetch POIs when ski area details (and bounds) are available
  useEffect(() => {
    if (!skiAreaDetails?.bounds) {
      setPois([]);
      return;
    }
    
    const bounds = skiAreaDetails.bounds as { minLat: number; maxLat: number; minLng: number; maxLng: number };
    
    const fetchPOIs = async () => {
      try {
        const params = new URLSearchParams({
          minLat: bounds.minLat.toString(),
          maxLat: bounds.maxLat.toString(),
          minLng: bounds.minLng.toString(),
          maxLng: bounds.maxLng.toString(),
        });
        
        const res = await fetch(`/api/pois?${params}`);
        if (res.ok) {
          const data = await res.json();
          setPois(data.pois || []);
        }
      } catch (error) {
        console.error('Failed to fetch POIs:', error);
        setPois([]);
      }
    };
    
    fetchPOIs();
  }, [skiAreaDetails?.bounds, skiAreaDetails?.id]);

  const handleAreaSelect = useCallback((area: SkiAreaSummary) => {
    setSelectedArea(area);
    setWeather(null); // Clear weather when changing areas
    setMobileMenuOpen(false);
  }, []);

  // Handle location selection from unified search
  const handleLocationSelect = useCallback((location: LocationSelection) => {
    // Set the selected area (this will trigger data loading)
    setSelectedArea({
      id: location.skiAreaId,
      name: location.skiAreaName,
      country: location.country || null,
      region: null,
      latitude: location.latitude || 0,
      longitude: location.longitude || 0,
    });
    setWeather(null);
    setMobileMenuOpen(false);
    
    // If a sub-region was selected, zoom to it after data loads
    if (location.zoomToSubRegion && location.subRegionId && location.latitude && location.longitude) {
      setZoomToSubRegion({
        id: location.subRegionId,
        name: location.subRegionName || '',
        lat: location.latitude,
        lng: location.longitude,
      });
      setCurrentSubRegion({
        id: location.subRegionId,
        name: location.subRegionName || '',
      });
    } else {
      setZoomToSubRegion(null);
      setCurrentSubRegion(null);
    }
    
    trackEvent('location_selected', {
      ski_area_id: location.skiAreaId,
      ski_area_name: location.skiAreaName,
      sub_region_id: location.subRegionId,
      sub_region_name: location.subRegionName,
      country: location.country,
    });
  }, []);

  // Handle zoom to sub-region after ski area data is loaded
  useEffect(() => {
    if (zoomToSubRegion && skiAreaDetails) {
      // Zoom to the sub-region with a slight delay to ensure map is ready
      setTimeout(() => {
        mapRef.current?.flyTo(zoomToSubRegion.lat, zoomToSubRegion.lng, 14);
        setZoomToSubRegion(null);
      }, 500);
    }
  }, [zoomToSubRegion, skiAreaDetails]);

  // Navigate to region (zoom out to see whole area)
  const handleNavigateToRegion = useCallback(() => {
    if (skiAreaDetails) {
      mapRef.current?.flyTo(skiAreaDetails.latitude, skiAreaDetails.longitude, 12);
      setCurrentSubRegion(null);
    }
  }, [skiAreaDetails]);

  // Navigate to a specific sub-region
  const handleNavigateToSubRegion = useCallback((subRegion: { id: string; name: string; centroid?: { lat: number; lng: number } | null }) => {
    if (subRegion.centroid) {
      mapRef.current?.flyTo(subRegion.centroid.lat, subRegion.centroid.lng, 14);
      setCurrentSubRegion({ id: subRegion.id, name: subRegion.name });
    }
  }, []);

  const handleSelectRun = useCallback((run: RunData) => {
    trackEvent('run_selected', {
      run_id: run.id,
      run_name: run.name || undefined,
      run_difficulty: run.difficulty || undefined,
      ski_area_id: selectedArea?.id,
      ski_area_name: selectedArea?.name,
    });
    setHighlightedFeatureId(run.id);
    setHighlightedFeatureType('run');
    setTimeout(() => {
      setHighlightedFeatureId(null);
      setHighlightedFeatureType(null);
    }, 3000);
  }, [selectedArea]);

  // Handle run click on map - show detail overlay or set navigation point
  const handleRunClick = useCallback((runId: string, lngLat: { lng: number; lat: number }) => {
    // If navigation map click mode is active, set the point
    if (navMapClickMode && isNavigationOpen && skiAreaDetails) {
      const run = skiAreaDetails.runs.find(r => r.id === runId);
      if (run) {
        const point: SelectedPoint = {
          type: 'run',
          id: run.id,
          name: run.name || 'Unnamed Run',
          nodeId: `run-${run.id}-start`,
          difficulty: run.difficulty,
        };
        
        if (navMapClickMode === 'origin') {
          setExternalNavOrigin(point);
        } else {
          setExternalNavDestination(point);
        }
        setNavMapClickMode(null);
        
        trackEvent('navigation_destination_from_click', {
          type: 'run',
          run_id: runId,
          run_name: run.name || undefined,
          field: navMapClickMode,
        });
        return;
      }
    }
    
    trackEvent('run_detail_viewed', {
      run_id: runId,
      ski_area_id: selectedArea?.id,
    });
    setSelectedRunDetail({ runId, lngLat });
  }, [selectedArea, navMapClickMode, isNavigationOpen, skiAreaDetails]);

  const handleCloseRunDetail = useCallback(() => {
    setSelectedRunDetail(null);
  }, []);

  // Handle arbitrary map click (background, not on a feature)
  const handleMapBackgroundClick = useCallback((lngLat: { lng: number; lat: number }) => {
    // If fake location drop mode is active, set fake location
    if (isFakeLocationDropMode) {
      setFakeLocation({ lat: lngLat.lat, lng: lngLat.lng });
      setIsFakeLocationDropMode(false);
      return true;
    }
    
    // If navigation map click mode is active, set an arbitrary map point
    if (navMapClickMode && isNavigationOpen) {
      const point: SelectedPoint = {
        type: 'mapPoint',
        id: `map-${lngLat.lat.toFixed(5)}-${lngLat.lng.toFixed(5)}`,
        name: `Map location`,
        lat: lngLat.lat,
        lng: lngLat.lng,
      };
      
      if (navMapClickMode === 'origin') {
        setExternalNavOrigin(point);
      } else {
        setExternalNavDestination(point);
      }
      setNavMapClickMode(null);
      
      trackEvent('navigation_destination_from_click', {
        type: 'mapPoint',
        latitude: lngLat.lat,
        longitude: lngLat.lng,
        field: navMapClickMode,
      });
      return true; // Indicate we handled the click
    }
    return false; // Did not handle, let default behavior happen
  }, [navMapClickMode, isNavigationOpen, isFakeLocationDropMode]);

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
    trackEvent('shared_location_dismissed', { location_id: id });
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

  // Helper: Find toilet with shortest route (optimized approach)
  const findNearestToilet = useCallback((fromLat: number, fromLng: number) => {
    if (!skiAreaDetails) return null;
    
    const toilets = pois.filter(poi => poi.type === 'toilet');
    if (toilets.length === 0) return null;
    
    // Step 1: Find 10 geographically closest toilets (cheap operation)
    const toiletsWithDistance = toilets.map(toilet => ({
      toilet,
      geoDistance: Math.sqrt(
        Math.pow(toilet.latitude - fromLat, 2) + 
        Math.pow(toilet.longitude - fromLng, 2)
      )
    }));
    
    toiletsWithDistance.sort((a, b) => a.geoDistance - b.geoDistance);
    const closeToilets = toiletsWithDistance.slice(0, Math.min(10, toilets.length));
    
    // If only one toilet or very few, just return the closest
    if (closeToilets.length === 1) {
      return closeToilets[0].toilet;
    }
    
    // Step 2: Build navigation graph (only once)
    const graph = buildNavigationGraph(skiAreaDetails);
    const startNode = findNearestNode(graph, fromLat, fromLng);
    if (!startNode) {
      // Fallback to geographically closest
      return closeToilets[0].toilet;
    }
    
    // Step 3: Calculate actual routes to only the 10 closest toilets
    let nearestToilet = closeToilets[0].toilet;
    let shortestRouteDistance = Infinity;
    
    for (const { toilet } of closeToilets) {
      const toiletNode = findNearestNode(graph, toilet.latitude, toilet.longitude);
      if (!toiletNode) continue;
      
      const route = findRoute(graph, startNode.id, toiletNode.id);
      
      if (route && route.totalDistance < shortestRouteDistance) {
        shortestRouteDistance = route.totalDistance;
        nearestToilet = toilet;
      }
    }
    
    return nearestToilet;
  }, [pois, skiAreaDetails]);

  // Navigation handlers
  const handleNavigationOpen = useCallback(() => {
    setIsNavigationOpen(true);
    setIsWeatherCardCollapsed(true); // Collapse weather card when opening route planner
    trackEvent('navigation_opened');
  }, []);

  const handleNavigationClose = useCallback(() => {
    setIsNavigationOpen(false);
    setNavigationRoute(null);
    setNavigationState(null);
    setNavMapClickMode(null);
    setExternalNavOrigin(null);
    setExternalNavDestination(null);
    setIsNavPanelMinimized(false);
    setIsWeatherCardCollapsed(false); // Uncollapse weather card when closing route planner
    trackEvent('navigation_closed');
  }, []);

  const handleRouteChange = useCallback((route: NavigationRoute | null) => {
    setNavigationRoute(route);
  }, []);

  const handleNavigationStateChange = useCallback((state: NavigationState) => {
    setNavigationState(state);
    // When navigation starts, close the nav panel and reset segment
    if (state.isNavigating) {
      setIsNavigationOpen(false);
      setCurrentNavSegment(0);
    }
  }, []);
  
  const handleEndNavigation = useCallback(() => {
    setNavigationState(null);
    setNavigationRoute(null);
    setCurrentNavSegment(0);
    setIsWeatherCardCollapsed(false); // Uncollapse weather card when ending navigation
  }, []);
  
  // WC button handler - quick route to nearest toilet
  const handleWCNavigation = useCallback(() => {
    const effectiveUserLocation = fakeLocation || userLocation;
    
    if (!effectiveUserLocation) {
      // No user location - just open navigation panel
      handleNavigationOpen();
      trackEvent('wc_navigation_no_location');
      return;
    }
    
    // Get lat/lng from either UserLocation or fake location format
    const userLat = 'latitude' in effectiveUserLocation ? effectiveUserLocation.latitude : effectiveUserLocation.lat;
    const userLng = 'longitude' in effectiveUserLocation ? effectiveUserLocation.longitude : effectiveUserLocation.lng;
    
    const nearestToilet = findNearestToilet(userLat, userLng);
    
    if (!nearestToilet) {
      // No toilets found - just open navigation panel
      handleNavigationOpen();
      trackEvent('wc_navigation_no_toilets');
      return;
    }
    
    // Set origin to current location
    const origin: SelectedPoint = {
      type: 'location',
      id: 'current-location',
      name: 'My Current Location',
      lat: userLat,
      lng: userLng,
    };
    
    // Set destination to nearest toilet
    const destination: SelectedPoint = {
      type: 'mapPoint',
      id: nearestToilet.id,
      name: nearestToilet.name || 'Toilet',
      lat: nearestToilet.latitude,
      lng: nearestToilet.longitude,
    };
    
    // Open navigation panel with these points
    setExternalNavOrigin(origin);
    setExternalNavDestination(destination);
    setIsNavigationOpen(true);
    setIsWeatherCardCollapsed(true);
    // Don't trigger map click mode - this is automatic navigation
    setNavMapClickMode(null);
    
    trackEvent('wc_navigation_started', {
      distance_km: Math.sqrt(
        Math.pow(nearestToilet.latitude - userLat, 2) + 
        Math.pow(nearestToilet.longitude - userLng, 2)
      ) * 111, // Rough conversion to km
    });
  }, [fakeLocation, userLocation, pois, findNearestToilet, handleNavigationOpen]);

  // Preview route - zoom out to show full route
  const handlePreviewRoute = useCallback(() => {
    if (!navigationRoute || !mapRef.current) return;
    
    // Calculate bounds of the route
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    
    navigationRoute.segments.forEach((segment) => {
      segment.coordinates?.forEach(([lng, lat]) => {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      });
    });
    
    if (minLat !== Infinity) {
      mapRef.current.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: 60, duration: 500 }
      );
    }
  }, [navigationRoute]);

  // Edit route - open navigation panel to edit while keeping route displayed
  const handleEditRoute = useCallback(() => {
    setIsNavigationOpen(true);
    // Keep the navigation state so the route stays visible
  }, []);

  // Track user progress along the navigation route
  useEffect(() => {
    if (!navigationState?.isNavigating || !navigationRoute || !effectiveUserLocation) return;
    
    const userLat = effectiveUserLocation.latitude;
    const userLng = effectiveUserLocation.longitude;
    
    // Find the closest segment to user's current position
    let closestSegmentIndex = 0;
    let closestDistance = Infinity;
    
    navigationRoute.segments.forEach((segment, segmentIdx) => {
      if (!segment.coordinates || segment.coordinates.length === 0) return;
      
      // Check distance to each coordinate in the segment
      segment.coordinates.forEach((coord) => {
        const [lng, lat] = coord;
        // Simple distance calculation (good enough for nearby points)
        const dLat = userLat - lat;
        const dLng = userLng - lng;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng) * 111000; // Rough meters conversion
        
        if (dist < closestDistance) {
          closestDistance = dist;
          closestSegmentIndex = segmentIdx;
        }
      });
    });
    
    // Only update if user is reasonably close to route (within 200m)
    // and segment has changed
    if (closestDistance < 200 && closestSegmentIndex !== currentNavSegment) {
      // Only allow moving forward in the route (or staying on same segment)
      // This prevents jumping back when user is between segments
      if (closestSegmentIndex >= currentNavSegment) {
        setCurrentNavSegment(closestSegmentIndex);
      }
    }
  }, [navigationState?.isNavigating, navigationRoute, effectiveUserLocation, currentNavSegment]);

  const handleNavMapClickRequest = useCallback((field: 'origin' | 'destination') => {
    // Toggle: if same field is already active, turn it off
    setNavMapClickMode(prev => prev === field ? null : field);
  }, []);

  const handleClearExternalNavOrigin = useCallback(() => {
    setExternalNavOrigin(null);
  }, []);

  const handleClearExternalNavDestination = useCallback(() => {
    setExternalNavDestination(null);
  }, []);

  // Handle lift click for navigation destination
  const handleLiftClick = useCallback((liftId: string, lngLat: { lng: number; lat: number }) => {
    // If navigation map click mode is active, set the point
    if (navMapClickMode && isNavigationOpen && skiAreaDetails) {
      const lift = skiAreaDetails.lifts.find(l => l.id === liftId);
      if (lift) {
        const point: SelectedPoint = {
          type: 'lift',
          id: lift.id,
          name: lift.name || 'Unnamed Lift',
          nodeId: `lift-${lift.id}-start`,
          liftType: lift.liftType,
        };
        
        if (navMapClickMode === 'origin') {
          setExternalNavOrigin(point);
        } else {
          setExternalNavDestination(point);
        }
        setNavMapClickMode(null);
        
        trackEvent('navigation_destination_from_click', {
          type: 'lift',
          lift_id: liftId,
          lift_name: lift.name || undefined,
          field: navMapClickMode,
        });
        return;
      }
    }
  }, [navMapClickMode, isNavigationOpen, skiAreaDetails]);

  // Convert location types for map - use effective location (which may be fake for debugging)
  const userLocationMarker: UserLocationMarker | null = effectiveUserLocation
    ? { latitude: effectiveUserLocation.latitude, longitude: effectiveUserLocation.longitude, accuracy: effectiveUserLocation.accuracy }
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

  // Get navigation marker coordinates from navigation state
  // For location/mapPoint/home types, use lat/lng directly
  // For run/lift types, find the feature and get its coordinates
  const getNavMarkerCoords = useCallback((point: SelectedPoint | null | undefined): { lat: number; lng: number; name?: string } | null => {
    if (!point) return null;
    
    // For types with direct coordinates
    if ((point.type === 'location' || point.type === 'mapPoint' || point.type === 'home') && point.lat && point.lng) {
      return { lat: point.lat, lng: point.lng, name: point.name };
    }
    
    // For runs, get the first/last coordinate based on position
    if (point.type === 'run' && skiAreaDetails) {
      const run = skiAreaDetails.runs.find(r => r.id === point.id);
      if (run?.geometry) {
        // Handle both LineString and Polygon geometries
        let coords: number[][] | undefined;
        if (run.geometry.type === 'LineString') {
          coords = run.geometry.coordinates as number[][];
        } else if (run.geometry.type === 'Polygon') {
          // Use the outer ring for polygons
          coords = run.geometry.coordinates[0] as number[][];
        }
        
        if (coords && coords.length > 0) {
          // Use first coord for top (start), last for bottom (end)
          const useFirst = point.position === 'top';
          const coord = useFirst ? coords[0] : coords[coords.length - 1];
          if (coord && coord.length >= 2) {
            return { lat: coord[1], lng: coord[0], name: point.name };
          }
        }
      }
    }
    
    // For lifts, get the first/last coordinate based on position
    if (point.type === 'lift' && skiAreaDetails) {
      const lift = skiAreaDetails.lifts.find(l => l.id === point.id);
      if (lift?.geometry?.coordinates) {
        const coords = lift.geometry.coordinates as number[][];
        // Use first coord for bottom (start), last for top (end)
        const useLast = point.position === 'top';
        const coord = useLast ? coords[coords.length - 1] : coords[0];
        if (coord && coord.length >= 2) {
          return { lat: coord[1], lng: coord[0], name: point.name };
        }
      }
    }
    
    return null;
  }, [skiAreaDetails]);

  // Navigation marker positions derived from navigationState (not external props)
  const navigationOriginMarker = useMemo(() => {
    return getNavMarkerCoords(navigationState?.origin);
  }, [navigationState?.origin, getNavMarkerCoords]);

  const navigationDestinationMarker = useMemo(() => {
    return getNavMarkerCoords(navigationState?.destination);
  }, [navigationState?.destination, getNavMarkerCoords]);

  const mapCenter = useMemo(() => 
    skiAreaDetails 
      ? { lat: skiAreaDetails.latitude, lng: skiAreaDetails.longitude }
      : { lat: 45.9, lng: 6.8 },
    [skiAreaDetails]
  );

  // Detect which sub-region the map center is in
  const detectSubRegion = useCallback((lat: number, lng: number) => {
    if (!skiAreaDetails?.subRegions?.length) return null;
    
    // Find the sub-region whose centroid is closest to the map center
    let closestSubRegion: { id: string; name: string } | null = null;
    let closestDistance = Infinity;
    
    for (const subRegion of skiAreaDetails.subRegions) {
      const centroid = subRegion.centroid as { lat: number; lng: number } | null;
      if (!centroid) continue;
      
      // Simple distance calculation
      const distance = Math.sqrt(
        Math.pow(lat - centroid.lat, 2) + Math.pow(lng - centroid.lng, 2)
      );
      
      // Only consider if within reasonable distance (~5km = ~0.05 degrees)
      if (distance < 0.05 && distance < closestDistance) {
        closestDistance = distance;
        closestSubRegion = { id: subRegion.id, name: subRegion.name };
      }
    }
    
    return closestSubRegion;
  }, [skiAreaDetails?.subRegions]);

  // Update current sub-region when map view changes
  useEffect(() => {
    if (mapView) {
      const detectedSubRegion = detectSubRegion(mapView.lat, mapView.lng);
      setCurrentSubRegion(detectedSubRegion);
    }
  }, [mapView, detectSubRegion]);

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
      sunPos.altitudeDegrees,
      skiAreaDetails.latitude, // For timezone lookup via geo-tz
      skiAreaDetails.longitude
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

  // Calculate snow quality by altitude for favourite runs and selected run (uses deferred time)
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
          sunPos.altitudeDegrees,
          skiAreaDetails.latitude, // For timezone lookup via geo-tz
          skiAreaDetails.longitude
        );
      }
    });
    
    // Also calculate for selected run if it's not already a favourite
    if (selectedRunDetail?.runId && !result[selectedRunDetail.runId]) {
      const selectedRun = skiAreaDetails.runs.find(r => r.id === selectedRunDetail.runId);
      if (selectedRun) {
        result[selectedRun.id] = calculateSnowQualityByAltitude(
          selectedRun,
          deferredTime,
          weather.hourly,
          weather.daily,
          sunPos.azimuth,
          sunPos.altitudeDegrees,
          skiAreaDetails.latitude, // For timezone lookup via geo-tz
          skiAreaDetails.longitude
        );
      }
    }
    
    return result;
  }, [skiAreaDetails, weather, deferredTime, favourites, selectedRunDetail?.runId]);

  // Calculate analysis and stats for the selected run overlay
  const selectedRunData = useMemo(() => {
    if (!selectedRunDetail?.runId || !skiAreaDetails) return null;
    
    const run = skiAreaDetails.runs.find(r => r.id === selectedRunDetail.runId);
    if (!run) return null;
    
    const analyses = analyzeRuns([run], selectedTime, skiAreaDetails.latitude, skiAreaDetails.longitude, weather?.hourly);
    const analysis = analyses[0] || null;
    const stats = calculateRunStats(run);
    const isFavourite = favourites.some(f => f.id === run.id);
    
    // Calculate temperature data based on selected time
    let temperatureData: { temperature: number; stationAltitude: number } | undefined;
    if (weather?.hourly && weather.elevation) {
      const targetHour = selectedTime.getHours();
      const targetDate = selectedTime.toDateString();
      
      const hourlyMatch = weather.hourly.find(h => {
        const d = new Date(h.time);
        return d.toDateString() === targetDate && d.getHours() === targetHour;
      });
      
      if (hourlyMatch) {
        temperatureData = {
          temperature: hourlyMatch.temperature,
          stationAltitude: weather.elevation,
        };
      }
    }
    
    return { run, analysis, stats, isFavourite, temperatureData };
  }, [selectedRunDetail?.runId, skiAreaDetails, selectedTime, weather?.hourly, weather?.elevation, favourites]);

  return (
    <div className="app-container">
      {/* Update available banner */}
      {updateAvailable && (
        <UpdateBanner 
          onUpdate={applyUpdate}
          onDismiss={dismissUpdate}
        />
      )}
      
      {/* Offline banner */}
      {!updateAvailable && (
        <OfflineBanner 
          isOffline={isOffline}
          wasOffline={wasOffline}
          lastOnline={lastOnline}
          onDismiss={clearOfflineWarning}
        />
      )}
      
      {/* Mobile header */}
      <div className="md:hidden controls-panel" style={{ marginTop: (isOffline || wasOffline) ? 44 : 0 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Logo size="sm" />
            {skiAreaDetails && (
              <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                <span style={{ fontSize: 10, color: '#666' }}>|</span>
                <span 
                  style={{ 
                    fontSize: 10, 
                    color: '#a3a3a3',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={`${skiAreaDetails.country ? skiAreaDetails.country + ' · ' : ''}${skiAreaDetails.name}${currentSubRegion ? ' · ' + currentSubRegion.name : ''}`}
                >
                  {skiAreaDetails.country && (
                    <span style={{ color: '#666' }}>{skiAreaDetails.country} · </span>
                  )}
                  {skiAreaDetails.name}
                  {currentSubRegion && (
                    <span style={{ color: '#888' }}> · {currentSubRegion.name}</span>
                  )}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
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
          fakeLocation={fakeLocation}
          isFakeLocationDropMode={isFakeLocationDropMode}
          onLocationSelect={handleLocationSelect}
          currentSubRegion={currentSubRegion}
          onSelectRun={handleSelectRun}
          onSelectLift={handleSelectLift}
          onSelectSubRegion={handleNavigateToSubRegion}
          onErrorClose={handleErrorClose}
          onWeatherLoad={handleWeatherLoad}
          onRemoveFavourite={removeFavourite}
          onFakeLocationChange={setFakeLocation}
          onFakeLocationDropModeChange={setIsFakeLocationDropMode}
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
          fakeLocation={fakeLocation}
          isFakeLocationDropMode={isFakeLocationDropMode}
          onLocationSelect={handleLocationSelect}
          currentSubRegion={currentSubRegion}
          onSelectRun={handleSelectRun}
          onSelectLift={handleSelectLift}
          onSelectSubRegion={handleNavigateToSubRegion}
          onErrorClose={handleErrorClose}
          onWeatherLoad={handleWeatherLoad}
          onRemoveFavourite={removeFavourite}
          onFakeLocationChange={setFakeLocation}
          onFakeLocationDropModeChange={setIsFakeLocationDropMode}
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
          onRunClick={handleRunClick}
          onLiftClick={handleLiftClick}
          onMapClick={handleCloseRunDetail}
          onMapBackgroundClick={handleMapBackgroundClick}
          isEditingHome={isEditingHome}
          onSetHomeLocation={setPendingHomeLocation}
          snowAnalyses={snowAnalysesForMap}
          navigationRoute={navigationRoute}
          isNavigating={navigationState?.isNavigating ?? false}
          userHeading={userHeading}
          navMapClickMode={navMapClickMode}
          isFakeLocationDropMode={isFakeLocationDropMode}
          navigationOrigin={navigationOriginMarker}
          navigationDestination={navigationDestinationMarker}
          navigationReturnPoint={navReturnPoint}
          pois={pois}
        />

        {/* Run detail overlay - shows when a run is clicked */}
        {selectedRunData && selectedRunDetail && (
          <RunDetailOverlay
            run={selectedRunData.run}
            analysis={selectedRunData.analysis || undefined}
            stats={selectedRunData.stats}
            snowQuality={snowQualityByRun[selectedRunData.run.id]}
            temperatureData={selectedRunData.temperatureData}
            isFavourite={selectedRunData.isFavourite}
            lngLat={selectedRunDetail.lngLat}
            mapRef={mapRef}
            onClose={handleCloseRunDetail}
            onToggleFavourite={() => {
              toggleFavourite(selectedRunData.run);
            }}
          />
        )}

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
          
          {/* Navigation button */}
          {skiAreaDetails && !isNavigationOpen && (
            <div style={{ marginTop: 4, pointerEvents: 'auto' }}>
              <NavigationButton
                onClick={handleNavigationOpen}
                hasRoute={navigationRoute !== null}
                routeSummary={navigationRoute 
                  ? `${formatDuration(navigationRoute.totalTime)} · ${formatDistance(navigationRoute.totalDistance)}`
                  : undefined
                }
              />
              {/* WC button - quick toilet navigation */}
              <WCButton
                onClick={handleWCNavigation}
                disabled={pois.filter(p => p.type === 'toilet').length === 0}
              />
            </div>
          )}
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

        {/* Time slider with optional navigation panel and instruction bar above it */}
        <div className="time-slider-container">
          {/* Navigation panel - shown as card above weather when route planning */}
          {skiAreaDetails && isNavigationOpen && (
            <div className="nav-panel-inline">
              <NavigationPanel
                skiArea={skiAreaDetails}
                userLocation={effectiveUserLocation}
                mountainHome={mountainHome}
                onRouteChange={handleRouteChange}
                onNavigationStateChange={handleNavigationStateChange}
                onClose={handleNavigationClose}
                isExpanded={true}
                externalOrigin={externalNavOrigin}
                externalDestination={externalNavDestination}
                onClearExternalOrigin={handleClearExternalNavOrigin}
                onClearExternalDestination={handleClearExternalNavDestination}
                onRequestMapClick={handleNavMapClickRequest}
                onCancelMapClick={() => setNavMapClickMode(null)}
                mapClickMode={navMapClickMode}
                isMinimized={isNavPanelMinimized}
                onToggleMinimize={() => setIsNavPanelMinimized(!isNavPanelMinimized)}
                hourlyWeather={hourlyWeather}
                pois={pois}
              />
            </div>
          )}
          
          {/* Navigation instruction bar - shown when actively navigating */}
          {navigationState?.isNavigating && navigationRoute && (
            <NavigationInstructionBar
              route={navigationRoute}
              currentSegmentIndex={currentNavSegment}
              onEndNavigation={handleEndNavigation}
              userLocation={effectiveUserLocation ? { lat: effectiveUserLocation.latitude, lng: effectiveUserLocation.longitude } : null}
              onReturnPointChange={setNavReturnPoint}
              isWeatherCollapsed={isWeatherCardCollapsed}
              onToggleWeather={() => setIsWeatherCardCollapsed(!isWeatherCardCollapsed)}
              onPreviewRoute={handlePreviewRoute}
              onEditRoute={handleEditRoute}
            />
          )}
          
          {/* Time slider - supports collapsed mode */}
          <TimeSlider 
            latitude={mapCenter.lat}
            longitude={mapCenter.lng}
            selectedTime={selectedTime}
            onTimeChange={setSelectedTime}
            hourlyWeather={hourlyWeather}
            dailyWeather={weather?.daily}
            units={units}
            isLoadingWeather={weatherLoading}
            isCollapsed={isWeatherCardCollapsed}
            onToggleCollapsed={() => setIsWeatherCardCollapsed(!isWeatherCardCollapsed)}
          />
        </div>
      </div>

    </div>
  );
}

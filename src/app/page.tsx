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
  EnvironmentOutlined,
  HomeOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import SkiMap from '@/components/Map';
import type { MapRef, UserLocationMarker, MountainHomeMarker, SharedLocationMarker } from '@/components/Map/SkiMap';
import LocationSearch, { type LocationSelection } from '@/components/LocationSearch';
import TimeSlider from '@/components/Controls/TimeSlider';
import MapControls from '@/components/Controls/MapControls';
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
import { LiftDetailOverlay } from '@/components/LiftDetailPanel';
import dynamic from 'next/dynamic';
import { NavigationButton, WCButton, type NavigationState, type SelectedPoint } from '@/components/NavigationPanel';
import { buildNavigationGraph, findNearestNode, findRoute, addPoiNodeToGraph, type NavigationGraph } from '@/lib/navigation';
import NavigationInstructionBar from '@/components/NavigationInstructionBar';

// Lazy load NavigationPanel - only needed when user opens navigation
const NavigationPanel = dynamic(() => import('@/components/NavigationPanel').then(mod => ({ default: mod.default })), {
  ssr: false,
  loading: () => <div style={{ padding: 20, textAlign: 'center', color: '#666' }}>Loading navigation...</div>,
});

// Lazy load MaxOptimality - only needed when user opens from advanced menu
const MaxOptimality = dynamic(() => import('@/components/MaxOptimality').then(mod => mod.MaxOptimality), {
  ssr: false,
  loading: () => null,
});
import type { NavigationRoute } from '@/lib/navigation';
import type { MaxOptimalityPlan } from '@/lib/max-optimality/types';
import { formatDuration, formatDistance } from '@/lib/navigation';
import { analyzeRuns, calculateRunStats } from '@/lib/sunny-time-calculator';
import { format } from 'date-fns';
import { useOffline, useAppUpdate, registerServiceWorker } from '@/hooks/useOffline';
import { parseUrlState, minutesToDate, SharedLocation } from '@/hooks/useUrlState';
import type { SkiAreaSummary, SkiAreaDetails, RunData, LiftData, POIData } from '@/lib/types';
import type { WeatherData, UnitPreferences } from '@/lib/weather-types';
import { analyzeResortSnowQuality, type ResortSnowSummary, type PisteSnowAnalysis, type SnowQualityAtPoint, getConditionInfo, calculateSnowQualityByAltitude } from '@/lib/snow-quality';
import { getSunPosition } from '@/lib/suncalc';
import { getResortLocalTime } from '@/lib/route-sun-calculator';
import { trackEvent } from '@/lib/posthog';
import { getCachedSkiArea, cacheSkiArea, clearExpiredCache } from '@/lib/ski-area-cache';
import SnowConditionsPanel from '@/components/Controls/SnowConditionsPanel';
import DonateButton from '@/components/DonateButton';
import Onboarding from '@/components/Onboarding';
import { fetchResortStatus, hasLiveStatus, enrichLiftsWithStatus, enrichRunsWithStatus, getResortStatusSummary, type ResortStatusSummary } from '@/lib/lift-status-service';
import type { ResortStatus, EnrichedLiftData, EnrichedRunData } from '@/lib/lift-status-types';
import MessageInbox from '@/components/MessageInbox';
import { useResortMessages } from '@/hooks/useResortMessages';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { usePlanningMode } from '@/hooks/usePlanningMode';
import PlanningModeButton from '@/components/Controls/PlanningModeButton';
import PlanningModePanel from '@/components/Controls/PlanningModePanel';
import type { YesterdayStatusResponse } from '@/lib/planning-mode-types';

const { Text } = Typography;

const STORAGE_KEY = 'ski-shade-map-state';

/**
 * Calculate approximate distance from center for a run (for sorting closest first)
 * Uses the first coordinate of the run geometry as an approximation
 */
function getRunDistanceFromCenter(run: RunData, centerLat: number, centerLng: number): number {
  const coords = run.geometry.type === 'LineString'
    ? run.geometry.coordinates
    : run.geometry.type === 'Polygon'
      ? run.geometry.coordinates[0]
      : null;

  if (!coords || coords.length === 0) return Infinity;

  // Use the first point of the run as approximation
  const [lng, lat] = coords[0] as [number, number];

  // Simple Euclidean distance (good enough for sorting)
  const dlat = lat - centerLat;
  const dlng = (lng - centerLng) * Math.cos(centerLat * Math.PI / 180);
  return dlat * dlat + dlng * dlng;
}

/**
 * Sort runs by distance from center (closest first)
 */
function sortRunsByDistanceFromCenter(runs: RunData[], centerLat: number, centerLng: number): RunData[] {
  return [...runs].sort((a, b) => {
    const distA = getRunDistanceFromCenter(a, centerLat, centerLng);
    const distB = getRunDistanceFromCenter(b, centerLat, centerLng);
    return distA - distB;
  });
}

/**
 * Similarly for lifts
 */
function getLiftDistanceFromCenter(lift: LiftData, centerLat: number, centerLng: number): number {
  const coords = lift.geometry.coordinates;
  if (!coords || coords.length === 0) return Infinity;

  const [lng, lat] = coords[0] as [number, number];
  const dlat = lat - centerLat;
  const dlng = (lng - centerLng) * Math.cos(centerLat * Math.PI / 180);
  return dlat * dlat + dlng * dlng;
}

function sortLiftsByDistanceFromCenter(lifts: LiftData[], centerLat: number, centerLng: number): LiftData[] {
  return [...lifts].sort((a, b) => {
    const distA = getLiftDistanceFromCenter(a, centerLat, centerLng);
    const distB = getLiftDistanceFromCenter(b, centerLat, centerLng);
    return distA - distB;
  });
}
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
interface StatusDebugInfo {
  skiAreaId: string | null;
  osmId: string | null;
  hasLiveStatus: boolean | null;
  statusFetchAttempted: boolean;
  statusFetchError: string | null;
  resortStatusData: {
    lifts: number;
    runs: number;
    resortName: string | null;
  } | null;
  lastFetchTime: string | null;
}

const ControlsContent = memo(function ControlsContent({
  selectedArea,
  skiAreaDetails,
  enrichedRuns,
  enrichedLifts,
  resortStatus,
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
  onUseCurrentLocation,
  isGettingCurrentLocation,
  currentLocality,
  onSelectRun,
  onSelectLift,
  onSelectLocality,
  onErrorClose,
  onWeatherLoad,
  onRemoveFavourite,
  onFakeLocationChange,
  onFakeLocationDropModeChange,
  statusDebug,
  mountainHome,
  onMountainHomeChange,
  onMaxOptimalityOpen,
}: {
  selectedArea: SkiAreaSummary | null;
  skiAreaDetails: SkiAreaDetails | null;
  enrichedRuns: EnrichedRunData[];
  enrichedLifts: EnrichedLiftData[];
  resortStatus: ResortStatus | null;
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
  onUseCurrentLocation: () => void;
  isGettingCurrentLocation: boolean;
  currentLocality: string | null;
  onSelectRun: (run: RunData | EnrichedRunData) => void;
  onSelectLift: (lift: LiftData | EnrichedLiftData) => void;
  onSelectLocality: (locality: string) => void;
  onErrorClose: () => void;
  onWeatherLoad: (weather: WeatherData) => void;
  onRemoveFavourite: (runId: string) => void;
  onFakeLocationChange: (location: { lat: number; lng: number } | null) => void;
  onFakeLocationDropModeChange: (enabled: boolean) => void;
  statusDebug: StatusDebugInfo;
  mountainHome: MountainHome | null;
  onMountainHomeChange: (home: MountainHome | null) => void;
  onMaxOptimalityOpen: () => void;
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
          onUseCurrentLocation={onUseCurrentLocation}
          isGettingLocation={isGettingCurrentLocation}
          currentLocation={{
            country: selectedArea?.country || undefined,
            region: selectedArea?.name || undefined,
            locality: currentLocality || undefined,
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
              initialWeather={weather}
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
              runs={enrichedRuns}
              lifts={enrichedLifts}
              localities={skiAreaDetails.localities}
              resortStatus={resortStatus}
              onSelectRun={onSelectRun}
              onSelectLift={onSelectLift}
              onSelectLocality={onSelectLocality}
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

            {/* Clear Mountain Home */}
            {mountainHome && (
              <button
                onClick={() => {
                  try {
                    localStorage.removeItem('ski-shade-mountain-home');
                  } catch {
                    // Ignore storage errors
                  }
                  onMountainHomeChange(null);
                }}
                className="flex items-center gap-1.5 py-1 px-2 rounded hover:bg-white/10 transition-colors text-left"
                style={{
                  fontSize: 10,
                  color: '#faad14',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <HomeOutlined style={{ fontSize: 10 }} />
                Clear Mountain Home
              </button>
            )}

            {/* Max Optimality - route planner for maximum run coverage */}
            <button
              onClick={onMaxOptimalityOpen}
              className="flex items-center gap-1.5 py-1 px-2 rounded hover:bg-white/10 transition-colors text-left"
              style={{
                fontSize: 10,
                color: '#faad14',
                background: 'transparent',
                border: '1px solid rgba(250, 173, 20, 0.3)',
                cursor: 'pointer',
              }}
            >
              <ThunderboltOutlined style={{ fontSize: 10 }} />
              Max Optimality
            </button>
            <span style={{ fontSize: 9, color: '#555', paddingLeft: 4 }}>
              Plan a route covering the most runs
            </span>

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

            {/* Status Debug Panel */}
            <div className="mt-3 pt-2 border-t border-white/10">
              <div style={{ fontSize: 9, color: '#888', marginBottom: 4 }}>STATUS DEBUG</div>
              <div style={{ fontSize: 8, color: '#666', fontFamily: 'monospace', lineHeight: 1.4 }}>
                <div>skiAreaId: {statusDebug.skiAreaId || 'null'}</div>
                <div>osmId: {statusDebug.osmId || 'null'}</div>
                <div>hasLiveStatus: {statusDebug.hasLiveStatus === null ? 'null' : statusDebug.hasLiveStatus ? 'true' : 'false'}</div>
                <div>fetchAttempted: {statusDebug.statusFetchAttempted ? 'true' : 'false'}</div>
                {statusDebug.statusFetchError && (
                  <div style={{ color: '#ff4d4f' }}>error: {statusDebug.statusFetchError}</div>
                )}
                {statusDebug.resortStatusData && (
                  <>
                    <div style={{ color: '#22c55e' }}>resortName: {statusDebug.resortStatusData.resortName}</div>
                    <div style={{ color: '#22c55e' }}>lifts: {statusDebug.resortStatusData.lifts}</div>
                    <div style={{ color: '#22c55e' }}>runs: {statusDebug.resortStatusData.runs}</div>
                  </>
                )}
                {statusDebug.lastFetchTime && (
                  <div>lastFetch: {new Date(statusDebug.lastFetchTime).toLocaleTimeString()}</div>
                )}
              </div>
            </div>
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
  const [mapBearing, setMapBearing] = useState(0);
  const [loading, setLoading] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsLoadProgress, setRunsLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [dataSource, setDataSource] = useState<'bundle' | 'cache' | 'network' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [highlightedFeatureId, setHighlightedFeatureId] = useState<string | null>(null);
  const [highlightedFeatureType, setHighlightedFeatureType] = useState<'run' | 'lift' | null>(null);
  const [selectedRunDetail, setSelectedRunDetail] = useState<{ runId: string; lngLat: { lng: number; lat: number } } | null>(null);
  const [selectedLiftDetail, setSelectedLiftDetail] = useState<{ liftId: string; lngLat: { lng: number; lat: number } } | null>(null);
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
  const [isGettingCurrentLocation, setIsGettingCurrentLocation] = useState(false);
  const mapRef = useRef<MapRef | null>(null);
  const previousSkiAreaIdRef = useRef<string | null>(null);
  
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

  // Live lift/run status
  const [resortStatus, setResortStatus] = useState<ResortStatus | null>(null);
  const [hasStatusData, setHasStatusData] = useState(false);
  const statusSummary = useMemo(() => getResortStatusSummary(resortStatus), [resortStatus]);

  // Status debug info
  const [statusDebug, setStatusDebug] = useState<StatusDebugInfo>({
    skiAreaId: null,
    osmId: null,
    hasLiveStatus: null,
    statusFetchAttempted: false,
    statusFetchError: null,
    resortStatusData: null,
    lastFetchTime: null,
  });
  const [navReturnPoint, setNavReturnPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [isWeatherCardCollapsed, setIsWeatherCardCollapsed] = useState(false);
  const [isNavPanelMinimized, setIsNavPanelMinimized] = useState(false);
  
  // Location/locality tracking
  const [currentLocality, setCurrentLocality] = useState<string | null>(null);
  const [zoomToLocality, setZoomToLocality] = useState<{ locality: string; lat: number; lng: number } | null>(null);

  // Allow showing map without a selected ski area (e.g., when using current location with no nearby resorts)
  const [showMapWithoutArea, setShowMapWithoutArea] = useState(false);

  // Interstitial warning when no ski areas within 50km of current location
  const [showNoNearbyResortsWarning, setShowNoNearbyResortsWarning] = useState(false);
  const [pendingLocationForWarning, setPendingLocationForWarning] = useState<{ lat: number; lng: number } | null>(null);

  // Points of Interest (toilets, restaurants, viewpoints)
  const [pois, setPois] = useState<POIData[]>([]);

  // Max Optimality feature state
  const [isMaxOptimalityOpen, setIsMaxOptimalityOpen] = useState(false);
  const [maxOptimalityPlan, setMaxOptimalityPlan] = useState<MaxOptimalityPlan | null>(null);
  
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

  // Resort messages (closures, alerts from live status)
  const {
    allMessages,
    unreadMessages,
    readMessages,
    unreadCount,
    acknowledgeMessage,
    acknowledgeAllMessages,
  } = useResortMessages(skiAreaDetails?.id || null, resortStatus);

  // Planning Mode (desktop only)
  const isDesktop = useIsDesktop();
  const {
    planningMode,
    togglePlanningMode,
    setFilters: setPlanningModeFilters,
    setShadowSettings: setPlanningModeShadowSettings,
    disablePlanningMode,
  } = usePlanningMode();
  const [yesterdayStatus, setYesterdayStatus] = useState<YesterdayStatusResponse | null>(null);
  const [isLoadingYesterday, setIsLoadingYesterday] = useState(false);

  // Fetch yesterday's open status when planning mode is enabled and filter is on
  useEffect(() => {
    if (!planningMode.enabled || !skiAreaDetails?.osmId) {
      return;
    }

    // Always fetch when planning mode is enabled (we need to know if data exists)
    setIsLoadingYesterday(true);
    fetch(`/api/planning/yesterday-status?osmId=${skiAreaDetails.osmId}`)
      .then((res) => res.json())
      .then((data: YesterdayStatusResponse) => {
        setYesterdayStatus(data);
      })
      .catch((err) => {
        console.error('[PlanningMode] Failed to fetch yesterday status:', err);
        setYesterdayStatus({ hasData: false, date: '', openRuns: [], openLifts: [] });
      })
      .finally(() => {
        setIsLoadingYesterday(false);
      });
  }, [planningMode.enabled, skiAreaDetails?.osmId]);

  // Create a set of yesterday's open run names for filtering
  const yesterdayOpenRunsSet = useMemo(() => {
    if (!yesterdayStatus?.openRuns) return undefined;
    return new Set(yesterdayStatus.openRuns.map((name) => name.toLowerCase()));
  }, [yesterdayStatus?.openRuns]);

  // Create a set of yesterday's open lift names for filtering
  const yesterdayOpenLiftsSet = useMemo(() => {
    if (!yesterdayStatus?.openLifts) return undefined;
    return new Set(yesterdayStatus.openLifts.map((name) => name.toLowerCase()));
  }, [yesterdayStatus?.openLifts]);

  // Register service worker and clear expired cache
  useEffect(() => {
    registerServiceWorker();
    // Clean up expired cache entries on app start
    clearExpiredCache().catch(console.error);
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

  // Update selected time to resort's local timezone when a new resort is loaded
  // This ensures the time slider shows the correct local time at the resort
  const previousResortIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!skiAreaDetails?.id || !skiAreaDetails.latitude || !skiAreaDetails.longitude) return;

    // Only update when switching to a different resort
    if (previousResortIdRef.current === skiAreaDetails.id) return;
    previousResortIdRef.current = skiAreaDetails.id;

    // Get current time in the resort's local timezone
    const now = new Date();
    const resortLocalNow = getResortLocalTime(now, skiAreaDetails.latitude, skiAreaDetails.longitude);

    // Create a new Date that represents the same "wall clock time" as the resort's local time
    // This makes the time slider show the correct time at the resort
    const adjustedTime = new Date();
    adjustedTime.setHours(resortLocalNow.getHours(), resortLocalNow.getMinutes(), 0, 0);

    setSelectedTime(adjustedTime);
  }, [skiAreaDetails?.id, skiAreaDetails?.latitude, skiAreaDetails?.longitude]);

  // Fetch live lift/run status when ski area is loaded
  useEffect(() => {
    if (!skiAreaDetails?.id) {
      setResortStatus(null);
      setHasStatusData(false);
      setStatusDebug({
        skiAreaId: null,
        osmId: null,
        hasLiveStatus: null,
        statusFetchAttempted: false,
        statusFetchError: null,
        resortStatusData: null,
        lastFetchTime: null,
      });
      return;
    }

    const fetchStatus = async () => {
      // Update debug info
      setStatusDebug(prev => ({
        ...prev,
        skiAreaId: skiAreaDetails.id,
        osmId: skiAreaDetails.osmId,
        statusFetchAttempted: true,
        statusFetchError: null,
        lastFetchTime: new Date().toISOString(),
      }));

      // Need osmId to fetch status
      if (!skiAreaDetails.osmId) {
        setHasStatusData(false);
        setStatusDebug(prev => ({
          ...prev,
          hasLiveStatus: false,
          statusFetchError: 'No osmId available for this ski area',
        }));
        return;
      }

      try {
        // Check if this resort has live status data available
        const hasStatus = await hasLiveStatus(skiAreaDetails.osmId);
        setHasStatusData(hasStatus);
        setStatusDebug(prev => ({
          ...prev,
          hasLiveStatus: hasStatus,
        }));

        if (hasStatus) {
          const status = await fetchResortStatus(skiAreaDetails.osmId);
          setResortStatus(status);
          setStatusDebug(prev => ({
            ...prev,
            resortStatusData: status ? {
              lifts: status.lifts?.length || 0,
              runs: status.runs?.length || 0,
              resortName: status.resort?.name || null,
            } : null,
          }));
        } else {
          setStatusDebug(prev => ({
            ...prev,
            statusFetchError: 'Resort not in supported list',
          }));
        }
      } catch (error) {
        console.error('Failed to fetch resort status:', error);
        setHasStatusData(false);
        setStatusDebug(prev => ({
          ...prev,
          statusFetchError: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
    };

    fetchStatus();

    // Refresh status every 5 minutes
    const interval = setInterval(fetchStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [skiAreaDetails?.id, skiAreaDetails?.osmId]);

  // Resort coordinates for timezone-aware closing time calculations
  const resortCoordinates = useMemo(() => {
    if (!skiAreaDetails) return undefined;
    return {
      latitude: skiAreaDetails.latitude,
      longitude: skiAreaDetails.longitude
    };
  }, [skiAreaDetails?.latitude, skiAreaDetails?.longitude]);

  // Enrich runs and lifts with live status
  const enrichedRuns = useMemo(() => {
    if (!skiAreaDetails?.runs) return [];
    return enrichRunsWithStatus(skiAreaDetails.runs, resortStatus, selectedTime, resortCoordinates);
  }, [skiAreaDetails?.runs, resortStatus, selectedTime, resortCoordinates]);

  const enrichedLifts = useMemo(() => {
    if (!skiAreaDetails?.lifts) return [];
    return enrichLiftsWithStatus(skiAreaDetails.lifts, resortStatus, selectedTime, resortCoordinates);
  }, [skiAreaDetails?.lifts, resortStatus, selectedTime, resortCoordinates]);

  // Create enriched ski area details for map display
  const enrichedSkiAreaDetails = useMemo(() => {
    if (!skiAreaDetails) return null;
    return {
      ...skiAreaDetails,
      runs: enrichedRuns,
      lifts: enrichedLifts,
    };
  }, [skiAreaDetails, enrichedRuns, enrichedLifts]);

  useEffect(() => {
    if (!selectedArea) {
      setSkiAreaDetails(null);
      setWeather(null);
      setWeatherLoading(false);
      setRunsLoading(false);
      setRunsLoadProgress(null);
      setResortStatus(null);
      setHasStatusData(false);
      return;
    }

    // Optimized loading strategy:
    // 1. Try static bundle first (/data/resorts/{id}.json) - 20-50ms if bundled
    // 2. Fall back to IndexedDB cache (7d geometry, 5min status) - 10-30ms if cached
    // 3. Fall back to parallel network fetch (info + runs + lifts) - 300-400ms
    // 4. Weather loads in parallel independently
    // 5. Progressive rendering only for network fetches (instant for bundles/cache)

    // Only show full loading overlay on initial load (no resort loaded before)
    // When switching resorts, the map is already showing so we just use progressive loading
    const isInitialLoad = previousSkiAreaIdRef.current === null;
    const isSwitchingResorts = previousSkiAreaIdRef.current !== null && previousSkiAreaIdRef.current !== selectedArea.id;

    // Update the ref to track this resort
    previousSkiAreaIdRef.current = selectedArea.id;

    if (isInitialLoad) {
      setLoading(true);
    } else if (isSwitchingResorts) {
      // Switching resorts: clear old runs/lifts immediately but keep map visible
      // This prevents old runs from showing at the new location
      setSkiAreaDetails(prev => prev ? { ...prev, runs: [], lifts: [] } : null);
    }
    setWeatherLoading(true);
    setRunsLoading(true);
    setRunsLoadProgress(null);
    setError(null);

    // AbortController for cleanup
    const abortController = new AbortController();
    const signal = abortController.signal;

    // Helper to progressively add runs/lifts in batches
    const progressivelyAddData = (
      allRuns: RunData[],
      allLifts: LiftData[],
      basicInfo: SkiAreaDetails
    ) => {
      const totalRuns = allRuns.length;
      const totalLifts = allLifts.length;

      // Sort runs and lifts by distance from center (closest first)
      const centerLat = selectedArea.latitude;
      const centerLng = selectedArea.longitude;
      const sortedRuns = sortRunsByDistanceFromCenter(allRuns, centerLat, centerLng);
      const sortedLifts = sortLiftsByDistanceFromCenter(allLifts, centerLat, centerLng);

      // Progressive rendering: add runs/lifts in batches
      const BATCH_SIZE = 30;
      const BATCH_DELAY = 16;
      let runIndex = 0;
      let liftIndex = 0;

      const addNextBatch = () => {
        if (signal.aborted) return;

        const runsToAdd = sortedRuns.slice(runIndex, runIndex + BATCH_SIZE);
        const liftsToAdd = sortedLifts.slice(liftIndex, liftIndex + Math.ceil(BATCH_SIZE / 3));

        runIndex += BATCH_SIZE;
        liftIndex += Math.ceil(BATCH_SIZE / 3);

        setSkiAreaDetails(prev => {
          if (!prev) return null;
          return {
            ...prev,
            runs: [...prev.runs, ...runsToAdd],
            lifts: [...prev.lifts, ...liftsToAdd],
          };
        });

        setRunsLoadProgress({ loaded: Math.min(runIndex, totalRuns), total: totalRuns });

        if (runIndex < totalRuns || liftIndex < totalLifts) {
          setTimeout(addNextBatch, BATCH_DELAY);
        } else {
          setRunsLoading(false);
        }
      };

      addNextBatch();
    };

    // Helper to fetch and apply status data
    const fetchAndApplyStatus = async (osmId: string) => {
      if (!osmId) return;

      try {
        const hasStatus = await hasLiveStatus(osmId);
        setHasStatusData(hasStatus);

        if (hasStatus) {
          const status = await fetchResortStatus(osmId);
          if (!signal.aborted) {
            setResortStatus(status);
            console.log(`[Status] Fetched live status for osmId: ${osmId}`);
          }
        }
      } catch (error) {
        console.error('[Status] Failed to fetch status:', error);
      }
    };

    // Optimized loading with bundle-first strategy
    const loadData = async () => {
      // TIER 1: Try static bundle first (fastest - 20-50ms if bundled)
      try {
        const bundlePath = `/data/resorts/${selectedArea.id}.json`;
        const bundleRes = await fetch(bundlePath, { signal });

        if (bundleRes.ok && !signal.aborted) {
          const bundle = await bundleRes.json();
          console.log(`[Bundle] Using pre-generated bundle for ${bundle.name}`);

          // Construct SkiAreaDetails from bundle
          const basicInfo: SkiAreaDetails = {
            id: bundle.id,
            osmId: bundle.osmId || null,
            name: bundle.name,
            country: bundle.country || null,
            region: bundle.region || null,
            latitude: bundle.latitude,
            longitude: bundle.longitude,
            bounds: bundle.bounds || null,
            geometry: bundle.geometry || null,
            properties: bundle.properties || null,
            localities: bundle.localities || [],
            runs: [],
            lifts: [],
          };

          // Fetch status in parallel BEFORE setting skiAreaDetails
          // This ensures enrichment happens on first render
          if (bundle.osmId) {
            await fetchAndApplyStatus(bundle.osmId);
          }

          if (signal.aborted) return;

          // Set data - enrichment will now include fresh status
          setSkiAreaDetails({ ...basicInfo, runs: bundle.runs, lifts: bundle.lifts });
          setDataSource('bundle');

          if (!selectedArea.name && basicInfo.name) {
            setSelectedArea(prev => prev ? { ...prev, name: basicInfo.name } : prev);
          }

          setLoading(false);
          setRunsLoading(false); // Instant - no progressive loading needed
          setRunsLoadProgress(null);

          // Background: Fetch fresh weather (changes frequently)
          fetchWeatherData();

          // Cache the bundle data to IndexedDB for offline support
          cacheSkiArea(selectedArea.id, bundle.runs, bundle.lifts, basicInfo).catch(console.error);

          return; // Exit - bundle loaded successfully
        }
      } catch (err) {
        // Bundle not found or fetch failed - continue to cache/network
        console.log(`[Bundle] No bundle found for ${selectedArea.id}, trying cache...`);
      }

      // TIER 2: Try IndexedDB cache (fast - 10-30ms if cached)
      try {
        const cached = await getCachedSkiArea(selectedArea.id);

        if (cached && !signal.aborted) {
          const cachedInfo = cached.info as Record<string, unknown>;

          // If cached data is missing osmId, clear cache and fetch fresh
          if (!cachedInfo.osmId) {
            console.log(`[Cache] Invalid cache (missing osmId), fetching fresh data for ${selectedArea.id}`);
            const { clearCachedSkiArea } = await import('@/lib/ski-area-cache');
            await clearCachedSkiArea(selectedArea.id).catch(console.error);
          } else {
            // Cache is valid - use it
            console.log(`[Cache] Using cached data for ${selectedArea.id}`);

            const allRuns = cached.runs as RunData[];
            const allLifts = cached.lifts as LiftData[];

            const basicInfo: SkiAreaDetails = {
              id: cachedInfo.id as string,
              osmId: (cachedInfo.osmId as string) || null,
              name: cachedInfo.name as string,
              country: (cachedInfo.country as string) || null,
              region: (cachedInfo.region as string) || null,
              latitude: cachedInfo.latitude as number,
              longitude: cachedInfo.longitude as number,
              bounds: (cachedInfo.bounds as SkiAreaDetails['bounds']) || null,
              geometry: (cachedInfo.geometry as SkiAreaDetails['geometry']) || null,
              properties: (cachedInfo.properties as SkiAreaDetails['properties']) || null,
              localities: (cachedInfo.localities as string[]) || [],
              runs: [],
              lifts: [],
            };

            // Fetch status BEFORE setting skiAreaDetails
            if (basicInfo.osmId) {
              await fetchAndApplyStatus(basicInfo.osmId);
            }

            if (signal.aborted) return;

            // Set data - enrichment will now include fresh status
            setSkiAreaDetails({ ...basicInfo, runs: allRuns, lifts: allLifts });
            setDataSource('cache');

            if (!selectedArea.name && basicInfo.name) {
              setSelectedArea(prev => prev ? { ...prev, name: basicInfo.name } : prev);
            }

            setLoading(false);
            setRunsLoading(false); // Instant - no progressive loading
            setRunsLoadProgress(null);

            // Fetch weather fresh
            fetchWeatherData();
            return; // Exit - cache was valid
          }
        }
      } catch (err) {
        console.error('[Cache] Failed to check cache:', err);
      }

      // TIER 3: Fetch from network (slowest - 300-500ms)
      fetchFromNetwork();
    };

    const fetchBasicInfo = async () => {
      // Add cache-buster to bypass CDN cache (v2 = added osmId)
      const res = await fetch(`/api/ski-areas/${selectedArea.id}/info?v=2`, { signal });
      if (!res.ok) throw new Error('Failed to load ski area');
      return res.json();
    };

    const fetchRuns = async () => {
      const res = await fetch(`/api/ski-areas/${selectedArea.id}/runs?includeConnected=true`, { signal });
      if (!res.ok) throw new Error('Failed to load runs');
      return res.json();
    };

    const fetchLifts = async () => {
      const res = await fetch(`/api/ski-areas/${selectedArea.id}/lifts?includeConnected=true`, { signal });
      if (!res.ok) throw new Error('Failed to load lifts');
      return res.json();
    };

    const fetchWeatherData = async () => {
      try {
        const res = await fetch(`/api/weather?lat=${selectedArea.latitude}&lng=${selectedArea.longitude}`, { signal });
        if (!res.ok) throw new Error('Failed to fetch weather');
        const weatherData = await res.json();
        if (!signal.aborted && weatherData) {
          setWeather(weatherData);
        }
      } catch {
        // Weather errors are non-critical
      } finally {
        if (!signal.aborted) {
          setWeatherLoading(false);
        }
      }
    };

    const fetchFromNetwork = async () => {
      console.log(`[Network] Fetching all data in parallel for ${selectedArea.id}`);
      setDataSource('network');

      // Fetch info, runs, lifts, AND weather ALL in parallel (one round-trip)
      try {
        const [rawInfo, runsData, liftsData] = await Promise.all([
          fetchBasicInfo().catch((err) => {
            console.error('Failed to load basic info:', err);
            return null;
          }),
          fetchRuns().catch((err) => {
            if (!signal.aborted) console.error('Failed to load runs:', err);
            return { runs: [] };
          }),
          fetchLifts().catch((err) => {
            if (!signal.aborted) console.error('Failed to load lifts:', err);
            return { lifts: [] };
          }),
        ]);

        if (signal.aborted) return;

        // Handle complete failure (all APIs failed)
        if (!rawInfo && (!runsData || runsData.runs.length === 0)) {
          setError('Failed to load ski area data');
          setLoading(false);
          setRunsLoading(false);
          return;
        }

        // Use info if available, otherwise infer from first run
        let basicInfo: SkiAreaDetails;

        if (rawInfo) {
          console.log(`[Network] Fetched ski area info for ${rawInfo.id}`, {
            hasOsmId: !!rawInfo.osmId,
            osmId: rawInfo.osmId,
            name: rawInfo.name,
          });

          basicInfo = {
            id: rawInfo.id as string,
            osmId: (rawInfo.osmId as string) || null,
            name: rawInfo.name as string,
            country: (rawInfo.country as string) || null,
            region: (rawInfo.region as string) || null,
            latitude: rawInfo.latitude as number,
            longitude: rawInfo.longitude as number,
            bounds: (rawInfo.bounds as SkiAreaDetails['bounds']) || null,
            geometry: (rawInfo.geometry as SkiAreaDetails['geometry']) || null,
            properties: (rawInfo.properties as SkiAreaDetails['properties']) || null,
            localities: (rawInfo.localities as string[]) || [],
            runs: [],
            lifts: [],
          };
        } else {
          // Fallback: infer basic info from runs/lifts (if info API failed)
          const allRuns = runsData?.runs || [];
          const firstRun = allRuns[0];

          basicInfo = {
            id: selectedArea.id,
            osmId: null,
            name: selectedArea.name || 'Unknown Resort',
            country: null,
            region: null,
            latitude: selectedArea.latitude,
            longitude: selectedArea.longitude,
            bounds: null,
            geometry: null,
            properties: null,
            localities: [],
            runs: [],
            lifts: [],
          };
          console.log(`[Network] Using fallback basic info (info API failed)`);
        }

        // Set basic info immediately
        setSkiAreaDetails(basicInfo);

        if (!selectedArea.name && basicInfo.name) {
          setSelectedArea(prev => prev ? { ...prev, name: basicInfo.name } : prev);
        }

        setLoading(false);

        const allRuns = runsData?.runs || [];
        const allLifts = liftsData?.lifts || [];

        // Show progress indicator while progressive rendering
        if (allRuns.length > 0) {
          setRunsLoadProgress({ loaded: 0, total: allRuns.length });
        }

        // Cache the data for next time (24hr TTL)
        if (allRuns.length > 0) {
          cacheSkiArea(selectedArea.id, allRuns, allLifts, basicInfo).catch(console.error);
          console.log(`[Cache] Cached data for ${selectedArea.id}`);
        }

        // Progressively add to UI (only for network fetches)
        progressivelyAddData(allRuns, allLifts, basicInfo);

        // Weather loads in parallel (already started)
        fetchWeatherData();
      } catch (err) {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load ski area');
        setLoading(false);
        setRunsLoading(false);
      }
    };

    // Start loading data (cache first, then network)
    loadData();

    return () => {
      abortController.abort();
    };
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
    // Clear any previous initialMapView so the map doesn't fly back to old location
    // when ski area changes trigger the map initialization effect
    setInitialMapView(null);

    // INSTANT: Fly to the location IMMEDIATELY before any API calls
    // This gives instant visual feedback while data loads in the background
    if (location.latitude && location.longitude) {
      const targetZoom = location.zoomToLocality ? 14 : 13;
      mapRef.current?.flyTo(location.latitude, location.longitude, targetZoom);
    }

    // Set the selected area (this will trigger data loading in the background)
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

    // If a locality was selected, set the locality (no need to zoom again - already done)
    if (location.zoomToLocality && location.locality) {
      setCurrentLocality(location.locality);
      // Clear any pending zoom since we already flew there
      setZoomToLocality(null);
    } else {
      setZoomToLocality(null);
      setCurrentLocality(null);
    }

    trackEvent('location_selected', {
      ski_area_id: location.skiAreaId,
      ski_area_name: location.skiAreaName,
      locality: location.locality,
      country: location.country,
    });
  }, []);

  // Handle zoom to locality after ski area data is loaded
  useEffect(() => {
    if (zoomToLocality && skiAreaDetails) {
      // Zoom to the locality with a slight delay to ensure map is ready
      setTimeout(() => {
        mapRef.current?.flyTo(zoomToLocality.lat, zoomToLocality.lng, 14);
        setZoomToLocality(null);
      }, 500);
    }
  }, [zoomToLocality, skiAreaDetails]);

  // Navigate to region (zoom out to see whole area)
  const handleNavigateToRegion = useCallback(() => {
    if (skiAreaDetails) {
      mapRef.current?.flyTo(skiAreaDetails.latitude, skiAreaDetails.longitude, 12);
      setCurrentLocality(null);
    }
  }, [skiAreaDetails]);

  // Select a locality (just sets the current locality, doesn't zoom since localities don't have centroids)
  const handleSelectLocality = useCallback((locality: string) => {
    setCurrentLocality(locality);
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
    setSelectedLiftDetail(null);
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

  // Simple view change handler - no API calls on map move
  // Ski area is selected via search or current location only
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

  // Map control handlers
  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut();
  }, []);

  const handleResetBearing = useCallback(() => {
    mapRef.current?.resetBearing();
  }, []);

  // Track map bearing changes
  useEffect(() => {
    if (!mapRef.current) return;

    const updateBearing = () => {
      const bearing = mapRef.current?.getBearing() ?? 0;
      setMapBearing(bearing);
    };

    mapRef.current.on('rotate', updateBearing);

    return () => {
      mapRef.current?.off('rotate', updateBearing);
    };
  }, [skiAreaDetails]); // Re-subscribe when ski area changes (map recreated)

  // Helper to calculate distance in km between two points using Haversine formula
  const calculateDistanceKm = useCallback((lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }, []);

  // Handler for "Use Current Location" in location search
  const handleUseCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      return;
    }

    setIsGettingCurrentLocation(true);
    trackEvent('current_location_requested', { source: 'location_search' });

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;

        trackEvent('current_location_granted', {
          latitude,
          longitude,
          accuracy,
          source: 'location_search',
        });

        // Update user location state
        const location: UserLocation = {
          latitude,
          longitude,
          accuracy,
          timestamp: position.timestamp,
        };
        setUserLocation(location);
        setIsTrackingLocation(true);

        // Set initial map view so the map starts at the user's location
        const targetZoom = 11;
        setInitialMapView({ lat: latitude, lng: longitude, zoom: targetZoom });

        // Search for ski areas within ~50km (0.45 degrees is roughly 50km)
        const searchRadiusDeg = 0.5; // Slightly larger to catch edge cases
        const minLat = latitude - searchRadiusDeg;
        const maxLat = latitude + searchRadiusDeg;
        const minLng = longitude - searchRadiusDeg / Math.cos(latitude * Math.PI / 180);
        const maxLng = longitude + searchRadiusDeg / Math.cos(latitude * Math.PI / 180);

        try {
          const params = new URLSearchParams({
            minLat: minLat.toString(),
            maxLat: maxLat.toString(),
            minLng: minLng.toString(),
            maxLng: maxLng.toString(),
            limit: '20',
          });

          const res = await fetch(`/api/ski-areas?${params}`);
          if (res.ok) {
            const data = await res.json();
            const areas = data.areas as SkiAreaSummary[];

            // Find the nearest ski area and calculate actual distance
            let nearest: SkiAreaSummary | null = null;
            let nearestDistKm = Infinity;
            for (const area of areas) {
              const distKm = calculateDistanceKm(latitude, longitude, area.latitude, area.longitude);
              if (distKm < nearestDistKm) {
                nearestDistKm = distKm;
                nearest = area;
              }
            }

            // Check if nearest ski area is within 50km
            if (nearest && nearestDistKm <= 50) {
              trackEvent('ski_area_auto_loaded', {
                ski_area_id: nearest.id,
                ski_area_name: nearest.name,
                source: 'current_location',
                distance_km: nearestDistKm,
              });

              // Set initial map view to the SKI AREA location (not user's location)
              // This ensures the map opens centered on the resort
              setInitialMapView({ lat: nearest.latitude, lng: nearest.longitude, zoom: 13 });

              // This will dismiss onboarding and render the map at the ski area location
              setSelectedArea(nearest);
              setShowMapWithoutArea(true);
              setIsGettingCurrentLocation(false);
              setMobileMenuOpen(false);
              return;
            }
          }
        } catch (error) {
          console.error('Failed to load ski areas near current location:', error);
        }

        // No ski areas within 50km - show warning interstitial
        trackEvent('no_nearby_resorts_warning', {
          latitude,
          longitude,
        });
        setPendingLocationForWarning({ lat: latitude, lng: longitude });
        setShowNoNearbyResortsWarning(true);
        setIsGettingCurrentLocation(false);
      },
      (error) => {
        setIsGettingCurrentLocation(false);
        trackEvent('current_location_denied', {
          error_code: error.code,
          error_message: error.message,
          source: 'location_search',
        });

        switch (error.code) {
          case error.PERMISSION_DENIED:
            setError('Location permission denied');
            break;
          case error.POSITION_UNAVAILABLE:
            setError('Location information unavailable');
            break;
          case error.TIMEOUT:
            setError('Location request timed out');
            break;
          default:
            setError('Unable to get your location');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  }, [calculateDistanceKm]);

  // Handler for confirming to navigate to map outside ski areas
  const handleConfirmNoNearbyResorts = useCallback(() => {
    if (!pendingLocationForWarning) return;

    trackEvent('no_nearby_resorts_confirmed', {
      latitude: pendingLocationForWarning.lat,
      longitude: pendingLocationForWarning.lng,
    });

    const targetZoom = 11;
    setInitialMapView({ lat: pendingLocationForWarning.lat, lng: pendingLocationForWarning.lng, zoom: targetZoom });

    // If map exists, fly to the location
    if (mapRef.current) {
      mapRef.current.flyTo(pendingLocationForWarning.lat, pendingLocationForWarning.lng, targetZoom);
    }

    // Show the map without a ski area selected
    setShowMapWithoutArea(true);
    setShowNoNearbyResortsWarning(false);
    setPendingLocationForWarning(null);
    setMobileMenuOpen(false);
  }, [pendingLocationForWarning]);

  // Handler to cancel the no nearby resorts warning
  const handleCancelNoNearbyResorts = useCallback(() => {
    setShowNoNearbyResortsWarning(false);
    setPendingLocationForWarning(null);
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

  // Memoize navigation graph - expensive to build, only rebuild when ski area changes
  const navigationGraph = useMemo<NavigationGraph | null>(() => {
    if (!skiAreaDetails) return null;
    return buildNavigationGraph(skiAreaDetails);
  }, [skiAreaDetails]);

  // Helper: Find toilet with shortest route (optimized approach)
  // Uses memoized navigation graph for much better performance
  const findNearestToilet = useCallback((fromLat: number, fromLng: number) => {
    if (!skiAreaDetails || !navigationGraph) return null;
    
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
    
    // Step 2: Use memoized navigation graph (no rebuild needed!)
    const startNode = findNearestNode(navigationGraph, fromLat, fromLng);
    if (!startNode) {
      // Fallback to geographically closest
      return closeToilets[0].toilet;
    }
    
    // Step 3: Calculate actual routes to only the 10 closest toilets
    // Use addPoiNodeToGraph to create proper walking connections to each toilet
    let nearestToilet = closeToilets[0].toilet;
    let shortestRouteTime = Infinity;
    
    for (const { toilet } of closeToilets) {
      // Add the toilet as a POI node with generous walking connections
      const toiletNodeId = addPoiNodeToGraph(
        navigationGraph, 
        toilet.id, 
        toilet.latitude, 
        toilet.longitude, 
        toilet.name || 'Toilet'
      );
      
      const route = findRoute(navigationGraph, startNode.id, toiletNodeId);
      
      if (route && route.totalTime < shortestRouteTime) {
        shortestRouteTime = route.totalTime;
        nearestToilet = toilet;
      }
    }
    
    return nearestToilet;
  }, [pois, skiAreaDetails, navigationGraph]);

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
      setNavMapClickMode(null); // Clear map click mode banner
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
      // No user location - open navigation with "Closest Toilet" pre-filled as destination
      // User will need to pick their location on map first
      const closestToiletDestination: SelectedPoint = {
        type: 'closestToilet',
        id: 'closest-toilet',
        name: 'Closest Toilet',
      };
      
      setExternalNavDestination(closestToiletDestination);
      setIsNavigationOpen(true);
      setIsWeatherCardCollapsed(true);
      // Request map click for origin (start location)
      setNavMapClickMode('origin');
      
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

  // Handle lift click for navigation destination or showing detail overlay
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

    // Show lift detail overlay
    trackEvent('lift_detail_viewed', {
      lift_id: liftId,
      ski_area_id: selectedArea?.id,
    });
    setSelectedLiftDetail({ liftId, lngLat });
    // Close run detail if open
    setSelectedRunDetail(null);
  }, [navMapClickMode, isNavigationOpen, skiAreaDetails, selectedArea]);

  // Close lift detail overlay
  const handleCloseLiftDetail = useCallback(() => {
    setSelectedLiftDetail(null);
  }, []);

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

  // Note: Localities don't have centroids, so we don't auto-detect the current locality
  // The currentLocality is set when the user explicitly selects one from the UI

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

  // Cache key for snow quality - only recalculate when hour/date changes, not every minute
  // Snow quality doesn't meaningfully change minute-to-minute, only hour-to-hour
  const snowQualityCacheKey = useMemo(() => {
    if (!deferredTime) return '';
    return `${deferredTime.getFullYear()}-${deferredTime.getMonth()}-${deferredTime.getDate()}-${deferredTime.getHours()}`;
  }, [deferredTime]);

  // Calculate snow quality for all runs (only recalculates when hour changes)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skiAreaDetails?.id, weather, snowQualityCacheKey]);

  // Format snow analyses for the map component
  const snowAnalysesForMap = useMemo(() => {
    return snowQuality.analyses.map(a => ({
      runId: a.runId,
      score: a.quality.score,
      condition: a.quality.condition,
      conditionLabel: getConditionInfo(a.quality.condition).label,
    }));
  }, [snowQuality.analyses]);

  // Calculate snow quality by altitude for favourite runs and selected run
  // Only recalculates when hour changes (not every slider tick)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skiAreaDetails?.id, weather, snowQualityCacheKey, favourites, selectedRunDetail?.runId]);

  // Calculate analysis and stats for the selected run overlay
  const selectedRunData = useMemo(() => {
    if (!selectedRunDetail?.runId || !skiAreaDetails) return null;

    // Use enrichedRuns to get status information
    const run = enrichedRuns.find(r => r.id === selectedRunDetail.runId);
    if (!run) return null;

    const analyses = analyzeRuns([run], selectedTime, skiAreaDetails.latitude, skiAreaDetails.longitude, weather?.hourly);
    const analysis = analyses[0] || null;
    const stats = calculateRunStats(run);
    const isFavourite = favourites.some(f => f.id === run.id);

    // Calculate temperature data based on selected time
    let temperatureData: { temperature: number; stationAltitude: number } | undefined;
    if (weather?.hourly && weather.elevation) {
      const targetDateStr = format(selectedTime, 'yyyy-MM-dd');
      const targetHour = selectedTime.getHours();

      // Use string comparison to avoid timezone parsing issues
      // h.time format is "2024-12-23T10:00" from Open-Meteo API
      const hourlyMatch = weather.hourly.find(h => {
        const dateStr = h.time.slice(0, 10);
        const hourStr = h.time.slice(11, 13);
        return dateStr === targetDateStr && parseInt(hourStr, 10) === targetHour;
      });

      if (hourlyMatch) {
        temperatureData = {
          temperature: hourlyMatch.temperature,
          stationAltitude: weather.elevation,
        };
      }
    }

    return { run, analysis, stats, isFavourite, temperatureData };
  }, [selectedRunDetail?.runId, skiAreaDetails, enrichedRuns, selectedTime, weather?.hourly, weather?.elevation, favourites]);

  // Calculate data for the selected lift overlay
  const selectedLiftData = useMemo(() => {
    if (!selectedLiftDetail?.liftId || !skiAreaDetails) return null;

    // Use enrichedLifts to get status information
    const lift = enrichedLifts.find(l => l.id === selectedLiftDetail.liftId);
    if (!lift) return null;

    return { lift };
  }, [selectedLiftDetail?.liftId, skiAreaDetails, enrichedLifts]);

  // Don't render anything until initial state is loaded to prevent flicker
  if (!initialLoadDone) {
    return null;
  }

  // Show interstitial warning when no ski areas within 50km
  if (showNoNearbyResortsWarning) {
    return (
      <div className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'var(--background)' }}>
        <div className="max-w-md w-full text-center">
          <div style={{ marginBottom: 24 }}>
            <Logo size="lg" />
          </div>

          <div
            className="rounded-lg p-6"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border)'
            }}
          >
            <EnvironmentOutlined style={{ fontSize: 48, marginBottom: 16, color: '#666' }} />
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, color: 'var(--foreground)' }}>
              No ski areas nearby
            </h2>
            <p style={{ fontSize: 14, color: '#888', marginBottom: 24, lineHeight: 1.5 }}>
              There are no ski areas within 50km of your current location. You can still explore the map, but you won&apos;t see any ski runs or lifts until you navigate to a ski area.
            </p>

            <div className="flex flex-col gap-3">
              <Button
                type="primary"
                size="large"
                onClick={handleConfirmNoNearbyResorts}
                style={{ width: '100%' }}
              >
                Continue to map
              </Button>
              <Button
                type="default"
                size="large"
                onClick={handleCancelNoNearbyResorts}
                style={{ width: '100%' }}
              >
                Go back
              </Button>
            </div>
          </div>

          <p style={{ fontSize: 11, color: '#555', marginTop: 16 }}>
            You can search for ski areas using the search bar once on the map.
          </p>
        </div>
      </div>
    );
  }

  // Show onboarding for first-time users (no resort selected)
  // Skip onboarding if user used current location (showMapWithoutArea is true)
  if (initialLoadDone && !selectedArea && !showMapWithoutArea) {
    return (
      <Onboarding
        onSelectLocation={handleLocationSelect}
        onUseCurrentLocation={handleUseCurrentLocation}
        isGettingLocation={isGettingCurrentLocation}
      />
    );
  }

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
                  title={`${skiAreaDetails.country ? skiAreaDetails.country + ' · ' : ''}${skiAreaDetails.name}${currentLocality ? ' · ' + currentLocality : ''}`}
                >
                  {skiAreaDetails.country && (
                    <span style={{ color: '#666' }}>{skiAreaDetails.country} · </span>
                  )}
                  {skiAreaDetails.name}
                  {currentLocality && (
                    <span style={{ color: '#888' }}> · {currentLocality}</span>
                  )}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button 
              size="small"
              icon={<MenuOutlined style={{ fontSize: 12 }} />}
              onClick={() => setMobileMenuOpen(true)}
              style={{ width: 32, height: 32, minWidth: 32 }}
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
          enrichedRuns={enrichedRuns}
          enrichedLifts={enrichedLifts}
          resortStatus={resortStatus}
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
          onUseCurrentLocation={handleUseCurrentLocation}
          isGettingCurrentLocation={isGettingCurrentLocation}
          currentLocality={currentLocality}
          onSelectRun={handleSelectRun}
          onSelectLift={handleSelectLift}
          onSelectLocality={handleSelectLocality}
          onErrorClose={handleErrorClose}
          onWeatherLoad={handleWeatherLoad}
          onRemoveFavourite={removeFavourite}
          onFakeLocationChange={setFakeLocation}
          onFakeLocationDropModeChange={setIsFakeLocationDropMode}
          statusDebug={statusDebug}
          mountainHome={mountainHome}
          onMountainHomeChange={setMountainHome}
          onMaxOptimalityOpen={() => setIsMaxOptimalityOpen(true)}
        />
      </Drawer>

      {/* Desktop sidebar */}
      <div className="hidden md:flex md:flex-col controls-panel" style={{ marginTop: (isOffline || wasOffline) ? 44 : 0 }}>
        <ControlsContent
          selectedArea={selectedArea}
          skiAreaDetails={skiAreaDetails}
          enrichedRuns={enrichedRuns}
          enrichedLifts={enrichedLifts}
          resortStatus={resortStatus}
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
          onUseCurrentLocation={handleUseCurrentLocation}
          isGettingCurrentLocation={isGettingCurrentLocation}
          currentLocality={currentLocality}
          onSelectRun={handleSelectRun}
          onSelectLift={handleSelectLift}
          onSelectLocality={handleSelectLocality}
          onErrorClose={handleErrorClose}
          onWeatherLoad={handleWeatherLoad}
          onRemoveFavourite={removeFavourite}
          onFakeLocationChange={setFakeLocation}
          onFakeLocationDropModeChange={setIsFakeLocationDropMode}
          statusDebug={statusDebug}
          mountainHome={mountainHome}
          onMountainHomeChange={setMountainHome}
          onMaxOptimalityOpen={() => setIsMaxOptimalityOpen(true)}
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
          skiArea={enrichedSkiAreaDetails}
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
          planningMode={isDesktop ? planningMode : undefined}
          yesterdayOpenRuns={yesterdayOpenRunsSet}
          yesterdayOpenLifts={yesterdayOpenLiftsSet}
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

        {/* Lift detail overlay - shows when a lift is clicked */}
        {selectedLiftData && selectedLiftDetail && (
          <LiftDetailOverlay
            lift={selectedLiftData.lift}
            lngLat={selectedLiftDetail.lngLat}
            mapRef={mapRef}
            onClose={handleCloseLiftDetail}
          />
        )}

        {/* Search bar on map - desktop only */}
        {skiAreaDetails && (
          <div className="map-search-container hidden md:flex items-center gap-2">
            <SearchBar
              runs={skiAreaDetails.runs}
              lifts={skiAreaDetails.lifts}
              skiAreaLatitude={skiAreaDetails.latitude}
              skiAreaLongitude={skiAreaDetails.longitude}
              onSelectRun={handleSelectRun}
              onSelectLift={handleSelectLift}
              onSelectPlace={handleSelectPlace}
            />
            {isDesktop && (
              <PlanningModeButton
                enabled={planningMode.enabled}
                onToggle={togglePlanningMode}
              />
            )}
          </div>
        )}

        {/* Planning Mode Panel - desktop only, shown when planning mode is enabled */}
        {isDesktop && planningMode.enabled && skiAreaDetails && (
          <PlanningModePanel
            planningMode={planningMode}
            onFiltersChange={setPlanningModeFilters}
            onShadowSettingsChange={setPlanningModeShadowSettings}
            yesterdayStatus={yesterdayStatus}
            isLoadingYesterday={isLoadingYesterday}
            onClose={disablePlanningMode}
          />
        )}


        {/* Map controls - zoom, compass, 3D/2D, location, navigation */}
        <div className="map-controls-container">
          {/* Zoom and view controls */}
          <MapControls
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onResetBearing={handleResetBearing}
            bearing={mapBearing}
            is3D={is3D}
            onToggle3D={setIs3D}
          />

          {/* Location controls */}
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

          {/* Message inbox - only shown for resorts with live status */}
          <div className="location-controls">
            <MessageInbox
              allMessages={allMessages}
              unreadMessages={unreadMessages}
              readMessages={readMessages}
              unreadCount={unreadCount}
              onAcknowledge={acknowledgeMessage}
              onAcknowledgeAll={acknowledgeAllMessages}
              skiAreaName={skiAreaDetails?.name || null}
              hasLiveStatus={statusDebug.hasLiveStatus === true}
            />
          </div>

          {/* Navigation button */}
          {skiAreaDetails && !isNavigationOpen && (
            <div style={{ pointerEvents: 'auto' }}>
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
                disabled={false}
              />
            </div>
          )}
        </div>

        {/* Legend and action buttons - hide legend when planning mode is active */}
        <div className="legend-container hidden md:flex md:items-start md:gap-3">
          {!planningMode.enabled && <Legend />}
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


        {/* Time slider with optional navigation panel and instruction bar above it */}
        <div className="time-slider-container">
          {/* Navigation panel - shown as card above weather when route planning */}
          {enrichedSkiAreaDetails && isNavigationOpen && (
            <div className="nav-panel-inline">
              <NavigationPanel
                skiArea={enrichedSkiAreaDetails}
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
                prebuiltGraph={navigationGraph}
                findNearestToilet={findNearestToilet}
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

      {/* Max Optimality Modal */}
      <MaxOptimality
        isOpen={isMaxOptimalityOpen}
        onClose={() => setIsMaxOptimalityOpen(false)}
        onPlanComplete={(plan, route) => {
          setMaxOptimalityPlan(plan);
          if (route) {
            setNavigationRoute(route);
          }
          setIsMaxOptimalityOpen(false);
        }}
        mountainHome={mountainHome}
      />

    </div>
  );
}

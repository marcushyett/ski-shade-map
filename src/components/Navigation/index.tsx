'use client';

import { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import { CompassOutlined, CloseOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { trackEvent } from '@/lib/posthog';
import LoadingSpinner from '../LoadingSpinner';
import type { SkiAreaDetails, POIData } from '@/lib/types';
import {
  buildNavigationGraph,
  findRoute,
  findRouteWithDiagnostics,
  findNearestNode,
  findAlternativeRoutes,
  optimizeRoute,
  formatDuration,
  formatDistance,
  addPoiNodeToGraph,
  type NavigationGraph,
  type NavigationRoute,
} from '@/lib/navigation';
import {
  analyzeRouteSunExposure,
  findSunniestRoute,
  getResortLocalTime,
  roundToNearest5Minutes,
  type RouteSunAnalysis,
} from '@/lib/route-sun-calculator';
import type { HourlyWeather } from '@/lib/weather-types';
import type { UserLocation, MountainHome } from '@/components/LocationControls';

import { OriginDestinationSection } from './OriginDestinationSection';
import { RouteOptionsSection } from './RouteOptionsSection';
import { RouteStepsSection } from './RouteStepsSection';
import { RouteSummaryFooter } from './RouteSummaryFooter';
import type { NavigationState, SelectedPoint, RouteFilters, SectionId } from './types';
import { DEFAULT_FILTERS } from './types';

// Re-export types
export type { NavigationState, SelectedPoint } from './types';

// Detect touch device
const isTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

const MobileAwareTooltip = ({ title, children, ...props }: React.ComponentProps<typeof Tooltip>) => {
  if (isTouchDevice()) return <>{children}</>;
  return <Tooltip title={title} {...props}>{children}</Tooltip>;
};

// Calculate distance between two coordinates in km
function getDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const MAX_DISTANCE_FROM_SKI_AREA_KM = 10;

interface NavigationPanelProps {
  skiArea: SkiAreaDetails;
  userLocation: UserLocation | null;
  mountainHome: MountainHome | null;
  onRouteChange: (route: NavigationRoute | null) => void;
  onNavigationStateChange: (state: NavigationState) => void;
  onClose: () => void;
  isExpanded: boolean;
  externalOrigin?: SelectedPoint | null;
  externalDestination?: SelectedPoint | null;
  onClearExternalOrigin?: () => void;
  onClearExternalDestination?: () => void;
  onRequestMapClick?: (field: 'origin' | 'destination') => void;
  onCancelMapClick?: () => void;
  mapClickMode?: 'origin' | 'destination' | null;
  isMinimized?: boolean;
  onToggleMinimize?: () => void;
  hourlyWeather?: HourlyWeather[];
  pois?: POIData[];
  // Optional prebuilt graph to avoid rebuilding - performance optimization
  prebuiltGraph?: NavigationGraph | null;
  // Callback to find nearest toilet from a given point (uses prebuilt graph)
  findNearestToilet?: (fromLat: number, fromLng: number) => POIData | null;
}

function NavigationPanelInner({
  skiArea,
  userLocation,
  mountainHome,
  onRouteChange,
  onNavigationStateChange,
  onClose,
  isExpanded,
  externalOrigin,
  externalDestination,
  onClearExternalOrigin,
  onClearExternalDestination,
  onRequestMapClick,
  onCancelMapClick,
  mapClickMode,
  isMinimized = false,
  onToggleMinimize,
  hourlyWeather,
  pois = [],
  prebuiltGraph,
  findNearestToilet,
}: NavigationPanelProps) {
  // State
  const [origin, setOrigin] = useState<SelectedPoint | null>(null);
  const [destination, setDestination] = useState<SelectedPoint | null>(null);
  const [route, setRoute] = useState<NavigationRoute | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAutoSetOrigin, setHasAutoSetOrigin] = useState(false);
  const [hasAutoStartedMapClick, setHasAutoStartedMapClick] = useState(false);
  const [filters, setFilters] = useState<RouteFilters>(DEFAULT_FILTERS);
  const [sunnyRouteEnabled, setSunnyRouteEnabled] = useState(false);
  const [sunnyRouteTolerance, setSunnyRouteTolerance] = useState(10);
  const [sunnyRouteStartTime, setSunnyRouteStartTime] = useState<Date>(() =>
    roundToNearest5Minutes(getResortLocalTime(new Date(), skiArea.latitude, skiArea.longitude))
  );
  const [sunAnalysis, setSunAnalysis] = useState<RouteSunAnalysis | null>(null);
  const [isActivelyNavigating, setIsActivelyNavigating] = useState(false);

  // Collapsible section state - auto-collapse behavior
  const [expandedSection, setExpandedSection] = useState<SectionId>('origin-destination');

  const poisRef = useRef(pois);
  const graphRef = useRef<NavigationGraph | null>(null);
  const graphSkiAreaIdRef = useRef<string | null>(null);

  useEffect(() => {
    poisRef.current = pois;
  }, [pois]);

  // Check if user location is valid
  const isUserLocationValid = useMemo(() => {
    if (!userLocation) return false;
    const distance = getDistanceKm(
      userLocation.latitude,
      userLocation.longitude,
      skiArea.latitude,
      skiArea.longitude
    );
    return distance <= MAX_DISTANCE_FROM_SKI_AREA_KM;
  }, [userLocation, skiArea.latitude, skiArea.longitude]);

  // Graph building (lazy, or use prebuilt graph for better performance)
  const getGraph = useCallback(() => {
    if (graphSkiAreaIdRef.current !== skiArea.id) {
      graphRef.current = null;
    }
    if (!graphRef.current) {
      // Use prebuilt graph if available, otherwise build from scratch
      graphRef.current = prebuiltGraph || buildNavigationGraph(skiArea);
      graphSkiAreaIdRef.current = skiArea.id;
    }

    const allDifficultiesEnabled = Object.values(filters.difficulties).every((v) => v);
    const allLiftTypesEnabled = Object.values(filters.liftTypes).every((v) => v);

    if (allDifficultiesEnabled && allLiftTypesEnabled) {
      return graphRef.current;
    }

    const filteredAdjacency = new Map<string, string[]>();
    for (const [nodeId, edgeIds] of graphRef.current.adjacency) {
      const allowedEdgeIds = edgeIds.filter((edgeId) => {
        const edge = graphRef.current!.edges.get(edgeId);
        if (!edge) return false;
        if (edge.type === 'run' && edge.difficulty) {
          const diffKey = edge.difficulty.toLowerCase() as keyof typeof filters.difficulties;
          if (filters.difficulties[diffKey] === false) return false;
        }
        if (edge.type === 'lift' && edge.liftType) {
          const liftKey = edge.liftType.toLowerCase().replace(/[_\s]/g, '_') as keyof typeof filters.liftTypes;
          if (filters.liftTypes[liftKey] === false) return false;
        }
        return true;
      });
      filteredAdjacency.set(nodeId, allowedEdgeIds);
    }

    return {
      nodes: graphRef.current.nodes,
      edges: graphRef.current.edges,
      adjacency: filteredAdjacency,
    };
  }, [skiArea, filters, prebuiltGraph]);

  // Auto-start map click mode for origin
  useEffect(() => {
    if (!hasAutoStartedMapClick && !origin && !externalOrigin && onRequestMapClick) {
      const timer = setTimeout(() => {
        onRequestMapClick('origin');
        setHasAutoStartedMapClick(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [hasAutoStartedMapClick, origin, externalOrigin, onRequestMapClick]);

  // Auto-set origin to current location
  useEffect(() => {
    if (!hasAutoSetOrigin && isUserLocationValid && userLocation && !origin) {
      setOrigin({
        type: 'location',
        id: 'current-location',
        name: 'My Current Location',
        lat: userLocation.latitude,
        lng: userLocation.longitude,
      });
      setHasAutoSetOrigin(true);
    }
  }, [hasAutoSetOrigin, isUserLocationValid, userLocation, origin]);

  // Handle external origin
  useEffect(() => {
    if (externalOrigin) {
      setOrigin(externalOrigin);
      onClearExternalOrigin?.();
      if (!destination && onRequestMapClick) {
        setTimeout(() => onRequestMapClick('destination'), 100);
      }
    }
  }, [externalOrigin, onClearExternalOrigin, destination, onRequestMapClick]);

  // Handle external destination
  useEffect(() => {
    if (externalDestination) {
      setDestination(externalDestination);
      onClearExternalDestination?.();
    }
  }, [externalDestination, onClearExternalDestination]);

  // Calculate route when origin/destination change
  useEffect(() => {
    if (!origin || !destination) {
      setRoute(null);
      setSunAnalysis(null);
      onRouteChange(null);
      return;
    }

    setIsCalculating(true);
    setError(null);
    setSunAnalysis(null);

    setTimeout(() => {
      try {
        const graph = getGraph();

        // Resolve closestToilet using the shared findNearestToilet callback
        let resolvedDestination = destination;
        if (destination.type === 'closestToilet' && origin.lat && origin.lng) {
          // Use the shared findNearestToilet function if provided
          if (findNearestToilet) {
            const nearestToilet = findNearestToilet(origin.lat, origin.lng);
            if (!nearestToilet) {
              setError('No toilets found nearby. Try moving closer to a run or lift.');
              setIsCalculating(false);
              return;
            }
            
            // Add the toilet as a POI node for routing
            const toiletNodeId = addPoiNodeToGraph(
              graph,
              nearestToilet.id,
              nearestToilet.latitude,
              nearestToilet.longitude,
              nearestToilet.name || 'Toilet'
            );
            
            resolvedDestination = {
              type: 'mapPoint',
              id: nearestToilet.id,
              name: nearestToilet.name || 'Toilet',
              lat: nearestToilet.latitude,
              lng: nearestToilet.longitude,
              nodeId: toiletNodeId,
            };
            setDestination(resolvedDestination);
          } else {
            // Fallback: inline toilet finding (for backwards compatibility)
            const toilets = pois.filter((poi) => poi.type === 'toilet');
            if (toilets.length === 0) {
              setError('No toilets found in this area');
              setIsCalculating(false);
              return;
            }
            
            // Find geographically closest toilet as simple fallback
            const toiletsWithDistance = toilets.map((t) => ({
              toilet: t,
              geoDistance: Math.sqrt(Math.pow(t.latitude - origin.lat!, 2) + Math.pow(t.longitude - origin.lng!, 2)),
            }));
            toiletsWithDistance.sort((a, b) => a.geoDistance - b.geoDistance);
            const nearestToilet = toiletsWithDistance[0].toilet;
            
            const toiletNodeId = addPoiNodeToGraph(
              graph,
              nearestToilet.id,
              nearestToilet.latitude,
              nearestToilet.longitude,
              nearestToilet.name || 'Toilet'
            );
            
            resolvedDestination = {
              type: 'mapPoint',
              id: nearestToilet.id,
              name: nearestToilet.name || 'Toilet',
              lat: nearestToilet.latitude,
              lng: nearestToilet.longitude,
              nodeId: toiletNodeId,
            };
            setDestination(resolvedDestination);
          }
        }

        const getNodeId = (point: SelectedPoint): string | null => {
          // closestToilet should have been resolved by now
          if (point.type === 'closestToilet') {
            return null;
          }
          
          // If nodeId is already set (e.g., from POI resolution), use it directly
          if (point.nodeId) {
            return point.nodeId;
          }
          
          if (point.type === 'location' || point.type === 'mapPoint' || point.type === 'home') {
            if (point.lat && point.lng) {
              const nearest = findNearestNode(graph, point.lat, point.lng);
              return nearest?.id || null;
            }
            return null;
          } else if (point.type === 'run') {
            const useTop = point.position === 'top' || !point.position;
            return useTop ? `run-${point.id}-start` : `run-${point.id}-end`;
          } else if (point.type === 'lift') {
            const useBottom = point.position === 'bottom' || !point.position;
            return useBottom ? `lift-${point.id}-start` : `lift-${point.id}-end`;
          }
          return null;
        };

        const fromNodeId = getNodeId(origin);
        const toNodeId = getNodeId(resolvedDestination);

        if (fromNodeId && toNodeId) {
          const result = findRouteWithDiagnostics(graph, fromNodeId, toNodeId, skiArea);

          if (result.route) {
            let optimizedRoute = optimizeRoute(result.route, skiArea);
            let analysis: RouteSunAnalysis | null = null;

            if (sunnyRouteEnabled) {
              const alternatives = findAlternativeRoutes(
                graph,
                fromNodeId,
                toNodeId,
                5,
                1 + sunnyRouteTolerance / (optimizedRoute.totalTime / 60)
              );
              const optimizedAlternatives = alternatives.map((alt) => optimizeRoute(alt, skiArea));
              const sunResult = findSunniestRoute(
                optimizedRoute,
                optimizedAlternatives,
                sunnyRouteTolerance,
                sunnyRouteStartTime,
                skiArea,
                hourlyWeather
              );
              optimizedRoute = sunResult.route;
              analysis = sunResult.analysis;
            } else {
              analysis = analyzeRouteSunExposure(optimizedRoute, sunnyRouteStartTime, skiArea, hourlyWeather);
            }

            setRoute(optimizedRoute);
            setSunAnalysis(analysis);
            onRouteChange(optimizedRoute);
            // Auto-expand route steps when route is calculated
            setExpandedSection('route-steps');
            trackEvent('navigation_route_calculated', {
              origin_type: origin.type,
              destination_type: destination.type,
              total_time: optimizedRoute.totalTime,
              total_distance: optimizedRoute.totalDistance,
              segment_count: optimizedRoute.segments.length,
              sun_percentage: analysis?.sunPercentage ?? null,
              sunny_routing_enabled: sunnyRouteEnabled,
            });
          } else {
            setError('No route found. Try a different origin or destination.');
            setRoute(null);
            setSunAnalysis(null);
            onRouteChange(null);
          }
        } else {
          // Provide more specific error message
          const originMissing = !fromNodeId;
          const destMissing = !toNodeId;
          console.warn('[Navigation] Routing failed - fromNodeId:', fromNodeId, 'toNodeId:', toNodeId);
          console.warn('[Navigation] Origin:', origin);
          console.warn('[Navigation] Destination:', resolvedDestination);
          
          if (originMissing && destMissing) {
            setError('Both start and end points are outside the ski area network. Try selecting a run or lift.');
          } else if (originMissing) {
            setError('Start point is outside the ski area network. Try moving closer to a run or lift.');
          } else {
            setError('Destination is outside the ski area network. Try a different destination.');
          }
          setRoute(null);
          setSunAnalysis(null);
          onRouteChange(null);
        }
      } catch (e) {
        console.error('Route calculation error:', e);
        setError('Error calculating route');
        setRoute(null);
        setSunAnalysis(null);
        onRouteChange(null);
      }
      setIsCalculating(false);
    }, 50);
  }, [origin, destination, getGraph, skiArea, onRouteChange, sunnyRouteEnabled, sunnyRouteTolerance, sunnyRouteStartTime, hourlyWeather, pois]);

  // Update navigation state
  useEffect(() => {
    onNavigationStateChange({
      isActive: true,
      origin,
      destination,
      route,
      isNavigating: isActivelyNavigating,
      currentHeading: null,
    });
  }, [origin, destination, route, isActivelyNavigating, onNavigationStateChange]);

  // Section toggle handlers with auto-collapse
  const handleSectionToggle = useCallback((section: SectionId) => {
    setExpandedSection((prev) => (prev === section ? prev : section));
  }, []);

  // Navigation handlers
  const handleStartNavigation = useCallback(() => {
    if (!route) return;
    setIsActivelyNavigating(true);
    trackEvent('navigation_started', {
      origin_name: origin?.name,
      destination_name: destination?.name,
      total_time: route.totalTime,
      total_distance: route.totalDistance,
    });
  }, [route, origin?.name, destination?.name]);

  const handleStopNavigation = useCallback(() => {
    setIsActivelyNavigating(false);
    trackEvent('navigation_stopped');
  }, []);

  const handleClear = useCallback(() => {
    setOrigin(null);
    setDestination(null);
    setRoute(null);
    setError(null);
    onRouteChange(null);
    setExpandedSection('origin-destination');
  }, [onRouteChange]);

  // Collapsed view
  if (!isExpanded) {
    return (
      <div className="nav-panel-collapsed">
        <CompassOutlined style={{ fontSize: 14, color: '#3b82f6' }} />
        <span style={{ fontSize: 10, color: '#888', marginLeft: 6 }}>
          {route ? `${formatDuration(route.totalTime)} · ${formatDistance(route.totalDistance)}` : 'Navigate'}
        </span>
      </div>
    );
  }

  // Minimized view
  if (isMinimized && route) {
    return (
      <div className="nav-panel nav-panel-minimized">
        <div className="nav-panel-header">
          <div className="nav-panel-title">
            <CompassOutlined style={{ fontSize: 14, marginRight: 6 }} />
            <span style={{ fontSize: 11 }}>
              {formatDuration(route.totalTime)} · {formatDistance(route.totalDistance)}
            </span>
          </div>
          <div className="nav-header-buttons">
            <button className="nav-minimize-btn" onClick={onToggleMinimize} title="Expand">
              <UpOutlined style={{ fontSize: 10 }} />
            </button>
            <button className="nav-close-btn" onClick={onClose}>
              <CloseOutlined style={{ fontSize: 12 }} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="nav-panel nav-panel-refactored">
      {/* Header */}
      <div className="nav-panel-header">
        <div className="nav-panel-title">
          <CompassOutlined style={{ fontSize: 14, marginRight: 6 }} />
          <span>Navigate</span>
        </div>
        <div className="nav-header-buttons">
          {route && onToggleMinimize && (
            <button className="nav-minimize-btn" onClick={onToggleMinimize} title="Minimize">
              <DownOutlined style={{ fontSize: 10 }} />
            </button>
          )}
          <button className="nav-close-btn" onClick={onClose}>
            <CloseOutlined style={{ fontSize: 12 }} />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="nav-panel-content">
        {/* Origin & Destination Section */}
        <OriginDestinationSection
          origin={origin}
          destination={destination}
          onOriginChange={setOrigin}
          onDestinationChange={setDestination}
          skiArea={skiArea}
          userLocation={userLocation}
          isUserLocationValid={isUserLocationValid}
          mountainHome={mountainHome}
          isExpanded={expandedSection === 'origin-destination'}
          onToggle={() => handleSectionToggle('origin-destination')}
          onRequestMapClick={onRequestMapClick}
          mapClickMode={mapClickMode}
        />

        {/* Error message */}
        {error && (
          <div className="nav-error">
            <span>{error}</span>
          </div>
        )}

        {/* Loading state */}
        {isCalculating && (
          <div className="nav-loading">
            <LoadingSpinner size={20} />
            <span>Calculating route...</span>
          </div>
        )}

        {/* Route Options Section */}
        <RouteOptionsSection
          isExpanded={expandedSection === 'route-options'}
          onToggle={() => handleSectionToggle('route-options')}
          filters={filters}
          onFiltersChange={setFilters}
          sunnyRouteEnabled={sunnyRouteEnabled}
          onSunnyRouteEnabledChange={setSunnyRouteEnabled}
          sunnyRouteTolerance={sunnyRouteTolerance}
          onSunnyRouteToleranceChange={setSunnyRouteTolerance}
          sunnyRouteStartTime={sunnyRouteStartTime}
          onSunnyRouteStartTimeChange={setSunnyRouteStartTime}
        />

        {/* Route Steps Section */}
        {route && !isCalculating && (
          <RouteStepsSection
            route={route}
            pois={pois}
            isExpanded={expandedSection === 'route-steps'}
            onToggle={() => handleSectionToggle('route-steps')}
          />
        )}
      </div>

      {/* Sticky Footer with route summary */}
      {route && !isCalculating && (
        <RouteSummaryFooter
          route={route}
          sunAnalysis={sunAnalysis}
          isActivelyNavigating={isActivelyNavigating}
          onStartNavigation={handleStartNavigation}
          onStopNavigation={handleStopNavigation}
          onClear={handleClear}
          hasOriginOrDestination={!!(origin || destination)}
        />
      )}

      {/* Show clear button when no route but has origin/destination */}
      {!route && (origin || destination) && !isCalculating && (
        <div className="nav-actions-simple">
          <button className="footer-btn secondary" onClick={handleClear}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

const NavigationPanel = memo(NavigationPanelInner);
export default NavigationPanel;

// Navigation trigger button
export interface NavigationButtonProps {
  onClick: () => void;
  hasRoute: boolean;
  routeSummary?: string;
}

export const NavigationButton = memo(function NavigationButton({
  onClick,
  hasRoute,
  routeSummary,
}: NavigationButtonProps) {
  return (
    <MobileAwareTooltip title={hasRoute ? routeSummary : 'Plan a route'} placement="left">
      <button className={`nav-trigger-btn ${hasRoute ? 'has-route' : ''}`} onClick={onClick}>
        <CompassOutlined style={{ fontSize: 16 }} />
      </button>
    </MobileAwareTooltip>
  );
});

// WC Button
export interface WCButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export const WCButton = memo(function WCButton({ onClick, disabled = false }: WCButtonProps) {
  return (
    <MobileAwareTooltip title="Find nearest toilet" placement="left">
      <button
        className="nav-trigger-btn wc-btn"
        onClick={onClick}
        disabled={disabled}
        style={{
          marginTop: 4,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600 }}>WC</span>
      </button>
    </MobileAwareTooltip>
  );
});


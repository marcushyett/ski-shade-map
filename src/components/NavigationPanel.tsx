'use client';

import { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import { Input, Spin, Button, Tooltip } from 'antd';
import {
  SearchOutlined,
  EnvironmentOutlined,
  SwapOutlined,
  CloseOutlined,
  NodeIndexOutlined,
  AimOutlined,
  CompassOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  HomeOutlined,
  SettingOutlined,
  DownOutlined,
  UpOutlined,
  RightOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { trackEvent } from '@/lib/posthog';

// Detect touch device to disable tooltips (they require double-tap on mobile)
const isTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

// Wrapper that only shows tooltip on non-touch devices
const MobileAwareTooltip = ({ title, children, ...props }: React.ComponentProps<typeof Tooltip>) => {
  if (isTouchDevice()) {
    return <>{children}</>;
  }
  return <Tooltip title={title} {...props}>{children}</Tooltip>;
};
import type { SkiAreaDetails, RunData, LiftData } from '@/lib/types';
import { getDifficultyColor } from '@/lib/shade-calculator';
import {
  buildNavigationGraph,
  findRoute,
  findNearestNode,
  findRouteBetweenFeatures,
  formatDuration,
  formatDistance,
  type NavigationGraph,
  type NavigationRoute,
  type NavigationDestination,
} from '@/lib/navigation';
import type { UserLocation, MountainHome } from '@/components/LocationControls';

// ============================================================================
// Types
// ============================================================================

export interface NavigationState {
  isActive: boolean;
  origin: SelectedPoint | null;
  destination: SelectedPoint | null;
  route: NavigationRoute | null;
  isNavigating: boolean; // Active turn-by-turn navigation
  currentHeading: number | null; // Device heading for map orientation
}

export interface SelectedPoint {
  type: 'run' | 'lift' | 'location' | 'mapPoint' | 'home';
  id: string;
  name: string;
  nodeId?: string;
  difficulty?: string | null;
  liftType?: string | null;
  lat?: number;
  lng?: number;
  // For runs/lifts: whether to use top (start) or bottom (end) of the feature
  position?: 'top' | 'bottom';
}

// Route filter options
export interface RouteFilters {
  // Allowed difficulties (all enabled by default)
  difficulties: {
    novice: boolean;
    easy: boolean;
    intermediate: boolean;
    advanced: boolean;
    expert: boolean;
  };
  // Allowed lift types (all enabled by default)
  liftTypes: {
    gondola: boolean;
    cable_car: boolean;
    chair_lift: boolean;
    't-bar': boolean;
    drag_lift: boolean;
    platter: boolean;
    rope_tow: boolean;
    magic_carpet: boolean;
    funicular: boolean;
  };
}

const DEFAULT_FILTERS: RouteFilters = {
  difficulties: {
    novice: true,
    easy: true,
    intermediate: true,
    advanced: true,
    expert: true,
  },
  liftTypes: {
    gondola: true,
    cable_car: true,
    chair_lift: true,
    't-bar': true,
    drag_lift: true,
    platter: true,
    rope_tow: true,
    magic_carpet: true,
    funicular: true,
  },
};

interface NavigationPanelProps {
  skiArea: SkiAreaDetails;
  userLocation: UserLocation | null;
  mountainHome: MountainHome | null;
  onRouteChange: (route: NavigationRoute | null) => void;
  onNavigationStateChange: (state: NavigationState) => void;
  onClose: () => void;
  isExpanded: boolean;
  // Allow external setting of origin/destination from map clicks
  externalOrigin?: SelectedPoint | null;
  externalDestination?: SelectedPoint | null;
  onClearExternalOrigin?: () => void;
  onClearExternalDestination?: () => void;
  // Callback to request map click mode
  onRequestMapClick?: (field: 'origin' | 'destination') => void;
  // Callback to cancel map click mode
  onCancelMapClick?: () => void;
  mapClickMode?: 'origin' | 'destination' | null;
  // Minimize/collapse support
  isMinimized?: boolean;
  onToggleMinimize?: () => void;
}

// ============================================================================
// Search Input Component
// ============================================================================

interface PointSearchInputProps {
  placeholder: string;
  value: SelectedPoint | null;
  onChange: (point: SelectedPoint | null) => void;
  skiArea: SkiAreaDetails;
  graph: NavigationGraph;
  showCurrentLocation?: boolean;
  userLocation?: UserLocation | null;
  isUserLocationValid?: boolean;
  mountainHome?: MountainHome | null;
  autoFocus?: boolean;
  label: string;
  onRequestMapClick?: () => void;
  onCancelMapClick?: () => void;
  isMapClickActive?: boolean;
}

function PointSearchInput({
  placeholder,
  value,
  onChange,
  skiArea,
  graph,
  showCurrentLocation = false,
  userLocation,
  isUserLocationValid = false,
  mountainHome,
  autoFocus = false,
  label,
  onRequestMapClick,
  onCancelMapClick,
  isMapClickActive = false,
}: PointSearchInputProps) {
  const [searchText, setSearchText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus when autoFocus is true
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  // Filter runs and lifts by search
  const filteredRuns = useMemo(() => {
    if (!searchText) return [];
    const lower = searchText.toLowerCase();
    return skiArea.runs
      .filter((r) => r.name?.toLowerCase().includes(lower))
      .slice(0, 5);
  }, [skiArea.runs, searchText]);

  const filteredLifts = useMemo(() => {
    if (!searchText) return [];
    const lower = searchText.toLowerCase();
    return skiArea.lifts
      .filter((l) => l.name?.toLowerCase().includes(lower))
      .slice(0, 3);
  }, [skiArea.lifts, searchText]);

  // Combined results for keyboard navigation
  const allResults = useMemo(() => {
    const results: SelectedPoint[] = [];
    
    // Add current location option if available AND valid (within ski area range)
    if (showCurrentLocation && userLocation && isUserLocationValid && (!searchText || 'current location my location'.includes(searchText.toLowerCase()))) {
      results.push({
        type: 'location',
        id: 'current-location',
        name: 'My Current Location',
        lat: userLocation.latitude,
        lng: userLocation.longitude,
      });
    }
    
    filteredRuns.forEach((run) => {
      const nodeId = `run-${run.id}-start`;
      if (graph.nodes.has(nodeId)) {
        results.push({
          type: 'run',
          id: run.id,
          name: run.name || 'Unnamed Run',
          nodeId,
          difficulty: run.difficulty,
        });
      }
    });
    
    filteredLifts.forEach((lift) => {
      const nodeId = `lift-${lift.id}-start`;
      if (graph.nodes.has(nodeId)) {
        results.push({
          type: 'lift',
          id: lift.id,
          name: lift.name || 'Unnamed Lift',
          nodeId,
          liftType: lift.liftType,
        });
      }
    });
    
    return results;
  }, [filteredRuns, filteredLifts, showCurrentLocation, userLocation, isUserLocationValid, searchText, graph]);

  const handleSelect = useCallback((point: SelectedPoint) => {
    onChange(point);
    setSearchText('');
    setIsFocused(false);
    setSelectedIndex(-1);
    // Cancel map click mode when user selects a point
    onCancelMapClick?.();
  }, [onChange, onCancelMapClick]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, allResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      handleSelect(allResults[selectedIndex]);
    } else if (e.key === 'Escape') {
      setSearchText('');
      setIsFocused(false);
    }
  }, [allResults, selectedIndex, handleSelect]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const showDropdown = isFocused && (allResults.length > 0 || searchText.length > 0);

  return (
    <div ref={containerRef} className="nav-search-container relative">
      <div className="flex items-center justify-between mb-0.5">
        <label style={{ fontSize: 9, color: '#666' }}>
          {label}
        </label>
        <div className="flex items-center gap-1">
          {/* Current Location quick-select button */}
          {showCurrentLocation && userLocation && isUserLocationValid && (
            <MobileAwareTooltip title="Use current location" placement="top">
              <button 
                className="location-btn nav-location-btn"
                onClick={() => {
                  onChange({
                    type: 'location',
                    id: 'current-location',
                    name: 'My Current Location',
                    lat: userLocation.latitude,
                    lng: userLocation.longitude,
                  });
                  onCancelMapClick?.();
                }}
                style={{ width: 22, height: 22 }}
              >
                <AimOutlined style={{ fontSize: 11, color: '#3b82f6' }} />
              </button>
            </MobileAwareTooltip>
          )}
          {/* Mountain Home quick-select button */}
          {mountainHome && (
            <MobileAwareTooltip title={`Go to ${mountainHome.name}`} placement="top">
              <button 
                className="location-btn nav-home-btn"
                onClick={() => {
                  onChange({
                    type: 'home',
                    id: 'mountain-home',
                    name: mountainHome.name,
                    lat: mountainHome.latitude,
                    lng: mountainHome.longitude,
                  });
                  onCancelMapClick?.();
                }}
                style={{ width: 22, height: 22 }}
              >
                <HomeOutlined style={{ fontSize: 11, color: '#faad14' }} />
              </button>
            </MobileAwareTooltip>
          )}
          {/* Pick on map button */}
          {onRequestMapClick && (
            <MobileAwareTooltip title={isMapClickActive ? 'Click anywhere on the map' : 'Pick location on map'} placement="top">
              <button 
                className={`location-btn nav-map-pick-btn ${isMapClickActive ? 'active' : ''}`}
                onClick={onRequestMapClick}
                style={{ width: 22, height: 22 }}
              >
                <EnvironmentOutlined style={{ fontSize: 11 }} />
              </button>
            </MobileAwareTooltip>
          )}
        </div>
      </div>
      {value ? (
        <div className="nav-selected-point-wrapper">
          <div className="nav-selected-point" onClick={() => onChange(null)}>
            {value.type === 'location' ? (
              <AimOutlined style={{ fontSize: 12, color: '#3b82f6', marginRight: 6 }} />
            ) : value.type === 'home' ? (
              <HomeOutlined style={{ fontSize: 12, color: '#faad14', marginRight: 6 }} />
            ) : value.type === 'mapPoint' ? (
              <EnvironmentOutlined style={{ fontSize: 12, color: '#f59e0b', marginRight: 6 }} />
            ) : value.type === 'run' ? (
              <span 
                className="nav-dot" 
                style={{ backgroundColor: getDifficultyColor(value.difficulty) }} 
              />
            ) : value.type === 'lift' ? (
              <SwapOutlined style={{ fontSize: 10, color: '#52c41a', marginRight: 6 }} />
            ) : (
              <EnvironmentOutlined style={{ fontSize: 12, color: '#888', marginRight: 6 }} />
            )}
            <span className="nav-selected-name">
              {value.name}
              {(value.type === 'run' || value.type === 'lift') && value.position && (
                <span style={{ color: '#888', fontSize: 9, marginLeft: 4 }}>
                  ({value.position === 'top' ? 'top' : 'bottom'})
                </span>
              )}
            </span>
            <CloseOutlined style={{ fontSize: 10, color: '#666', marginLeft: 'auto' }} />
          </div>
          {/* Position toggle for runs and lifts */}
          {(value.type === 'run' || value.type === 'lift') && (
            <div className="nav-position-toggle">
              <button
                className={`nav-position-btn ${value.position === 'top' ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({ ...value, position: 'top' });
                }}
              >
                <ArrowUpOutlined style={{ fontSize: 9, marginRight: 2 }} />
                Top
              </button>
              <button
                className={`nav-position-btn ${value.position === 'bottom' || !value.position ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({ ...value, position: 'bottom' });
                }}
              >
                <ArrowDownOutlined style={{ fontSize: 9, marginRight: 2 }} />
                Bottom
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <Input
            ref={inputRef as any}
            placeholder={isMapClickActive ? 'Click on map or search...' : placeholder}
            prefix={<SearchOutlined style={{ fontSize: 11, opacity: 0.5 }} />}
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setSelectedIndex(-1);
            }}
            onFocus={() => setIsFocused(true)}
            onKeyDown={handleKeyDown}
            size="small"
            style={{ width: '100%' }}
          />
          
          {showDropdown && (
            <div className="nav-search-dropdown">
              {/* Current location option - only if valid */}
              {showCurrentLocation && userLocation && isUserLocationValid && (!searchText || 'current location my location'.includes(searchText.toLowerCase())) && (
                <div
                  className={`nav-search-item ${selectedIndex === 0 ? 'selected' : ''}`}
                  onClick={() => handleSelect({
                    type: 'location',
                    id: 'current-location',
                    name: 'My Current Location',
                    lat: userLocation.latitude,
                    lng: userLocation.longitude,
                  })}
                >
                  <AimOutlined style={{ fontSize: 12, color: '#3b82f6', marginRight: 8 }} />
                  <span>My Current Location</span>
                </div>
              )}
              
              {/* Mountain home option */}
              {mountainHome && (!searchText || 'home mountain base lodge'.includes(searchText.toLowerCase()) || mountainHome.name.toLowerCase().includes(searchText.toLowerCase())) && (
                <div
                  className={`nav-search-item`}
                  onClick={() => handleSelect({
                    type: 'home',
                    id: 'mountain-home',
                    name: mountainHome.name,
                    lat: mountainHome.latitude,
                    lng: mountainHome.longitude,
                  })}
                >
                  <HomeOutlined style={{ fontSize: 12, color: '#faad14', marginRight: 8 }} />
                  <span>{mountainHome.name}</span>
                  <span className="nav-search-item-meta">Home</span>
                </div>
              )}
              
              {/* Warning if user location is too far */}
              {showCurrentLocation && userLocation && !isUserLocationValid && (!searchText || 'current location'.includes(searchText.toLowerCase())) && (
                <div className="nav-search-item disabled">
                  <AimOutlined style={{ fontSize: 12, color: '#666', marginRight: 8 }} />
                  <span style={{ color: '#888', fontSize: 11 }}>Location too far from ski area</span>
                </div>
              )}
              
              {/* Runs */}
              {filteredRuns.length > 0 && (
                <div className="nav-search-category">
                  <div className="nav-search-category-header">
                    <NodeIndexOutlined style={{ fontSize: 9, marginRight: 4 }} />
                    Runs
                  </div>
                  {filteredRuns.map((run, idx) => {
                    const resultIndex = showCurrentLocation && userLocation ? idx + 1 : idx;
                    const nodeId = `run-${run.id}-start`;
                    if (!graph.nodes.has(nodeId)) return null;
                    
                    return (
                      <div
                        key={run.id}
                        className={`nav-search-item ${selectedIndex === resultIndex ? 'selected' : ''}`}
                        onClick={() => handleSelect({
                          type: 'run',
                          id: run.id,
                          name: run.name || 'Unnamed',
                          nodeId,
                          difficulty: run.difficulty,
                        })}
                      >
                        <span
                          className="nav-dot"
                          style={{ backgroundColor: getDifficultyColor(run.difficulty) }}
                        />
                        <span className="nav-search-item-name">{run.name || 'Unnamed'}</span>
                        {run.difficulty && (
                          <span className="nav-search-item-meta" style={{ color: getDifficultyColor(run.difficulty) }}>
                            {run.difficulty}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              
              {/* Lifts */}
              {filteredLifts.length > 0 && (
                <div className="nav-search-category">
                  <div className="nav-search-category-header">
                    <SwapOutlined style={{ fontSize: 9, marginRight: 4 }} />
                    Lifts
                  </div>
                  {filteredLifts.map((lift, idx) => {
                    const resultIndex = (showCurrentLocation && userLocation ? 1 : 0) + filteredRuns.length + idx;
                    const nodeId = `lift-${lift.id}-start`;
                    if (!graph.nodes.has(nodeId)) return null;
                    
                    return (
                      <div
                        key={lift.id}
                        className={`nav-search-item ${selectedIndex === resultIndex ? 'selected' : ''}`}
                        onClick={() => handleSelect({
                          type: 'lift',
                          id: lift.id,
                          name: lift.name || 'Unnamed',
                          nodeId,
                          liftType: lift.liftType,
                        })}
                      >
                        <SwapOutlined style={{ fontSize: 10, color: '#52c41a', marginRight: 8 }} />
                        <span className="nav-search-item-name">{lift.name || 'Unnamed'}</span>
                        {lift.liftType && (
                          <span className="nav-search-item-meta">{lift.liftType}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              
              {allResults.length === 0 && searchText.length > 0 && (
                <div className="nav-no-results">No results found</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// Route Summary Component
// ============================================================================

// Route color legend
function RouteColorLegend() {
  return (
    <div className="nav-route-legend">
      <div className="nav-legend-title">
        <InfoCircleOutlined style={{ fontSize: 10, marginRight: 4 }} />
        Route colors by type
      </div>
      <div className="nav-legend-items">
        <div className="nav-legend-item">
          <span className="nav-legend-color" style={{ backgroundColor: '#9ca3af' }} />
          <span>Lift</span>
        </div>
        <div className="nav-legend-item">
          <span className="nav-legend-color" style={{ backgroundColor: '#f97316' }} />
          <span>Walk</span>
        </div>
        <div className="nav-legend-item">
          <span className="nav-legend-color" style={{ backgroundColor: '#22c55e' }} />
          <span>Novice</span>
        </div>
        <div className="nav-legend-item">
          <span className="nav-legend-color" style={{ backgroundColor: '#3b82f6' }} />
          <span>Easy</span>
        </div>
        <div className="nav-legend-item">
          <span className="nav-legend-color" style={{ backgroundColor: '#dc2626' }} />
          <span>Intermediate</span>
        </div>
        <div className="nav-legend-item">
          <span className="nav-legend-color" style={{ backgroundColor: '#1a1a1a', border: '1px solid #666' }} />
          <span>Advanced</span>
        </div>
        <div className="nav-legend-item">
          <span className="nav-legend-color nav-legend-expert" />
          <span>Expert</span>
        </div>
      </div>
    </div>
  );
}

function RouteSummary({ route }: { route: NavigationRoute }) {
  return (
    <div className="nav-route-summary">
      <div className="nav-route-stats">
        <div className="nav-route-stat">
          <span className="nav-route-stat-value">{formatDuration(route.totalTime)}</span>
          <span className="nav-route-stat-label">total time</span>
        </div>
        <div className="nav-route-stat">
          <span className="nav-route-stat-value">{formatDistance(route.totalDistance)}</span>
          <span className="nav-route-stat-label">distance</span>
        </div>
        <div className="nav-route-stat">
          <span className="nav-route-stat-value">
            <ArrowUpOutlined style={{ fontSize: 9, marginRight: 2 }} />
            {Math.round(route.totalElevationGain)}m
          </span>
          <span className="nav-route-stat-label">up</span>
        </div>
        <div className="nav-route-stat">
          <span className="nav-route-stat-value">
            <ArrowDownOutlined style={{ fontSize: 9, marginRight: 2 }} />
            {Math.round(route.totalElevationLoss)}m
          </span>
          <span className="nav-route-stat-label">down</span>
        </div>
      </div>
      
      {/* Route color legend */}
      <RouteColorLegend />
      
      <div className="nav-route-segments">
        {route.segments.map((segment, idx) => (
          <div key={idx} className="nav-route-segment">
            <div className="nav-segment-icon">
              {segment.type === 'lift' ? (
                <SwapOutlined style={{ fontSize: 10, color: '#9ca3af' }} />
              ) : segment.type === 'run' ? (
                <span 
                  className="nav-dot" 
                  style={{ 
                    backgroundColor: getDifficultyColor(segment.difficulty),
                    width: 8,
                    height: 8,
                  }} 
                />
              ) : (
                <span style={{ fontSize: 10 }}>🚶</span>
              )}
            </div>
            <div className="nav-segment-info">
              <span className="nav-segment-name">
                {segment.type === 'walk' ? 'Walk/Skate' : segment.name || 'Unnamed'}
              </span>
              <span className="nav-segment-meta">
                {formatDistance(segment.distance)} · {formatDuration(segment.time)}
                {segment.elevationChange !== 0 && (
                  <span style={{ color: segment.elevationChange > 0 ? '#52c41a' : '#666' }}>
                    {' '}· {segment.elevationChange > 0 ? '↑' : '↓'}{Math.abs(Math.round(segment.elevationChange))}m
                  </span>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main Navigation Panel Component
// ============================================================================

// Calculate distance between two coordinates in km
function getDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Max distance from ski area center to consider user location valid (in km)
const MAX_DISTANCE_FROM_SKI_AREA_KM = 10;

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
}: NavigationPanelProps) {
  const [origin, setOrigin] = useState<SelectedPoint | null>(null);
  const [destination, setDestination] = useState<SelectedPoint | null>(null);
  const [route, setRoute] = useState<NavigationRoute | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAutoSetOrigin, setHasAutoSetOrigin] = useState(false);
  const [hasAutoStartedMapClick, setHasAutoStartedMapClick] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [filters, setFilters] = useState<RouteFilters>(DEFAULT_FILTERS);

  // Auto-start map click mode for origin when panel opens (if no origin set)
  useEffect(() => {
    if (!hasAutoStartedMapClick && !origin && !externalOrigin && onRequestMapClick) {
      // Small delay to let the panel render first
      const timer = setTimeout(() => {
        onRequestMapClick('origin');
        setHasAutoStartedMapClick(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [hasAutoStartedMapClick, origin, externalOrigin, onRequestMapClick]);

  // Build navigation graph with filters applied
  const graph = useMemo(() => {
    const fullGraph = buildNavigationGraph(skiArea);
    
    // Check if any filters are disabled
    const allDifficultiesEnabled = Object.values(filters.difficulties).every(v => v);
    const allLiftTypesEnabled = Object.values(filters.liftTypes).every(v => v);
    
    if (allDifficultiesEnabled && allLiftTypesEnabled) {
      return fullGraph; // No filtering needed
    }
    
    // Create a filtered copy of the graph
    const filteredEdges = new Map(fullGraph.edges);
    const filteredAdjacency = new Map<string, string[]>();
    
    // Copy adjacency and filter edges
    for (const [nodeId, edgeIds] of fullGraph.adjacency) {
      const allowedEdgeIds = edgeIds.filter(edgeId => {
        const edge = fullGraph.edges.get(edgeId);
        if (!edge) return false;
        
        // Filter runs by difficulty
        if (edge.type === 'run' && edge.difficulty) {
          const diffKey = edge.difficulty.toLowerCase() as keyof typeof filters.difficulties;
          if (filters.difficulties[diffKey] === false) {
            return false;
          }
        }
        
        // Filter lifts by type
        if (edge.type === 'lift' && edge.liftType) {
          const liftKey = edge.liftType.toLowerCase().replace(/[_\s]/g, '_') as keyof typeof filters.liftTypes;
          if (filters.liftTypes[liftKey] === false) {
            return false;
          }
        }
        
        return true;
      });
      
      filteredAdjacency.set(nodeId, allowedEdgeIds);
    }
    
    return {
      nodes: fullGraph.nodes,
      edges: filteredEdges,
      adjacency: filteredAdjacency,
    };
  }, [skiArea, filters]);

  // Check if user location is close enough to ski area
  const isUserLocationValid = useMemo(() => {
    if (!userLocation) return false;
    const distance = getDistanceKm(
      userLocation.latitude, userLocation.longitude,
      skiArea.latitude, skiArea.longitude
    );
    return distance <= MAX_DISTANCE_FROM_SKI_AREA_KM;
  }, [userLocation, skiArea.latitude, skiArea.longitude]);

  // Auto-set origin to current location on first mount if valid
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

  // Handle external origin changes (from map clicks)
  // After setting origin, automatically switch to destination selection if no destination set
  useEffect(() => {
    if (externalOrigin) {
      setOrigin(externalOrigin);
      onClearExternalOrigin?.();
      
      // Auto-switch to destination selection if no destination is set yet
      if (!destination && onRequestMapClick) {
        // Small delay to let the UI update first
        setTimeout(() => {
          onRequestMapClick('destination');
        }, 100);
      }
    }
  }, [externalOrigin, onClearExternalOrigin, destination, onRequestMapClick]);

  // Handle external destination changes (from map clicks)
  useEffect(() => {
    if (externalDestination) {
      setDestination(externalDestination);
      onClearExternalDestination?.();
    }
  }, [externalDestination, onClearExternalDestination]);

  // Calculate route when origin and destination change
  useEffect(() => {
    if (!origin || !destination) {
      setRoute(null);
      onRouteChange(null);
      return;
    }

    setIsCalculating(true);
    setError(null);

    // Use setTimeout to allow UI to update
    setTimeout(() => {
      try {
        let calculatedRoute: NavigationRoute | null = null;

        // Helper to get node ID based on point type and position
        const getNodeId = (point: SelectedPoint, isOrigin: boolean): string | null => {
          if (point.type === 'location' || point.type === 'mapPoint' || point.type === 'home') {
            // For locations/map points/mountain home, find nearest node
            if (point.lat && point.lng) {
              const nearest = findNearestNode(graph, point.lat, point.lng);
              return nearest?.id || null;
            }
            return null;
          } else if (point.type === 'run') {
            // For runs: position determines which end
            // If no position set: origin defaults to bottom (end), destination defaults to top (start)
            const useTop = point.position === 'top' || (!point.position && !isOrigin);
            return useTop ? `run-${point.id}-start` : `run-${point.id}-end`;
          } else if (point.type === 'lift') {
            // For lifts: position determines which station
            // If no position set: origin defaults to top (end), destination defaults to bottom (start)
            const useTop = point.position === 'top' || (!point.position && isOrigin);
            return useTop ? `lift-${point.id}-end` : `lift-${point.id}-start`;
          }
          return point.nodeId || null;
        };

        const fromNodeId = getNodeId(origin, true);
        const toNodeId = getNodeId(destination, false);

        if (fromNodeId && toNodeId) {
          calculatedRoute = findRoute(graph, fromNodeId, toNodeId);
        }

        if (calculatedRoute) {
          setRoute(calculatedRoute);
          onRouteChange(calculatedRoute);
          trackEvent('navigation_route_calculated', {
            origin_type: origin.type,
            origin_name: origin.name,
            destination_type: destination.type,
            destination_name: destination.name,
            total_time: calculatedRoute.totalTime,
            total_distance: calculatedRoute.totalDistance,
            segment_count: calculatedRoute.segments.length,
          });
        } else {
          setError('No route found. Try a different origin or destination.');
          setRoute(null);
          onRouteChange(null);
        }
      } catch (e) {
        console.error('Route calculation error:', e);
        setError('Error calculating route');
        setRoute(null);
        onRouteChange(null);
      }

      setIsCalculating(false);
    }, 50);
  }, [origin, destination, graph, onRouteChange]);

  // Track if we're actively navigating (turn-by-turn mode)
  const [isActivelyNavigating, setIsActivelyNavigating] = useState(false);

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

  // Handle start navigation
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

  // Handle stop navigation
  const handleStopNavigation = useCallback(() => {
    setIsActivelyNavigating(false);
    trackEvent('navigation_stopped');
  }, []);

  // Swap origin and destination
  const handleSwap = useCallback(() => {
    const temp = origin;
    setOrigin(destination);
    setDestination(temp);
  }, [origin, destination]);

  // Clear all
  const handleClear = useCallback(() => {
    setOrigin(null);
    setDestination(null);
    setRoute(null);
    setError(null);
    onRouteChange(null);
  }, [onRouteChange]);

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

  // Minimized view - just shows a compact bar with route summary
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
            <button 
              className="nav-minimize-btn" 
              onClick={onToggleMinimize}
              title="Expand"
            >
              <DownOutlined style={{ fontSize: 10 }} />
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
    <div className="nav-panel">
      <div className="nav-panel-header">
        <div className="nav-panel-title">
          <CompassOutlined style={{ fontSize: 14, marginRight: 6 }} />
          <span>Navigate</span>
        </div>
        <div className="nav-header-buttons">
          {route && onToggleMinimize && (
            <button 
              className="nav-minimize-btn" 
              onClick={onToggleMinimize}
              title="Minimize to preview route"
            >
              <UpOutlined style={{ fontSize: 10 }} />
            </button>
          )}
          <button className="nav-close-btn" onClick={onClose}>
            <CloseOutlined style={{ fontSize: 12 }} />
          </button>
        </div>
      </div>

      <div className="nav-panel-content">
        {/* Origin search */}
        <PointSearchInput
          label="FROM"
          placeholder="Start point..."
          value={origin}
          onChange={setOrigin}
          skiArea={skiArea}
          graph={graph}
          showCurrentLocation={true}
          userLocation={userLocation}
          isUserLocationValid={isUserLocationValid}
          mountainHome={mountainHome}
          autoFocus={!origin}
          onRequestMapClick={() => onRequestMapClick?.('origin')}
          onCancelMapClick={onCancelMapClick}
          isMapClickActive={mapClickMode === 'origin'}
        />

        {/* Swap button */}
        <div className="nav-swap-container">
          <MobileAwareTooltip title="Swap origin and destination">
            <button className="nav-swap-btn" onClick={handleSwap}>
              <SwapOutlined style={{ transform: 'rotate(90deg)', fontSize: 12 }} />
            </button>
          </MobileAwareTooltip>
        </div>

        {/* Destination search */}
        <PointSearchInput
          label="TO"
          placeholder="Destination..."
          value={destination}
          onChange={setDestination}
          skiArea={skiArea}
          graph={graph}
          mountainHome={mountainHome}
          showCurrentLocation={true}
          userLocation={userLocation}
          isUserLocationValid={isUserLocationValid}
          onRequestMapClick={() => onRequestMapClick?.('destination')}
          onCancelMapClick={onCancelMapClick}
          isMapClickActive={mapClickMode === 'destination'}
        />

        {/* Advanced options - collapsible */}
        <div className="nav-advanced-section">
          <div 
            className="nav-advanced-header"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? <DownOutlined style={{ fontSize: 8 }} /> : <RightOutlined style={{ fontSize: 8 }} />}
            <SettingOutlined style={{ fontSize: 10, marginLeft: 4 }} />
            <span style={{ marginLeft: 4 }}>Route options</span>
          </div>
          
          {showAdvanced && (
            <div className="nav-advanced-content">
              {/* Difficulty filters */}
              <div className="nav-filter-group">
                <div className="nav-filter-label">Slope difficulties:</div>
                <div className="nav-filter-options">
                  {Object.entries(filters.difficulties).map(([key, checked]) => (
                    <div 
                      key={key} 
                      className="nav-filter-checkbox"
                      onClick={() => setFilters(prev => ({
                        ...prev,
                        difficulties: { ...prev.difficulties, [key]: !prev.difficulties[key as keyof typeof prev.difficulties] }
                      }))}
                    >
                      <span className={`nav-filter-check ${checked ? 'checked' : ''}`} />
                      <span 
                        className="nav-filter-dot"
                        style={{ 
                          backgroundColor: getDifficultyColor(key),
                          border: key === 'advanced' ? '1px solid #666' : undefined,
                        }}
                      />
                      <span className="nav-filter-name">{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Lift type filters */}
              <div className="nav-filter-group">
                <div className="nav-filter-label">Lift types:</div>
                <div className="nav-filter-options nav-filter-lifts">
                  {Object.entries(filters.liftTypes).map(([key, checked]) => (
                    <div 
                      key={key} 
                      className="nav-filter-checkbox"
                      onClick={() => setFilters(prev => ({
                        ...prev,
                        liftTypes: { ...prev.liftTypes, [key]: !prev.liftTypes[key as keyof typeof prev.liftTypes] }
                      }))}
                    >
                      <span className={`nav-filter-check ${checked ? 'checked' : ''}`} />
                      <span className="nav-filter-name">
                        {key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="nav-error">
            {error}
            {error.includes('No route found') && (
              <div style={{ marginTop: 4, fontSize: 9, color: '#f59e0b' }}>
                💡 Try adjusting route options above to allow more lift types or slope difficulties.
              </div>
            )}
          </div>
        )}

        {/* Loading state */}
        {isCalculating && (
          <div className="nav-loading">
            <Spin size="small" />
            <span style={{ marginLeft: 8 }}>Calculating route...</span>
          </div>
        )}

        {/* Route summary */}
        {route && !isCalculating && (
          <RouteSummary route={route} />
        )}

        {/* Action buttons */}
        <div className="nav-actions">
          {route && !isActivelyNavigating && (
            <button 
              className="location-btn nav-start-btn"
              onClick={handleStartNavigation}
            >
              <CompassOutlined style={{ fontSize: 12, marginRight: 4 }} />
              Start
            </button>
          )}
          {isActivelyNavigating && (
            <button 
              className="location-btn nav-stop-btn active"
              onClick={handleStopNavigation}
            >
              <CloseOutlined style={{ fontSize: 10, marginRight: 4 }} />
              Stop
            </button>
          )}
          {(origin || destination) && (
            <button 
              className="location-btn"
              onClick={handleClear}
              style={{ marginLeft: 8, width: 'auto', padding: '0 10px' }}
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const NavigationPanel = memo(NavigationPanelInner);
export default NavigationPanel;

// ============================================================================
// Navigation Trigger Button (for map overlay)
// ============================================================================

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
      <button 
        className={`nav-trigger-btn ${hasRoute ? 'has-route' : ''}`}
        onClick={onClick}
      >
        <CompassOutlined style={{ fontSize: 16 }} />
      </button>
    </MobileAwareTooltip>
  );
});


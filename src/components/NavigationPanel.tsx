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
  BulbOutlined,
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
  findRouteWithDiagnostics,
  findNearestNode,
  findRouteBetweenFeatures,
  formatDuration,
  formatDistance,
  type NavigationGraph,
  type NavigationRoute,
  type NavigationDestination,
  type RouteFailureDiagnostics,
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
  isOrigin?: boolean; // Whether this is the origin (FROM) field
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
  isOrigin = false,
}: PointSearchInputProps) {
  const [searchText, setSearchText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus when autoFocus is true
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  // Calculate dropdown position when focused
  useEffect(() => {
    const updateDropdownPosition = () => {
      if (containerRef.current && isFocused) {
        const rect = containerRef.current.getBoundingClientRect();
        setDropdownPosition({
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
        });
      }
    };

    updateDropdownPosition();
    
    // Update position on scroll or resize
    window.addEventListener('scroll', updateDropdownPosition, true);
    window.addEventListener('resize', updateDropdownPosition);
    
    return () => {
      window.removeEventListener('scroll', updateDropdownPosition, true);
      window.removeEventListener('resize', updateDropdownPosition);
    };
  }, [isFocused]);

  // Filter runs and lifts by search
  // Deduplicate runs by name+subregion, keeping highest altitude
  // Filter out unnamed runs
  const filteredRuns = useMemo(() => {
    if (!searchText) return [];
    const lower = searchText.toLowerCase();
    const matchingRuns = skiArea.runs.filter((r) => r.name && r.name.toLowerCase().includes(lower));
    
    // Group by name + subregion, keep highest altitude
    const grouped = new Map<string, typeof matchingRuns[0]>();
    for (const run of matchingRuns) {
      const key = `${run.name}::${run.subRegionName || ''}`;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, run);
      } else {
        // Get elevation from geometry if available
        const getMaxElevation = (r: typeof run) => {
          if (r.geometry.type === 'LineString') {
            const coords = r.geometry.coordinates;
            return coords.length > 0 ? (coords[0][2] || coords[0][1]) : 0;
          }
          return 0;
        };
        if (getMaxElevation(run) > getMaxElevation(existing)) {
          grouped.set(key, run);
        }
      }
    }
    
    return Array.from(grouped.values()).slice(0, 8);
  }, [skiArea.runs, searchText]);

  const filteredLifts = useMemo(() => {
    if (!searchText) return [];
    const lower = searchText.toLowerCase();
    return skiArea.lifts
      .filter((l) => l.name?.toLowerCase().includes(lower))
      .slice(0, 5);
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

  // Quick action buttons component (reused in both states)
  const QuickActionButtons = () => {
    // Determine which button should be active by default (matching routing logic)
    // For runs: always default to TOP (start of piste)
    // For lifts: always default to BOTTOM (where you board)
    const getDefaultPosition = () => {
      if (!value || !value.position) {
        if (value?.type === 'run') {
          // Runs: default to top (start of piste)
          return 'top';
        } else if (value?.type === 'lift') {
          // Lifts: default to bottom (boarding point)
          return 'bottom';
        }
      }
      return value?.position;
    };
    
    const effectivePosition = getDefaultPosition();
    
    return (
      <div className="nav-quick-actions">
        {/* Position toggle for runs and lifts */}
        {value && (value.type === 'run' || value.type === 'lift') && (
          <>
            <button
              className={`nav-position-btn-sm ${effectivePosition === 'top' ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange({ ...value, position: 'top' });
              }}
            >
              <ArrowUpOutlined style={{ fontSize: 8 }} />
              Top
            </button>
            <button
              className={`nav-position-btn-sm ${effectivePosition === 'bottom' ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange({ ...value, position: 'bottom' });
              }}
            >
              <ArrowDownOutlined style={{ fontSize: 8 }} />
              Bottom
            </button>
          </>
        )}
        {/* Pick on map button */}
        {onRequestMapClick && (
          <MobileAwareTooltip title={isMapClickActive ? 'Click anywhere on the map' : 'Pick location on map'} placement="top">
            <button 
              className={`nav-action-btn ${isMapClickActive ? 'active' : ''}`}
              onClick={onRequestMapClick}
            >
              <EnvironmentOutlined style={{ fontSize: 11 }} />
            </button>
          </MobileAwareTooltip>
        )}
      </div>
    );
  };

  return (
    <div ref={containerRef} className="nav-search-container relative">
      <div className="nav-search-label-row">
        <label style={{ fontSize: 9, color: '#666' }}>
          {label}
        </label>
        {/* Current Location quick-select button */}
        {showCurrentLocation && userLocation && isUserLocationValid && (
          <MobileAwareTooltip title="Use current location" placement="top">
            <button 
              className="nav-label-btn"
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
            >
              <AimOutlined style={{ fontSize: 9, color: '#3b82f6' }} />
            </button>
          </MobileAwareTooltip>
        )}
        {/* Mountain Home quick-select button */}
        {mountainHome && (
          <MobileAwareTooltip title={`Go to ${mountainHome.name}`} placement="top">
            <button 
              className="nav-label-btn"
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
            >
              <HomeOutlined style={{ fontSize: 9, color: '#faad14' }} />
            </button>
          </MobileAwareTooltip>
        )}
      </div>
      {value ? (
        <div className="nav-input-row">
          <div className="nav-selected-point-full" onClick={() => onChange(null)}>
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
            </span>
            <CloseOutlined style={{ fontSize: 10, color: '#666', marginLeft: 'auto' }} />
          </div>
          <QuickActionButtons />
        </div>
      ) : (
        <div className="nav-input-row">
          <Input
            ref={inputRef as any}
            placeholder={isMapClickActive ? 'Click on map or search...' : placeholder}
            prefix={<SearchOutlined style={{ fontSize: 11, opacity: 0.5 }} />}
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setSelectedIndex(-1);
            }}
            onFocus={() => {
              setIsFocused(true);
              // Scroll the input into view with some extra space for dropdown
              setTimeout(() => {
                containerRef.current?.scrollIntoView({ 
                  behavior: 'smooth', 
                  block: 'center' 
                });
              }, 100);
            }}
            onKeyDown={handleKeyDown}
            size="small"
            className="nav-search-input"
          />
          <QuickActionButtons />
          
          {showDropdown && dropdownPosition && (
            <div 
              className={`nav-search-dropdown nav-search-dropdown-fixed ${isOrigin ? 'nav-search-dropdown-origin' : 'nav-search-dropdown-destination'}`}
              style={{
                position: 'fixed',
                top: `${dropdownPosition.top}px`,
                left: `${dropdownPosition.left}px`,
                width: `${dropdownPosition.width}px`,
              }}
            >
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
                        {run.subRegionName && (
                          <span className="nav-search-item-subregion">{run.subRegionName}</span>
                        )}
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
        </div>
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
  // Helper to find the next named destination after unnamed segments
  // Traverses through chains of unnamed connections to find the actual destination
  const getConnectionDestination = (segmentIndex: number) => {
    // Look ahead through ALL unnamed segments (runs and walks) to find the next named feature
    for (let i = segmentIndex + 1; i < route.segments.length; i++) {
      const nextSeg = route.segments[i];
      
      // Skip unnamed runs and "Connection" walks - keep looking
      if (!nextSeg.name || nextSeg.name === 'Connection') {
        continue;
      }
      
      // Found a named segment (lift or named run)
      return nextSeg.name;
    }
    return null;
  };
  
  // Get display name for a segment
  const getSegmentName = (segment: typeof route.segments[0], idx: number) => {
    if (segment.type === 'walk') {
      return 'Walk/Skate';
    }
    
    // For unnamed runs, show "Connection to X"
    if (segment.type === 'run' && !segment.name) {
      const destination = getConnectionDestination(idx);
      if (destination) {
        return `Connection to ${destination}`;
      }
    }
    
    return segment.name || 'Unnamed';
  };
  
  return (
    <div className="nav-route-summary">
      {/* Stats on one line */}
      <div className="nav-route-stats-inline">
        <span className="nav-stat-item">
          <strong>{formatDuration(route.totalTime)}</strong>
          <span className="nav-stat-label">TOTAL TIME</span>
        </span>
        <span className="nav-stat-divider">·</span>
        <span className="nav-stat-item">
          <strong>{formatDistance(route.totalDistance)}</strong>
          <span className="nav-stat-label">DISTANCE</span>
        </span>
        <span className="nav-stat-divider">·</span>
        <span className="nav-stat-item">
          <strong><ArrowUpOutlined style={{ fontSize: 9 }} /> {Math.round(route.totalElevationGain)}m</strong>
          <span className="nav-stat-label">UP</span>
        </span>
        <span className="nav-stat-divider">·</span>
        <span className="nav-stat-item">
          <strong><ArrowDownOutlined style={{ fontSize: 9 }} /> {Math.round(route.totalElevationLoss)}m</strong>
          <span className="nav-stat-label">DOWN</span>
        </span>
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
                <span 
                  className="nav-dot" 
                  style={{ 
                    backgroundColor: '#f97316',
                    width: 8,
                    height: 8,
                  }} 
                />
              )}
            </div>
            <div className="nav-segment-info">
              <span className="nav-segment-name">
                {getSegmentName(segment, idx)}
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
  const [routeDiagnostics, setRouteDiagnostics] = useState<RouteFailureDiagnostics | null>(null);
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
      setRouteDiagnostics(null);
      onRouteChange(null);
      return;
    }

    setIsCalculating(true);
    setError(null);
    setRouteDiagnostics(null);

    // Use setTimeout to allow UI to update
    setTimeout(() => {
      try {
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
            // For runs: default to TOP (start) - the beginning of the piste
            // User can override with position button
            const useTop = point.position === 'top' || !point.position;
            return useTop ? `run-${point.id}-start` : `run-${point.id}-end`;
          } else if (point.type === 'lift') {
            // For lifts: default to BOTTOM (start) - where you board the lift
            // User can override with position button
            const useBottom = point.position === 'bottom' || !point.position;
            return useBottom ? `lift-${point.id}-start` : `lift-${point.id}-end`;
          }
          return point.nodeId || null;
        };

        const fromNodeId = getNodeId(origin, true);
        const toNodeId = getNodeId(destination, false);

        if (fromNodeId && toNodeId) {
          // Use the new diagnostic function
          const result = findRouteWithDiagnostics(graph, fromNodeId, toNodeId, skiArea);
          
          if (result.route) {
            setRoute(result.route);
            setRouteDiagnostics(null);
            onRouteChange(result.route);
            trackEvent('navigation_route_calculated', {
              origin_type: origin.type,
              origin_name: origin.name,
              destination_type: destination.type,
              destination_name: destination.name,
              total_time: result.route.totalTime,
              total_distance: result.route.totalDistance,
              segment_count: result.route.segments.length,
            });
          } else {
            // Set diagnostics for detailed error display
            setRouteDiagnostics(result.diagnostics);
            setError('No route found. Try a different origin or destination.');
            setRoute(null);
            onRouteChange(null);
          }
        } else {
          setError('Could not find start or end point in navigation network.');
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
  }, [origin, destination, graph, skiArea, onRouteChange]);

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
              <DownOutlined style={{ fontSize: 10 }} />
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
          isOrigin={true}
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
          isOrigin={false}
        />

        {/* Error message with diagnostics */}
        {error && (
          <div className="nav-error">
            <div className="nav-error-title">{error}</div>
            
            {/* Show diagnostic details if available */}
            {routeDiagnostics && (
              <div className="nav-error-diagnostics">
                {/* Show specific diagnostic info */}
                {routeDiagnostics.nearestReachableDistance !== undefined && routeDiagnostics.nearestReachableDistance > 0 && (
                  <div className="nav-diagnostic-item">
                    <EnvironmentOutlined style={{ fontSize: 10, marginRight: 4 }} />
                    <span>Nearest reachable point: {routeDiagnostics.nearestReachableDistance}m away</span>
                  </div>
                )}
                
                {routeDiagnostics.elevationGap !== undefined && Math.abs(routeDiagnostics.elevationGap) > 10 && (
                  <div className="nav-diagnostic-item">
                    {routeDiagnostics.elevationGap > 0 ? (
                      <ArrowUpOutlined style={{ fontSize: 10, marginRight: 4 }} />
                    ) : (
                      <ArrowDownOutlined style={{ fontSize: 10, marginRight: 4 }} />
                    )}
                    <span>
                      Would require {Math.abs(routeDiagnostics.elevationGap)}m {routeDiagnostics.elevationGap > 0 ? 'climb' : 'descent'}
                    </span>
                  </div>
                )}
                
                {routeDiagnostics.originRegion && routeDiagnostics.destinationRegion && 
                 routeDiagnostics.originRegion !== routeDiagnostics.destinationRegion && (
                  <div className="nav-diagnostic-item">
                    <InfoCircleOutlined style={{ fontSize: 10, marginRight: 4 }} />
                    <span>
                      Crossing from "{routeDiagnostics.originRegion}" to "{routeDiagnostics.destinationRegion}"
                    </span>
                  </div>
                )}
                
                {/* Suggestions */}
                {routeDiagnostics.suggestions.length > 0 && (
                  <div className="nav-suggestions">
                    <BulbOutlined style={{ fontSize: 10, marginRight: 4, color: '#f59e0b' }} />
                    <span>{routeDiagnostics.suggestions[0]}</span>
                  </div>
                )}
              </div>
            )}
            
            {/* Fallback suggestion if no diagnostics */}
            {!routeDiagnostics && error.includes('No route found') && (
              <div className="nav-suggestions">
                <BulbOutlined style={{ fontSize: 10, marginRight: 4, color: '#f59e0b' }} />
                <span>Try adjusting route options below to allow more lift types or slope difficulties.</span>
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

        {/* Advanced options - moved below route results to give search dropdowns more space */}
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
      </div>

      {/* Action buttons - fixed at bottom, outside scroll area */}
      {(origin || destination || route) && (
        <div className="nav-actions-fixed">
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
              className="location-btn nav-clear-btn"
              onClick={handleClear}
            >
              Clear
            </button>
          )}
        </div>
      )}
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


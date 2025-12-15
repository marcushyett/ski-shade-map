'use client';

import { memo, useMemo, useState } from 'react';
import { CloseOutlined, SwapOutlined, EnvironmentOutlined, UpOutlined, DownOutlined, CompassOutlined, FullscreenOutlined, EditOutlined } from '@ant-design/icons';
import { getDifficultyColor } from '@/lib/shade-calculator';
import { formatDuration } from '@/lib/navigation';
import type { NavigationRoute } from '@/lib/navigation';

interface NavigationInstructionBarProps {
  route: NavigationRoute;
  currentSegmentIndex: number;
  onEndNavigation: () => void;
  isWeatherCollapsed?: boolean;
  onToggleWeather?: () => void;
  userLocation?: { lat: number; lng: number } | null;
  onReturnPointChange?: (point: { lat: number; lng: number } | null) => void;
  onPreviewRoute?: () => void;
  onEditRoute?: () => void;
}

// Calculate distance in meters between two points
function getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Find closest point on route to user location
function findClosestPointOnRoute(
  userLat: number, 
  userLng: number, 
  route: NavigationRoute
): { point: { lat: number; lng: number }; distance: number; segmentIndex: number } | null {
  let closestPoint: { lat: number; lng: number } | null = null;
  let closestDistance = Infinity;
  let closestSegmentIndex = 0;
  
  for (let segIdx = 0; segIdx < route.segments.length; segIdx++) {
    const segment = route.segments[segIdx];
    for (const coord of segment.coordinates) {
      const distance = getDistance(userLat, userLng, coord[1], coord[0]);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPoint = { lat: coord[1], lng: coord[0] };
        closestSegmentIndex = segIdx;
      }
    }
  }
  
  return closestPoint ? { point: closestPoint, distance: closestDistance, segmentIndex: closestSegmentIndex } : null;
}

// Distance threshold in meters - if user is farther than this, show "return to route"
const OFF_ROUTE_THRESHOLD = 100; // 100 meters

function NavigationInstructionBarInner({
  route,
  currentSegmentIndex,
  onEndNavigation,
  isWeatherCollapsed = false,
  onToggleWeather,
  userLocation,
  onReturnPointChange,
  onPreviewRoute,
  onEditRoute,
}: NavigationInstructionBarProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  
  // Safety checks
  if (!route || !route.segments || route.segments.length === 0) {
    return null;
  }
  
  const currentSegment = route.segments[currentSegmentIndex];
  const nextSegment = route.segments[currentSegmentIndex + 1];
  
  // Check if user is off-route
  const offRouteInfo = useMemo(() => {
    if (!userLocation) return null;
    
    const closest = findClosestPointOnRoute(userLocation.lat, userLocation.lng, route);
    if (!closest) return null;
    
    if (closest.distance > OFF_ROUTE_THRESHOLD) {
      // Notify parent about the return point for map display
      onReturnPointChange?.(closest.point);
      return {
        distance: closest.distance,
        returnPoint: closest.point,
        segmentIndex: closest.segmentIndex,
      };
    } else {
      onReturnPointChange?.(null);
      return null;
    }
  }, [userLocation, route, onReturnPointChange]);
  
  // Calculate remaining time from current segment onwards
  const remainingTime = useMemo(() => {
    let time = 0;
    for (let i = currentSegmentIndex; i < route.segments.length; i++) {
      time += route.segments[i].time;
    }
    return time;
  }, [route.segments, currentSegmentIndex]);
  
  // Calculate ETA
  const eta = useMemo(() => {
    const now = new Date();
    const etaDate = new Date(now.getTime() + remainingTime * 1000);
    return etaDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [remainingTime]);
  
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
  
  // Get instruction text for a segment
  const getInstruction = (segment: typeof currentSegment, segmentIndex?: number) => {
    if (!segment) return '';
    
    if (segment.type === 'walk') {
      return 'Walk/skate';
    } else if (segment.type === 'lift') {
      return `Take ${segment.name || 'lift'}`;
    } else if (segment.type === 'run') {
      // If unnamed, show "Connection to X"
      if (!segment.name && segmentIndex !== undefined) {
        const destination = getConnectionDestination(segmentIndex);
        if (destination) {
          return `Connection to ${destination}`;
        }
      }
      return `Ski ${segment.name || 'run'}`;
    }
    return segment.name || 'Continue';
  };
  
  // Get icon for segment type
  const getIcon = (segment: typeof currentSegment) => {
    if (!segment) return null;
    
    if (segment.type === 'walk') {
      return (
        <span 
          style={{ 
            display: 'inline-block',
            width: 10, 
            height: 10, 
            borderRadius: '50%',
            backgroundColor: '#f97316',
          }} 
        />
      );
    } else if (segment.type === 'lift') {
      return <SwapOutlined style={{ fontSize: 12, color: '#52c41a' }} />;
    } else if (segment.type === 'run') {
      return (
        <span 
          style={{ 
            display: 'inline-block',
            width: 10, 
            height: 10, 
            borderRadius: '50%',
            backgroundColor: getDifficultyColor(segment.difficulty),
          }} 
        />
      );
    }
    return <EnvironmentOutlined style={{ fontSize: 12 }} />;
  };

  if (!currentSegment) return null;

  // Collapsed mini view - just shows icon + current instruction + ETA
  if (!isExpanded) {
    return (
      <div className={`nav-instruction-bar nav-instruction-bar-mini ${offRouteInfo ? 'off-route' : ''}`}>
        <div className="nav-mini-content" onClick={() => setIsExpanded(true)}>
          <CompassOutlined style={{ fontSize: 14, color: offRouteInfo ? '#f59e0b' : '#22c55e', marginRight: 8 }} />
          <span className="nav-mini-instruction">
            {offRouteInfo ? (
              <>
                <span style={{ marginRight: 4 }}>⚠️</span>
                <span>Return to route ({Math.round(offRouteInfo.distance)}m)</span>
              </>
            ) : (
              <>
                {getIcon(currentSegment)}
                <span style={{ marginLeft: 4 }}>{getInstruction(currentSegment, currentSegmentIndex)}</span>
              </>
            )}
          </span>
          <span className="nav-mini-eta">ETA {eta}</span>
          <UpOutlined style={{ fontSize: 10, marginLeft: 8, color: '#666' }} />
        </div>
        <button className="nav-end-btn-mini" onClick={onEndNavigation}>
          <CloseOutlined style={{ fontSize: 10 }} />
        </button>
      </div>
    );
  }

  return (
    <div className={`nav-instruction-bar ${offRouteInfo ? 'off-route' : ''}`}>
      {/* Off-route warning */}
      {offRouteInfo && (
        <div className="nav-off-route-warning">
          <span style={{ marginRight: 6 }}>⚠️</span>
          <span>You are {Math.round(offRouteInfo.distance)}m off route</span>
        </div>
      )}
      
      {/* Header with collapse toggle */}
      <div className="nav-instruction-header">
        <div className="nav-instruction-current">
          <div className="nav-instruction-icon">
            {offRouteInfo ? (
              <span style={{ fontSize: 14 }}>📍</span>
            ) : (
              getIcon(currentSegment)
            )}
          </div>
          <div className="nav-instruction-text">
            <span className="nav-instruction-action">
              {offRouteInfo ? 'Return to route' : getInstruction(currentSegment, currentSegmentIndex)}
            </span>
            <span className="nav-instruction-detail">
              {offRouteInfo 
                ? `Head to nearest point on your route`
                : (currentSegment.type !== 'walk' 
                    ? `${formatDuration(currentSegment.time)} · ${Math.round(currentSegment.distance)}m`
                    : ''
                  )
              }
            </span>
          </div>
        </div>
        <button 
          className="nav-collapse-btn"
          onClick={() => setIsExpanded(false)}
          title="Collapse"
        >
          <DownOutlined style={{ fontSize: 10 }} />
        </button>
      </div>
      
      {/* Next step preview - shows actual next step when off-route, or following step when on-route */}
      <div className="nav-instruction-next">
        <span style={{ color: '#666', fontSize: 9 }}>{offRouteInfo ? 'THEN:' : 'NEXT:'}</span>
        <span className="nav-instruction-next-text">
          {offRouteInfo ? (
            <>
              {getIcon(currentSegment)}
              <span style={{ marginLeft: 4 }}>{getInstruction(currentSegment, currentSegmentIndex)}</span>
            </>
          ) : nextSegment ? (
            <>
              {getIcon(nextSegment)}
              <span style={{ marginLeft: 4 }}>{getInstruction(nextSegment, currentSegmentIndex + 1)}</span>
            </>
          ) : (
            <span style={{ color: '#22c55e' }}>🏁 Arrive at destination</span>
          )}
        </span>
      </div>
      
      {/* Time info and buttons */}
      <div className="nav-instruction-footer">
        <div className="nav-instruction-time">
          <div className="nav-time-item">
            <span className="nav-time-label">Remaining</span>
            <span className="nav-time-value">{formatDuration(remainingTime)}</span>
          </div>
          <div className="nav-time-divider" />
          <div className="nav-time-item">
            <span className="nav-time-label">ETA</span>
            <span className="nav-time-value">{eta}</span>
          </div>
        </div>
        
        <div className="nav-footer-buttons">
          {onPreviewRoute && (
            <button 
              className="nav-action-btn"
              onClick={onPreviewRoute}
              title="Preview full route"
            >
              <FullscreenOutlined style={{ fontSize: 10, marginRight: 3 }} />
              Overview
            </button>
          )}
          {onEditRoute && (
            <button 
              className="nav-action-btn"
              onClick={onEditRoute}
              title="Edit route"
            >
              <EditOutlined style={{ fontSize: 10, marginRight: 3 }} />
              Edit
            </button>
          )}
          {onToggleWeather && (
            <button 
              className="nav-toggle-weather-btn"
              onClick={onToggleWeather}
              title={isWeatherCollapsed ? 'Show weather' : 'Hide weather'}
            >
              {isWeatherCollapsed ? 'Show' : 'Hide'} weather
            </button>
          )}
          <button className="nav-end-btn" onClick={onEndNavigation}>
            <CloseOutlined style={{ fontSize: 10, marginRight: 4 }} />
            End
          </button>
        </div>
      </div>
      
      {/* Progress indicator */}
      <div className="nav-instruction-progress">
        <div 
          className="nav-instruction-progress-bar" 
          style={{ width: `${((currentSegmentIndex + 1) / route.segments.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

const NavigationInstructionBar = memo(NavigationInstructionBarInner);
export default NavigationInstructionBar;

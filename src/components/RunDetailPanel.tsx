'use client';

import { memo, useEffect, useState, useCallback } from 'react';
import { Tooltip, Button } from 'antd';
import type { MapRef } from '@/components/Map/SkiMap';
import { CloseOutlined, StarOutlined, EnvironmentOutlined, DeleteOutlined } from '@ant-design/icons';
import type { RunData } from '@/lib/types';
import type { RunSunAnalysis, RunStats } from '@/lib/sunny-time-calculator';
import { getDifficultyColor } from '@/lib/shade-calculator';
import { getConditionInfo, type SnowCondition, type SnowQualityAtPoint } from '@/lib/snow-quality';
import { ConditionIcon } from '@/components/SnowQualityBadge';

// Hourly sun data type
interface HourlySunData {
  hour: number;
  percentage: number;
}

// Re-export the type for external use
export type SnowQualityPoint = SnowQualityAtPoint;

// Format time helper
function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// Get color for snow condition
function getConditionColor(condition: SnowCondition): string {
  return getConditionInfo(condition).color;
}

// Sun icon component
function SunIcon({ level }: { level: 'full' | 'partial' | 'low' | 'none' }) {
  if (level === 'full') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="#faad14">
        <circle cx="12" cy="12" r="5" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => {
          const x1 = 12 + 7 * Math.cos((angle * Math.PI) / 180);
          const y1 = 12 + 7 * Math.sin((angle * Math.PI) / 180);
          const x2 = 12 + 10 * Math.cos((angle * Math.PI) / 180);
          const y2 = 12 + 10 * Math.sin((angle * Math.PI) / 180);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#faad14" strokeWidth="2" strokeLinecap="round" />;
        })}
      </svg>
    );
  }
  if (level === 'partial') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24">
        <defs>
          <clipPath id="halfSun">
            <rect x="0" y="0" width="12" height="24" />
          </clipPath>
        </defs>
        <g clipPath="url(#halfSun)">
          <circle cx="12" cy="12" r="5" fill="#d4a017" />
          {[180, 225, 270, 315].map((angle, i) => {
            const x1 = 12 + 7 * Math.cos((angle * Math.PI) / 180);
            const y1 = 12 + 7 * Math.sin((angle * Math.PI) / 180);
            const x2 = 12 + 10 * Math.cos((angle * Math.PI) / 180);
            const y2 = 12 + 10 * Math.sin((angle * Math.PI) / 180);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#d4a017" strokeWidth="2" strokeLinecap="round" />;
          })}
        </g>
        <circle cx="12" cy="12" r="5" fill="none" stroke="#555" strokeWidth="1" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="5" fill="none" stroke="#555" strokeWidth="2" />
    </svg>
  );
}

// Sun distribution chart - exported for reuse
export function SunDistributionChart({ hourlyData }: { hourlyData: HourlySunData[] }) {
  const START_HOUR = 7;
  const END_HOUR = 18;
  
  const hourMap: Record<number, number> = {};
  hourlyData.forEach(data => {
    hourMap[data.hour] = data.percentage;
  });
  
  const hours: { hour: number; percentage: number }[] = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) {
    hours.push({
      hour: h,
      percentage: hourMap[h] ?? 0,
    });
  }
  
  return (
    <div style={{ padding: '4px 0' }}>
      <div className="flex items-end gap-px" style={{ height: 40 }}>
        {hours.map((data, i) => (
          <Tooltip key={i} title={`${data.hour}:00 - ${Math.round(data.percentage)}% sun`}>
            <div
              style={{
                flex: 1,
                height: `${Math.max(data.percentage, 2)}%`,
                minHeight: 2,
                background: data.percentage > 75 ? '#faad14' : data.percentage > 50 ? '#d4a017' : data.percentage > 25 ? '#8b7500' : '#222',
                borderRadius: '2px 2px 0 0',
                cursor: 'help',
              }}
            />
          </Tooltip>
        ))}
      </div>
      <div className="flex justify-between" style={{ fontSize: 8, color: '#555', marginTop: 2 }}>
        <span>7am</span>
        <span>12pm</span>
        <span>6pm</span>
      </div>
    </div>
  );
}

// Run stats display - exported for reuse (distance and elevation only - slopes shown on chart)
export function RunStatsDisplay({ stats }: { stats: RunStats }) {
  const formatDistance = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
  
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1" style={{ fontSize: 10, color: '#888' }}>
      {stats.distance > 0 && (
        <span>📏 <span style={{ color: '#ccc' }}>{formatDistance(stats.distance)}</span></span>
      )}
      {stats.hasElevation && (
        <>
          <span>↓ <span style={{ color: '#ccc' }}>{Math.round(stats.descent)}m</span></span>
          {stats.ascent > 10 && (
            <span>↑ <span style={{ color: '#ccc' }}>{Math.round(stats.ascent)}m</span></span>
          )}
        </>
      )}
    </div>
  );
}

// Temperature calculation using standard atmospheric lapse rate
// Standard lapse rate: 6.5°C per 1000m (0.0065°C per meter)
const LAPSE_RATE = 6.5; // °C per 1000m

function calculateTemperatureAtAltitude(
  baseTemp: number,
  baseAltitude: number,
  targetAltitude: number
): number {
  const altitudeDiff = targetAltitude - baseAltitude;
  return baseTemp - (altitudeDiff / 1000) * LAPSE_RATE;
}

// Temperature data for elevation profile
export interface TemperatureData {
  temperature: number; // Temperature at the weather station
  stationAltitude: number; // Altitude of the weather station
}

// Elevation profile chart - exported for reuse
export function ElevationProfileChart({ 
  profile, 
  maxSlope, 
  avgSlope, 
  snowQuality,
  temperatureData,
}: { 
  profile: { distance: number; elevation: number }[];
  maxSlope: number;
  avgSlope: number;
  snowQuality?: SnowQualityPoint[];
  temperatureData?: TemperatureData;
}) {
  if (profile.length < 2) return null;
  
  const maxElev = Math.max(...profile.map(p => p.elevation));
  const minElev = Math.min(...profile.map(p => p.elevation));
  const elevRange = maxElev - minElev || 1;
  const maxDist = profile[profile.length - 1].distance || 1;
  
  // Simple 0-100 coordinate system for SVG (no margins in SVG, we use HTML for labels)
  const points = profile.map(p => ({
    x: maxDist > 0 ? (p.distance / maxDist) * 100 : 0,
    y: 100 - ((p.elevation - minElev) / elevRange) * 100,
    elevation: p.elevation,
    distance: p.distance,
  }));
  
  const pointsWithSnow = points.map(p => {
    const snowPoint = snowQuality?.find(sq => Math.abs(sq.altitude - p.elevation) < 50);
    return { ...p, condition: snowPoint?.condition };
  });

  // Get unique conditions for legend
  const uniqueConditions = snowQuality && snowQuality.length > 0
    ? [...new Set(snowQuality.map(sq => sq.condition))]
    : [];

  // Get the dominant condition (most common)
  const dominantCondition = snowQuality && snowQuality.length > 0
    ? snowQuality.reduce((acc, sq) => {
        acc[sq.condition] = (acc[sq.condition] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    : null;
  
  const mainCondition = dominantCondition 
    ? Object.entries(dominantCondition).sort((a, b) => b[1] - a[1])[0]?.[0] as SnowCondition
    : null;
  
  // Format distance for axis labels
  const formatDist = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
  
  // Calculate temperatures at top, middle, and bottom of the run
  const temperatures = temperatureData ? {
    top: calculateTemperatureAtAltitude(
      temperatureData.temperature,
      temperatureData.stationAltitude,
      maxElev
    ),
    middle: calculateTemperatureAtAltitude(
      temperatureData.temperature,
      temperatureData.stationAltitude,
      (maxElev + minElev) / 2
    ),
    bottom: calculateTemperatureAtAltitude(
      temperatureData.temperature,
      temperatureData.stationAltitude,
      minElev
    ),
  } : null;
  
  return (
    <div style={{ padding: '4px 0' }}>
      {/* Chart with HTML labels */}
      <div style={{ display: 'flex', gap: 4 }}>
        {/* Y-axis labels - Elevation (left side) */}
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'space-between', 
          fontSize: 9, 
          color: '#888',
          textAlign: 'right',
          paddingTop: 2,
          paddingBottom: 2,
          minWidth: 36,
        }}>
          <span>{Math.round(maxElev)}m</span>
          <span>{Math.round(minElev)}m</span>
        </div>
        
        {/* Chart area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* SVG chart */}
          <div style={{ position: 'relative', width: '100%', height: 50, background: '#1a1a1a', borderRadius: 4 }}>
            <svg 
              viewBox="0 0 100 100" 
              style={{ width: '100%', height: '100%', display: 'block' }} 
              preserveAspectRatio="none"
            >
              {/* Fill gradient under curve */}
              {snowQuality && snowQuality.length > 0 && (
                <>
                  <defs>
                    <linearGradient id="snowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      {pointsWithSnow.map((p, i) => (
                        <stop 
                          key={i} 
                          offset={`${p.x}%`} 
                          stopColor={p.condition ? getConditionColor(p.condition) : '#333'}
                          stopOpacity="0.35"
                        />
                      ))}
                    </linearGradient>
                  </defs>
                  <path
                    d={`M 0 100 ${points.map(p => `L ${p.x} ${p.y}`).join(' ')} L 100 100 Z`}
                    fill="url(#snowGradient)"
                  />
                </>
              )}
              {(!snowQuality || snowQuality.length === 0) && (
                <path
                  d={`M 0 100 ${points.map(p => `L ${p.x} ${p.y}`).join(' ')} L 100 100 Z`}
                  fill="rgba(102, 102, 102, 0.2)"
                />
              )}
              
              {/* Elevation profile line - colored by snow condition */}
              {snowQuality && snowQuality.length > 0 ? (
                pointsWithSnow.slice(1).map((p, i) => (
                  <line
                    key={i}
                    x1={pointsWithSnow[i].x}
                    y1={pointsWithSnow[i].y}
                    x2={p.x}
                    y2={p.y}
                    stroke={p.condition ? getConditionColor(p.condition) : '#888'}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                ))
              ) : (
                <path
                  d={points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
                  fill="none"
                  stroke="#888"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
          </div>
          
          {/* X-axis labels (HTML, not stretched) */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            fontSize: 9, 
            color: '#888',
            marginTop: 2,
          }}>
            <span>0m</span>
            <span>{formatDist(maxDist / 2)}</span>
            <span>{formatDist(maxDist)}</span>
          </div>
        </div>
        
        {/* Y-axis labels - Temperature (right side) */}
        {temperatures && (
          <Tooltip title="Estimated temperature based on altitude (using standard atmospheric lapse rate: -6.5°C per 1000m)">
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              justifyContent: 'space-between', 
              fontSize: 9, 
              color: '#4fc3f7',
              textAlign: 'left',
              paddingTop: 2,
              paddingBottom: 2,
              minWidth: 32,
              cursor: 'help',
            }}>
              <span>{Math.round(temperatures.top)}°C</span>
              <span style={{ color: '#81d4fa' }}>{Math.round(temperatures.middle)}°C</span>
              <span>{Math.round(temperatures.bottom)}°C</span>
            </div>
          </Tooltip>
        )}
      </div>
      
      {/* Slope info */}
      <div className="flex justify-between items-center" style={{ fontSize: 9, color: '#666', marginTop: 6 }}>
        <Tooltip title="Average and maximum slope steepness (gradient)">
          <span style={{ cursor: 'help' }}>
            Gradient: avg <span style={{ color: '#aaa' }}>{Math.round(avgSlope)}°</span> · max <span style={{ color: '#f97316', fontWeight: 600 }}>{Math.round(maxSlope)}°</span>
          </span>
        </Tooltip>
        <span style={{ color: '#555' }}>
          ↓{Math.round(maxElev - minElev)}m drop
        </span>
      </div>
      
      {/* Snow condition legend */}
      {uniqueConditions.length > 0 && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ fontSize: 9, color: '#666', marginBottom: 4 }}>
            Snow quality along run:
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {uniqueConditions.map(condition => {
              const info = getConditionInfo(condition);
              const count = snowQuality!.filter(sq => sq.condition === condition).length;
              const percentage = Math.round((count / snowQuality!.length) * 100);
              return (
                <Tooltip 
                  key={condition}
                  title={info.tooltip || `${info.label} conditions`}
                >
                  <span 
                    style={{ 
                      fontSize: 9, 
                      display: 'inline-flex', 
                      alignItems: 'center', 
                      gap: 3,
                      cursor: 'help',
                    }}
                  >
                    <span 
                      style={{ 
                        width: 8, 
                        height: 8, 
                        borderRadius: 2, 
                        background: info.color,
                        flexShrink: 0,
                      }} 
                    />
                    <span style={{ color: info.color }}>
                      {info.label}
                    </span>
                    <span style={{ color: '#555' }}>
                      {percentage}%
                    </span>
                  </span>
                </Tooltip>
              );
            })}
          </div>
        </div>
      )}
      
      {/* Main condition summary when no detailed breakdown */}
      {mainCondition && uniqueConditions.length === 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 9, color: '#888' }}>
            <Tooltip 
              title={
                <div style={{ fontSize: 11 }}>
                  <strong>Expected Conditions</strong>: {getConditionInfo(mainCondition).tooltip}
                </div>
              }
            >
              <span style={{ cursor: 'help', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Snow: 
                <ConditionIcon 
                  iconType={getConditionInfo(mainCondition).iconType} 
                  style={{ fontSize: 11, color: getConditionInfo(mainCondition).color }} 
                />
                <span style={{ color: getConditionInfo(mainCondition).color, fontWeight: 600 }}>
                  {getConditionInfo(mainCondition).label}
                </span>
              </span>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}

// Props for the panel
export interface RunDetailPanelProps {
  run: RunData;
  analysis?: RunSunAnalysis;
  stats: RunStats | null;
  snowQuality?: SnowQualityPoint[];
  temperatureData?: TemperatureData;
  isFavourite: boolean;
  onClose: () => void;
  onToggleFavourite: () => void;
  onGoToMap?: () => void;
  showGoToMap?: boolean;
}

// Main panel component - used as overlay and in sidebar
export const RunDetailPanel = memo(function RunDetailPanel({
  run,
  analysis,
  stats,
  snowQuality,
  temperatureData,
  isFavourite,
  onClose,
  onToggleFavourite,
  onGoToMap,
  showGoToMap = false,
}: RunDetailPanelProps) {
  const difficultyColor = getDifficultyColor(run.difficulty || 'unknown');
  const sunLevel = analysis?.sunLevel;
  const hasSunInfo = analysis?.sunniestWindow && sunLevel && sunLevel !== 'none';
  const sunnyTime = hasSunInfo 
    ? `${formatTime(analysis.sunniestWindow!.startTime)}-${formatTime(analysis.sunniestWindow!.endTime)}`
    : null;
  const sunColor = sunLevel === 'full' ? '#faad14' : sunLevel === 'partial' ? '#d4a017' : '#888';
  
  // Get the dominant condition (most common)
  const conditionCounts = snowQuality && snowQuality.length > 0
    ? snowQuality.reduce((acc, sq) => {
        acc[sq.condition] = (acc[sq.condition] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    : null;
  
  const mainCondition = conditionCounts 
    ? Object.entries(conditionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as SnowCondition
    : null;
  
  return (
    <div 
      className="run-detail-panel"
      style={{
        background: 'rgba(26, 26, 26, 0.98)',
        borderRadius: 8,
        padding: 12,
        minWidth: 260,
        maxWidth: 320,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        border: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div 
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: difficultyColor }}
          />
          <div className="min-w-0">
            <div style={{ fontSize: 14, color: '#fff', fontWeight: 600, lineHeight: 1.2 }}>
              {run.name || 'Unnamed Run'}
            </div>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 11, color: difficultyColor }}>
                {run.difficulty || 'Unknown'}
              </span>
              {run.subRegionName && (
                <span style={{ 
                  fontSize: 9, 
                  color: '#60a5fa',
                  background: 'rgba(96, 165, 250, 0.15)',
                  padding: '1px 5px',
                  borderRadius: 3
                }}>
                  {run.subRegionName}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ 
            fontSize: 16, 
            color: '#666', 
            background: 'none', 
            border: 'none', 
            cursor: 'pointer',
            padding: 4,
            lineHeight: 1,
          }}
        >
          <CloseOutlined />
        </button>
      </div>
      
      {/* Quick info row */}
      <div className="flex items-center gap-3 mb-3" style={{ fontSize: 10, color: '#888' }}>
        {hasSunInfo && (
          <span style={{ color: sunColor }} className="flex items-center gap-1">
            <SunIcon level={sunLevel} />
            <span>{sunnyTime}</span>
          </span>
        )}
        {mainCondition && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            Snow: 
            <ConditionIcon 
              iconType={getConditionInfo(mainCondition).iconType} 
              style={{ fontSize: 10, color: getConditionInfo(mainCondition).color }} 
            />
            <span style={{ color: getConditionInfo(mainCondition).color, fontWeight: 600 }}>
              {getConditionInfo(mainCondition).label}
            </span>
          </span>
        )}
      </div>
      
      {/* Sun distribution chart */}
      {analysis && (
        <div className="mb-3">
          <div style={{ color: '#888', marginBottom: 2, fontSize: 9 }}>Sun exposure by hour</div>
          <SunDistributionChart hourlyData={analysis.hourlyPercentages} />
        </div>
      )}
      
      {/* Run stats */}
      {stats && (
        <div className="mb-3">
          <RunStatsDisplay stats={stats} />
        </div>
      )}
      
      {/* Elevation profile with snow quality */}
      {stats?.hasElevation && stats.elevationProfile.length > 1 && (
        <div className="mb-3">
          <div style={{ color: '#888', marginBottom: 2, fontSize: 9 }}>Elevation & snow quality{temperatureData ? ' & temperature' : ''}</div>
          <ElevationProfileChart 
            profile={stats.elevationProfile} 
            maxSlope={stats.maxSlope}
            avgSlope={stats.avgSlope}
            snowQuality={snowQuality}
            temperatureData={temperatureData}
          />
        </div>
      )}
      
      {/* Action buttons */}
      <div className="flex gap-2">
        {showGoToMap && onGoToMap && (
          <Button 
            size="small" 
            icon={<EnvironmentOutlined />}
            onClick={onGoToMap}
            style={{ flex: 1, fontSize: 11 }}
          >
            Go to map
          </Button>
        )}
        <Button
          size="small"
          type="default"
          danger={isFavourite}
          icon={isFavourite ? <DeleteOutlined /> : <StarOutlined />}
          onClick={onToggleFavourite}
          style={{ 
            flex: 1, 
            fontSize: 11,
          }}
        >
          {isFavourite ? 'Remove' : 'Add to Favourites'}
        </Button>
      </div>
    </div>
  );
});

// Overlay wrapper - positions the panel over the map, tracking map coordinates
export interface RunDetailOverlayProps extends RunDetailPanelProps {
  lngLat: { lng: number; lat: number };
  mapRef: React.MutableRefObject<MapRef | null>;
}

export const RunDetailOverlay = memo(function RunDetailOverlay({
  lngLat,
  mapRef,
  ...panelProps
}: RunDetailOverlayProps) {
  const [screenPos, setScreenPos] = useState<{ x: number; y: number } | null>(null);
  
  // Project lngLat to screen coordinates
  const updatePosition = useCallback(() => {
    // Check if mapRef and project method are available
    if (!mapRef.current || typeof mapRef.current.project !== 'function') return;
    
    const point = mapRef.current.project([lngLat.lng, lngLat.lat]);
    if (point) {
      setScreenPos({ x: point.x, y: point.y });
    }
  }, [lngLat.lng, lngLat.lat, mapRef]);
  
  // Update position on mount and when map moves
  useEffect(() => {
    // Initial update
    updatePosition();
    
    // Retry after a short delay if position not set (map might not be ready)
    const retryTimeout = setTimeout(updatePosition, 100);
    
    const map = mapRef.current;
    if (!map || typeof map.on !== 'function') {
      return () => clearTimeout(retryTimeout);
    }
    
    // Listen for map movements
    const handleMove = () => updatePosition();
    map.on('move', handleMove);
    map.on('zoom', handleMove);
    
    return () => {
      clearTimeout(retryTimeout);
      if (typeof map.off === 'function') {
        map.off('move', handleMove);
        map.off('zoom', handleMove);
      }
    };
  }, [updatePosition, mapRef]);
  
  // Don't render until we have a position
  if (!screenPos) return null;
  
  return (
    <div 
      className="run-detail-overlay"
      style={{
        position: 'absolute',
        top: screenPos.y,
        left: screenPos.x,
        transform: 'translate(-50%, -100%)',
        zIndex: 1000,
        animation: 'fadeIn 0.15s ease-out',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <RunDetailPanel {...panelProps} />
      {/* Arrow pointer */}
      <div 
        style={{
          position: 'absolute',
          bottom: -8,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '8px solid transparent',
          borderRight: '8px solid transparent',
          borderTop: '8px solid rgba(26, 26, 26, 0.98)',
        }}
      />
    </div>
  );
});

export default RunDetailPanel;


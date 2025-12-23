'use client';

import { memo, useEffect, useState, useCallback } from 'react';
import { Tooltip, Button } from 'antd';
import type { MapRef } from '@/components/Map/SkiMap';
import { CloseOutlined, EnvironmentOutlined, ClockCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { LiftData } from '@/lib/types';
import type { EnrichedLiftData } from '@/lib/lift-status-types';

// Helper to check if lift is enriched
function isEnrichedLift(lift: LiftData | EnrichedLiftData): lift is EnrichedLiftData {
  return 'liveStatus' in lift || 'closingTime' in lift || 'minutesUntilClose' in lift;
}

// Props for the panel
export interface LiftDetailPanelProps {
  lift: LiftData | EnrichedLiftData;
  onClose: () => void;
  onGoToMap?: () => void;
  showGoToMap?: boolean;
}

// Main panel component - used as overlay and in sidebar
export const LiftDetailPanel = memo(function LiftDetailPanel({
  lift,
  onClose,
  onGoToMap,
  showGoToMap = false,
}: LiftDetailPanelProps) {
  // Status colors
  const statusColors: Record<string, { bg: string; color: string; label: string }> = {
    open: { bg: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', label: 'Open' },
    closed: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', label: 'Closed' },
    scheduled: { bg: 'rgba(234, 179, 8, 0.15)', color: '#eab308', label: 'Scheduled' },
    unknown: { bg: 'rgba(136, 136, 136, 0.15)', color: '#888', label: 'Unknown' },
  };

  const statusStyle = lift.status && statusColors[lift.status] ? statusColors[lift.status] : statusColors.unknown;

  // Extract enriched data if available
  const enriched = isEnrichedLift(lift) ? lift : null;
  const liveStatus = enriched?.liveStatus;
  const openingTimes = liveStatus?.openingTimes?.[0];
  const statusMessage = liveStatus?.message;
  const speed = liveStatus?.speed;
  const capacity = liveStatus?.uphillCapacity;
  const duration = liveStatus?.duration;
  const length = liveStatus?.length;
  const minutesUntilClose = enriched?.minutesUntilClose;
  const closingSoon = typeof minutesUntilClose === 'number' && minutesUntilClose > 0 && minutesUntilClose <= 60;
  const waitingTime = enriched?.waitingTime ?? liveStatus?.waitingTime;
  const hasLongWait = typeof waitingTime === 'number' && waitingTime > 10;

  return (
    <div
      className="lift-detail-panel"
      style={{
        background: 'rgba(26, 26, 26, 0.98)',
        borderRadius: 8,
        padding: 12,
        minWidth: 240,
        maxWidth: 300,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        border: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <div style={{ fontSize: 14, color: '#fff', fontWeight: 600, lineHeight: 1.2 }}>
            {lift.name || 'Unnamed Lift'}
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            {lift.liftType && (
              <span style={{ fontSize: 11, color: '#888' }}>
                {lift.liftType}
              </span>
            )}
            {lift.status && lift.status !== 'unknown' && (
              <span style={{
                fontSize: 9,
                color: statusStyle.color,
                background: statusStyle.bg,
                padding: '1px 5px',
                borderRadius: 3,
                fontWeight: 600
              }}>
                {statusStyle.label}
              </span>
            )}
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

      {/* Opening times and closing soon */}
      {openingTimes && (
        <div className="flex items-center gap-2 mb-3" style={{ fontSize: 10, color: '#888' }}>
          <ClockCircleOutlined style={{ fontSize: 10 }} />
          <span>{openingTimes.beginTime} - {openingTimes.endTime}</span>
          {closingSoon && (
            <span style={{ color: '#eab308', fontWeight: 600 }}>({minutesUntilClose}min left)</span>
          )}
        </div>
      )}

      {/* Waiting time */}
      {typeof waitingTime === 'number' && (
        <div
          className="flex items-center gap-2 mb-3"
          style={{
            fontSize: 11,
            color: hasLongWait ? '#f97316' : '#22c55e',
            padding: '4px 8px',
            background: hasLongWait ? 'rgba(249, 115, 22, 0.15)' : 'rgba(34, 197, 94, 0.1)',
            borderRadius: 4,
            fontWeight: 600
          }}
        >
          <ClockCircleOutlined style={{ fontSize: 11 }} />
          <span>
            {waitingTime === 0 ? 'No wait' : `${waitingTime} min wait`}
          </span>
        </div>
      )}

      {/* Technical info */}
      {(speed || capacity || duration || length) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3" style={{ fontSize: 10, color: '#888' }}>
          {speed && (
            <span>
              <span style={{ color: '#666' }}>Speed:</span>{' '}
              <span style={{ color: '#ccc' }}>{speed} m/s</span>
            </span>
          )}
          {capacity && (
            <span>
              <span style={{ color: '#666' }}>Capacity:</span>{' '}
              <span style={{ color: '#ccc' }}>{capacity} pers/h</span>
            </span>
          )}
          {duration && (
            <span>
              <span style={{ color: '#666' }}>Duration:</span>{' '}
              <span style={{ color: '#ccc' }}>{duration} min</span>
            </span>
          )}
          {length && (
            <span>
              <span style={{ color: '#666' }}>Length:</span>{' '}
              <span style={{ color: '#ccc' }}>{length >= 1000 ? `${(length/1000).toFixed(1)}km` : `${length}m`}</span>
            </span>
          )}
        </div>
      )}

      {/* Status message from resort API */}
      {statusMessage && (
        <div
          className="mb-3"
          style={{
            fontSize: 10,
            color: '#f97316',
            padding: '6px 8px',
            background: 'rgba(249, 115, 22, 0.1)',
            borderRadius: 4
          }}
        >
          <InfoCircleOutlined style={{ marginRight: 4 }} />
          {statusMessage}
        </div>
      )}

      {/* Action buttons */}
      {showGoToMap && onGoToMap && (
        <div className="flex gap-2">
          <Button
            size="small"
            icon={<EnvironmentOutlined />}
            onClick={onGoToMap}
            style={{ flex: 1, fontSize: 11 }}
          >
            Go to map
          </Button>
        </div>
      )}
    </div>
  );
});

// Overlay wrapper - positions the panel over the map, tracking map coordinates
export interface LiftDetailOverlayProps extends LiftDetailPanelProps {
  lngLat: { lng: number; lat: number };
  mapRef: React.MutableRefObject<MapRef | null>;
}

export const LiftDetailOverlay = memo(function LiftDetailOverlay({
  lngLat,
  mapRef,
  ...panelProps
}: LiftDetailOverlayProps) {
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
      className="lift-detail-overlay"
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
      <LiftDetailPanel {...panelProps} />
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

export default LiftDetailPanel;

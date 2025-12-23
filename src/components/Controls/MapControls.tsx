'use client';

import { useCallback, memo } from 'react';
import { Tooltip } from 'antd';
import {
  PlusOutlined,
  MinusOutlined,
  CompassOutlined,
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

interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetBearing: () => void;
  bearing: number;
  is3D: boolean;
  onToggle3D: (is3D: boolean) => void;
}

function MapControlsInner({
  onZoomIn,
  onZoomOut,
  onResetBearing,
  bearing,
  is3D,
  onToggle3D,
}: MapControlsProps) {
  const handleZoomIn = useCallback(() => {
    trackEvent('map_zoom_in');
    onZoomIn();
  }, [onZoomIn]);

  const handleZoomOut = useCallback(() => {
    trackEvent('map_zoom_out');
    onZoomOut();
  }, [onZoomOut]);

  const handleResetBearing = useCallback(() => {
    trackEvent('map_reset_bearing');
    onResetBearing();
  }, [onResetBearing]);

  const handleToggle3D = useCallback(() => {
    const newState = !is3D;
    trackEvent('map_3d_toggle', { is_3d: newState });
    onToggle3D(newState);
  }, [is3D, onToggle3D]);

  // Only show compass reset button when bearing is not north
  const showCompassReset = Math.abs(bearing) > 1;

  return (
    <div className="map-controls">
      {/* Zoom In */}
      <MobileAwareTooltip title="Zoom in" placement="left">
        <button
          className="location-btn"
          onClick={handleZoomIn}
          aria-label="Zoom in"
        >
          <PlusOutlined style={{ fontSize: 14 }} />
        </button>
      </MobileAwareTooltip>

      {/* Zoom Out */}
      <MobileAwareTooltip title="Zoom out" placement="left">
        <button
          className="location-btn"
          onClick={handleZoomOut}
          aria-label="Zoom out"
        >
          <MinusOutlined style={{ fontSize: 14 }} />
        </button>
      </MobileAwareTooltip>

      {/* Compass / Reset Bearing - only visible when rotated */}
      {showCompassReset && (
        <MobileAwareTooltip title="Reset north" placement="left">
          <button
            className="location-btn compass-btn"
            onClick={handleResetBearing}
            aria-label="Reset to north"
            style={{
              transform: `rotate(${-bearing}deg)`,
            }}
          >
            <CompassOutlined style={{ fontSize: 14 }} />
          </button>
        </MobileAwareTooltip>
      )}

      {/* 3D / 2D Toggle */}
      <MobileAwareTooltip title={is3D ? 'Switch to 2D view' : 'Switch to 3D view'} placement="left">
        <button
          className={`location-btn view-toggle-btn ${is3D ? 'active' : ''}`}
          onClick={handleToggle3D}
          aria-label={is3D ? 'Switch to 2D view' : 'Switch to 3D view'}
        >
          {is3D ? '2D' : '3D'}
        </button>
      </MobileAwareTooltip>
    </div>
  );
}

const MapControls = memo(MapControlsInner);
export default MapControls;

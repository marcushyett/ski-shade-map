'use client';

import { memo } from 'react';
import { Tooltip, Segmented } from 'antd';
import { 
  EyeOutlined,
  SunOutlined,
  AlertOutlined,
  GlobalOutlined,
} from '@ant-design/icons';

export type MapOverlayMode = 'shadow' | 'sun-exposure' | 'avalanche' | 'satellite';

interface MapLayerToggleProps {
  mode: MapOverlayMode;
  onChange: (mode: MapOverlayMode) => void;
}

function MapLayerToggleInner({ mode, onChange }: MapLayerToggleProps) {
  return (
    <div className="map-layer-toggle">
      <Segmented
        size="small"
        value={mode}
        onChange={(value) => onChange(value as MapOverlayMode)}
        options={[
          {
            value: 'shadow',
            label: (
              <Tooltip title="Real-time sun/shade" placement="bottom">
                <span className="flex items-center gap-1">
                  <EyeOutlined style={{ fontSize: 12 }} />
                  <span style={{ fontSize: 10 }}>Now</span>
                </span>
              </Tooltip>
            ),
          },
          {
            value: 'sun-exposure',
            label: (
              <Tooltip title="Full day sun exposure" placement="bottom">
                <span className="flex items-center gap-1">
                  <SunOutlined style={{ fontSize: 12 }} />
                  <span style={{ fontSize: 10 }}>Day</span>
                </span>
              </Tooltip>
            ),
          },
          {
            value: 'avalanche',
            label: (
              <Tooltip title="Avalanche-prone slopes (30-45°)" placement="bottom">
                <span className="flex items-center gap-1">
                  <AlertOutlined style={{ fontSize: 12 }} />
                  <span style={{ fontSize: 10 }}>Avy</span>
                </span>
              </Tooltip>
            ),
          },
          {
            value: 'satellite',
            label: (
              <Tooltip title="Satellite imagery" placement="bottom">
                <span className="flex items-center gap-1">
                  <GlobalOutlined style={{ fontSize: 12 }} />
                  <span style={{ fontSize: 10 }}>Sat</span>
                </span>
              </Tooltip>
            ),
          },
        ]}
        style={{ background: 'rgba(0, 0, 0, 0.7)' }}
      />
    </div>
  );
}

const MapLayerToggle = memo(MapLayerToggleInner);
export default MapLayerToggle;


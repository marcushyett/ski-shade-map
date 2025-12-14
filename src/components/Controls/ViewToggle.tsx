'use client';

import { Segmented } from 'antd';
import { EnvironmentOutlined, BoxPlotOutlined } from '@ant-design/icons';
import { trackEvent } from '@/lib/posthog';

interface ViewToggleProps {
  is3D: boolean;
  onChange: (is3D: boolean) => void;
}

export default function ViewToggle({ is3D, onChange }: ViewToggleProps) {
  const handleChange = (value: string) => {
    const new3DState = value === '3d';
    trackEvent('map_3d_toggle', { is_3d: new3DState });
    onChange(new3DState);
  };

  return (
    <Segmented
      options={[
        {
          label: (
            <span className="flex items-center gap-1">
              <EnvironmentOutlined />
              2D
            </span>
          ),
          value: '2d',
        },
        {
          label: (
            <span className="flex items-center gap-1">
              <BoxPlotOutlined />
              3D
            </span>
          ),
          value: '3d',
        },
      ]}
      value={is3D ? '3d' : '2d'}
      onChange={handleChange}
    />
  );
}


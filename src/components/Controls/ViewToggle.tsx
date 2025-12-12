'use client';

import { Segmented } from 'antd';
import { EnvironmentOutlined, BoxPlotOutlined } from '@ant-design/icons';

interface ViewToggleProps {
  is3D: boolean;
  onChange: (is3D: boolean) => void;
}

export default function ViewToggle({ is3D, onChange }: ViewToggleProps) {
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
      onChange={(value) => onChange(value === '3d')}
    />
  );
}


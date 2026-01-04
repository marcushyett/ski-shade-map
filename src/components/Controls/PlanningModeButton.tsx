'use client';

import { memo, useCallback } from 'react';
import { Button, Tooltip } from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
import { trackEvent } from '@/lib/posthog';

interface PlanningModeButtonProps {
  enabled: boolean;
  onToggle: () => void;
}

/**
 * Button to toggle Planning Mode on/off.
 * Desktop-only component for planning ski runs the night before.
 */
function PlanningModeButtonInner({ enabled, onToggle }: PlanningModeButtonProps) {
  const handleClick = useCallback(() => {
    trackEvent('planning_mode_button_clicked', { current_state: enabled });
    onToggle();
  }, [enabled, onToggle]);

  return (
    <Tooltip
      title={enabled ? 'Exit Planning Mode' : 'Enter Planning Mode'}
      placement="bottom"
    >
      <Button
        type={enabled ? 'primary' : 'default'}
        icon={<CalendarOutlined />}
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          height: 32,
          fontSize: 11,
          fontWeight: enabled ? 600 : 400,
          ...(enabled ? {
            background: '#1677ff',
            borderColor: '#1677ff',
          } : {}),
        }}
      >
        Planning
      </Button>
    </Tooltip>
  );
}

const PlanningModeButton = memo(PlanningModeButtonInner);
export default PlanningModeButton;

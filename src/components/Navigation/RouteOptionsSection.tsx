'use client';

import { SettingOutlined, SunOutlined } from '@ant-design/icons';
import { CollapsibleSection } from './CollapsibleSection';
import { getDifficultyColor } from '@/lib/shade-calculator';
import { formatTimeHHMM } from '@/lib/route-sun-calculator';
import type { RouteFilters } from './types';

interface RouteOptionsSectionProps {
  isExpanded: boolean;
  onToggle: () => void;
  filters: RouteFilters;
  onFiltersChange: (filters: RouteFilters) => void;
  sunnyRouteEnabled: boolean;
  onSunnyRouteEnabledChange: (enabled: boolean) => void;
  sunnyRouteTolerance: number;
  onSunnyRouteToleranceChange: (tolerance: number) => void;
  sunnyRouteStartTime: Date;
  onSunnyRouteStartTimeChange: (time: Date) => void;
}

export function RouteOptionsSection({
  isExpanded,
  onToggle,
  filters,
  onFiltersChange,
  sunnyRouteEnabled,
  onSunnyRouteEnabledChange,
  sunnyRouteTolerance,
  onSunnyRouteToleranceChange,
  sunnyRouteStartTime,
  onSunnyRouteStartTimeChange,
}: RouteOptionsSectionProps) {
  const handleDifficultyToggle = (key: keyof typeof filters.difficulties) => {
    onFiltersChange({
      ...filters,
      difficulties: { ...filters.difficulties, [key]: !filters.difficulties[key] },
    });
  };

  const handleLiftTypeToggle = (key: keyof typeof filters.liftTypes) => {
    onFiltersChange({
      ...filters,
      liftTypes: { ...filters.liftTypes, [key]: !filters.liftTypes[key] },
    });
  };

  return (
    <CollapsibleSection
      title="Route Options"
      icon={<SettingOutlined style={{ fontSize: 11 }} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      <div className="route-options-content">
        {/* Sunny route toggle */}
        <div className="route-option-group">
          <button
            className={`route-option-toggle ${sunnyRouteEnabled ? 'active' : ''}`}
            onClick={() => onSunnyRouteEnabledChange(!sunnyRouteEnabled)}
          >
            <span className={`toggle-check ${sunnyRouteEnabled ? 'checked' : ''}`} />
            <SunOutlined style={{ fontSize: 12, color: sunnyRouteEnabled ? '#f59e0b' : '#888' }} />
            <span>Take the sunny route</span>
          </button>

          {sunnyRouteEnabled && (
            <div className="sunny-route-options">
              <div className="sunny-option">
                <label>Extra time tolerance:</label>
                <div className="sunny-slider-row">
                  <input
                    type="range"
                    min="1"
                    max="60"
                    value={sunnyRouteTolerance}
                    onChange={(e) => onSunnyRouteToleranceChange(parseInt(e.target.value))}
                    className="sunny-slider"
                  />
                  <span className="sunny-value">{sunnyRouteTolerance}min</span>
                </div>
              </div>

              <div className="sunny-option">
                <label>Start time:</label>
                <div className="sunny-time-row">
                  <button
                    className="sunny-time-btn"
                    onClick={() => {
                      const newTime = new Date(sunnyRouteStartTime);
                      newTime.setMinutes(newTime.getMinutes() - 5);
                      onSunnyRouteStartTimeChange(newTime);
                    }}
                  >
                    −
                  </button>
                  <input
                    type="time"
                    value={formatTimeHHMM(sunnyRouteStartTime)}
                    onChange={(e) => {
                      const [hours, mins] = e.target.value.split(':').map(Number);
                      const newTime = new Date(sunnyRouteStartTime);
                      newTime.setHours(hours, mins, 0, 0);
                      onSunnyRouteStartTimeChange(newTime);
                    }}
                    className="sunny-time-input"
                    step="300"
                  />
                  <button
                    className="sunny-time-btn"
                    onClick={() => {
                      const newTime = new Date(sunnyRouteStartTime);
                      newTime.setMinutes(newTime.getMinutes() + 5);
                      onSunnyRouteStartTimeChange(newTime);
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Difficulty filters */}
        <div className="route-option-group">
          <div className="route-option-label">Slope difficulties:</div>
          <div className="filter-options">
            {(Object.keys(filters.difficulties) as Array<keyof typeof filters.difficulties>).map((key) => (
              <button
                key={key}
                className={`filter-chip ${filters.difficulties[key] ? 'active' : ''}`}
                onClick={() => handleDifficultyToggle(key)}
              >
                <span
                  className="filter-dot"
                  style={{
                    backgroundColor: getDifficultyColor(key),
                    border: key === 'advanced' ? '1px solid #666' : undefined,
                  }}
                />
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Lift type filters */}
        <div className="route-option-group">
          <div className="route-option-label">Lift types:</div>
          <div className="filter-options filter-options-wrap">
            {(Object.keys(filters.liftTypes) as Array<keyof typeof filters.liftTypes>).map((key) => (
              <button
                key={key}
                className={`filter-chip ${filters.liftTypes[key] ? 'active' : ''}`}
                onClick={() => handleLiftTypeToggle(key)}
              >
                {key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </button>
            ))}
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
}


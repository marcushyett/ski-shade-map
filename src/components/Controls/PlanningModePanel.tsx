'use client';

import { memo, useCallback } from 'react';
import { Typography, Checkbox, Slider, Switch, Alert, Spin, Collapse } from 'antd';
import { DownOutlined, RightOutlined, LoadingOutlined } from '@ant-design/icons';
import type { PlanningModeState, YesterdayStatusResponse } from '@/lib/planning-mode-types';
import {
  ALL_DIFFICULTIES,
  DIFFICULTY_LABELS,
  LIFT_TYPES,
  LIFT_TYPE_LABELS,
  type ShadowQuality,
} from '@/lib/planning-mode-types';
import type { RunDifficulty } from '@/lib/types';

const { Text, Title } = Typography;

interface PlanningModePanelProps {
  planningMode: PlanningModeState;
  onFiltersChange: (filters: Partial<PlanningModeState['filters']>) => void;
  onShadowSettingsChange: (settings: Partial<PlanningModeState['shadowSettings']>) => void;
  yesterdayStatus: YesterdayStatusResponse | null;
  isLoadingYesterday: boolean;
  onClose: () => void;
}

const QUALITY_MARKS: Record<number, string> = {
  0: 'Low',
  50: 'Med',
  100: 'High',
};

const QUALITY_VALUES: Record<number, ShadowQuality> = {
  0: 'low',
  50: 'medium',
  100: 'high',
};

const QUALITY_TO_NUMBER: Record<ShadowQuality, number> = {
  low: 0,
  medium: 50,
  high: 100,
};

/**
 * Panel for controlling Planning Mode settings.
 * Shows filters for difficulty, lift type, and yesterday's open status.
 * Also includes shadow overlay settings.
 */
function PlanningModePanelInner({
  planningMode,
  onFiltersChange,
  onShadowSettingsChange,
  yesterdayStatus,
  isLoadingYesterday,
  onClose,
}: PlanningModePanelProps) {
  const { filters, shadowSettings } = planningMode;

  // Toggle a single difficulty
  const handleDifficultyToggle = useCallback(
    (difficulty: RunDifficulty, checked: boolean) => {
      const newDifficulties = checked
        ? [...filters.difficulties, difficulty]
        : filters.difficulties.filter((d) => d !== difficulty);
      onFiltersChange({ difficulties: newDifficulties });
    },
    [filters.difficulties, onFiltersChange]
  );

  // Toggle all difficulties
  const handleAllDifficultiesToggle = useCallback(
    (checked: boolean) => {
      onFiltersChange({
        difficulties: checked ? [...ALL_DIFFICULTIES] : [],
      });
    },
    [onFiltersChange]
  );

  // Toggle a single lift type
  const handleLiftTypeToggle = useCallback(
    (liftType: string, checked: boolean) => {
      const newTypes = checked
        ? [...filters.liftTypes, liftType]
        : filters.liftTypes.filter((t) => t !== liftType);
      onFiltersChange({ liftTypes: newTypes });
    },
    [filters.liftTypes, onFiltersChange]
  );

  // Toggle all lift types
  const handleAllLiftTypesToggle = useCallback(
    (checked: boolean) => {
      onFiltersChange({
        liftTypes: checked ? [...LIFT_TYPES] : [],
      });
    },
    [onFiltersChange]
  );

  // Toggle "only open yesterday" filter
  const handleOnlyOpenYesterdayToggle = useCallback(
    (checked: boolean) => {
      onFiltersChange({ onlyOpenYesterday: checked });
    },
    [onFiltersChange]
  );

  // Shadow quality change
  const handleQualityChange = useCallback(
    (value: number) => {
      const quality = QUALITY_VALUES[value] || 'medium';
      onShadowSettingsChange({ quality });
    },
    [onShadowSettingsChange]
  );

  // Shadow opacity change
  const handleOpacityChange = useCallback(
    (value: number) => {
      onShadowSettingsChange({ opacity: value / 100 });
    },
    [onShadowSettingsChange]
  );

  // Shadow enabled toggle
  const handleShadowEnabledToggle = useCallback(
    (checked: boolean) => {
      onShadowSettingsChange({ enabled: checked });
    },
    [onShadowSettingsChange]
  );

  const allDifficultiesSelected = filters.difficulties.length === ALL_DIFFICULTIES.length;
  const someDifficultiesSelected = filters.difficulties.length > 0 && !allDifficultiesSelected;

  // Get unique lift types from LIFT_TYPES (remove duplicates like chair_lift/chairlift)
  const uniqueLiftTypes = LIFT_TYPES.filter((type, index) => {
    // Skip 'chairlift' since we have 'chair_lift'
    if (type === 'chairlift') return false;
    return true;
  });

  const allLiftTypesSelected = filters.liftTypes.length >= uniqueLiftTypes.length;
  const someLiftTypesSelected = filters.liftTypes.length > 0 && !allLiftTypesSelected;

  // Yesterday filter availability
  const yesterdayFilterDisabled = !yesterdayStatus?.hasData;
  const yesterdayFilterMessage = yesterdayFilterDisabled
    ? 'Historical data not available for this resort'
    : `${yesterdayStatus?.openRuns?.length || 0} runs, ${yesterdayStatus?.openLifts?.length || 0} lifts open yesterday`;

  return (
    <div
      className="planning-mode-panel"
      style={{
        position: 'absolute',
        top: 50,
        left: 10,
        width: 280,
        maxHeight: 'calc(100vh - 120px)',
        overflow: 'auto',
        background: 'white',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 10,
      }}
    >
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title level={5} style={{ margin: 0, fontSize: 13 }}>
            Planning Mode
          </Title>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 18,
              color: '#999',
              padding: 0,
              lineHeight: 1,
            }}
            aria-label="Close planning mode panel"
          >
            &times;
          </button>
        </div>
        <Text type="secondary" style={{ fontSize: 10 }}>
          Plan your ski day - all runs shown as open
        </Text>
      </div>

      <Collapse
        defaultActiveKey={['runs', 'shadows']}
        ghost
        expandIconPosition="start"
        style={{ fontSize: 11 }}
      >
        {/* Run Difficulty Filter */}
        <Collapse.Panel
          key="runs"
          header={<Text strong style={{ fontSize: 11 }}>Run Difficulty</Text>}
        >
          <div style={{ paddingBottom: 8 }}>
            <Checkbox
              checked={allDifficultiesSelected}
              indeterminate={someDifficultiesSelected}
              onChange={(e) => handleAllDifficultiesToggle(e.target.checked)}
              style={{ fontSize: 10 }}
            >
              <Text style={{ fontSize: 10 }}>All difficulties</Text>
            </Checkbox>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 16 }}>
            {ALL_DIFFICULTIES.map((difficulty) => (
              <Checkbox
                key={difficulty}
                checked={filters.difficulties.includes(difficulty)}
                onChange={(e) => handleDifficultyToggle(difficulty, e.target.checked)}
                style={{ fontSize: 10, marginInlineStart: 0 }}
              >
                <Text style={{ fontSize: 10 }}>{DIFFICULTY_LABELS[difficulty]}</Text>
              </Checkbox>
            ))}
          </div>
        </Collapse.Panel>

        {/* Lift Type Filter */}
        <Collapse.Panel
          key="lifts"
          header={<Text strong style={{ fontSize: 11 }}>Lift Type</Text>}
        >
          <div style={{ paddingBottom: 8 }}>
            <Checkbox
              checked={allLiftTypesSelected}
              indeterminate={someLiftTypesSelected}
              onChange={(e) => handleAllLiftTypesToggle(e.target.checked)}
              style={{ fontSize: 10 }}
            >
              <Text style={{ fontSize: 10 }}>All lift types</Text>
            </Checkbox>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 16 }}>
            {uniqueLiftTypes.map((liftType) => (
              <Checkbox
                key={liftType}
                checked={filters.liftTypes.includes(liftType) || filters.liftTypes.includes('chairlift' as string)}
                onChange={(e) => handleLiftTypeToggle(liftType, e.target.checked)}
                style={{ fontSize: 10, marginInlineStart: 0 }}
              >
                <Text style={{ fontSize: 10 }}>{LIFT_TYPE_LABELS[liftType] || liftType}</Text>
              </Checkbox>
            ))}
          </div>
        </Collapse.Panel>

        {/* Yesterday Filter */}
        <Collapse.Panel
          key="yesterday"
          header={<Text strong style={{ fontSize: 11 }}>Historical Data</Text>}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Switch
              size="small"
              checked={filters.onlyOpenYesterday}
              disabled={yesterdayFilterDisabled || isLoadingYesterday}
              onChange={handleOnlyOpenYesterdayToggle}
            />
            <Text style={{ fontSize: 10 }}>Only show open yesterday</Text>
            {isLoadingYesterday && <Spin indicator={<LoadingOutlined style={{ fontSize: 12 }} />} />}
          </div>
          <Text type="secondary" style={{ fontSize: 9, display: 'block' }}>
            {yesterdayFilterMessage}
          </Text>
        </Collapse.Panel>

        {/* Shadow Settings */}
        <Collapse.Panel
          key="shadows"
          header={<Text strong style={{ fontSize: 11 }}>Terrain Shadows</Text>}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Switch
              size="small"
              checked={shadowSettings.enabled}
              onChange={handleShadowEnabledToggle}
            />
            <Text style={{ fontSize: 10 }}>Show shadow overlay</Text>
            {planningMode.shadowsLoading && (
              <Spin indicator={<LoadingOutlined style={{ fontSize: 12 }} />} />
            )}
          </div>

          {shadowSettings.enabled && (
            <>
              <div style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>Quality</Text>
                <Slider
                  min={0}
                  max={100}
                  step={50}
                  marks={QUALITY_MARKS}
                  value={QUALITY_TO_NUMBER[shadowSettings.quality]}
                  onChange={handleQualityChange}
                  tooltip={{ formatter: null }}
                  style={{ margin: '0 8px' }}
                />
              </div>

              <div>
                <Text style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>
                  Opacity: {Math.round(shadowSettings.opacity * 100)}%
                </Text>
                <Slider
                  min={0}
                  max={100}
                  value={Math.round(shadowSettings.opacity * 100)}
                  onChange={handleOpacityChange}
                  tooltip={{ formatter: (value) => `${value}%` }}
                  style={{ margin: '0 8px' }}
                />
              </div>
            </>
          )}
        </Collapse.Panel>
      </Collapse>
    </div>
  );
}

const PlanningModePanel = memo(PlanningModePanelInner);
export default PlanningModePanel;

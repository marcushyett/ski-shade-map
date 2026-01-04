'use client';

import { memo, useCallback } from 'react';
import { Typography, Checkbox, Slider, Switch, Alert, Spin, Collapse } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import type { PlanningModeState, YesterdayStatusResponse } from '@/lib/planning-mode-types';
import {
  ALL_DIFFICULTIES,
  DIFFICULTY_LABELS,
  LIFT_TYPES,
  LIFT_TYPE_LABELS,
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
        maxHeight: 'calc(100vh - 180px)',
        overflow: 'auto',
        background: 'rgba(0, 0, 0, 0.85)',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        zIndex: 10,
        color: 'white',
      }}
    >
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title level={5} style={{ margin: 0, fontSize: 13, color: 'white' }}>
            Planning Mode
          </Title>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 18,
              color: 'rgba(255,255,255,0.6)',
              padding: 0,
              lineHeight: 1,
            }}
            aria-label="Close planning mode panel"
          >
            &times;
          </button>
        </div>
        <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
          Plan your ski day - all runs shown as open
        </Text>
      </div>

      <Collapse
        defaultActiveKey={['runs', 'shadows']}
        ghost
        expandIconPosition="start"
        style={{ fontSize: 11 }}
        className="planning-mode-collapse"
      >
        {/* Run Difficulty Filter */}
        <Collapse.Panel
          key="runs"
          header={<span style={{ fontSize: 11, fontWeight: 600, color: 'white' }}>Run Difficulty</span>}
        >
          <div style={{ paddingBottom: 8 }}>
            <Checkbox
              checked={allDifficultiesSelected}
              indeterminate={someDifficultiesSelected}
              onChange={(e) => handleAllDifficultiesToggle(e.target.checked)}
              style={{ fontSize: 10 }}
            >
              <span style={{ fontSize: 10, color: 'white' }}>All difficulties</span>
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
                <span style={{ fontSize: 10, color: 'white' }}>{DIFFICULTY_LABELS[difficulty]}</span>
              </Checkbox>
            ))}
          </div>
        </Collapse.Panel>

        {/* Lift Type Filter */}
        <Collapse.Panel
          key="lifts"
          header={<span style={{ fontSize: 11, fontWeight: 600, color: 'white' }}>Lift Type</span>}
        >
          <div style={{ paddingBottom: 8 }}>
            <Checkbox
              checked={allLiftTypesSelected}
              indeterminate={someLiftTypesSelected}
              onChange={(e) => handleAllLiftTypesToggle(e.target.checked)}
              style={{ fontSize: 10 }}
            >
              <span style={{ fontSize: 10, color: 'white' }}>All lift types</span>
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
                <span style={{ fontSize: 10, color: 'white' }}>{LIFT_TYPE_LABELS[liftType] || liftType}</span>
              </Checkbox>
            ))}
          </div>
        </Collapse.Panel>

        {/* Yesterday Filter */}
        <Collapse.Panel
          key="yesterday"
          header={<span style={{ fontSize: 11, fontWeight: 600, color: 'white' }}>Historical Data</span>}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Switch
              size="small"
              checked={filters.onlyOpenYesterday}
              disabled={yesterdayFilterDisabled || isLoadingYesterday}
              onChange={handleOnlyOpenYesterdayToggle}
            />
            <span style={{ fontSize: 10, color: 'white' }}>Only show open yesterday</span>
            {isLoadingYesterday && <Spin indicator={<LoadingOutlined style={{ fontSize: 12, color: 'white' }} />} />}
          </div>
          <span style={{ fontSize: 9, display: 'block', color: 'rgba(255,255,255,0.6)' }}>
            {yesterdayFilterMessage}
          </span>
        </Collapse.Panel>

        {/* Shadow Settings */}
        <Collapse.Panel
          key="shadows"
          header={<span style={{ fontSize: 11, fontWeight: 600, color: 'white' }}>Terrain Shadows</span>}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Switch
              size="small"
              checked={shadowSettings.enabled}
              onChange={handleShadowEnabledToggle}
            />
            <span style={{ fontSize: 10, color: 'white' }}>Show shadow overlay</span>
            {planningMode.shadowsLoading && (
              <Spin indicator={<LoadingOutlined style={{ fontSize: 12, color: 'white' }} />} />
            )}
          </div>

          {shadowSettings.enabled && (
            <div>
              <span style={{ fontSize: 10, display: 'block', marginBottom: 4, color: 'white' }}>
                Opacity: {Math.round(shadowSettings.opacity * 100)}%
              </span>
              <Slider
                min={0}
                max={100}
                value={Math.round(shadowSettings.opacity * 100)}
                onChange={handleOpacityChange}
                tooltip={{ formatter: (value) => `${value}%` }}
                style={{ margin: '0 8px' }}
              />
            </div>
          )}
        </Collapse.Panel>
      </Collapse>
    </div>
  );
}

const PlanningModePanel = memo(PlanningModePanelInner);
export default PlanningModePanel;

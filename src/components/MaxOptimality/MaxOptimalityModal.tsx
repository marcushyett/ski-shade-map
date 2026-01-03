'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Select, Checkbox, Progress, Alert, Typography, Divider } from 'antd';
import type { CheckboxChangeEvent } from 'antd/es/checkbox';
import {
  CloseOutlined,
  ThunderboltOutlined,
  SunOutlined,
  EnvironmentOutlined,
  ArrowRightOutlined,
  ClockCircleOutlined,
  RiseOutlined,
  FallOutlined,
} from '@ant-design/icons';
import { getDifficultyColor } from '@/lib/shade-calculator';
import type { RunDifficulty } from '@/lib/types';
import type {
  SkiAreaWithAnalytics,
  MaxOptimalityPlan,
  PlannedStep,
  PlanningProgress,
} from '@/lib/max-optimality/types';
import type { MountainHome } from '@/components/LocationControls';
import type { NavigationRoute } from '@/lib/navigation';

const { Text, Title } = Typography;

interface MaxOptimalityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlanComplete: (plan: MaxOptimalityPlan, route: NavigationRoute | null) => void;
  mountainHome: MountainHome | null;
}

type PlanningState = 'idle' | 'loading-areas' | 'selecting' | 'planning' | 'complete' | 'error';

const DIFFICULTY_OPTIONS: { value: RunDifficulty; label: string; color: string }[] = [
  { value: 'novice', label: 'Novice', color: '#4CAF50' },
  { value: 'easy', label: 'Easy', color: '#2196F3' },
  { value: 'intermediate', label: 'Intermediate', color: '#F44336' },
  { value: 'advanced', label: 'Advanced', color: '#212121' },
  { value: 'expert', label: 'Expert', color: '#f97316' },
];

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)}km`;
  }
  return `${Math.round(meters)}m`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function MaxOptimalityModal({
  isOpen,
  onClose,
  onPlanComplete,
  mountainHome,
}: MaxOptimalityModalProps) {
  // State
  const [state, setState] = useState<PlanningState>('idle');
  const [skiAreas, setSkiAreas] = useState<SkiAreaWithAnalytics[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedDifficulties, setSelectedDifficulties] = useState<RunDifficulty[]>([
    'easy',
    'intermediate',
  ]);
  const [progress, setProgress] = useState<PlanningProgress | null>(null);
  const [plan, setPlan] = useState<MaxOptimalityPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load ski areas when modal opens
  useEffect(() => {
    if (isOpen && state === 'idle') {
      loadSkiAreas();
    }
  }, [isOpen, state]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setState('idle');
      setProgress(null);
      setPlan(null);
      setError(null);
    }
  }, [isOpen]);

  const loadSkiAreas = useCallback(async () => {
    setState('loading-areas');
    setError(null);

    try {
      const response = await fetch('/api/max-optimality/areas');
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to load ski areas');
      }

      setSkiAreas(data.skiAreas);
      setState('selecting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ski areas');
      setState('error');
    }
  }, []);

  const handleStartPlanning = useCallback(async () => {
    if (!selectedAreaId || selectedDifficulties.length === 0 || !mountainHome) {
      setError('Please select a ski area, at least one difficulty, and set your mountain home');
      return;
    }

    setState('planning');
    setProgress({
      phase: 'loading',
      progress: 0,
      message: 'Starting route planning...',
    });
    setError(null);

    try {
      // Get tomorrow's date
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);

      const response = await fetch('/api/max-optimality/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          skiAreaId: selectedAreaId,
          difficulties: selectedDifficulties,
          homeLocation: {
            lat: mountainHome.latitude,
            lng: mountainHome.longitude,
            name: mountainHome.name,
          },
          targetDate: tomorrow.toISOString(),
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to plan route');
      }

      setPlan(data.plan);
      setState('complete');
      setProgress({
        phase: 'complete',
        progress: 100,
        message: 'Route planning complete!',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to plan route');
      setState('error');
    }
  }, [selectedAreaId, selectedDifficulties, mountainHome]);

  const handleApplyPlan = useCallback(() => {
    if (plan) {
      onPlanComplete(plan, plan.navigationRoute || null);
      onClose();
    }
  }, [plan, onPlanComplete, onClose]);

  const selectedArea = useMemo(() => {
    return skiAreas.find((a: SkiAreaWithAnalytics) => a.id === selectedAreaId);
  }, [skiAreas, selectedAreaId]);

  if (!isOpen) return null;

  return (
    <div className="max-optimality-overlay" onClick={onClose}>
      <div className="max-optimality-modal" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        {/* Header */}
        <div className="max-optimality-header">
          <div className="max-optimality-title">
            <ThunderboltOutlined style={{ fontSize: 18, color: '#faad14' }} />
            <Title level={5} style={{ margin: 0 }}>
              Max Optimality
            </Title>
          </div>
          <button className="max-optimality-close" onClick={onClose}>
            <CloseOutlined style={{ fontSize: 14 }} />
          </button>
        </div>

        {/* Content */}
        <div className="max-optimality-content">
          {/* Error state */}
          {error && (
            <Alert
              type="error"
              message={error}
              closable
              onClose={() => setError(null)}
              style={{ marginBottom: 16 }}
            />
          )}

          {/* Loading areas */}
          {state === 'loading-areas' && (
            <div className="max-optimality-loading">
              <Progress type="circle" percent={0} status="active" size={60} />
              <Text style={{ marginTop: 12 }}>Loading ski areas with analytics...</Text>
            </div>
          )}

          {/* Selection form */}
          {(state === 'selecting' || state === 'idle') && (
            <>
              <div className="max-optimality-description">
                <Text type="secondary">
                  Plan a route that covers the maximum number of runs, optimized for sun exposure.
                  Based on runs and lifts that were open in the last 24 hours.
                </Text>
              </div>

              {/* Home location check */}
              {!mountainHome && (
                <Alert
                  type="warning"
                  message="Mountain Home Required"
                  description="Please set your Mountain Home location first. This will be the start and end point of your route."
                  style={{ marginBottom: 16 }}
                />
              )}

              {mountainHome && (
                <div className="max-optimality-home">
                  <EnvironmentOutlined style={{ color: '#faad14' }} />
                  <Text>
                    Start/End: <strong>{mountainHome.name}</strong>
                  </Text>
                </div>
              )}

              {/* Ski Area Selection */}
              <div className="max-optimality-field">
                <Text strong style={{ display: 'block', marginBottom: 8 }}>
                  Select Ski Area
                </Text>
                <Select
                  placeholder="Choose a ski area..."
                  style={{ width: '100%' }}
                  value={selectedAreaId}
                  onChange={setSelectedAreaId}
                  showSearch
                  filterOption={(input: string, option: { label: string; value: string } | undefined) =>
                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={skiAreas.map((area: SkiAreaWithAnalytics) => ({
                    value: area.id,
                    label: `${area.name} (${area.analyticsRunCount} runs, ${area.analyticsLiftCount} lifts)`,
                  }))}
                />
                {selectedArea && (
                  <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                    Last updated:{' '}
                    {selectedArea.lastAnalyticsUpdate
                      ? new Date(selectedArea.lastAnalyticsUpdate).toLocaleString()
                      : 'Unknown'}
                  </Text>
                )}
              </div>

              {/* Difficulty Selection */}
              <div className="max-optimality-field">
                <Text strong style={{ display: 'block', marginBottom: 8 }}>
                  Difficulty Levels
                </Text>
                <div className="max-optimality-difficulties">
                  {DIFFICULTY_OPTIONS.map((diff) => (
                    <Checkbox
                      key={diff.value}
                      checked={selectedDifficulties.includes(diff.value)}
                      onChange={(e: CheckboxChangeEvent) => {
                        if (e.target.checked) {
                          setSelectedDifficulties([...selectedDifficulties, diff.value]);
                        } else {
                          setSelectedDifficulties(
                            selectedDifficulties.filter((d: RunDifficulty) => d !== diff.value)
                          );
                        }
                      }}
                    >
                      <span
                        className="difficulty-dot"
                        style={{
                          backgroundColor: diff.color,
                          border: diff.value === 'advanced' ? '1px solid #666' : undefined,
                        }}
                      />
                      {diff.label}
                    </Checkbox>
                  ))}
                </div>
              </div>

              {/* Start Planning Button */}
              <Button
                type="primary"
                size="large"
                block
                icon={<ThunderboltOutlined />}
                onClick={handleStartPlanning}
                disabled={!selectedAreaId || selectedDifficulties.length === 0 || !mountainHome}
              >
                Plan Maximum Route
              </Button>
            </>
          )}

          {/* Planning in progress */}
          {state === 'planning' && progress && (
            <div className="max-optimality-planning">
              <Progress
                type="circle"
                percent={progress.progress}
                status="active"
                size={80}
                format={() => `${progress.progress}%`}
              />
              <Text strong style={{ marginTop: 16, display: 'block' }}>
                {progress.message}
              </Text>
              {progress.details && (
                <Text type="secondary" style={{ marginTop: 8 }}>
                  {progress.details.runsFound && `${progress.details.runsFound} runs available`}
                  {progress.details.currentBestCoverage &&
                    ` • ${progress.details.currentBestCoverage} runs covered`}
                </Text>
              )}
            </div>
          )}

          {/* Plan complete */}
          {state === 'complete' && plan && (
            <div className="max-optimality-result">
              {/* Summary */}
              <div className="max-optimality-summary">
                <div className="summary-stat">
                  <div className="summary-value">
                    {plan.summary.totalRunsCovered}/{plan.summary.totalRunsAvailable}
                  </div>
                  <div className="summary-label">Runs Covered</div>
                </div>
                <div className="summary-stat">
                  <div className="summary-value">
                    {Math.round(plan.summary.coveragePercentage)}%
                  </div>
                  <div className="summary-label">Coverage</div>
                </div>
                <div className="summary-stat">
                  <div className="summary-value">
                    {Math.round(plan.summary.averageSunExposure)}%
                  </div>
                  <div className="summary-label">
                    <SunOutlined /> Sun
                  </div>
                </div>
              </div>

              {/* Time and distance */}
              <div className="max-optimality-stats">
                <div className="stat-item">
                  <ClockCircleOutlined />
                  <span>{formatDuration(plan.summary.totalDuration)}</span>
                </div>
                <div className="stat-item">
                  <EnvironmentOutlined />
                  <span>{formatDistance(plan.summary.totalDistance)}</span>
                </div>
                <div className="stat-item">
                  <RiseOutlined style={{ color: '#52c41a' }} />
                  <span>{formatDistance(plan.summary.totalElevationGain)}</span>
                </div>
                <div className="stat-item">
                  <FallOutlined style={{ color: '#ff4d4f' }} />
                  <span>{formatDistance(plan.summary.totalElevationLoss)}</span>
                </div>
              </div>

              {/* Schedule */}
              <div className="max-optimality-schedule">
                <Text type="secondary">
                  {formatTime(new Date(plan.summary.startTime))} -{' '}
                  {formatTime(new Date(plan.summary.endTime))}
                </Text>
              </div>

              <Divider style={{ margin: '16px 0' }} />

              {/* Steps list */}
              <div className="max-optimality-steps">
                <Text strong style={{ marginBottom: 8, display: 'block' }}>
                  Route Steps ({plan.steps.length})
                </Text>
                <div className="steps-list">
                  {plan.steps.slice(0, 20).map((step, index) => (
                    <StepItem key={step.id} step={step} index={index} />
                  ))}
                  {plan.steps.length > 20 && (
                    <Text type="secondary" style={{ padding: '8px 0', display: 'block' }}>
                      ... and {plan.steps.length - 20} more steps
                    </Text>
                  )}
                </div>
              </div>

              {/* Apply button */}
              <Button
                type="primary"
                size="large"
                block
                icon={<ArrowRightOutlined />}
                onClick={handleApplyPlan}
                style={{ marginTop: 16 }}
              >
                Show on Map
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepItem({ step, index }: { step: PlannedStep; index: number }) {
  const getIcon = () => {
    if (step.type === 'run') {
      return (
        <span
          className="step-dot"
          style={{ backgroundColor: getDifficultyColor(step.difficulty || null) }}
        />
      );
    }
    if (step.type === 'lift') {
      return <RiseOutlined style={{ color: '#52c41a', fontSize: 12 }} />;
    }
    return <EnvironmentOutlined style={{ color: '#888', fontSize: 12 }} />;
  };

  return (
    <div className="step-item">
      <div className="step-number">{index + 1}</div>
      <div className="step-icon">{getIcon()}</div>
      <div className="step-content">
        <div className="step-name">{step.name || `${step.type}`}</div>
        <div className="step-meta">
          {formatDuration(step.duration)} • {formatDistance(step.distance)}
          {step.sunExposure > 0 && (
            <span className="step-sun">
              <SunOutlined /> {Math.round(step.sunExposure)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default MaxOptimalityModal;

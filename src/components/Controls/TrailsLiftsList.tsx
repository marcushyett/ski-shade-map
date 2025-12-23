'use client';

import { useState, useMemo, useCallback, memo, useTransition } from 'react';
import { Input, Typography, Badge, Tooltip } from 'antd';
import {
  SearchOutlined,
  NodeIndexOutlined,
  SwapOutlined,
  DownOutlined,
  RightOutlined,
  EnvironmentOutlined,
  ClockCircleOutlined,
  StopOutlined,
  CheckCircleOutlined,
  FieldTimeOutlined,
  ThunderboltOutlined,
  RocketOutlined,
  TeamOutlined,
  ColumnHeightOutlined,
  ArrowUpOutlined,
} from '@ant-design/icons';
import type { RunData, LiftData } from '@/lib/types';
import { getDifficultyColor } from '@/lib/shade-calculator';
import type { EnrichedLiftData, EnrichedRunData, ResortStatus } from '@/lib/lift-status-types';
import {
  getClosingUrgency,
  formatTimeUntilClose,
} from '@/lib/lift-status-types';

const { Text } = Typography;

// Max items to show per group
const ITEMS_PER_PAGE = 15;

// Status colors
const STATUS_COLORS = {
  open: '#52c41a',      // green
  closed: '#ff4d4f',    // red
  scheduled: '#faad14', // yellow/orange
  unknown: '#8c8c8c',   // gray
};

interface TrailsLiftsListProps {
  runs: (RunData | EnrichedRunData)[];
  lifts: (LiftData | EnrichedLiftData)[];
  localities?: string[];
  resortStatus?: ResortStatus | null;
  onSelectRun?: (run: RunData | EnrichedRunData) => void;
  onSelectLift?: (lift: LiftData | EnrichedLiftData) => void;
  onSelectLocality?: (locality: string) => void;
}

// Helper to check if data is enriched
function isEnrichedRun(run: RunData | EnrichedRunData): run is EnrichedRunData {
  return 'liveStatus' in run || 'minutesUntilClose' in run;
}

function isEnrichedLift(lift: LiftData | EnrichedLiftData): lift is EnrichedLiftData {
  return 'liveStatus' in lift || 'minutesUntilClose' in lift;
}

// Status indicator component
const StatusIndicator = memo(function StatusIndicator({
  status,
  minutesUntilClose,
  size = 'small'
}: {
  status?: 'open' | 'closed' | 'scheduled' | 'unknown' | null;
  minutesUntilClose?: number;
  size?: 'small' | 'tiny';
}) {
  const urgency = getClosingUrgency(minutesUntilClose);
  const fontSize = size === 'tiny' ? 7 : 8;
  const iconSize = size === 'tiny' ? 8 : 10;

  if (status === 'closed') {
    return (
      <Tooltip title="Closed">
        <StopOutlined style={{ color: STATUS_COLORS.closed, fontSize: iconSize }} />
      </Tooltip>
    );
  }

  if (urgency === 'urgent') {
    return (
      <Tooltip title={`Closes in ${formatTimeUntilClose(minutesUntilClose!)}`}>
        <span style={{ color: STATUS_COLORS.closed, fontSize, fontWeight: 600, animation: 'pulse 1s infinite' }}>
          {formatTimeUntilClose(minutesUntilClose!)}
        </span>
      </Tooltip>
    );
  }

  if (urgency === 'warning') {
    return (
      <Tooltip title={`Closes in ${formatTimeUntilClose(minutesUntilClose!)}`}>
        <span style={{ color: STATUS_COLORS.scheduled, fontSize }}>
          <ClockCircleOutlined style={{ fontSize: iconSize, marginRight: 2 }} />
          {formatTimeUntilClose(minutesUntilClose!)}
        </span>
      </Tooltip>
    );
  }

  if (status === 'open') {
    return null; // Don't clutter with green checkmarks for open items
  }

  if (status === 'scheduled') {
    return (
      <Tooltip title="Scheduled to open">
        <ClockCircleOutlined style={{ color: STATUS_COLORS.scheduled, fontSize: iconSize }} />
      </Tooltip>
    );
  }

  return null;
});

// Simple run item - minimal DOM, tight spacing
const RunItem = memo(function RunItem({
  run,
  showLocality,
  onClick
}: {
  run: RunData | EnrichedRunData;
  showLocality?: boolean;
  onClick: () => void;
}) {
  const name = run.name || 'Unnamed';
  const isClosed = run.status === 'closed';
  const enriched = isEnrichedRun(run) ? run : null;
  const minutesUntilClose = enriched?.minutesUntilClose;
  const urgency = getClosingUrgency(minutesUntilClose);
  const groomingStatus = enriched?.liveStatus?.groomingStatus;

  return (
    <div
      className={`run-item cursor-pointer flex items-center justify-between hover:bg-white/5 ${isClosed ? 'opacity-50' : ''}`}
      onClick={onClick}
      style={{
        padding: '1px 4px',
        textDecoration: isClosed ? 'line-through' : 'none',
      }}
    >
      <div className="flex items-center gap-1 truncate">
        <span
          className="truncate"
          style={{
            fontSize: 9,
            color: urgency === 'urgent' ? STATUS_COLORS.closed : urgency === 'warning' ? STATUS_COLORS.scheduled : '#ccc',
            lineHeight: '14px'
          }}
        >
          {name}
        </span>
        {groomingStatus && (
          <span style={{ fontSize: 7, color: '#888' }}>
            {groomingStatus === 'GROOMED' ? '✓' : groomingStatus === 'NOT_GROOMED' ? '○' : '◐'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
        <StatusIndicator status={run.status} minutesUntilClose={minutesUntilClose} size="tiny" />
        {showLocality && run.locality && (
          <span style={{ fontSize: 8, color: '#666', marginLeft: 4 }}>
            {run.locality}
          </span>
        )}
      </div>
    </div>
  );
});

// Simple lift item - tight spacing to match runs
const LiftItem = memo(function LiftItem({
  lift,
  showLocality,
  onClick
}: {
  lift: LiftData | EnrichedLiftData;
  showLocality?: boolean;
  onClick: () => void;
}) {
  const name = lift.name || 'Unnamed';
  const isClosed = lift.status === 'closed';
  const enriched = isEnrichedLift(lift) ? lift : null;
  const minutesUntilClose = enriched?.minutesUntilClose;
  const urgency = getClosingUrgency(minutesUntilClose);

  return (
    <div
      className={`lift-item cursor-pointer flex justify-between hover:bg-white/5 ${isClosed ? 'opacity-50' : ''}`}
      onClick={onClick}
      style={{
        padding: '1px 4px',
        textDecoration: isClosed ? 'line-through' : 'none',
      }}
    >
      <span
        style={{
          fontSize: 9,
          color: urgency === 'urgent' ? STATUS_COLORS.closed : urgency === 'warning' ? STATUS_COLORS.scheduled : '#ccc',
          lineHeight: '14px'
        }}
        className="truncate"
      >
        {name}
      </span>
      <div className="flex items-center" style={{ flexShrink: 0 }}>
        <StatusIndicator status={lift.status} minutesUntilClose={minutesUntilClose} size="tiny" />
        {lift.liftType && (
          <span style={{ fontSize: 8, color: '#666', marginLeft: 4 }}>
            {lift.liftType}
          </span>
        )}
        {showLocality && lift.locality && (
          <span style={{ fontSize: 8, color: '#666', marginLeft: 4 }}>
            {lift.locality}
          </span>
        )}
      </div>
    </div>
  );
});

// Locality header
const LocalityHeader = memo(function LocalityHeader({
  name,
  count,
  isExpanded,
  onClick,
}: {
  name: string;
  count: number;
  isExpanded: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-white/5 rounded"
      onClick={onClick}
    >
      {isExpanded ? <DownOutlined style={{ fontSize: 7 }} /> : <RightOutlined style={{ fontSize: 7 }} />}
      <EnvironmentOutlined style={{ fontSize: 9, color: '#60a5fa' }} />
      <span style={{ fontSize: 10, color: '#60a5fa', fontWeight: 500 }}>
        {name} ({count})
      </span>
    </div>
  );
});

// Difficulty group header
const DifficultyHeader = memo(function DifficultyHeader({
  difficulty,
  label,
  count,
  isExpanded,
  onClick
}: {
  difficulty: string;
  label: string;
  count: number;
  isExpanded: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-white/5 rounded"
      onClick={onClick}
    >
      {isExpanded ? <DownOutlined style={{ fontSize: 7 }} /> : <RightOutlined style={{ fontSize: 7 }} />}
      <div
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: getDifficultyColor(difficulty) }}
      />
      <span style={{ fontSize: 10, color: '#888' }}>
        {label} ({count})
      </span>
    </div>
  );
});

// Waiting time item component
const WaitingTimeItem = memo(function WaitingTimeItem({
  lift,
  onClick
}: {
  lift: LiftData | EnrichedLiftData;
  onClick: () => void;
}) {
  const enriched = isEnrichedLift(lift) ? lift : null;
  const waitingTime = enriched?.waitingTime ?? enriched?.liveStatus?.waitingTime ?? 0;
  const hasLongWait = waitingTime > 10;

  return (
    <div
      className="waiting-time-item cursor-pointer flex items-center justify-between hover:bg-white/5"
      onClick={onClick}
      style={{ padding: '2px 4px' }}
    >
      <span
        className="truncate"
        style={{
          fontSize: 9,
          color: hasLongWait ? '#f97316' : '#ccc',
          lineHeight: '14px',
          flex: 1
        }}
      >
        {lift.name || 'Unnamed'}
      </span>
      <span
        style={{
          fontSize: 9,
          color: hasLongWait ? '#f97316' : '#22c55e',
          fontWeight: 600,
          marginLeft: 8,
          flexShrink: 0
        }}
      >
        {waitingTime === 0 ? 'No wait' : `${waitingTime} min`}
      </span>
    </div>
  );
});

// Lift highlight item component for showing ranking stats
const LiftHighlightItem = memo(function LiftHighlightItem({
  lift,
  rank,
  value,
  unit,
  onClick
}: {
  lift: LiftData | EnrichedLiftData;
  rank: number;
  value: string | number;
  unit: string;
  onClick: () => void;
}) {
  return (
    <div
      className="lift-highlight-item cursor-pointer flex items-center justify-between hover:bg-white/5"
      onClick={onClick}
      style={{ padding: '2px 4px' }}
    >
      <div className="flex items-center gap-1.5" style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: 8,
            color: rank <= 3 ? '#fbbf24' : '#666',
            fontWeight: rank <= 3 ? 600 : 400,
            width: 14,
            flexShrink: 0
          }}
        >
          #{rank}
        </span>
        <span
          className="truncate"
          style={{
            fontSize: 9,
            color: '#ccc',
            lineHeight: '14px'
          }}
        >
          {lift.name || 'Unnamed'}
        </span>
      </div>
      <span
        style={{
          fontSize: 9,
          color: '#60a5fa',
          fontWeight: 500,
          marginLeft: 8,
          flexShrink: 0
        }}
      >
        {value} {unit}
      </span>
    </div>
  );
});

function TrailsListInner({
  runs,
  lifts,
  localities = [],
  onSelectRun,
  onSelectLift,
  onSelectLocality
}: TrailsLiftsListProps) {
  const [searchText, setSearchText] = useState('');
  const [runsExpanded, setRunsExpanded] = useState(false);
  const [liftsExpanded, setLiftsExpanded] = useState(false);
  const [waitingTimesExpanded, setWaitingTimesExpanded] = useState(false);
  const [liftHighlightsExpanded, setLiftHighlightsExpanded] = useState(false);
  const [fastestLiftsExpanded, setFastestLiftsExpanded] = useState(false);
  const [fastestChairliftsExpanded, setFastestChairliftsExpanded] = useState(false);
  const [highestCapacityExpanded, setHighestCapacityExpanded] = useState(false);
  const [longestLiftsExpanded, setLongestLiftsExpanded] = useState(false);
  const [highestAltitudeGainExpanded, setHighestAltitudeGainExpanded] = useState(false);
  const [expandedLocalities, setExpandedLocalities] = useState<Set<string>>(new Set());
  const [expandedDifficulties, setExpandedDifficulties] = useState<Set<string>>(new Set());
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const [isPending, startTransition] = useTransition();

  // Check if we have localities to group by
  const hasLocalities = localities.length > 0;

  // Debounced search with transition
  const handleSearchChange = useCallback((value: string) => {
    startTransition(() => {
      setSearchText(value);
    });
  }, []);

  // Filter runs and lifts by search
  // Filter out unnamed runs and deduplicate by name+locality (keep highest altitude)
  const filteredRuns = useMemo(() => {
    const namedRuns = runs.filter(r => r.name);

    // Apply search filter if present
    const searchFiltered = !searchText
      ? namedRuns
      : namedRuns.filter(r => {
          const lower = searchText.toLowerCase();
          return r.name?.toLowerCase().includes(lower) ||
                 r.difficulty?.toLowerCase().includes(lower) ||
                 r.locality?.toLowerCase().includes(lower);
        });

    // Deduplicate: group by name+locality, keep highest altitude
    const grouped = new Map<string, typeof searchFiltered[0]>();
    for (const run of searchFiltered) {
      const key = `${run.name}::${run.locality || ''}`;
      const existing = grouped.get(key);

      if (!existing) {
        grouped.set(key, run);
      } else {
        // Get max elevation from geometry (first point for runs)
        const getMaxElevation = (r: typeof run) => {
          if (r.geometry.type === 'LineString') {
            const coords = r.geometry.coordinates;
            return coords.length > 0 ? (coords[0][2] || coords[0][1]) : 0;
          } else if (r.geometry.type === 'Polygon') {
            const ring = r.geometry.coordinates[0];
            return ring.length > 0 ? (ring[0][2] || ring[0][1]) : 0;
          }
          return 0;
        };

        // Keep the run with higher starting elevation
        if (getMaxElevation(run) > getMaxElevation(existing)) {
          grouped.set(key, run);
        }
      }
    }

    return Array.from(grouped.values());
  }, [runs, searchText]);

  const filteredLifts = useMemo(() => {
    if (!searchText) return lifts;
    const lower = searchText.toLowerCase();
    return lifts.filter(l =>
      l.name?.toLowerCase().includes(lower) ||
      l.liftType?.toLowerCase().includes(lower) ||
      l.locality?.toLowerCase().includes(lower)
    );
  }, [lifts, searchText]);

  // Count closed items
  const closedLiftsCount = useMemo(() =>
    filteredLifts.filter(l => l.status === 'closed').length
  , [filteredLifts]);

  const closedRunsCount = useMemo(() =>
    filteredRuns.filter(r => r.status === 'closed').length
  , [filteredRuns]);

  // Top 10 lifts with longest waiting times
  const liftsWithWaitingTimes = useMemo(() => {
    return lifts
      .filter(lift => {
        if (!isEnrichedLift(lift)) return false;
        const waitTime = lift.waitingTime ?? lift.liveStatus?.waitingTime;
        return typeof waitTime === 'number';
      })
      .map(lift => {
        const enriched = lift as EnrichedLiftData;
        const waitTime = enriched.waitingTime ?? enriched.liveStatus?.waitingTime ?? 0;
        return { lift, waitTime };
      })
      .sort((a, b) => b.waitTime - a.waitTime)
      .slice(0, 10)
      .map(item => item.lift);
  }, [lifts]);

  const hasWaitingTimeData = liftsWithWaitingTimes.length > 0;

  // Helper to get speed for a lift (either direct speed field or calculated from length/duration)
  const getLiftSpeed = useCallback((lift: LiftData | EnrichedLiftData): number | null => {
    const enriched = isEnrichedLift(lift) ? lift : null;
    const liveStatus = enriched?.liveStatus;

    // Try direct speed field first
    if (liveStatus?.speed && liveStatus.speed > 0) {
      return liveStatus.speed;
    }

    // Calculate from length and duration
    const length = liveStatus?.length;
    const duration = liveStatus?.duration;
    if (length && length > 0 && duration && duration > 0) {
      // length is meters, duration is minutes -> convert to m/s
      return length / (duration * 60);
    }

    return null;
  }, []);

  // Top 10 fastest lifts (by speed in m/s)
  const fastestLifts = useMemo(() => {
    return lifts
      .map(lift => {
        const speed = getLiftSpeed(lift);
        return { lift, speed };
      })
      .filter((item): item is { lift: typeof item.lift; speed: number } => item.speed !== null)
      .sort((a, b) => b.speed - a.speed)
      .slice(0, 10);
  }, [lifts, getLiftSpeed]);

  // Top 10 fastest chairlifts
  const fastestChairlifts = useMemo(() => {
    const chairliftTypes = ['chair_lift', 'chairlift', 'chair'];
    return lifts
      .filter(lift => {
        const liftType = lift.liftType?.toLowerCase() || '';
        const enriched = isEnrichedLift(lift) ? lift : null;
        const liveType = enriched?.liveStatus?.liftType?.toLowerCase() || '';
        return chairliftTypes.some(t => liftType.includes(t) || liveType.includes(t));
      })
      .map(lift => {
        const speed = getLiftSpeed(lift);
        return { lift, speed };
      })
      .filter((item): item is { lift: typeof item.lift; speed: number } => item.speed !== null)
      .sort((a, b) => b.speed - a.speed)
      .slice(0, 10);
  }, [lifts, getLiftSpeed]);

  // Top 10 highest capacity lifts (people per hour)
  const highestCapacityLifts = useMemo(() => {
    return lifts
      .map(lift => {
        const enriched = isEnrichedLift(lift) ? lift : null;
        const liveStatus = enriched?.liveStatus;
        // Use uphillCapacity if available, otherwise capacity
        const capacity = liveStatus?.uphillCapacity ?? liveStatus?.capacity ?? lift.capacity;
        return { lift, capacity };
      })
      .filter((item): item is { lift: typeof item.lift; capacity: number } =>
        item.capacity !== null && item.capacity !== undefined && item.capacity > 0
      )
      .sort((a, b) => b.capacity - a.capacity)
      .slice(0, 10);
  }, [lifts]);

  // Top 10 longest lifts (by length in meters)
  const longestLifts = useMemo(() => {
    return lifts
      .map(lift => {
        const enriched = isEnrichedLift(lift) ? lift : null;
        const length = enriched?.liveStatus?.length;
        return { lift, length };
      })
      .filter((item): item is { lift: typeof item.lift; length: number } =>
        item.length !== null && item.length !== undefined && item.length > 0
      )
      .sort((a, b) => b.length - a.length)
      .slice(0, 10);
  }, [lifts]);

  // Top 10 highest altitude gain lifts
  const highestAltitudeGainLifts = useMemo(() => {
    return lifts
      .map(lift => {
        const enriched = isEnrichedLift(lift) ? lift : null;
        const liveStatus = enriched?.liveStatus;
        const arrival = liveStatus?.arrivalAltitude;
        const departure = liveStatus?.departureAltitude;
        if (arrival !== undefined && departure !== undefined) {
          const gain = arrival - departure;
          return { lift, altitudeGain: gain };
        }
        return { lift, altitudeGain: null };
      })
      .filter((item): item is { lift: typeof item.lift; altitudeGain: number } =>
        item.altitudeGain !== null && item.altitudeGain > 0
      )
      .sort((a, b) => b.altitudeGain - a.altitudeGain)
      .slice(0, 10);
  }, [lifts]);

  // Check if we have any lift highlights data
  const hasLiftHighlightsData =
    fastestLifts.length > 0 ||
    fastestChairlifts.length > 0 ||
    highestCapacityLifts.length > 0 ||
    longestLifts.length > 0 ||
    highestAltitudeGainLifts.length > 0;

  // Group runs by locality, then by difficulty
  const runsByLocalityAndDifficulty = useMemo(() => {
    if (!hasLocalities) return null;

    type RunType = RunData | EnrichedRunData;
    const groups: Record<string, { locality: string | null; runs: Record<string, RunType[]> }> = {};
    const diffOrder = ['novice', 'easy', 'intermediate', 'advanced', 'expert', 'unknown'];

    // Create group for each locality
    localities.forEach(locality => {
      groups[locality] = { locality, runs: {} };
      diffOrder.forEach(d => groups[locality].runs[d] = []);
    });

    // Create "Other" group for runs without locality
    groups['_other'] = { locality: null, runs: {} };
    diffOrder.forEach(d => groups['_other'].runs[d] = []);

    // Sort runs into groups
    filteredRuns.forEach(run => {
      const locality = run.locality || '_other';
      const difficulty = run.difficulty || 'unknown';
      if (!groups[locality]) {
        // Locality not found, put in other
        groups['_other'].runs[difficulty]?.push(run);
      } else {
        groups[locality].runs[difficulty]?.push(run);
      }
    });

    // Filter out empty groups and sort
    const result = Object.entries(groups)
      .filter(([_, data]) => Object.values(data.runs).some(arr => arr.length > 0))
      .sort(([aId, a], [bId, b]) => {
        // Put "Other" last
        if (aId === '_other') return 1;
        if (bId === '_other') return -1;
        // Sort by locality name
        const aName = a.locality || '';
        const bName = b.locality || '';
        return aName.localeCompare(bName);
      });

    return result;
  }, [filteredRuns, localities, hasLocalities]);

  // Group runs by difficulty only (when no localities)
  const runsByDifficulty = useMemo(() => {
    if (hasLocalities) return null;

    type RunType = RunData | EnrichedRunData;
    const groups: Record<string, RunType[]> = {};
    const order = ['novice', 'easy', 'intermediate', 'advanced', 'expert', 'unknown'];
    order.forEach(d => groups[d] = []);

    filteredRuns.forEach(run => {
      const diff = run.difficulty || 'unknown';
      if (!groups[diff]) groups[diff] = [];
      groups[diff].push(run);
    });

    // Only return non-empty groups
    return Object.entries(groups).filter(([_, arr]) => arr.length > 0);
  }, [filteredRuns, hasLocalities]);

  // Group lifts by locality
  const liftsByLocality = useMemo(() => {
    if (!hasLocalities) return null;

    type LiftType = LiftData | EnrichedLiftData;
    const groups: Record<string, { locality: string | null; lifts: LiftType[] }> = {};

    // Create group for each locality
    localities.forEach(locality => {
      groups[locality] = { locality, lifts: [] };
    });

    // Create "Other" group for lifts without locality
    groups['_other'] = { locality: null, lifts: [] };

    // Sort lifts into groups
    filteredLifts.forEach(lift => {
      const locality = lift.locality || '_other';
      if (!groups[locality]) {
        // Locality not found, put in other
        groups['_other'].lifts.push(lift);
      } else {
        groups[locality].lifts.push(lift);
      }
    });

    // Filter out empty groups and sort
    const result = Object.entries(groups)
      .filter(([_, data]) => data.lifts.length > 0)
      .sort(([aId, a], [bId, b]) => {
        // Put "Other" last
        if (aId === '_other') return 1;
        if (bId === '_other') return -1;
        // Sort by locality name
        const aName = a.locality || '';
        const bName = b.locality || '';
        return aName.localeCompare(bName);
      });

    return result;
  }, [filteredLifts, localities, hasLocalities]);

  const difficultyLabels: Record<string, string> = {
    novice: 'Novice',
    easy: 'Easy',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
    expert: 'Expert',
    unknown: 'Unknown',
  };

  const toggleLocality = useCallback((locality: string) => {
    setExpandedLocalities(prev => {
      const next = new Set(prev);
      if (next.has(locality)) {
        next.delete(locality);
      } else {
        next.add(locality);
      }
      return next;
    });
  }, []);

  const toggleDifficulty = useCallback((key: string) => {
    setExpandedDifficulties(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const loadMore = useCallback((key: string) => {
    setVisibleCounts(prev => ({
      ...prev,
      [key]: (prev[key] || ITEMS_PER_PAGE) + ITEMS_PER_PAGE
    }));
  }, []);

  const getVisibleCount = (key: string) => visibleCounts[key] || ITEMS_PER_PAGE;

  const renderRunsByDifficulty = (
    difficultyGroups: [string, (RunData | EnrichedRunData)[]][],
    keyPrefix: string = '',
    showLocality: boolean = false
  ) => {
    return difficultyGroups.map(([difficulty, groupRuns]) => {
      const key = `${keyPrefix}${difficulty}`;
      const isExpanded = expandedDifficulties.has(key);
      const visible = getVisibleCount(`runs-${key}`);
      const visibleRuns = groupRuns.slice(0, visible);
      const hasMore = groupRuns.length > visible;
      // Count closed runs in this group
      const closedCount = groupRuns.filter(r => r.status === 'closed').length;

      return (
        <div key={key} className="mb-0.5">
          <DifficultyHeader
            difficulty={difficulty}
            label={difficultyLabels[difficulty] || difficulty}
            count={groupRuns.length}
            isExpanded={isExpanded}
            onClick={() => toggleDifficulty(key)}
          />
          {closedCount > 0 && (
            <span style={{ fontSize: 8, color: STATUS_COLORS.closed, marginLeft: 4 }}>
              ({closedCount} closed)
            </span>
          )}

          {isExpanded && (
            <div className="ml-3">
              {visibleRuns.map(run => (
                <RunItem
                  key={run.id}
                  run={run}
                  showLocality={showLocality}
                  onClick={() => onSelectRun?.(run)}
                />
              ))}
              {hasMore && (
                <button
                  className="text-blue-400 hover:text-blue-300"
                  style={{ fontSize: 9, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
                  onClick={() => loadMore(`runs-${key}`)}
                >
                  +{groupRuns.length - visible} more
                </button>
              )}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="trails-lifts-list text-sm">
      <Input
        placeholder="Search runs, lifts..."
        prefix={<SearchOutlined style={{ fontSize: 10, opacity: 0.5 }} />}
        value={searchText}
        onChange={(e) => handleSearchChange(e.target.value)}
        size="small"
        allowClear
        style={{ marginBottom: 6 }}
      />

      {isPending && (
        <div style={{ fontSize: 9, color: '#666', marginBottom: 4 }}>Filtering...</div>
      )}

      {/* Waiting Times Section - only show if we have waiting time data */}
      {hasWaitingTimeData && (
        <div className="mb-1">
          <div
            className="flex items-center gap-2 py-1 cursor-pointer hover:bg-white/5 rounded"
            onClick={() => setWaitingTimesExpanded(!waitingTimesExpanded)}
          >
            {waitingTimesExpanded ? <DownOutlined style={{ fontSize: 8 }} /> : <RightOutlined style={{ fontSize: 8 }} />}
            <FieldTimeOutlined style={{ fontSize: 10, color: '#f97316' }} />
            <span style={{ fontSize: 10, color: '#f97316' }}>Queue Times</span>
          </div>

          {waitingTimesExpanded && (
            <div className="ml-3">
              {liftsWithWaitingTimes.map(lift => (
                <WaitingTimeItem
                  key={lift.id}
                  lift={lift}
                  onClick={() => onSelectLift?.(lift)}
                />
              ))}
              {liftsWithWaitingTimes.length === 0 && (
                <span style={{ fontSize: 10, color: '#666' }}>No queue data available</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Runs Section */}
      <div className="mb-1">
        <div
          className="flex items-center gap-2 py-1 cursor-pointer hover:bg-white/5 rounded"
          onClick={() => setRunsExpanded(!runsExpanded)}
        >
          {runsExpanded ? <DownOutlined style={{ fontSize: 8 }} /> : <RightOutlined style={{ fontSize: 8 }} />}
          <NodeIndexOutlined style={{ fontSize: 10 }} />
          <span style={{ fontSize: 10 }}>Runs ({filteredRuns.length})</span>
          {closedRunsCount > 0 && (
            <span style={{ fontSize: 8, color: STATUS_COLORS.closed }}>
              ({closedRunsCount} closed)
            </span>
          )}
        </div>

        {runsExpanded && (
          <div className="ml-3">
            {/* With localities: group by locality first */}
            {hasLocalities && runsByLocalityAndDifficulty && (
              <>
                {runsByLocalityAndDifficulty.map(([localityKey, data]) => {
                  const isExpanded = expandedLocalities.has(localityKey);
                  const totalRuns = Object.values(data.runs).reduce((sum, arr) => sum + arr.length, 0);
                  const localityName = data.locality || 'Other';

                  return (
                    <div key={localityKey} className="mb-1">
                      <LocalityHeader
                        name={localityName}
                        count={totalRuns}
                        isExpanded={isExpanded}
                        onClick={() => toggleLocality(localityKey)}
                      />

                      {isExpanded && (
                        <div className="ml-3">
                          {renderRunsByDifficulty(
                            Object.entries(data.runs).filter(([_, arr]) => arr.length > 0),
                            `${localityKey}-`
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* Without localities: just group by difficulty */}
            {!hasLocalities && runsByDifficulty && (
              renderRunsByDifficulty(runsByDifficulty, '', true)
            )}

            {filteredRuns.length === 0 && (
              <span style={{ fontSize: 10, color: '#666' }}>No runs</span>
            )}
          </div>
        )}
      </div>

      {/* Lifts Section */}
      <div className="mb-1">
        <div
          className="flex items-center gap-2 py-1 cursor-pointer hover:bg-white/5 rounded"
          onClick={() => setLiftsExpanded(!liftsExpanded)}
        >
          {liftsExpanded ? <DownOutlined style={{ fontSize: 8 }} /> : <RightOutlined style={{ fontSize: 8 }} />}
          <SwapOutlined style={{ fontSize: 10 }} />
          <span style={{ fontSize: 10 }}>Lifts ({filteredLifts.length})</span>
          {closedLiftsCount > 0 && (
            <span style={{ fontSize: 8, color: STATUS_COLORS.closed }}>
              ({closedLiftsCount} closed)
            </span>
          )}
        </div>

        {liftsExpanded && (
          <div className="ml-3">
            {/* With localities: group by locality */}
            {hasLocalities && liftsByLocality && (
              <>
                {liftsByLocality.map(([localityKey, data]) => {
                  const isExpanded = expandedLocalities.has(`lifts-${localityKey}`);
                  const localityName = data.locality || 'Other';
                  const visible = getVisibleCount(`lifts-${localityKey}`);
                  const visibleLifts = data.lifts.slice(0, visible);
                  const hasMore = data.lifts.length > visible;
                  const closedInGroup = data.lifts.filter(l => l.status === 'closed').length;

                  return (
                    <div key={localityKey} className="mb-1">
                      <div className="flex items-center">
                        <LocalityHeader
                          name={localityName}
                          count={data.lifts.length}
                          isExpanded={isExpanded}
                          onClick={() => toggleLocality(`lifts-${localityKey}`)}
                        />
                        {closedInGroup > 0 && (
                          <span style={{ fontSize: 8, color: STATUS_COLORS.closed, marginLeft: 4 }}>
                            ({closedInGroup} closed)
                          </span>
                        )}
                      </div>

                      {isExpanded && (
                        <div className="ml-3">
                          {visibleLifts.map(lift => (
                            <LiftItem
                              key={lift.id}
                              lift={lift}
                              onClick={() => onSelectLift?.(lift)}
                            />
                          ))}
                          {hasMore && (
                            <button
                              className="text-blue-400 hover:text-blue-300"
                              style={{ fontSize: 9, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
                              onClick={() => loadMore(`lifts-${localityKey}`)}
                            >
                              +{data.lifts.length - visible} more
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* Without localities: flat list */}
            {!hasLocalities && (
              <>
                {filteredLifts.slice(0, getVisibleCount('lifts')).map(lift => (
                  <LiftItem
                    key={lift.id}
                    lift={lift}
                    showLocality
                    onClick={() => onSelectLift?.(lift)}
                  />
                ))}
                {filteredLifts.length > getVisibleCount('lifts') && (
                  <button
                    className="text-blue-400 hover:text-blue-300"
                    style={{ fontSize: 9, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
                    onClick={() => loadMore('lifts')}
                  >
                    +{filteredLifts.length - getVisibleCount('lifts')} more
                  </button>
                )}
              </>
            )}

            {filteredLifts.length === 0 && (
              <span style={{ fontSize: 10, color: '#666' }}>No lifts</span>
            )}
          </div>
        )}
      </div>

      {/* Lift Highlights Section - only show if we have highlight data */}
      {hasLiftHighlightsData && (
        <div className="mb-1">
          <div
            className="flex items-center gap-2 py-1 cursor-pointer hover:bg-white/5 rounded"
            onClick={() => setLiftHighlightsExpanded(!liftHighlightsExpanded)}
          >
            {liftHighlightsExpanded ? <DownOutlined style={{ fontSize: 8 }} /> : <RightOutlined style={{ fontSize: 8 }} />}
            <ThunderboltOutlined style={{ fontSize: 10, color: '#fbbf24' }} />
            <span style={{ fontSize: 10, color: '#fbbf24' }}>Lift Highlights</span>
          </div>

          {liftHighlightsExpanded && (
            <div className="ml-3">
              {/* Fastest Lifts */}
              {fastestLifts.length > 0 && (
                <div className="mb-0.5">
                  <div
                    className="flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-white/5 rounded"
                    onClick={() => setFastestLiftsExpanded(!fastestLiftsExpanded)}
                  >
                    {fastestLiftsExpanded ? <DownOutlined style={{ fontSize: 7 }} /> : <RightOutlined style={{ fontSize: 7 }} />}
                    <RocketOutlined style={{ fontSize: 9, color: '#22d3ee' }} />
                    <span style={{ fontSize: 10, color: '#888' }}>
                      Fastest Lifts ({fastestLifts.length})
                    </span>
                  </div>
                  {fastestLiftsExpanded && (
                    <div className="ml-3">
                      {fastestLifts.map((item, idx) => (
                        <LiftHighlightItem
                          key={item.lift.id}
                          lift={item.lift}
                          rank={idx + 1}
                          value={(item.speed * 3.6).toFixed(1)}
                          unit="km/h"
                          onClick={() => onSelectLift?.(item.lift)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Fastest Chairlifts */}
              {fastestChairlifts.length > 0 && (
                <div className="mb-0.5">
                  <div
                    className="flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-white/5 rounded"
                    onClick={() => setFastestChairliftsExpanded(!fastestChairliftsExpanded)}
                  >
                    {fastestChairliftsExpanded ? <DownOutlined style={{ fontSize: 7 }} /> : <RightOutlined style={{ fontSize: 7 }} />}
                    <RocketOutlined style={{ fontSize: 9, color: '#a78bfa' }} />
                    <span style={{ fontSize: 10, color: '#888' }}>
                      Fastest Chairlifts ({fastestChairlifts.length})
                    </span>
                  </div>
                  {fastestChairliftsExpanded && (
                    <div className="ml-3">
                      {fastestChairlifts.map((item, idx) => (
                        <LiftHighlightItem
                          key={item.lift.id}
                          lift={item.lift}
                          rank={idx + 1}
                          value={(item.speed * 3.6).toFixed(1)}
                          unit="km/h"
                          onClick={() => onSelectLift?.(item.lift)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Highest Capacity */}
              {highestCapacityLifts.length > 0 && (
                <div className="mb-0.5">
                  <div
                    className="flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-white/5 rounded"
                    onClick={() => setHighestCapacityExpanded(!highestCapacityExpanded)}
                  >
                    {highestCapacityExpanded ? <DownOutlined style={{ fontSize: 7 }} /> : <RightOutlined style={{ fontSize: 7 }} />}
                    <TeamOutlined style={{ fontSize: 9, color: '#4ade80' }} />
                    <span style={{ fontSize: 10, color: '#888' }}>
                      Highest Capacity ({highestCapacityLifts.length})
                    </span>
                  </div>
                  {highestCapacityExpanded && (
                    <div className="ml-3">
                      {highestCapacityLifts.map((item, idx) => (
                        <LiftHighlightItem
                          key={item.lift.id}
                          lift={item.lift}
                          rank={idx + 1}
                          value={item.capacity.toLocaleString()}
                          unit="p/h"
                          onClick={() => onSelectLift?.(item.lift)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Longest Lifts */}
              {longestLifts.length > 0 && (
                <div className="mb-0.5">
                  <div
                    className="flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-white/5 rounded"
                    onClick={() => setLongestLiftsExpanded(!longestLiftsExpanded)}
                  >
                    {longestLiftsExpanded ? <DownOutlined style={{ fontSize: 7 }} /> : <RightOutlined style={{ fontSize: 7 }} />}
                    <ColumnHeightOutlined style={{ fontSize: 9, color: '#fb923c' }} />
                    <span style={{ fontSize: 10, color: '#888' }}>
                      Longest Lifts ({longestLifts.length})
                    </span>
                  </div>
                  {longestLiftsExpanded && (
                    <div className="ml-3">
                      {longestLifts.map((item, idx) => (
                        <LiftHighlightItem
                          key={item.lift.id}
                          lift={item.lift}
                          rank={idx + 1}
                          value={(item.length / 1000).toFixed(2)}
                          unit="km"
                          onClick={() => onSelectLift?.(item.lift)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Highest Altitude Gain */}
              {highestAltitudeGainLifts.length > 0 && (
                <div className="mb-0.5">
                  <div
                    className="flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-white/5 rounded"
                    onClick={() => setHighestAltitudeGainExpanded(!highestAltitudeGainExpanded)}
                  >
                    {highestAltitudeGainExpanded ? <DownOutlined style={{ fontSize: 7 }} /> : <RightOutlined style={{ fontSize: 7 }} />}
                    <ArrowUpOutlined style={{ fontSize: 9, color: '#f472b6' }} />
                    <span style={{ fontSize: 10, color: '#888' }}>
                      Highest Altitude Gain ({highestAltitudeGainLifts.length})
                    </span>
                  </div>
                  {highestAltitudeGainExpanded && (
                    <div className="ml-3">
                      {highestAltitudeGainLifts.map((item, idx) => (
                        <LiftHighlightItem
                          key={item.lift.id}
                          lift={item.lift}
                          rank={idx + 1}
                          value={item.altitudeGain.toLocaleString()}
                          unit="m"
                          onClick={() => onSelectLift?.(item.lift)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Memoize the entire component to prevent parent re-renders from affecting it
const TrailsLiftsList = memo(TrailsListInner);
export default TrailsLiftsList;

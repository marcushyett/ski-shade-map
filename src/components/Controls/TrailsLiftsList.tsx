'use client';

import { useState, useMemo, useCallback, memo, useTransition } from 'react';
import { Input, Typography, Button } from 'antd';
import {
  SearchOutlined,
  NodeIndexOutlined,
  SwapOutlined,
  DownOutlined,
  RightOutlined,
  EnvironmentOutlined,
} from '@ant-design/icons';
import type { RunData, LiftData } from '@/lib/types';
import { getDifficultyColor } from '@/lib/shade-calculator';

const { Text } = Typography;

// Max items to show per group
const ITEMS_PER_PAGE = 15;

interface TrailsLiftsListProps {
  runs: RunData[];
  lifts: LiftData[];
  localities?: string[];
  onSelectRun?: (run: RunData) => void;
  onSelectLift?: (lift: LiftData) => void;
  onSelectLocality?: (locality: string) => void;
}

// Simple run item - minimal DOM, tight spacing
const RunItem = memo(function RunItem({
  name,
  locality,
  onClick
}: {
  name: string;
  locality?: string | null;
  onClick: () => void;
}) {
  return (
    <div
      className="run-item cursor-pointer flex items-center justify-between hover:bg-white/5"
      onClick={onClick}
      style={{ padding: '1px 4px' }}
    >
      <span className="truncate" style={{ fontSize: 9, color: '#ccc', lineHeight: '14px' }}>
        {name}
      </span>
      {locality && (
        <span style={{ fontSize: 8, color: '#666', marginLeft: 4, flexShrink: 0 }}>
          {locality}
        </span>
      )}
    </div>
  );
});

// Simple lift item - tight spacing to match runs
const LiftItem = memo(function LiftItem({
  name,
  liftType,
  onClick
}: {
  name: string;
  liftType?: string | null;
  onClick: () => void;
}) {
  return (
    <div
      className="lift-item cursor-pointer flex justify-between hover:bg-white/5"
      onClick={onClick}
      style={{ padding: '1px 4px' }}
    >
      <span style={{ fontSize: 9, color: '#ccc', lineHeight: '14px' }} className="truncate">
        {name}
      </span>
      {liftType && (
        <span style={{ fontSize: 8, color: '#666', marginLeft: 4, flexShrink: 0 }}>
          {liftType}
        </span>
      )}
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
      l.liftType?.toLowerCase().includes(lower)
    );
  }, [lifts, searchText]);

  // Group runs by locality, then by difficulty
  const runsByLocalityAndDifficulty = useMemo(() => {
    if (!hasLocalities) return null;

    const groups: Record<string, { locality: string | null; runs: Record<string, RunData[]> }> = {};
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

    const groups: Record<string, RunData[]> = {};
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
    difficultyGroups: [string, RunData[]][],
    keyPrefix: string = '',
    showLocality: boolean = false
  ) => {
    return difficultyGroups.map(([difficulty, groupRuns]) => {
      const key = `${keyPrefix}${difficulty}`;
      const isExpanded = expandedDifficulties.has(key);
      const visible = getVisibleCount(`runs-${key}`);
      const visibleRuns = groupRuns.slice(0, visible);
      const hasMore = groupRuns.length > visible;

      return (
        <div key={key} className="mb-0.5">
          <DifficultyHeader
            difficulty={difficulty}
            label={difficultyLabels[difficulty] || difficulty}
            count={groupRuns.length}
            isExpanded={isExpanded}
            onClick={() => toggleDifficulty(key)}
          />

          {isExpanded && (
            <div className="ml-3">
              {visibleRuns.map(run => (
                <RunItem
                  key={run.id}
                  name={run.name || 'Unnamed'}
                  locality={showLocality ? run.locality : undefined}
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

      {/* Runs Section */}
      <div className="mb-1">
        <div
          className="flex items-center gap-2 py-1 cursor-pointer hover:bg-white/5 rounded"
          onClick={() => setRunsExpanded(!runsExpanded)}
        >
          {runsExpanded ? <DownOutlined style={{ fontSize: 8 }} /> : <RightOutlined style={{ fontSize: 8 }} />}
          <NodeIndexOutlined style={{ fontSize: 10 }} />
          <span style={{ fontSize: 10 }}>Runs ({filteredRuns.length})</span>
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
        </div>

        {liftsExpanded && (
          <div className="ml-3">
            {filteredLifts.slice(0, getVisibleCount('lifts')).map(lift => (
              <LiftItem
                key={lift.id}
                name={lift.name || 'Unnamed'}
                liftType={lift.liftType}
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
            {filteredLifts.length === 0 && (
              <span style={{ fontSize: 10, color: '#666' }}>No lifts</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Memoize the entire component to prevent parent re-renders from affecting it
const TrailsLiftsList = memo(TrailsListInner);
export default TrailsLiftsList;

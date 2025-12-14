'use client';

import { useState, useMemo, useCallback, memo, useTransition } from 'react';
import { Input, Typography, Button } from 'antd';
import { 
  SearchOutlined, 
  NodeIndexOutlined, 
  SwapOutlined,
  DownOutlined,
  RightOutlined,
  EnvironmentOutlined
} from '@ant-design/icons';
import type { RunData, LiftData, SubRegionData } from '@/lib/types';
import { getDifficultyColor } from '@/lib/shade-calculator';

const { Text } = Typography;

// Max items to show per group
const ITEMS_PER_PAGE = 15;

interface TrailsLiftsListProps {
  runs: RunData[];
  lifts: LiftData[];
  subRegions?: SubRegionData[];
  onSelectRun?: (run: RunData) => void;
  onSelectLift?: (lift: LiftData) => void;
  onSelectSubRegion?: (subRegion: SubRegionData) => void;
}

// Simple run item - minimal DOM
const RunItem = memo(function RunItem({ 
  name, 
  subRegionName,
  onClick 
}: { 
  name: string;
  subRegionName?: string | null;
  onClick: () => void;
}) {
  return (
    <div 
      className="run-item py-0.5 px-1 cursor-pointer flex items-center justify-between"
      onClick={onClick}
    >
      <span className="truncate" style={{ fontSize: 10, color: '#ccc' }}>
        {name}
      </span>
      {subRegionName && (
        <span style={{ fontSize: 8, color: '#666', marginLeft: 4, flexShrink: 0 }}>
          {subRegionName}
        </span>
      )}
    </div>
  );
});

// Simple lift item
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
      className="lift-item py-0.5 px-1 cursor-pointer flex justify-between"
      onClick={onClick}
    >
      <span style={{ fontSize: 10, color: '#ccc' }} className="truncate">
        {name}
      </span>
      {liftType && (
        <span style={{ fontSize: 9, color: '#666', marginLeft: 4, flexShrink: 0 }}>
          {liftType}
        </span>
      )}
    </div>
  );
});

// Sub-region header
const SubRegionHeader = memo(function SubRegionHeader({
  name,
  count,
  isExpanded,
  onClick,
  onNavigate
}: {
  name: string;
  count: number;
  isExpanded: boolean;
  onClick: () => void;
  onNavigate?: () => void;
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
      {onNavigate && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(); }}
          style={{ 
            fontSize: 8, 
            color: '#888', 
            background: 'none', 
            border: 'none', 
            cursor: 'pointer',
            marginLeft: 4 
          }}
          title="Go to sub-region"
        >
          →
        </button>
      )}
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
  subRegions = [],
  onSelectRun, 
  onSelectLift,
  onSelectSubRegion
}: TrailsLiftsListProps) {
  const [searchText, setSearchText] = useState('');
  const [runsExpanded, setRunsExpanded] = useState(false);
  const [liftsExpanded, setLiftsExpanded] = useState(false);
  const [expandedSubRegions, setExpandedSubRegions] = useState<Set<string>>(new Set());
  const [expandedDifficulties, setExpandedDifficulties] = useState<Set<string>>(new Set());
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const [isPending, startTransition] = useTransition();

  // Check if we have sub-regions to group by
  const hasSubRegions = subRegions.length > 0;

  // Debounced search with transition
  const handleSearchChange = useCallback((value: string) => {
    startTransition(() => {
      setSearchText(value);
    });
  }, []);

  // Filter runs and lifts by search
  const filteredRuns = useMemo(() => {
    if (!searchText) return runs;
    const lower = searchText.toLowerCase();
    return runs.filter(r => 
      r.name?.toLowerCase().includes(lower) ||
      r.difficulty?.toLowerCase().includes(lower) ||
      r.subRegionName?.toLowerCase().includes(lower)
    );
  }, [runs, searchText]);

  const filteredLifts = useMemo(() => {
    if (!searchText) return lifts;
    const lower = searchText.toLowerCase();
    return lifts.filter(l => 
      l.name?.toLowerCase().includes(lower) ||
      l.liftType?.toLowerCase().includes(lower)
    );
  }, [lifts, searchText]);

  // Group runs by sub-region, then by difficulty
  const runsBySubRegionAndDifficulty = useMemo(() => {
    if (!hasSubRegions) return null;
    
    const groups: Record<string, { subRegion: SubRegionData | null; runs: Record<string, RunData[]> }> = {};
    const diffOrder = ['novice', 'easy', 'intermediate', 'advanced', 'expert', 'unknown'];
    
    // Create group for each sub-region
    subRegions.forEach(sr => {
      groups[sr.id] = { subRegion: sr, runs: {} };
      diffOrder.forEach(d => groups[sr.id].runs[d] = []);
    });
    
    // Create "Other" group for runs without sub-region
    groups['_other'] = { subRegion: null, runs: {} };
    diffOrder.forEach(d => groups['_other'].runs[d] = []);
    
    // Sort runs into groups
    filteredRuns.forEach(run => {
      const subRegionId = run.subRegionId || '_other';
      const difficulty = run.difficulty || 'unknown';
      if (!groups[subRegionId]) {
        // Sub-region not found, put in other
        groups['_other'].runs[difficulty]?.push(run);
      } else {
        groups[subRegionId].runs[difficulty]?.push(run);
      }
    });
    
    // Filter out empty groups and sort
    const result = Object.entries(groups)
      .filter(([_, data]) => Object.values(data.runs).some(arr => arr.length > 0))
      .sort(([aId, a], [bId, b]) => {
        // Put "Other" last
        if (aId === '_other') return 1;
        if (bId === '_other') return -1;
        // Sort by sub-region name
        const aName = a.subRegion?.name || '';
        const bName = b.subRegion?.name || '';
        return aName.localeCompare(bName);
      });
    
    return result;
  }, [filteredRuns, subRegions, hasSubRegions]);

  // Group runs by difficulty only (when no sub-regions)
  const runsByDifficulty = useMemo(() => {
    if (hasSubRegions) return null;
    
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
  }, [filteredRuns, hasSubRegions]);

  const difficultyLabels: Record<string, string> = {
    novice: 'Novice',
    easy: 'Easy',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
    expert: 'Expert',
    unknown: 'Unknown',
  };

  const toggleSubRegion = useCallback((subRegionId: string) => {
    setExpandedSubRegions(prev => {
      const next = new Set(prev);
      if (next.has(subRegionId)) {
        next.delete(subRegionId);
      } else {
        next.add(subRegionId);
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
    showSubRegion: boolean = false
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
                  subRegionName={showSubRegion ? run.subRegionName : undefined}
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
            {/* With sub-regions: group by sub-region first */}
            {hasSubRegions && runsBySubRegionAndDifficulty && (
              <>
                {runsBySubRegionAndDifficulty.map(([subRegionId, data]) => {
                  const isExpanded = expandedSubRegions.has(subRegionId);
                  const totalRuns = Object.values(data.runs).reduce((sum, arr) => sum + arr.length, 0);
                  const subRegionName = data.subRegion?.name || 'Other';
                  
                  return (
                    <div key={subRegionId} className="mb-1">
                      <SubRegionHeader
                        name={subRegionName}
                        count={totalRuns}
                        isExpanded={isExpanded}
                        onClick={() => toggleSubRegion(subRegionId)}
                        onNavigate={data.subRegion ? () => onSelectSubRegion?.(data.subRegion!) : undefined}
                      />
                      
                      {isExpanded && (
                        <div className="ml-3">
                          {renderRunsByDifficulty(
                            Object.entries(data.runs).filter(([_, arr]) => arr.length > 0),
                            `${subRegionId}-`
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* Without sub-regions: just group by difficulty */}
            {!hasSubRegions && runsByDifficulty && (
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

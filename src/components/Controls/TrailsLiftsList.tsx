'use client';

import { useState, useMemo, useCallback, memo, useTransition } from 'react';
import { Input, Typography, Button } from 'antd';
import { 
  SearchOutlined, 
  NodeIndexOutlined, 
  SwapOutlined,
  DownOutlined,
  RightOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons';
import type { RunData, LiftData } from '@/lib/types';
import { getDifficultyColor } from '@/lib/shade-calculator';

const { Text } = Typography;

// Max items to show per group
const ITEMS_PER_PAGE = 15;

interface TrailsLiftsListProps {
  runs: RunData[];
  lifts: LiftData[];
  onSelectRun?: (run: RunData) => void;
  onSelectLift?: (lift: LiftData) => void;
}

// Simple run item - minimal DOM
const RunItem = memo(function RunItem({ 
  name, 
  onClick 
}: { 
  name: string;
  onClick: () => void;
}) {
  return (
    <div 
      className="run-item py-0.5 px-1 cursor-pointer truncate"
      style={{ fontSize: 10, color: '#ccc' }}
      onClick={onClick}
    >
      {name}
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
  onSelectRun, 
  onSelectLift 
}: TrailsLiftsListProps) {
  const [searchText, setSearchText] = useState('');
  const [runsExpanded, setRunsExpanded] = useState(false);
  const [liftsExpanded, setLiftsExpanded] = useState(false);
  const [expandedDifficulties, setExpandedDifficulties] = useState<Set<string>>(new Set());
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const [isPending, startTransition] = useTransition();

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
      r.difficulty?.toLowerCase().includes(lower)
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

  // Group runs by difficulty - compute once
  const runsByDifficulty = useMemo(() => {
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
  }, [filteredRuns]);

  const difficultyLabels: Record<string, string> = {
    novice: 'Novice',
    easy: 'Easy',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
    expert: 'Expert',
    unknown: 'Unknown',
  };

  const toggleDifficulty = useCallback((diff: string) => {
    setExpandedDifficulties(prev => {
      const next = new Set(prev);
      if (next.has(diff)) {
        next.delete(diff);
      } else {
        next.add(diff);
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

  return (
    <div className="trails-lifts-list text-sm">
      <Input
        placeholder="Search..."
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
            {runsByDifficulty.map(([difficulty, groupRuns]) => {
              const isExpanded = expandedDifficulties.has(difficulty);
              const visible = getVisibleCount(`runs-${difficulty}`);
              const visibleRuns = groupRuns.slice(0, visible);
              const hasMore = groupRuns.length > visible;
              
              return (
                <div key={difficulty} className="mb-0.5">
                  <DifficultyHeader
                    difficulty={difficulty}
                    label={difficultyLabels[difficulty] || difficulty}
                    count={groupRuns.length}
                    isExpanded={isExpanded}
                    onClick={() => toggleDifficulty(difficulty)}
                  />
                  
                  {isExpanded && (
                    <div className="ml-3">
                      {visibleRuns.map(run => (
                        <RunItem 
                          key={run.id} 
                          name={run.name || 'Unnamed'}
                          onClick={() => onSelectRun?.(run)} 
                        />
                      ))}
                      {hasMore && (
                        <button 
                          className="text-blue-400 hover:text-blue-300"
                          style={{ fontSize: 9, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
                          onClick={() => loadMore(`runs-${difficulty}`)}
                        >
                          +{groupRuns.length - visible} more
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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

      {/* Credits */}
      <div className="mt-2 pt-2 border-t border-white/10">
        <span style={{ fontSize: 9, color: '#666' }}>
          <a 
            href="https://openskimap.org" 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ color: '#888' }}
          >
            OpenSkiMap
          </a>
          {' '}© OSM
        </span>
        <br />
        <span style={{ fontSize: 9, color: '#555' }}>
          <QuestionCircleOutlined style={{ marginRight: 3 }} />
          Live status unavailable
        </span>
      </div>
    </div>
  );
}

// Memoize the entire component to prevent parent re-renders from affecting it
const TrailsLiftsList = memo(TrailsListInner);
export default TrailsLiftsList;

'use client';

import { useState, useMemo, useCallback, memo } from 'react';
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

// Max items to show initially per group
const INITIAL_LIMIT = 10;

interface TrailsLiftsListProps {
  runs: RunData[];
  lifts: LiftData[];
  onSelectRun?: (run: RunData) => void;
  onSelectLift?: (lift: LiftData) => void;
}

// Memoized run item to prevent re-renders
const RunItem = memo(function RunItem({ 
  run, 
  onClick 
}: { 
  run: RunData; 
  onClick: () => void;
}) {
  return (
    <div 
      className="flex items-center justify-between py-0.5 px-1 rounded cursor-pointer hover:bg-white/5"
      onClick={onClick}
    >
      <span style={{ fontSize: 10, color: '#e5e5e5' }} className="truncate flex-1 mr-2">
        {run.name || 'Unnamed'}
      </span>
    </div>
  );
});

// Memoized lift item
const LiftItem = memo(function LiftItem({ 
  lift, 
  onClick 
}: { 
  lift: LiftData; 
  onClick: () => void;
}) {
  return (
    <div 
      className="flex items-center justify-between py-0.5 px-1 rounded cursor-pointer hover:bg-white/5"
      onClick={onClick}
    >
      <span style={{ fontSize: 10, color: '#e5e5e5' }} className="truncate flex-1 mr-2">
        {lift.name || 'Unnamed'}
      </span>
      {lift.liftType && (
        <span style={{ fontSize: 9, color: '#666' }}>{lift.liftType}</span>
      )}
    </div>
  );
});

export default function TrailsLiftsList({ 
  runs, 
  lifts, 
  onSelectRun, 
  onSelectLift 
}: TrailsLiftsListProps) {
  const [searchText, setSearchText] = useState('');
  const [runsExpanded, setRunsExpanded] = useState(false);
  const [liftsExpanded, setLiftsExpanded] = useState(false);
  const [expandedDifficulties, setExpandedDifficulties] = useState<Set<string>>(new Set());
  const [showAllRuns, setShowAllRuns] = useState<Record<string, boolean>>({});
  const [showAllLifts, setShowAllLifts] = useState(false);

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

  // Group runs by difficulty - only compute counts initially
  const runsByDifficulty = useMemo(() => {
    const groups: Record<string, RunData[]> = {
      novice: [],
      easy: [],
      intermediate: [],
      advanced: [],
      expert: [],
      unknown: [],
    };
    
    filteredRuns.forEach(run => {
      const diff = run.difficulty || 'unknown';
      if (groups[diff]) {
        groups[diff].push(run);
      } else {
        groups.unknown.push(run);
      }
    });
    
    return groups;
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

  const handleSelectRun = useCallback((run: RunData) => {
    onSelectRun?.(run);
  }, [onSelectRun]);

  const handleSelectLift = useCallback((lift: LiftData) => {
    onSelectLift?.(lift);
  }, [onSelectLift]);

  // Get visible lifts
  const visibleLifts = useMemo(() => {
    if (showAllLifts) return filteredLifts;
    return filteredLifts.slice(0, INITIAL_LIMIT);
  }, [filteredLifts, showAllLifts]);

  return (
    <div className="trails-lifts-list">
      <Input
        placeholder="Search runs & lifts..."
        prefix={<SearchOutlined style={{ fontSize: 10, opacity: 0.5 }} />}
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        size="small"
        allowClear
        style={{ marginBottom: 8 }}
      />

      {/* Runs Section */}
      <div className="mb-2">
        <div 
          className="flex items-center gap-2 py-1 cursor-pointer hover:bg-white/5 rounded"
          onClick={() => setRunsExpanded(!runsExpanded)}
        >
          {runsExpanded ? <DownOutlined style={{ fontSize: 8 }} /> : <RightOutlined style={{ fontSize: 8 }} />}
          <NodeIndexOutlined style={{ fontSize: 11 }} />
          <Text style={{ fontSize: 11 }}>Runs ({filteredRuns.length})</Text>
        </div>
        
        {runsExpanded && (
          <div className="ml-4 mt-1">
            {Object.entries(runsByDifficulty).map(([difficulty, groupRuns]) => {
              if (groupRuns.length === 0) return null;
              const isExpanded = expandedDifficulties.has(difficulty);
              const showAll = showAllRuns[difficulty];
              const visibleRuns = showAll ? groupRuns : groupRuns.slice(0, INITIAL_LIMIT);
              
              return (
                <div key={difficulty} className="mb-1">
                  <div 
                    className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-white/5 rounded"
                    onClick={() => toggleDifficulty(difficulty)}
                  >
                    {isExpanded ? <DownOutlined style={{ fontSize: 7 }} /> : <RightOutlined style={{ fontSize: 7 }} />}
                    <div 
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: getDifficultyColor(difficulty) }}
                    />
                    <Text type="secondary" style={{ fontSize: 10 }}>
                      {difficultyLabels[difficulty]} ({groupRuns.length})
                    </Text>
                  </div>
                  
                  {isExpanded && (
                    <div className="ml-4">
                      {visibleRuns.map(run => (
                        <RunItem 
                          key={run.id} 
                          run={run} 
                          onClick={() => handleSelectRun(run)} 
                        />
                      ))}
                      {groupRuns.length > INITIAL_LIMIT && !showAll && (
                        <Button 
                          type="link" 
                          size="small"
                          style={{ fontSize: 9, padding: 0, height: 'auto' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowAllRuns(prev => ({ ...prev, [difficulty]: true }));
                          }}
                        >
                          Show {groupRuns.length - INITIAL_LIMIT} more
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredRuns.length === 0 && (
              <Text type="secondary" style={{ fontSize: 10 }}>No runs found</Text>
            )}
          </div>
        )}
      </div>

      {/* Lifts Section */}
      <div className="mb-2">
        <div 
          className="flex items-center gap-2 py-1 cursor-pointer hover:bg-white/5 rounded"
          onClick={() => setLiftsExpanded(!liftsExpanded)}
        >
          {liftsExpanded ? <DownOutlined style={{ fontSize: 8 }} /> : <RightOutlined style={{ fontSize: 8 }} />}
          <SwapOutlined style={{ fontSize: 11 }} />
          <Text style={{ fontSize: 11 }}>Lifts ({filteredLifts.length})</Text>
        </div>
        
        {liftsExpanded && (
          <div className="ml-4 mt-1">
            {visibleLifts.map(lift => (
              <LiftItem 
                key={lift.id} 
                lift={lift} 
                onClick={() => handleSelectLift(lift)} 
              />
            ))}
            {filteredLifts.length > INITIAL_LIMIT && !showAllLifts && (
              <Button 
                type="link" 
                size="small"
                style={{ fontSize: 9, padding: 0, height: 'auto' }}
                onClick={() => setShowAllLifts(true)}
              >
                Show {filteredLifts.length - INITIAL_LIMIT} more
              </Button>
            )}
            {filteredLifts.length === 0 && (
              <Text type="secondary" style={{ fontSize: 10 }}>No lifts found</Text>
            )}
          </div>
        )}
      </div>

      {/* OpenSkiMap credits */}
      <div className="mt-3 pt-2 border-t border-white/10">
        <Text type="secondary" style={{ fontSize: 9 }}>
          Data from{' '}
          <a 
            href="https://openskimap.org" 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ color: '#888' }}
          >
            OpenSkiMap
          </a>
          {' '}© OSM
        </Text>
        <br />
        <Text type="secondary" style={{ fontSize: 9 }}>
          <QuestionCircleOutlined style={{ marginRight: 4 }} />
          Live status not available
        </Text>
      </div>
    </div>
  );
}

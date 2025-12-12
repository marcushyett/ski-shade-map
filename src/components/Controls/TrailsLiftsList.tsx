'use client';

import { useState, useMemo } from 'react';
import { Input, Typography, Collapse, Tag, Empty } from 'antd';
import { 
  SearchOutlined, 
  NodeIndexOutlined, 
  SwapOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons';
import type { RunData, LiftData } from '@/lib/types';
import { getDifficultyColor } from '@/lib/shade-calculator';

const { Text } = Typography;

interface TrailsLiftsListProps {
  runs: RunData[];
  lifts: LiftData[];
  onSelectRun?: (run: RunData) => void;
  onSelectLift?: (lift: LiftData) => void;
}

export default function TrailsLiftsList({ 
  runs, 
  lifts, 
  onSelectRun, 
  onSelectLift 
}: TrailsLiftsListProps) {
  const [searchText, setSearchText] = useState('');

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

  // Group runs by difficulty
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

  // Group lifts by type
  const liftsByType = useMemo(() => {
    const groups: Record<string, LiftData[]> = {};
    
    filteredLifts.forEach(lift => {
      const type = lift.liftType || 'Other';
      if (!groups[type]) groups[type] = [];
      groups[type].push(lift);
    });
    
    return groups;
  }, [filteredLifts]);

  const getStatusIcon = (status: string | null) => {
    switch (status) {
      case 'open':
        return <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 10 }} />;
      case 'closed':
        return <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 10 }} />;
      default:
        return <QuestionCircleOutlined style={{ color: '#666', fontSize: 10 }} />;
    }
  };

  const difficultyLabels: Record<string, string> = {
    novice: 'Novice',
    easy: 'Easy',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
    expert: 'Expert',
    unknown: 'Unknown',
  };

  const collapseItems = [
    {
      key: 'runs',
      label: (
        <div className="flex items-center gap-2">
          <NodeIndexOutlined style={{ fontSize: 12 }} />
          <Text style={{ fontSize: 11 }}>Runs ({filteredRuns.length})</Text>
        </div>
      ),
      children: (
        <div className="runs-list">
          {Object.entries(runsByDifficulty).map(([difficulty, groupRuns]) => {
            if (groupRuns.length === 0) return null;
            return (
              <div key={difficulty} className="mb-2">
                <div className="flex items-center gap-2 mb-1">
                  <div 
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: getDifficultyColor(difficulty) }}
                  />
                  <Text type="secondary" style={{ fontSize: 10 }}>
                    {difficultyLabels[difficulty]} ({groupRuns.length})
                  </Text>
                </div>
                <div className="flex flex-col gap-0.5 ml-4">
                  {groupRuns.map(run => (
                    <div 
                      key={run.id}
                      className="run-item flex items-center justify-between py-0.5 px-1 rounded cursor-pointer hover:bg-white/5"
                      onClick={() => onSelectRun?.(run)}
                    >
                      <Text style={{ fontSize: 10 }} ellipsis={{ tooltip: run.name }}>
                        {run.name || 'Unnamed'}
                      </Text>
                      {getStatusIcon(run.status)}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {filteredRuns.length === 0 && (
            <Empty 
              image={Empty.PRESENTED_IMAGE_SIMPLE} 
              description={<Text type="secondary" style={{ fontSize: 10 }}>No runs found</Text>}
            />
          )}
        </div>
      ),
    },
    {
      key: 'lifts',
      label: (
        <div className="flex items-center gap-2">
          <SwapOutlined style={{ fontSize: 12 }} />
          <Text style={{ fontSize: 11 }}>Lifts ({filteredLifts.length})</Text>
        </div>
      ),
      children: (
        <div className="lifts-list">
          {Object.entries(liftsByType).map(([type, groupLifts]) => (
            <div key={type} className="mb-2">
              <Text type="secondary" style={{ fontSize: 10, textTransform: 'capitalize' }}>
                {type.replace(/_/g, ' ')} ({groupLifts.length})
              </Text>
              <div className="flex flex-col gap-0.5 mt-1">
                {groupLifts.map(lift => (
                  <div 
                    key={lift.id}
                    className="lift-item flex items-center justify-between py-0.5 px-1 rounded cursor-pointer hover:bg-white/5"
                    onClick={() => onSelectLift?.(lift)}
                  >
                    <div className="flex items-center gap-1.5">
                      <Text style={{ fontSize: 10 }} ellipsis={{ tooltip: lift.name }}>
                        {lift.name || 'Unnamed'}
                      </Text>
                      {lift.capacity && (
                        <Tag style={{ fontSize: 8, padding: '0 3px', margin: 0 }}>
                          {lift.capacity}/hr
                        </Tag>
                      )}
                    </div>
                    {getStatusIcon(lift.status)}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {filteredLifts.length === 0 && (
            <Empty 
              image={Empty.PRESENTED_IMAGE_SIMPLE} 
              description={<Text type="secondary" style={{ fontSize: 10 }}>No lifts found</Text>}
            />
          )}
        </div>
      ),
    },
  ];

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

      <Collapse 
        items={collapseItems}
        defaultActiveKey={['runs', 'lifts']}
        size="small"
        bordered={false}
        ghost
      />

      {/* OpenSkiMap credits */}
      <div className="mt-4 pt-2 border-t border-white/10">
        <Text type="secondary" style={{ fontSize: 9 }}>
          Trail and lift data from{' '}
          <a 
            href="https://openskimap.org" 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ color: '#888' }}
          >
            OpenSkiMap
          </a>
          {' '}© OpenStreetMap contributors
        </Text>
      </div>

      {/* Status info */}
      <div className="mt-2">
        <Text type="secondary" style={{ fontSize: 9 }}>
          <QuestionCircleOutlined style={{ marginRight: 4 }} />
          Real-time status data not available
        </Text>
      </div>
    </div>
  );
}


'use client';

import { useState, useMemo, useCallback, memo, useTransition } from 'react';
import { Input } from 'antd';
import { 
  SearchOutlined, 
  NodeIndexOutlined, 
  SwapOutlined,
  DownOutlined,
  RightOutlined,
  StarFilled,
  DeleteOutlined,
  SunOutlined,
} from '@ant-design/icons';
import type { RunData, LiftData } from '@/lib/types';
import type { HourlyWeather } from '@/lib/weather-types';
import type { FavouriteRun } from '@/hooks/useFavourites';
import { getDifficultyColor } from '@/lib/shade-calculator';
import { analyzeRuns, formatTime, calculateRunStats, type SunLevel, type HourlySunData, type RunSunAnalysis, type RunStats } from '@/lib/sunny-time-calculator';
import type { SnowQualityAtPoint } from '@/lib/snow-quality';
import { Tooltip } from 'antd';


const ITEMS_PER_PAGE = 15;

// Snow quality by run ID
type SnowQualityByRun = Record<string, SnowQualityAtPoint[]>;

interface TrailsLiftsListProps {
  runs: RunData[];
  lifts: LiftData[];
  favourites: FavouriteRun[];
  latitude: number;
  longitude: number;
  hourlyWeather?: HourlyWeather[];
  snowQualityByRun?: SnowQualityByRun;
  selectedRunId?: string | null;
  onSelectRun?: (run: RunData) => void;
  onSelectLift?: (lift: LiftData) => void;
  onRemoveFavourite?: (runId: string) => void;
  onAddFavourite?: (run: RunData) => void;
  onClearSelectedRun?: () => void;
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

// Sun icon based on level - using CSS clip to show partial sun
function SunIcon({ level }: { level: SunLevel }) {
  if (level === 'full') {
    // Full sun - bright yellow
    return <SunOutlined style={{ fontSize: 10, color: '#faad14' }} />;
  } else if (level === 'partial') {
    // Partial sun - 3/4 of a sun (clipped)
    return (
      <span style={{ 
        display: 'inline-block', 
        width: 10, 
        height: 10, 
        overflow: 'hidden',
        position: 'relative',
      }}>
        <SunOutlined style={{ 
          fontSize: 10, 
          color: '#d4a017',
          clipPath: 'inset(0 25% 0 0)', // Show 75% of the sun
        }} />
      </span>
    );
  } else if (level === 'low') {
    // Low sun - half sun (clipped)
    return (
      <span style={{ 
        display: 'inline-block', 
        width: 10, 
        height: 10, 
        overflow: 'hidden',
        position: 'relative',
      }}>
        <SunOutlined style={{ 
          fontSize: 10, 
          color: '#888',
          clipPath: 'inset(0 50% 0 0)', // Show 50% of the sun
        }} />
      </span>
    );
  }
  return null;
}

// Sun distribution chart - shows hourly sun percentages from 7am to 6pm
function SunDistributionChart({ hourlyData }: { hourlyData: HourlySunData[] }) {
  // Fixed range: 7am (7) to 6pm (18)
  const START_HOUR = 7;
  const END_HOUR = 18;
  
  // Create a map of hour to percentage
  const hourMap: Record<number, number> = {};
  hourlyData.forEach(data => {
    hourMap[data.hour] = data.percentage;
  });
  
  // Generate bars for each hour in the fixed range
  const hours: { hour: number; percentage: number }[] = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) {
    hours.push({
      hour: h,
      percentage: hourMap[h] ?? 0, // 0 if no data (before sunrise or after sunset)
    });
  }
  
  return (
    <div className="sun-distribution-chart" style={{ padding: '4px 0' }}>
      <div className="flex items-end gap-px" style={{ height: 40 }}>
        {hours.map((data, i) => (
          <Tooltip key={i} title={`${data.hour}:00 - ${Math.round(data.percentage)}% sun`}>
            <div
              style={{
                flex: 1,
                height: `${Math.max(data.percentage, 2)}%`,
                minHeight: 2,
                background: data.percentage > 75 ? '#faad14' : data.percentage > 50 ? '#d4a017' : data.percentage > 25 ? '#8b7500' : '#222',
                borderRadius: '2px 2px 0 0',
                cursor: 'help',
              }}
            />
          </Tooltip>
        ))}
      </div>
      <div className="flex justify-between" style={{ fontSize: 8, color: '#555', marginTop: 2 }}>
        <span>7am</span>
        <span>12pm</span>
        <span>6pm</span>
      </div>
    </div>
  );
}

// Snow quality at point type
interface SnowQualityPoint {
  altitude: number;
  score: number;
}

// Get color for snow quality score
function getSnowScoreColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 50) return '#84cc16';
  if (score >= 40) return '#a3a3a3';
  if (score >= 25) return '#f97316';
  return '#ef4444';
}

// Elevation profile chart with max slope indicator and snow quality
function ElevationProfileChart({ profile, maxSlope, avgSlope, snowQuality }: { 
  profile: { distance: number; elevation: number }[];
  maxSlope: number;
  avgSlope: number;
  snowQuality?: SnowQualityPoint[];
}) {
  if (profile.length < 2) return null;
  
  const maxElev = Math.max(...profile.map(p => p.elevation));
  const minElev = Math.min(...profile.map(p => p.elevation));
  const elevRange = maxElev - minElev || 1;
  const maxDist = profile[profile.length - 1].distance || 1;
  
  // Create SVG path points - use percentage of width
  const points = profile.map(p => ({
    x: maxDist > 0 ? (p.distance / maxDist) * 100 : 0,
    y: ((p.elevation - minElev) / elevRange) * 100,
    elevation: p.elevation,
  }));
  
  // Match snow quality to profile points by altitude
  const pointsWithSnow = points.map(p => {
    const snowPoint = snowQuality?.find(sq => Math.abs(sq.altitude - p.elevation) < 50);
    return { ...p, snowScore: snowPoint?.score };
  });
  
  // Find steepest segment for highlighting
  let steepestIdx = 0;
  let steepestSlope = 0;
  for (let i = 1; i < profile.length; i++) {
    const dx = profile[i].distance - profile[i-1].distance;
    const dy = Math.abs(profile[i].elevation - profile[i-1].elevation);
    if (dx > 0) {
      const slope = Math.atan(dy / dx) * 180 / Math.PI;
      if (slope > steepestSlope) {
        steepestSlope = slope;
        steepestIdx = i;
      }
    }
  }

  // Calculate average snow score
  const avgSnowScore = snowQuality && snowQuality.length > 0
    ? Math.round(snowQuality.reduce((sum, sq) => sum + sq.score, 0) / snowQuality.length)
    : null;
  
  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ position: 'relative', width: '100%', height: 35, background: '#1a1a1a', borderRadius: 4 }}>
        <svg 
          viewBox="0 0 100 100" 
          style={{ width: '100%', height: '100%', display: 'block' }} 
          preserveAspectRatio="none"
        >
          {/* Snow quality gradient fill */}
          {snowQuality && snowQuality.length > 0 && (
            <>
              <defs>
                <linearGradient id="snowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  {pointsWithSnow.map((p, i) => (
                    <stop 
                      key={i} 
                      offset={`${p.x}%`} 
                      stopColor={p.snowScore !== undefined ? getSnowScoreColor(p.snowScore) : '#333'}
                      stopOpacity="0.3"
                    />
                  ))}
                </linearGradient>
              </defs>
              <path
                d={`M 0 100 ${points.map(p => `L ${p.x} ${100 - p.y}`).join(' ')} L 100 100 Z`}
                fill="url(#snowGradient)"
              />
            </>
          )}
          {/* Default fill if no snow data */}
          {(!snowQuality || snowQuality.length === 0) && (
            <path
              d={`M 0 100 ${points.map(p => `L ${p.x} ${100 - p.y}`).join(' ')} L 100 100 Z`}
              fill="rgba(102, 102, 102, 0.2)"
            />
          )}
          {/* Main elevation line - colored by snow quality */}
          {snowQuality && snowQuality.length > 0 ? (
            pointsWithSnow.slice(1).map((p, i) => (
              <line
                key={i}
                x1={pointsWithSnow[i].x}
                y1={100 - pointsWithSnow[i].y}
                x2={p.x}
                y2={100 - p.y}
                stroke={p.snowScore !== undefined ? getSnowScoreColor(p.snowScore) : '#888'}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            ))
          ) : (
            <path
              d={points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${100 - p.y}`).join(' ')}
              fill="none"
              stroke="#888"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {/* Steepest section highlight */}
          {steepestIdx > 0 && !snowQuality && (
            <line
              x1={points[steepestIdx - 1].x}
              y1={100 - points[steepestIdx - 1].y}
              x2={points[steepestIdx].x}
              y2={100 - points[steepestIdx].y}
              stroke="#ff6b6b"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      <div className="flex justify-between items-center" style={{ fontSize: 8, color: '#555', marginTop: 2 }}>
        <span>{Math.round(maxElev)}m → {Math.round(minElev)}m</span>
        <span>
          {avgSnowScore !== null && (
            <>
              <span style={{ color: getSnowScoreColor(avgSnowScore) }}>{avgSnowScore}% snow</span>
              {' · '}
            </>
          )}
          avg <span style={{ color: '#888' }}>{Math.round(avgSlope)}°</span>
          {' · '}
          max <span style={{ color: '#ff6b6b' }}>{Math.round(maxSlope)}°</span>
        </span>
      </div>
    </div>
  );
}

// Run stats display
function RunStatsDisplay({ stats }: { stats: RunStats }) {
  const formatDistance = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
  
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5" style={{ fontSize: 9, color: '#888' }}>
      <span>📏 <span style={{ color: '#ccc' }}>{formatDistance(stats.distance)}</span></span>
      {stats.hasElevation && (
        <>
          <span>↓ <span style={{ color: '#ccc' }}>{Math.round(stats.descent)}m</span></span>
          {stats.ascent > 10 && (
            <span>↑ <span style={{ color: '#ccc' }}>{Math.round(stats.ascent)}m</span></span>
          )}
        </>
      )}
    </div>
  );
}

// Reusable run detail content - shared between FavouriteItem expanded view and SelectedRunDetail
const RunDetailContent = memo(function RunDetailContent({
  analysis,
  stats,
  snowQuality,
}: {
  analysis?: RunSunAnalysis;
  stats: RunStats | null;
  snowQuality?: SnowQualityPoint[];
}) {
  return (
    <>
      {/* Sun distribution chart */}
      {analysis && (
        <div className="mb-2">
          <div style={{ color: '#888', marginBottom: 2, fontSize: 9 }}>Sun exposure by hour</div>
          <SunDistributionChart hourlyData={analysis.hourlyPercentages} />
        </div>
      )}
      
      {/* Run stats */}
      {stats && (
        <div className="mb-2">
          <RunStatsDisplay stats={stats} />
        </div>
      )}
      
      {/* Elevation profile with snow quality */}
      {stats?.hasElevation && stats.elevationProfile.length > 1 && (
        <div className="mb-2">
          <div style={{ color: '#888', marginBottom: 2, fontSize: 9 }}>Elevation & snow quality</div>
          <ElevationProfileChart 
            profile={stats.elevationProfile} 
            maxSlope={stats.maxSlope}
            avgSlope={stats.avgSlope}
            snowQuality={snowQuality}
          />
        </div>
      )}
    </>
  );
});

// Favourite run item - expandable
const FavouriteItem = memo(function FavouriteItem({
  run,
  analysis,
  stats,
  snowQuality,
  isExpanded,
  onToggleExpand,
  onSelect,
  onRemove,
}: {
  run: RunData;
  analysis?: RunSunAnalysis;
  stats: RunStats | null;
  snowQuality?: SnowQualityPoint[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const difficultyColor = getDifficultyColor(run.difficulty || 'unknown');
  const sunLevel = analysis?.sunLevel;
  const hasSunInfo = analysis?.sunniestWindow && sunLevel && sunLevel !== 'none';
  const sunnyTime = hasSunInfo 
    ? `${formatTime(analysis.sunniestWindow!.startTime)}-${formatTime(analysis.sunniestWindow!.endTime)}`
    : null;
  const sunColor = sunLevel === 'full' ? '#faad14' : sunLevel === 'partial' ? '#d4a017' : '#888';
  
  return (
    <div className="favourite-item mb-1">
      {/* Header row */}
      <div 
        className="flex items-center gap-1.5 py-0.5 px-1 cursor-pointer hover:bg-white/5 rounded"
        onClick={onToggleExpand}
      >
        {isExpanded ? <DownOutlined style={{ fontSize: 7, color: '#666' }} /> : <RightOutlined style={{ fontSize: 7, color: '#666' }} />}
        <div 
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: difficultyColor }}
        />
        <span style={{ fontSize: 10, color: '#ccc' }} className="truncate flex-1">
          {run.name || 'Unnamed'}
        </span>
        {hasSunInfo && (
          <span style={{ fontSize: 9, color: sunColor }} className="flex-shrink-0 flex items-center gap-0.5">
            <SunIcon level={sunLevel} />
            <span style={{ marginLeft: 2 }}>{sunnyTime}</span>
          </span>
        )}
      </div>
      
      {/* Expanded content */}
      {isExpanded && (
        <div className="ml-4 mt-1 p-2 rounded" style={{ background: 'rgba(255,255,255,0.02)', fontSize: 9 }}>
          <RunDetailContent 
            analysis={analysis}
            stats={stats}
            snowQuality={snowQuality}
          />
          
          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(); }}
              className="flex-1 py-1 px-2 rounded text-center hover:bg-white/10 transition-colors"
              style={{ 
                fontSize: 10, 
                color: '#faad14', 
                background: 'rgba(250, 173, 20, 0.1)',
                border: '1px solid rgba(250, 173, 20, 0.3)',
                cursor: 'pointer',
              }}
            >
              Go to map
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="py-1 px-3 rounded text-center hover:bg-white/10 transition-colors"
              style={{ 
                fontSize: 10, 
                color: '#ff4d4f', 
                background: 'rgba(255, 77, 79, 0.1)',
                border: '1px solid rgba(255, 77, 79, 0.3)',
                cursor: 'pointer',
              }}
            >
              <DeleteOutlined style={{ fontSize: 10 }} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

// Selected run detail panel - shows when you click on a run on the map
const SelectedRunDetail = memo(function SelectedRunDetail({
  run,
  analysis,
  stats,
  snowQuality,
  isFavourite,
  onClose,
  onAddFavourite,
  onRemoveFavourite,
}: {
  run: RunData;
  analysis?: RunSunAnalysis;
  stats: RunStats | null;
  snowQuality?: SnowQualityPoint[];
  isFavourite: boolean;
  onClose: () => void;
  onAddFavourite: () => void;
  onRemoveFavourite: () => void;
}) {
  const difficultyColor = getDifficultyColor(run.difficulty || 'unknown');
  const sunLevel = analysis?.sunLevel;
  const hasSunInfo = analysis?.sunniestWindow && sunLevel && sunLevel !== 'none';
  const sunnyTime = hasSunInfo 
    ? `${formatTime(analysis.sunniestWindow!.startTime)}-${formatTime(analysis.sunniestWindow!.endTime)}`
    : null;
  const sunColor = sunLevel === 'full' ? '#faad14' : sunLevel === 'partial' ? '#d4a017' : '#888';
  
  // Calculate average snow score
  const avgSnowScore = snowQuality && snowQuality.length > 0
    ? Math.round(snowQuality.reduce((sum, sq) => sum + sq.score, 0) / snowQuality.length)
    : null;
  const snowScoreColor = avgSnowScore !== null 
    ? (avgSnowScore >= 70 ? '#22c55e' : avgSnowScore >= 40 ? '#a3a3a3' : '#ef4444')
    : '#888';
  
  return (
    <div className="selected-run-detail mb-3 p-2 rounded" style={{ background: 'rgba(250, 173, 20, 0.08)', border: '1px solid rgba(250, 173, 20, 0.2)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div 
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: difficultyColor }}
          />
          <span style={{ fontSize: 12, color: '#fff', fontWeight: 500 }}>
            {run.name || 'Unnamed Run'}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{ 
            fontSize: 14, 
            color: '#888', 
            background: 'none', 
            border: 'none', 
            cursor: 'pointer',
            padding: '2px 6px',
          }}
        >
          ×
        </button>
      </div>
      
      {/* Quick info row */}
      <div className="flex items-center gap-3 mb-2" style={{ fontSize: 9, color: '#888' }}>
        {run.difficulty && (
          <span style={{ color: difficultyColor }}>{run.difficulty}</span>
        )}
        {hasSunInfo && (
          <span style={{ color: sunColor }} className="flex items-center gap-0.5">
            <SunIcon level={sunLevel} />
            <span>{sunnyTime}</span>
          </span>
        )}
        {avgSnowScore !== null && (
          <span>
            Snow: <span style={{ color: snowScoreColor, fontWeight: 600 }}>{avgSnowScore}%</span>
          </span>
        )}
      </div>
      
      {/* Shared run detail content */}
      <RunDetailContent 
        analysis={analysis}
        stats={stats}
        snowQuality={snowQuality}
      />
      
      {/* Action button */}
      <button
        onClick={isFavourite ? onRemoveFavourite : onAddFavourite}
        className="w-full py-1.5 px-2 rounded text-center hover:opacity-80 transition-opacity"
        style={{ 
          fontSize: 10, 
          color: isFavourite ? '#ff4d4f' : '#faad14', 
          background: isFavourite ? 'rgba(255, 77, 79, 0.1)' : 'rgba(250, 173, 20, 0.15)',
          border: `1px solid ${isFavourite ? 'rgba(255, 77, 79, 0.3)' : 'rgba(250, 173, 20, 0.3)'}`,
          cursor: 'pointer',
        }}
      >
        {isFavourite ? (
          <>
            <DeleteOutlined style={{ fontSize: 10, marginRight: 4 }} />
            Remove from favourites
          </>
        ) : (
          <>
            <StarFilled style={{ fontSize: 10, marginRight: 4 }} />
            Add to favourites
          </>
        )}
      </button>
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
  favourites,
  latitude,
  longitude,
  hourlyWeather,
  snowQualityByRun,
  selectedRunId,
  onSelectRun, 
  onSelectLift,
  onRemoveFavourite,
  onAddFavourite,
  onClearSelectedRun,
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

  // Get favourite runs with sun analysis
  const favouriteRuns = useMemo(() => {
    return favourites
      .map(fav => runs.find(r => r.id === fav.id))
      .filter((r): r is RunData => r !== undefined);
  }, [favourites, runs]);

  // Analyze favourite runs for sun exposure
  const runAnalyses = useMemo(() => {
    if (favouriteRuns.length === 0) return [];
    const today = new Date();
    return analyzeRuns(favouriteRuns, today, latitude, longitude, hourlyWeather);
  }, [favouriteRuns, latitude, longitude, hourlyWeather]);

  // Create a map of runId to analysis
  const analysisMap = useMemo(() => {
    const map: Record<string, RunSunAnalysis> = {};
    runAnalyses.forEach(analysis => {
      map[analysis.runId] = analysis;
    });
    return map;
  }, [runAnalyses]);

  // Calculate stats for favourite runs
  const statsMap = useMemo(() => {
    const map: Record<string, RunStats | null> = {};
    favouriteRuns.forEach(run => {
      map[run.id] = calculateRunStats(run);
    });
    return map;
  }, [favouriteRuns]);

  // Get the selected run (from map click)
  const selectedRun = useMemo(() => {
    if (!selectedRunId) return null;
    return runs.find(r => r.id === selectedRunId) || null;
  }, [selectedRunId, runs]);

  // Calculate analysis for selected run
  const selectedRunAnalysis = useMemo(() => {
    if (!selectedRun) return null;
    const today = new Date();
    const analyses = analyzeRuns([selectedRun], today, latitude, longitude, hourlyWeather);
    return analyses[0] || null;
  }, [selectedRun, latitude, longitude, hourlyWeather]);

  // Calculate stats for selected run
  const selectedRunStats = useMemo(() => {
    if (!selectedRun) return null;
    return calculateRunStats(selectedRun);
  }, [selectedRun]);

  // Track expanded favourite
  const [expandedFavouriteId, setExpandedFavouriteId] = useState<string | null>(null);

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

  // Filter favourites by search
  const filteredFavourites = useMemo(() => {
    if (!searchText) return favouriteRuns;
    const lower = searchText.toLowerCase();
    return favouriteRuns.filter(r => 
      r.name?.toLowerCase().includes(lower) ||
      r.difficulty?.toLowerCase().includes(lower)
    );
  }, [favouriteRuns, searchText]);

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
    return Object.entries(groups).filter((entry) => entry[1].length > 0);
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

      {/* Selected Run Detail - shows when a run is clicked on the map */}
      {selectedRun && (
        <SelectedRunDetail
          run={selectedRun}
          analysis={selectedRunAnalysis || undefined}
          stats={selectedRunStats}
          snowQuality={snowQualityByRun?.[selectedRun.id]}
          isFavourite={favourites.some(f => f.id === selectedRun.id)}
          onClose={() => onClearSelectedRun?.()}
          onAddFavourite={() => onAddFavourite?.(selectedRun)}
          onRemoveFavourite={() => onRemoveFavourite?.(selectedRun.id)}
        />
      )}

      {/* Favourites Section - only show if there are favourites */}
      {filteredFavourites.length > 0 && (
        <div className="mb-2 pb-2 border-b border-white/10">
          <div className="flex items-center gap-1.5 mb-1">
            <StarFilled style={{ fontSize: 10, color: '#faad14' }} />
            <span style={{ fontSize: 10, color: '#faad14' }}>Favourites ({filteredFavourites.length})</span>
          </div>
          <div>
            {filteredFavourites.map(run => (
              <FavouriteItem
                key={run.id}
                run={run}
                analysis={analysisMap[run.id]}
                stats={statsMap[run.id]}
                snowQuality={snowQualityByRun?.[run.id]}
                isExpanded={expandedFavouriteId === run.id}
                onToggleExpand={() => setExpandedFavouriteId(
                  expandedFavouriteId === run.id ? null : run.id
                )}
                onSelect={() => onSelectRun?.(run)}
                onRemove={() => onRemoveFavourite?.(run.id)}
              />
            ))}
          </div>
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
    </div>
  );
}

// Memoize the entire component to prevent parent re-renders from affecting it
const TrailsLiftsList = memo(TrailsListInner);
export default TrailsLiftsList;

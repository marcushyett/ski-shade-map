'use client';

import { useState, useMemo, useCallback, memo } from 'react';
import { Typography, Pagination } from 'antd';
import {
  StarFilled,
  SunOutlined,
  CloudOutlined,
  CloudFilled,
  ThunderboltOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { RunData } from '@/lib/types';
import type { HourlyWeather } from '@/lib/weather-types';
import type { FavouriteRun } from '@/hooks/useFavourites';
import { analyzeRuns, formatTime, type RunSunAnalysis } from '@/lib/sunny-time-calculator';
import { getDifficultyColor } from '@/lib/shade-calculator';

const { Text } = Typography;

const ITEMS_PER_PAGE = 10;

interface FavouritesPanelProps {
  favourites: FavouriteRun[];
  runs: RunData[];
  latitude: number;
  longitude: number;
  hourlyWeather?: HourlyWeather[];
  onSelectRun?: (run: RunData) => void;
  onRemoveFavourite?: (runId: string) => void;
}

// Weather icon component
function WeatherIcon({ code, size = 12 }: { code: number; size?: number }) {
  const style = { fontSize: size };
  
  // Snow
  if (code >= 71 && code <= 77 || code >= 85 && code <= 86) {
    return <CloudFilled style={{ ...style, color: '#e8e8e8' }} />;
  }
  // Rain
  if (code >= 51 && code <= 67 || code >= 80 && code <= 82) {
    return <CloudFilled style={{ ...style, color: '#1890ff' }} />;
  }
  // Thunderstorm
  if (code >= 95) {
    return <ThunderboltOutlined style={{ ...style, color: '#faad14' }} />;
  }
  // Fog
  if (code >= 45 && code <= 48) {
    return <CloudOutlined style={{ ...style, opacity: 0.5 }} />;
  }
  // Overcast
  if (code === 3) {
    return <CloudFilled style={style} />;
  }
  // Cloudy
  return <CloudOutlined style={style} />;
}

// Individual favourite run item
const FavouriteRunItem = memo(function FavouriteRunItem({
  analysis,
  onSelect,
  onRemove,
}: {
  analysis: RunSunAnalysis;
  onSelect?: () => void;
  onRemove?: () => void;
}) {
  const difficultyColor = getDifficultyColor(analysis.difficulty);
  
  return (
    <div 
      className="favourite-run-item p-2 rounded mb-1 cursor-pointer hover:bg-white/10 transition-colors"
      style={{ background: 'rgba(255,255,255,0.03)', borderLeft: `3px solid ${difficultyColor}` }}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <StarFilled style={{ fontSize: 10, color: '#faad14' }} />
            <Text 
              strong 
              style={{ fontSize: 11 }}
              className="truncate block"
            >
              {analysis.runName || 'Unnamed Run'}
            </Text>
          </div>
          
          {/* Sunniest time or bad weather indicator */}
          <div className="mt-1">
            {analysis.isBadWeather ? (
              <div className="flex items-center gap-1.5">
                {analysis.weatherCode !== null && (
                  <WeatherIcon code={analysis.weatherCode} size={14} />
                )}
                <Text type="secondary" style={{ fontSize: 10 }}>
                  Poor conditions today
                </Text>
              </div>
            ) : analysis.sunniestWindow ? (
              <div className="flex items-center gap-1.5">
                <SunOutlined style={{ fontSize: 14, color: '#faad14' }} />
                <div>
                  <Text style={{ fontSize: 11, color: '#faad14', fontWeight: 500 }}>
                    {formatTime(analysis.sunniestWindow.startTime)} - {formatTime(analysis.sunniestWindow.endTime)}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 9, display: 'block' }}>
                    {Math.round(analysis.sunniestWindow.sunnyPercentage)}% in sun • Best time to ski
                  </Text>
                </div>
              </div>
            ) : (
              <Text type="secondary" style={{ fontSize: 10 }}>
                No sunny windows today
              </Text>
            )}
          </div>
        </div>
        
        {/* Remove button */}
        <button
          className="flex-shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
          style={{ 
            background: 'transparent', 
            border: 'none', 
            cursor: 'pointer',
            color: '#666',
          }}
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          title="Remove from favourites"
        >
          <DeleteOutlined style={{ fontSize: 12 }} />
        </button>
      </div>
    </div>
  );
});

function FavouritesPanelInner({
  favourites,
  runs,
  latitude,
  longitude,
  hourlyWeather,
  onSelectRun,
  onRemoveFavourite,
}: FavouritesPanelProps) {
  const [currentPage, setCurrentPage] = useState(1);
  
  // Get full run data for favourites
  const favouriteRuns = useMemo(() => {
    return favourites
      .map(fav => runs.find(r => r.id === fav.id))
      .filter((r): r is RunData => r !== undefined);
  }, [favourites, runs]);
  
  // Analyze runs for sun exposure
  const runAnalyses = useMemo(() => {
    if (favouriteRuns.length === 0) return [];
    const today = new Date();
    return analyzeRuns(favouriteRuns, today, latitude, longitude, hourlyWeather);
  }, [favouriteRuns, latitude, longitude, hourlyWeather]);
  
  // Sort by sunniest window (runs with sunny windows first, sorted by percentage)
  const sortedAnalyses = useMemo(() => {
    return [...runAnalyses].sort((a, b) => {
      // Bad weather runs go to bottom
      if (a.isBadWeather && !b.isBadWeather) return 1;
      if (!a.isBadWeather && b.isBadWeather) return -1;
      
      // Runs with sunny windows come first
      if (a.sunniestWindow && !b.sunniestWindow) return -1;
      if (!a.sunniestWindow && b.sunniestWindow) return 1;
      
      // Sort by sunny percentage (highest first)
      const aPercentage = a.sunniestWindow?.sunnyPercentage || 0;
      const bPercentage = b.sunniestWindow?.sunnyPercentage || 0;
      return bPercentage - aPercentage;
    });
  }, [runAnalyses]);
  
  // Pagination
  const totalPages = Math.ceil(sortedAnalyses.length / ITEMS_PER_PAGE);
  const paginatedAnalyses = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedAnalyses.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedAnalyses, currentPage]);
  
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);
  
  if (favourites.length === 0) {
    return null;
  }
  
  return (
    <div className="favourites-panel mb-3">
      <div className="flex items-center gap-2 mb-2">
        <StarFilled style={{ fontSize: 12, color: '#faad14' }} />
        <Text strong style={{ fontSize: 11 }}>FAVOURITES ({favourites.length})</Text>
      </div>
      
      <div 
        className="p-2 rounded mb-2" 
        style={{ 
          background: 'rgba(250, 173, 20, 0.05)', 
          border: '1px solid rgba(250, 173, 20, 0.2)',
          borderRadius: 6,
        }}
      >
        <div className="flex items-start gap-2">
          <SunOutlined style={{ fontSize: 14, color: '#faad14', marginTop: 2 }} />
          <div>
            <Text style={{ fontSize: 10, display: 'block' }}>
              <strong>Optimum sun times</strong> for your favourite runs today
            </Text>
            <Text type="secondary" style={{ fontSize: 9 }}>
              Plan your day for the best sun exposure on each piste
            </Text>
          </div>
        </div>
      </div>
      
      <div className="favourite-runs-list">
        {paginatedAnalyses.map(analysis => {
          const run = runs.find(r => r.id === analysis.runId);
          return (
            <FavouriteRunItem
              key={analysis.runId}
              analysis={analysis}
              onSelect={() => run && onSelectRun?.(run)}
              onRemove={() => onRemoveFavourite?.(analysis.runId)}
            />
          );
        })}
      </div>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center mt-2">
          <Pagination
            size="small"
            current={currentPage}
            total={sortedAnalyses.length}
            pageSize={ITEMS_PER_PAGE}
            onChange={handlePageChange}
            showSizeChanger={false}
            simple
          />
        </div>
      )}
    </div>
  );
}

const FavouritesPanel = memo(FavouritesPanelInner);
export default FavouritesPanel;

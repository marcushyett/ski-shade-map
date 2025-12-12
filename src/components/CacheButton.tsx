'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import { Tooltip } from 'antd';
import { 
  DownloadOutlined, 
  CheckCircleOutlined,
  LoadingOutlined,
  CloudDownloadOutlined
} from '@ant-design/icons';

interface CacheButtonProps {
  skiAreaId: string | null;
  skiAreaName: string | null;
  latitude: number;
  longitude: number;
}

const CACHE_STATUS_KEY = 'ski-shade-cache-status';

interface CacheStatus {
  [skiAreaId: string]: {
    cachedAt: string;
    name: string;
  };
}

function CacheButtonInner({ skiAreaId, skiAreaName, latitude, longitude }: CacheButtonProps) {
  const [isCached, setIsCached] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [cacheDate, setCacheDate] = useState<string | null>(null);

  // Check if this area is cached
  useEffect(() => {
    if (!skiAreaId) {
      setIsCached(false);
      setCacheDate(null);
      return;
    }

    try {
      const stored = localStorage.getItem(CACHE_STATUS_KEY);
      if (stored) {
        const status: CacheStatus = JSON.parse(stored);
        if (status[skiAreaId]) {
          setIsCached(true);
          setCacheDate(status[skiAreaId].cachedAt);
        } else {
          setIsCached(false);
          setCacheDate(null);
        }
      }
    } catch (e) {
      // Ignore
    }
  }, [skiAreaId]);

  const handleCache = useCallback(async () => {
    if (!skiAreaId || isLoading) return;

    setIsLoading(true);

    try {
      // Fetch and cache ski area details
      const skiAreaRes = await fetch(`/api/ski-areas/${skiAreaId}`);
      if (!skiAreaRes.ok) throw new Error('Failed to cache ski area');

      // Fetch and cache weather
      const weatherRes = await fetch(`/api/weather?lat=${latitude}&lng=${longitude}`);
      if (!weatherRes.ok) throw new Error('Failed to cache weather');

      // Store cache status in localStorage
      const stored = localStorage.getItem(CACHE_STATUS_KEY);
      const status: CacheStatus = stored ? JSON.parse(stored) : {};
      status[skiAreaId] = {
        cachedAt: new Date().toISOString(),
        name: skiAreaName || 'Unknown',
      };
      localStorage.setItem(CACHE_STATUS_KEY, JSON.stringify(status));

      setIsCached(true);
      setCacheDate(new Date().toISOString());
    } catch (error) {
      console.error('Cache error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [skiAreaId, skiAreaName, latitude, longitude, isLoading]);

  if (!skiAreaId) return null;

  const formatCacheDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <Tooltip 
      title={
        isCached 
          ? `Cached for offline (${cacheDate ? formatCacheDate(cacheDate) : 'unknown'}). Click to refresh.`
          : 'Download for offline use'
      }
    >
      <button
        onClick={handleCache}
        disabled={isLoading}
        style={{
          width: 32,
          height: 32,
          borderRadius: 2,
          border: `1px solid ${isCached ? '#666' : '#333'}`,
          background: isCached ? '#2a2a2a' : '#1a1a1a',
          color: isCached ? '#fff' : '#888',
          cursor: isLoading ? 'wait' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s',
        }}
      >
        {isLoading ? (
          <LoadingOutlined style={{ fontSize: 14 }} spin />
        ) : isCached ? (
          <CheckCircleOutlined style={{ fontSize: 14 }} />
        ) : (
          <CloudDownloadOutlined style={{ fontSize: 14 }} />
        )}
      </button>
    </Tooltip>
  );
}

const CacheButton = memo(CacheButtonInner);
export default CacheButton;


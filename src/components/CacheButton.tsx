'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import { Tooltip } from 'antd';
import { 
  DownloadOutlined, 
  CheckCircleOutlined,
  LoadingOutlined,
  CloudDownloadOutlined
} from '@ant-design/icons';
import { trackEvent } from '@/lib/posthog';

// Detect touch device to disable tooltips (they require double-tap on mobile)
const isTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

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
    
    trackEvent('cache_download_started', {
      ski_area_id: skiAreaId,
      ski_area_name: skiAreaName || undefined,
    });

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

      trackEvent('cache_download_completed', {
        ski_area_id: skiAreaId,
        ski_area_name: skiAreaName || undefined,
      });

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

  const button = (
    <button
      onClick={handleCache}
      disabled={isLoading}
      className={`map-control-btn${isCached ? ' is-active' : ''}`}
      aria-label={isCached ? 'Refresh offline cache' : 'Download for offline use'}
    >
      {isLoading ? (
        <LoadingOutlined spin />
      ) : isCached ? (
        <CheckCircleOutlined />
      ) : (
        <CloudDownloadOutlined />
      )}
    </button>
  );

  // Skip tooltip on touch devices to avoid double-tap requirement
  if (isTouchDevice()) {
    return button;
  }

  return (
    <Tooltip 
      title={
        isCached 
          ? `Cached for offline (${cacheDate ? formatCacheDate(cacheDate) : 'unknown'}). Click to refresh.`
          : 'Download for offline use'
      }
    >
      {button}
    </Tooltip>
  );
}

const CacheButton = memo(CacheButtonInner);
export default CacheButton;


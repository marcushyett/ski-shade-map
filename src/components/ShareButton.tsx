'use client';

import { memo, useCallback } from 'react';
import { Tooltip, message } from 'antd';
import { ShareAltOutlined } from '@ant-design/icons';
import { dateToYYYYMMDD } from '@/hooks/useUrlState';
import { format, isSameDay } from 'date-fns';

interface ShareButtonProps {
  skiAreaId: string | null;
  skiAreaName: string | null;
  latitude: number;
  longitude: number;
  zoom: number;
  selectedTime: Date;
  highlightedFeatureId?: string | null;
  highlightedFeatureType?: 'run' | 'lift' | null;
}

function ShareButtonInner({ 
  skiAreaId, 
  skiAreaName, 
  latitude, 
  longitude, 
  zoom,
  selectedTime,
  highlightedFeatureId,
  highlightedFeatureType,
}: ShareButtonProps) {
  
  const handleShare = useCallback(async () => {
    if (!skiAreaId) return;

    // Build URL with state parameters
    const params = new URLSearchParams();
    params.set('area', skiAreaId);
    params.set('lat', latitude.toFixed(5));
    params.set('lng', longitude.toFixed(5));
    params.set('z', zoom.toFixed(1));
    
    // Include date if not today
    const today = new Date();
    if (!isSameDay(selectedTime, today)) {
      params.set('d', dateToYYYYMMDD(selectedTime));
    }
    
    // Encode time as minutes from midnight (compact)
    const minutes = selectedTime.getHours() * 60 + selectedTime.getMinutes();
    params.set('t', minutes.toString());
    
    // Add highlight if present
    if (highlightedFeatureId && highlightedFeatureType) {
      params.set('hl', highlightedFeatureId);
      params.set('hlt', highlightedFeatureType);
    }

    // Also include the name in URL for display when loading
    if (skiAreaName) {
      params.set('name', skiAreaName);
    }

    const shareUrl = `${window.location.origin}?${params.toString()}`;
    
    const dateStr = !isSameDay(selectedTime, today) ? ` on ${format(selectedTime, 'MMM d')}` : '';
    const shareData = {
      title: `SKISHADE - ${skiAreaName || 'Ski Area'}`,
      text: `Check out where the sun will be on the slopes at ${skiAreaName || 'this ski area'}${dateStr}.\n\n${shareUrl}`,
      url: shareUrl,
    };

    // Try native share first (iOS, Android, etc.)
    if (navigator.share && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        // User cancelled or share failed, fall through to clipboard
        if ((error as Error).name === 'AbortError') {
          return; // User cancelled, don't show clipboard message
        }
      }
    }

    // Fallback to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      message.success('Link copied to clipboard!');
    } catch (error) {
      // Final fallback - show URL in prompt
      message.info('Copy this link: ' + shareUrl);
    }
  }, [skiAreaId, skiAreaName, latitude, longitude, zoom, selectedTime, highlightedFeatureId, highlightedFeatureType]);

  if (!skiAreaId) return null;

  return (
    <Tooltip title="Share this view">
      <button
        onClick={handleShare}
        style={{
          width: 32,
          height: 32,
          borderRadius: 2,
          border: '1px solid #333',
          background: '#1a1a1a',
          color: '#888',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s',
        }}
      >
        <ShareAltOutlined style={{ fontSize: 14 }} />
      </button>
    </Tooltip>
  );
}

const ShareButton = memo(ShareButtonInner);
export default ShareButton;


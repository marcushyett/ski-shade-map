'use client';

import { memo, useCallback } from 'react';
import { Tooltip, message } from 'antd';
import { ShareAltOutlined } from '@ant-design/icons';
import { trackEvent } from '@/lib/posthog';
import { dateToYYYYMMDD } from '@/hooks/useUrlState';
import { format, isSameDay } from 'date-fns';

// Detect touch device to disable tooltips (they require double-tap on mobile)
const isTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

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

    // Track share initiated
    trackEvent('share_initiated', {
      ski_area_id: skiAreaId,
      ski_area_name: skiAreaName || undefined,
      has_highlight: !!highlightedFeatureId,
      highlight_type: highlightedFeatureType || undefined,
    });

    // Try native share first (iOS, Android, etc.)
    if (navigator.share && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
        trackEvent('share_completed', {
          share_method: 'native',
          ski_area_id: skiAreaId,
          ski_area_name: skiAreaName || undefined,
        });
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
      trackEvent('share_link_copied', {
        ski_area_id: skiAreaId,
        ski_area_name: skiAreaName || undefined,
      });
      message.success('Link copied to clipboard!');
    } catch (error) {
      // Final fallback - show URL in prompt
      message.info('Copy this link: ' + shareUrl);
    }
  }, [skiAreaId, skiAreaName, latitude, longitude, zoom, selectedTime, highlightedFeatureId, highlightedFeatureType]);

  if (!skiAreaId) return null;

  const button = (
    <button
      onClick={handleShare}
      className="map-control-btn"
      aria-label="Share this view"
    >
      <ShareAltOutlined />
    </button>
  );

  // Skip tooltip on touch devices to avoid double-tap requirement
  if (isTouchDevice()) {
    return button;
  }

  return (
    <Tooltip title="Share this view">
      {button}
    </Tooltip>
  );
}

const ShareButton = memo(ShareButtonInner);
export default ShareButton;


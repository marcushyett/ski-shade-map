'use client';

import { memo } from 'react';
import { WifiOutlined, WarningOutlined } from '@ant-design/icons';

interface OfflineBannerProps {
  isOffline: boolean;
  wasOffline: boolean;
  lastOnline: Date | null;
  onDismiss?: () => void;
}

function OfflineBannerInner({ isOffline, wasOffline, lastOnline, onDismiss }: OfflineBannerProps) {
  if (!isOffline && !wasOffline) return null;

  const formatLastOnline = (date: Date | null) => {
    if (!date) return 'unknown';
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div
      className="offline-banner"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        padding: '8px 16px',
        background: isOffline ? '#1a1a1a' : '#2a2a2a',
        borderBottom: `2px solid ${isOffline ? '#ff4d4f' : '#faad14'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontSize: 11,
      }}
    >
      {isOffline ? (
        <>
          <WifiOutlined style={{ color: '#ff4d4f' }} />
          <span style={{ color: '#ff4d4f' }}>
            You&apos;re offline
          </span>
          <span style={{ color: '#888' }}>
            — Using cached data
            {lastOnline && ` (last updated ${formatLastOnline(lastOnline)})`}
          </span>
          <span style={{ color: '#666', marginLeft: 8 }}>
            Some features are disabled
          </span>
        </>
      ) : (
        <>
          <WarningOutlined style={{ color: '#faad14' }} />
          <span style={{ color: '#faad14' }}>
            Back online
          </span>
          <span style={{ color: '#888' }}>
            — Data may be outdated, refresh recommended
          </span>
          {onDismiss && (
            <button
              onClick={onDismiss}
              style={{
                marginLeft: 12,
                background: 'transparent',
                border: '1px solid #666',
                borderRadius: 2,
                color: '#888',
                padding: '2px 8px',
                cursor: 'pointer',
                fontSize: 10,
              }}
            >
              Dismiss
            </button>
          )}
        </>
      )}
    </div>
  );
}

const OfflineBanner = memo(OfflineBannerInner);
export default OfflineBanner;


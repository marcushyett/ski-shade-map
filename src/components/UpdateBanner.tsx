'use client';

import { memo } from 'react';
import { SyncOutlined, CloseOutlined } from '@ant-design/icons';

interface UpdateBannerProps {
  onUpdate: () => void;
  onDismiss: () => void;
}

function UpdateBannerInner({ onUpdate, onDismiss }: UpdateBannerProps) {
  return (
    <div
      className="update-banner"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1001,
        padding: '10px 16px',
        background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
        borderBottom: '2px solid #60a5fa',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        fontSize: 12,
        boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
      }}
    >
      <SyncOutlined style={{ color: '#fff', fontSize: 14 }} spin={false} />
      <span style={{ color: '#fff', fontWeight: 500 }}>
        New version available!
      </span>
      <button
        onClick={onUpdate}
        style={{
          background: '#fff',
          border: 'none',
          borderRadius: 4,
          color: '#1e40af',
          padding: '4px 12px',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.transform = 'scale(1.05)';
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        Update Now
      </button>
      <button
        onClick={onDismiss}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'rgba(255,255,255,0.7)',
          padding: '4px',
          cursor: 'pointer',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          marginLeft: 4,
        }}
        title="Dismiss (update later)"
      >
        <CloseOutlined />
      </button>
    </div>
  );
}

const UpdateBanner = memo(UpdateBannerInner);
export default UpdateBanner;


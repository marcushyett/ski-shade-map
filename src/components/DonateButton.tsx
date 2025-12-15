'use client';

import { memo, useCallback } from 'react';
import { HeartOutlined } from '@ant-design/icons';
import { trackEvent } from '@/lib/posthog';

const DONATE_URL = 'https://www.paypal.com/donate/?business=YWLV3SE9ZUGJU&no_recurring=0&item_name=To+help+cover+the+costs+of+maintaining+and+improving+the+skishade+app.&currency_code=GBP';

function DonateButtonInner() {
  const handleClick = useCallback(() => {
    trackEvent('donate_clicked');
    window.open(DONATE_URL, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleClick}
        style={{
          width: '100%',
          padding: '6px 10px',
          borderRadius: 2,
          border: '1px solid #333',
          background: '#1a1a1a',
          color: '#888',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          fontSize: 11,
          transition: 'all 0.2s',
        }}
      >
        <HeartOutlined style={{ fontSize: 12 }} />
        <span>Support this project</span>
      </button>
      <span style={{ fontSize: 9, color: '#555', textAlign: 'center' }}>
        Free to use, donations help cover costs
      </span>
    </div>
  );
}

const DonateButton = memo(DonateButtonInner);
export default DonateButton;

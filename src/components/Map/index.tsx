'use client';

import dynamic from 'next/dynamic';
import LoadingSpinner from '@/components/LoadingSpinner';

// Dynamic import to avoid SSR issues with maplibre-gl
const SkiMap = dynamic(() => import('./SkiMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center" style={{ background: '#0a0a0a' }}>
      <LoadingSpinner size={48} />
    </div>
  ),
});

export default SkiMap;

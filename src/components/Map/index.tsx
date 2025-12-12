'use client';

import dynamic from 'next/dynamic';

// Dynamic import to avoid SSR issues with maplibre-gl
const SkiMap = dynamic(() => import('./SkiMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="animate-pulse text-gray-500">Loading map...</div>
    </div>
  ),
});

export default SkiMap;


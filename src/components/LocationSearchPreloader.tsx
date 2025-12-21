'use client';

import { useEffect } from 'react';
import { preloadLocationSearch } from '@/hooks/useLocationSearch';

/**
 * Invisible component that preloads the location search index
 * on page load using a web worker. Add this to your layout.
 */
export default function LocationSearchPreloader() {
  useEffect(() => {
    // Start preloading immediately on mount
    preloadLocationSearch().catch(console.error);
  }, []);

  return null;
}

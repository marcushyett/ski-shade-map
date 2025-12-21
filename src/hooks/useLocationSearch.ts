'use client';

import { useState, useEffect, useCallback } from 'react';
import Fuse, { IFuseOptions } from 'fuse.js';
import { getRelatedSearchTerms } from '@/lib/resort-synonyms';

export interface LocationSearchResult {
  id: string;
  type: 'region' | 'locality';
  name: string;
  country?: string;
  region?: string;
  skiAreaId: string;
  latitude?: number;
  longitude?: number;
  runCount?: number;
  liftCount?: number;
}

// Processed location from worker
interface IndexedLocation {
  id: string;
  type: 'region' | 'locality';
  name: string;
  nameNorm: string;
  country: string | null;
  countryNorm: string;
  region?: string;
  regionNorm: string;
  skiAreaId: string;
  lat?: number;
  lng?: number;
  runs?: number;
  lifts?: number;
  searchText: string;
}

// Fuse.js options
const fuseOptions: IFuseOptions<IndexedLocation> = {
  keys: [
    { name: 'nameNorm', weight: 2 },
    { name: 'searchText', weight: 1 },
    { name: 'regionNorm', weight: 0.8 },
  ],
  threshold: 0.3,
  distance: 100,
  minMatchCharLength: 2,
  includeScore: true,
  ignoreLocation: true,
};

// Global state for preloaded data
let locationsCache: IndexedLocation[] | null = null;
let fuseIndexCache: Fuse<IndexedLocation> | null = null;
let preloadPromise: Promise<void> | null = null;
let preloadStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
const preloadListeners: Set<() => void> = new Set();

function notifyListeners() {
  preloadListeners.forEach((fn) => fn());
}

/**
 * Preload the search index using a web worker.
 * Call this as early as possible (e.g., on page load).
 */
export function preloadLocationSearch(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  if (preloadStatus === 'ready') return Promise.resolve();

  preloadStatus = 'loading';
  notifyListeners();

  preloadPromise = new Promise((resolve, reject) => {
    // Create worker
    const worker = new Worker(
      new URL('../workers/locationSearch.worker.ts', import.meta.url)
    );

    worker.onmessage = (event) => {
      const msg = event.data;

      if (msg.type === 'complete') {
        // Build Fuse index on main thread (fast with pre-processed data)
        const data: IndexedLocation[] = msg.data;
        locationsCache = data;
        fuseIndexCache = new Fuse(data, fuseOptions);
        preloadStatus = 'ready';
        notifyListeners();
        worker.terminate();
        resolve();
      } else if (msg.type === 'error') {
        preloadStatus = 'error';
        notifyListeners();
        worker.terminate();
        reject(new Error(msg.error));
      }
    };

    worker.onerror = (error) => {
      preloadStatus = 'error';
      notifyListeners();
      worker.terminate();
      reject(error);
    };

    // Start the worker
    worker.postMessage({
      type: 'start',
      apiUrl: '/api/locations/all',
    });
  });

  return preloadPromise;
}

export function useLocationSearch() {
  const [isLoading, setIsLoading] = useState(() => preloadStatus === 'loading');
  const [isReady, setIsReady] = useState(() => preloadStatus === 'ready');

  useEffect(() => {
    // Subscribe to preload status changes
    const updateState = () => {
      setIsLoading(preloadStatus === 'loading');
      setIsReady(preloadStatus === 'ready');
    };

    preloadListeners.add(updateState);

    // Start preload if not already started
    if (preloadStatus === 'idle') {
      preloadLocationSearch().catch(console.error);
    }

    // Update state in case preload finished before mount
    updateState();

    return () => {
      preloadListeners.delete(updateState);
    };
  }, []);

  // Instant search function
  const search = useCallback((query: string, limit = 15): LocationSearchResult[] => {
    if (!query || query.length < 2 || !fuseIndexCache || !locationsCache) {
      return [];
    }

    const normalizedQuery = query
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const results: LocationSearchResult[] = [];
    const seenIds = new Set<string>();

    // Get related terms from synonyms
    const relatedTerms = getRelatedSearchTerms(query);

    // Search with Fuse.js
    const fuseResults = fuseIndexCache.search(normalizedQuery, { limit: limit * 2 });

    // Also search for related synonym terms
    for (const relatedTerm of relatedTerms.slice(0, 3)) {
      const relatedResults = fuseIndexCache.search(relatedTerm, { limit: 5 });
      for (const result of relatedResults) {
        fuseResults.push({ ...result, score: (result.score || 0) + 0.15 });
      }
    }

    // Sort by score
    fuseResults.sort((a, b) => (a.score || 0) - (b.score || 0));

    // Convert to results
    for (const fuseResult of fuseResults) {
      const item = fuseResult.item;
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);

      results.push({
        id: item.id,
        type: item.type,
        name: item.name,
        country: item.country || undefined,
        region: item.region,
        skiAreaId: item.skiAreaId,
        latitude: item.lat,
        longitude: item.lng,
        runCount: item.runs,
        liftCount: item.lifts,
      });

      if (results.length >= limit) break;
    }

    // Sort: exact matches first, prefix matches second
    results.sort((a, b) => {
      const aNorm = a.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const bNorm = b.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

      const aExact = aNorm === normalizedQuery;
      const bExact = bNorm === normalizedQuery;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      const aStarts = aNorm.startsWith(normalizedQuery);
      const bStarts = bNorm.startsWith(normalizedQuery);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      // Prefer regions over localities
      if (a.type !== b.type) {
        return a.type === 'region' ? -1 : 1;
      }

      return 0;
    });

    return results.slice(0, limit);
  }, []);

  return { search, isLoading, isReady };
}

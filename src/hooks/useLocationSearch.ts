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
 * Falls back to main thread fetch if worker fails.
 */
export function preloadLocationSearch(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  if (preloadStatus === 'ready') return Promise.resolve();

  preloadStatus = 'loading';
  notifyListeners();

  preloadPromise = new Promise((resolve, reject) => {
    // Try web worker first
    try {
      const worker = new Worker(
        new URL('../workers/locationSearch.worker.ts', import.meta.url)
      );

      const timeoutId = setTimeout(() => {
        console.warn('Worker timeout, falling back to main thread');
        worker.terminate();
        fallbackLoad().then(resolve).catch(reject);
      }, 10000); // 10 second timeout

      worker.onmessage = (event) => {
        const msg = event.data;

        if (msg.type === 'complete') {
          clearTimeout(timeoutId);
          const data: IndexedLocation[] = msg.data;
          locationsCache = data;
          fuseIndexCache = new Fuse(data, fuseOptions);
          preloadStatus = 'ready';
          notifyListeners();
          worker.terminate();
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timeoutId);
          console.warn('Worker error, falling back:', msg.error);
          worker.terminate();
          fallbackLoad().then(resolve).catch(reject);
        }
      };

      worker.onerror = (error) => {
        clearTimeout(timeoutId);
        console.warn('Worker failed, falling back:', error);
        worker.terminate();
        fallbackLoad().then(resolve).catch(reject);
      };

      worker.postMessage({
        type: 'start',
        apiUrl: '/api/locations/all',
      });
    } catch (error) {
      console.warn('Worker creation failed, falling back:', error);
      fallbackLoad().then(resolve).catch(reject);
    }
  });

  return preloadPromise;
}

// Fallback: load on main thread if worker fails
async function fallbackLoad(): Promise<void> {
  try {
    const res = await fetch('/api/locations/all');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const rawData = await res.json();

    // Process data on main thread
    const processed: IndexedLocation[] = rawData.map((loc: Record<string, unknown>) => {
      const nameNorm = normalizeText(loc.name as string);
      const countryNorm = loc.country ? normalizeText(loc.country as string) : '';
      const regionNorm = loc.region ? normalizeText(loc.region as string) : '';

      return {
        ...loc,
        nameNorm,
        countryNorm,
        regionNorm,
        searchText: `${nameNorm} ${regionNorm} ${countryNorm}`.trim(),
      } as IndexedLocation;
    });

    locationsCache = processed;
    fuseIndexCache = new Fuse(processed, fuseOptions);
    preloadStatus = 'ready';
    notifyListeners();
  } catch (error) {
    preloadStatus = 'error';
    notifyListeners();
    throw error;
  }
}

// Normalize text helper
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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

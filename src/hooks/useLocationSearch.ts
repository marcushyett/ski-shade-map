'use client';

import { useState, useEffect, useCallback } from 'react';
import Fuse, { IFuseOptions } from 'fuse.js';
import type { SearchableLocation } from '@/app/api/locations/all/route';
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

// Normalize text for matching
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// Searchable item with pre-normalized fields
interface IndexedLocation extends SearchableLocation {
  nameNorm: string;
  countryNorm: string;
  regionNorm: string;
  searchText: string;
}

// Fuse.js options for fast fuzzy matching
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

// Global cache for locations data
let locationsCache: IndexedLocation[] | null = null;
let fuseIndexCache: Fuse<IndexedLocation> | null = null;
let fetchPromise: Promise<void> | null = null;

async function fetchAndIndexLocations(): Promise<void> {
  if (locationsCache && fuseIndexCache) return;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const res = await fetch('/api/locations/all');
      if (!res.ok) throw new Error('Failed to fetch locations');

      const data: SearchableLocation[] = await res.json();

      // Pre-normalize all fields for fast searching
      locationsCache = data.map((loc) => {
        const nameNorm = normalizeText(loc.name);
        const countryNorm = loc.country ? normalizeText(loc.country) : '';
        const regionNorm = loc.region ? normalizeText(loc.region) : '';

        return {
          ...loc,
          nameNorm,
          countryNorm,
          regionNorm,
          searchText: `${nameNorm} ${regionNorm} ${countryNorm}`.trim(),
        };
      });

      // Build Fuse.js index
      fuseIndexCache = new Fuse(locationsCache, fuseOptions);
    } catch (error) {
      console.error('Failed to load locations:', error);
      locationsCache = [];
      fuseIndexCache = new Fuse([], fuseOptions);
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

export function useLocationSearch() {
  // Initialize state based on whether cache already exists
  const [isLoading, setIsLoading] = useState(() => !locationsCache);
  const [isReady, setIsReady] = useState(() => !!locationsCache);

  // Load locations on mount
  useEffect(() => {
    // Skip if already loaded
    if (locationsCache && fuseIndexCache) return;

    let cancelled = false;
    fetchAndIndexLocations().then(() => {
      if (!cancelled) {
        setIsLoading(false);
        setIsReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Instant search function - no debounce needed, runs in <1ms
  const search = useCallback((query: string, limit = 15): LocationSearchResult[] => {
    if (!query || query.length < 2 || !fuseIndexCache || !locationsCache) {
      return [];
    }

    const normalizedQuery = normalizeText(query);
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
      const aNorm = normalizeText(a.name);
      const bNorm = normalizeText(b.name);

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

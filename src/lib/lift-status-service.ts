/**
 * Lift Status Service
 *
 * Fetches and caches real-time lift and run status via API routes.
 * Uses IndexedDB for client-side persistence with a 5-minute TTL.
 */

import type {
  ResortStatus,
  SupportedResort,
  LiftStatus,
  RunStatus,
  EnrichedLiftData,
  EnrichedRunData
} from './lift-status-types';
import { getMinutesUntilClose } from './lift-status-types';
import type { LiftData, RunData, OperationStatus } from './types';

/**
 * Normalize status from API (which may be uppercase like 'OPEN')
 * to our lowercase format ('open', 'closed', 'unknown', 'scheduled')
 */
function normalizeStatus(status: string | null | undefined): OperationStatus | null {
  if (!status) return null;
  const lower = status.toLowerCase();
  if (lower === 'open' || lower === 'closed' || lower === 'unknown' || lower === 'scheduled') {
    return lower as OperationStatus;
  }
  return 'unknown';
}

// IndexedDB configuration
const DB_NAME = 'ski-lift-status-cache';
const DB_VERSION = 1;
const STORE_NAME = 'resort-status';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes for live status data

interface CachedResortStatus {
  openskimapId: string;
  data: ResortStatus;
  cachedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB not supported'));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'openskimapId' });
      }
    };
  });

  return dbPromise;
}

async function getCachedStatus(openskimapId: string): Promise<ResortStatus | null> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(openskimapId);

      request.onsuccess = () => {
        const data = request.result as CachedResortStatus | undefined;

        if (!data) {
          resolve(null);
          return;
        }

        // Check TTL
        const age = Date.now() - data.cachedAt;
        if (age > CACHE_TTL_MS) {
          resolve(null);
          return;
        }

        resolve(data.data);
      };

      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function cacheStatus(openskimapId: string, data: ResortStatus): Promise<void> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const cached: CachedResortStatus = {
        openskimapId,
        data,
        cachedAt: Date.now(),
      };

      const request = store.put(cached);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Ignore cache errors
  }
}

// In-memory cache for supported resorts
let supportedResortsCache: SupportedResort[] | null = null;

/**
 * Get list of supported resorts via API
 */
export async function getSupportedResorts(): Promise<SupportedResort[]> {
  if (supportedResortsCache) {
    console.log('[LiftStatus Client] Using cached supported resorts:', supportedResortsCache.length);
    return supportedResortsCache;
  }

  try {
    console.log('[LiftStatus Client] Fetching supported resorts...');
    const response = await fetch('/api/lift-status/supported');
    if (!response.ok) {
      throw new Error('Failed to fetch supported resorts');
    }

    supportedResortsCache = await response.json();
    console.log('[LiftStatus Client] Loaded supported resorts:', supportedResortsCache?.length || 0);
    return supportedResortsCache || [];
  } catch (error) {
    console.error('[LiftStatus Client] Failed to get supported resorts:', error);
    return [];
  }
}

/**
 * Check if a ski area has live status data available
 */
export async function hasLiveStatus(openskimapId: string): Promise<boolean> {
  console.log('[LiftStatus Client] Checking hasLiveStatus for:', openskimapId);
  const resorts = await getSupportedResorts();

  const found = resorts.find(r => {
    if (Array.isArray(r.openskimapId)) {
      return r.openskimapId.includes(openskimapId);
    }
    return r.openskimapId === openskimapId;
  });

  console.log('[LiftStatus Client] hasLiveStatus result:', {
    openskimapId,
    found: !!found,
    matchedResort: found ? { name: found.name, id: found.id } : null,
  });

  return !!found;
}

/**
 * Fetch resort status via API (with client-side caching)
 */
export async function fetchResortStatus(openskimapId: string): Promise<ResortStatus | null> {
  console.log('[LiftStatus Client] fetchResortStatus called for:', openskimapId);

  // Check client-side cache first
  const cached = await getCachedStatus(openskimapId);
  if (cached) {
    // Check if cached data has correct format (openskimapIds not openskimap_ids)
    const sampleLift = cached.lifts?.[0];
    const hasCorrectFormat = sampleLift && 'openskimapIds' in sampleLift;

    console.log('[LiftStatus Client] Using cached status for:', openskimapId, {
      lifts: cached.lifts?.length,
      runs: cached.runs?.length,
      sampleLiftKeys: sampleLift ? Object.keys(sampleLift) : [],
      hasOpenskimapIds: hasCorrectFormat,
    });

    // If cached data has wrong format or empty openskimapIds, skip cache
    const hasEmptyIds = sampleLift?.openskimapIds?.length === 0;
    if ((!hasCorrectFormat && sampleLift) || hasEmptyIds) {
      console.log('[LiftStatus Client] Cache has wrong format or empty IDs, fetching fresh');
      // Don't return cached - fall through to fetch fresh
    } else {
      return cached;
    }
  }

  try {
    // Add cache-buster to bypass CDN/edge cache (v2 = fixed openskimapIds)
    const url = `/api/lift-status/${encodeURIComponent(openskimapId)}?v=2`;
    console.log('[LiftStatus Client] Fetching from API:', url);
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        console.log('[LiftStatus Client] Resort not supported (404):', openskimapId);
        return null;
      }
      throw new Error(`Failed to fetch resort status: ${response.status}`);
    }

    const data: ResortStatus = await response.json();

    console.log('[LiftStatus Client] Received status data:', {
      openskimapId,
      lifts: data.lifts?.length,
      runs: data.runs?.length,
      resortName: data.resort?.name,
    });

    // Cache the result client-side
    await cacheStatus(openskimapId, data);

    return data;
  } catch (error) {
    console.error('[LiftStatus Client] Failed to fetch resort status:', error);
    return null;
  }
}

/**
 * Match lift status to a lift by OpenSkiMap ID, with name fallback
 */
function matchLiftStatus(liftId: string, liftName: string | null, liftStatuses: LiftStatus[]): LiftStatus | undefined {
  // First try matching by openskimap ID
  const matchById = liftStatuses.find(s => s.openskimapIds?.includes(liftId));
  if (matchById) return matchById;

  // Fallback: match by name (case-insensitive)
  if (liftName) {
    const normalizedName = liftName.toLowerCase().trim();
    const matchByName = liftStatuses.find(s =>
      s.name?.toLowerCase().trim() === normalizedName
    );
    if (matchByName) return matchByName;
  }

  return undefined;
}

/**
 * Match run status to a run by OpenSkiMap ID, with name fallback
 */
function matchRunStatus(runId: string, runName: string | null, runStatuses: RunStatus[]): RunStatus | undefined {
  // First try matching by openskimap ID
  const matchById = runStatuses.find(s => s.openskimapIds?.includes(runId));
  if (matchById) return matchById;

  // Fallback: match by name (case-insensitive)
  if (runName) {
    const normalizedName = runName.toLowerCase().trim();
    const matchByName = runStatuses.find(s =>
      s.name?.toLowerCase().trim() === normalizedName
    );
    if (matchByName) return matchByName;
  }

  return undefined;
}

/**
 * Enrich lifts with live status data
 */
export function enrichLiftsWithStatus(
  lifts: LiftData[],
  resortStatus: ResortStatus | null,
  currentTime: Date = new Date()
): EnrichedLiftData[] {
  let matchedCount = 0;
  const unmatchedLifts: string[] = [];

  // Debug: log the structure of status data
  if (resortStatus && resortStatus.lifts?.length > 0) {
    const sampleStatusLift = resortStatus.lifts[0];
    console.log('[LiftStatus Debug] Status data structure:', {
      sampleLiftName: sampleStatusLift.name,
      sampleLiftKeys: Object.keys(sampleStatusLift),
      openskimapIds: sampleStatusLift.openskimapIds,
      // Check for snake_case version
      openskimap_ids: (sampleStatusLift as unknown as Record<string, unknown>)['openskimap_ids'],
    });
  }

  // Debug: log first lift comparison
  let debuggedFirst = false;

  const result = lifts.map(lift => {
    const enriched: EnrichedLiftData = {
      ...lift,
      status: lift.status as EnrichedLiftData['status'],
    };

    if (resortStatus && lift.osmId) {
      // Debug first lift
      if (!debuggedFirst && resortStatus.lifts?.length > 0) {
        debuggedFirst = true;
        const firstStatusLift = resortStatus.lifts[0];
        console.log('[LiftStatus Debug] First lift comparison:', {
          ourLiftName: lift.name,
          ourLiftOsmId: lift.osmId,
          statusLiftName: firstStatusLift.name,
          statusLiftIds: firstStatusLift.openskimapIds,
          wouldMatch: firstStatusLift.openskimapIds?.includes(lift.osmId),
        });
      }

      const liveStatus = matchLiftStatus(lift.osmId, lift.name, resortStatus.lifts);
      if (liveStatus) {
        matchedCount++;
        enriched.liveStatus = liveStatus;
        enriched.status = normalizeStatus(liveStatus.status);

        // Extract closing time
        if (liveStatus.openingTimes && liveStatus.openingTimes.length > 0) {
          enriched.closingTime = liveStatus.openingTimes[0].endTime;
          enriched.minutesUntilClose = getMinutesUntilClose(enriched.closingTime, currentTime);
        }
      } else {
        unmatchedLifts.push(`${lift.name || 'unnamed'}(${lift.osmId})`);
      }
    }

    return enriched;
  });

  console.log('[LiftStatus Client] enrichLiftsWithStatus:', {
    totalLifts: lifts.length,
    hasResortStatus: !!resortStatus,
    statusLifts: resortStatus?.lifts?.length || 0,
    matched: matchedCount,
    unmatched: unmatchedLifts.length,
    unmatchedSample: unmatchedLifts.slice(0, 3),
  });

  return result;
}

/**
 * Enrich runs with live status data
 */
export function enrichRunsWithStatus(
  runs: RunData[],
  resortStatus: ResortStatus | null,
  currentTime: Date = new Date()
): EnrichedRunData[] {
  let matchedCount = 0;
  const unmatchedRuns: string[] = [];

  const result = runs.map(run => {
    const enriched: EnrichedRunData = {
      ...run,
      status: run.status as EnrichedRunData['status'],
    };

    if (resortStatus && run.osmId) {
      const liveStatus = matchRunStatus(run.osmId, run.name, resortStatus.runs);
      if (liveStatus) {
        matchedCount++;
        enriched.liveStatus = liveStatus;
        enriched.status = normalizeStatus(liveStatus.status);

        // Extract closing time
        if (liveStatus.openingTimes && liveStatus.openingTimes.length > 0) {
          enriched.closingTime = liveStatus.openingTimes[0].endTime;
          enriched.minutesUntilClose = getMinutesUntilClose(enriched.closingTime, currentTime);
        }
      } else {
        unmatchedRuns.push(`${run.name || 'unnamed'}(${run.osmId})`);
      }
    }

    return enriched;
  });

  console.log('[LiftStatus Client] enrichRunsWithStatus:', {
    totalRuns: runs.length,
    hasResortStatus: !!resortStatus,
    statusRuns: resortStatus?.runs?.length || 0,
    matched: matchedCount,
    unmatched: unmatchedRuns.length,
    unmatchedSample: unmatchedRuns.slice(0, 3),
  });

  return result;
}

/**
 * Get summary stats from resort status
 */
export interface ResortStatusSummary {
  totalLifts: number;
  openLifts: number;
  closedLifts: number;
  totalRuns: number;
  openRuns: number;
  closedRuns: number;
  lastUpdated: Date;
}

export function getResortStatusSummary(status: ResortStatus | null): ResortStatusSummary | null {
  if (!status) return null;

  return {
    totalLifts: status.lifts.length,
    openLifts: status.lifts.filter(l => l.status === 'open').length,
    closedLifts: status.lifts.filter(l => l.status === 'closed').length,
    totalRuns: status.runs.length,
    openRuns: status.runs.filter(r => r.status === 'open').length,
    closedRuns: status.runs.filter(r => r.status === 'closed').length,
    lastUpdated: new Date(status.fetchedAt),
  };
}

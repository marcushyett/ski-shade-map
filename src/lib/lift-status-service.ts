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
import type { LiftData, RunData } from './types';

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
  if (supportedResortsCache) return supportedResortsCache;

  try {
    const response = await fetch('/api/lift-status/supported');
    if (!response.ok) {
      throw new Error('Failed to fetch supported resorts');
    }

    supportedResortsCache = await response.json();
    return supportedResortsCache || [];
  } catch (error) {
    console.error('Failed to get supported resorts:', error);
    return [];
  }
}

/**
 * Check if a ski area has live status data available
 */
export async function hasLiveStatus(openskimapId: string): Promise<boolean> {
  const resorts = await getSupportedResorts();
  return resorts.some(r => {
    if (Array.isArray(r.openskimapId)) {
      return r.openskimapId.includes(openskimapId);
    }
    return r.openskimapId === openskimapId;
  });
}

/**
 * Fetch resort status via API (with client-side caching)
 */
export async function fetchResortStatus(openskimapId: string): Promise<ResortStatus | null> {
  // Check client-side cache first
  const cached = await getCachedStatus(openskimapId);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(`/api/lift-status/${encodeURIComponent(openskimapId)}`);

    if (!response.ok) {
      if (response.status === 404) {
        // Resort not supported
        return null;
      }
      throw new Error('Failed to fetch resort status');
    }

    const data: ResortStatus = await response.json();

    // Cache the result client-side
    await cacheStatus(openskimapId, data);

    return data;
  } catch (error) {
    console.error('Failed to fetch resort status:', error);
    return null;
  }
}

/**
 * Match lift status to a lift by OpenSkiMap ID
 */
function matchLiftStatus(liftId: string, liftStatuses: LiftStatus[]): LiftStatus | undefined {
  return liftStatuses.find(s => s.openskimapIds.includes(liftId));
}

/**
 * Match run status to a run by OpenSkiMap ID
 */
function matchRunStatus(runId: string, runStatuses: RunStatus[]): RunStatus | undefined {
  return runStatuses.find(s => s.openskimapIds.includes(runId));
}

/**
 * Enrich lifts with live status data
 */
export function enrichLiftsWithStatus(
  lifts: LiftData[],
  resortStatus: ResortStatus | null,
  currentTime: Date = new Date()
): EnrichedLiftData[] {
  return lifts.map(lift => {
    const enriched: EnrichedLiftData = {
      ...lift,
      status: lift.status as EnrichedLiftData['status'],
    };

    if (resortStatus) {
      const liveStatus = matchLiftStatus(lift.id, resortStatus.lifts);
      if (liveStatus) {
        enriched.liveStatus = liveStatus;
        enriched.status = liveStatus.status;

        // Extract closing time
        if (liveStatus.openingTimes && liveStatus.openingTimes.length > 0) {
          enriched.closingTime = liveStatus.openingTimes[0].endTime;
          enriched.minutesUntilClose = getMinutesUntilClose(enriched.closingTime, currentTime);
        }
      }
    }

    return enriched;
  });
}

/**
 * Enrich runs with live status data
 */
export function enrichRunsWithStatus(
  runs: RunData[],
  resortStatus: ResortStatus | null,
  currentTime: Date = new Date()
): EnrichedRunData[] {
  return runs.map(run => {
    const enriched: EnrichedRunData = {
      ...run,
      status: run.status as EnrichedRunData['status'],
    };

    if (resortStatus) {
      const liveStatus = matchRunStatus(run.id, resortStatus.runs);
      if (liveStatus) {
        enriched.liveStatus = liveStatus;
        enriched.status = liveStatus.status;

        // Extract closing time
        if (liveStatus.openingTimes && liveStatus.openingTimes.length > 0) {
          enriched.closingTime = liveStatus.openingTimes[0].endTime;
          enriched.minutesUntilClose = getMinutesUntilClose(enriched.closingTime, currentTime);
        }
      }
    }

    return enriched;
  });
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

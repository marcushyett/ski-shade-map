/**
 * Geometry Cache for Ski Run Segments
 * 
 * Precomputes static geometry data (bearing, slope aspect, colors) for all runs
 * in the background using requestIdleCallback to avoid blocking the main thread.
 * 
 * Benefits:
 * - Shade calculations only need to check isShaded based on sun position
 * - No GeoJSON recreation on every time slider movement
 * - Lazy computation doesn't slow down initial load
 */

import type { RunData } from './types';
import { getDifficultyColorSunny, getDifficultyColorShaded } from './shade-calculator';

export interface PrecomputedSegment {
  runId: string;
  runName: string | null;
  difficulty: string | null;
  segmentIndex: number;
  coordinates: [number, number][];
  bearing: number;
  slopeAspect: number;
  sunnyColor: string;
  shadedColor: string;
}

export interface GeometryCache {
  segments: Map<string, PrecomputedSegment[]>;
  isComplete: boolean;
  processedCount: number;
  totalCount: number;
}

// Singleton cache per ski area
const cacheBySkiArea = new Map<string, GeometryCache>();

// Track active computation to cancel if ski area changes
let activeComputationId: string | null = null;
let computationAborted = false;

/**
 * Calculate bearing between two coordinates
 */
function calculateBearing(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/**
 * Process a single run and return its precomputed segments
 */
function processRun(run: RunData): PrecomputedSegment[] {
  if (run.geometry.type !== 'LineString') return [];
  
  const coords = run.geometry.coordinates;
  if (coords.length < 2) return [];
  
  const segments: PrecomputedSegment[] = [];
  const sunnyColor = getDifficultyColorSunny(run.difficulty);
  const shadedColor = getDifficultyColorShaded(run.difficulty);
  
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    
    const bearing = calculateBearing(lng1, lat1, lng2, lat2);
    const slopeAspect = (bearing + 90) % 360;
    
    segments.push({
      runId: run.id,
      runName: run.name,
      difficulty: run.difficulty,
      segmentIndex: i,
      coordinates: [[lng1, lat1], [lng2, lat2]],
      bearing,
      slopeAspect,
      sunnyColor,
      shadedColor,
    });
  }
  
  return segments;
}

/**
 * Process runs in batches using requestIdleCallback for non-blocking computation
 */
function processRunsBatch(
  runs: RunData[],
  skiAreaId: string,
  cache: GeometryCache,
  startIndex: number,
  batchSize: number,
  onProgress?: (processed: number, total: number) => void
): void {
  // Check if computation was aborted (ski area changed)
  if (computationAborted || activeComputationId !== skiAreaId) {
    return;
  }
  
  const endIndex = Math.min(startIndex + batchSize, runs.length);
  
  // Process this batch
  for (let i = startIndex; i < endIndex; i++) {
    const run = runs[i];
    const segments = processRun(run);
    if (segments.length > 0) {
      cache.segments.set(run.id, segments);
    }
    cache.processedCount++;
  }
  
  // Report progress
  onProgress?.(cache.processedCount, cache.totalCount);
  
  // If more to process, schedule next batch
  if (endIndex < runs.length) {
    // Use requestIdleCallback if available, otherwise setTimeout
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(
        () => processRunsBatch(runs, skiAreaId, cache, endIndex, batchSize, onProgress),
        { timeout: 500 } // Max wait 500ms before forcing execution
      );
    } else {
      // Fallback for browsers without requestIdleCallback
      setTimeout(
        () => processRunsBatch(runs, skiAreaId, cache, endIndex, batchSize, onProgress),
        16 // ~1 frame
      );
    }
  } else {
    // Computation complete
    cache.isComplete = true;
  }
}

/**
 * Start lazy background precomputation of geometry for a ski area
 * Returns immediately with an empty cache that fills in the background
 */
export function startGeometryPrecomputation(
  skiAreaId: string,
  runs: RunData[],
  onProgress?: (processed: number, total: number) => void
): GeometryCache {
  const lineStringCount = runs.filter(r => r.geometry.type === 'LineString').length;

  // Check if already cached and complete WITH the same number of runs
  const existing = cacheBySkiArea.get(skiAreaId);
  if (existing?.isComplete && existing.totalCount === lineStringCount && lineStringCount > 0) {
    return existing;
  }

  // If runs count changed (e.g., empty -> loaded), clear and recreate
  if (existing && existing.totalCount !== lineStringCount) {
    cacheBySkiArea.delete(skiAreaId);
  }

  // Abort any active computation for a different ski area
  if (activeComputationId && activeComputationId !== skiAreaId) {
    computationAborted = true;
  }

  // If already computing for this ski area with same count, return the in-progress cache
  const currentCache = cacheBySkiArea.get(skiAreaId);
  if (currentCache && activeComputationId === skiAreaId) {
    return currentCache;
  }

  // Skip cache creation for empty runs - no point caching nothing
  if (lineStringCount === 0) {
    return {
      segments: new Map(),
      isComplete: false,
      processedCount: 0,
      totalCount: 0,
    };
  }

  // Create new cache
  const cache: GeometryCache = {
    segments: new Map(),
    isComplete: false,
    processedCount: 0,
    totalCount: lineStringCount,
  };
  
  cacheBySkiArea.set(skiAreaId, cache);
  
  // Start background computation
  activeComputationId = skiAreaId;
  computationAborted = false;
  
  // Process in small batches (10 runs at a time) to avoid blocking
  // Use requestIdleCallback for truly non-blocking operation
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(
      () => processRunsBatch(runs, skiAreaId, cache, 0, 10, onProgress),
      { timeout: 1000 } // Allow up to 1s before forcing first batch
    );
  } else {
    // Fallback: use setTimeout with a small delay
    setTimeout(
      () => processRunsBatch(runs, skiAreaId, cache, 0, 10, onProgress),
      100 // Start after 100ms to let initial render complete
    );
  }
  
  return cache;
}

/**
 * Get cached geometry for a ski area
 * Returns null if not yet cached
 */
export function getGeometryCache(skiAreaId: string): GeometryCache | null {
  return cacheBySkiArea.get(skiAreaId) || null;
}

/**
 * Check if a run's geometry is cached
 */
export function isRunCached(skiAreaId: string, runId: string): boolean {
  const cache = cacheBySkiArea.get(skiAreaId);
  return cache?.segments.has(runId) ?? false;
}

/**
 * Get cached segments for a specific run
 * Returns null if not cached (caller should compute on-demand)
 */
export function getCachedSegments(skiAreaId: string, runId: string): PrecomputedSegment[] | null {
  const cache = cacheBySkiArea.get(skiAreaId);
  return cache?.segments.get(runId) || null;
}

/**
 * Calculate if a segment is shaded based on precomputed slope aspect
 * This is the fast operation that runs on every time change
 */
export function calculateSegmentShadeFromCache(
  slopeAspect: number,
  sunAzimuth: number,
  sunAltitude: number
): boolean {
  if (sunAltitude <= 0) return true;

  let angleDiff = Math.abs(sunAzimuth - slopeAspect);
  if (angleDiff > 180) angleDiff = 360 - angleDiff;

  const shadedByOrientation = angleDiff > 90;
  const shadedByLowSun = sunAltitude < 15 && angleDiff > 60;

  return shadedByOrientation || shadedByLowSun;
}

/**
 * Generate GeoJSON from cached geometry with current shade state
 * Much faster than recreating all geometry data
 */
export function generateShadedGeoJSON(
  cache: GeometryCache,
  sunAzimuth: number,
  sunAltitude: number
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  
  cache.segments.forEach((segments) => {
    for (const segment of segments) {
      const isShaded = calculateSegmentShadeFromCache(
        segment.slopeAspect,
        sunAzimuth,
        sunAltitude
      );
      
      features.push({
        type: 'Feature',
        properties: {
          runId: segment.runId,
          runName: segment.runName,
          difficulty: segment.difficulty,
          segmentIndex: segment.segmentIndex,
          isShaded,
          bearing: segment.bearing,
          slopeAspect: segment.slopeAspect,
          sunnyColor: segment.sunnyColor,
          shadedColor: segment.shadedColor,
        },
        geometry: {
          type: 'LineString',
          coordinates: segment.coordinates,
        },
      });
    }
  });
  
  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Clear cache for a specific ski area
 */
export function clearGeometryCache(skiAreaId: string): void {
  cacheBySkiArea.delete(skiAreaId);
  if (activeComputationId === skiAreaId) {
    computationAborted = true;
    activeComputationId = null;
  }
}

/**
 * Clear all cached geometry
 */
export function clearAllGeometryCache(): void {
  cacheBySkiArea.clear();
  computationAborted = true;
  activeComputationId = null;
}


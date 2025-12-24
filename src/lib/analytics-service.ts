/**
 * Analytics service for collecting and storing resort status data
 * Fetches status data from all supported resorts and stores it in the ResortStatusAnalytics table
 */

import { createHash } from 'crypto';
import { getSupportedResorts, fetchResortStatus } from 'ski-resort-status';
import { prisma } from './prisma';
import type { LiftStatus, RunStatus } from './lift-status-types';
import {
  trackLiftStatus,
  trackRunStatus,
  trackCollectionCompleted,
  flushPostHogEvents,
} from './posthog-server';

interface SupportedResort {
  id: string;
  name: string;
  openskimap_id: string | string[];
  platform: string;
}

interface RawLift {
  name: string;
  status: string;
  liftType: string;
  openskimap_ids?: string[];
  capacity?: number;
  duration?: number;
  length?: number;
  uphillCapacity?: number;
  speed?: number;
  arrivalAltitude?: number;
  departureAltitude?: number;
  openingTimesTheoretic?: Array<{ beginTime: string; endTime: string }>;
  operating?: boolean;
  openingStatus?: string;
  message?: string;
  waitingTime?: number;
}

interface RawRun {
  name: string;
  status: string;
  trailType?: string;
  level?: string;
  openskimap_ids?: string[];
  length?: number;
  arrivalAltitude?: number;
  departureAltitude?: number;
  guaranteedSnow?: boolean;
  openingTimesTheoretic?: Array<{ beginTime: string; endTime: string }>;
  operating?: boolean;
  openingStatus?: string;
  groomingStatus?: string;
  snowQuality?: string;
  message?: string;
}

interface RawResortStatus {
  resort: {
    id: string;
    name: string;
    openskimap_id: string | string[];
  };
  lifts: RawLift[];
  runs: RawRun[];
}

export interface CollectionResult {
  success: boolean;
  resortsProcessed: number;
  recordsCreated: number;
  recordsSkipped: number;
  errors: string[];
  duration: number;
}

/**
 * Transform raw lift data to our LiftStatus type
 */
function transformLift(lift: RawLift): LiftStatus {
  return {
    name: lift.name,
    status: lift.status as LiftStatus['status'],
    liftType: lift.liftType,
    openskimapIds: lift.openskimap_ids || [],
    capacity: lift.capacity,
    duration: lift.duration,
    length: lift.length,
    uphillCapacity: lift.uphillCapacity,
    speed: lift.speed,
    arrivalAltitude: lift.arrivalAltitude,
    departureAltitude: lift.departureAltitude,
    openingTimes: lift.openingTimesTheoretic,
    operating: lift.operating,
    openingStatus: lift.openingStatus,
    message: lift.message,
    waitingTime: lift.waitingTime,
  };
}

/**
 * Transform raw run data to our RunStatus type
 */
function transformRun(run: RawRun): RunStatus {
  return {
    name: run.name,
    status: run.status as RunStatus['status'],
    trailType: run.trailType,
    level: run.level,
    openskimapIds: run.openskimap_ids || [],
    length: run.length,
    arrivalAltitude: run.arrivalAltitude,
    departureAltitude: run.departureAltitude,
    guaranteedSnow: run.guaranteedSnow,
    openingTimes: run.openingTimesTheoretic,
    operating: run.operating,
    openingStatus: run.openingStatus,
    groomingStatus: run.groomingStatus as RunStatus['groomingStatus'],
    snowQuality: run.snowQuality as RunStatus['snowQuality'],
    message: run.message,
  };
}

/**
 * Compute MD5 hash of a JSON object for efficient comparison.
 * Returns 32-byte hex string instead of storing full ~10KB JSON blobs.
 */
function hashStatus(statusInfo: object): string {
  return createHash('md5').update(JSON.stringify(statusInfo)).digest('hex');
}

/**
 * Fetch the latest status hash for each asset of a resort in a single efficient query.
 * Uses PostgreSQL DISTINCT ON to get the most recent record per (assetType, assetId).
 * Returns a Map keyed by "assetType:assetId" with MD5 hash values (~32 bytes each vs ~10KB).
 *
 * Note: We query the stored statusHash column (computed in Node.js at insert time)
 * rather than computing MD5 in PostgreSQL to ensure consistent hash comparison.
 */
async function getLatestStatusHashMap(resortId: string): Promise<Map<string, string>> {
  const results = await prisma.$queryRaw<Array<{ assetType: string; assetId: string; statusHash: string | null }>>`
    SELECT DISTINCT ON ("assetType", "assetId")
      "assetType", "assetId", "statusHash"
    FROM "ResortStatusAnalytics"
    WHERE "resortId" = ${resortId}
    ORDER BY "assetType", "assetId", "collectedAt" DESC
  `;

  const statusMap = new Map<string, string>();
  for (const row of results) {
    // Only add to map if statusHash exists (records before migration won't have it)
    if (row.statusHash) {
      const key = `${row.assetType}:${row.assetId}`;
      statusMap.set(key, row.statusHash);
    }
  }
  return statusMap;
}

/**
 * Check if status has changed by comparing MD5 hashes.
 * Returns true if the new status is different from the previous one.
 */
function hasStatusChanged(newHash: string, previousHash: string | undefined): boolean {
  if (!previousHash) return true; // No previous record, this is a new asset
  return newHash !== previousHash;
}

/**
 * Collect status data from all supported resorts and store in analytics table.
 * Only creates new records when the status has actually changed (event-based storage).
 */
export async function collectAllResortStatus(): Promise<CollectionResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let resortsProcessed = 0;
  let recordsCreated = 0;
  let recordsSkipped = 0;

  try {
    // Get all supported resorts
    const resorts = getSupportedResorts() as SupportedResort[];
    console.log(`[Analytics] Starting collection for ${resorts.length} resorts`);

    const collectedAt = new Date();

    // Process each resort
    for (const resort of resorts) {
      try {
        // Fetch latest status hash map and new data in parallel
        const [latestHashMap, rawData] = await Promise.all([
          getLatestStatusHashMap(resort.id),
          fetchResortStatus(resort.id) as Promise<RawResortStatus>,
        ]);

        // Prepare records for batch insert (only changed records)
        const records: Array<{
          resortId: string;
          resortName: string;
          assetType: string;
          assetId: string;
          statusInfo: object;
          statusHash: string;
          collectedAt: Date;
        }> = [];

        let skippedForResort = 0;

        // Check lift records for changes using hash comparison
        for (const lift of rawData.lifts) {
          const statusInfo = transformLift(lift);
          const statusHash = hashStatus(statusInfo);
          const key = `lift:${lift.name}`;

          if (hasStatusChanged(statusHash, latestHashMap.get(key))) {
            records.push({
              resortId: resort.id,
              resortName: rawData.resort.name,
              assetType: 'lift',
              assetId: lift.name,
              statusInfo: statusInfo as object,
              statusHash,
              collectedAt,
            });

            // Track PostHog event for this lift (only when status changed)
            trackLiftStatus({
              resort_id: resort.id,
              resort_name: rawData.resort.name,
              lift_name: lift.name,
              lift_status: lift.status,
              lift_type: lift.liftType,
              is_operating: lift.operating,
              opening_status: lift.openingStatus,
              waiting_time: lift.waitingTime,
              capacity: lift.capacity,
              length: lift.length,
              arrival_altitude: lift.arrivalAltitude,
              departure_altitude: lift.departureAltitude,
            });
          } else {
            skippedForResort++;
          }
        }

        // Check run records for changes using hash comparison
        for (const run of rawData.runs) {
          const statusInfo = transformRun(run);
          const statusHash = hashStatus(statusInfo);
          const key = `run:${run.name}`;

          if (hasStatusChanged(statusHash, latestHashMap.get(key))) {
            records.push({
              resortId: resort.id,
              resortName: rawData.resort.name,
              assetType: 'run',
              assetId: run.name,
              statusInfo: statusInfo as object,
              statusHash,
              collectedAt,
            });

            // Track PostHog event for this run (only when status changed)
            trackRunStatus({
              resort_id: resort.id,
              resort_name: rawData.resort.name,
              run_name: run.name,
              run_status: run.status,
              run_level: run.level,
              trail_type: run.trailType,
              is_operating: run.operating,
              opening_status: run.openingStatus,
              grooming_status: run.groomingStatus,
              snow_quality: run.snowQuality,
              length: run.length,
              arrival_altitude: run.arrivalAltitude,
              departure_altitude: run.departureAltitude,
              guaranteed_snow: run.guaranteedSnow,
            });
          } else {
            skippedForResort++;
          }
        }

        // Batch insert only changed records
        if (records.length > 0) {
          await prisma.resortStatusAnalytics.createMany({
            data: records,
          });
          recordsCreated += records.length;
        }

        recordsSkipped += skippedForResort;
        resortsProcessed++;

        const totalAssets = rawData.lifts.length + rawData.runs.length;
        console.log(
          `[Analytics] ${resort.name}: ${records.length} changes, ${skippedForResort} unchanged (${totalAssets} total assets)`
        );
      } catch (error) {
        const errorMessage = `Failed to process ${resort.name} (${resort.id}): ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[Analytics] ${errorMessage}`);
        errors.push(errorMessage);
      }
    }

    const duration = Date.now() - startTime;
    const efficiency = recordsSkipped + recordsCreated > 0
      ? Math.round((recordsSkipped / (recordsSkipped + recordsCreated)) * 100)
      : 0;
    console.log(
      `[Analytics] Collection complete: ${resortsProcessed}/${resorts.length} resorts, ${recordsCreated} new records, ${recordsSkipped} skipped (${efficiency}% dedup) in ${duration}ms`
    );

    // Track collection completion in PostHog
    trackCollectionCompleted({
      resorts_processed: resortsProcessed,
      records_created: recordsCreated,
      duration_ms: duration,
      error_count: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    });

    // Flush all PostHog events before returning
    await flushPostHogEvents();

    return {
      success: errors.length === 0,
      resortsProcessed,
      recordsCreated,
      recordsSkipped,
      errors,
      duration,
    };
  } catch (error) {
    const errorMessage = `Collection failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`[Analytics] ${errorMessage}`);
    errors.push(errorMessage);

    // Flush any PostHog events that were captured before the error
    await flushPostHogEvents();

    return {
      success: false,
      resortsProcessed,
      recordsCreated,
      recordsSkipped,
      errors,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Get collection statistics
 */
export async function getCollectionStats() {
  const [totalRecords, latestCollection, oldestCollection, resortCount] = await Promise.all([
    prisma.resortStatusAnalytics.count(),
    prisma.resortStatusAnalytics.findFirst({
      orderBy: { collectedAt: 'desc' },
      select: { collectedAt: true },
    }),
    prisma.resortStatusAnalytics.findFirst({
      orderBy: { collectedAt: 'asc' },
      select: { collectedAt: true },
    }),
    prisma.resortStatusAnalytics.groupBy({
      by: ['resortId'],
    }),
  ]);

  return {
    totalRecords,
    latestCollection: latestCollection?.collectedAt,
    oldestCollection: oldestCollection?.collectedAt,
    uniqueResorts: resortCount.length,
  };
}

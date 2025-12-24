/**
 * Analytics service for collecting and storing resort status data
 * Fetches status data from all supported resorts and stores it in the ResortStatusAnalytics table
 */

import { getSupportedResorts, fetchResortStatus } from 'ski-resort-status';
import { prisma } from './prisma';
import type { LiftStatus, RunStatus } from './lift-status-types';

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
 * Fetch the latest status for each asset of a resort in a single efficient query.
 * Uses PostgreSQL DISTINCT ON to get the most recent record per (assetType, assetId).
 * Returns a Map keyed by "assetType:assetId" for O(1) lookup.
 */
async function getLatestStatusMap(resortId: string): Promise<Map<string, string>> {
  const results = await prisma.$queryRaw<Array<{ assetType: string; assetId: string; statusInfo: unknown }>>`
    SELECT DISTINCT ON ("assetType", "assetId")
      "assetType", "assetId", "statusInfo"
    FROM "ResortStatusAnalytics"
    WHERE "resortId" = ${resortId}
    ORDER BY "assetType", "assetId", "collectedAt" DESC
  `;

  const statusMap = new Map<string, string>();
  for (const row of results) {
    const key = `${row.assetType}:${row.assetId}`;
    // Store JSON string for efficient comparison
    statusMap.set(key, JSON.stringify(row.statusInfo));
  }
  return statusMap;
}

/**
 * Check if status has changed by comparing JSON string representations.
 * Returns true if the new status is different from the previous one.
 */
function hasStatusChanged(newStatusJson: string, previousStatusJson: string | undefined): boolean {
  if (!previousStatusJson) return true; // No previous record, this is a new asset
  return newStatusJson !== previousStatusJson;
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
        // Fetch latest status map and new data in parallel
        const [latestStatusMap, rawData] = await Promise.all([
          getLatestStatusMap(resort.id),
          fetchResortStatus(resort.id) as Promise<RawResortStatus>,
        ]);

        // Prepare records for batch insert (only changed records)
        const records: Array<{
          resortId: string;
          resortName: string;
          assetType: string;
          assetId: string;
          statusInfo: object;
          collectedAt: Date;
        }> = [];

        let skippedForResort = 0;

        // Check lift records for changes
        for (const lift of rawData.lifts) {
          const statusInfo = transformLift(lift);
          const statusJson = JSON.stringify(statusInfo);
          const key = `lift:${lift.name}`;

          if (hasStatusChanged(statusJson, latestStatusMap.get(key))) {
            records.push({
              resortId: resort.id,
              resortName: rawData.resort.name,
              assetType: 'lift',
              assetId: lift.name,
              statusInfo: statusInfo as object,
              collectedAt,
            });
          } else {
            skippedForResort++;
          }
        }

        // Check run records for changes
        for (const run of rawData.runs) {
          const statusInfo = transformRun(run);
          const statusJson = JSON.stringify(statusInfo);
          const key = `run:${run.name}`;

          if (hasStatusChanged(statusJson, latestStatusMap.get(key))) {
            records.push({
              resortId: resort.id,
              resortName: rawData.resort.name,
              assetType: 'run',
              assetId: run.name,
              statusInfo: statusInfo as object,
              collectedAt,
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

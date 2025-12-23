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
 * Collect status data from all supported resorts and store in analytics table
 */
export async function collectAllResortStatus(): Promise<CollectionResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let resortsProcessed = 0;
  let recordsCreated = 0;

  try {
    // Get all supported resorts
    const resorts = getSupportedResorts() as SupportedResort[];
    console.log(`[Analytics] Starting collection for ${resorts.length} resorts`);

    const collectedAt = new Date();

    // Process each resort
    for (const resort of resorts) {
      try {
        const rawData = (await fetchResortStatus(resort.id)) as RawResortStatus;

        // Prepare records for batch insert
        const records: Array<{
          resortId: string;
          resortName: string;
          assetType: string;
          assetId: string;
          statusInfo: object;
          collectedAt: Date;
        }> = [];

        // Add lift records
        for (const lift of rawData.lifts) {
          const statusInfo = transformLift(lift);
          records.push({
            resortId: resort.id,
            resortName: rawData.resort.name,
            assetType: 'lift',
            assetId: lift.name,
            statusInfo: statusInfo as object,
            collectedAt,
          });
        }

        // Add run records
        for (const run of rawData.runs) {
          const statusInfo = transformRun(run);
          records.push({
            resortId: resort.id,
            resortName: rawData.resort.name,
            assetType: 'run',
            assetId: run.name,
            statusInfo: statusInfo as object,
            collectedAt,
          });
        }

        // Batch insert records
        if (records.length > 0) {
          await prisma.resortStatusAnalytics.createMany({
            data: records,
          });
          recordsCreated += records.length;
        }

        resortsProcessed++;
        console.log(
          `[Analytics] Processed ${resort.name}: ${rawData.lifts.length} lifts, ${rawData.runs.length} runs`
        );
      } catch (error) {
        const errorMessage = `Failed to process ${resort.name} (${resort.id}): ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[Analytics] ${errorMessage}`);
        errors.push(errorMessage);
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[Analytics] Collection complete: ${resortsProcessed}/${resorts.length} resorts, ${recordsCreated} records in ${duration}ms`
    );

    return {
      success: errors.length === 0,
      resortsProcessed,
      recordsCreated,
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

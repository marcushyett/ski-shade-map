/**
 * Analytics Query Service for Max Optimality
 *
 * Queries the ResortStatusAnalytics table to find runs and lifts
 * that have been open in the last 24 hours.
 */

import { prisma } from '../prisma';
import type { LiftStatus, RunStatus } from '../lift-status-types';
import type { AvailableRun, AvailableLift, SkiAreaWithAnalytics } from './types';
import type { RunDifficulty, SkiAreaDetails, RunData, LiftData } from '../types';
import { getSupportedResorts } from 'ski-resort-status';

// Map run levels from analytics to our difficulty types
function mapLevelToDifficulty(level: string | undefined): RunDifficulty {
  if (!level) return 'intermediate';
  const levelLower = level.toLowerCase();
  if (levelLower === 'green' || levelLower === 'novice') return 'novice';
  if (levelLower === 'blue' || levelLower === 'easy') return 'easy';
  if (levelLower === 'red' || levelLower === 'intermediate') return 'intermediate';
  if (levelLower === 'black' || levelLower === 'advanced') return 'advanced';
  if (levelLower === 'double black' || levelLower === 'expert') return 'expert';
  return 'intermediate';
}

// Speed constants (m/s) - same as navigation.ts
const SKIING_SPEEDS: Record<string, number> = {
  novice: 4,
  easy: 6,
  intermediate: 8,
  advanced: 10,
  expert: 12,
};

const LIFT_SPEEDS: Record<string, number> = {
  gondola: 6,
  cable_car: 10,
  chairlift: 3,
  'chair_lift': 3,
  drag_lift: 2,
  't-bar': 3,
  'j-bar': 3,
  magic_carpet: 0.8,
  platter: 2,
  rope_tow: 1.5,
  default: 3,
};

/**
 * Get all ski areas that are supported (have mapping to ski-resort-status)
 * Returns analytics data where available, but shows all supported areas
 */
export async function getSkiAreasWithAnalytics(): Promise<SkiAreaWithAnalytics[]> {
  // Get supported resorts from ski-resort-status
  interface SupportedResort {
    id: string;
    name: string;
    openskimap_id: string | string[];
    platform: string;
  }
  const supportedResorts = getSupportedResorts() as SupportedResort[];

  // Build mapping from OpenSkiMap ID to resort ID
  const openskimapToResort = new Map<string, string>();
  const allOpenskimapIds: string[] = [];

  for (const resort of supportedResorts) {
    const ids = Array.isArray(resort.openskimap_id)
      ? resort.openskimap_id
      : [resort.openskimap_id];
    for (const osmId of ids) {
      openskimapToResort.set(osmId, resort.id);
      allOpenskimapIds.push(osmId);
    }
  }

  // Get all ski areas that match any supported resort's OpenSkiMap IDs
  const skiAreas = await prisma.skiArea.findMany({
    where: {
      osmId: {
        in: allOpenskimapIds,
      },
    },
    select: {
      id: true,
      osmId: true,
      name: true,
      country: true,
      region: true,
      latitude: true,
      longitude: true,
    },
  });

  // Get analytics stats for resorts that have data
  const analyticsStats = await prisma.$queryRaw<
    Array<{
      resortId: string;
      resortName: string;
      runCount: bigint;
      liftCount: bigint;
      lastUpdate: Date;
    }>
  >`
    SELECT
      "resortId",
      "resortName",
      COUNT(DISTINCT CASE WHEN "assetType" = 'run' THEN "assetId" END) as "runCount",
      COUNT(DISTINCT CASE WHEN "assetType" = 'lift' THEN "assetId" END) as "liftCount",
      MAX("collectedAt") as "lastUpdate"
    FROM "ResortStatusAnalytics"
    GROUP BY "resortId", "resortName"
    HAVING COUNT(DISTINCT "assetId") > 0
  `;

  // Create a map of resort ID to analytics data
  const analyticsMap = new Map<
    string,
    { runCount: number; liftCount: number; lastUpdate: Date }
  >();
  for (const stats of analyticsStats) {
    analyticsMap.set(stats.resortId, {
      runCount: Number(stats.runCount),
      liftCount: Number(stats.liftCount),
      lastUpdate: stats.lastUpdate,
    });
  }

  // Build the result from all matched ski areas
  const result: SkiAreaWithAnalytics[] = [];

  for (const skiArea of skiAreas) {
    if (!skiArea.osmId) continue;

    const resortId = openskimapToResort.get(skiArea.osmId);
    if (!resortId) continue;

    const analytics = analyticsMap.get(resortId);

    result.push({
      id: skiArea.id,
      osmId: skiArea.osmId,
      name: skiArea.name,
      country: skiArea.country,
      region: skiArea.region,
      latitude: skiArea.latitude,
      longitude: skiArea.longitude,
      analyticsRunCount: analytics?.runCount ?? 0,
      analyticsLiftCount: analytics?.liftCount ?? 0,
      lastAnalyticsUpdate: analytics?.lastUpdate ?? null,
      resortId: resortId,
    });
  }

  // Sort by name
  result.sort((a, b) => a.name.localeCompare(b.name));

  return result;
}

/**
 * Get the resort ID for a ski area (via OpenSkiMap ID mapping)
 */
export async function getResortIdForSkiArea(skiAreaId: string): Promise<string | null> {
  const skiArea = await prisma.skiArea.findUnique({
    where: { id: skiAreaId },
    select: { osmId: true },
  });

  if (!skiArea?.osmId) return null;

  interface SupportedResort {
    id: string;
    name: string;
    openskimap_id: string | string[];
    platform: string;
  }
  const supportedResorts = getSupportedResorts() as SupportedResort[];

  for (const resort of supportedResorts) {
    const ids = Array.isArray(resort.openskimap_id)
      ? resort.openskimap_id
      : [resort.openskimap_id];
    if (ids.includes(skiArea.osmId)) {
      return resort.id;
    }
  }

  return null;
}

/**
 * Get runs that have been open in the last 24 hours from analytics
 */
export async function getOpenRunsFromAnalytics(
  resortId: string,
  skiAreaDetails: SkiAreaDetails,
  difficulties: RunDifficulty[]
): Promise<AvailableRun[]> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Get latest status for each run in the last 24 hours
  const analyticsRecords = await prisma.$queryRaw<
    Array<{
      assetId: string;
      statusInfo: unknown;
      collectedAt: Date;
    }>
  >`
    SELECT DISTINCT ON ("assetId")
      "assetId",
      "statusInfo",
      "collectedAt"
    FROM "ResortStatusAnalytics"
    WHERE "resortId" = ${resortId}
      AND "assetType" = 'run'
      AND "collectedAt" >= ${twentyFourHoursAgo}
    ORDER BY "assetId", "collectedAt" DESC
  `;

  // Filter for runs that were open
  const openRunNames = new Set<string>();
  const runStatusMap = new Map<string, { status: RunStatus; collectedAt: Date }>();

  for (const record of analyticsRecords) {
    const statusInfo = record.statusInfo as RunStatus;
    const status = statusInfo.status?.toLowerCase();

    if (status === 'open') {
      openRunNames.add(record.assetId);
      runStatusMap.set(record.assetId, {
        status: statusInfo,
        collectedAt: record.collectedAt,
      });
    }
  }

  // Match analytics runs to ski area runs
  const availableRuns: AvailableRun[] = [];

  for (const run of skiAreaDetails.runs) {
    // Match by name (case-insensitive)
    const runName = run.name?.toLowerCase();
    const matchingAnalyticsName = [...openRunNames].find(
      (name) => name.toLowerCase() === runName
    );

    if (matchingAnalyticsName) {
      // Check if difficulty matches filter
      const runDifficulty = run.difficulty || 'intermediate';
      if (!difficulties.includes(runDifficulty)) continue;

      const analyticsData = runStatusMap.get(matchingAnalyticsName);

      // Calculate estimated time based on run geometry
      const coords = getRunCoordinates(run);
      const distance = calculateDistance(coords);
      const elevationChange = calculateElevationChange(coords);
      const speed = SKIING_SPEEDS[runDifficulty] || 8;
      const estimatedTime = distance / speed;

      availableRuns.push({
        id: run.id,
        osmId: run.osmId || null,
        name: run.name,
        difficulty: runDifficulty,
        estimatedTime,
        distance,
        elevationChange,
        lastStatus: 'open',
        statusRecordedAt: analyticsData?.collectedAt || new Date(),
      });
    }
  }

  return availableRuns;
}

/**
 * Get lifts that have been open in the last 24 hours from analytics
 */
export async function getOpenLiftsFromAnalytics(
  resortId: string,
  skiAreaDetails: SkiAreaDetails
): Promise<AvailableLift[]> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Get latest status for each lift in the last 24 hours
  const analyticsRecords = await prisma.$queryRaw<
    Array<{
      assetId: string;
      statusInfo: unknown;
      collectedAt: Date;
    }>
  >`
    SELECT DISTINCT ON ("assetId")
      "assetId",
      "statusInfo",
      "collectedAt"
    FROM "ResortStatusAnalytics"
    WHERE "resortId" = ${resortId}
      AND "assetType" = 'lift'
      AND "collectedAt" >= ${twentyFourHoursAgo}
    ORDER BY "assetId", "collectedAt" DESC
  `;

  // Filter for lifts that were open
  const openLiftNames = new Set<string>();
  const liftStatusMap = new Map<string, { status: LiftStatus; collectedAt: Date }>();

  for (const record of analyticsRecords) {
    const statusInfo = record.statusInfo as LiftStatus;
    const status = statusInfo.status?.toLowerCase();

    if (status === 'open') {
      openLiftNames.add(record.assetId);
      liftStatusMap.set(record.assetId, {
        status: statusInfo,
        collectedAt: record.collectedAt,
      });
    }
  }

  // Match analytics lifts to ski area lifts
  const availableLifts: AvailableLift[] = [];

  for (const lift of skiAreaDetails.lifts) {
    // Match by name (case-insensitive)
    const liftName = lift.name?.toLowerCase();
    const matchingAnalyticsName = [...openLiftNames].find(
      (name) => name.toLowerCase() === liftName
    );

    if (matchingAnalyticsName) {
      const analyticsData = liftStatusMap.get(matchingAnalyticsName);
      const liftStatus = analyticsData?.status;

      // Calculate estimated time based on lift geometry
      const coords = getLiftCoordinates(lift);
      const distance = calculateDistance(coords);
      const elevationChange = calculateElevationChange(coords);
      const liftType = lift.liftType || 'chairlift';
      const speed = LIFT_SPEEDS[liftType] || LIFT_SPEEDS.default;
      const estimatedTime = distance / speed;

      // Get opening/closing times from analytics if available
      let openingTime: string | undefined;
      let closingTime: string | undefined;
      if (liftStatus?.openingTimes && liftStatus.openingTimes.length > 0) {
        openingTime = liftStatus.openingTimes[0].beginTime;
        closingTime = liftStatus.openingTimes[0].endTime;
      }

      availableLifts.push({
        id: lift.id,
        osmId: lift.osmId || null,
        name: lift.name,
        liftType: lift.liftType,
        estimatedTime,
        distance,
        elevationChange: Math.abs(elevationChange), // Lifts go up, so positive
        openingTime,
        closingTime,
        lastStatus: 'open',
        statusRecordedAt: analyticsData?.collectedAt || new Date(),
      });
    }
  }

  return availableLifts;
}

/**
 * Get lift operating hours from analytics
 */
export async function getLiftOperatingHours(
  resortId: string
): Promise<{ openTime: string; closeTime: string } | null> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Get a lift with opening times from analytics
  const record = await prisma.resortStatusAnalytics.findFirst({
    where: {
      resortId,
      assetType: 'lift',
      collectedAt: {
        gte: twentyFourHoursAgo,
      },
    },
    orderBy: {
      collectedAt: 'desc',
    },
  });

  if (!record) return null;

  const statusInfo = record.statusInfo as unknown as LiftStatus;
  if (statusInfo.openingTimes && statusInfo.openingTimes.length > 0) {
    return {
      openTime: statusInfo.openingTimes[0].beginTime,
      closeTime: statusInfo.openingTimes[0].endTime,
    };
  }

  // Default operating hours
  return { openTime: '09:00', closeTime: '16:30' };
}

// Helper functions for geometry calculations

function getRunCoordinates(run: RunData): [number, number, number?][] {
  const geometry = run.geometry;
  if (geometry.type === 'LineString') {
    return geometry.coordinates as [number, number, number?][];
  } else if (geometry.type === 'Polygon') {
    // Use the outer ring
    return geometry.coordinates[0] as [number, number, number?][];
  }
  return [];
}

function getLiftCoordinates(lift: LiftData): [number, number, number?][] {
  return lift.geometry.coordinates as [number, number, number?][];
}

function calculateDistance(coords: [number, number, number?][]): number {
  let totalDistance = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    totalDistance += haversineDistance(lat1, lng1, lat2, lng2);
  }
  return totalDistance;
}

function calculateElevationChange(coords: [number, number, number?][]): number {
  if (coords.length < 2) return 0;
  const startElev = coords[0][2] || 0;
  const endElev = coords[coords.length - 1][2] || 0;
  return endElev - startElev;
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

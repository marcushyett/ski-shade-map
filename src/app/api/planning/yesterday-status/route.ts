import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSupportedResorts } from 'ski-resort-status';
import type { LiftStatus, RunStatus } from '@/lib/lift-status-types';

interface SupportedResort {
  id: string;
  name: string;
  openskimap_id: string | string[];
  platform: string;
}

/**
 * Get the resort ID for an OpenSkiMap ID
 * Matches the pattern used in lift-status API and analytics-query
 */
function getResortIdForOpenskimapId(openskimapId: string): string | null {
  const resorts = getSupportedResorts() as SupportedResort[];
  const resort = resorts.find((r) => {
    if (Array.isArray(r.openskimap_id)) {
      // Convert all IDs to strings for comparison (handles number vs string)
      const ids = r.openskimap_id.map((id) => String(id));
      return ids.includes(openskimapId);
    }
    return String(r.openskimap_id) === openskimapId;
  });
  return resort?.id || null;
}

/**
 * GET /api/planning/yesterday-status?osmId=<openskimap_id>
 *
 * Returns runs and lifts that were open yesterday for the given ski area.
 * Used by Planning Mode to filter runs/lifts by historical availability.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const osmId = url.searchParams.get('osmId');

  if (!osmId) {
    return NextResponse.json(
      { error: 'Missing osmId parameter' },
      { status: 400 }
    );
  }

  // Get resort ID from OpenSkiMap ID
  const resortId = getResortIdForOpenskimapId(osmId);

  if (!resortId) {
    // Resort not supported - return empty response with hasData: false
    return NextResponse.json({
      hasData: false,
      date: getYesterdayDateString(),
      openRuns: [],
      openLifts: [],
    });
  }

  try {
    // Calculate yesterday's date range
    const now = new Date();
    const yesterdayStart = new Date(now);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0);

    const yesterdayEnd = new Date(yesterdayStart);
    yesterdayEnd.setDate(yesterdayEnd.getDate() + 1);

    // Query for latest status of each run from yesterday
    const runRecords = await prisma.$queryRaw<
      Array<{
        assetId: string;
        statusInfo: unknown;
      }>
    >`
      SELECT DISTINCT ON ("assetId")
        "assetId",
        "statusInfo"
      FROM "ResortStatusAnalytics"
      WHERE "resortId" = ${resortId}
        AND "assetType" = 'run'
        AND "collectedAt" >= ${yesterdayStart}
        AND "collectedAt" < ${yesterdayEnd}
      ORDER BY "assetId", "collectedAt" DESC
    `;

    // Query for latest status of each lift from yesterday
    const liftRecords = await prisma.$queryRaw<
      Array<{
        assetId: string;
        statusInfo: unknown;
      }>
    >`
      SELECT DISTINCT ON ("assetId")
        "assetId",
        "statusInfo"
      FROM "ResortStatusAnalytics"
      WHERE "resortId" = ${resortId}
        AND "assetType" = 'lift'
        AND "collectedAt" >= ${yesterdayStart}
        AND "collectedAt" < ${yesterdayEnd}
      ORDER BY "assetId", "collectedAt" DESC
    `;

    // Filter for assets that were open
    // Handle various status formats from the database
    const openRuns: string[] = [];
    for (const record of runRecords) {
      const statusInfo = record.statusInfo as RunStatus;
      // Handle both direct status and potential nested structures
      const status = (statusInfo?.status || '').toString().toLowerCase();
      // Also check openingStatus and operating flag as fallbacks
      const openingStatus = (statusInfo?.openingStatus || '').toString().toLowerCase();
      const isOperating = statusInfo?.operating === true;

      if (status === 'open' || openingStatus === 'open' || (isOperating && status !== 'closed')) {
        openRuns.push(record.assetId);
      }
    }

    const openLifts: string[] = [];
    for (const record of liftRecords) {
      const statusInfo = record.statusInfo as LiftStatus;
      const status = (statusInfo?.status || '').toString().toLowerCase();
      const openingStatus = (statusInfo?.openingStatus || '').toString().toLowerCase();
      const isOperating = statusInfo?.operating === true;

      if (status === 'open' || openingStatus === 'open' || (isOperating && status !== 'closed')) {
        openLifts.push(record.assetId);
      }
    }

    // Check if we have any data
    const hasData = runRecords.length > 0 || liftRecords.length > 0;

    return NextResponse.json({
      hasData,
      date: getYesterdayDateString(),
      openRuns,
      openLifts,
    });
  } catch (error) {
    console.error('[PlanningYesterdayStatus] Error querying analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch yesterday status' },
      { status: 500 }
    );
  }
}

/**
 * Get yesterday's date as a string (YYYY-MM-DD)
 */
function getYesterdayDateString(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

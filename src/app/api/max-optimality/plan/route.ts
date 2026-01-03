/**
 * API endpoint for Max Optimality route planning
 *
 * POST /api/max-optimality/plan
 *
 * Plans a route that covers the maximum number of runs in the selected
 * difficulty categories, optimized for sun exposure.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import type { SkiAreaDetails, RunData, LiftData, RunDifficulty } from '@/lib/types';
import type { PlanRequestBody } from '@/lib/max-optimality/types';
import {
  getResortIdForSkiArea,
  getOpenRunsFromAnalytics,
  getOpenLiftsFromAnalytics,
  getLiftOperatingHours,
} from '@/lib/max-optimality/analytics-query';
import { planMaxOptimalityRoute } from '@/lib/max-optimality/route-planner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60 seconds for planning

export async function POST(request: NextRequest) {
  try {
    const body: PlanRequestBody = await request.json();

    // Validate request
    if (!body.skiAreaId) {
      return NextResponse.json(
        { success: false, error: 'Ski area ID is required' },
        { status: 400 }
      );
    }

    if (!body.difficulties || body.difficulties.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one difficulty level is required' },
        { status: 400 }
      );
    }

    if (!body.homeLocation || typeof body.homeLocation.lat !== 'number') {
      return NextResponse.json(
        { success: false, error: 'Home location is required' },
        { status: 400 }
      );
    }

    if (!body.targetDate) {
      return NextResponse.json(
        { success: false, error: 'Target date is required' },
        { status: 400 }
      );
    }

    console.log('[Max Optimality] Starting plan for ski area:', body.skiAreaId);

    // Fetch ski area details
    const skiAreaRecord = await prisma.skiArea.findUnique({
      where: { id: body.skiAreaId },
      include: {
        runs: true,
        lifts: true,
      },
    });

    if (!skiAreaRecord) {
      return NextResponse.json(
        { success: false, error: 'Ski area not found' },
        { status: 404 }
      );
    }

    // Transform to SkiAreaDetails format
    const skiArea: SkiAreaDetails = {
      id: skiAreaRecord.id,
      osmId: skiAreaRecord.osmId,
      name: skiAreaRecord.name,
      country: skiAreaRecord.country,
      region: skiAreaRecord.region,
      latitude: skiAreaRecord.latitude,
      longitude: skiAreaRecord.longitude,
      bounds: skiAreaRecord.bounds as { minLat: number; maxLat: number; minLng: number; maxLng: number } | null,
      geometry: skiAreaRecord.geometry as unknown as SkiAreaDetails['geometry'],
      properties: skiAreaRecord.properties as Record<string, unknown> | null,
      runs: skiAreaRecord.runs.map((run: (typeof skiAreaRecord.runs)[number]) => ({
        id: run.id,
        osmId: run.osmId,
        name: run.name,
        difficulty: run.difficulty as RunDifficulty | null,
        status: run.status as 'open' | 'closed' | 'unknown' | null,
        locality: run.locality,
        geometry: run.geometry as unknown as RunData['geometry'],
        properties: run.properties as Record<string, unknown> | null,
      })),
      lifts: skiAreaRecord.lifts.map((lift: (typeof skiAreaRecord.lifts)[number]) => ({
        id: lift.id,
        osmId: lift.osmId,
        name: lift.name,
        liftType: lift.liftType,
        status: lift.status as 'open' | 'closed' | 'unknown' | null,
        locality: lift.locality,
        capacity: lift.capacity,
        geometry: lift.geometry as unknown as LiftData['geometry'],
        properties: lift.properties as Record<string, unknown> | null,
      })),
      localities: [],
    };

    // Get resort ID for analytics lookup
    const resortId = await getResortIdForSkiArea(body.skiAreaId);

    if (!resortId) {
      return NextResponse.json(
        { success: false, error: 'This ski area does not have analytics data available' },
        { status: 400 }
      );
    }

    console.log('[Max Optimality] Found resort ID:', resortId);

    // Get available runs and lifts from analytics
    const [availableRuns, availableLifts, operatingHours] = await Promise.all([
      getOpenRunsFromAnalytics(resortId, skiArea, body.difficulties),
      getOpenLiftsFromAnalytics(resortId, skiArea),
      getLiftOperatingHours(resortId),
    ]);

    console.log(
      `[Max Optimality] Found ${availableRuns.length} open runs, ${availableLifts.length} open lifts`
    );

    if (availableRuns.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No open runs found in the selected difficulty levels from the last 24 hours',
      });
    }

    if (availableLifts.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No open lifts found from the last 24 hours',
      });
    }

    // Parse target date
    const targetDate = new Date(body.targetDate);

    // Plan the route
    const plan = await planMaxOptimalityRoute(
      {
        skiAreaId: body.skiAreaId,
        difficulties: body.difficulties,
        homeLocation: body.homeLocation,
        targetDate,
        liftOpenTime: operatingHours?.openTime,
        liftCloseTime: operatingHours?.closeTime,
      },
      skiArea,
      availableRuns,
      availableLifts
    );

    console.log(
      `[Max Optimality] Plan complete: ${plan.summary.totalRunsCovered}/${plan.summary.totalRunsAvailable} runs covered`
    );

    return NextResponse.json({
      success: true,
      plan,
    });
  } catch (error) {
    console.error('[Max Optimality] Error planning route:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to plan route',
      },
      { status: 500 }
    );
  }
}

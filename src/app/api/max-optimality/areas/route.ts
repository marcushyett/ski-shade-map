/**
 * API endpoint to get ski areas with analytics coverage
 *
 * GET /api/max-optimality/areas
 *
 * Returns a list of ski areas that have analytics data available,
 * which is required for the Max Optimality feature.
 */

import { NextResponse } from 'next/server';
import { getSkiAreasWithAnalytics } from '@/lib/max-optimality/analytics-query';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const skiAreas = await getSkiAreasWithAnalytics();

    return NextResponse.json({
      success: true,
      skiAreas,
      count: skiAreas.length,
    });
  } catch (error) {
    console.error('[Max Optimality] Error fetching ski areas:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch ski areas',
        skiAreas: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}

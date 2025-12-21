import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Fast endpoint that returns basic ski area info without runs/lifts.
 * Used for immediate map centering while runs load progressively.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const skiArea = await prisma.skiArea.findUnique({
      where: { id },
      select: {
        id: true,
        osmId: true,
        name: true,
        country: true,
        region: true,
        latitude: true,
        longitude: true,
        bounds: true,
        geometry: true,
        properties: true,
        // Just count runs/lifts for stats display
        _count: {
          select: {
            runs: true,
            lifts: true,
          },
        },
        // Get connected areas info (lightweight)
        connectedTo: {
          select: {
            toArea: {
              select: {
                id: true,
                name: true,
                latitude: true,
                longitude: true,
              },
            },
          },
        },
        connectedFrom: {
          select: {
            fromArea: {
              select: {
                id: true,
                name: true,
                latitude: true,
                longitude: true,
              },
            },
          },
        },
      },
    });

    if (!skiArea) {
      return NextResponse.json(
        { error: 'Ski area not found' },
        { status: 404 }
      );
    }

    // Build connected areas list
    const connectedAreas = [
      ...skiArea.connectedTo.map(c => c.toArea),
      ...skiArea.connectedFrom.map(c => c.fromArea),
    ];

    // Get all ski area IDs for counting total runs/lifts
    const allAreaIds = [skiArea.id, ...connectedAreas.map(a => a.id)];

    // Count total runs and lifts across all connected areas
    const [totalRuns, totalLifts] = await Promise.all([
      prisma.run.count({ where: { skiAreaId: { in: allAreaIds } } }),
      prisma.lift.count({ where: { skiAreaId: { in: allAreaIds } } }),
    ]);

    // Get unique localities from runs (for quick reference)
    const localities = await prisma.run.findMany({
      where: { skiAreaId: { in: allAreaIds }, locality: { not: null } },
      select: { locality: true },
      distinct: ['locality'],
    });

    const response = {
      id: skiArea.id,
      osmId: skiArea.osmId,
      name: skiArea.name,
      country: skiArea.country,
      region: skiArea.region,
      latitude: skiArea.latitude,
      longitude: skiArea.longitude,
      bounds: skiArea.bounds,
      geometry: skiArea.geometry,
      properties: skiArea.properties,
      // Stats for UI
      runCount: totalRuns,
      liftCount: totalLifts,
      localities: localities.map(l => l.locality).filter(Boolean).sort() as string[],
      connectedAreas: connectedAreas.length > 0 ? connectedAreas : undefined,
      // Empty arrays - runs/lifts will be loaded progressively
      runs: [],
      lifts: [],
    };

    // Long cache - basic info rarely changes
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=7200, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('Error fetching ski area info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ski area info' },
      { status: 500 }
    );
  }
}

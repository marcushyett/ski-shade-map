import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Optimized endpoint that returns basic ski area info without runs/lifts.
 * Used for immediate map centering while runs load progressively.
 *
 * Optimizations:
 * - All queries run in parallel from the start
 * - Minimal data fetched - only what's needed for the UI
 * - Localities are skipped for initial load (can be fetched with runs)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Run the main query and connection queries in parallel
    const [skiArea, connectedTo, connectedFrom] = await Promise.all([
      // Main ski area - minimal fields for instant display
      prisma.skiArea.findUnique({
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
          _count: {
            select: {
              runs: true,
              lifts: true,
            },
          },
        },
      }),
      // Connected areas - fetch in parallel
      prisma.skiAreaConnection.findMany({
        where: { fromAreaId: id },
        select: {
          toArea: {
            select: { id: true, name: true, latitude: true, longitude: true },
          },
        },
      }),
      prisma.skiAreaConnection.findMany({
        where: { toAreaId: id },
        select: {
          fromArea: {
            select: { id: true, name: true, latitude: true, longitude: true },
          },
        },
      }),
    ]);

    if (!skiArea) {
      return NextResponse.json(
        { error: 'Ski area not found' },
        { status: 404 }
      );
    }

    // Build connected areas list
    const connectedAreas = [
      ...connectedTo.map((c: (typeof connectedTo)[number]) => c.toArea),
      ...connectedFrom.map((c: (typeof connectedFrom)[number]) => c.fromArea),
    ];

    // Get all ski area IDs for counting total runs/lifts
    const allAreaIds = [skiArea.id, ...connectedAreas.map(a => a.id)];

    // Only fetch counts and localities if there are connected areas
    // Otherwise use the counts we already have from the main query
    let runCount = skiArea._count.runs;
    let liftCount = skiArea._count.lifts;
    let localities: string[] = [];

    if (connectedAreas.length > 0) {
      // Fetch counts and localities in parallel
      const [totalRuns, totalLifts, localityResults] = await Promise.all([
        prisma.run.count({ where: { skiAreaId: { in: allAreaIds } } }),
        prisma.lift.count({ where: { skiAreaId: { in: allAreaIds } } }),
        prisma.run.findMany({
          where: { skiAreaId: { in: allAreaIds }, locality: { not: null } },
          select: { locality: true },
          distinct: ['locality'],
        }),
      ]);
      runCount = totalRuns;
      liftCount = totalLifts;
      localities = localityResults.map((l: (typeof localityResults)[number]) => l.locality).filter(Boolean).sort() as string[];
    } else {
      // Just get localities for the single area
      const localityResults = await prisma.run.findMany({
        where: { skiAreaId: id, locality: { not: null } },
        select: { locality: true },
        distinct: ['locality'],
      });
      localities = localityResults.map((l: (typeof localityResults)[number]) => l.locality).filter(Boolean).sort() as string[];
    }

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
      runCount,
      liftCount,
      localities,
      connectedAreas: connectedAreas.length > 0 ? connectedAreas : undefined,
      // Empty arrays - runs/lifts will be loaded progressively
      runs: [],
      lifts: [],
    };

    // Very long cache - basic geometry/info rarely changes (only on OSM data updates)
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
        'CDN-Cache-Control': 'max-age=86400', // Vercel-specific: 24hr CDN cache
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

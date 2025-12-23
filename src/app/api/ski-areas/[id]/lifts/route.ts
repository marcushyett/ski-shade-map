import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Viewport-based lifts endpoint for progressive loading.
 * Returns lifts that intersect with the given bounding box.
 *
 * Query params:
 * - bbox: minLng,minLat,maxLng,maxLat (optional - if not provided, returns all)
 * - includeConnected: 'true' to include lifts from connected ski areas
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const bboxParam = url.searchParams.get('bbox');
  const includeConnected = url.searchParams.get('includeConnected') === 'true';

  try {
    // Get the ski area and connected areas
    const skiArea = await prisma.skiArea.findUnique({
      where: { id },
      select: {
        id: true,
        connectedTo: { select: { toAreaId: true } },
        connectedFrom: { select: { fromAreaId: true } },
      },
    });

    if (!skiArea) {
      return NextResponse.json(
        { error: 'Ski area not found' },
        { status: 404 }
      );
    }

    // Build list of ski area IDs to query
    const areaIds = [skiArea.id];
    if (includeConnected) {
      areaIds.push(
        ...skiArea.connectedTo.map((c: (typeof skiArea.connectedTo)[number]) => c.toAreaId),
        ...skiArea.connectedFrom.map((c: (typeof skiArea.connectedFrom)[number]) => c.fromAreaId)
      );
    }

    // Parse bounding box if provided
    let bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number } | null = null;
    if (bboxParam) {
      const [minLng, minLat, maxLng, maxLat] = bboxParam.split(',').map(Number);
      if (!isNaN(minLng) && !isNaN(minLat) && !isNaN(maxLng) && !isNaN(maxLat)) {
        bbox = { minLng, minLat, maxLng, maxLat };
      }
    }

    // Get lifts
    const allLifts = await prisma.lift.findMany({
      where: {
        skiAreaId: { in: areaIds },
      },
      select: {
        id: true,
        osmId: true,
        name: true,
        liftType: true,
        status: true,
        locality: true,
        capacity: true,
        geometry: true,
        properties: true,
        skiArea: {
          select: { name: true },
        },
      },
    });

    // Filter by bounding box if provided
    let filteredLifts = allLifts;
    if (bbox) {
      filteredLifts = allLifts.filter((lift: (typeof allLifts)[number]) => {
        return liftIntersectsBbox(lift.geometry, bbox!);
      });
    }

    // Transform for response
    const lifts = filteredLifts.map((lift: (typeof allLifts)[number]) => ({
      id: lift.id,
      osmId: lift.osmId,
      name: lift.name,
      liftType: lift.liftType,
      status: lift.status,
      locality: lift.locality || lift.skiArea?.name,
      capacity: lift.capacity,
      geometry: lift.geometry,
      properties: lift.properties,
    }));

    const response = {
      lifts,
      total: filteredLifts.length,
    };

    // Long cache - lift geometry rarely changes (only on OSM data updates)
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
        'CDN-Cache-Control': 'max-age=86400', // Vercel-specific: 24hr CDN cache
      },
    });
  } catch (error) {
    console.error('Error fetching lifts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch lifts' },
      { status: 500 }
    );
  }
}

/**
 * Check if a lift's geometry intersects with a bounding box.
 */
function liftIntersectsBbox(
  geometry: unknown,
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number }
): boolean {
  const geo = geometry as { type: string; coordinates: number[][] };
  if (!geo || geo.type !== 'LineString' || !geo.coordinates) return false;

  const coords = geo.coordinates;
  const buffer = 0.01; // ~1km buffer

  // Check if any point is within the bbox
  for (const [lng, lat] of coords) {
    if (
      lng >= bbox.minLng - buffer &&
      lng <= bbox.maxLng + buffer &&
      lat >= bbox.minLat - buffer &&
      lat <= bbox.maxLat + buffer
    ) {
      return true;
    }
  }

  // Also check if the lift's bounding box intersects
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  return !(
    maxLng < bbox.minLng - buffer ||
    minLng > bbox.maxLng + buffer ||
    maxLat < bbox.minLat - buffer ||
    minLat > bbox.maxLat + buffer
  );
}

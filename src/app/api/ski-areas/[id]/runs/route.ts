import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Viewport-based runs endpoint for progressive loading.
 * Returns runs that intersect with the given bounding box.
 *
 * Query params:
 * - bbox: minLng,minLat,maxLng,maxLat (optional - if not provided, returns all)
 * - includeConnected: 'true' to include runs from connected ski areas
 * - limit: max number of runs to return (default 100)
 * - offset: pagination offset
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const bboxParam = url.searchParams.get('bbox');
  const includeConnected = url.searchParams.get('includeConnected') === 'true';
  // Only apply limit if explicitly requested (for future viewport-based loading)
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam), 2000) : null;
  const offset = parseInt(url.searchParams.get('offset') || '0');

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

    // Get runs with optional bbox filtering
    // Since we store geometry as JSON, we need to filter in application
    // For better performance in future, we could store bounding boxes as separate columns
    const allRuns = await prisma.run.findMany({
      where: {
        skiAreaId: { in: areaIds },
      },
      select: {
        id: true,
        osmId: true,
        name: true,
        difficulty: true,
        status: true,
        locality: true,
        geometry: true,
        properties: true,
        skiArea: {
          select: { name: true },
        },
      },
    });

    // Filter by bounding box if provided
    let filteredRuns = allRuns;
    if (bbox) {
      filteredRuns = allRuns.filter((run: (typeof allRuns)[number]) => {
        return runIntersectsBbox(run.geometry, bbox!);
      });
    }

    // Apply pagination only if limit is specified
    const paginatedRuns = limit
      ? filteredRuns.slice(offset, offset + limit)
      : filteredRuns;

    // Transform for response
    const runs = paginatedRuns.map((run: (typeof allRuns)[number]) => ({
      id: run.id,
      osmId: run.osmId,
      name: run.name,
      difficulty: run.difficulty,
      status: run.status,
      locality: run.locality || run.skiArea?.name,
      geometry: run.geometry,
      properties: run.properties,
    }));

    const response = {
      runs,
      total: filteredRuns.length,
      hasMore: limit ? (offset + limit < filteredRuns.length) : false,
      bbox: bbox,
    };

    // Short cache for viewport-specific requests
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    console.error('Error fetching runs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch runs' },
      { status: 500 }
    );
  }
}

/**
 * Check if a run's geometry intersects with a bounding box.
 * Works for both LineString and Polygon geometries.
 */
function runIntersectsBbox(
  geometry: unknown,
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number }
): boolean {
  const geo = geometry as { type: string; coordinates: unknown };
  if (!geo || !geo.type || !geo.coordinates) return false;

  const coords = extractCoordinates(geo);

  // Check if any point is within the bbox (with a small buffer for edge cases)
  const buffer = 0.01; // ~1km buffer
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

  // Also check if the run's bounding box intersects (for runs that pass through)
  const runBbox = calculateBbox(coords);
  return !(
    runBbox.maxLng < bbox.minLng - buffer ||
    runBbox.minLng > bbox.maxLng + buffer ||
    runBbox.maxLat < bbox.minLat - buffer ||
    runBbox.minLat > bbox.maxLat + buffer
  );
}

function extractCoordinates(geo: { type: string; coordinates: unknown }): number[][] {
  if (geo.type === 'LineString') {
    return geo.coordinates as number[][];
  } else if (geo.type === 'Polygon') {
    // Return the outer ring
    return (geo.coordinates as number[][][])[0] || [];
  }
  return [];
}

function calculateBbox(coords: number[][]): { minLng: number; minLat: number; maxLng: number; maxLat: number } {
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;

  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  return { minLng, minLat, maxLng, maxLat };
}

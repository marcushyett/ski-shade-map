import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

// Lightweight searchable item for client-side Fuse.js
export interface SearchableLocation {
  id: string;
  type: 'region' | 'locality';
  name: string;
  country: string | null;
  region?: string;      // Parent ski area for localities
  skiAreaId: string;
  lat?: number;
  lng?: number;
  runs?: number;
  lifts?: number;
}

// In-memory cache for dynamic fallback (refreshed every 10 minutes)
let cachedData: SearchableLocation[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000;

// Try to load from pre-generated static file (fastest path)
let staticData: SearchableLocation[] | null = null;
let staticDataLoaded = false;

function loadStaticData(): SearchableLocation[] | null {
  if (staticDataLoaded) return staticData;

  try {
    const filePath = path.join(process.cwd(), 'public', 'data', 'locations.json');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      staticData = JSON.parse(content);
      console.log(`Loaded ${staticData?.length || 0} locations from static file`);
    }
  } catch (error) {
    console.warn('Could not load static locations file:', error);
    staticData = null;
  }

  staticDataLoaded = true;
  return staticData;
}

export async function GET() {
  // Long cache headers - data is static and updated only on build
  const cacheHeaders = {
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
  };

  // Try static file first (instant response)
  const staticLocations = loadStaticData();
  if (staticLocations) {
    return NextResponse.json(staticLocations, { headers: cacheHeaders });
  }

  // Fallback to database query (for development or if static file missing)
  try {
    const now = Date.now();

    // Return cached data if still valid
    if (cachedData && now - cacheTimestamp < CACHE_TTL) {
      return NextResponse.json(cachedData, { headers: cacheHeaders });
    }

    // Fetch all data in parallel
    const [skiAreas, runsWithLocality] = await Promise.all([
      prisma.skiArea.findMany({
        select: {
          id: true,
          name: true,
          country: true,
          latitude: true,
          longitude: true,
          _count: { select: { runs: true, lifts: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.run.findMany({
        where: { locality: { not: null } },
        select: {
          locality: true,
          skiArea: {
            select: { id: true, name: true, country: true },
          },
        },
        distinct: ['locality', 'skiAreaId'],
      }),
    ]);

    const items: SearchableLocation[] = [];

    // Add ski areas
    for (const area of skiAreas) {
      items.push({
        id: area.id,
        type: 'region',
        name: area.name,
        country: area.country,
        skiAreaId: area.id,
        lat: area.latitude,
        lng: area.longitude,
        runs: area._count.runs,
        lifts: area._count.lifts,
      });
    }

    // Add unique localities
    const seenLocalities = new Set<string>();
    for (const run of runsWithLocality) {
      if (!run.locality) continue;
      const key = `${run.locality}-${run.skiArea.id}`;
      if (seenLocalities.has(key)) continue;
      seenLocalities.add(key);

      items.push({
        id: `loc-${run.skiArea.id}-${run.locality}`,
        type: 'locality',
        name: run.locality,
        country: run.skiArea.country,
        region: run.skiArea.name,
        skiAreaId: run.skiArea.id,
      });
    }

    cachedData = items;
    cacheTimestamp = now;

    return NextResponse.json(items, { headers: cacheHeaders });
  } catch (error) {
    console.error('Error fetching locations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch locations' },
      { status: 500 }
    );
  }
}

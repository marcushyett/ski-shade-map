import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

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

// In-memory cache (refreshed every 10 minutes)
let cachedData: SearchableLocation[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000;

export async function GET() {
  try {
    const now = Date.now();

    // Return cached data if still valid
    if (cachedData && now - cacheTimestamp < CACHE_TTL) {
      return NextResponse.json(cachedData, {
        headers: {
          'Cache-Control': 'public, max-age=600, stale-while-revalidate=60',
        },
      });
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

    return NextResponse.json(items, {
      headers: {
        'Cache-Control': 'public, max-age=600, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('Error fetching locations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch locations' },
      { status: 500 }
    );
  }
}

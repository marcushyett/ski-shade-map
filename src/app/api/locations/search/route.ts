import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export interface LocationSearchResult {
  id: string;
  type: 'country' | 'region' | 'subregion';
  name: string;
  country?: string;
  region?: string;       // Parent ski area name for sub-regions
  skiAreaId?: string;    // The ski area to load
  latitude?: number;
  longitude?: number;
  runCount?: number;
  liftCount?: number;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q')?.trim() || '';
  const limit = parseInt(searchParams.get('limit') || '20');

  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results: LocationSearchResult[] = [];

    // 1. Search ski areas (regions)
    const skiAreas = await prisma.skiArea.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { country: { contains: query, mode: 'insensitive' } },
          { region: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        country: true,
        region: true,
        latitude: true,
        longitude: true,
        _count: {
          select: { runs: true, lifts: true },
        },
      },
      orderBy: [
        // Prioritize exact name matches
        { name: 'asc' },
      ],
      take: limit,
    });

    // Add ski areas as "region" results
    for (const area of skiAreas) {
      results.push({
        id: area.id,
        type: 'region',
        name: area.name,
        country: area.country || undefined,
        skiAreaId: area.id,
        latitude: area.latitude || undefined,
        longitude: area.longitude || undefined,
        runCount: area._count.runs,
        liftCount: area._count.lifts,
      });
    }

    // 2. Search sub-regions
    const subRegions = await prisma.subRegion.findMany({
      where: {
        name: { contains: query, mode: 'insensitive' },
      },
      select: {
        id: true,
        name: true,
        centroid: true,
        skiArea: {
          select: {
            id: true,
            name: true,
            country: true,
          },
        },
      },
      take: limit,
    });

    // Add sub-regions
    for (const subRegion of subRegions) {
      const centroid = subRegion.centroid as { lat: number; lng: number } | null;
      results.push({
        id: subRegion.id,
        type: 'subregion',
        name: subRegion.name,
        country: subRegion.skiArea.country || undefined,
        region: subRegion.skiArea.name,
        skiAreaId: subRegion.skiArea.id,
        latitude: centroid?.lat,
        longitude: centroid?.lng,
      });
    }

    // 3. Search by country name - return top ski areas from that country
    const countryMatches = await prisma.skiArea.groupBy({
      by: ['country'],
      where: {
        country: { contains: query, mode: 'insensitive' },
      },
      _count: { id: true },
    });

    for (const match of countryMatches) {
      if (match.country) {
        // Don't add if we already have results from this country
        const hasCountryResults = results.some(r => r.country === match.country);
        if (!hasCountryResults) {
          results.push({
            id: `country-${match.country}`,
            type: 'country',
            name: match.country,
            country: match.country,
            runCount: match._count.id, // Actually ski area count
          });
        }
      }
    }

    // Sort: exact matches first, then by type (subregion > region > country)
    results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === query.toLowerCase();
      const bExact = b.name.toLowerCase() === query.toLowerCase();
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      // Prefer sub-regions and regions over countries
      const typeOrder = { subregion: 0, region: 1, country: 2 };
      return typeOrder[a.type] - typeOrder[b.type];
    });

    return NextResponse.json({
      results: results.slice(0, limit),
      query,
    });
  } catch (error) {
    console.error('Error searching locations:', error);
    return NextResponse.json(
      { error: 'Failed to search locations' },
      { status: 500 }
    );
  }
}


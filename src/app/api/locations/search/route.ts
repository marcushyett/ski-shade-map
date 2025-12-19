import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export interface LocationSearchResult {
  id: string;
  type: 'country' | 'region' | 'locality';
  name: string;
  country?: string;
  region?: string;       // Parent ski area name for localities
  skiAreaId?: string;    // The ski area to load
  latitude?: number;
  longitude?: number;
  runCount?: number;
  liftCount?: number;
}

// Normalize text by removing accents/diacritics for accent-insensitive search
// This allows "Les Menu" to match "Les Ménuires"
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// In-memory cache for ski areas (refreshed every 5 minutes)
interface CachedSkiArea {
  id: string;
  name: string;
  nameNormalized: string;
  country: string | null;
  countryNormalized: string;
  region: string | null;
  regionNormalized: string;
  latitude: number | null;
  longitude: number | null;
  runCount: number;
  liftCount: number;
}

interface CachedLocality {
  locality: string;
  localityNormalized: string;
  skiAreaId: string;
  skiAreaName: string;
  country: string | null;
  latitude: number;
  longitude: number;
}

let skiAreasCache: CachedSkiArea[] | null = null;
let localitiesCache: CachedLocality[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getSkiAreasFromCache(): Promise<CachedSkiArea[]> {
  const now = Date.now();
  if (skiAreasCache && now - cacheTimestamp < CACHE_TTL) {
    return skiAreasCache;
  }

  const skiAreas = await prisma.skiArea.findMany({
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
    orderBy: { name: 'asc' },
  });

  skiAreasCache = skiAreas.map(area => ({
    id: area.id,
    name: area.name,
    nameNormalized: normalizeText(area.name),
    country: area.country,
    countryNormalized: area.country ? normalizeText(area.country) : '',
    region: area.region,
    regionNormalized: area.region ? normalizeText(area.region) : '',
    latitude: area.latitude,
    longitude: area.longitude,
    runCount: area._count.runs,
    liftCount: area._count.lifts,
  }));

  cacheTimestamp = now;
  return skiAreasCache;
}

async function getLocalitiesFromCache(): Promise<CachedLocality[]> {
  const now = Date.now();
  if (localitiesCache && now - cacheTimestamp < CACHE_TTL) {
    return localitiesCache;
  }

  // Get unique localities from runs grouped by ski area
  const runsWithLocality = await prisma.run.findMany({
    where: {
      locality: { not: null },
    },
    select: {
      locality: true,
      skiArea: {
        select: {
          id: true,
          name: true,
          country: true,
          latitude: true,
          longitude: true,
        },
      },
    },
    distinct: ['locality', 'skiAreaId'],
  });

  // Create unique localities map
  const localityMap = new Map<string, CachedLocality>();
  for (const run of runsWithLocality) {
    if (run.locality) {
      const key = `${run.locality}-${run.skiArea.id}`;
      if (!localityMap.has(key)) {
        localityMap.set(key, {
          locality: run.locality,
          localityNormalized: normalizeText(run.locality),
          skiAreaId: run.skiArea.id,
          skiAreaName: run.skiArea.name,
          country: run.skiArea.country,
          latitude: run.skiArea.latitude,
          longitude: run.skiArea.longitude,
        });
      }
    }
  }

  localitiesCache = Array.from(localityMap.values());
  return localitiesCache;
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
    const normalizedQuery = normalizeText(query);

    // Fetch from cache (fast after first load)
    const [skiAreas, localities] = await Promise.all([
      getSkiAreasFromCache(),
      getLocalitiesFromCache(),
    ]);

    // Filter ski areas with pre-normalized strings (faster)
    const matchedSkiAreas = skiAreas.filter(area =>
      area.nameNormalized.includes(normalizedQuery) ||
      area.countryNormalized.includes(normalizedQuery) ||
      area.regionNormalized.includes(normalizedQuery)
    );

    // Add ski areas as "region" results
    for (const area of matchedSkiAreas.slice(0, limit)) {
      results.push({
        id: area.id,
        type: 'region',
        name: area.name,
        country: area.country || undefined,
        skiAreaId: area.id,
        latitude: area.latitude || undefined,
        longitude: area.longitude || undefined,
        runCount: area.runCount,
        liftCount: area.liftCount,
      });
    }

    // Filter localities with pre-normalized strings
    const matchedLocalities = localities.filter(loc =>
      loc.localityNormalized.includes(normalizedQuery)
    );

    // Add localities
    for (const locality of matchedLocalities.slice(0, limit)) {
      results.push({
        id: `locality-${locality.locality}-${locality.skiAreaId}`,
        type: 'locality',
        name: locality.locality,
        country: locality.country || undefined,
        region: locality.skiAreaName,
        skiAreaId: locality.skiAreaId,
        latitude: locality.latitude,
        longitude: locality.longitude,
      });
    }

    // Search by country name - return top ski areas from that country
    const matchedCountries = skiAreas
      .filter(area => area.country && area.countryNormalized.includes(normalizedQuery))
      .map(area => area.country)
      .filter((v, i, a) => v && a.indexOf(v) === i); // Unique countries

    for (const country of matchedCountries) {
      if (country) {
        // Don't add if we already have results from this country
        const hasCountryResults = results.some(r => r.country === country);
        if (!hasCountryResults) {
          const countryCount = skiAreas.filter(a => a.country === country).length;
          results.push({
            id: `country-${country}`,
            type: 'country',
            name: country,
            country: country,
            runCount: countryCount, // Actually ski area count
          });
        }
      }
    }

    // Sort: exact matches first (normalized), then by type (locality > region > country)
    results.sort((a, b) => {
      const aNorm = normalizeText(a.name);
      const bNorm = normalizeText(b.name);

      const aExact = aNorm === normalizedQuery;
      const bExact = bNorm === normalizedQuery;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      // Prefer matches that start with the query
      const aStarts = aNorm.startsWith(normalizedQuery);
      const bStarts = bNorm.startsWith(normalizedQuery);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      // Prefer localities and regions over countries
      const typeOrder = { locality: 0, region: 1, country: 2 };
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

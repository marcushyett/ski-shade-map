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

// Normalize text by removing accents/diacritics for accent-insensitive search
// This allows "Les Menu" to match "Les Ménuires"
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// Check if normalized query matches normalized text
function matchesNormalized(text: string, query: string): boolean {
  return normalizeText(text).includes(normalizeText(query));
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

interface CachedSubRegion {
  id: string;
  name: string;
  nameNormalized: string;
  centroid: { lat: number; lng: number } | null;
  skiAreaId: string;
  skiAreaName: string;
  country: string | null;
}

let skiAreasCache: CachedSkiArea[] | null = null;
let subRegionsCache: CachedSubRegion[] | null = null;
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

async function getSubRegionsFromCache(): Promise<CachedSubRegion[]> {
  const now = Date.now();
  if (subRegionsCache && now - cacheTimestamp < CACHE_TTL) {
    return subRegionsCache;
  }

  const subRegions = await prisma.subRegion.findMany({
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
  });

  subRegionsCache = subRegions.map(sr => ({
    id: sr.id,
    name: sr.name,
    nameNormalized: normalizeText(sr.name),
    centroid: sr.centroid as { lat: number; lng: number } | null,
    skiAreaId: sr.skiArea.id,
    skiAreaName: sr.skiArea.name,
    country: sr.skiArea.country,
  }));

  return subRegionsCache;
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
    const [skiAreas, subRegions] = await Promise.all([
      getSkiAreasFromCache(),
      getSubRegionsFromCache(),
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

    // Filter sub-regions with pre-normalized strings
    const matchedSubRegions = subRegions.filter(sr => 
      sr.nameNormalized.includes(normalizedQuery)
    );

    // Add sub-regions
    for (const subRegion of matchedSubRegions.slice(0, limit)) {
      results.push({
        id: subRegion.id,
        type: 'subregion',
        name: subRegion.name,
        country: subRegion.country || undefined,
        region: subRegion.skiAreaName,
        skiAreaId: subRegion.skiAreaId,
        latitude: subRegion.centroid?.lat,
        longitude: subRegion.centroid?.lng,
      });
    }

    // 3. Search by country name - return top ski areas from that country
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

    // Sort: exact matches first (normalized), then by type (subregion > region > country)
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


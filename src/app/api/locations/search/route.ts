import { NextRequest, NextResponse } from 'next/server';
import Fuse, { IFuseOptions } from 'fuse.js';
import prisma from '@/lib/prisma';
import { getRelatedSearchTerms } from '@/lib/resort-synonyms';

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
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// Searchable item for Fuse.js index
interface SearchableItem {
  id: string;
  type: 'region' | 'locality' | 'country';
  name: string;
  nameNormalized: string;
  country: string | null;
  countryNormalized: string;
  region: string | null;        // Parent ski area for localities
  regionNormalized: string;
  skiAreaId: string | null;
  latitude: number | null;
  longitude: number | null;
  runCount: number;
  liftCount: number;
  // Combined searchable text for better fuzzy matching
  searchText: string;
}

// Fuse.js index and cache
let fuseIndex: Fuse<SearchableItem> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Fuse.js options optimized for fast, accurate resort search
const fuseOptions: IFuseOptions<SearchableItem> = {
  keys: [
    { name: 'nameNormalized', weight: 2 },
    { name: 'searchText', weight: 1 },
    { name: 'countryNormalized', weight: 0.5 },
    { name: 'regionNormalized', weight: 0.8 },
  ],
  threshold: 0.3,           // Lower = stricter matching
  distance: 100,            // How far to search for matches
  minMatchCharLength: 2,
  includeScore: true,
  shouldSort: true,
  findAllMatches: true,
  ignoreLocation: true,     // Don't prefer matches at the start
};

async function buildSearchIndex(): Promise<void> {
  const now = Date.now();

  // Return cached index if still valid
  if (fuseIndex && now - cacheTimestamp < CACHE_TTL) {
    return;
  }

  // Fetch ski areas and localities in parallel
  const [skiAreas, runsWithLocality] = await Promise.all([
    prisma.skiArea.findMany({
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
    }),
    prisma.run.findMany({
      where: { locality: { not: null } },
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
    }),
  ]);

  const items: SearchableItem[] = [];

  // Add ski areas as searchable items
  for (const area of skiAreas) {
    const nameNorm = normalizeText(area.name);
    const countryNorm = area.country ? normalizeText(area.country) : '';
    const regionNorm = area.region ? normalizeText(area.region) : '';

    items.push({
      id: area.id,
      type: 'region',
      name: area.name,
      nameNormalized: nameNorm,
      country: area.country,
      countryNormalized: countryNorm,
      region: null,
      regionNormalized: regionNorm,
      skiAreaId: area.id,
      latitude: area.latitude,
      longitude: area.longitude,
      runCount: area._count.runs,
      liftCount: area._count.lifts,
      // Combine for broader matching
      searchText: `${nameNorm} ${countryNorm} ${regionNorm}`.trim(),
    });
  }

  // Add unique localities
  const seenLocalities = new Set<string>();
  for (const run of runsWithLocality) {
    if (!run.locality) continue;

    const key = `${run.locality}-${run.skiArea.id}`;
    if (seenLocalities.has(key)) continue;
    seenLocalities.add(key);

    const localityNorm = normalizeText(run.locality);
    const countryNorm = run.skiArea.country ? normalizeText(run.skiArea.country) : '';
    const skiAreaNorm = normalizeText(run.skiArea.name);

    items.push({
      id: `locality-${run.locality}-${run.skiArea.id}`,
      type: 'locality',
      name: run.locality,
      nameNormalized: localityNorm,
      country: run.skiArea.country,
      countryNormalized: countryNorm,
      region: run.skiArea.name,
      regionNormalized: skiAreaNorm,
      skiAreaId: run.skiArea.id,
      latitude: run.skiArea.latitude,
      longitude: run.skiArea.longitude,
      runCount: 0,
      liftCount: 0,
      searchText: `${localityNorm} ${skiAreaNorm} ${countryNorm}`.trim(),
    });
  }

  // Add unique countries
  const countries = new Set<string>();
  for (const area of skiAreas) {
    if (area.country && !countries.has(area.country)) {
      countries.add(area.country);
      const countryNorm = normalizeText(area.country);
      const countryCount = skiAreas.filter((a: typeof area) => a.country === area.country).length;

      items.push({
        id: `country-${area.country}`,
        type: 'country',
        name: area.country,
        nameNormalized: countryNorm,
        country: area.country,
        countryNormalized: countryNorm,
        region: null,
        regionNormalized: '',
        skiAreaId: null,
        latitude: null,
        longitude: null,
        runCount: countryCount, // Actually ski area count
        liftCount: 0,
        searchText: countryNorm,
      });
    }
  }

  // Build Fuse.js index
  fuseIndex = new Fuse(items, fuseOptions);
  cacheTimestamp = now;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q')?.trim() || '';
  const limit = parseInt(searchParams.get('limit') || '20');

  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    // Ensure index is built
    await buildSearchIndex();

    if (!fuseIndex) {
      return NextResponse.json({ results: [], query });
    }

    const normalizedQuery = normalizeText(query);
    const results: LocationSearchResult[] = [];
    const seenIds = new Set<string>();

    // Get related terms from synonyms (e.g., "meribel" -> "3 vallees", "courchevel", etc.)
    const relatedTerms = getRelatedSearchTerms(query);

    // Search with the main query using Fuse.js
    const fuseResults = fuseIndex.search(normalizedQuery, { limit: limit * 2 });

    // Also search for related terms from synonyms
    for (const relatedTerm of relatedTerms.slice(0, 5)) { // Limit to avoid too many searches
      const relatedResults = fuseIndex.search(relatedTerm, { limit: 10 });
      for (const result of relatedResults) {
        // Add with slightly worse score to prioritize direct matches
        fuseResults.push({ ...result, score: (result.score || 0) + 0.1 });
      }
    }

    // Sort by score (lower is better in Fuse.js)
    fuseResults.sort((a, b) => (a.score || 0) - (b.score || 0));

    // Convert to LocationSearchResult
    for (const fuseResult of fuseResults) {
      const item = fuseResult.item;

      // Skip duplicates
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);

      const result: LocationSearchResult = {
        id: item.id,
        type: item.type,
        name: item.name,
        country: item.country || undefined,
        skiAreaId: item.skiAreaId || undefined,
        latitude: item.latitude || undefined,
        longitude: item.longitude || undefined,
        runCount: item.runCount || undefined,
        liftCount: item.liftCount || undefined,
      };

      if (item.type === 'locality' && item.region) {
        result.region = item.region;
      }

      results.push(result);

      if (results.length >= limit) break;
    }

    // Custom sorting: exact/prefix matches first, then by type
    results.sort((a, b) => {
      const aNorm = normalizeText(a.name);
      const bNorm = normalizeText(b.name);

      // Exact match first
      const aExact = aNorm === normalizedQuery;
      const bExact = bNorm === normalizedQuery;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      // Prefix match second
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

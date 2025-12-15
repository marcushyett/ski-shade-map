import { NextRequest, NextResponse } from 'next/server';
import type { POIData, POIType } from '@/lib/types';

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

// Cache POIs in memory for 1 hour to reduce API calls
const poiCache = new Map<string, { data: POIData[]; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch POIs (toilets, restaurants, viewpoints) within given bounds
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  
  const minLat = parseFloat(searchParams.get('minLat') || '');
  const maxLat = parseFloat(searchParams.get('maxLat') || '');
  const minLng = parseFloat(searchParams.get('minLng') || '');
  const maxLng = parseFloat(searchParams.get('maxLng') || '');

  if (isNaN(minLat) || isNaN(maxLat) || isNaN(minLng) || isNaN(maxLng)) {
    return NextResponse.json(
      { error: 'Missing or invalid bounds parameters' },
      { status: 400 }
    );
  }

  // Check cache
  const cacheKey = `${minLat},${maxLat},${minLng},${maxLng}`;
  const cached = poiCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({ pois: cached.data });
  }

  try {
    const pois = await fetchPOIsFromOverpass(minLat, maxLat, minLng, maxLng);
    
    // Cache the result
    poiCache.set(cacheKey, { data: pois, timestamp: Date.now() });
    
    return NextResponse.json({ pois });
  } catch (error) {
    console.error('Error fetching POIs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch POIs', pois: [] },
      { status: 500 }
    );
  }
}

async function fetchPOIsFromOverpass(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number
): Promise<POIData[]> {
  // Overpass query for toilets, restaurants/cafes, and viewpoints
  const query = `
    [out:json][timeout:25];
    (
      // Toilets
      node["amenity"="toilets"](${minLat},${minLng},${maxLat},${maxLng});
      // Restaurants and cafes
      node["amenity"="restaurant"](${minLat},${minLng},${maxLat},${maxLng});
      node["amenity"="cafe"](${minLat},${minLng},${maxLat},${maxLng});
      node["amenity"="fast_food"](${minLat},${minLng},${maxLat},${maxLng});
      // Viewpoints
      node["tourism"="viewpoint"](${minLat},${minLng},${maxLat},${maxLng});
    );
    out body;
  `;

  const response = await fetch(OVERPASS_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`);
  }

  const data = await response.json();
  const pois: POIData[] = [];

  for (const element of data.elements || []) {
    if (element.type !== 'node' || !element.lat || !element.lon) continue;

    const tags = element.tags || {};
    let poiType: POIType | null = null;

    if (tags.amenity === 'toilets') {
      poiType = 'toilet';
    } else if (['restaurant', 'cafe', 'fast_food'].includes(tags.amenity)) {
      poiType = 'restaurant';
    } else if (tags.tourism === 'viewpoint') {
      poiType = 'viewpoint';
    }

    if (poiType) {
      pois.push({
        id: `osm-${element.id}`,
        type: poiType,
        name: tags.name || null,
        latitude: element.lat,
        longitude: element.lon,
      });
    }
  }

  return pois;
}

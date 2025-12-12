/**
 * Data loader for OpenSkiMap GeoJSON data
 * These are large files, so we process them server-side
 */

import type { Feature, FeatureCollection, Geometry, LineString, Point, Polygon } from 'geojson';

const OPENSKIMAP_BASE = 'https://tiles.openskimap.org/geojson';

export interface OpenSkiMapArea {
  type: 'Feature';
  geometry: Polygon | Point;
  properties: {
    id: string;
    name?: string;
    type?: string;
    status?: string;
    websites?: string[];
    location?: {
      iso3166_1Alpha2?: string;
      iso3166_2?: string;
      localized?: {
        en?: { country?: string; region?: string };
      };
    };
  };
}

export interface OpenSkiMapRun {
  type: 'Feature';
  geometry: LineString | Polygon;
  properties: {
    id: string;
    name?: string;
    difficulty?: string;
    status?: string;
    skiAreas?: Array<{ properties: { id: string; name?: string } }>;
  };
}

export interface OpenSkiMapLift {
  type: 'Feature';
  geometry: LineString;
  properties: {
    id: string;
    name?: string;
    liftType?: string;
    status?: string;
    capacity?: number;
    skiAreas?: Array<{ properties: { id: string; name?: string } }>;
  };
}

/**
 * Fetch and parse ski areas from OpenSkiMap
 * Note: This is a large file (~50MB), should be cached
 */
export async function fetchSkiAreas(): Promise<FeatureCollection> {
  const response = await fetch(`${OPENSKIMAP_BASE}/ski_areas.geojson`, {
    next: { revalidate: 86400 }, // Cache for 24 hours
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch ski areas: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Fetch runs from OpenSkiMap
 */
export async function fetchRuns(): Promise<FeatureCollection> {
  const response = await fetch(`${OPENSKIMAP_BASE}/runs.geojson`, {
    next: { revalidate: 86400 },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch runs: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Fetch lifts from OpenSkiMap
 */
export async function fetchLifts(): Promise<FeatureCollection> {
  const response = await fetch(`${OPENSKIMAP_BASE}/lifts.geojson`, {
    next: { revalidate: 86400 },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch lifts: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Extract center point from geometry
 */
export function getGeometryCenter(geometry: Geometry): { lat: number; lng: number } | null {
  if (geometry.type === 'Point') {
    return { lng: geometry.coordinates[0], lat: geometry.coordinates[1] };
  }
  
  if (geometry.type === 'Polygon') {
    const coords = geometry.coordinates[0];
    const lats = coords.map(c => c[1]);
    const lngs = coords.map(c => c[0]);
    return {
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    };
  }
  
  if (geometry.type === 'LineString') {
    const coords = geometry.coordinates;
    const lats = coords.map(c => c[1]);
    const lngs = coords.map(c => c[0]);
    return {
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    };
  }
  
  return null;
}

/**
 * Calculate bounding box from geometry
 */
export function getGeometryBounds(geometry: Geometry): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  let coords: number[][] = [];
  
  if (geometry.type === 'Point') {
    coords = [geometry.coordinates];
  } else if (geometry.type === 'LineString') {
    coords = geometry.coordinates;
  } else if (geometry.type === 'Polygon') {
    coords = geometry.coordinates.flat();
  } else if (geometry.type === 'MultiPolygon') {
    coords = geometry.coordinates.flat(2);
  } else if (geometry.type === 'MultiLineString') {
    coords = geometry.coordinates.flat();
  }
  
  if (coords.length === 0) return null;
  
  const lngs = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  
  return {
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  };
}

/**
 * Map difficulty from OpenSkiMap format
 */
export function mapDifficulty(difficulty?: string): string | null {
  if (!difficulty) return null;
  
  const diffMap: Record<string, string> = {
    'novice': 'novice',
    'easy': 'easy',
    'intermediate': 'intermediate',
    'advanced': 'advanced',
    'expert': 'expert',
    'freeride': 'expert',
    'extreme': 'expert',
  };
  
  return diffMap[difficulty.toLowerCase()] || difficulty;
}


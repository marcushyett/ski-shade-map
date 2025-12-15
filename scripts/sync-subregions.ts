/**
 * Sync sub-regions from OpenStreetMap Overpass API
 * This script fetches site=piste relations and assigns them to parent ski areas
 * It also automatically detects connected ski areas based on overlapping bounds
 *
 * Usage:
 *   npx tsx scripts/sync-subregions.ts                    # Sync all + detect connections
 *   npx tsx scripts/sync-subregions.ts --ski-area-id=ID   # Sync specific ski area
 *   npx tsx scripts/sync-subregions.ts --connections-only # Only detect connected ski areas
 *   npx tsx scripts/sync-subregions.ts --skip-connections # Sync without detecting connections
 *   npx tsx scripts/sync-subregions.ts --force-restart    # Delete all and start fresh
 *   npx tsx scripts/sync-subregions.ts --dry-run          # Preview without writing to DB
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Multiple Overpass API endpoints to distribute load
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// Track last request time per endpoint for rate limiting
const endpointLastRequest = new Map<string, number>();
const MIN_DELAY_PER_ENDPOINT = 5000; // 5 seconds between requests to same endpoint
const CONCURRENCY = 10; // Process 10 ski areas in parallel

// Round-robin endpoint selection
let currentEndpointIndex = 0;
function getNextEndpoint(): string {
  const endpoint = OVERPASS_ENDPOINTS[currentEndpointIndex];
  currentEndpointIndex = (currentEndpointIndex + 1) % OVERPASS_ENDPOINTS.length;
  return endpoint;
}

// Get endpoint with rate limiting
async function getEndpointWithRateLimit(): Promise<string> {
  const now = Date.now();

  // Try each endpoint to find one that's not rate-limited
  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
    const endpoint = getNextEndpoint();
    const lastRequest = endpointLastRequest.get(endpoint) || 0;
    const timeSinceLastRequest = now - lastRequest;

    if (timeSinceLastRequest >= MIN_DELAY_PER_ENDPOINT) {
      endpointLastRequest.set(endpoint, now);
      return endpoint;
    }
  }

  // All endpoints are rate-limited, wait for the first one to be available
  const endpoint = OVERPASS_ENDPOINTS[0];
  const lastRequest = endpointLastRequest.get(endpoint) || 0;
  const waitTime = MIN_DELAY_PER_ENDPOINT - (now - lastRequest);
  if (waitTime > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
  endpointLastRequest.set(endpoint, Date.now());
  return endpoint;
}

// Retry helper for API calls - tries different endpoints on failure
async function fetchWithRetry(
  query: string,
  maxRetries: number = 3,
  initialDelay: number = 5000
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const endpoint = await getEndpointWithRateLimit();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });

      // Retry on 429 (rate limit) or 5xx errors
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error as Error;
      console.error(
        `  Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`
      );

      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt - 1);
        console.log(
          `  Retrying in ${delay / 1000}s (trying different endpoint)...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("All retry attempts failed");
}

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  members?: Array<{ type: string; ref: number; role?: string }>;
  geometry?: Array<{ lat: number; lon: number }>;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  // For nodes, lat/lon are direct properties
  lat?: number;
  lon?: number;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

// Known connected ski areas - manual overrides for areas that should load together
// Format: parentOsmId -> [connectedOsmIds]
// These supplement the automatic detection algorithm
const MANUAL_CONNECTED_SKI_AREAS: Record<string, string[]> = {
  // Les Trois Vallées connections (some sub-areas may not be auto-detected)
  "relation/3545276": [
    "relation/3962216", // Brides Les Bains
    "relation/3962218", // La Tania
    "relation/3962219", // Les Ménuires
    "relation/3962222", // Val Thorens
    "relation/19757448", // Val Thorens - Orelle
    "relation/19751525", // Orelle
  ],
};

// Ski areas within ~500m of each other are considered connected
const CONNECTION_THRESHOLD_METERS = 500;

// Calculate distance between two points using Haversine formula
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Quick check if bounding boxes are even close enough to warrant detailed check
// Uses ~5km buffer to filter out obviously distant areas
function boundsCouldOverlap(
  bounds1: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  bounds2: { minLat: number; maxLat: number; minLng: number; maxLng: number }
): boolean {
  const buffer = 0.05; // ~5km buffer for quick filtering
  const expanded = {
    minLat: bounds1.minLat - buffer,
    maxLat: bounds1.maxLat + buffer,
    minLng: bounds1.minLng - buffer,
    maxLng: bounds1.maxLng + buffer,
  };

  return !(
    expanded.maxLat < bounds2.minLat ||
    expanded.minLat > bounds2.maxLat ||
    expanded.maxLng < bounds2.minLng ||
    expanded.minLng > bounds2.maxLng
  );
}

// Extract all coordinates from a GeoJSON geometry
function extractCoordinates(geometry: unknown): Array<[number, number]> {
  const coords: Array<[number, number]> = [];

  if (!geometry || typeof geometry !== "object") return coords;

  const geo = geometry as { type?: string; coordinates?: unknown };

  if (!geo.type || !geo.coordinates) return coords;

  const extractFromArray = (arr: unknown): void => {
    if (!Array.isArray(arr)) return;

    // Check if this is a coordinate pair [lng, lat]
    if (
      arr.length >= 2 &&
      typeof arr[0] === "number" &&
      typeof arr[1] === "number"
    ) {
      coords.push([arr[1], arr[0]]); // Convert to [lat, lng]
      return;
    }

    // Otherwise recurse into nested arrays
    for (const item of arr) {
      extractFromArray(item);
    }
  };

  extractFromArray(geo.coordinates);
  return coords;
}

// Find the minimum distance between any two points from two sets of coordinates
function findMinimumDistance(
  coords1: Array<[number, number]>,
  coords2: Array<[number, number]>
): number {
  if (coords1.length === 0 || coords2.length === 0) return Infinity;

  let minDist = Infinity;

  // Sample coordinates if there are too many (for performance)
  const sample1 = coords1.length > 100 ? sampleArray(coords1, 100) : coords1;
  const sample2 = coords2.length > 100 ? sampleArray(coords2, 100) : coords2;

  for (const [lat1, lng1] of sample1) {
    for (const [lat2, lng2] of sample2) {
      const dist = haversineDistance(lat1, lng1, lat2, lng2);
      if (dist < minDist) {
        minDist = dist;
        // Early exit if we find a close point
        if (minDist < CONNECTION_THRESHOLD_METERS) return minDist;
      }
    }
  }

  return minDist;
}

// Evenly sample an array
function sampleArray<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
}

async function fetchSubRegionsFromOverpass(bounds: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}): Promise<OverpassElement[]> {
  // Query for ski area sites, administrative boundaries, AND place nodes (villages, hamlets)
  // This allows us to get resort names like "Méribel" even when they're not official administrative units
  const query = `
    [out:json][timeout:120];
    (
      // Ski area site relations
      relation["type"="site"]["site"="piste"](${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng});
      // French communes (admin_level 8) - these contain villages like Les Allues, etc.
      relation["boundary"="administrative"]["admin_level"="8"](${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng});
      // Place nodes - villages, hamlets, suburbs (e.g., Méribel, Méribel-Mottaret, Méribel Village)
      node["place"~"village|hamlet|suburb|neighbourhood"](${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng});
    );
    out body geom;
  `;

  const response = await fetchWithRetry(
    query,
    3, // maxRetries
    10000 // initialDelay (10s - Overpass needs longer cooldowns)
  );

  if (!response.ok) {
    throw new Error(
      `Overpass API error: ${response.status} ${response.statusText}`
    );
  }

  const data: OverpassResponse = await response.json();
  return data.elements;
}

function calculateCentroid(geometry: Array<{ lat: number; lon: number }>): {
  lat: number;
  lng: number;
} {
  if (!geometry || geometry.length === 0) {
    return { lat: 0, lng: 0 };
  }

  const sum = geometry.reduce(
    (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lon }),
    { lat: 0, lng: 0 }
  );

  return {
    lat: sum.lat / geometry.length,
    lng: sum.lng / geometry.length,
  };
}

function geometryToGeoJSON(
  geometry: Array<{ lat: number; lon: number }>
): object | null {
  if (!geometry || geometry.length < 3) return null;

  // Convert to GeoJSON polygon
  const coordinates = geometry.map((p) => [p.lon, p.lat]);
  // Close the polygon if not already closed
  if (coordinates.length > 0) {
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coordinates.push([...first]);
    }
  }

  return {
    type: "Polygon",
    coordinates: [coordinates],
  };
}

function boundsToJson(bounds: {
  minlat: number;
  minlon: number;
  maxlat: number;
  maxlon: number;
}): object {
  return {
    minLat: bounds.minlat,
    maxLat: bounds.maxlat,
    minLng: bounds.minlon,
    maxLng: bounds.maxlon,
  };
}

// Deduplicate sub-regions by name - merge duplicates intelligently
function deduplicateSubRegionsByName(
  elements: OverpassElement[]
): OverpassElement[] {
  const byName = new Map<string, OverpassElement[]>();

  // Group by name
  for (const el of elements) {
    const name = el.tags?.name?.toLowerCase().trim() || "";
    if (!name) continue;

    if (!byName.has(name)) {
      byName.set(name, []);
    }
    byName.get(name)!.push(el);
  }

  const deduplicated: OverpassElement[] = [];

  for (const [name, group] of byName) {
    if (group.length === 1) {
      deduplicated.push(group[0]);
      continue;
    }

    // Multiple elements with same name - choose the best one
    // Priority: relations (polygons) > nodes with bounds > nodes (points)

    // Check for polygon relations (piste or administrative)
    const polygons = group.filter((el) => {
      if (el.type !== "relation") return false;
      const hasSite = el.tags?.site === "piste";
      const hasAdminBoundary = el.tags?.boundary === "administrative";
      return hasSite || hasAdminBoundary;
    });

    if (polygons.length > 0) {
      // Use the largest polygon (by bounds area)
      let best = polygons[0];
      let bestArea = 0;

      for (const poly of polygons) {
        if (poly.bounds) {
          const area =
            (poly.bounds.maxlat - poly.bounds.minlat) *
            (poly.bounds.maxlon - poly.bounds.minlon);
          if (area > bestArea) {
            bestArea = area;
            best = poly;
          }
        }
      }

      deduplicated.push(best);
      continue;
    }

    // No polygons, use any node
    // Prefer nodes with more metadata
    let best = group[0];
    let bestScore = 0;

    for (const node of group) {
      let score = 0;
      if (node.tags?.place) score += 2;
      if (node.tags?.population) score += 1;
      if (node.tags?.wikidata) score += 1;

      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }

    deduplicated.push(best);
  }

  return deduplicated;
}

interface SyncResult {
  skiAreaName: string;
  skiAreaId: string;
  logs: string[];
  subRegionsFound: number;
  subRegionsProcessed: number;
  success: boolean;
  error?: string;
}

async function syncSubRegionsForSkiArea(
  skiAreaId: string,
  dryRun: boolean = false
): Promise<SyncResult> {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  const skiArea = await prisma.skiArea.findUnique({
    where: { id: skiAreaId },
    include: { subRegions: true },
  });

  if (!skiArea) {
    return {
      skiAreaName: "Unknown",
      skiAreaId,
      logs: [`Error: Ski area not found: ${skiAreaId}`],
      subRegionsFound: 0,
      subRegionsProcessed: 0,
      success: false,
      error: "Ski area not found",
    };
  }

  if (!skiArea.bounds) {
    return {
      skiAreaName: skiArea.name,
      skiAreaId,
      logs: [`Error: Ski area has no bounds: ${skiArea.name}`],
      subRegionsFound: 0,
      subRegionsProcessed: 0,
      success: false,
      error: "No bounds",
    };
  }

  const bounds = skiArea.bounds as {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };

  // Expand bounds by ~500m to catch nearby sub-regions
  // At alpine latitudes: 0.005° ≈ 500m
  const expandedBounds = {
    minLat: bounds.minLat - 0.005,
    maxLat: bounds.maxLat + 0.005,
    minLng: bounds.minLng - 0.005,
    maxLng: bounds.maxLng + 0.005,
  };

  log(`Syncing sub-regions for: ${skiArea.name} (${skiAreaId})`);

  const elements = await fetchSubRegionsFromOverpass(expandedBounds);

  // Count by type
  const nodeCount = elements.filter((e) => e.type === "node").length;
  const relationCount = elements.filter((e) => e.type === "relation").length;
  log(
    `Found ${elements.length} potential sub-regions (${relationCount} relations, ${nodeCount} place nodes)`
  );

  // Filter out the parent ski area itself and elements without names
  let subRegions = elements.filter((el) => {
    const osmId = `${el.type}/${el.id}`;
    // Skip if this is the parent ski area
    if (skiArea.osmId === osmId) return false;
    // Skip if no name
    if (!el.tags?.name) return false;
    return true;
  });

  // Deduplicate by name
  const beforeDedup = subRegions.length;
  subRegions = deduplicateSubRegionsByName(subRegions);
  if (beforeDedup > subRegions.length) {
    log(
      `Deduplicated ${
        beforeDedup - subRegions.length
      } sub-regions with identical names`
    );
  }

  log(`Processing ${subRegions.length} potential sub-regions`);

  for (const element of subRegions) {
    const osmId = `${element.type}/${element.id}`;
    const name = element.tags?.name || "Unknown";
    const placeType =
      element.tags?.place ||
      element.tags?.site ||
      element.tags?.boundary ||
      "unknown";

    // Calculate geometry and centroid
    let geometry = null;
    let centroid = null;
    let subBounds = null;

    // Handle nodes (have direct lat/lon)
    if (
      element.type === "node" &&
      element.lat !== undefined &&
      element.lon !== undefined
    ) {
      centroid = { lat: element.lat, lng: element.lon };
      // Create a small point geometry for nodes
      geometry = {
        type: "Point",
        coordinates: [element.lon, element.lat],
      };
    }
    // Handle relations (have geometry array and/or bounds)
    else {
      if (element.geometry && element.geometry.length > 0) {
        geometry = geometryToGeoJSON(element.geometry);
        centroid = calculateCentroid(element.geometry);
      }

      if (element.bounds) {
        subBounds = boundsToJson(element.bounds);
        if (!centroid) {
          centroid = {
            lat: (element.bounds.minlat + element.bounds.maxlat) / 2,
            lng: (element.bounds.minlon + element.bounds.maxlon) / 2,
          };
        }
      }
    }

    log(`  - ${name} (${osmId}) [${placeType}]`);

    if (dryRun) {
      log(`    [DRY RUN] Would create/update sub-region`);
      continue;
    }

    // Upsert sub-region
    await prisma.subRegion.upsert({
      where: { osmId },
      create: {
        osmId,
        name,
        geometry,
        bounds: subBounds,
        centroid,
        skiAreaId: skiArea.id,
      },
      update: {
        name,
        geometry,
        bounds: subBounds,
        centroid,
      },
    });
  }

  // Handle manual connected ski areas overrides
  if (skiArea.osmId && MANUAL_CONNECTED_SKI_AREAS[skiArea.osmId]) {
    log(`Processing manual connected ski areas for ${skiArea.name}...`);

    for (const connectedOsmId of MANUAL_CONNECTED_SKI_AREAS[skiArea.osmId]) {
      const connectedArea = await prisma.skiArea.findFirst({
        where: { osmId: connectedOsmId },
      });

      if (connectedArea) {
        log(`  [Manual] Connecting: ${skiArea.name} <-> ${connectedArea.name}`);

        if (!dryRun) {
          // Create bidirectional connection
          await prisma.skiAreaConnection.upsert({
            where: {
              fromAreaId_toAreaId: {
                fromAreaId: skiArea.id,
                toAreaId: connectedArea.id,
              },
            },
            create: {
              fromAreaId: skiArea.id,
              toAreaId: connectedArea.id,
            },
            update: {},
          });
        }
      } else {
        log(`  [WARN] Connected area not found in DB: ${connectedOsmId}`);
      }
    }
  }

  return {
    skiAreaName: skiArea.name,
    skiAreaId,
    logs,
    subRegionsFound: elements.length,
    subRegionsProcessed: subRegions.length,
    success: true,
  };
}

// Automatically detect connected ski areas based on actual run/lift geometry proximity
async function detectConnectedSkiAreas(dryRun: boolean = false) {
  console.log("\n=== Detecting Connected Ski Areas ===");
  console.log("Using geometry-based distance check (not bounding boxes)");

  const skiAreas = await prisma.skiArea.findMany({
    where: { bounds: { not: null } },
    select: {
      id: true,
      name: true,
      osmId: true,
      bounds: true,
      latitude: true,
      longitude: true,
    },
  });

  console.log(`Checking ${skiAreas.length} ski areas for connections...`);

  // Cache for geometry coordinates to avoid repeated DB queries
  const geometryCache = new Map<string, Array<[number, number]>>();

  async function getSkiAreaCoordinates(
    areaId: string
  ): Promise<Array<[number, number]>> {
    if (geometryCache.has(areaId)) {
      return geometryCache.get(areaId)!;
    }

    // Get all run and lift geometries for this ski area
    const [runs, lifts] = await Promise.all([
      prisma.run.findMany({
        where: { skiAreaId: areaId },
        select: { geometry: true },
      }),
      prisma.lift.findMany({
        where: { skiAreaId: areaId },
        select: { geometry: true },
      }),
    ]);

    const allCoords: Array<[number, number]> = [];

    for (const run of runs) {
      allCoords.push(...extractCoordinates(run.geometry));
    }
    for (const lift of lifts) {
      allCoords.push(...extractCoordinates(lift.geometry));
    }

    geometryCache.set(areaId, allCoords);
    return allCoords;
  }

  let connectionsFound = 0;
  let pairsChecked = 0;
  let pairsSkipped = 0;
  const processedPairs = new Set<string>();

  for (let i = 0; i < skiAreas.length; i++) {
    const area1 = skiAreas[i];
    const bounds1 = area1.bounds as {
      minLat: number;
      maxLat: number;
      minLng: number;
      maxLng: number;
    } | null;
    if (!bounds1) continue;

    for (let j = i + 1; j < skiAreas.length; j++) {
      const area2 = skiAreas[j];
      const bounds2 = area2.bounds as {
        minLat: number;
        maxLat: number;
        minLng: number;
        maxLng: number;
      } | null;
      if (!bounds2) continue;

      // Skip if we've already processed this pair
      const pairKey = [area1.id, area2.id].sort().join("-");
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      // Quick check: if bounding boxes aren't even within 5km, skip
      if (!boundsCouldOverlap(bounds1, bounds2)) {
        pairsSkipped++;
        continue;
      }

      pairsChecked++;

      // Get actual geometry coordinates
      const coords1 = await getSkiAreaCoordinates(area1.id);
      const coords2 = await getSkiAreaCoordinates(area2.id);

      if (coords1.length === 0 || coords2.length === 0) continue;

      // Calculate minimum distance between actual run/lift points
      const minDistance = findMinimumDistance(coords1, coords2);

      if (minDistance <= CONNECTION_THRESHOLD_METERS) {
        console.log(
          `  Found connection: ${area1.name} <-> ${area2.name} (${Math.round(
            minDistance
          )}m apart)`
        );
        connectionsFound++;

        if (!dryRun) {
          // Create bidirectional connection
          try {
            await prisma.skiAreaConnection.upsert({
              where: {
                fromAreaId_toAreaId: {
                  fromAreaId: area1.id,
                  toAreaId: area2.id,
                },
              },
              create: {
                fromAreaId: area1.id,
                toAreaId: area2.id,
              },
              update: {},
            });

            await prisma.skiAreaConnection.upsert({
              where: {
                fromAreaId_toAreaId: {
                  fromAreaId: area2.id,
                  toAreaId: area1.id,
                },
              },
              create: {
                fromAreaId: area2.id,
                toAreaId: area1.id,
              },
              update: {},
            });
          } catch (e) {
            // Ignore duplicate key errors
          }
        }
      }
    }
  }

  console.log("");
  console.log(`  Pairs skipped (>5km apart): ${pairsSkipped}`);
  console.log(`  Pairs checked (geometry): ${pairsChecked}`);
  console.log(
    `  Connections found (<${CONNECTION_THRESHOLD_METERS}m): ${connectionsFound}`
  );
}

interface AssignResult {
  logs: string[];
  runsAssigned: number;
  liftsAssigned: number;
  subRegionStats: Map<
    string,
    { name: string; runCount: number; liftCount: number }
  >;
}

// Point-in-polygon test using ray casting algorithm
function isPointInPolygon(
  lat: number,
  lng: number,
  polygon: number[][]
): boolean {
  let inside = false;
  const x = lng,
    y = lat;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0],
      yi = polygon[i][1];
    const xj = polygon[j][0],
      yj = polygon[j][1];

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

// Extract polygon coordinates from GeoJSON for point-in-polygon testing
function extractPolygonRings(geometry: unknown): number[][][] {
  const rings: number[][][] = [];

  if (!geometry || typeof geometry !== "object") return rings;

  const geo = geometry as { type?: string; coordinates?: unknown };

  if (geo.type === "Polygon" && Array.isArray(geo.coordinates)) {
    // Polygon has coordinates: [[[lng, lat], ...]]
    for (const ring of geo.coordinates as number[][][]) {
      if (Array.isArray(ring) && ring.length >= 3) {
        rings.push(ring);
      }
    }
  } else if (geo.type === "MultiPolygon" && Array.isArray(geo.coordinates)) {
    // MultiPolygon has coordinates: [[[[lng, lat], ...]]]
    for (const polygon of geo.coordinates as number[][][][]) {
      if (Array.isArray(polygon)) {
        for (const ring of polygon) {
          if (Array.isArray(ring) && ring.length >= 3) {
            rings.push(ring);
          }
        }
      }
    }
  }

  return rings;
}

// Get the endpoints of a run (bottom = lowest elevation or last point, top = first point)
function getRunEndpoints(geometry: unknown): {
  bottom: { lat: number; lng: number };
  top: { lat: number; lng: number };
} | null {
  if (!geometry || typeof geometry !== "object") return null;

  const geo = geometry as {
    type?: string;
    coordinates?: number[][] | number[][][];
  };

  let coords: number[][] = [];

  if (geo.type === "LineString" && Array.isArray(geo.coordinates)) {
    coords = geo.coordinates as number[][];
  } else if (geo.type === "Polygon" && Array.isArray(geo.coordinates)) {
    coords = (geo.coordinates as number[][][])[0] || [];
  }

  if (coords.length < 2) return null;

  // Top = first point, Bottom = last point (runs typically go downhill)
  const first = coords[0];
  const last = coords[coords.length - 1];

  return {
    top: { lat: first[1], lng: first[0] },
    bottom: { lat: last[1], lng: last[0] },
  };
}

// Get the start point of a lift (bottom station)
function getLiftStartPoint(
  geometry: unknown
): { lat: number; lng: number } | null {
  if (!geometry || typeof geometry !== "object") return null;

  const geo = geometry as { type?: string; coordinates?: number[][] };

  if (
    geo.type === "LineString" &&
    Array.isArray(geo.coordinates) &&
    geo.coordinates.length >= 1
  ) {
    const first = geo.coordinates[0];
    return { lat: first[1], lng: first[0] };
  }

  return null;
}

// Get all endpoints of a run for deduplication checks
function getRunAllEndpoints(geometry: unknown): { lat: number; lng: number }[] {
  if (!geometry || typeof geometry !== "object") return [];

  const geo = geometry as {
    type?: string;
    coordinates?: number[][] | number[][][];
  };

  let coords: number[][] = [];

  if (geo.type === "LineString" && Array.isArray(geo.coordinates)) {
    coords = geo.coordinates as number[][];
  } else if (geo.type === "Polygon" && Array.isArray(geo.coordinates)) {
    coords = (geo.coordinates as number[][][])[0] || [];
  }

  if (coords.length < 1) return [];

  const endpoints: { lat: number; lng: number }[] = [];
  endpoints.push({ lat: coords[0][1], lng: coords[0][0] });
  if (coords.length > 1) {
    endpoints.push({
      lat: coords[coords.length - 1][1],
      lng: coords[coords.length - 1][0],
    });
  }
  return endpoints;
}

// Check if a point is inside any of the polygon rings
function isPointInSubRegionGeometry(
  lat: number,
  lng: number,
  subRegionGeometry: unknown
): boolean {
  const rings = extractPolygonRings(subRegionGeometry);

  // Check outer rings only (first ring is always the outer ring)
  for (const ring of rings) {
    if (isPointInPolygon(lat, lng, ring)) {
      return true;
    }
  }

  return false;
}

// Get all coordinates from a geometry as array of [lat, lng] pairs
function getAllCoordinates(
  geometry: unknown
): Array<{ lat: number; lng: number }> {
  if (!geometry || typeof geometry !== "object") return [];

  const geo = geometry as {
    type?: string;
    coordinates?: number[][] | number[][][];
  };
  const result: Array<{ lat: number; lng: number }> = [];

  if (geo.type === "LineString" && Array.isArray(geo.coordinates)) {
    for (const coord of geo.coordinates as number[][]) {
      result.push({ lat: coord[1], lng: coord[0] });
    }
  } else if (geo.type === "Polygon" && Array.isArray(geo.coordinates)) {
    for (const coord of (geo.coordinates as number[][][])[0] || []) {
      result.push({ lat: coord[1], lng: coord[0] });
    }
  }

  return result;
}

// Check if any point of a geometry intersects with a sub-region boundary
function doesGeometryIntersectSubRegion(
  geometry: unknown,
  subRegionGeometry: unknown
): boolean {
  const coords = getAllCoordinates(geometry);

  for (const coord of coords) {
    if (isPointInSubRegionGeometry(coord.lat, coord.lng, subRegionGeometry)) {
      return true;
    }
  }

  return false;
}

// Maximum distance in meters for matching runs to place nodes (villages, etc.)
const MAX_VILLAGE_MATCH_DISTANCE = 3000; // 3km - villages can be a bit spread out

async function assignRunsAndLiftsToSubRegions(
  skiAreaId: string,
  dryRun: boolean = false
): Promise<AssignResult> {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);
  const subRegionStats = new Map<
    string,
    { name: string; runCount: number; liftCount: number }
  >();

  const skiArea = await prisma.skiArea.findUnique({
    where: { id: skiAreaId },
    include: {
      runs: true,
      lifts: true,
      subRegions: true,
    },
  });

  if (!skiArea) {
    return {
      logs: [`Error: Ski area not found: ${skiAreaId}`],
      runsAssigned: 0,
      liftsAssigned: 0,
      subRegionStats,
    };
  }

  if (skiArea.subRegions.length === 0) {
    return {
      logs: [`No sub-regions found for ${skiArea.name}`],
      runsAssigned: 0,
      liftsAssigned: 0,
      subRegionStats,
    };
  }

  log(
    `Assigning runs/lifts: ${skiArea.subRegions.length} sub-regions, ${skiArea.runs.length} runs, ${skiArea.lifts.length} lifts`
  );

  // Initialize stats for all sub-regions
  for (const sr of skiArea.subRegions) {
    subRegionStats.set(sr.id, { name: sr.name, runCount: 0, liftCount: 0 });
  }

  // Separate sub-regions into polygon-based and point-based
  const polygonSubRegions = skiArea.subRegions.filter((sr) => {
    const geo = sr.geometry as { type?: string } | null;
    return geo && (geo.type === "Polygon" || geo.type === "MultiPolygon");
  });

  const pointSubRegions = skiArea.subRegions.filter((sr) => {
    const geo = sr.geometry as { type?: string } | null;
    return !geo || geo.type === "Point";
  });

  log(`  Sub-regions with polygon boundaries: ${polygonSubRegions.length}`);
  log(`  Sub-regions with point only: ${pointSubRegions.length}`);

  // Deduplicate runs by name + proximity
  // Group runs by name
  const runsByName = new Map<string, typeof skiArea.runs>();
  for (const run of skiArea.runs) {
    const name = run.name?.toLowerCase().trim() || "";
    if (!runsByName.has(name)) {
      runsByName.set(name, []);
    }
    runsByName.get(name)!.push(run);
  }

  // Find duplicate runs (same name, one end within 100m of another's end)
  const duplicateRunIds = new Set<string>();
  for (const [name, runs] of runsByName) {
    if (!name || runs.length < 2) continue;

    // Check each pair of runs with same name
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const endpoints1 = getRunAllEndpoints(runs[i].geometry);
        const endpoints2 = getRunAllEndpoints(runs[j].geometry);

        // Check if any endpoint of run1 is within 100m of any endpoint of run2
        let isClose = false;
        for (const ep1 of endpoints1) {
          for (const ep2 of endpoints2) {
            const dist = haversineDistance(ep1.lat, ep1.lng, ep2.lat, ep2.lng);
            if (dist <= 100) {
              isClose = true;
              break;
            }
          }
          if (isClose) break;
        }

        if (isClose) {
          // Mark the second one as duplicate (keep the first)
          duplicateRunIds.add(runs[j].id);
        }
      }
    }
  }

  if (duplicateRunIds.size > 0) {
    log(
      `  Identified ${duplicateRunIds.size} duplicate runs (same name, ends within 100m)`
    );
  }

  let runsAssigned = 0;
  let runsByPolygon = 0;
  let runsByProximity = 0;

  // Assign runs to sub-regions
  for (const run of skiArea.runs) {
    // Skip duplicates
    if (duplicateRunIds.has(run.id)) {
      continue;
    }

    const endpoints = getRunEndpoints(run.geometry);
    if (!endpoints) continue;

    let bestSubRegion: (typeof skiArea.subRegions)[0] | null = null;

    // Strategy 1: Check if run is fully contained in or intersects with a polygon sub-region
    for (const subRegion of polygonSubRegions) {
      // Check if bottom of run is within polygon
      if (
        isPointInSubRegionGeometry(
          endpoints.bottom.lat,
          endpoints.bottom.lng,
          subRegion.geometry
        )
      ) {
        bestSubRegion = subRegion;
        runsByPolygon++;
        break;
      }
      // Check if top of run is within polygon
      if (
        isPointInSubRegionGeometry(
          endpoints.top.lat,
          endpoints.top.lng,
          subRegion.geometry
        )
      ) {
        bestSubRegion = subRegion;
        runsByPolygon++;
        break;
      }
      // Check if any point of the run intersects with the polygon
      if (doesGeometryIntersectSubRegion(run.geometry, subRegion.geometry)) {
        bestSubRegion = subRegion;
        runsByPolygon++;
        break;
      }
    }

    // Strategy 2: If not in a polygon, find nearest point-based sub-region to the bottom of the run
    if (!bestSubRegion) {
      let bestDistance = Infinity;

      for (const subRegion of pointSubRegions) {
        const subCentroid = subRegion.centroid as {
          lat: number;
          lng: number;
        } | null;
        if (!subCentroid) continue;

        // Distance from bottom of run to village/hamlet
        const distance = haversineDistance(
          endpoints.bottom.lat,
          endpoints.bottom.lng,
          subCentroid.lat,
          subCentroid.lng
        );

        if (distance < bestDistance && distance <= MAX_VILLAGE_MATCH_DISTANCE) {
          bestDistance = distance;
          bestSubRegion = subRegion;
        }
      }

      // Also check if polygon sub-regions are closer by centroid
      for (const subRegion of polygonSubRegions) {
        const subCentroid = subRegion.centroid as {
          lat: number;
          lng: number;
        } | null;
        if (!subCentroid) continue;

        const distance = haversineDistance(
          endpoints.bottom.lat,
          endpoints.bottom.lng,
          subCentroid.lat,
          subCentroid.lng
        );

        if (distance < bestDistance && distance <= MAX_VILLAGE_MATCH_DISTANCE) {
          bestDistance = distance;
          bestSubRegion = subRegion;
        }
      }

      if (bestSubRegion) {
        runsByProximity++;
      }
    }

    if (bestSubRegion) {
      if (run.subRegionId !== bestSubRegion.id) {
        if (!dryRun) {
          await prisma.run.update({
            where: { id: run.id },
            data: { subRegionId: bestSubRegion.id },
          });
        }
        runsAssigned++;
      }
      // Update stats
      const stats = subRegionStats.get(bestSubRegion.id)!;
      stats.runCount++;
    }
  }

  log(
    `  → Assigned ${runsAssigned} runs (${runsByPolygon} by polygon, ${runsByProximity} by proximity)`
  );

  // Assign lifts to sub-regions
  let liftsAssigned = 0;
  let liftsByPolygon = 0;
  let liftsByProximity = 0;

  for (const lift of skiArea.lifts) {
    const startPoint = getLiftStartPoint(lift.geometry);
    if (!startPoint) continue;

    let bestSubRegion: (typeof skiArea.subRegions)[0] | null = null;

    // Strategy 1: Check if lift start is within a polygon sub-region
    for (const subRegion of polygonSubRegions) {
      if (
        isPointInSubRegionGeometry(
          startPoint.lat,
          startPoint.lng,
          subRegion.geometry
        )
      ) {
        bestSubRegion = subRegion;
        liftsByPolygon++;
        break;
      }
      // Also check if any point of the lift intersects
      if (doesGeometryIntersectSubRegion(lift.geometry, subRegion.geometry)) {
        bestSubRegion = subRegion;
        liftsByPolygon++;
        break;
      }
    }

    // Strategy 2: Find nearest point-based sub-region to the start of the lift
    if (!bestSubRegion) {
      let bestDistance = Infinity;

      for (const subRegion of pointSubRegions) {
        const subCentroid = subRegion.centroid as {
          lat: number;
          lng: number;
        } | null;
        if (!subCentroid) continue;

        const distance = haversineDistance(
          startPoint.lat,
          startPoint.lng,
          subCentroid.lat,
          subCentroid.lng
        );

        if (distance < bestDistance && distance <= MAX_VILLAGE_MATCH_DISTANCE) {
          bestDistance = distance;
          bestSubRegion = subRegion;
        }
      }

      // Also check polygon sub-regions by centroid
      for (const subRegion of polygonSubRegions) {
        const subCentroid = subRegion.centroid as {
          lat: number;
          lng: number;
        } | null;
        if (!subCentroid) continue;

        const distance = haversineDistance(
          startPoint.lat,
          startPoint.lng,
          subCentroid.lat,
          subCentroid.lng
        );

        if (distance < bestDistance && distance <= MAX_VILLAGE_MATCH_DISTANCE) {
          bestDistance = distance;
          bestSubRegion = subRegion;
        }
      }

      if (bestSubRegion) {
        liftsByProximity++;
      }
    }

    if (bestSubRegion) {
      if (lift.subRegionId !== bestSubRegion.id) {
        if (!dryRun) {
          await prisma.lift.update({
            where: { id: lift.id },
            data: { subRegionId: bestSubRegion.id },
          });
        }
        liftsAssigned++;
      }
      // Update stats
      const stats = subRegionStats.get(bestSubRegion.id)!;
      stats.liftCount++;
    }
  }

  log(
    `  → Assigned ${liftsAssigned} lifts (${liftsByPolygon} by polygon, ${liftsByProximity} by proximity)`
  );

  return { logs, runsAssigned, liftsAssigned, subRegionStats };
}

// Remove sub-regions that have no runs or lifts assigned
async function cleanupUnusedSubRegions(
  skiAreaId: string,
  dryRun: boolean = false
): Promise<{ logs: string[]; removed: number }> {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  const unusedSubRegions = await prisma.subRegion.findMany({
    where: {
      skiAreaId,
      AND: [{ runs: { none: {} } }, { lifts: { none: {} } }],
    },
    select: { id: true, name: true },
  });

  if (unusedSubRegions.length > 0) {
    log(
      `  Removing ${unusedSubRegions.length} unused sub-regions (no runs/lifts):`
    );
    for (const sr of unusedSubRegions.slice(0, 5)) {
      log(`    - ${sr.name}`);
    }
    if (unusedSubRegions.length > 5) {
      log(`    ... and ${unusedSubRegions.length - 5} more`);
    }

    if (!dryRun) {
      await prisma.subRegion.deleteMany({
        where: {
          id: { in: unusedSubRegions.map((sr) => sr.id) },
        },
      });
    }
  }

  return { logs, removed: unusedSubRegions.length };
}

// Print sub-region summary with run/lift counts
function printSubRegionSummary(
  stats: Map<string, { name: string; runCount: number; liftCount: number }>,
  logs: string[]
): void {
  // Sort by total count descending
  const sorted = Array.from(stats.entries())
    .map(([id, stat]) => ({
      id,
      ...stat,
      total: stat.runCount + stat.liftCount,
    }))
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total);

  if (sorted.length === 0) return;

  logs.push(`  Sub-region assignment summary:`);
  for (const stat of sorted.slice(0, 15)) {
    logs.push(
      `    ${stat.name}: ${stat.runCount} runs, ${stat.liftCount} lifts`
    );
  }
  if (sorted.length > 15) {
    logs.push(`    ... and ${sorted.length - 15} more sub-regions`);
  }
}

// Deduplicate sub-regions by name at the database level
// This catches duplicates that weren't caught during Overpass data processing
async function deduplicateSubRegionsInDatabase(
  skiAreaId: string,
  dryRun: boolean = false
): Promise<{ logs: string[]; merged: number }> {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  // Get all sub-regions for this ski area
  const subRegions = await prisma.subRegion.findMany({
    where: { skiAreaId },
    include: {
      runs: { select: { id: true } },
      lifts: { select: { id: true } },
    },
  });

  if (subRegions.length === 0) {
    return { logs, merged: 0 };
  }

  // Group by normalized name (lowercase, trimmed)
  const byName = new Map<string, typeof subRegions>();
  for (const sr of subRegions) {
    const normalizedName = sr.name.toLowerCase().trim();
    if (!byName.has(normalizedName)) {
      byName.set(normalizedName, []);
    }
    byName.get(normalizedName)!.push(sr);
  }

  let mergedCount = 0;

  // Process each group with duplicates
  for (const [normalizedName, group] of byName) {
    if (group.length <= 1) continue; // No duplicates

    log(`  Found ${group.length} sub-regions named "${group[0].name}":`);

    // Choose the best one to keep
    // Priority:
    // 1. Has polygon geometry (not just a point)
    // 2. Most runs + lifts
    // 3. Largest bounds area
    let best = group[0];
    let bestScore = 0;

    for (const sr of group) {
      let score = 0;

      // Prefer regions with polygon geometry
      const geo = sr.geometry as { type?: string } | null;
      if (geo && (geo.type === "Polygon" || geo.type === "MultiPolygon")) {
        score += 1000;
      }

      // Prefer regions with more runs/lifts
      const totalFeatures = sr.runs.length + sr.lifts.length;
      score += totalFeatures * 10;

      // Prefer regions with larger bounds
      if (sr.bounds) {
        const bounds = sr.bounds as {
          minLat: number;
          maxLat: number;
          minLng: number;
          maxLng: number;
        };
        const area =
          (bounds.maxLat - bounds.minLat) * (bounds.maxLng - bounds.minLng);
        score += area * 100;
      }

      log(
        `    - ${sr.osmId}: ${sr.runs.length}R+${sr.lifts.length}L, ${
          geo?.type || "Point"
        }, score=${score.toFixed(0)}`
      );

      if (score > bestScore) {
        bestScore = score;
        best = sr;
      }
    }

    log(
      `    → Keeping ${best.osmId}, merging ${
        group.length - 1
      } duplicates into it`
    );

    // Merge all others into the best one
    for (const sr of group) {
      if (sr.id === best.id) continue;

      if (!dryRun) {
        // Move runs and lifts to the best sub-region
        await prisma.run.updateMany({
          where: { subRegionId: sr.id },
          data: { subRegionId: best.id },
        });

        await prisma.lift.updateMany({
          where: { subRegionId: sr.id },
          data: { subRegionId: best.id },
        });

        // Delete the duplicate
        await prisma.subRegion.delete({
          where: { id: sr.id },
        });
      }

      mergedCount++;
    }
  }

  if (mergedCount > 0) {
    log(`  → Merged ${mergedCount} duplicate sub-regions by name`);
  }

  return { logs, merged: mergedCount };
}

// Merge small sub-regions into larger overlapping ones
// Small = fewer than N runs/lifts, Large = more than M runs/lifts
const SMALL_REGION_THRESHOLD = 5; // Regions with <= 5 runs/lifts are considered small
const LARGE_REGION_THRESHOLD = 15; // Regions with >= 15 runs/lifts are considered large enough to merge into

async function mergeSmallIntoLargeSubRegions(
  skiAreaId: string,
  dryRun: boolean = false
): Promise<{ logs: string[]; merged: number }> {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  // Get all sub-regions with their run/lift counts
  const subRegions = await prisma.subRegion.findMany({
    where: { skiAreaId },
    include: {
      runs: { select: { id: true, geometry: true } },
      lifts: { select: { id: true, geometry: true } },
    },
  });

  if (subRegions.length === 0) {
    return { logs, merged: 0 };
  }

  // Separate small and large sub-regions
  const smallRegions = subRegions.filter((sr) => {
    const total = sr.runs.length + sr.lifts.length;
    return total > 0 && total <= SMALL_REGION_THRESHOLD;
  });

  const largeRegions = subRegions.filter((sr) => {
    const total = sr.runs.length + sr.lifts.length;
    return total >= LARGE_REGION_THRESHOLD;
  });

  if (smallRegions.length === 0 || largeRegions.length === 0) {
    return { logs, merged: 0 };
  }

  log(
    `  Merging small sub-regions (≤${SMALL_REGION_THRESHOLD} runs/lifts) into larger ones (≥${LARGE_REGION_THRESHOLD} runs/lifts)`
  );
  log(
    `  Found ${smallRegions.length} small and ${largeRegions.length} large sub-regions`
  );

  let mergedCount = 0;

  // For each small region, check if any of its runs/lifts overlap with a large region
  for (const smallRegion of smallRegions) {
    const allGeometries = [
      ...smallRegion.runs.map((r) => r.geometry),
      ...smallRegion.lifts.map((l) => l.geometry),
    ];

    if (allGeometries.length === 0) continue;

    // Extract all coordinates from this small region's runs/lifts
    const smallCoords: Array<{ lat: number; lng: number }> = [];
    for (const geom of allGeometries) {
      smallCoords.push(...getAllCoordinates(geom));
    }

    if (smallCoords.length === 0) continue;

    // Check each large region to see if any of the small region's coordinates intersect
    let bestLargeRegion: (typeof largeRegions)[0] | null = null;
    let bestOverlapCount = 0;

    for (const largeRegion of largeRegions) {
      // Skip if this is the main ski area (typically named after the whole resort)
      // We want to avoid merging everything into the top-level region
      if (largeRegion.name === smallRegion.name) continue;

      const largeGeometry = largeRegion.geometry;
      if (!largeGeometry) continue;

      // Check if this large region has polygon boundaries
      const rings = extractPolygonRings(largeGeometry);
      if (rings.length === 0) continue;

      // Count how many points from small region overlap with large region
      let overlapCount = 0;
      for (const coord of smallCoords) {
        if (isPointInSubRegionGeometry(coord.lat, coord.lng, largeGeometry)) {
          overlapCount++;
        }
      }

      if (overlapCount > bestOverlapCount) {
        bestOverlapCount = overlapCount;
        bestLargeRegion = largeRegion;
      }
    }

    // If we found a large region with overlap, merge the small region into it
    if (bestLargeRegion && bestOverlapCount > 0) {
      log(
        `    Merging "${smallRegion.name}" (${smallRegion.runs.length}R+${smallRegion.lifts.length}L) into "${bestLargeRegion.name}" (${bestOverlapCount}/${smallCoords.length} points overlap)`
      );

      if (!dryRun) {
        // Update all runs/lifts from small region to point to large region
        await prisma.run.updateMany({
          where: { subRegionId: smallRegion.id },
          data: { subRegionId: bestLargeRegion.id },
        });

        await prisma.lift.updateMany({
          where: { subRegionId: smallRegion.id },
          data: { subRegionId: bestLargeRegion.id },
        });

        // Delete the small region
        await prisma.subRegion.delete({
          where: { id: smallRegion.id },
        });
      }

      mergedCount++;
    }
  }

  if (mergedCount > 0) {
    log(`  → Merged ${mergedCount} small sub-regions into larger ones`);
  }

  return { logs, merged: mergedCount };
}

async function main() {
  const startTime = Date.now();
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const skiAreaIdArg = args.find((a) => a.startsWith("--ski-area-id="));
  const skiAreaId = skiAreaIdArg?.split("=")[1];
  const connectionsOnly = args.includes("--connections-only");
  const skipConnections = args.includes("--skip-connections");
  const forceRestart = args.includes("--force-restart");

  console.log("");
  console.log(
    "╔══════════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║  🏔️  SUB-REGION & CONNECTION SYNC                                 ║"
  );
  console.log(
    "╠══════════════════════════════════════════════════════════════════╣"
  );
  console.log(`║  Started: ${new Date().toISOString()}                   ║`);
  if (dryRun)
    console.log(
      "║  🔍 DRY RUN - No changes will be made                            ║"
    );
  if (connectionsOnly)
    console.log(
      "║  🔗 Connections only mode                                         ║"
    );
  if (skipConnections)
    console.log(
      "║  ⏭️  Skipping connection detection                                ║"
    );
  if (forceRestart)
    console.log(
      "║  🔄 Force restart - clearing existing data                       ║"
    );
  if (skiAreaId)
    console.log(
      `║  📍 Single ski area: ${skiAreaId.substring(
        0,
        20
      )}...                     ║`
    );
  console.log(
    "╚══════════════════════════════════════════════════════════════════╝"
  );
  console.log("");

  try {
    // If force restart, delete all existing sub-regions (keeps ski area connections)
    if (forceRestart && !dryRun) {
      console.log("\n🗑️  Force restart: Deleting all existing sub-regions...");

      // First, clear subRegionId from all runs and lifts
      const runsUpdated = await prisma.run.updateMany({
        where: { subRegionId: { not: null } },
        data: { subRegionId: null },
      });
      console.log(`  Cleared subRegionId from ${runsUpdated.count} runs`);

      const liftsUpdated = await prisma.lift.updateMany({
        where: { subRegionId: { not: null } },
        data: { subRegionId: null },
      });
      console.log(`  Cleared subRegionId from ${liftsUpdated.count} lifts`);

      // Delete all sub-regions
      const subRegionsDeleted = await prisma.subRegion.deleteMany({});
      console.log(`  Deleted ${subRegionsDeleted.count} sub-regions`);

      console.log(
        "  ✓ Force restart complete (ski area connections preserved)\n"
      );
    } else if (forceRestart && dryRun) {
      console.log(
        "\n[DRY RUN] Would delete all sub-regions (connections preserved)\n"
      );
    }

    if (connectionsOnly) {
      // Only detect ski area connections
      await detectConnectedSkiAreas(dryRun);
    } else if (skiAreaId) {
      // Sync specific ski area - print logs immediately for debugging
      const syncResult = await syncSubRegionsForSkiArea(skiAreaId, dryRun);
      console.log("\n" + syncResult.logs.join("\n"));

      const assignResult = await assignRunsAndLiftsToSubRegions(
        skiAreaId,
        dryRun
      );
      console.log(assignResult.logs.join("\n"));

      // Deduplicate sub-regions by name (database level)
      const dedupResult = await deduplicateSubRegionsInDatabase(
        skiAreaId,
        dryRun
      );
      if (dedupResult.logs.length > 0) {
        console.log(dedupResult.logs.join("\n"));
      }

      // Merge small regions into larger overlapping ones
      const mergeResult = await mergeSmallIntoLargeSubRegions(
        skiAreaId,
        dryRun
      );
      if (mergeResult.logs.length > 0) {
        console.log(mergeResult.logs.join("\n"));
      }

      // Print sub-region summary (after deduplication and merging)
      // Re-fetch stats if we deduplicated or merged anything
      if ((dedupResult.merged > 0 || mergeResult.merged > 0) && !dryRun) {
        const updatedSubRegions = await prisma.subRegion.findMany({
          where: { skiAreaId },
          include: {
            _count: {
              select: { runs: true, lifts: true },
            },
          },
        });
        const updatedStats = new Map<
          string,
          { name: string; runCount: number; liftCount: number }
        >();
        for (const sr of updatedSubRegions) {
          updatedStats.set(sr.id, {
            name: sr.name,
            runCount: sr._count.runs,
            liftCount: sr._count.lifts,
          });
        }
        const summaryLogs: string[] = [];
        printSubRegionSummary(updatedStats, summaryLogs);
        if (summaryLogs.length > 0) {
          console.log(summaryLogs.join("\n"));
        }
      } else {
        // Print sub-region summary
        const summaryLogs: string[] = [];
        printSubRegionSummary(assignResult.subRegionStats, summaryLogs);
        if (summaryLogs.length > 0) {
          console.log(summaryLogs.join("\n"));
        }
      }

      // Cleanup unused sub-regions
      const cleanupResult = await cleanupUnusedSubRegions(skiAreaId, dryRun);
      if (cleanupResult.logs.length > 0) {
        console.log(cleanupResult.logs.join("\n"));
      }
    } else {
      // Sync all ski areas with bounds
      const allSkiAreas = await prisma.skiArea.findMany({
        where: {
          bounds: { not: null },
        },
        include: {
          subRegions: { select: { id: true } },
        },
        orderBy: { name: "asc" },
      });

      // Filter out already processed ski areas (unless --force-restart)
      const skiAreas = forceRestart
        ? allSkiAreas
        : allSkiAreas.filter((a) => a.subRegions.length === 0);

      const skipped = allSkiAreas.length - skiAreas.length;

      console.log("");
      console.log(
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      );
      console.log(`  Found ${allSkiAreas.length} ski areas total`);
      if (skipped > 0)
        console.log(
          `  Skipping ${skipped} already processed (use --force-restart to re-process)`
        );
      console.log(`  Processing ${skiAreas.length} ski areas`);
      console.log(
        `  Using ${OVERPASS_ENDPOINTS.length} Overpass endpoints with ${CONCURRENCY} concurrent workers`
      );
      console.log(
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      );
      console.log("");

      let processed = 0;
      let errors = 0;
      let totalSubRegions = 0;

      // Process ski areas with concurrency - collect logs and print at end of each batch
      interface BatchResult {
        success: boolean;
        name: string;
        syncResult?: SyncResult;
        assignResult?: AssignResult;
        mergeResult?: { logs: string[]; merged: number };
        cleanupResult?: { logs: string[]; removed: number };
        error?: unknown;
      }

      const processSkiArea = async (
        skiArea: (typeof skiAreas)[0]
      ): Promise<BatchResult> => {
        try {
          const syncResult = await syncSubRegionsForSkiArea(skiArea.id, dryRun);
          const assignResult = await assignRunsAndLiftsToSubRegions(
            skiArea.id,
            dryRun
          );
          const mergeResult = await mergeSmallIntoLargeSubRegions(
            skiArea.id,
            dryRun
          );
          const cleanupResult = await cleanupUnusedSubRegions(
            skiArea.id,
            dryRun
          );
          return {
            success: syncResult.success,
            name: skiArea.name,
            syncResult,
            assignResult,
            mergeResult,
            cleanupResult,
          };
        } catch (error) {
          return { success: false, name: skiArea.name, error };
        }
      };

      // Concurrent processing with worker pool
      const results: BatchResult[] = [];

      for (let i = 0; i < skiAreas.length; i += CONCURRENCY) {
        const batch = skiAreas.slice(i, i + CONCURRENCY);
        const batchNum = Math.floor(i / CONCURRENCY) + 1;
        const totalBatches = Math.ceil(skiAreas.length / CONCURRENCY);

        // Show progress header
        console.log(
          `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        );
        console.log(
          `  Batch ${batchNum}/${totalBatches} (${Math.round(
            (i / skiAreas.length) * 100
          )}%)`
        );
        console.log(
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        );

        const batchResults = await Promise.all(batch.map(processSkiArea));
        results.push(...batchResults);

        // Print all logs from this batch at the end (grouped by ski area)
        for (const result of batchResults) {
          if (result.success && result.syncResult) {
            console.log(`\n📍 ${result.name}`);
            for (const line of result.syncResult.logs) {
              console.log(`   ${line}`);
            }
            if (result.assignResult) {
              for (const line of result.assignResult.logs) {
                console.log(`   ${line}`);
              }
            }
            if (result.mergeResult && result.mergeResult.logs.length > 0) {
              for (const line of result.mergeResult.logs) {
                console.log(`   ${line}`);
              }
            }
            // Print sub-region summary for this ski area (after merging)
            if (result.assignResult) {
              const summaryLogs: string[] = [];
              printSubRegionSummary(
                result.assignResult.subRegionStats,
                summaryLogs
              );
              for (const line of summaryLogs) {
                console.log(`   ${line}`);
              }
            }
            if (result.cleanupResult && result.cleanupResult.logs.length > 0) {
              for (const line of result.cleanupResult.logs) {
                console.log(`   ${line}`);
              }
            }
            totalSubRegions += result.syncResult.subRegionsProcessed;
          } else if (!result.success) {
            console.error(
              `\n❌ ${result.name}: ${result.error || result.syncResult?.error}`
            );
          }
        }

        processed += batch.length;
        errors += batchResults.filter((r) => !r.success).length;
      }

      console.log("");
      console.log(
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      );
      console.log(
        `  ✅ Processed ${processed - errors}/${processed} ski areas`
      );
      console.log(`  📦 Total sub-regions found: ${totalSubRegions}`);
      if (skipped > 0)
        console.log(`  ⏭️  Skipped ${skipped} already processed`);
      if (errors > 0) console.log(`  ⚠️  ${errors} ski areas had errors`);
      console.log(
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      );

      // After processing all ski areas, detect connections between them
      if (!skipConnections) {
        await detectConnectedSkiAreas(dryRun);
      }
    }

    // Final summary
    const duration = Math.round((Date.now() - startTime) / 1000);
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;

    const finalCounts = {
      subRegions: await prisma.subRegion.count(),
      connections: await prisma.skiAreaConnection.count(),
      runsTotal: await prisma.run.count(),
      runsAssigned: await prisma.run.count({
        where: { subRegionId: { not: null } },
      }),
      liftsTotal: await prisma.lift.count(),
      liftsAssigned: await prisma.lift.count({
        where: { subRegionId: { not: null } },
      }),
    };

    const runPct =
      finalCounts.runsTotal > 0
        ? Math.round((finalCounts.runsAssigned / finalCounts.runsTotal) * 100)
        : 0;
    const liftPct =
      finalCounts.liftsTotal > 0
        ? Math.round((finalCounts.liftsAssigned / finalCounts.liftsTotal) * 100)
        : 0;

    console.log("");
    console.log(
      "╔══════════════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║  ✅ SUB-REGION SYNC COMPLETE                                     ║"
    );
    console.log(
      "╠══════════════════════════════════════════════════════════════════╣"
    );
    console.log(`║  Duration: ${mins}m ${secs}s`.padEnd(68) + "║");
    console.log(`║  Sub-Regions: ${finalCounts.subRegions}`.padEnd(68) + "║");
    console.log(`║  Connections: ${finalCounts.connections}`.padEnd(68) + "║");
    console.log(
      "╠══════════════════════════════════════════════════════════════════╣"
    );
    console.log(
      `║  Runs assigned: ${finalCounts.runsAssigned}/${finalCounts.runsTotal} (${runPct}%)`.padEnd(
        68
      ) + "║"
    );
    console.log(
      `║  Lifts assigned: ${finalCounts.liftsAssigned}/${finalCounts.liftsTotal} (${liftPct}%)`.padEnd(
        68
      ) + "║"
    );
    console.log(
      "╚══════════════════════════════════════════════════════════════════╝"
    );
    console.log("");
  } catch (error) {
    console.error("");
    console.error(
      "╔══════════════════════════════════════════════════════════════════╗"
    );
    console.error(
      "║  ❌ SUB-REGION SYNC FAILED                                       ║"
    );
    console.error(
      "╚══════════════════════════════════════════════════════════════════╝"
    );
    console.error("");
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

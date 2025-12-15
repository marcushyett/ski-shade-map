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

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

// Retry helper for API calls
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
  initialDelay: number = 5000
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // Retry on 429 (rate limit) or 5xx errors
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return response;
    } catch (error) {
      lastError = error as Error;
      console.error(`  Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
      
      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt - 1);
        console.log(`  Retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('All retry attempts failed');
}

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  members?: Array<{ type: string; ref: number; role?: string }>;
  geometry?: Array<{ lat: number; lon: number }>;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
}

interface OverpassResponse {
  elements: OverpassElement[];
}

// Known connected ski areas - manual overrides for areas that should load together
// Format: parentOsmId -> [connectedOsmIds]
// These supplement the automatic detection algorithm
const MANUAL_CONNECTED_SKI_AREAS: Record<string, string[]> = {
  // Les Trois Vallées connections (some sub-areas may not be auto-detected)
  'relation/3545276': [
    'relation/3962216', // Brides Les Bains
    'relation/3962218', // La Tania
    'relation/3962219', // Les Ménuires
    'relation/3962222', // Val Thorens
    'relation/19757448', // Val Thorens - Orelle
    'relation/19751525', // Orelle
  ],
};

// Ski areas within ~500m of each other are considered connected
const CONNECTION_THRESHOLD_METERS = 500;

// Calculate distance between two points using Haversine formula
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
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
  
  if (!geometry || typeof geometry !== 'object') return coords;
  
  const geo = geometry as { type?: string; coordinates?: unknown };
  
  if (!geo.type || !geo.coordinates) return coords;
  
  const extractFromArray = (arr: unknown): void => {
    if (!Array.isArray(arr)) return;
    
    // Check if this is a coordinate pair [lng, lat]
    if (arr.length >= 2 && typeof arr[0] === 'number' && typeof arr[1] === 'number') {
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

async function fetchSubRegionsFromOverpass(bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }): Promise<OverpassElement[]> {
  // Query for both ski area sites AND administrative boundaries (communes) that likely contain ski resorts
  const query = `
    [out:json][timeout:120];
    (
      // Ski area site relations
      relation["type"="site"]["site"="piste"](${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng});
      // French communes (admin_level 8) - these contain villages like Méribel (Les Allues), Courchevel, etc.
      relation["boundary"="administrative"]["admin_level"="8"](${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng});
    );
    out body geom;
  `;

  console.log(`Fetching sub-regions in bounds: ${JSON.stringify(bounds)}`);
  
  const response = await fetchWithRetry(
    OVERPASS_API,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    },
    3,  // maxRetries
    10000  // initialDelay (10s - Overpass needs longer cooldowns)
  );

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
  }

  const data: OverpassResponse = await response.json();
  return data.elements;
}

function calculateCentroid(geometry: Array<{ lat: number; lon: number }>): { lat: number; lng: number } {
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

function geometryToGeoJSON(geometry: Array<{ lat: number; lon: number }>): object | null {
  if (!geometry || geometry.length < 3) return null;
  
  // Convert to GeoJSON polygon
  const coordinates = geometry.map(p => [p.lon, p.lat]);
  // Close the polygon if not already closed
  if (coordinates.length > 0) {
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coordinates.push([...first]);
    }
  }
  
  return {
    type: 'Polygon',
    coordinates: [coordinates],
  };
}

function boundsToJson(bounds: { minlat: number; minlon: number; maxlat: number; maxlon: number }): object {
  return {
    minLat: bounds.minlat,
    maxLat: bounds.maxlat,
    minLng: bounds.minlon,
    maxLng: bounds.maxlon,
  };
}

// Check if a point is within bounds
function isPointInBounds(
  lat: number, 
  lng: number, 
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
): boolean {
  return lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng;
}

async function syncSubRegionsForSkiArea(skiAreaId: string, dryRun: boolean = false) {
  const skiArea = await prisma.skiArea.findUnique({
    where: { id: skiAreaId },
    include: { subRegions: true },
  });

  if (!skiArea) {
    console.error(`Ski area not found: ${skiAreaId}`);
    return;
  }

  if (!skiArea.bounds) {
    console.error(`Ski area has no bounds: ${skiArea.name}`);
    return;
  }

  const bounds = skiArea.bounds as { minLat: number; maxLat: number; minLng: number; maxLng: number };
  
  // Expand bounds by ~500m to catch nearby sub-regions
  // At alpine latitudes: 0.005° ≈ 500m
  const expandedBounds = {
    minLat: bounds.minLat - 0.005,
    maxLat: bounds.maxLat + 0.005,
    minLng: bounds.minLng - 0.005,
    maxLng: bounds.maxLng + 0.005,
  };

  console.log(`\nSyncing sub-regions for: ${skiArea.name} (${skiAreaId})`);
  
  const elements = await fetchSubRegionsFromOverpass(expandedBounds);
  console.log(`Found ${elements.length} potential sub-regions (ski sites + communes) in area`);

  // Filter out the parent ski area itself
  const subRegions = elements.filter(el => {
    const osmId = `relation/${el.id}`;
    // Skip if this is the parent ski area
    if (skiArea.osmId === osmId) return false;
    // Skip if no name
    if (!el.tags?.name) return false;
    return true;
  });

  console.log(`Processing ${subRegions.length} potential sub-regions`);

  for (const element of subRegions) {
    const osmId = `relation/${element.id}`;
    const name = element.tags?.name || 'Unknown';
    
    // Calculate geometry and centroid
    let geometry = null;
    let centroid = null;
    let subBounds = null;
    
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

    console.log(`  - ${name} (${osmId})`);

    if (dryRun) {
      console.log(`    [DRY RUN] Would create/update sub-region`);
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
    console.log(`\nProcessing manual connected ski areas for ${skiArea.name}...`);
    
    for (const connectedOsmId of MANUAL_CONNECTED_SKI_AREAS[skiArea.osmId]) {
      const connectedArea = await prisma.skiArea.findFirst({
        where: { osmId: connectedOsmId },
      });

      if (connectedArea) {
        console.log(`  [Manual] Connecting: ${skiArea.name} <-> ${connectedArea.name}`);
        
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
        console.log(`  [WARN] Connected area not found in DB: ${connectedOsmId}`);
      }
    }
  }
}

// Automatically detect connected ski areas based on actual run/lift geometry proximity
async function detectConnectedSkiAreas(dryRun: boolean = false) {
  console.log('\n=== Detecting Connected Ski Areas ===');
  console.log('Using geometry-based distance check (not bounding boxes)');
  
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
  
  async function getSkiAreaCoordinates(areaId: string): Promise<Array<[number, number]>> {
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
    const bounds1 = area1.bounds as { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
    if (!bounds1) continue;

    for (let j = i + 1; j < skiAreas.length; j++) {
      const area2 = skiAreas[j];
      const bounds2 = area2.bounds as { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
      if (!bounds2) continue;

      // Skip if we've already processed this pair
      const pairKey = [area1.id, area2.id].sort().join('-');
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
        console.log(`  Found connection: ${area1.name} <-> ${area2.name} (${Math.round(minDistance)}m apart)`);
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

  console.log('');
  console.log(`  Pairs skipped (>5km apart): ${pairsSkipped}`);
  console.log(`  Pairs checked (geometry): ${pairsChecked}`);
  console.log(`  Connections found (<${CONNECTION_THRESHOLD_METERS}m): ${connectionsFound}`);
}

async function assignRunsToSubRegions(skiAreaId: string, dryRun: boolean = false) {
  console.log(`\nAssigning runs to sub-regions for ski area: ${skiAreaId}`);

  const skiArea = await prisma.skiArea.findUnique({
    where: { id: skiAreaId },
    include: {
      runs: true,
      subRegions: true,
    },
  });

  if (!skiArea) {
    console.error(`Ski area not found: ${skiAreaId}`);
    return;
  }

  if (skiArea.subRegions.length === 0) {
    console.log(`No sub-regions found for ${skiArea.name}`);
    return;
  }

  console.log(`Found ${skiArea.subRegions.length} sub-regions and ${skiArea.runs.length} runs`);

  let assignedCount = 0;
  
  for (const run of skiArea.runs) {
    const geometry = run.geometry as any;
    if (!geometry) continue;

    // Get centroid of run
    let runCentroid: { lat: number; lng: number } | null = null;
    
    if (geometry.type === 'LineString' && geometry.coordinates?.length > 0) {
      const coords = geometry.coordinates;
      const midIndex = Math.floor(coords.length / 2);
      runCentroid = { lng: coords[midIndex][0], lat: coords[midIndex][1] };
    } else if (geometry.type === 'Polygon' && geometry.coordinates?.[0]?.length > 0) {
      const coords = geometry.coordinates[0];
      const lats = coords.map((c: number[]) => c[1]);
      const lngs = coords.map((c: number[]) => c[0]);
      runCentroid = {
        lat: (Math.min(...lats) + Math.max(...lats)) / 2,
        lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
      };
    }

    if (!runCentroid) continue;

    // Find the sub-region this run belongs to
    let bestSubRegion: typeof skiArea.subRegions[0] | null = null;
    let bestDistance = Infinity;

    for (const subRegion of skiArea.subRegions) {
      const subBounds = subRegion.bounds as { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
      const subCentroid = subRegion.centroid as { lat: number; lng: number } | null;

      // First check if run is within sub-region bounds
      if (subBounds && isPointInBounds(runCentroid.lat, runCentroid.lng, subBounds)) {
        bestSubRegion = subRegion;
        break;
      }

      // Otherwise find closest sub-region by centroid distance
      if (subCentroid) {
        const distance = Math.sqrt(
          Math.pow(runCentroid.lat - subCentroid.lat, 2) +
          Math.pow(runCentroid.lng - subCentroid.lng, 2)
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          bestSubRegion = subRegion;
        }
      }
    }

    if (bestSubRegion && run.subRegionId !== bestSubRegion.id) {
      if (!dryRun) {
        await prisma.run.update({
          where: { id: run.id },
          data: { subRegionId: bestSubRegion.id },
        });
      }
      assignedCount++;
    }
  }

  console.log(`Assigned ${assignedCount} runs to sub-regions`);
}

async function main() {
  const startTime = Date.now();
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skiAreaIdArg = args.find(a => a.startsWith('--ski-area-id='));
  const skiAreaId = skiAreaIdArg?.split('=')[1];
  const connectionsOnly = args.includes('--connections-only');
  const skipConnections = args.includes('--skip-connections');
  const forceRestart = args.includes('--force-restart');

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  🏔️  SUB-REGION & CONNECTION SYNC                                 ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  Started: ${new Date().toISOString()}                   ║`);
  if (dryRun) console.log('║  🔍 DRY RUN - No changes will be made                            ║');
  if (connectionsOnly) console.log('║  🔗 Connections only mode                                         ║');
  if (skipConnections) console.log('║  ⏭️  Skipping connection detection                                ║');
  if (forceRestart) console.log('║  🔄 Force restart - clearing existing data                       ║');
  if (skiAreaId) console.log(`║  📍 Single ski area: ${skiAreaId.substring(0, 20)}...                     ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    // If force restart, delete all existing sub-regions and connections
    if (forceRestart && !dryRun) {
      console.log('\n🗑️  Force restart: Deleting all existing sub-regions and connections...');
      
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
      
      // Delete all connections
      const connectionsDeleted = await prisma.skiAreaConnection.deleteMany({});
      console.log(`  Deleted ${connectionsDeleted.count} connections`);
      
      console.log('  ✓ Force restart complete\n');
    } else if (forceRestart && dryRun) {
      console.log('\n[DRY RUN] Would delete all sub-regions and connections\n');
    }

    if (connectionsOnly) {
      // Only detect ski area connections
      await detectConnectedSkiAreas(dryRun);
    } else if (skiAreaId) {
      // Sync specific ski area
      await syncSubRegionsForSkiArea(skiAreaId, dryRun);
      await assignRunsToSubRegions(skiAreaId, dryRun);
    } else {
      // Sync all ski areas with bounds
      const skiAreas = await prisma.skiArea.findMany({
        where: {
          bounds: { not: null },
        },
        orderBy: { name: 'asc' },
      });

      console.log('');
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`  Found ${skiAreas.length} ski areas to process`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log('');

      let processed = 0;
      let errors = 0;
      
      for (const skiArea of skiAreas) {
        processed++;
        const progress = `[${processed}/${skiAreas.length}]`;
        const percent = Math.round((processed / skiAreas.length) * 100);
        
        try {
          process.stdout.write(`\r${progress} ${percent}% - Processing: ${skiArea.name.substring(0, 40).padEnd(40)}...`);
          await syncSubRegionsForSkiArea(skiArea.id, dryRun);
          await assignRunsToSubRegions(skiArea.id, dryRun);
          // Rate limit to be nice to Overpass API
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          errors++;
          console.error(`\n❌ Error processing ${skiArea.name}:`, error);
        }
      }
      
      console.log('');
      console.log(`  ✅ Processed ${processed - errors}/${processed} ski areas`);
      if (errors > 0) console.log(`  ⚠️  ${errors} ski areas had errors`);

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
    };
    
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  ✅ SUB-REGION SYNC COMPLETE                                     ║');
    console.log('╠══════════════════════════════════════════════════════════════════╣');
    console.log(`║  Duration: ${mins}m ${secs}s`.padEnd(68) + '║');
    console.log(`║  Sub-Regions: ${finalCounts.subRegions}`.padEnd(68) + '║');
    console.log(`║  Connections: ${finalCounts.connections}`.padEnd(68) + '║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('');
  } catch (error) {
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════════════╗');
    console.error('║  ❌ SUB-REGION SYNC FAILED                                       ║');
    console.error('╚══════════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();


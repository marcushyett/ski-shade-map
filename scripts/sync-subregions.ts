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

// Distance threshold in degrees (~500m at alpine latitudes)
// At 45° latitude: 1° lat ≈ 111km, 1° lng ≈ 78km
// So 0.005° ≈ 500m for latitude, ~400m for longitude
const CONNECTION_THRESHOLD_DEGREES = 0.005;

// Check if two bounding boxes are within threshold distance of each other
// This returns true if they overlap OR if any edge is within ~500m
function boundsWithinDistance(
  bounds1: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  bounds2: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  threshold: number = CONNECTION_THRESHOLD_DEGREES
): boolean {
  // Expand bounds1 by threshold in all directions
  const expanded = {
    minLat: bounds1.minLat - threshold,
    maxLat: bounds1.maxLat + threshold,
    minLng: bounds1.minLng - threshold,
    maxLng: bounds1.maxLng + threshold,
  };
  
  // Check if expanded bounds1 intersects with bounds2
  const intersects = !(
    expanded.maxLat < bounds2.minLat ||
    expanded.minLat > bounds2.maxLat ||
    expanded.maxLng < bounds2.minLng ||
    expanded.minLng > bounds2.maxLng
  );
  
  return intersects;
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

// Automatically detect connected ski areas based on overlapping/adjacent bounds
async function detectConnectedSkiAreas(dryRun: boolean = false) {
  console.log('\n=== Detecting Connected Ski Areas ===');
  
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
  
  let connectionsFound = 0;
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

      // Check if bounds are within ~500m of each other
      if (boundsWithinDistance(bounds1, bounds2)) {
        console.log(`  Found connection: ${area1.name} <-> ${area2.name}`);
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

  console.log(`\nFound ${connectionsFound} ski area connections`);
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
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skiAreaIdArg = args.find(a => a.startsWith('--ski-area-id='));
  const skiAreaId = skiAreaIdArg?.split('=')[1];
  const connectionsOnly = args.includes('--connections-only');
  const skipConnections = args.includes('--skip-connections');

  const forceRestart = args.includes('--force-restart');

  console.log('=== Sub-Region Sync ===');
  console.log(`Dry run: ${dryRun}`);
  console.log(`Connections only: ${connectionsOnly}`);
  console.log(`Force restart: ${forceRestart}`);

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

      console.log(`Found ${skiAreas.length} ski areas to process`);

      for (const skiArea of skiAreas) {
        try {
          await syncSubRegionsForSkiArea(skiArea.id, dryRun);
          await assignRunsToSubRegions(skiArea.id, dryRun);
          // Rate limit to be nice to Overpass API
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          console.error(`Error processing ${skiArea.name}:`, error);
        }
      }

      // After processing all ski areas, detect connections between them
      if (!skipConnections) {
        await detectConnectedSkiAreas(dryRun);
      }
    }

    console.log('\n=== Sync Complete ===');
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();


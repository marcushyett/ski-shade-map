/**
 * Sync sub-regions from OpenStreetMap Overpass API
 * This script fetches site=piste relations and assigns them to parent ski areas
 * 
 * Usage: npx tsx scripts/sync-subregions.ts [--ski-area-id=ID] [--dry-run]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

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

// Known connected ski areas - areas that should load together
// Format: parentOsmId -> [connectedOsmIds]
const CONNECTED_SKI_AREAS: Record<string, string[]> = {
  // Les Trois Vallées connections
  'relation/3545276': [
    'relation/3962216', // Brides Les Bains
    'relation/3962218', // La Tania
    'relation/3962219', // Les Ménuires
    'relation/3962222', // Val Thorens
    'relation/19757448', // Val Thorens - Orelle
    'relation/19751525', // Orelle
  ],
  // Paradiski (La Plagne + Les Arcs)
  'relation/5994157': ['relation/5994162'], // La Plagne -> Les Arcs
  'relation/5994162': ['relation/5994157'], // Les Arcs -> La Plagne
};

async function fetchSubRegionsFromOverpass(bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }): Promise<OverpassElement[]> {
  const query = `
    [out:json][timeout:120];
    (
      relation["type"="site"]["site"="piste"](${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng});
    );
    out body geom;
  `;

  console.log(`Fetching sub-regions in bounds: ${JSON.stringify(bounds)}`);
  
  const response = await fetch(OVERPASS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

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
  
  // Expand bounds slightly to catch nearby sub-regions
  const expandedBounds = {
    minLat: bounds.minLat - 0.1,
    maxLat: bounds.maxLat + 0.1,
    minLng: bounds.minLng - 0.1,
    maxLng: bounds.maxLng + 0.1,
  };

  console.log(`\nSyncing sub-regions for: ${skiArea.name} (${skiAreaId})`);
  
  const elements = await fetchSubRegionsFromOverpass(expandedBounds);
  console.log(`Found ${elements.length} site=piste relations in area`);

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

  // Handle connected ski areas
  if (skiArea.osmId && CONNECTED_SKI_AREAS[skiArea.osmId]) {
    console.log(`\nProcessing connected ski areas for ${skiArea.name}...`);
    
    for (const connectedOsmId of CONNECTED_SKI_AREAS[skiArea.osmId]) {
      const connectedArea = await prisma.skiArea.findFirst({
        where: { osmId: connectedOsmId },
      });

      if (connectedArea) {
        console.log(`  Connecting: ${skiArea.name} <-> ${connectedArea.name}`);
        
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

  console.log('=== Sub-Region Sync ===');
  console.log(`Dry run: ${dryRun}`);

  try {
    if (skiAreaId) {
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


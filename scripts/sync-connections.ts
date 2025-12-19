/**
 * Sync ski area connections
 * This script detects connected ski areas based on geometry proximity
 * Ski areas within 500m of each other are considered connected
 *
 * Usage:
 *   npx tsx scripts/sync-connections.ts              # Detect connections
 *   npx tsx scripts/sync-connections.ts --dry-run    # Preview without writing to DB
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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

// Evenly sample an array
function sampleArray<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
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

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  SKI AREA CONNECTIONS SYNC                                   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  if (dryRun) {
    console.log("DRY RUN MODE - No changes will be written to database");
  }

  try {
    await detectConnectedSkiAreas(dryRun);
    console.log("\n✅ Connection detection complete!");
  } catch (error) {
    console.error("Error detecting connections:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

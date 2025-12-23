#!/usr/bin/env tsx
/**
 * Generates static resort bundle JSON files for instant loading.
 * Pre-generates top 100 resorts with all geometry data at build time.
 *
 * This eliminates API round-trips for popular resorts, reducing load times
 * from 500-1000ms to 50-200ms.
 *
 * Run with: npx tsx scripts/generate-resort-bundles.ts
 * Or as part of build: npm run build (via prebuild hook)
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Number of top resorts to pre-generate
const TOP_RESORTS_COUNT = 100;

// Minify coordinates to 6 decimal places (~10cm precision)
const COORDINATE_PRECISION = 6;

interface ResortBundle {
  // Basic info (matches /api/ski-areas/[id]/info)
  id: string;
  osmId: string | null;
  name: string;
  country: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  bounds: unknown;
  geometry: unknown;
  properties: unknown;
  runCount: number;
  liftCount: number;
  localities: string[];
  connectedAreas?: Array<{
    id: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
  }>;
  // Full geometry data
  runs: Array<{
    id: string;
    osmId: string | null;
    name: string | null;
    difficulty: string | null;
    status: string | null;
    locality: string | null;
    geometry: unknown;
    properties: unknown;
  }>;
  lifts: Array<{
    id: string;
    osmId: string | null;
    name: string | null;
    liftType: string | null;
    status: string | null;
    locality: string | null;
    capacity: number | null;
    geometry: unknown;
    properties: unknown;
  }>;
  // Metadata
  generatedAt: number;
  version: string;
}

interface ResortIndexEntry {
  id: string;
  name: string;
  country: string | null;
  filename: string;
  sizeBytes: number;
  runCount: number;
  liftCount: number;
  generatedAt: number;
}

interface ResortIndex {
  resorts: ResortIndexEntry[];
  generatedAt: number;
  version: string;
  totalSizeBytes: number;
}

/**
 * Minify GeoJSON coordinates to reduce bundle size
 */
function minifyCoordinates(geometry: unknown): unknown {
  if (!geometry || typeof geometry !== 'object') return geometry;

  const geo = geometry as { type: string; coordinates: unknown };

  if (!geo.coordinates) return geometry;

  const minifyCoordArray = (coords: unknown): unknown => {
    if (Array.isArray(coords)) {
      if (Array.isArray(coords[0])) {
        // Nested array - recurse
        return coords.map(minifyCoordArray);
      } else if (typeof coords[0] === 'number') {
        // Coordinate pair [lng, lat] or [lng, lat, elevation]
        return coords.slice(0, 2).map(c =>
          typeof c === 'number' ? parseFloat(c.toFixed(COORDINATE_PRECISION)) : c
        );
      }
    }
    return coords;
  };

  return {
    ...geo,
    coordinates: minifyCoordArray(geo.coordinates),
  };
}

/**
 * Sanitize resort name for filename
 */
function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50); // Limit length
}

/**
 * Generate bundle for a single resort
 */
async function generateResortBundle(
  resortId: string,
  resortName: string
): Promise<{ bundle: ResortBundle; filename: string } | null> {
  try {
    console.log(`  Generating bundle for: ${resortName}`);

    // Fetch all data in parallel (same as API routes)
    const [skiArea, connectedTo, connectedFrom, runs, lifts] = await Promise.all([
      // Basic info
      prisma.skiArea.findUnique({
        where: { id: resortId },
        select: {
          id: true,
          osmId: true,
          name: true,
          country: true,
          region: true,
          latitude: true,
          longitude: true,
          bounds: true,
          geometry: true,
          properties: true,
          _count: {
            select: { runs: true, lifts: true },
          },
        },
      }),
      // Connected areas
      prisma.skiAreaConnection.findMany({
        where: { fromAreaId: resortId },
        select: {
          toArea: {
            select: { id: true, name: true, latitude: true, longitude: true },
          },
        },
      }),
      prisma.skiAreaConnection.findMany({
        where: { toAreaId: resortId },
        select: {
          fromArea: {
            select: { id: true, name: true, latitude: true, longitude: true },
          },
        },
      }),
      // All runs
      prisma.run.findMany({
        where: { skiAreaId: resortId },
        select: {
          id: true,
          osmId: true,
          name: true,
          difficulty: true,
          status: true,
          locality: true,
          geometry: true,
          properties: true,
        },
      }),
      // All lifts
      prisma.lift.findMany({
        where: { skiAreaId: resortId },
        select: {
          id: true,
          osmId: true,
          name: true,
          liftType: true,
          status: true,
          locality: true,
          capacity: true,
          geometry: true,
          properties: true,
        },
      }),
    ]);

    if (!skiArea) {
      console.warn(`  ⚠️  Ski area not found: ${resortName}`);
      return null;
    }

    // Build connected areas list
    const connectedAreas = [
      ...connectedTo.map(c => c.toArea),
      ...connectedFrom.map(c => c.fromArea),
    ];

    // Get localities
    const localities = Array.from(
      new Set(
        runs
          .map(r => r.locality)
          .filter(Boolean)
      )
    ).sort() as string[];

    // Minify geometries
    const minifiedRuns = runs.map(run => ({
      ...run,
      geometry: minifyCoordinates(run.geometry),
      locality: run.locality || skiArea.name,
    }));

    const minifiedLifts = lifts.map(lift => ({
      ...lift,
      geometry: minifyCoordinates(lift.geometry),
      locality: lift.locality || skiArea.name,
    }));

    const bundle: ResortBundle = {
      id: skiArea.id,
      osmId: skiArea.osmId,
      name: skiArea.name,
      country: skiArea.country,
      region: skiArea.region,
      latitude: skiArea.latitude,
      longitude: skiArea.longitude,
      bounds: skiArea.bounds,
      geometry: minifyCoordinates(skiArea.geometry),
      properties: skiArea.properties,
      runCount: skiArea._count.runs,
      liftCount: skiArea._count.lifts,
      localities,
      connectedAreas: connectedAreas.length > 0 ? connectedAreas : undefined,
      runs: minifiedRuns,
      lifts: minifiedLifts,
      generatedAt: Date.now(),
      version: '1.0',
    };

    const filename = `${sanitizeFilename(skiArea.name)}-${skiArea.id}.json`;

    console.log(`  ✓ Generated: ${runs.length} runs, ${lifts.length} lifts`);

    return { bundle, filename };
  } catch (error) {
    console.error(`  ✗ Error generating bundle for ${resortName}:`, error);
    return null;
  }
}

/**
 * Main function to generate all resort bundles
 */
async function generateResortBundles() {
  console.log(`\n🏔️  Generating resort bundles for top ${TOP_RESORTS_COUNT} resorts...\n`);

  // Get top resorts ordered by run count (most popular)
  const topResorts = await prisma.skiArea.findMany({
    select: { id: true, name: true, country: true },
    where: {
      // Only include resorts with runs (some entries might be incomplete)
      runs: { some: {} },
    },
    orderBy: [
      { runs: { _count: 'desc' } },
      { lifts: { _count: 'desc' } },
    ],
    take: TOP_RESORTS_COUNT,
  });

  console.log(`Found ${topResorts.length} resorts to process\n`);

  // Ensure output directory exists
  const resortsDir = path.join(process.cwd(), 'public', 'data', 'resorts');
  if (!fs.existsSync(resortsDir)) {
    fs.mkdirSync(resortsDir, { recursive: true });
  }

  // Process resorts sequentially to avoid overloading the database
  // (Could be parallelized with concurrency limit using p-map if needed)
  const results: ResortIndexEntry[] = [];
  let totalSize = 0;

  for (const resort of topResorts) {
    const result = await generateResortBundle(resort.id, resort.name);

    if (result) {
      const { bundle, filename } = result;
      const filepath = path.join(resortsDir, filename);

      // Write bundle to file
      const json = JSON.stringify(bundle);
      fs.writeFileSync(filepath, json);

      const stats = fs.statSync(filepath);
      const sizeKB = (stats.size / 1024).toFixed(1);

      console.log(`  💾 Written: ${filename} (${sizeKB} KB)\n`);

      results.push({
        id: bundle.id,
        name: bundle.name,
        country: bundle.country,
        filename,
        sizeBytes: stats.size,
        runCount: bundle.runCount,
        liftCount: bundle.liftCount,
        generatedAt: bundle.generatedAt,
      });

      totalSize += stats.size;
    }
  }

  // Generate index file
  const index: ResortIndex = {
    resorts: results,
    generatedAt: Date.now(),
    version: '1.0',
    totalSizeBytes: totalSize,
  };

  const indexPath = path.join(resortsDir, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  const indexStats = fs.statSync(indexPath);
  const indexSizeKB = (indexStats.size / 1024).toFixed(1);

  // Summary
  const totalSizeMB = (totalSize / 1024 / 1024).toFixed(1);
  console.log('━'.repeat(60));
  console.log(`\n✅ Successfully generated ${results.length} resort bundles`);
  console.log(`📊 Total size: ${totalSizeMB} MB (uncompressed)`);
  console.log(`📋 Index file: ${indexPath} (${indexSizeKB} KB)`);
  console.log(`\nEstimated compressed size (gzip): ~${(totalSize / 1024 / 1024 / 3).toFixed(1)} MB`);
  console.log('\nBundles will be served from: /data/resorts/*.json\n');

  await prisma.$disconnect();
}

// Run the generator
generateResortBundles().catch(async (error) => {
  console.error('\n❌ Error generating resort bundles:', error);
  await prisma.$disconnect();
  process.exit(1);
});

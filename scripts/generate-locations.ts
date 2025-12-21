#!/usr/bin/env tsx
/**
 * Generates static locations JSON file for instant search index loading.
 * This eliminates database query overhead on first app load.
 *
 * Run with: npx tsx scripts/generate-locations.ts
 * Or as part of build: npm run build (via prebuild hook)
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface SearchableLocation {
  id: string;
  type: 'region' | 'locality';
  name: string;
  country: string | null;
  region?: string;
  skiAreaId: string;
  lat?: number;
  lng?: number;
  runs?: number;
  lifts?: number;
}

async function generateLocations() {
  console.log('Generating locations data...');

  // Fetch all data in parallel
  const [skiAreas, runsWithLocality] = await Promise.all([
    prisma.skiArea.findMany({
      select: {
        id: true,
        name: true,
        country: true,
        latitude: true,
        longitude: true,
        _count: { select: { runs: true, lifts: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.run.findMany({
      where: { locality: { not: null } },
      select: {
        locality: true,
        skiArea: {
          select: { id: true, name: true, country: true },
        },
      },
      distinct: ['locality', 'skiAreaId'],
    }),
  ]);

  console.log(`Found ${skiAreas.length} ski areas`);
  console.log(`Found ${runsWithLocality.length} localities`);

  const items: SearchableLocation[] = [];

  // Add ski areas
  for (const area of skiAreas) {
    items.push({
      id: area.id,
      type: 'region',
      name: area.name,
      country: area.country,
      skiAreaId: area.id,
      lat: area.latitude,
      lng: area.longitude,
      runs: area._count.runs,
      lifts: area._count.lifts,
    });
  }

  // Add unique localities
  const seenLocalities = new Set<string>();
  for (const run of runsWithLocality) {
    if (!run.locality) continue;
    const key = `${run.locality}-${run.skiArea.id}`;
    if (seenLocalities.has(key)) continue;
    seenLocalities.add(key);

    items.push({
      id: `loc-${run.skiArea.id}-${run.locality}`,
      type: 'locality',
      name: run.locality,
      country: run.skiArea.country,
      region: run.skiArea.name,
      skiAreaId: run.skiArea.id,
    });
  }

  console.log(`Total items: ${items.length}`);

  // Ensure public/data directory exists
  const dataDir = path.join(process.cwd(), 'public', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Write to public/data/locations.json
  const outputPath = path.join(dataDir, 'locations.json');
  fs.writeFileSync(outputPath, JSON.stringify(items));

  // Calculate file size
  const stats = fs.statSync(outputPath);
  const sizeKB = (stats.size / 1024).toFixed(1);
  console.log(`Written to: ${outputPath} (${sizeKB} KB)`);

  await prisma.$disconnect();
}

generateLocations().catch(async (e) => {
  console.error('Error generating locations:', e);
  await prisma.$disconnect();
  process.exit(1);
});

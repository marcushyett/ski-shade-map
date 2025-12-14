/**
 * Recalculate ski area bounds from their runs and lifts
 * Use this to fix ski areas that only have Point geometry (single point bounds)
 * 
 * Usage: DATABASE_URL="..." npx tsx scripts/recalculate-bounds.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function recalculateBoundsFromRunsLifts() {
  console.log('📐 Recalculating ski area bounds from runs and lifts...');
  
  const skiAreas = await prisma.skiArea.findMany({
    select: { id: true, name: true, bounds: true },
  });

  console.log(`Found ${skiAreas.length} ski areas to process`);

  let updated = 0;
  let skipped = 0;
  
  for (const skiArea of skiAreas) {
    // Get all runs and lifts for this ski area
    const [runs, lifts] = await Promise.all([
      prisma.run.findMany({
        where: { skiAreaId: skiArea.id },
        select: { geometry: true },
      }),
      prisma.lift.findMany({
        where: { skiAreaId: skiArea.id },
        select: { geometry: true },
      }),
    ]);

    if (runs.length === 0 && lifts.length === 0) {
      skipped++;
      continue;
    }

    // Calculate bounds from all geometries
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    const processGeometry = (geometry: any) => {
      if (!geometry) return;
      
      let coords: number[][] = [];
      if (geometry.type === 'Point') {
        coords = [geometry.coordinates];
      } else if (geometry.type === 'LineString') {
        coords = geometry.coordinates || [];
      } else if (geometry.type === 'Polygon') {
        coords = (geometry.coordinates || []).flat();
      }

      for (const coord of coords) {
        if (coord && coord.length >= 2) {
          const [lng, lat] = coord;
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
        }
      }
    };

    runs.forEach(r => processGeometry(r.geometry));
    lifts.forEach(l => processGeometry(l.geometry));

    // Only update if we found valid bounds with actual area
    if (minLat !== Infinity && (maxLat - minLat > 0.0001 || maxLng - minLng > 0.0001)) {
      const newBounds = { minLat, maxLat, minLng, maxLng };
      
      await prisma.skiArea.update({
        where: { id: skiArea.id },
        data: { bounds: newBounds },
      });
      
      const oldBounds = skiArea.bounds as any;
      const wasPoint = oldBounds && Math.abs(oldBounds.minLat - oldBounds.maxLat) < 0.0001;
      
      if (wasPoint) {
        console.log(`  ✓ ${skiArea.name}: expanded from point to ${((maxLat - minLat) * 111).toFixed(1)}km x ${((maxLng - minLng) * 78).toFixed(1)}km`);
      }
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`\n✅ Updated bounds for ${updated} ski areas`);
  console.log(`   Skipped ${skipped} ski areas (no runs/lifts or already have bounds)`);
}

async function main() {
  try {
    await recalculateBoundsFromRunsLifts();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();


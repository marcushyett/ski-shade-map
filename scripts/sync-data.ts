/**
 * Local sync script - run this against your production database
 * Usage: npx tsx scripts/sync-data.ts [--country=FR] [--skip-runs] [--skip-lifts]
 */

import { PrismaClient } from '@prisma/client';
import { createReadStream, existsSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick';
import { streamArray } from 'stream-json/streamers/StreamArray';
import { chain } from 'stream-chain';

const prisma = new PrismaClient();

const OPENSKIMAP_BASE = 'https://tiles.openskimap.org/geojson';
const TMP_DIR = '/tmp';

interface SkiAreaPlace {
  iso3166_1Alpha2?: string;
  iso3166_2?: string;
  localized?: {
    en?: { country?: string; region?: string; locality?: string };
  };
}

interface SkiAreaProperties {
  id: string;
  name?: string;
  type?: string;
  status?: string;
  activities?: string[];
  places?: SkiAreaPlace[];
  location?: {
    iso3166_1Alpha2?: string;
    iso3166_2?: string;
    localized?: {
      en?: { country?: string; region?: string };
    };
  };
  statistics?: {
    runs?: {
      byActivity?: {
        downhill?: {
          byDifficulty?: Record<string, { count?: number }>;
        };
      };
    };
  };
}

interface RunProperties {
  id: string;
  name?: string;
  difficulty?: string;
  status?: string;
  skiAreas?: Array<{ properties: { id: string } }>;
}

interface LiftProperties {
  id: string;
  name?: string;
  liftType?: string;
  status?: string;
  capacity?: number;
  skiAreas?: Array<{ properties: { id: string } }>;
}

function getGeometryCenter(geometry: any): { lat: number; lng: number } | null {
  if (!geometry) return null;
  
  if (geometry.type === 'Point') {
    return { lng: geometry.coordinates[0], lat: geometry.coordinates[1] };
  }
  
  if (geometry.type === 'Polygon') {
    const coords = geometry.coordinates[0];
    const lats = coords.map((c: number[]) => c[1]);
    const lngs = coords.map((c: number[]) => c[0]);
    return {
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    };
  }
  
  if (geometry.type === 'LineString') {
    const coords = geometry.coordinates;
    const lats = coords.map((c: number[]) => c[1]);
    const lngs = coords.map((c: number[]) => c[0]);
    return {
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    };
  }
  
  return null;
}

function getGeometryBounds(geometry: any): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  if (!geometry) return null;
  
  let coords: number[][] = [];
  
  if (geometry.type === 'Point') {
    coords = [geometry.coordinates];
  } else if (geometry.type === 'LineString') {
    coords = geometry.coordinates;
  } else if (geometry.type === 'Polygon') {
    coords = geometry.coordinates.flat();
  } else if (geometry.type === 'MultiPolygon') {
    coords = geometry.coordinates.flat(2);
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

function mapDifficulty(difficulty?: string): string | null {
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

async function downloadFile(url: string, filename: string): Promise<string> {
  const filepath = `${TMP_DIR}/${filename}`;
  
  // Check if already downloaded recently (within last hour)
  if (existsSync(filepath)) {
    const stats = statSync(filepath);
    const ageMs = Date.now() - stats.mtimeMs;
    if (ageMs < 60 * 60 * 1000) {
      console.log(`   Using cached file (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
      return filepath;
    }
  }
  
  console.log(`   Downloading from ${url}...`);
  execSync(`curl -s "${url}" -o "${filepath}"`, { stdio: 'pipe' });
  
  const stats = statSync(filepath);
  console.log(`   Downloaded ${(stats.size / 1024 / 1024).toFixed(1)}MB`);
  
  return filepath;
}

async function processStreamedGeoJSON<T>(
  filepath: string,
  filter: (feature: { geometry: any; properties: T }) => boolean,
  processItem: (feature: { geometry: any; properties: T }) => Promise<void>,
  progressInterval: number = 1000
): Promise<number> {
  let processedCount = 0;
  let total = 0;
  
  const readStream = createReadStream(filepath);
  const jsonParser = parser();
  const arrayStreamer = streamArray();
  
  return new Promise((resolve, reject) => {
    readStream
      .pipe(jsonParser)
      .pipe(arrayStreamer)
      .on('data', async ({ value }: { value: { geometry: any; properties: T } }) => {
        total++;
        
        if (filter(value)) {
          try {
            await processItem(value);
            processedCount++;
            
            if (processedCount % progressInterval === 0) {
              process.stdout.write(`   Processed ${processedCount} items (scanned ${total})\r`);
            }
          } catch (e) {
            // Ignore individual errors
          }
        }
      })
      .on('end', () => {
        console.log(`   Processed ${processedCount} items (scanned ${total} total)     `);
        resolve(processedCount);
      })
      .on('error', reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const countryArg = args.find(a => a.startsWith('--country='));
  const countryFilter = countryArg ? countryArg.split('=')[1].toUpperCase() : null;
  const skipRuns = args.includes('--skip-runs');
  const skipLifts = args.includes('--skip-lifts');
  
  console.log(`🎿 Starting ski data sync${countryFilter ? ` for ${countryFilter}` : ' (all countries)'}...`);
  if (skipRuns) console.log('   (skipping runs)');
  if (skipLifts) console.log('   (skipping lifts)');
  console.log('');

  // Step 1: Fetch and process ski areas
  console.log('📥 Downloading ski areas...');
  const areasFile = await downloadFile(`${OPENSKIMAP_BASE}/ski_areas.geojson`, 'ski_areas.geojson');
  
  // For ski areas, we can load the whole file (it's ~16MB)
  const areasText = require('fs').readFileSync(areasFile, 'utf-8');
  const areasData = JSON.parse(areasText);
  let areas = areasData.features as Array<{ geometry: any; properties: SkiAreaProperties }>;
  
  console.log(`   Found ${areas.length} total ski areas`);
  
  // Filter by country
  if (countryFilter) {
    areas = areas.filter(area => {
      const props = area.properties;
      if (props?.places?.length) {
        return props.places.some(p => p.iso3166_1Alpha2?.toUpperCase() === countryFilter);
      }
      return props?.location?.iso3166_1Alpha2?.toUpperCase() === countryFilter;
    });
    console.log(`   Filtered to ${areas.length} areas in ${countryFilter}`);
  }
  
  // Filter to downhill ski areas with names
  areas = areas.filter(area => {
    const props = area.properties;
    if (!props?.name) return false;
    if (props.type && props.type !== 'skiArea') return false;
    const activities = props.activities || [];
    const hasDownhill = activities.includes('downhill') || 
      props.statistics?.runs?.byActivity?.downhill;
    return hasDownhill || activities.length === 0;
  });
  
  console.log(`   Filtered to ${areas.length} downhill ski areas`);
  console.log('');

  // Step 2: Upsert ski areas
  console.log('💾 Saving ski areas to database...');
  let processed = 0;
  
  for (const area of areas) {
    const props = area.properties;
    const center = getGeometryCenter(area.geometry);
    const bounds = getGeometryBounds(area.geometry);
    
    if (!center) continue;

    const firstPlace = props.places?.[0];
    const country = firstPlace?.localized?.en?.country || 
                   firstPlace?.iso3166_1Alpha2 ||
                   props.location?.localized?.en?.country || 
                   props.location?.iso3166_1Alpha2 || 
                   null;
    const region = firstPlace?.localized?.en?.region ||
                  firstPlace?.iso3166_2 ||
                  props.location?.localized?.en?.region ||
                  props.location?.iso3166_2 ||
                  null;

    try {
      await prisma.skiArea.upsert({
        where: { osmId: props.id },
        create: {
          osmId: props.id,
          name: props.name || 'Unknown',
          country,
          region,
          latitude: center.lat,
          longitude: center.lng,
          bounds: bounds ? JSON.parse(JSON.stringify(bounds)) : undefined,
          geometry: area.geometry ? JSON.parse(JSON.stringify(area.geometry)) : undefined,
          properties: props ? JSON.parse(JSON.stringify(props)) : undefined,
        },
        update: {
          name: props.name || 'Unknown',
          country,
          region,
          latitude: center.lat,
          longitude: center.lng,
          bounds: bounds ? JSON.parse(JSON.stringify(bounds)) : undefined,
          geometry: area.geometry ? JSON.parse(JSON.stringify(area.geometry)) : undefined,
          properties: props ? JSON.parse(JSON.stringify(props)) : undefined,
        },
      });
      processed++;
      
      if (processed % 50 === 0) {
        process.stdout.write(`   Processed ${processed}/${areas.length} ski areas\r`);
      }
    } catch (err) {
      console.error(`   Failed to upsert ${props.id}:`, err);
    }
  }
  
  console.log(`   ✅ Saved ${processed} ski areas                    `);
  console.log('');

  // Get mapping of OSM IDs to DB IDs
  const skiAreas = await prisma.skiArea.findMany({
    select: { id: true, osmId: true },
  });
  const osmIdToDbId = new Map(skiAreas.map((a: { osmId: string; id: string }) => [a.osmId, a.id]));
  console.log(`   Have ${osmIdToDbId.size} ski areas in database`);
  console.log('');

  // Step 3: Process runs (streaming)
  if (!skipRuns) {
    console.log('📥 Downloading runs (large file, may take a minute)...');
    const runsFile = await downloadFile(`${OPENSKIMAP_BASE}/runs.geojson`, 'runs.geojson');
    
    console.log('💾 Processing runs (streaming)...');
    let runsProcessed = 0;
    
    const pipeline = chain([
      createReadStream(runsFile),
      parser(),
      pick({ filter: 'features' }),
      streamArray(),
    ]);
    
    await new Promise<void>((resolve, reject) => {
      const processQueue: Promise<void>[] = [];
      
      pipeline
        .on('data', ({ value }: { value: { geometry: any; properties: RunProperties } }) => {
          const props = value.properties;
          const skiAreaRefs = props?.skiAreas || [];
          
          const matchingRef = skiAreaRefs.find(ref => osmIdToDbId.has(ref.properties?.id));
          if (!matchingRef) return;
          
          const skiAreaId = osmIdToDbId.get(matchingRef.properties?.id);
          if (!skiAreaId) return;
          
          const processPromise = prisma.run.upsert({
            where: { osmId: props.id },
            create: {
              osmId: props.id,
              name: props.name || null,
              difficulty: mapDifficulty(props.difficulty),
              status: props.status || null,
              geometry: JSON.parse(JSON.stringify(value.geometry)),
              properties: JSON.parse(JSON.stringify(props)),
              skiAreaId,
            },
            update: {
              name: props.name || null,
              difficulty: mapDifficulty(props.difficulty),
              status: props.status || null,
              geometry: JSON.parse(JSON.stringify(value.geometry)),
              properties: JSON.parse(JSON.stringify(props)),
            },
          }).then(() => {
            runsProcessed++;
            if (runsProcessed % 500 === 0) {
              process.stdout.write(`   Processed ${runsProcessed} runs\r`);
            }
          }).catch(() => {});
          
          processQueue.push(processPromise);
        })
        .on('end', async () => {
          await Promise.all(processQueue);
          console.log(`   ✅ Saved ${runsProcessed} runs                    `);
          resolve();
        })
        .on('error', reject);
    });
    console.log('');
  }

  // Step 4: Process lifts (streaming)
  if (!skipLifts) {
    console.log('📥 Downloading lifts...');
    const liftsFile = await downloadFile(`${OPENSKIMAP_BASE}/lifts.geojson`, 'lifts.geojson');
    
    console.log('💾 Processing lifts (streaming)...');
    let liftsProcessed = 0;
    
    const liftsPipeline = chain([
      createReadStream(liftsFile),
      parser(),
      pick({ filter: 'features' }),
      streamArray(),
    ]);
    
    await new Promise<void>((resolve, reject) => {
      const processQueue: Promise<void>[] = [];
      
      liftsPipeline
        .on('data', ({ value }: { value: { geometry: any; properties: LiftProperties } }) => {
          const props = value.properties;
          const skiAreaRefs = props?.skiAreas || [];
          
          const matchingRef = skiAreaRefs.find(ref => osmIdToDbId.has(ref.properties?.id));
          if (!matchingRef) return;
          
          const skiAreaId = osmIdToDbId.get(matchingRef.properties?.id);
          if (!skiAreaId) return;
          
          const processPromise = prisma.lift.upsert({
            where: { osmId: props.id },
            create: {
              osmId: props.id,
              name: props.name || null,
              liftType: props.liftType || null,
              status: props.status || null,
              capacity: props.capacity || null,
              geometry: JSON.parse(JSON.stringify(value.geometry)),
              properties: JSON.parse(JSON.stringify(props)),
              skiAreaId,
            },
            update: {
              name: props.name || null,
              liftType: props.liftType || null,
              status: props.status || null,
              capacity: props.capacity || null,
              geometry: JSON.parse(JSON.stringify(value.geometry)),
              properties: JSON.parse(JSON.stringify(props)),
            },
          }).then(() => {
            liftsProcessed++;
            if (liftsProcessed % 100 === 0) {
              process.stdout.write(`   Processed ${liftsProcessed} lifts\r`);
            }
          }).catch(() => {});
          
          processQueue.push(processPromise);
        })
        .on('end', async () => {
          await Promise.all(processQueue);
          console.log(`   ✅ Saved ${liftsProcessed} lifts                    `);
          resolve();
        })
        .on('error', reject);
    });
    console.log('');
  }

  // Record sync
  await prisma.dataSync.create({
    data: {
      dataType: 'ski_areas',
      lastSync: new Date(),
      recordCount: processed,
      status: 'success',
    },
  });

  // Get final counts
  const [skiAreaCount, runCount, liftCount] = await Promise.all([
    prisma.skiArea.count(),
    prisma.run.count(),
    prisma.lift.count(),
  ]);

  console.log('🎉 Sync complete!');
  console.log(`   📊 Database totals: ${skiAreaCount} ski areas, ${runCount} runs, ${liftCount} lifts`);
  
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Sync failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});

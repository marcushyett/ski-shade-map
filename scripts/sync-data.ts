/**
 * Local sync script - run this against your production database
 * Usage: npx tsx scripts/sync-data.ts [--country=FR] [--skip-runs] [--skip-lifts] [--data-dir=path]
 *
 * Options:
 *   --country=XX    Filter to specific country code (e.g., FR, CH, AT)
 *   --skip-runs     Skip syncing runs (faster for testing)
 *   --skip-lifts    Skip syncing lifts (faster for testing)
 *   --data-dir=path Use pre-downloaded geojson files from this directory
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { createReadStream, existsSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick';
import { streamArray } from 'stream-json/streamers/StreamArray';
import { chain } from 'stream-chain';

const prisma = new PrismaClient();

const OPENSKIMAP_BASE = 'https://tiles.openskimap.org/geojson';
const TMP_DIR = '/tmp';

// Batch size for COPY-based bulk upserts - can be larger since COPY is efficient
const BULK_UPSERT_SIZE = 5000;

// Generate a CUID-like ID
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 15);
  return `c${timestamp}${randomPart}`;
}

// Run data type for bulk upserts
type RunData = {
  osmId: string;
  name: string | null;
  difficulty: string | null;
  status: string | null;
  locality: string | null;
  geometry: any;
  properties: any;
  skiAreaId: string;
};

// Lift data type for bulk upserts
type LiftData = {
  osmId: string;
  name: string | null;
  liftType: string | null;
  status: string | null;
  locality: string | null;
  capacity: number | null;
  geometry: any;
  properties: any;
  skiAreaId: string;
};

// Sub-batch size for inserting into staging tables (kept small to avoid memory issues)
const STAGING_INSERT_SIZE = 200;

// Bulk upsert runs using staging table for maximum performance
// Strategy: insert into unlogged staging table in small chunks, then do single upsert
async function bulkUpsertRuns(runs: RunData[]): Promise<number> {
  if (runs.length === 0) return 0;

  const timestamp = Date.now();
  const stagingTable = `_runs_staging_${timestamp}`;

  try {
    // Create staging table (unlogged for speed - no WAL overhead)
    await prisma.$executeRawUnsafe(`
      CREATE UNLOGGED TABLE "${stagingTable}" (
        "id" TEXT NOT NULL,
        "osmId" TEXT NOT NULL,
        "name" TEXT,
        "difficulty" TEXT,
        "status" TEXT,
        "locality" TEXT,
        "geometry" JSONB,
        "properties" JSONB,
        "skiAreaId" TEXT NOT NULL
      )
    `);

    // Insert into staging table in small chunks to avoid memory issues
    const esc = (v: string | null) => v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`;
    const escJson = (v: any) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

    for (let i = 0; i < runs.length; i += STAGING_INSERT_SIZE) {
      const chunk = runs.slice(i, i + STAGING_INSERT_SIZE);
      const values = chunk.map(run => {
        const id = generateId();
        return `(${esc(id)}, ${esc(run.osmId)}, ${esc(run.name)}, ${esc(run.difficulty)}, ${esc(run.status)}, ${esc(run.locality)}, ${escJson(run.geometry)}, ${escJson(run.properties)}, ${esc(run.skiAreaId)})`;
      }).join(',\n');

      await prisma.$executeRawUnsafe(`
        INSERT INTO "${stagingTable}" ("id", "osmId", "name", "difficulty", "status", "locality", "geometry", "properties", "skiAreaId")
        VALUES ${values}
      `);
    }

    // Upsert from staging table to real table - database does all the work in one efficient operation
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Run" ("id", "osmId", "name", "difficulty", "status", "locality", "geometry", "properties", "skiAreaId", "createdAt", "updatedAt")
      SELECT "id", "osmId", "name", "difficulty", "status", "locality", "geometry", "properties", "skiAreaId", NOW(), NOW()
      FROM "${stagingTable}"
      ON CONFLICT ("osmId") DO UPDATE SET
        "name" = EXCLUDED."name",
        "difficulty" = EXCLUDED."difficulty",
        "status" = EXCLUDED."status",
        "locality" = EXCLUDED."locality",
        "geometry" = EXCLUDED."geometry",
        "properties" = EXCLUDED."properties",
        "updatedAt" = NOW()
    `);

    return runs.length;
  } finally {
    // Always clean up staging table
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${stagingTable}"`);
  }
}

// Bulk upsert lifts using staging table for maximum performance
async function bulkUpsertLifts(lifts: LiftData[]): Promise<number> {
  if (lifts.length === 0) return 0;

  const timestamp = Date.now();
  const stagingTable = `_lifts_staging_${timestamp}`;

  try {
    // Create staging table (unlogged for speed - no WAL overhead)
    await prisma.$executeRawUnsafe(`
      CREATE UNLOGGED TABLE "${stagingTable}" (
        "id" TEXT NOT NULL,
        "osmId" TEXT NOT NULL,
        "name" TEXT,
        "liftType" TEXT,
        "status" TEXT,
        "locality" TEXT,
        "capacity" INTEGER,
        "geometry" JSONB,
        "properties" JSONB,
        "skiAreaId" TEXT NOT NULL
      )
    `);

    // Insert into staging table in small chunks to avoid memory issues
    const esc = (v: string | null) => v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`;
    const escJson = (v: any) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
    const escNum = (v: number | null) => v === null ? 'NULL' : String(v);

    for (let i = 0; i < lifts.length; i += STAGING_INSERT_SIZE) {
      const chunk = lifts.slice(i, i + STAGING_INSERT_SIZE);
      const values = chunk.map(lift => {
        const id = generateId();
        return `(${esc(id)}, ${esc(lift.osmId)}, ${esc(lift.name)}, ${esc(lift.liftType)}, ${esc(lift.status)}, ${esc(lift.locality)}, ${escNum(lift.capacity)}, ${escJson(lift.geometry)}, ${escJson(lift.properties)}, ${esc(lift.skiAreaId)})`;
      }).join(',\n');

      await prisma.$executeRawUnsafe(`
        INSERT INTO "${stagingTable}" ("id", "osmId", "name", "liftType", "status", "locality", "capacity", "geometry", "properties", "skiAreaId")
        VALUES ${values}
      `);
    }

    // Upsert from staging table to real table - database does all the work in one efficient operation
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Lift" ("id", "osmId", "name", "liftType", "status", "locality", "capacity", "geometry", "properties", "skiAreaId", "createdAt", "updatedAt")
      SELECT "id", "osmId", "name", "liftType", "status", "locality", "capacity", "geometry", "properties", "skiAreaId", NOW(), NOW()
      FROM "${stagingTable}"
      ON CONFLICT ("osmId") DO UPDATE SET
        "name" = EXCLUDED."name",
        "liftType" = EXCLUDED."liftType",
        "status" = EXCLUDED."status",
        "locality" = EXCLUDED."locality",
        "capacity" = EXCLUDED."capacity",
        "geometry" = EXCLUDED."geometry",
        "properties" = EXCLUDED."properties",
        "updatedAt" = NOW()
    `);

    return lifts.length;
  } finally {
    // Always clean up staging table
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${stagingTable}"`);
  }
}

// Parse --data-dir argument for pre-downloaded files
const dataDirArg = process.argv.find(a => a.startsWith('--data-dir='));
const DATA_DIR = dataDirArg ? dataDirArg.split('=')[1] : null;

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
  places?: SkiAreaPlace[];
  skiAreas?: Array<{ properties: { id: string } }>;
}

interface LiftProperties {
  id: string;
  name?: string;
  liftType?: string;
  status?: string;
  capacity?: number;
  places?: SkiAreaPlace[];
  skiAreas?: Array<{ properties: { id: string } }>;
}

// Extract locality from places array on the run/lift itself
function extractLocality(places?: SkiAreaPlace[]): string | null {
  if (!places || places.length === 0) return null;
  for (const place of places) {
    const locality = place.localized?.en?.locality;
    if (locality) return locality;
  }
  return null;
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

async function downloadFile(url: string, filename: string, maxRetries: number = 3): Promise<string> {
  // Check if pre-downloaded file exists in DATA_DIR
  if (DATA_DIR) {
    const preDownloadedPath = `${DATA_DIR}/${filename}`;
    if (existsSync(preDownloadedPath)) {
      const stats = statSync(preDownloadedPath);
      console.log(`   Using pre-downloaded file (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
      return preDownloadedPath;
    }
  }

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
  
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Use curl with retry flags and timeout
      execSync(`curl -s --retry 3 --retry-delay 5 --connect-timeout 30 --max-time 600 "${url}" -o "${filepath}"`, { stdio: 'pipe' });
      
      const stats = statSync(filepath);
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }
      
      console.log(`   Downloaded ${(stats.size / 1024 / 1024).toFixed(1)}MB`);
      return filepath;
    } catch (error) {
      lastError = error as Error;
      console.error(`   Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
      
      if (attempt < maxRetries) {
        const delay = 10 * Math.pow(2, attempt - 1);
        console.log(`   Retrying in ${delay}s...`);
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
      }
    }
  }
  
  throw lastError || new Error(`Failed to download ${filename} after ${maxRetries} attempts`);
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
  const startTime = Date.now();
  const args = process.argv.slice(2);
  const countryArg = args.find(a => a.startsWith('--country='));
  const countryFilter = countryArg ? countryArg.split('=')[1].toUpperCase() : null;
  const resortArg = args.find(a => a.startsWith('--resort='));
  const resortFilter = resortArg ? resortArg.split('=')[1].replace(/^"|"$/g, '') : null;
  const skipRuns = args.includes('--skip-runs');
  const skipLifts = args.includes('--skip-lifts');

  const filterLabel = resortFilter ? ` - ${resortFilter}` : (countryFilter ? ` - ${countryFilter}` : '');

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║  🎿 SKI DATA SYNC${filterLabel.padEnd(48)} ║`);
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  Started: ${new Date().toISOString()}                   ║`);
  if (DATA_DIR) console.log(`║  📂 Using pre-downloaded data from: ${DATA_DIR.padEnd(28)} ║`);
  if (resortFilter) console.log(`║  🏔️  Resort filter: ${resortFilter.padEnd(44)} ║`);
  if (skipRuns) console.log('║  ⏭️  Skipping runs                                                ║');
  if (skipLifts) console.log('║  ⏭️  Skipping lifts                                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Step 1: Fetch and process ski areas
  console.log('📥 Downloading ski areas...');
  const areasFile = await downloadFile(`${OPENSKIMAP_BASE}/ski_areas.geojson`, 'ski_areas.geojson');
  
  // For ski areas, we can load the whole file (it's ~16MB)
  const areasText = require('fs').readFileSync(areasFile, 'utf-8');
  const areasData = JSON.parse(areasText);
  let areas = areasData.features as Array<{ geometry: any; properties: SkiAreaProperties }>;
  
  console.log(`   Found ${areas.length} total ski areas`);
  
  // Filter by country (skip if resort filter is active)
  if (countryFilter && countryFilter !== 'ALL' && !resortFilter) {
    areas = areas.filter(area => {
      const props = area.properties;
      if (props?.places?.length) {
        return props.places.some(p => p.iso3166_1Alpha2?.toUpperCase() === countryFilter);
      }
      return props?.location?.iso3166_1Alpha2?.toUpperCase() === countryFilter;
    });
    console.log(`   Filtered to ${areas.length} areas in ${countryFilter}`);
  }

  // Filter by resort name (case-insensitive partial match)
  if (resortFilter) {
    const searchTerm = resortFilter.toLowerCase();
    areas = areas.filter(area => {
      const name = area.properties?.name?.toLowerCase() || '';
      return name.includes(searchTerm);
    });
    console.log(`   Filtered to ${areas.length} areas matching "${resortFilter}"`);
    if (areas.length === 0) {
      console.error(`   ❌ No ski areas found matching "${resortFilter}"`);
      process.exit(1);
    }
    if (areas.length > 5) {
      console.warn(`   ⚠️  Found ${areas.length} matching areas - consider a more specific name`);
    }
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
  const osmIdToDbId = new Map<string, string>(
    skiAreas
      .filter((a: { id: string; osmId: string | null }): a is { id: string; osmId: string } => a.osmId !== null)
      .map((a: { id: string; osmId: string }) => [a.osmId, a.id])
  );
  console.log(`   Have ${osmIdToDbId.size} ski areas in database`);

  // Build fallback locality map from ski areas (better coverage than runs/lifts)
  const osmIdToLocality = new Map<string, string>();
  for (const area of areas) {
    const locality = extractLocality(area.properties.places);
    if (locality) {
      osmIdToLocality.set(area.properties.id, locality);
    }
  }
  console.log(`   Have ${osmIdToLocality.size} ski areas with locality data (fallback)`);
  console.log('');

  // Step 3: Process runs (streaming)
  if (!skipRuns) {
    console.log('📥 Downloading runs (large file, may take a minute)...');
    const runsFile = await downloadFile(`${OPENSKIMAP_BASE}/runs.geojson`, 'runs.geojson');

    console.log('💾 Processing runs (streaming)...');
    let runsProcessed = 0;
    let runsFailed = 0;
    let runsWithPlaces = 0;
    let runsWithLocality = 0;
    let samplePlacesLogged = false;

    const pipeline = chain([
      createReadStream(runsFile),
      parser(),
      pick({ filter: 'features' }),
      streamArray(),
    ]);

    // Collect runs into batches for bulk upsert
    let pendingBatch: RunData[] = [];

    const processPendingBatch = async () => {
      if (pendingBatch.length === 0) return;

      const batch = pendingBatch;
      pendingBatch = [];

      try {
        const count = await bulkUpsertRuns(batch);
        runsProcessed += count;
        process.stdout.write(`   Processed ${runsProcessed} runs\r`);
      } catch (err) {
        runsFailed += batch.length;
        console.error(`   ❌ Bulk upsert failed for ${batch.length} runs: ${(err as Error).message}`);
      }
    };

    await new Promise<void>((resolve, reject) => {
      pipeline
        .on('data', async ({ value }: { value: { geometry: any; properties: RunProperties } }) => {
          const props = value.properties;
          const skiAreaRefs = props?.skiAreas || [];

          const matchingRef = skiAreaRefs.find(ref => osmIdToDbId.has(ref.properties?.id));
          if (!matchingRef) return;

          const skiAreaOsmId = matchingRef.properties?.id;
          const skiAreaId = osmIdToDbId.get(skiAreaOsmId);
          if (!skiAreaId) return;

          // Debug logging for locality
          if (props.places && props.places.length > 0) {
            runsWithPlaces++;
            if (!samplePlacesLogged) {
              console.log(`   📍 Sample run props keys: ${Object.keys(props).join(', ')}`);
              console.log(`   📍 Sample run places data: ${JSON.stringify(props.places[0])}`);
              samplePlacesLogged = true;
            }
          } else if (pendingBatch.length < 5 && runsProcessed === 0) {
            console.log(`   ⚠️ Run "${props.name}" has no places. Keys: ${Object.keys(props).join(', ')}`);
          }

          // Try run's own locality first, fall back to ski area's locality
          const locality = extractLocality(props.places) || osmIdToLocality.get(skiAreaOsmId) || null;
          if (locality) {
            runsWithLocality++;
            if (runsWithLocality <= 3) {
              console.log(`   ✓ Extracted locality "${locality}" for run "${props.name}"`);
            }
          }

          pendingBatch.push({
            osmId: props.id,
            name: props.name || null,
            difficulty: mapDifficulty(props.difficulty),
            status: props.status || null,
            locality,
            geometry: value.geometry,
            properties: props,
            skiAreaId,
          });

          // Process batch when full
          if (pendingBatch.length >= BULK_UPSERT_SIZE) {
            pipeline.pause();
            await processPendingBatch();
            pipeline.resume();
          }
        })
        .on('end', async () => {
          // Process any remaining items
          await processPendingBatch();
          console.log(`   ✅ Saved ${runsProcessed} runs (${runsFailed} failed)                    `);
          console.log(`   📊 Locality stats: ${runsWithPlaces} runs with places data, ${runsWithLocality} with extracted locality`);
          if (runsWithPlaces === 0) {
            console.log(`   ⚠️  WARNING: No runs have places data - locality will be null for all runs`);
          }
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
    let liftsFailed = 0;
    let liftsWithPlaces = 0;
    let liftsWithLocality = 0;
    let sampleLiftPlacesLogged = false;

    const liftsPipeline = chain([
      createReadStream(liftsFile),
      parser(),
      pick({ filter: 'features' }),
      streamArray(),
    ]);

    // Collect lifts into batches for bulk upsert
    let pendingLiftBatch: LiftData[] = [];

    const processPendingLiftBatch = async () => {
      if (pendingLiftBatch.length === 0) return;

      const batch = pendingLiftBatch;
      pendingLiftBatch = [];

      try {
        const count = await bulkUpsertLifts(batch);
        liftsProcessed += count;
        process.stdout.write(`   Processed ${liftsProcessed} lifts\r`);
      } catch (err) {
        liftsFailed += batch.length;
        console.error(`   ❌ Bulk upsert failed for ${batch.length} lifts: ${(err as Error).message}`);
      }
    };

    await new Promise<void>((resolve, reject) => {
      liftsPipeline
        .on('data', async ({ value }: { value: { geometry: any; properties: LiftProperties } }) => {
          const props = value.properties;
          const skiAreaRefs = props?.skiAreas || [];

          const matchingRef = skiAreaRefs.find(ref => osmIdToDbId.has(ref.properties?.id));
          if (!matchingRef) return;

          const skiAreaOsmId = matchingRef.properties?.id;
          const skiAreaId = osmIdToDbId.get(skiAreaOsmId);
          if (!skiAreaId) return;

          // Debug logging for locality
          if (props.places && props.places.length > 0) {
            liftsWithPlaces++;
            if (!sampleLiftPlacesLogged) {
              console.log(`   📍 Sample lift places data: ${JSON.stringify(props.places[0])}`);
              sampleLiftPlacesLogged = true;
            }
          }

          // Try lift's own locality first, fall back to ski area's locality
          const locality = extractLocality(props.places) || osmIdToLocality.get(skiAreaOsmId) || null;
          if (locality) {
            liftsWithLocality++;
          }

          pendingLiftBatch.push({
            osmId: props.id,
            name: props.name || null,
            liftType: props.liftType || null,
            status: props.status || null,
            locality,
            capacity: props.capacity || null,
            geometry: value.geometry,
            properties: props,
            skiAreaId,
          });

          // Process batch when full
          if (pendingLiftBatch.length >= BULK_UPSERT_SIZE) {
            liftsPipeline.pause();
            await processPendingLiftBatch();
            liftsPipeline.resume();
          }
        })
        .on('end', async () => {
          // Process any remaining items
          await processPendingLiftBatch();
          console.log(`   ✅ Saved ${liftsProcessed} lifts (${liftsFailed} failed)                    `);
          console.log(`   📊 Locality stats: ${liftsWithPlaces} lifts with places data, ${liftsWithLocality} with extracted locality`);
          if (liftsWithPlaces === 0) {
            console.log(`   ⚠️  WARNING: No lifts have places data - locality will be null for all lifts`);
          }
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

  // Recalculate bounds from runs and lifts (ski areas often only have Point geometry)
  console.log('\n📐 Recalculating ski area bounds from runs and lifts...');
  await recalculateBoundsFromRunsLifts();

  // Get final counts including locality statistics
  const [skiAreaCount, runCount, liftCount, runsWithLocality, liftsWithLocality] = await Promise.all([
    prisma.skiArea.count(),
    prisma.run.count(),
    prisma.lift.count(),
    prisma.run.count({ where: { locality: { not: null } } }),
    prisma.lift.count({ where: { locality: { not: null } } }),
  ]);

  const runLocalityPct = runCount > 0 ? ((runsWithLocality / runCount) * 100).toFixed(1) : '0';
  const liftLocalityPct = liftCount > 0 ? ((liftsWithLocality / liftCount) * 100).toFixed(1) : '0';

  // Final summary
  const duration = Math.round((Date.now() - startTime) / 1000);
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  ✅ SYNC COMPLETE                                                ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  Duration: ${mins}m ${secs}s`.padEnd(68) + '║');
  console.log(`║  Ski Areas: ${areas.length}`.padEnd(68) + '║');
  console.log(`║  Database: ${skiAreaCount} areas, ${runCount} runs, ${liftCount} lifts`.padEnd(68) + '║');
  console.log(`║  Runs with locality: ${runsWithLocality}/${runCount} (${runLocalityPct}%)`.padEnd(68) + '║');
  console.log(`║  Lifts with locality: ${liftsWithLocality}/${liftCount} (${liftLocalityPct}%)`.padEnd(68) + '║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');

  await prisma.$disconnect();
}

// Recalculate ski area bounds from their runs and lifts
async function recalculateBoundsFromRunsLifts() {
  const skiAreas = await prisma.skiArea.findMany({
    select: { id: true, name: true, bounds: true },
  });

  let updated = 0;
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

    // Only update if we found valid bounds
    if (minLat !== Infinity && maxLat !== -Infinity) {
      const newBounds = { minLat, maxLat, minLng, maxLng };
      
      // Check if bounds actually changed (more than just a point)
      const oldBounds = skiArea.bounds as any;
      const isJustPoint = oldBounds && oldBounds.minLat === oldBounds.maxLat;
      const hasRealBounds = maxLat - minLat > 0.001 || maxLng - minLng > 0.001;
      
      if (isJustPoint || hasRealBounds) {
        await prisma.skiArea.update({
          where: { id: skiArea.id },
          data: { bounds: newBounds },
        });
        updated++;
      }
    }
  }

  console.log(`   Updated bounds for ${updated} ski areas`);
}

main().catch(async (e) => {
  console.error('');
  console.error('╔══════════════════════════════════════════════════════════════════╗');
  console.error('║  ❌ SYNC FAILED                                                  ║');
  console.error('╚══════════════════════════════════════════════════════════════════╝');
  console.error('');
  console.error('Error:', e);
  await prisma.$disconnect();
  process.exit(1);
});

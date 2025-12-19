import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  fetchSkiAreas,
  getGeometryCenter,
  getGeometryBounds,
  mapDifficulty,
} from "@/lib/data-loader";
import type { Feature, Geometry, LineString, Polygon } from "geojson";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for initial sync

// Secret key to protect the sync endpoint
const SYNC_SECRET = process.env.SYNC_SECRET || "dev-sync-key";

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
  websites?: string[];
  activities?: string[];
  generated?: boolean;
  runConvention?: string;
  sources?: unknown[];
  places?: SkiAreaPlace[];
  // Legacy format
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
    lifts?: {
      byType?: Record<string, { count?: number }>;
    };
  };
}

interface RunProperties {
  id: string;
  name?: string;
  type?: string;
  difficulty?: string;
  status?: string;
  uses?: string[];
  skiAreas?: Array<{ properties: { id: string; places?: SkiAreaPlace[] } }>;
}

interface LiftProperties {
  id: string;
  name?: string;
  liftType?: string;
  status?: string;
  capacity?: number;
  skiAreas?: Array<{ properties: { id: string; places?: SkiAreaPlace[] } }>;
}

// Extract locality from ski area places
function extractLocality(
  skiAreas?: Array<{ properties: { id: string; places?: SkiAreaPlace[] } }>
): string | null {
  if (!skiAreas || skiAreas.length === 0) return null;

  // Try to get locality from the first ski area's places
  for (const skiArea of skiAreas) {
    const places = skiArea.properties?.places;
    if (!places) continue;

    for (const place of places) {
      const locality = place.localized?.en?.locality;
      if (locality) return locality;
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  // Simple auth check
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${SYNC_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const dataType = searchParams.get("type") || "all";
  const countryFilter = searchParams.get("country"); // e.g., 'FR' for France
  const force = searchParams.get("force") === "true";

  try {
    // Check if sync is needed (unless force=true)
    if (!force) {
      const lastSync = await prisma.dataSync.findFirst({
        where: {
          dataType: "ski_areas",
          status: "success",
        },
        orderBy: { lastSync: "desc" },
      });

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      if (lastSync && lastSync.lastSync > thirtyDaysAgo) {
        return NextResponse.json({
          skipped: true,
          message:
            "Sync skipped - last sync was less than 30 days ago. Use force=true to override.",
          lastSync: lastSync.lastSync.toISOString(),
          recordCount: lastSync.recordCount,
          nextSyncAfter: new Date(
            lastSync.lastSync.getTime() + 30 * 24 * 60 * 60 * 1000
          ).toISOString(),
        });
      }
    }

    if (dataType === "all" || dataType === "ski_areas") {
      await syncSkiAreas(countryFilter);
    }

    return NextResponse.json({
      success: true,
      message: `Sync completed for ${dataType}${
        countryFilter ? ` (${countryFilter})` : ""
      }`,
    });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: "Sync failed", details: String(error) },
      { status: 500 }
    );
  }
}

async function syncSkiAreas(countryFilter: string | null) {
  console.log("Starting ski areas sync...");

  // Fetch the full ski areas file
  const response = await fetch(
    "https://tiles.openskimap.org/geojson/ski_areas.geojson"
  );
  if (!response.ok) throw new Error("Failed to fetch ski areas");

  const data = await response.json();
  let areas = data.features as Feature<Geometry, SkiAreaProperties>[];

  // Filter by country if specified
  if (countryFilter) {
    areas = areas.filter((area) => {
      const props = area.properties;
      // Check new format (places array)
      if (props?.places?.length) {
        return props.places.some(
          (p) =>
            p.iso3166_1Alpha2?.toUpperCase() === countryFilter.toUpperCase()
        );
      }
      // Check legacy format (location object)
      return (
        props?.location?.iso3166_1Alpha2?.toUpperCase() ===
        countryFilter.toUpperCase()
      );
    });
  }

  // Filter to only downhill ski areas with names
  areas = areas.filter((area) => {
    const props = area.properties;
    if (!props?.name) return false;
    if (props.type && props.type !== "skiArea") return false;
    // Check if it has downhill activities or runs
    const activities = props.activities || [];
    const hasDownhill =
      activities.includes("downhill") ||
      props.statistics?.runs?.byActivity?.downhill;
    return hasDownhill || activities.length === 0; // Include if no activity specified
  });

  console.log(`Processing ${areas.length} ski areas...`);

  // Process in batches
  const batchSize = 50;
  let processed = 0;

  for (let i = 0; i < areas.length; i += batchSize) {
    const batch = areas.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (area) => {
        const props = area.properties;
        const center = getGeometryCenter(area.geometry);
        const bounds = getGeometryBounds(area.geometry);

        if (!center) return;

        // Extract country/region from places (new format) or location (legacy)
        const firstPlace = props.places?.[0];
        const country =
          firstPlace?.localized?.en?.country ||
          firstPlace?.iso3166_1Alpha2 ||
          props.location?.localized?.en?.country ||
          props.location?.iso3166_1Alpha2 ||
          null;
        const region =
          firstPlace?.localized?.en?.region ||
          firstPlace?.iso3166_2 ||
          props.location?.localized?.en?.region ||
          props.location?.iso3166_2 ||
          null;

        try {
          await prisma.skiArea.upsert({
            where: { osmId: props.id },
            create: {
              osmId: props.id,
              name: props.name || "Unknown",
              country,
              region,
              latitude: center.lat,
              longitude: center.lng,
              bounds: bounds ? JSON.parse(JSON.stringify(bounds)) : undefined,
              geometry: area.geometry
                ? JSON.parse(JSON.stringify(area.geometry))
                : undefined,
              properties: props ? JSON.parse(JSON.stringify(props)) : undefined,
            },
            update: {
              name: props.name || "Unknown",
              country,
              region,
              latitude: center.lat,
              longitude: center.lng,
              bounds: bounds ? JSON.parse(JSON.stringify(bounds)) : undefined,
              geometry: area.geometry
                ? JSON.parse(JSON.stringify(area.geometry))
                : undefined,
              properties: props ? JSON.parse(JSON.stringify(props)) : undefined,
            },
          });
        } catch (err) {
          console.error(`Failed to upsert ski area ${props.id}:`, err);
        }
      })
    );

    processed += batch.length;
    console.log(`Processed ${processed}/${areas.length} ski areas`);
  }

  // Now sync runs and lifts for the imported ski areas
  await syncRunsAndLifts(countryFilter);

  // Record sync
  await prisma.dataSync.create({
    data: {
      dataType: "ski_areas",
      lastSync: new Date(),
      recordCount: processed,
      status: "success",
    },
  });

  console.log("Ski areas sync completed");
}

async function syncRunsAndLifts(countryFilter: string | null) {
  // Get all ski area OSM IDs we have in DB
  const skiAreas = await prisma.skiArea.findMany({
    select: { id: true, osmId: true },
  });

  const osmIdToDbId = new Map(
    skiAreas.map((a: { id: string; osmId: string | null }) => [a.osmId, a.id])
  );

  // Fetch runs
  console.log("Fetching runs...");
  const runsResponse = await fetch(
    "https://tiles.openskimap.org/geojson/runs.geojson"
  );
  if (!runsResponse.ok) throw new Error("Failed to fetch runs");

  const runsData = await runsResponse.json();
  const runs = (
    runsData.features as Feature<LineString | Polygon, RunProperties>[]
  ).filter((run) => {
    const skiAreaRefs = run.properties?.skiAreas || [];
    return skiAreaRefs.some((ref) => osmIdToDbId.has(ref.properties?.id));
  });

  console.log(`Processing ${runs.length} runs...`);

  // Process runs in batches
  const batchSize = 100;
  for (let i = 0; i < runs.length; i += batchSize) {
    const batch = runs.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (run) => {
        const props = run.properties;
        const skiAreaRefs = props.skiAreas || [];

        // Find first matching ski area
        const matchingRef = skiAreaRefs.find((ref) =>
          osmIdToDbId.has(ref.properties?.id)
        );
        if (!matchingRef) return;

        const skiAreaId = osmIdToDbId.get(matchingRef.properties?.id);
        if (!skiAreaId) return;

        const locality = extractLocality(skiAreaRefs);

        try {
          await prisma.run.upsert({
            where: { osmId: props.id },
            create: {
              osmId: props.id,
              name: props.name || null,
              difficulty: mapDifficulty(props.difficulty),
              status: props.status || null,
              locality,
              geometry: JSON.parse(JSON.stringify(run.geometry)),
              properties: JSON.parse(JSON.stringify(props)),
              skiAreaId,
            },
            update: {
              name: props.name || null,
              difficulty: mapDifficulty(props.difficulty),
              status: props.status || null,
              locality,
              geometry: JSON.parse(JSON.stringify(run.geometry)),
              properties: JSON.parse(JSON.stringify(props)),
            },
          });
        } catch (err) {
          // Ignore duplicate errors
        }
      })
    );
  }

  // Fetch lifts
  console.log("Fetching lifts...");
  const liftsResponse = await fetch(
    "https://tiles.openskimap.org/geojson/lifts.geojson"
  );
  if (!liftsResponse.ok) throw new Error("Failed to fetch lifts");

  const liftsData = await liftsResponse.json();
  const lifts = (
    liftsData.features as Feature<LineString, LiftProperties>[]
  ).filter((lift) => {
    const skiAreaRefs = lift.properties?.skiAreas || [];
    return skiAreaRefs.some((ref) => osmIdToDbId.has(ref.properties?.id));
  });

  console.log(`Processing ${lifts.length} lifts...`);

  for (let i = 0; i < lifts.length; i += batchSize) {
    const batch = lifts.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (lift) => {
        const props = lift.properties;
        const skiAreaRefs = props.skiAreas || [];

        const matchingRef = skiAreaRefs.find((ref) =>
          osmIdToDbId.has(ref.properties?.id)
        );
        if (!matchingRef) return;

        const skiAreaId = osmIdToDbId.get(matchingRef.properties?.id);
        if (!skiAreaId) return;

        const locality = extractLocality(skiAreaRefs);

        try {
          await prisma.lift.upsert({
            where: { osmId: props.id },
            create: {
              osmId: props.id,
              name: props.name || null,
              liftType: props.liftType || null,
              status: props.status || null,
              locality,
              capacity: props.capacity || null,
              geometry: JSON.parse(JSON.stringify(lift.geometry)),
              properties: JSON.parse(JSON.stringify(props)),
              skiAreaId,
            },
            update: {
              name: props.name || null,
              liftType: props.liftType || null,
              status: props.status || null,
              locality,
              capacity: props.capacity || null,
              geometry: JSON.parse(JSON.stringify(lift.geometry)),
              properties: JSON.parse(JSON.stringify(props)),
            },
          });
        } catch (err) {
          // Ignore duplicate errors
        }
      })
    );
  }

  console.log("Runs and lifts sync completed");
}

import { NextRequest, NextResponse } from 'next/server';
import { getSupportedResorts, fetchResortStatus } from 'ski-resort-status';

// Cache resort status for 5 minutes
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

interface SupportedResort {
  id: string;
  name: string;
  openskimap_id: string | string[];
  platform: string;
}

function getResortIdForOpenskimapId(openskimapId: string): { resortId: string | null; matchedResort: SupportedResort | null } {
  const resorts = getSupportedResorts() as SupportedResort[];
  const resort = resorts.find(r => {
    if (Array.isArray(r.openskimap_id)) {
      return r.openskimap_id.includes(openskimapId);
    }
    return r.openskimap_id === openskimapId;
  });
  return { resortId: resort?.id || null, matchedResort: resort || null };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: openskimapId } = await params;

  console.log(`[LiftStatus] Request for openskimapId: ${openskimapId}`);

  // Check cache
  const cached = cache.get(openskimapId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[LiftStatus] Cache hit for ${openskimapId}`);
    return NextResponse.json(cached.data);
  }

  // Get resort ID
  const { resortId, matchedResort } = getResortIdForOpenskimapId(openskimapId);
  console.log(`[LiftStatus] Resort lookup for ${openskimapId}:`, {
    found: !!resortId,
    resortId,
    resortName: matchedResort?.name,
    platform: matchedResort?.platform,
  });

  if (!resortId) {
    console.log(`[LiftStatus] Resort not supported: ${openskimapId}`);
    return NextResponse.json({ error: 'Resort not supported', supported: false }, { status: 404 });
  }

  try {
    console.log(`[LiftStatus] Fetching status for resort: ${resortId} (${matchedResort?.name})`);
    const rawData = await fetchResortStatus(resortId);

    // Debug: log raw data structure
    const rawSampleLift = rawData.lifts?.[0];
    console.log(`[LiftStatus] Raw data sample lift:`, {
      name: rawSampleLift?.name,
      keys: rawSampleLift ? Object.keys(rawSampleLift) : [],
      openskimap_ids: rawSampleLift?.openskimap_ids,
      openskimapIds: rawSampleLift?.openskimapIds,
    });

    // Transform to our types
    const data = {
      resort: {
        id: rawData.resort.id,
        name: rawData.resort.name,
        openskimapId: rawData.resort.openskimap_id,
      },
      lifts: rawData.lifts.map((lift: Record<string, unknown>) => ({
        name: lift.name,
        status: lift.status,
        liftType: lift.liftType,
        openskimapIds: lift.openskimap_ids || [],
        capacity: lift.capacity,
        duration: lift.duration,
        length: lift.length,
        uphillCapacity: lift.uphillCapacity,
        speed: lift.speed,
        arrivalAltitude: lift.arrivalAltitude,
        departureAltitude: lift.departureAltitude,
        openingTimes: lift.openingTimesTheoretic,
        operating: lift.operating,
        openingStatus: lift.openingStatus,
      })),
      runs: rawData.runs.map((run: Record<string, unknown>) => ({
        name: run.name,
        status: run.status,
        trailType: run.trailType,
        level: run.level,
        openskimapIds: run.openskimap_ids || [],
        length: run.length,
        arrivalAltitude: run.arrivalAltitude,
        departureAltitude: run.departureAltitude,
        guaranteedSnow: run.guaranteedSnow,
        openingTimes: run.openingTimesTheoretic,
        operating: run.operating,
        openingStatus: run.openingStatus,
        groomingStatus: run.groomingStatus,
        snowQuality: run.snowQuality,
      })),
      fetchedAt: Date.now(),
    };

    console.log(`[LiftStatus] Success for ${openskimapId}:`, {
      lifts: data.lifts.length,
      runs: data.runs.length,
      liftSample: data.lifts.slice(0, 2).map((l: { name: unknown; status: unknown; openskimapIds: unknown }) => ({ name: l.name, status: l.status, openskimapIds: l.openskimapIds })),
      runSample: data.runs.slice(0, 2).map((r: { name: unknown; status: unknown; openskimapIds: unknown }) => ({ name: r.name, status: r.status, openskimapIds: r.openskimapIds })),
    });

    // Cache the result
    cache.set(openskimapId, { data, timestamp: Date.now() });

    return NextResponse.json(data);
  } catch (error) {
    console.error(`[LiftStatus] Failed to fetch for ${openskimapId}:`, error);
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 });
  }
}

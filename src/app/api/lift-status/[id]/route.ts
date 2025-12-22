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

function getResortIdForOpenskimapId(openskimapId: string): string | null {
  const resorts = getSupportedResorts() as SupportedResort[];
  const resort = resorts.find(r => {
    if (Array.isArray(r.openskimap_id)) {
      return r.openskimap_id.includes(openskimapId);
    }
    return r.openskimap_id === openskimapId;
  });
  return resort?.id || null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: openskimapId } = await params;

  // Check cache
  const cached = cache.get(openskimapId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cached.data);
  }

  // Get resort ID
  const resortId = getResortIdForOpenskimapId(openskimapId);
  if (!resortId) {
    return NextResponse.json({ error: 'Resort not supported', supported: false }, { status: 404 });
  }

  try {
    const rawData = await fetchResortStatus(resortId);

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

    // Cache the result
    cache.set(openskimapId, { data, timestamp: Date.now() });

    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch resort status:', error);
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 });
  }
}

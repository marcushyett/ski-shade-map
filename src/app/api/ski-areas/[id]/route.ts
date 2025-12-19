import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const includeConnected = url.searchParams.get('includeConnected') === 'true';

  try {
    const skiArea = await prisma.skiArea.findUnique({
      where: { id },
      include: {
        runs: true,
        lifts: true,
        connectedTo: {
          include: {
            toArea: {
              select: {
                id: true,
                name: true,
                country: true,
                region: true,
                latitude: true,
                longitude: true,
              },
            },
          },
        },
        connectedFrom: {
          include: {
            fromArea: {
              select: {
                id: true,
                name: true,
                country: true,
                region: true,
                latitude: true,
                longitude: true,
              },
            },
          },
        },
      },
    });

    if (!skiArea) {
      return NextResponse.json(
        { error: 'Ski area not found' },
        { status: 404 }
      );
    }

    // Build connected areas list (bidirectional)
    const connectedAreas = [
      ...skiArea.connectedTo.map(c => c.toArea),
      ...skiArea.connectedFrom.map(c => c.fromArea),
    ];

    // Transform runs
    const runs = skiArea.runs.map(run => ({
      id: run.id,
      osmId: run.osmId,
      name: run.name,
      difficulty: run.difficulty,
      status: run.status,
      locality: run.locality,
      geometry: run.geometry,
      properties: run.properties,
    }));

    // Transform lifts
    const lifts = skiArea.lifts.map(lift => ({
      id: lift.id,
      osmId: lift.osmId,
      name: lift.name,
      liftType: lift.liftType,
      status: lift.status,
      locality: lift.locality,
      capacity: lift.capacity,
      geometry: lift.geometry,
      properties: lift.properties,
    }));

    // Collect unique localities from runs and lifts
    const localitySet = new Set<string>();
    runs.forEach(run => {
      if (run.locality) localitySet.add(run.locality);
    });
    lifts.forEach(lift => {
      if (lift.locality) localitySet.add(lift.locality);
    });
    const localities = Array.from(localitySet).sort();

    // If includeConnected is true, also fetch runs/lifts from connected areas
    let allRuns = runs;
    let allLifts = lifts;
    let allLocalities = localities;

    if (includeConnected && connectedAreas.length > 0) {
      for (const connectedArea of connectedAreas) {
        const connected = await prisma.skiArea.findUnique({
          where: { id: connectedArea.id },
          include: {
            runs: true,
            lifts: true,
          },
        });

        if (connected) {
          // Add connected runs
          const connectedRuns = connected.runs.map(run => ({
            id: run.id,
            osmId: run.osmId,
            name: run.name,
            difficulty: run.difficulty,
            status: run.status,
            locality: run.locality || connectedArea.name,
            geometry: run.geometry,
            properties: run.properties,
          }));
          allRuns = [...allRuns, ...connectedRuns];

          // Add connected lifts
          const connectedLifts = connected.lifts.map(lift => ({
            id: lift.id,
            osmId: lift.osmId,
            name: lift.name,
            liftType: lift.liftType,
            status: lift.status,
            locality: lift.locality || connectedArea.name,
            capacity: lift.capacity,
            geometry: lift.geometry,
            properties: lift.properties,
          }));
          allLifts = [...allLifts, ...connectedLifts];

          // Add localities from connected areas
          connectedRuns.forEach(run => {
            if (run.locality) localitySet.add(run.locality);
          });
          connectedLifts.forEach(lift => {
            if (lift.locality) localitySet.add(lift.locality);
          });
        }
      }
      allLocalities = Array.from(localitySet).sort();
    }

    const response = {
      id: skiArea.id,
      osmId: skiArea.osmId,
      name: skiArea.name,
      country: skiArea.country,
      region: skiArea.region,
      latitude: skiArea.latitude,
      longitude: skiArea.longitude,
      bounds: skiArea.bounds,
      geometry: skiArea.geometry,
      properties: skiArea.properties,
      runs: allRuns,
      lifts: allLifts,
      localities: allLocalities,
      connectedAreas: connectedAreas.length > 0 ? connectedAreas : undefined,
    };

    // Cache for 1 hour, stale-while-revalidate for 24 hours
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('Error fetching ski area:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ski area' },
      { status: 500 }
    );
  }
}

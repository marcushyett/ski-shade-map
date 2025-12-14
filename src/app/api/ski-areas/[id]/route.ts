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
        runs: {
          include: {
            subRegion: {
              select: { id: true, name: true },
            },
          },
        },
        lifts: {
          include: {
            subRegion: {
              select: { id: true, name: true },
            },
          },
        },
        subRegions: {
          select: {
            id: true,
            name: true,
            bounds: true,
            centroid: true,
          },
          orderBy: { name: 'asc' },
        },
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

    // Transform runs to include subRegionName
    const runs = skiArea.runs.map(run => ({
      id: run.id,
      osmId: run.osmId,
      name: run.name,
      difficulty: run.difficulty,
      status: run.status,
      geometry: run.geometry,
      properties: run.properties,
      subRegionId: run.subRegionId,
      subRegionName: run.subRegion?.name || null,
    }));

    // Transform lifts to include subRegionName
    const lifts = skiArea.lifts.map(lift => ({
      id: lift.id,
      osmId: lift.osmId,
      name: lift.name,
      liftType: lift.liftType,
      status: lift.status,
      capacity: lift.capacity,
      geometry: lift.geometry,
      properties: lift.properties,
      subRegionId: lift.subRegionId,
      subRegionName: lift.subRegion?.name || null,
    }));

    // If includeConnected is true, also fetch runs/lifts from connected areas
    let allRuns = runs;
    let allLifts = lifts;
    let allSubRegions = skiArea.subRegions;

    if (includeConnected && connectedAreas.length > 0) {
      for (const connectedArea of connectedAreas) {
        const connected = await prisma.skiArea.findUnique({
          where: { id: connectedArea.id },
          include: {
            runs: {
              include: {
                subRegion: {
                  select: { id: true, name: true },
                },
              },
            },
            lifts: {
              include: {
                subRegion: {
                  select: { id: true, name: true },
                },
              },
            },
            subRegions: {
              select: {
                id: true,
                name: true,
                bounds: true,
                centroid: true,
              },
            },
          },
        });

        if (connected) {
          // Add connected runs with subRegionName
          allRuns = [
            ...allRuns,
            ...connected.runs.map(run => ({
              id: run.id,
              osmId: run.osmId,
              name: run.name,
              difficulty: run.difficulty,
              status: run.status,
              geometry: run.geometry,
              properties: run.properties,
              subRegionId: run.subRegionId,
              subRegionName: run.subRegion?.name || connectedArea.name,
            })),
          ];

          // Add connected lifts with subRegionName
          allLifts = [
            ...allLifts,
            ...connected.lifts.map(lift => ({
              id: lift.id,
              osmId: lift.osmId,
              name: lift.name,
              liftType: lift.liftType,
              status: lift.status,
              capacity: lift.capacity,
              geometry: lift.geometry,
              properties: lift.properties,
              subRegionId: lift.subRegionId,
              subRegionName: lift.subRegion?.name || connectedArea.name,
            })),
          ];

          // Add connected sub-regions (or create virtual one from connected area name)
          if (connected.subRegions.length > 0) {
            allSubRegions = [...allSubRegions, ...connected.subRegions];
          } else {
            // Create a virtual sub-region from the connected area
            allSubRegions = [
              ...allSubRegions,
              {
                id: `virtual-${connectedArea.id}`,
                name: connectedArea.name,
                bounds: null,
                centroid: { lat: connectedArea.latitude, lng: connectedArea.longitude },
              },
            ];
          }
        }
      }
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
      subRegions: allSubRegions,
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

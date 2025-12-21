import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const search = searchParams.get('search');
  const country = searchParams.get('country');
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');

  // Bounds-based query parameters
  const minLat = searchParams.get('minLat');
  const maxLat = searchParams.get('maxLat');
  const minLng = searchParams.get('minLng');
  const maxLng = searchParams.get('maxLng');

  try {
    const where: Record<string, unknown> = {};

    if (search) {
      where.name = {
        contains: search,
        mode: 'insensitive',
      };
    }

    if (country) {
      where.country = {
        equals: country,
        mode: 'insensitive',
      };
    }

    // Add bounds filtering if all bounds parameters are provided
    if (minLat && maxLat && minLng && maxLng) {
      where.latitude = {
        gte: parseFloat(minLat),
        lte: parseFloat(maxLat),
      };
      where.longitude = {
        gte: parseFloat(minLng),
        lte: parseFloat(maxLng),
      };
    }

    const [areas, total] = await Promise.all([
      prisma.skiArea.findMany({
        where,
        select: {
          id: true,
          name: true,
          country: true,
          region: true,
          latitude: true,
          longitude: true,
        },
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset,
      }),
      prisma.skiArea.count({ where }),
    ]);

    return NextResponse.json({
      areas,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching ski areas:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ski areas' },
      { status: 500 }
    );
  }
}


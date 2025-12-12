import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const skiArea = await prisma.skiArea.findUnique({
      where: { id },
      include: {
        runs: true,
        lifts: true,
      },
    });

    if (!skiArea) {
      return NextResponse.json(
        { error: 'Ski area not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(skiArea);
  } catch (error) {
    console.error('Error fetching ski area:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ski area' },
      { status: 500 }
    );
  }
}


import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const countries = await prisma.skiArea.groupBy({
      by: ['country'],
      _count: { country: true },
      orderBy: { country: 'asc' },
      where: {
        country: { not: null },
      },
    });

    return NextResponse.json(
      countries
        .filter((c: { country: string | null; _count: { country: number } }) => c.country)
        .map((c: { country: string | null; _count: { country: number } }) => ({
          country: c.country,
          count: c._count.country,
        }))
    );
  } catch (error) {
    console.error('Error fetching countries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch countries' },
      { status: 500 }
    );
  }
}


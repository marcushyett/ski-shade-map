import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get latest sync status
    const latestSync = await prisma.dataSync.findFirst({
      where: { status: 'success' },
      orderBy: { lastSync: 'desc' }
    });

    // Get counts
    const [skiAreaCount, runCount, liftCount] = await Promise.all([
      prisma.skiArea.count(),
      prisma.run.count(),
      prisma.lift.count(),
    ]);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const needsSync = !latestSync || latestSync.lastSync < thirtyDaysAgo;

    return NextResponse.json({
      lastSync: latestSync?.lastSync.toISOString() || null,
      lastSyncRecordCount: latestSync?.recordCount || 0,
      currentCounts: {
        skiAreas: skiAreaCount,
        runs: runCount,
        lifts: liftCount,
      },
      needsSync,
      nextSyncDue: latestSync 
        ? new Date(latestSync.lastSync.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
        : 'now',
    });
  } catch (error) {
    console.error('Error getting sync status:', error);
    return NextResponse.json(
      { error: 'Failed to get sync status' },
      { status: 500 }
    );
  }
}


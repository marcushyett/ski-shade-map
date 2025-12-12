import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

// This endpoint is called by Vercel Cron on the 1st of each month at 3am UTC
// It can also be called manually with the CRON_SECRET

const CRON_SECRET = process.env.CRON_SECRET || process.env.SYNC_SECRET;

export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron or has valid auth
  const authHeader = request.headers.get('authorization');
  const cronHeader = request.headers.get('x-vercel-cron');
  
  if (!cronHeader && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Check if we need to sync (last sync > 30 days ago)
    const lastSync = await prisma.dataSync.findFirst({
      where: { 
        dataType: 'ski_areas',
        status: 'success'
      },
      orderBy: { lastSync: 'desc' }
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    if (lastSync && lastSync.lastSync > thirtyDaysAgo) {
      return NextResponse.json({
        message: 'Sync not needed - last sync was less than 30 days ago',
        lastSync: lastSync.lastSync.toISOString(),
        nextSyncAfter: new Date(lastSync.lastSync.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });
    }

    // Trigger the actual sync
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';
    
    const syncResponse = await fetch(`${baseUrl}/api/sync?type=all`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CRON_SECRET}`,
      },
    });

    const result = await syncResponse.json();
    
    return NextResponse.json({
      message: 'Sync triggered',
      result,
      previousSync: lastSync?.lastSync.toISOString() || 'never'
    });
  } catch (error) {
    console.error('Cron sync error:', error);
    return NextResponse.json(
      { error: 'Cron sync failed', details: String(error) },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { collectAllResortStatus } from '@/lib/analytics-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

// This endpoint is called by Vercel Cron every 5 minutes
// It collects status data from all supported resorts

const CRON_SECRET = process.env.CRON_SECRET || process.env.SYNC_SECRET;

export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron or has valid auth
  const authHeader = request.headers.get('authorization');
  const cronHeader = request.headers.get('x-vercel-cron');

  if (!cronHeader && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[Analytics Cron] Starting scheduled collection...');
    const result = await collectAllResortStatus();

    return NextResponse.json({
      message: 'Analytics collection complete',
      ...result,
    });
  } catch (error) {
    console.error('[Analytics Cron] Collection failed:', error);
    return NextResponse.json(
      { error: 'Analytics collection failed', details: String(error) },
      { status: 500 }
    );
  }
}

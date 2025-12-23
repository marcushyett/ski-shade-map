import { NextRequest, NextResponse } from 'next/server';
import { collectAllResortStatus, getCollectionStats } from '@/lib/analytics-service';

// Disable caching for this endpoint
export const dynamic = 'force-dynamic';

// Allow up to 5 minutes for this endpoint (for Vercel)
export const maxDuration = 300;

/**
 * POST /api/analytics/collect
 * Trigger collection of resort status data for all supported resorts
 *
 * Protected by CRON_SECRET for scheduled invocations
 * Can also be called manually with the dev-sync-key for testing
 */
export async function POST(request: NextRequest) {
  // Check authorization
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const syncKey = process.env.SYNC_KEY || 'dev-sync-key';

  // Verify the request is authorized (either from cron or manual trigger)
  const isValidCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isValidManual = authHeader === `Bearer ${syncKey}`;

  if (!isValidCron && !isValidManual) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    console.log('[Analytics API] Starting collection...');
    const result = await collectAllResortStatus();

    return NextResponse.json({
      message: 'Collection complete',
      ...result,
    });
  } catch (error) {
    console.error('[Analytics API] Collection failed:', error);
    return NextResponse.json(
      { error: 'Collection failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/analytics/collect
 * Get collection statistics
 */
export async function GET() {
  try {
    const stats = await getCollectionStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error('[Analytics API] Failed to get stats:', error);
    return NextResponse.json(
      { error: 'Failed to get stats', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

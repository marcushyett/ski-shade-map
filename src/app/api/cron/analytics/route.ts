import { NextRequest, NextResponse } from 'next/server';
import { collectAllResortStatus } from '@/lib/analytics-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

// This endpoint is called by Vercel Cron every 5 minutes
// It collects status data from all supported resorts

export async function GET(request: NextRequest) {
  // Verify the request is authorized
  const authHeader = request.headers.get('authorization');

  // Support both uppercase and lowercase env var names for flexibility
  const cronSecret = process.env.CRON_SECRET || process.env.cron_secret;
  const syncSecret = process.env.SYNC_SECRET || process.env.sync_secret || 'dev-sync-key';

  // Check for valid cron secret (if set) or sync secret
  const isValidCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isValidSync = authHeader === `Bearer ${syncSecret}`;

  if (!isValidCron && !isValidSync) {
    console.error('[Analytics Cron] Auth failed:', {
      hasAuthHeader: !!authHeader,
      authHeaderPrefix: authHeader?.substring(0, 10),
      hasCronSecret: !!cronSecret,
      hasSyncSecret: !!syncSecret,
    });
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

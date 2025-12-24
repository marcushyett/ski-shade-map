import { NextRequest, NextResponse } from 'next/server';
import { collectAllResortStatus } from '@/lib/analytics-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

// This endpoint is called by Vercel Cron every 5 minutes
// It collects status data from all supported resorts

export async function GET(request: NextRequest) {
  // Debug: Log all incoming headers for troubleshooting
  const authHeader = request.headers.get('authorization');
  const vercelCronHeader = request.headers.get('x-vercel-cron');

  // Support both uppercase and lowercase env var names for flexibility
  const cronSecret = (process.env.CRON_SECRET || process.env.cron_secret || '').trim();
  const syncSecret = (process.env.SYNC_SECRET || process.env.sync_secret || 'dev-sync-key').trim();

  // Debug logging to understand what's happening
  console.log('[Analytics Cron] Request received:', {
    hasAuthHeader: !!authHeader,
    authHeaderLength: authHeader?.length,
    authHeaderStart: authHeader?.substring(0, 15),
    authHeaderEnd: authHeader?.slice(-5),
    hasVercelCronHeader: !!vercelCronHeader,
    vercelCronValue: vercelCronHeader,
    cronSecretLength: cronSecret.length,
    cronSecretStart: cronSecret.substring(0, 3),
    cronSecretEnd: cronSecret.slice(-3),
    syncSecretLength: syncSecret.length,
    expectedAuthHeader: `Bearer ${cronSecret.substring(0, 3)}...${cronSecret.slice(-3)}`,
  });

  // Check for valid cron secret (if set) or sync secret
  const expectedCronAuth = `Bearer ${cronSecret}`;
  const expectedSyncAuth = `Bearer ${syncSecret}`;

  const isValidCron = cronSecret && authHeader === expectedCronAuth;
  const isValidSync = authHeader === expectedSyncAuth;

  // Additional debug: character-by-character comparison if lengths match but strings don't
  if (cronSecret && authHeader && !isValidCron) {
    const expectedLen = expectedCronAuth.length;
    const actualLen = authHeader.length;
    console.log('[Analytics Cron] Auth comparison debug:', {
      expectedLength: expectedLen,
      actualLength: actualLen,
      lengthsMatch: expectedLen === actualLen,
      startsWithBearer: authHeader.startsWith('Bearer '),
      // Check for invisible characters
      authHeaderCharCodes: authHeader.slice(0, 20).split('').map(c => c.charCodeAt(0)),
      expectedCharCodes: expectedCronAuth.slice(0, 20).split('').map(c => c.charCodeAt(0)),
    });
  }

  if (!isValidCron && !isValidSync) {
    console.error('[Analytics Cron] Auth failed - no valid credentials');
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

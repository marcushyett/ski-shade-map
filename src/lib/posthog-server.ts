/**
 * Server-side PostHog client for sending events from cron jobs and API routes
 */

import { PostHog } from 'posthog-node';

// Server-side PostHog events for resort status tracking
export type ServerAnalyticsEvent =
  | 'cron_lift_status_collected'
  | 'cron_run_status_collected'
  | 'cron_collection_completed'
  | 'cron_collection_failed';

export interface LiftStatusProperties {
  resort_id: string;
  resort_name: string;
  lift_name: string;
  lift_status: string;
  lift_type?: string;
  is_operating?: boolean;
  opening_status?: string;
  waiting_time?: number;
  capacity?: number;
  length?: number;
  arrival_altitude?: number;
  departure_altitude?: number;
}

export interface RunStatusProperties {
  resort_id: string;
  resort_name: string;
  run_name: string;
  run_status: string;
  run_level?: string;
  trail_type?: string;
  is_operating?: boolean;
  opening_status?: string;
  grooming_status?: string;
  snow_quality?: string;
  length?: number;
  arrival_altitude?: number;
  departure_altitude?: number;
  guaranteed_snow?: boolean;
}

export interface CollectionProperties {
  resorts_processed: number;
  records_created: number;
  duration_ms: number;
  error_count: number;
  errors?: string[];
}

let posthogClient: PostHog | null = null;

/**
 * Get or create the server-side PostHog client
 */
export function getPostHogClient(): PostHog | null {
  if (posthogClient) {
    return posthogClient;
  }

  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

  if (!posthogKey) {
    console.warn('[PostHog Server] API key not configured, events will not be tracked');
    return null;
  }

  posthogClient = new PostHog(posthogKey, {
    host: posthogHost,
    flushAt: 100, // Send events in batches of 100
    flushInterval: 5000, // Or every 5 seconds
  });

  return posthogClient;
}

/**
 * Track a lift status event
 */
export function trackLiftStatus(properties: LiftStatusProperties): void {
  const client = getPostHogClient();
  if (!client) return;

  client.capture({
    distinctId: `cron-${properties.resort_id}`,
    event: 'cron_lift_status_collected',
    properties: {
      ...properties,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Track a run status event
 */
export function trackRunStatus(properties: RunStatusProperties): void {
  const client = getPostHogClient();
  if (!client) return;

  client.capture({
    distinctId: `cron-${properties.resort_id}`,
    event: 'cron_run_status_collected',
    properties: {
      ...properties,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Track collection completion
 */
export function trackCollectionCompleted(properties: CollectionProperties): void {
  const client = getPostHogClient();
  if (!client) return;

  client.capture({
    distinctId: 'cron-analytics',
    event: 'cron_collection_completed',
    properties: {
      ...properties,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Track collection failure
 */
export function trackCollectionFailed(error: string): void {
  const client = getPostHogClient();
  if (!client) return;

  client.capture({
    distinctId: 'cron-analytics',
    event: 'cron_collection_failed',
    properties: {
      error,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Flush all pending events (call at the end of cron jobs)
 */
export async function flushPostHogEvents(): Promise<void> {
  const client = getPostHogClient();
  if (!client) return;

  await client.flush();
}

/**
 * Shutdown the PostHog client
 */
export async function shutdownPostHog(): Promise<void> {
  if (posthogClient) {
    await posthogClient.shutdown();
    posthogClient = null;
  }
}

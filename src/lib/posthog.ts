import posthog from 'posthog-js';

// Initialize PostHog only on the client side
export const initPostHog = () => {
  if (typeof window === 'undefined') return;
  
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  
  if (!posthogKey) {
    console.warn('PostHog key not configured');
    return;
  }
  
  posthog.init(posthogKey, {
    api_host: posthogHost || 'https://eu.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false, // We'll manually capture specific events for better control
    persistence: 'localStorage',
    loaded: (posthog) => {
      if (process.env.NODE_ENV === 'development') {
        // Optionally disable in development
        // posthog.opt_out_capturing();
      }
    },
  });
};

// Analytics event types for type safety
export type AnalyticsEvent = 
  // Map interactions
  | 'map_zoom'
  | 'map_pan'
  | 'map_3d_toggle'
  | 'map_click'
  
  // Resort/Ski area interactions
  | 'resort_selected'
  | 'resort_search'
  | 'country_selected'
  | 'location_selected'
  
  // Run/Trail interactions
  | 'run_selected'
  | 'run_clicked'
  | 'run_detail_viewed'
  | 'lift_selected'
  | 'lift_detail_viewed'
  | 'poi_clicked'
  
  // Favourites
  | 'favourite_added'
  | 'favourite_removed'
  
  // Time/Date interactions
  | 'time_changed'
  | 'date_changed'
  
  // Sharing
  | 'share_initiated'
  | 'share_completed'
  | 'share_link_copied'
  | 'shared_location_received'
  | 'shared_location_dismissed'
  
  // Location features
  | 'user_location_requested'
  | 'user_location_granted'
  | 'user_location_denied'
  | 'current_location_requested'
  | 'current_location_granted'
  | 'current_location_denied'
  | 'use_current_location_clicked'
  | 'ski_area_auto_loaded'
  | 'mountain_home_set'
  | 'mountain_home_removed'
  | 'fly_to_location'
  
  // Search
  | 'search_performed'
  | 'search_result_selected'
  | 'place_search_result_selected'
  
  // Weather
  | 'weather_loaded'
  
  // Offline/Cache
  | 'offline_mode_entered'
  | 'offline_mode_exited'
  | 'cache_download_started'
  | 'cache_download_completed'
  
  // Onboarding
  | 'onboarding_resort_selected'
  | 'no_nearby_resorts_warning'
  | 'no_nearby_resorts_confirmed'

  // App lifecycle
  | 'app_loaded'
  | 'pwa_installed'
  | 'app_update_available'
  | 'app_update_applied'
  | 'app_update_dismissed'
  
  // Navigation
  | 'navigation_opened'
  | 'navigation_closed'
  | 'navigation_route_calculated'
  | 'navigation_started'
  | 'navigation_stopped'
  | 'navigation_destination_from_click'
  | 'wc_navigation_no_location'
  | 'wc_navigation_no_toilets'
  | 'wc_navigation_started'
  
  // Donate
  | 'donate_clicked';

export interface AnalyticsProperties {
  // Common properties
  ski_area_id?: string;
  ski_area_name?: string;
  country?: string;
  
  // Map properties
  zoom_level?: number;
  latitude?: number;
  longitude?: number;
  is_3d?: boolean;
  
  // Run/Lift properties
  run_id?: string;
  run_name?: string;
  run_difficulty?: string;
  lift_id?: string;
  lift_name?: string;
  
  // Time properties
  selected_time?: string;
  selected_date?: string;
  
  // Share properties
  share_method?: 'native' | 'clipboard';
  share_url?: string;
  has_location?: boolean;
  
  // Search properties
  search_query?: string;
  result_type?: 'run' | 'lift' | 'place';
  result_count?: number;
  
  // Weather properties
  temperature?: number;
  cloud_cover?: number;
  
  // Snow quality
  snow_score?: number;
  snow_condition?: string;
  
  // Generic
  [key: string]: unknown;
}

// Main tracking function
export const trackEvent = (event: AnalyticsEvent, properties?: AnalyticsProperties) => {
  if (typeof window === 'undefined') return;
  
  posthog.capture(event, {
    ...properties,
    timestamp: new Date().toISOString(),
  });
};

// Identify user (for when we have user accounts in the future)
export const identifyUser = (userId: string, properties?: Record<string, unknown>) => {
  if (typeof window === 'undefined') return;
  posthog.identify(userId, properties);
};

// Set super properties that will be included in all events
export const setSuperProperties = (properties: Record<string, unknown>) => {
  if (typeof window === 'undefined') return;
  posthog.register(properties);
};

// Reset user identity
export const resetIdentity = () => {
  if (typeof window === 'undefined') return;
  posthog.reset();
};

export { posthog };

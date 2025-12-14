'use client';

import { useEffect } from 'react';
import { initPostHog, trackEvent } from '@/lib/posthog';

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Initialize PostHog
    initPostHog();
    
    // Track app load
    trackEvent('app_loaded', {
      referrer: document.referrer || undefined,
      user_agent: navigator.userAgent,
      screen_width: window.screen.width,
      screen_height: window.screen.height,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      is_pwa: window.matchMedia('(display-mode: standalone)').matches,
    });
    
    // Track PWA installation
    window.addEventListener('appinstalled', () => {
      trackEvent('pwa_installed');
    });
  }, []);

  return <>{children}</>;
}

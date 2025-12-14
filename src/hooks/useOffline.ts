'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { trackEvent } from '@/lib/posthog';

interface OfflineState {
  isOffline: boolean;
  wasOffline: boolean; // Was offline at some point since last online
  lastOnline: Date | null;
}

export function useOffline() {
  const [state, setState] = useState<OfflineState>({
    isOffline: false,
    wasOffline: false,
    lastOnline: null,
  });
  const prevOfflineRef = useRef<boolean | null>(null);

  useEffect(() => {
    // Check initial state
    const updateOnlineStatus = () => {
      const isOffline = !navigator.onLine;
      
      // Track offline/online transitions (not initial state)
      if (prevOfflineRef.current !== null && prevOfflineRef.current !== isOffline) {
        if (isOffline) {
          trackEvent('offline_mode_entered');
        } else {
          trackEvent('offline_mode_exited');
        }
      }
      prevOfflineRef.current = isOffline;
      
      setState((prev) => ({
        isOffline,
        wasOffline: prev.wasOffline || isOffline,
        lastOnline: isOffline ? prev.lastOnline : new Date(),
      }));
    };

    // Set initial state
    updateOnlineStatus();

    // Listen for online/offline events
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  const clearOfflineWarning = useCallback(() => {
    setState((prev) => ({
      ...prev,
      wasOffline: false,
    }));
  }, []);

  return {
    ...state,
    clearOfflineWarning,
  };
}

// Register service worker
export function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('SW registered:', registration.scope);
        })
        .catch((error) => {
          console.log('SW registration failed:', error);
        });
    });
  }
}


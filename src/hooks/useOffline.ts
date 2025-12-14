'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { trackEvent } from '@/lib/posthog';

interface OfflineState {
  isOffline: boolean;
  wasOffline: boolean; // Was offline at some point since last online
  lastOnline: Date | null;
}

interface UpdateState {
  updateAvailable: boolean;
  waitingWorker: ServiceWorker | null;
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

// Hook for detecting app updates
export function useAppUpdate() {
  const [updateState, setUpdateState] = useState<UpdateState>({
    updateAvailable: false,
    waitingWorker: null,
  });
  const [updateDismissed, setUpdateDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const checkForUpdates = async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) return;

        // Check if there's already a waiting worker
        if (registration.waiting) {
          setUpdateState({
            updateAvailable: true,
            waitingWorker: registration.waiting,
          });
        }

        // Listen for new service worker updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New update available
              console.log('[App] New version available!');
              trackEvent('app_update_available');
              setUpdateState({
                updateAvailable: true,
                waitingWorker: newWorker,
              });
            }
          });
        });

        // Check for updates periodically (every 30 minutes)
        const checkInterval = setInterval(() => {
          registration.update().catch(console.error);
        }, 30 * 60 * 1000);

        return () => clearInterval(checkInterval);
      } catch (error) {
        console.error('[App] Error checking for updates:', error);
      }
    };

    // Initial check
    checkForUpdates();

    // Also check when page becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        navigator.serviceWorker.getRegistration().then((reg) => {
          reg?.update().catch(console.error);
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen for controller change (new SW took over)
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      console.log('[App] New service worker activated, reloading...');
      window.location.reload();
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!updateState.waitingWorker) return;

    trackEvent('app_update_applied');
    
    // Tell the waiting service worker to skip waiting
    updateState.waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    
    // The page will reload automatically when controllerchange fires
  }, [updateState.waitingWorker]);

  const dismissUpdate = useCallback(() => {
    setUpdateDismissed(true);
    trackEvent('app_update_dismissed');
  }, []);

  return {
    updateAvailable: updateState.updateAvailable && !updateDismissed,
    applyUpdate,
    dismissUpdate,
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
          console.log('[SW] Registered:', registration.scope);
          
          // Check for updates immediately
          registration.update().catch(console.error);
        })
        .catch((error) => {
          console.log('[SW] Registration failed:', error);
        });
    });
  }
}

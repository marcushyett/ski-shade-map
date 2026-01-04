'use client';

import { useState, useEffect } from 'react';

/**
 * Minimum screen width for desktop mode (in pixels)
 */
const DESKTOP_MIN_WIDTH = 1024;

/**
 * Check if the device is a touch device
 */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * Hook to detect if the user is on a desktop device.
 *
 * Desktop is defined as:
 * - Screen width >= 1024px
 * - NOT a touch device (no touchscreen)
 *
 * This is used to show/hide desktop-only features like Planning Mode.
 *
 * @returns true if on desktop, false otherwise
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const checkDesktop = () => {
      const isWideScreen = window.innerWidth >= DESKTOP_MIN_WIDTH;
      const isTouch = isTouchDevice();
      setIsDesktop(isWideScreen && !isTouch);
    };

    // Initial check
    checkDesktop();

    // Listen for resize events
    window.addEventListener('resize', checkDesktop);

    return () => {
      window.removeEventListener('resize', checkDesktop);
    };
  }, []);

  return isDesktop;
}

export default useIsDesktop;

'use client';

import { useEffect, useCallback } from 'react';

interface UrlState {
  areaId: string | null;
  areaName: string | null;
  lat: number | null;
  lng: number | null;
  zoom: number | null;
  time: number | null; // minutes from midnight
  highlightId: string | null;
  highlightType: 'run' | 'lift' | null;
}

export function parseUrlState(): UrlState {
  if (typeof window === 'undefined') {
    return {
      areaId: null,
      areaName: null,
      lat: null,
      lng: null,
      zoom: null,
      time: null,
      highlightId: null,
      highlightType: null,
    };
  }

  const params = new URLSearchParams(window.location.search);
  
  return {
    areaId: params.get('area'),
    areaName: params.get('name'),
    lat: params.has('lat') ? parseFloat(params.get('lat')!) : null,
    lng: params.has('lng') ? parseFloat(params.get('lng')!) : null,
    zoom: params.has('z') ? parseFloat(params.get('z')!) : null,
    time: params.has('t') ? parseInt(params.get('t')!, 10) : null,
    highlightId: params.get('hl'),
    highlightType: params.get('hlt') as 'run' | 'lift' | null,
  };
}

export function useUrlState() {
  // Clear URL params after reading (to prevent confusion on refresh)
  const clearUrlParams = useCallback(() => {
    if (typeof window === 'undefined') return;
    
    const url = new URL(window.location.href);
    if (url.search) {
      // Replace state without the search params
      window.history.replaceState({}, '', url.pathname);
    }
  }, []);

  return {
    parseUrlState,
    clearUrlParams,
  };
}

// Convert minutes from midnight to Date
export function minutesToDate(minutes: number): Date {
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}


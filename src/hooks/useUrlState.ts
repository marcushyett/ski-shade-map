'use client';

import { useCallback } from 'react';

interface UrlState {
  areaId: string | null;
  areaName: string | null;
  lat: number | null;
  lng: number | null;
  zoom: number | null;
  date: string | null; // YYYY-MM-DD format
  time: number | null; // minutes from midnight
  highlightId: string | null;
  highlightType: 'run' | 'lift' | null;
  // Shared location marker
  sharedLat: number | null;
  sharedLng: number | null;
  sharedName: string | null;
}

export interface SharedLocation {
  latitude: number;
  longitude: number;
  name: string;
  expiresAt: number; // timestamp when this marker should be removed (end of day)
  id: string;
}

export function parseUrlState(): UrlState {
  if (typeof window === 'undefined') {
    return {
      areaId: null,
      areaName: null,
      lat: null,
      lng: null,
      zoom: null,
      date: null,
      time: null,
      highlightId: null,
      highlightType: null,
      sharedLat: null,
      sharedLng: null,
      sharedName: null,
    };
  }

  const params = new URLSearchParams(window.location.search);
  
  return {
    areaId: params.get('area'),
    areaName: params.get('name'),
    lat: params.has('lat') ? parseFloat(params.get('lat')!) : null,
    lng: params.has('lng') ? parseFloat(params.get('lng')!) : null,
    zoom: params.has('z') ? parseFloat(params.get('z')!) : null,
    date: params.get('d'), // Date in YYYY-MM-DD format
    time: params.has('t') ? parseInt(params.get('t')!, 10) : null,
    highlightId: params.get('hl'),
    highlightType: params.get('hlt') as 'run' | 'lift' | null,
    // Shared location parameters (slat, slng, sname)
    sharedLat: params.has('slat') ? parseFloat(params.get('slat')!) : null,
    sharedLng: params.has('slng') ? parseFloat(params.get('slng')!) : null,
    sharedName: params.get('sname'),
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
export function minutesToDate(minutes: number, baseDate?: string): Date {
  let date: Date;
  if (baseDate) {
    // Parse YYYY-MM-DD format
    const [year, month, day] = baseDate.split('-').map(Number);
    date = new Date(year, month - 1, day);
  } else {
    date = new Date();
  }
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

// Convert Date to YYYY-MM-DD format
export function dateToYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}


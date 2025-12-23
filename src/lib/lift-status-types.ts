/**
 * Types for real-time lift and run status from ski-resort-status module
 */

import type { OperationStatus } from './types';
import { getResortLocalTime } from './route-sun-calculator';

// Status values from the ski-resort-status API (same as OperationStatus)
export type LiftOperatingStatus = OperationStatus;
export type RunOperatingStatus = OperationStatus;
export type GroomingStatus = 'GROOMED' | 'NOT_GROOMED' | 'PARTIALLY_GROOMED';
export type SnowQuality = 'LOW_SNOWFALL' | 'EARLY_SEASON' | 'FROZEN' | 'POWDER' | 'PACKED' | 'SPRING' | 'ICY';

export interface OpeningTime {
  beginTime: string; // "09:00"
  endTime: string;   // "16:20"
}

export interface LiftStatus {
  name: string;
  status: LiftOperatingStatus;
  liftType: string;
  openskimapIds: string[];
  capacity?: number;
  duration?: number;       // minutes
  length?: number;         // meters
  uphillCapacity?: number;
  speed?: number;          // m/s
  arrivalAltitude?: number;
  departureAltitude?: number;
  openingTimes?: OpeningTime[];
  operating?: boolean;
  openingStatus?: string;  // "OPEN", "CLOSED", etc.
  message?: string;        // Status message (if any)
}

export interface RunStatus {
  name: string;
  status: RunOperatingStatus;
  trailType?: string;
  level?: string;  // "GREEN", "BLUE", "RED", "BLACK"
  openskimapIds: string[];
  length?: number;
  arrivalAltitude?: number;
  departureAltitude?: number;
  guaranteedSnow?: boolean;
  openingTimes?: OpeningTime[];
  operating?: boolean;
  openingStatus?: string;
  groomingStatus?: GroomingStatus;
  snowQuality?: SnowQuality;
  message?: string;  // Status message (if any)
}

export interface ResortStatus {
  resort: {
    id: string;
    name: string;
    openskimapId: string | string[];
  };
  lifts: LiftStatus[];
  runs: RunStatus[];
  fetchedAt: number;  // timestamp
}

export interface SupportedResort {
  id: string;
  name: string;
  openskimapId: string | string[];
  platform: string;
}

// Enriched data types that combine our app's data with status data
export interface EnrichedLiftData {
  id: string;
  osmId: string | null;
  name: string | null;
  liftType: string | null;
  status: LiftOperatingStatus | null;
  locality: string | null;
  capacity: number | null;
  geometry: import('geojson').LineString;
  properties: Record<string, unknown> | null;
  // Status enrichment
  liveStatus?: LiftStatus;
  closingTime?: string;  // "16:20" format
  minutesUntilClose?: number;
}

export interface EnrichedRunData {
  id: string;
  osmId: string | null;
  name: string | null;
  difficulty: import('./types').RunDifficulty | null;
  status: RunOperatingStatus | null;
  locality: string | null;
  geometry: import('geojson').LineString | import('geojson').Polygon;
  properties: Record<string, unknown> | null;
  // Status enrichment
  liveStatus?: RunStatus;
  closingTime?: string;
  minutesUntilClose?: number;
}

// Helper to parse time string "HH:MM" to minutes since midnight
export function parseTimeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

// Helper to get minutes until closing
// Uses resort local time to properly compare against closing time (which is in resort local time)
export function getMinutesUntilClose(
  closingTime: string,
  currentTime: Date,
  latitude?: number,
  longitude?: number
): number {
  const closingMinutes = parseTimeToMinutes(closingTime);

  // Convert currentTime to resort local time if coordinates are provided
  // This fixes the bug where browser timezone was used instead of resort timezone
  let localTime = currentTime;
  if (latitude !== undefined && longitude !== undefined) {
    localTime = getResortLocalTime(currentTime, latitude, longitude);
  }

  const currentMinutes = localTime.getHours() * 60 + localTime.getMinutes();
  return closingMinutes - currentMinutes;
}

// Format minutes until close for display
export function formatTimeUntilClose(minutes: number): string {
  if (minutes <= 0) return 'Closed';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Get urgency level based on minutes until close
export type ClosingUrgency = 'normal' | 'warning' | 'urgent' | 'closed';

export function getClosingUrgency(minutesUntilClose: number | undefined): ClosingUrgency {
  if (minutesUntilClose === undefined) return 'normal';
  if (minutesUntilClose <= 0) return 'closed';
  if (minutesUntilClose <= 15) return 'urgent';
  if (minutesUntilClose <= 30) return 'warning';
  return 'normal';
}

// Format grooming status for display
export function formatGroomingStatus(status: GroomingStatus | undefined): string {
  switch (status) {
    case 'GROOMED': return 'Groomed';
    case 'NOT_GROOMED': return 'Not Groomed';
    case 'PARTIALLY_GROOMED': return 'Partially Groomed';
    default: return '';
  }
}

// Format snow quality for display
export function formatSnowQuality(quality: SnowQuality | undefined): string {
  switch (quality) {
    case 'LOW_SNOWFALL': return 'Low Snow';
    case 'EARLY_SEASON': return 'Early Season';
    case 'FROZEN': return 'Frozen';
    case 'POWDER': return 'Powder';
    case 'PACKED': return 'Packed';
    case 'SPRING': return 'Spring';
    case 'ICY': return 'Icy';
    default: return '';
  }
}

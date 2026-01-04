/**
 * Planning Mode Types
 *
 * Types for the desktop-only Planning Mode feature that allows users
 * to plan ski runs the night before with all runs shown as open,
 * realistic DEM shadows, and filtering capabilities.
 */

import type { RunDifficulty } from './types';

/**
 * Available lift types for filtering
 */
export const LIFT_TYPES = [
  'chair_lift',
  'chairlift',
  'gondola',
  'cable_car',
  'drag_lift',
  't-bar',
  'j-bar',
  'magic_carpet',
  'platter',
  'rope_tow',
] as const;

export type LiftType = typeof LIFT_TYPES[number];

/**
 * All difficulty levels for filtering
 */
export const ALL_DIFFICULTIES: RunDifficulty[] = [
  'novice',
  'easy',
  'intermediate',
  'advanced',
  'expert',
];

/**
 * Shadow quality levels - affects DEM tile zoom level
 * low = zoom 10, medium = zoom 12, high = zoom 14
 */
export type ShadowQuality = 'low' | 'medium' | 'high';

/**
 * Filters available in planning mode
 */
export interface PlanningModeFilters {
  /** Which run difficulties to show (empty = show all) */
  difficulties: RunDifficulty[];
  /** Which lift types to show (empty = show all) */
  liftTypes: string[];
  /** Only show runs/lifts that were open yesterday */
  onlyOpenYesterday: boolean;
}

/**
 * DEM shadow overlay settings
 */
export interface ShadowSettings {
  /** Whether to show DEM terrain shadows */
  enabled: boolean;
  /** Opacity of shadow overlay (0-1) */
  opacity: number;
  /** Quality level affecting resolution */
  quality: ShadowQuality;
}

/**
 * Main planning mode state
 */
export interface PlanningModeState {
  /** Whether planning mode is active */
  enabled: boolean;
  /** Filter settings */
  filters: PlanningModeFilters;
  /** Shadow overlay settings */
  shadowSettings: ShadowSettings;
  /** Whether shadows are currently loading/computing */
  shadowsLoading: boolean;
}

/**
 * Response from the yesterday status API
 */
export interface YesterdayStatusResponse {
  /** Whether the resort has analytics data */
  hasData: boolean;
  /** The date these analytics are for (YYYY-MM-DD) */
  date: string;
  /** Names of runs that were open yesterday */
  openRuns: string[];
  /** Names of lifts that were open yesterday */
  openLifts: string[];
}

/**
 * Default planning mode state
 */
export const DEFAULT_PLANNING_MODE_STATE: PlanningModeState = {
  enabled: false,
  filters: {
    difficulties: [...ALL_DIFFICULTIES],
    liftTypes: [...LIFT_TYPES],
    onlyOpenYesterday: false,
  },
  shadowSettings: {
    enabled: true,
    opacity: 0.5,
    quality: 'medium',
  },
  shadowsLoading: false,
};

/**
 * Human-readable labels for difficulty levels
 */
export const DIFFICULTY_LABELS: Record<RunDifficulty, string> = {
  novice: 'Green',
  easy: 'Blue',
  intermediate: 'Red',
  advanced: 'Black',
  expert: 'Double Black',
};

/**
 * Human-readable labels for lift types
 */
export const LIFT_TYPE_LABELS: Record<string, string> = {
  chair_lift: 'Chair Lift',
  chairlift: 'Chair Lift',
  gondola: 'Gondola',
  cable_car: 'Cable Car',
  drag_lift: 'Drag Lift',
  't-bar': 'T-Bar',
  'j-bar': 'J-Bar',
  magic_carpet: 'Magic Carpet',
  platter: 'Platter',
  rope_tow: 'Rope Tow',
};

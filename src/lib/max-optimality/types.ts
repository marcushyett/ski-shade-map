/**
 * Types for the Max Optimality route planning feature
 *
 * This feature plans a route that covers the maximum number of runs
 * within a given difficulty range, optimized for sun exposure.
 */

import type { RunDifficulty } from '../types';
import type { NavigationRoute, RouteSegment } from '../navigation';

/**
 * Configuration for the max optimality planner
 */
export interface MaxOptimalityConfig {
  // Ski area ID
  skiAreaId: string;
  // Selected difficulty levels to include
  difficulties: RunDifficulty[];
  // Home location (start and end point)
  homeLocation: {
    lat: number;
    lng: number;
    name?: string;
  };
  // Target date for the plan (next day by default)
  targetDate: Date;
  // Lift operating hours (extracted from analytics or defaults)
  liftOpenTime?: string; // "09:00" format
  liftCloseTime?: string; // "16:30" format
}

/**
 * A run that has been verified as open in the last 24 hours
 */
export interface AvailableRun {
  id: string;
  osmId: string | null;
  name: string | null;
  difficulty: RunDifficulty;
  // Estimated time to ski this run (seconds)
  estimatedTime: number;
  // Distance (meters)
  distance: number;
  // Elevation change (meters, negative for downhill)
  elevationChange: number;
  // Last known status from analytics
  lastStatus: 'open' | 'closed' | 'unknown';
  // When this status was recorded
  statusRecordedAt: Date;
}

/**
 * A lift that has been verified as open in the last 24 hours
 */
export interface AvailableLift {
  id: string;
  osmId: string | null;
  name: string | null;
  liftType: string | null;
  // Estimated time to ride this lift (seconds)
  estimatedTime: number;
  // Distance (meters)
  distance: number;
  // Elevation gain (positive)
  elevationChange: number;
  // Opening time from analytics (if available)
  openingTime?: string;
  // Closing time from analytics (if available)
  closingTime?: string;
  // Last known status from analytics
  lastStatus: 'open' | 'closed' | 'unknown';
  // When this status was recorded
  statusRecordedAt: Date;
}

/**
 * Progress update during route calculation
 */
export interface PlanningProgress {
  // Current phase of planning
  phase: 'loading' | 'building-graph' | 'finding-routes' | 'optimizing-sun' | 'finalizing' | 'complete' | 'error';
  // Progress percentage (0-100)
  progress: number;
  // Human-readable message
  message: string;
  // Additional details
  details?: {
    runsFound?: number;
    liftsFound?: number;
    routesEvaluated?: number;
    currentBestCoverage?: number;
  };
}

/**
 * A step in the planned route
 */
export interface PlannedStep {
  // Unique identifier for this step
  id: string;
  // Type of step
  type: 'run' | 'lift' | 'walk';
  // Name of the run/lift
  name: string | null;
  // For runs: difficulty level
  difficulty?: RunDifficulty;
  // For lifts: lift type
  liftType?: string;
  // Estimated duration in seconds
  duration: number;
  // Distance in meters
  distance: number;
  // Elevation change (negative for descent, positive for ascent)
  elevationChange: number;
  // Estimated start time
  startTime: Date;
  // Estimated end time
  endTime: Date;
  // Sun exposure percentage for this step (0-100)
  sunExposure: number;
  // Coordinates for this step
  coordinates: [number, number, number?][];
}

/**
 * The complete planned route result
 */
export interface MaxOptimalityPlan {
  // Success flag
  success: boolean;
  // Error message if failed
  error?: string;
  // List of steps in order
  steps: PlannedStep[];
  // Summary statistics
  summary: {
    // Total number of unique runs covered
    totalRunsCovered: number;
    // Total runs available in selected difficulties
    totalRunsAvailable: number;
    // Coverage percentage
    coveragePercentage: number;
    // Total duration in seconds
    totalDuration: number;
    // Total distance in meters
    totalDistance: number;
    // Total elevation gain (from lifts)
    totalElevationGain: number;
    // Total elevation loss (from runs)
    totalElevationLoss: number;
    // Average sun exposure percentage
    averageSunExposure: number;
    // Planned start time
    startTime: Date;
    // Planned end time
    endTime: Date;
  };
  // The underlying navigation route (for map display)
  navigationRoute?: NavigationRoute;
  // IDs of runs that are covered
  coveredRunIds: string[];
  // IDs of lifts used
  usedLiftIds: string[];
}

/**
 * Ski area with analytics coverage info
 */
export interface SkiAreaWithAnalytics {
  id: string;
  osmId: string | null;
  name: string;
  country: string | null;
  region: string | null;
  latitude: number;
  longitude: number;
  // Number of runs with analytics data
  analyticsRunCount: number;
  // Number of lifts with analytics data
  analyticsLiftCount: number;
  // Last analytics collection timestamp
  lastAnalyticsUpdate: Date | null;
  // Resort ID from ski-resort-status (for matching)
  resortId: string | null;
}

/**
 * Request body for the planning API
 */
export interface PlanRequestBody {
  skiAreaId: string;
  difficulties: RunDifficulty[];
  homeLocation: {
    lat: number;
    lng: number;
    name?: string;
  };
  targetDate: string; // ISO date string
}

/**
 * Response from the planning API
 */
export interface PlanResponse {
  success: boolean;
  plan?: MaxOptimalityPlan;
  error?: string;
}

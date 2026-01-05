import type { RunDifficulty } from '@/lib/types';

/**
 * Piste Basher Game Types
 * A 3D snow groomer simulation game where players groom ski runs at night
 */

// Game state
export type GameState = 'menu' | 'loading' | 'playing' | 'paused' | 'completed';

// Vehicle state
export interface VehicleState {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  speed: number; // Current speed in m/s
  throttle: number; // 0-1
  brake: number; // 0-1
  steering: number; // -1 to 1
  blade: {
    lowered: boolean;
    angle: number; // Blade tilt angle
    width: number; // Effective grooming width in meters
  };
  lights: {
    headlights: boolean;
    workLights: boolean;
    beacon: boolean;
  };
}

// Run grooming state
export interface RunGroomingState {
  runId: string;
  runName: string | null;
  difficulty: RunDifficulty | null;
  totalLength: number; // Total length in meters
  totalWidth: number; // Average width in meters
  groomedSegments: GroomedSegment[];
  groomingProgress: number; // 0-1 percentage of run groomed
  pointsEarned: number;
  passesRequired: number; // How many passes needed for full width
  passesCompleted: number;
}

// Individual groomed segment
export interface GroomedSegment {
  startIndex: number;
  endIndex: number;
  lateralOffset: number; // -1 to 1 for left/right of center
  timestamp: number;
}

// Game scoring
export interface GameScore {
  totalPoints: number;
  runsGroomed: number;
  totalDistance: number; // Meters traveled
  fuelUsed: number; // Liters
  timeElapsed: number; // Seconds
  bonuses: ScoreBonus[];
}

export interface ScoreBonus {
  type: 'difficulty' | 'length' | 'width_coverage' | 'efficiency' | 'night_owl' | 'perfect_run';
  name: string;
  points: number;
  description: string;
}

// Game world data
export interface GameWorld {
  runs: GameRun[];
  lifts: GameLift[];
  buildings: GameBuilding[];
  trees: GameTree[];
  terrain: TerrainData;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };
}

export interface GameRun {
  id: string;
  name: string | null;
  difficulty: RunDifficulty | null;
  // 3D path of the run centerline
  path: Array<{ x: number; y: number; z: number }>;
  // Width at each path point
  widths: number[];
  // Outer polygon for runs with area geometry
  outerPolygon?: Array<{ x: number; y: number; z: number }>;
  // Calculated values
  length: number;
  averageWidth: number;
  averageSlope: number; // degrees
  maxSlope: number;
  pointValue: number;
}

export interface GameLift {
  id: string;
  name: string | null;
  liftType: string | null;
  path: Array<{ x: number; y: number; z: number }>;
  pylons: Array<{ x: number; y: number; z: number }>;
}

export interface GameBuilding {
  id: string;
  name: string | null;
  type: 'restaurant' | 'lift_station' | 'hotel' | 'cabin' | 'other';
  position: { x: number; y: number; z: number };
  dimensions: { width: number; depth: number; height: number };
  rotation: number;
}

export interface GameTree {
  position: { x: number; y: number; z: number };
  height: number; // Tree height in meters
  radius: number; // Crown radius in meters
  type: 'pine' | 'fir' | 'spruce'; // Common alpine tree types
}

export interface TerrainData {
  heightmap: Float32Array;
  width: number;
  height: number;
  resolution: number; // meters per cell
  minElevation: number;
  maxElevation: number;
}

// Control input state
export interface ControlInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  bladeLower: boolean;
  bladeRaise: boolean;
  bladeTiltLeft: boolean;
  bladeTiltRight: boolean;
  toggleLights: boolean;
  toggleBeacon: boolean;
  horn: boolean;
  pause: boolean;
}

// Touch control areas
export interface TouchControlZones {
  leftStick: { x: number; y: number; radius: number };
  rightStick: { x: number; y: number; radius: number };
  bladeButton: { x: number; y: number; width: number; height: number };
  lightsButton: { x: number; y: number; width: number; height: number };
  pauseButton: { x: number; y: number; width: number; height: number };
}

// Physics constants
export interface VehiclePhysics {
  maxSpeed: number; // m/s (about 20 km/h for piste basher)
  maxReverseSpeed: number;
  acceleration: number;
  braking: number;
  turnRate: number;
  slopeSpeedMultiplier: number; // How much slope affects speed
  tractionOnIce: number;
  tractionOnSnow: number;
  fuelConsumption: number; // L/hour
  bladeWidth: number; // meters
  groomingSpeed: number; // Max speed while grooming effectively
}

// Game settings
export interface GameSettings {
  difficulty: 'easy' | 'normal' | 'hard';
  showMinimap: boolean;
  showHUD: boolean;
  soundEnabled: boolean;
  musicVolume: number;
  sfxVolume: number;
  cameraMode: 'chase' | 'cockpit' | 'top_down';
  controlMode: 'keyboard' | 'touch' | 'gamepad';
  sensitivity: number;
}

// Default physics values for a PistenBully or similar
export const DEFAULT_VEHICLE_PHYSICS: VehiclePhysics = {
  maxSpeed: 5.5, // ~20 km/h
  maxReverseSpeed: 2.8, // ~10 km/h
  acceleration: 1.5, // m/s²
  braking: 3.0, // m/s²
  turnRate: 0.8, // radians per second at full lock
  slopeSpeedMultiplier: 0.15, // Speed reduction per degree of slope
  tractionOnIce: 0.3,
  tractionOnSnow: 0.9,
  fuelConsumption: 35, // L/hour typical for piste basher
  bladeWidth: 5.5, // meters (typical for PistenBully 600)
  groomingSpeed: 4.0, // m/s - slower when actually grooming
};

// Point values for different difficulty runs
export const DIFFICULTY_POINT_MULTIPLIERS: Record<RunDifficulty, number> = {
  novice: 1.0,
  easy: 1.5,
  intermediate: 2.0,
  advanced: 3.0,
  expert: 5.0,
};

// Colors for difficulty levels (matching the main app)
export const DIFFICULTY_COLORS: Record<RunDifficulty, string> = {
  novice: '#22c55e', // Green
  easy: '#3b82f6', // Blue
  intermediate: '#ef4444', // Red
  advanced: '#1f2937', // Dark gray
  expert: '#1f2937', // Double black diamond
};

// Building types from OSM
export const OSM_BUILDING_TYPES: Record<string, 'restaurant' | 'lift_station' | 'hotel' | 'cabin' | 'other'> = {
  restaurant: 'restaurant',
  cafe: 'restaurant',
  alpine_hut: 'cabin',
  cabin: 'cabin',
  hotel: 'hotel',
  chalet: 'cabin',
  shelter: 'cabin',
  lift_station: 'lift_station',
  yes: 'other',
};

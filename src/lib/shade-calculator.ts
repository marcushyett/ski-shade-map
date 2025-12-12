import { getSunPosition, SunPosition } from './suncalc';

export interface ShadeResult {
  isShaded: boolean;
  confidence: number; // 0-1, how confident we are in the calculation
  sunPosition: SunPosition;
}

/**
 * Calculate if a point on a slope is likely in shade
 * This is a simplified model based on:
 * - Slope aspect (which direction the slope faces)
 * - Slope angle
 * - Sun position
 * 
 * For full accuracy, you'd need DEM data and ray-tracing
 */
export function calculatePointShade(
  date: Date,
  latitude: number,
  longitude: number,
  slopeAspect: number,    // Direction slope faces (0=N, 90=E, 180=S, 270=W)
  slopeAngle: number = 30 // Typical ski slope angle in degrees
): ShadeResult {
  const sunPos = getSunPosition(date, latitude, longitude);
  
  // If sun is below horizon, everything is in shade
  if (sunPos.altitudeDegrees <= 0) {
    return {
      isShaded: true,
      confidence: 1.0,
      sunPosition: sunPos,
    };
  }

  // Calculate angle between sun direction and slope aspect
  // The slope receives direct sun when it faces toward the sun
  // slopeAspect is the direction the slope faces (where you look when standing on it facing downhill)
  // sunAzimuth is where the sun is in the sky
  const sunAzimuth = sunPos.azimuthDegrees;
  
  // Calculate the angle difference between slope facing direction and sun
  let angleDiff = normalizeAngle(sunAzimuth - slopeAspect);
  if (angleDiff > 180) angleDiff = 360 - angleDiff;
  
  // A slope receives direct sun when it faces the sun (angleDiff close to 0)
  // A slope is shaded when it faces away from sun (angleDiff close to 180)
  // Threshold: if angle difference > 90°, the slope is facing away from the sun
  const facesAway = angleDiff > 90;
  
  // Consider sun altitude - low sun creates more shade
  const sunAltFactor = sunPos.altitudeDegrees / 90; // 0 to 1
  
  // Simple model: shaded if slope faces away from sun
  // Also shaded if sun is very low and slope is steep (shadow of terrain)
  const isShaded = facesAway || (sunPos.altitudeDegrees < 10);
  
  // Confidence decreases for edge cases
  const confidence = Math.min(1, sunAltFactor + 0.3);
  
  return {
    isShaded,
    confidence,
    sunPosition: sunPos,
  };
}

/**
 * Estimate slope aspect from a line segment
 * Returns the direction the slope faces (perpendicular to the run direction)
 */
export function estimateSlopeAspect(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): number {
  // Calculate bearing from start to end
  const dLng = endLng - startLng;
  const y = Math.sin(dLng * Math.PI / 180) * Math.cos(endLat * Math.PI / 180);
  const x = Math.cos(startLat * Math.PI / 180) * Math.sin(endLat * Math.PI / 180) -
            Math.sin(startLat * Math.PI / 180) * Math.cos(endLat * Math.PI / 180) * 
            Math.cos(dLng * Math.PI / 180);
  
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  
  // Slope faces perpendicular to the run direction (assume downhill on right)
  // This is a simplification - real slopes can face any direction
  return (bearing + 90) % 360;
}

/**
 * Normalize angle to 0-360 range
 */
function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

/**
 * Calculate shade color based on sun position and shade state
 */
export function getShadeColor(isShaded: boolean, sunAltitude: number): string {
  if (isShaded) {
    return 'rgba(50, 50, 100, 0.6)'; // Blue-ish shade
  }
  
  // Sunny areas - yellow to orange based on sun height
  const warmth = Math.min(1, sunAltitude / 45);
  const r = 255;
  const g = Math.floor(200 + warmth * 55);
  const b = Math.floor(100 * (1 - warmth));
  
  return `rgba(${r}, ${g}, ${b}, 0.4)`;
}

/**
 * Get difficulty color for ski runs
 */
export function getDifficultyColor(difficulty: string | null | undefined): string {
  switch (difficulty?.toLowerCase()) {
    case 'novice':
      return '#4CAF50'; // Green
    case 'easy':
      return '#2196F3'; // Blue
    case 'intermediate':
      return '#F44336'; // Red
    case 'advanced':
    case 'expert':
      return '#212121'; // Black
    default:
      return '#9E9E9E'; // Gray for unknown
  }
}

/**
 * Get difficulty color for sunny segments - BRIGHT and vibrant
 * High contrast with shaded segments, with lighter/more saturated colors
 */
export function getDifficultyColorSunny(difficulty: string | null | undefined): string {
  switch (difficulty?.toLowerCase()) {
    case 'novice':
      return '#81C784'; // Light bright green
    case 'easy':
      return '#64B5F6'; // Light bright blue
    case 'intermediate':
      return '#FF8A80'; // Light bright red/coral
    case 'advanced':
    case 'expert':
      return '#757575'; // Medium grey for black runs in sun (visible contrast)
    default:
      return '#BDBDBD'; // Light gray for unknown
  }
}

/**
 * Get difficulty color for shaded segments (much darker for high contrast)
 * These are used during daytime for shaded areas AND at night for all runs
 */
export function getDifficultyColorShaded(difficulty: string | null | undefined): string {
  switch (difficulty?.toLowerCase()) {
    case 'novice':
      return '#1B5E20'; // Very dark green
    case 'easy':
      return '#0D47A1'; // Very dark blue
    case 'intermediate':
      return '#7F0000'; // Very dark red
    case 'advanced':
    case 'expert':
      return '#212121'; // Very dark grey (not pure black, so visible)
    default:
      return '#424242'; // Dark gray for unknown
  }
}


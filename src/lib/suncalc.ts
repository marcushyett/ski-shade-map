import SunCalc from 'suncalc';

export interface SunPosition {
  azimuth: number;      // Sun direction in radians (0 = south, PI/2 = west)
  altitude: number;     // Sun height in radians (0 = horizon, PI/2 = zenith)
  azimuthDegrees: number;
  altitudeDegrees: number;
}

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
  solarNoon: Date;
  dawn: Date;
  dusk: Date;
}

/**
 * Calculate sun position for a given location and time
 */
export function getSunPosition(
  date: Date,
  latitude: number,
  longitude: number
): SunPosition {
  const pos = SunCalc.getPosition(date, latitude, longitude);
  
  return {
    azimuth: pos.azimuth,
    altitude: pos.altitude,
    // Convert to degrees for easier understanding
    // Adjust azimuth: SunCalc uses 0=south, we want 0=north (clockwise)
    azimuthDegrees: ((pos.azimuth * 180 / Math.PI) + 180) % 360,
    altitudeDegrees: pos.altitude * 180 / Math.PI,
  };
}

/**
 * Get sun times for a given location and date
 */
export function getSunTimes(
  date: Date,
  latitude: number,
  longitude: number
): SunTimes {
  const times = SunCalc.getTimes(date, latitude, longitude);
  
  return {
    sunrise: times.sunrise,
    sunset: times.sunset,
    solarNoon: times.solarNoon,
    dawn: times.dawn,
    dusk: times.dusk,
  };
}

/**
 * Check if sun is above horizon
 */
export function isSunUp(date: Date, latitude: number, longitude: number): boolean {
  const pos = getSunPosition(date, latitude, longitude);
  return pos.altitude > 0;
}

/**
 * Calculate shadow direction from sun position
 * Returns angle in degrees (0 = north, 90 = east, etc.)
 */
export function getShadowDirection(sunAzimuthDegrees: number): number {
  // Shadow is opposite to sun direction
  return (sunAzimuthDegrees + 180) % 360;
}

/**
 * Calculate shadow length factor based on sun altitude
 * Returns a multiplier (higher = longer shadows)
 */
export function getShadowLengthFactor(sunAltitudeDegrees: number): number {
  if (sunAltitudeDegrees <= 0) return Infinity; // Sun below horizon
  // Shadow length = height / tan(altitude)
  return 1 / Math.tan(sunAltitudeDegrees * Math.PI / 180);
}


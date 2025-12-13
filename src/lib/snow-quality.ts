/**
 * Snow Quality Scoring System
 *
 * Calculates snow quality for each piste based on:
 * - Recent weather history (last 7 days)
 * - Current conditions (temperature, sun exposure, wind)
 * - Slope characteristics (aspect, steepness, altitude)
 * - Time of day (conditions deteriorate through the day)
 */

import type { HourlyWeather, DailyWeatherDay } from "./weather-types";
import type { RunData } from "./types";

// Snow condition types in order of general desirability for most skiers
export type SnowCondition =
  | "powder" // Fresh, light, untracked snow
  | "fresh-groomed" // Just groomed, corduroy
  | "packed-powder" // Good consolidated snow
  | "hard-pack" // Firm but skiable
  | "spring-corn" // Freeze-thaw corn snow (can be excellent)
  | "variable" // Mixed conditions
  | "wind-affected" // Wind-packed or scoured
  | "crusty" // Frozen crust on top
  | "moguls" // Bumpy (not bad, just different)
  | "icy" // Hard, slippery
  | "slush" // Wet, heavy snow
  | "poor"; // Generally bad conditions

export interface SnowQuality {
  score: number; // 0-100 percentage
  condition: SnowCondition;
  confidence: number; // 0-1 how confident we are in this prediction
  factors: SnowFactor[]; // Contributing factors
  description: string; // Human-readable summary
}

// Snow quality at a specific point (for elevation profiles)
export interface SnowQualityAtPoint {
  altitude: number;
  score: number; // 0-100 percentage
  condition: SnowCondition;
}

export interface SnowFactor {
  name: string;
  impact: "positive" | "negative" | "neutral";
  description: string;
}

export interface PisteSnowAnalysis {
  runId: string;
  runName: string | null;
  difficulty: string | null;
  quality: SnowQuality;
  altitude?: { min: number; max: number };
  aspect?: string; // N, NE, E, SE, S, SW, W, NW
  steepness?: number; // average slope angle in degrees
}

export interface ResortSnowSummary {
  overallScore: number;
  overallCondition: SnowCondition;
  description: string;
  lastSnowfall: { date: string; amount: number } | null;
  freezingLevel: number;
  conditionBreakdown: { condition: SnowCondition; percentage: number }[];
  recommendations: string[];
}

// Icon type identifiers for Ant Design icons (rendered in React components)
export type SnowIconType =
  | "snowflake" // powder
  | "check-circle" // fresh-groomed
  | "compress" // packed-powder
  | "dash" // hard-pack
  | "rise" // soft (warming)
  | "swap" // variable
  | "cloud" // wind-affected
  | "border" // crusty
  | "bar-chart" // moguls
  | "stop" // icy
  | "fall" // slush
  | "warning"; // poor

// Condition metadata
const CONDITION_INFO: Record<
  SnowCondition,
  { iconType: SnowIconType; label: string; color: string; tooltip: string }
> = {
  powder: { 
    iconType: "snowflake", 
    label: "Powder", 
    color: "#60a5fa",
    tooltip: "Fresh, light, untracked snow - the dream!"
  },
  "fresh-groomed": {
    iconType: "check-circle",
    label: "Groomed",
    color: "#34d399",
    tooltip: "Recently groomed corduroy - smooth and fast"
  },
  "packed-powder": { 
    iconType: "compress", 
    label: "Packed", 
    color: "#4ade80",
    tooltip: "Well-consolidated snow - reliable and grippy"
  },
  "hard-pack": { 
    iconType: "dash", 
    label: "Hard Pack", 
    color: "#a3a3a3",
    tooltip: "Firm, compacted snow - edges recommended"
  },
  "spring-corn": { 
    iconType: "rise", 
    label: "Soft", 
    color: "#fbbf24",
    tooltip: "Warming snow - soft and forgiving but can get heavy"
  },
  variable: { 
    iconType: "swap", 
    label: "Variable", 
    color: "#a78bfa",
    tooltip: "Mixed conditions - expect changes across the run"
  },
  "wind-affected": {
    iconType: "cloud",
    label: "Wind-affected",
    color: "#94a3b8",
    tooltip: "Wind-packed or scoured - can be firm or uneven"
  },
  crusty: { 
    iconType: "border", 
    label: "Crusty", 
    color: "#d4a574",
    tooltip: "Frozen crust on surface - can break through unexpectedly"
  },
  moguls: { 
    iconType: "bar-chart", 
    label: "Moguls", 
    color: "#f472b6",
    tooltip: "Bumpy terrain - great for technique practice"
  },
  icy: { 
    iconType: "stop", 
    label: "Icy", 
    color: "#64748b",
    tooltip: "Hard, slippery surface - sharp edges essential"
  },
  slush: { 
    iconType: "fall", 
    label: "Slush", 
    color: "#38bdf8",
    tooltip: "Wet, heavy snow - slow and tiring"
  },
  poor: { 
    iconType: "warning", 
    label: "Poor", 
    color: "#ef4444",
    tooltip: "Generally challenging conditions - proceed with caution"
  },
};

export function getConditionInfo(condition: SnowCondition) {
  return CONDITION_INFO[condition];
}

// Calculate aspect from run geometry (simplified)
function calculateAspect(geometry: RunData["geometry"]): string | undefined {
  if (geometry.type !== "LineString" || geometry.coordinates.length < 2)
    return undefined;

  const coords = geometry.coordinates;
  const start = coords[0];
  const end = coords[coords.length - 1];

  // Calculate bearing from start to end
  const dLon = ((end[0] - start[0]) * Math.PI) / 180;
  const lat1 = (start[1] * Math.PI) / 180;
  const lat2 = (end[1] * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  let bearing = (Math.atan2(y, x) * 180) / Math.PI;
  bearing = (bearing + 360) % 360;

  // Aspect is perpendicular to direction of travel (slope faces this direction)
  // Add 90 degrees to get the aspect the slope faces
  const aspect = (bearing + 90) % 360;

  const aspects = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(aspect / 45) % 8;
  return aspects[index];
}

// Calculate average altitude from geometry
function calculateAltitude(
  geometry: RunData["geometry"]
): { min: number; max: number } | undefined {
  if (geometry.type !== "LineString") return undefined;

  const elevations = geometry.coordinates
    .map((c) => c[2])
    .filter((e): e is number => typeof e === "number");

  if (elevations.length === 0) return undefined;

  return {
    min: Math.min(...elevations),
    max: Math.max(...elevations),
  };
}

// Calculate average slope steepness in degrees
function calculateSteepness(geometry: RunData["geometry"]): number | undefined {
  if (geometry.type !== "LineString" || geometry.coordinates.length < 2)
    return undefined;

  const coords = geometry.coordinates;
  let totalSlope = 0;
  let segments = 0;

  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];

    if (typeof prev[2] !== "number" || typeof curr[2] !== "number") continue;

    // Calculate horizontal distance (approximate)
    const dLat = (curr[1] - prev[1]) * 111000; // meters per degree latitude
    const dLon =
      (curr[0] - prev[0]) * 111000 * Math.cos((prev[1] * Math.PI) / 180);
    const horizontalDist = Math.sqrt(dLat * dLat + dLon * dLon);

    if (horizontalDist < 1) continue;

    const verticalDist = Math.abs(curr[2] - prev[2]);
    const slopeAngle =
      (Math.atan(verticalDist / horizontalDist) * 180) / Math.PI;

    totalSlope += slopeAngle;
    segments++;
  }

  return segments > 0 ? totalSlope / segments : undefined;
}

// Check if slope is sun-facing at a given time
function isSunFacing(aspect: string | undefined, sunAzimuth: number): boolean {
  if (!aspect) return false;

  const aspectDegrees: Record<string, number> = {
    N: 0,
    NE: 45,
    E: 90,
    SE: 135,
    S: 180,
    SW: 225,
    W: 270,
    NW: 315,
  };

  const aspectDeg = aspectDegrees[aspect] ?? 0;
  const diff = Math.abs(aspectDeg - sunAzimuth);
  const normalizedDiff = Math.min(diff, 360 - diff);

  return normalizedDiff < 60; // Within 60 degrees of sun direction
}

// Main snow quality calculation
export function calculateSnowQuality(
  run: RunData,
  currentTime: Date,
  hourlyWeather: HourlyWeather[],
  dailyWeather: DailyWeatherDay[],
  sunAzimuth: number,
  sunAltitude: number
): PisteSnowAnalysis {
  const factors: SnowFactor[] = [];
  let score = 50; // Start at neutral (0-100 scale)

  const aspect = calculateAspect(run.geometry);
  const altitude = calculateAltitude(run.geometry);
  const steepness = calculateSteepness(run.geometry);
  const avgAltitude = altitude ? (altitude.min + altitude.max) / 2 : 2000;

  // Get current hour's weather
  const currentHour = currentTime.getHours();
  const todayStr = currentTime.toISOString().split("T")[0];
  const currentWeather = hourlyWeather.find((h) => {
    const hDate = new Date(h.time);
    return (
      hDate.toDateString() === currentTime.toDateString() &&
      hDate.getHours() === currentHour
    );
  });

  // Get today's daily weather
  const todayWeather = dailyWeather.find((d) => d.date === todayStr);

  // Calculate recent snowfall (last 7 days)
  const recentSnowfall = dailyWeather
    .filter((d) => {
      const dDate = new Date(d.date);
      const daysAgo =
        (currentTime.getTime() - dDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysAgo >= 0 && daysAgo <= 7;
    })
    .reduce((sum, d) => sum + (d.snowfallSum || 0), 0);

  // Find last significant snowfall
  const lastSnowDay = dailyWeather
    .filter((d) => d.snowfallSum > 5)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

  const daysSinceSnow = lastSnowDay
    ? (currentTime.getTime() - new Date(lastSnowDay.date).getTime()) /
      (1000 * 60 * 60 * 24)
    : 14;

  // Current temperature
  const currentTemp = currentWeather?.temperature ?? 0;
  const maxTemp = todayWeather?.maxTemperature ?? 0;
  const minTemp = todayWeather?.minTemperature ?? -5;

  // Time of day factor (conditions generally worse in afternoon)
  const hourOfDay = currentTime.getHours();
  const isAfternoon = hourOfDay >= 13;
  const isLateAfternoon = hourOfDay >= 15;

  // Sun exposure
  const sunFacing = isSunFacing(aspect, sunAzimuth);
  const sunUp = sunAltitude > 0;

  // ===== SCORING LOGIC (0-100 scale) =====

  // Fresh snow bonus
  if (daysSinceSnow < 1 && recentSnowfall > 10) {
    score += 30;
    factors.push({
      name: "Fresh Snow",
      impact: "positive",
      description: `${Math.round(recentSnowfall)}cm of fresh snow`,
    });
  } else if (daysSinceSnow < 2 && recentSnowfall > 5) {
    score += 20;
    factors.push({
      name: "Recent Snow",
      impact: "positive",
      description: `${Math.round(recentSnowfall)}cm in last 2 days`,
    });
  } else if (daysSinceSnow < 4 && recentSnowfall > 10) {
    score += 10;
    factors.push({
      name: "Week Snowfall",
      impact: "positive",
      description: `${Math.round(recentSnowfall)}cm this week`,
    });
  }

  // Temperature effects
  if (currentTemp > 5) {
    score -= 20;
    factors.push({
      name: "Warm Temperature",
      impact: "negative",
      description: `${Math.round(currentTemp)}°C causing snow to soften`,
    });
  } else if (currentTemp > 0 && sunFacing && sunUp) {
    score -= 10;
    factors.push({
      name: "Warming",
      impact: "negative",
      description: "Sun-facing slope warming up",
    });
  } else if (currentTemp < -10) {
    score += 5;
    factors.push({
      name: "Cold",
      impact: "positive",
      description: "Cold temperatures preserving snow",
    });
  }

  // Altitude bonus
  if (avgAltitude > 2500) {
    score += 10;
    factors.push({
      name: "High Altitude",
      impact: "positive",
      description: "Better snow preservation at altitude",
    });
  } else if (avgAltitude < 1500) {
    score -= 10;
    factors.push({
      name: "Low Altitude",
      impact: "negative",
      description: "Lower altitude snow more affected",
    });
  }

  // Afternoon deterioration
  if (isLateAfternoon && maxTemp > 0) {
    score -= 10;
    factors.push({
      name: "Afternoon",
      impact: "negative",
      description: "Conditions typically worse in late afternoon",
    });
  }

  // Mogul formation on steep runs
  if (steepness && steepness > 25 && isAfternoon) {
    score -= 5;
    factors.push({
      name: "Mogul Formation",
      impact: "negative",
      description: "Steep slope developing moguls through the day",
    });
  }

  // Wind effects
  if (currentWeather && currentWeather.windSpeed > 30) {
    score -= 10;
    factors.push({
      name: "High Wind",
      impact: "negative",
      description: `${Math.round(
        currentWeather.windSpeed
      )} km/h affecting snow surface`,
    });
  }

  // Shade bonus in warm conditions
  if (!sunFacing && currentTemp > 0) {
    score += 5;
    factors.push({
      name: "Shaded",
      impact: "positive",
      description: "North-facing slope stays cooler",
    });
  }

  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, score));

  // Determine condition type
  const condition = determineCondition(
    score,
    currentTemp,
    maxTemp,
    minTemp,
    daysSinceSnow,
    recentSnowfall,
    steepness,
    isAfternoon,
    sunFacing,
    sunUp,
    currentWeather?.windSpeed ?? 0
  );

  const conditionInfo = CONDITION_INFO[condition];

  return {
    runId: run.id,
    runName: run.name,
    difficulty: run.difficulty,
    quality: {
      score: Math.round(score),
      condition,
      confidence: calculateConfidence(
        hourlyWeather.length,
        dailyWeather.length
      ),
      factors,
      description: generateDescription(condition, score, factors),
    },
    altitude,
    aspect,
    steepness: steepness ? Math.round(steepness) : undefined,
  };
}

function determineCondition(
  score: number,
  currentTemp: number,
  maxTemp: number,
  minTemp: number,
  daysSinceSnow: number,
  recentSnowfall: number,
  steepness: number | undefined,
  isAfternoon: boolean,
  sunFacing: boolean,
  sunUp: boolean,
  windSpeed: number
): SnowCondition {
  // Fresh powder
  if (daysSinceSnow < 1 && recentSnowfall > 15 && currentTemp < 0) {
    return "powder";
  }

  // Recent grooming (morning, good conditions)
  if (!isAfternoon && daysSinceSnow < 3 && currentTemp < 2) {
    return "fresh-groomed";
  }

  // Slush (warm, wet)
  if (currentTemp > 5 || (currentTemp > 2 && sunFacing && sunUp)) {
    return "slush";
  }

  // Icy (cold, no recent snow, potentially freeze after warm)
  if (currentTemp < -5 && daysSinceSnow > 5 && minTemp < -8) {
    return "icy";
  }

  // Spring corn (freeze-thaw cycle)
  if (maxTemp > 3 && minTemp < -3 && daysSinceSnow > 3 && !isAfternoon) {
    return "spring-corn";
  }

  // Wind affected
  if (windSpeed > 40) {
    return "wind-affected";
  }

  // Moguls (steep + afternoon)
  if (steepness && steepness > 28 && isAfternoon) {
    return "moguls";
  }

  // Crusty (freeze-thaw without good corn conditions)
  if (maxTemp > 2 && minTemp < -2 && daysSinceSnow > 5) {
    return "crusty";
  }

  // Packed powder (good all-around conditions)
  if (score >= 60 && currentTemp < 2) {
    return "packed-powder";
  }

  // Hard pack (firm but ok) - cold conditions
  if (score >= 40 && currentTemp < 0) {
    return "hard-pack";
  }

  // Fresh groomed (morning, decent conditions, even without recent snow)
  if (!isAfternoon && score >= 35) {
    return "fresh-groomed";
  }

  // Packed powder (afternoon, moderate conditions)
  if (score >= 50 && currentTemp < 5) {
    return "packed-powder";
  }

  // Hard pack (colder conditions, lower score)
  if (currentTemp < 2 && score >= 30) {
    return "hard-pack";
  }

  // Softening snow (warm but not slushy yet)
  if (currentTemp > 0 && currentTemp <= 5 && score >= 30) {
    return "spring-corn";
  }

  // Variable only when we truly can't determine (very rare)
  if (score >= 30) {
    return "variable";
  }

  return "poor";
}

function calculateConfidence(hourlyCount: number, dailyCount: number): number {
  // More weather data = more confidence
  const dataScore = Math.min(1, (hourlyCount / 48 + dailyCount / 7) / 2);
  return Math.round(dataScore * 100) / 100;
}

function generateDescription(
  condition: SnowCondition,
  score: number,
  factors: SnowFactor[]
): string {
  const conditionLabel = CONDITION_INFO[condition].label;
  const qualityWord =
    score >= 80
      ? "Excellent"
      : score >= 60
      ? "Good"
      : score >= 40
      ? "Fair"
      : "Poor";

  const positives = factors
    .filter((f) => f.impact === "positive")
    .map((f) => f.name);
  const negatives = factors
    .filter((f) => f.impact === "negative")
    .map((f) => f.name);

  let desc = `${qualityWord} ${conditionLabel.toLowerCase()} conditions`;

  if (positives.length > 0) {
    desc += ` with ${positives.slice(0, 2).join(" and ").toLowerCase()}`;
  }
  if (negatives.length > 0) {
    desc += `. Watch for ${negatives.slice(0, 2).join(" and ").toLowerCase()}`;
  }

  return desc + ".";
}

// Calculate resort-wide snow summary
export function calculateResortSnowSummary(
  analyses: PisteSnowAnalysis[],
  dailyWeather: DailyWeatherDay[]
): ResortSnowSummary {
  if (analyses.length === 0) {
    return {
      overallScore: 5,
      overallCondition: "variable",
      description: "No piste data available",
      lastSnowfall: null,
      freezingLevel: 2000,
      conditionBreakdown: [],
      recommendations: [],
    };
  }

  // Calculate average score
  const avgScore =
    analyses.reduce((sum, a) => sum + a.quality.score, 0) / analyses.length;

  // Count conditions
  const conditionCounts: Record<string, number> = {};
  analyses.forEach((a) => {
    conditionCounts[a.quality.condition] =
      (conditionCounts[a.quality.condition] || 0) + 1;
  });

  const conditionBreakdown = Object.entries(conditionCounts)
    .map(([condition, count]) => ({
      condition: condition as SnowCondition,
      percentage: Math.round((count / analyses.length) * 100),
    }))
    .sort((a, b) => b.percentage - a.percentage);

  // Most common condition
  const overallCondition = conditionBreakdown[0]?.condition || "variable";

  // Find last snowfall
  const lastSnowDay = dailyWeather
    .filter((d) => d.snowfallSum > 5)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

  const lastSnowfall = lastSnowDay
    ? { date: lastSnowDay.date, amount: lastSnowDay.snowfallSum }
    : null;

  // Get freezing level from today's weather
  const today = new Date().toISOString().split("T")[0];
  const todayWeather = dailyWeather.find((d) => d.date === today);

  // Generate recommendations
  const recommendations: string[] = [];

  if (avgScore >= 70) {
    recommendations.push("Great day for skiing! Enjoy the conditions.");
  }
  if (
    conditionBreakdown.some(
      (c) => c.condition === "powder" && c.percentage > 20
    )
  ) {
    recommendations.push("Fresh powder on some runs - get there early!");
  }
  if (
    conditionBreakdown.some((c) => c.condition === "slush" && c.percentage > 30)
  ) {
    recommendations.push("Stick to higher altitudes and north-facing slopes.");
  }
  if (
    conditionBreakdown.some((c) => c.condition === "icy" && c.percentage > 30)
  ) {
    recommendations.push("Edges sharpened? Careful on icy patches.");
  }
  if (
    conditionBreakdown.some(
      (c) => c.condition === "moguls" && c.percentage > 20
    )
  ) {
    recommendations.push("Expect moguls on steeper runs in the afternoon.");
  }

  if (recommendations.length === 0) {
    recommendations.push("Standard conditions - have fun out there!");
  }

  return {
    overallScore: Math.round(avgScore * 10) / 10,
    overallCondition,
    description: generateDescription(overallCondition, avgScore, []),
    lastSnowfall,
    freezingLevel: 2000, // Would need proper data source
    conditionBreakdown,
    recommendations,
  };
}

// Analyze all runs in a ski area
// Uses sampling for large resorts to improve performance
export function analyzeResortSnowQuality(
  runs: RunData[],
  currentTime: Date,
  hourlyWeather: HourlyWeather[],
  dailyWeather: DailyWeatherDay[],
  sunAzimuth: number,
  sunAltitude: number
): { analyses: PisteSnowAnalysis[]; summary: ResortSnowSummary } {
  // For performance: if there are many runs, sample for the summary
  // but still return empty analyses array (individual analysis done on-demand)
  const MAX_RUNS_FOR_FULL_ANALYSIS = 50;

  let analysisRuns = runs;
  if (runs.length > MAX_RUNS_FOR_FULL_ANALYSIS) {
    // Sample runs evenly across the array
    const step = Math.ceil(runs.length / MAX_RUNS_FOR_FULL_ANALYSIS);
    analysisRuns = runs.filter((_, i) => i % step === 0);
  }

  const analyses = analysisRuns.map((run) =>
    calculateSnowQuality(
      run,
      currentTime,
      hourlyWeather,
      dailyWeather,
      sunAzimuth,
      sunAltitude
    )
  );

  const summary = calculateResortSnowSummary(analyses, dailyWeather);

  return { analyses, summary };
}

// Calculate snow quality at each point along a run's elevation profile
export function calculateSnowQualityByAltitude(
  run: RunData,
  currentTime: Date,
  hourlyWeather: HourlyWeather[],
  dailyWeather: DailyWeatherDay[],
  sunAzimuth: number,
  sunAltitude: number
): SnowQualityAtPoint[] {
  if (run.geometry.type !== "LineString") return [];

  const coords = run.geometry.coordinates;
  const aspect = calculateAspect(run.geometry);
  const steepness = calculateSteepness(run.geometry);

  // Get weather data
  const currentHour = currentTime.getHours();
  const todayStr = currentTime.toISOString().split("T")[0];
  const currentWeather = hourlyWeather.find((h) => {
    const hDate = new Date(h.time);
    return (
      hDate.toDateString() === currentTime.toDateString() &&
      hDate.getHours() === currentHour
    );
  });
  const todayWeather = dailyWeather.find((d) => d.date === todayStr);

  // Recent snowfall
  const recentSnowfall = dailyWeather
    .filter((d) => {
      const dDate = new Date(d.date);
      const daysAgo =
        (currentTime.getTime() - dDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysAgo >= 0 && daysAgo <= 7;
    })
    .reduce((sum, d) => sum + (d.snowfallSum || 0), 0);

  const lastSnowDay = dailyWeather
    .filter((d) => d.snowfallSum > 5)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  const daysSinceSnow = lastSnowDay
    ? (currentTime.getTime() - new Date(lastSnowDay.date).getTime()) /
      (1000 * 60 * 60 * 24)
    : 14;

  const currentTemp = currentWeather?.temperature ?? 0;
  const maxTemp = todayWeather?.maxTemperature ?? 0;
  const minTemp = todayWeather?.minTemperature ?? -5;
  const hourOfDay = currentTime.getHours();
  const isAfternoon = hourOfDay >= 13;
  const isLateAfternoon = hourOfDay >= 15;
  const sunFacing = isSunFacing(aspect, sunAzimuth);
  const sunUp = sunAltitude > 0;

  const points: SnowQualityAtPoint[] = [];

  for (const coord of coords) {
    const altitude = coord[2];
    if (typeof altitude !== "number") continue;

    // Calculate score for this specific altitude
    let score = 50;

    // Snow freshness
    if (daysSinceSnow < 1 && recentSnowfall > 10) score += 30;
    else if (daysSinceSnow < 2 && recentSnowfall > 5) score += 20;
    else if (daysSinceSnow < 4 && recentSnowfall > 10) score += 10;

    // Temperature at altitude (rough estimate: -6.5°C per 1000m)
    const altitudeTemp = currentTemp - ((altitude - 2000) / 1000) * 6.5;

    if (altitudeTemp > 5) score -= 20;
    else if (altitudeTemp > 0 && sunFacing && sunUp) score -= 10;
    else if (altitudeTemp < -10) score += 5;

    // Altitude bonus
    if (altitude > 2500) score += 10;
    else if (altitude < 1500) score -= 10;

    // Time effects
    if (isLateAfternoon && maxTemp > 0) score -= 10;
    if (steepness && steepness > 25 && isAfternoon) score -= 5;
    if (currentWeather && currentWeather.windSpeed > 30) score -= 10;
    if (!sunFacing && currentTemp > 0) score += 5;

    score = Math.max(0, Math.min(100, score));

    const condition = determineCondition(
      score,
      altitudeTemp,
      maxTemp,
      minTemp,
      daysSinceSnow,
      recentSnowfall,
      steepness,
      isAfternoon,
      sunFacing,
      sunUp,
      currentWeather?.windSpeed ?? 0
    );

    points.push({ altitude, score, condition });
  }

  return points;
}

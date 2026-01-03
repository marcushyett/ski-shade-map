/**
 * Route Planner for Max Optimality
 *
 * Plans a route that covers the maximum number of runs within the time constraints,
 * optimized for sun exposure. Uses a greedy approach with local optimization.
 */

import type {
  MaxOptimalityConfig,
  MaxOptimalityPlan,
  PlannedStep,
  AvailableRun,
  AvailableLift,
  PlanningProgress,
} from './types';
import type { SkiAreaDetails, RunData, LiftData } from '../types';
import type { NavigationGraph, NavigationRoute, RouteSegment } from '../navigation';
import {
  buildNavigationGraph,
  findRoute,
  findNearestNode,
} from '../navigation';
import { analyzeRouteSunExposure } from '../route-sun-calculator';

// Walking speed for approach/return (m/s)
const WALKING_SPEED = 1.2;

// Maximum time for the entire plan (in seconds) - 8 hours default
const MAX_PLAN_DURATION = 8 * 60 * 60;

// Progress callback type
export type ProgressCallback = (progress: PlanningProgress) => void;

/**
 * Node in our planning graph
 */
interface PlanNode {
  id: string;
  type: 'run_start' | 'run_end' | 'lift_start' | 'lift_end' | 'home';
  lat: number;
  lng: number;
  elevation: number;
  runId?: string;
  liftId?: string;
}

/**
 * Edge in our planning graph
 */
interface PlanEdge {
  from: string;
  to: string;
  type: 'run' | 'lift' | 'walk' | 'transition';
  runId?: string;
  liftId?: string;
  time: number; // seconds
  distance: number;
  elevationChange: number;
  coordinates: [number, number, number?][];
}

/**
 * State during route building
 */
interface RouteState {
  currentNodeId: string;
  visitedRunIds: Set<string>;
  visitedLiftIds: Set<string>;
  steps: PlannedStep[];
  totalTime: number;
  currentTime: Date;
  coordinates: [number, number, number?][];
}

/**
 * Build a planning graph from available runs and lifts
 */
function buildPlanningGraph(
  skiArea: SkiAreaDetails,
  availableRuns: AvailableRun[],
  availableLifts: AvailableLift[],
  homeLocation: { lat: number; lng: number }
): { nodes: Map<string, PlanNode>; edges: Map<string, PlanEdge[]> } {
  const nodes = new Map<string, PlanNode>();
  const edges = new Map<string, PlanEdge[]>();

  // Create home node
  nodes.set('home', {
    id: 'home',
    type: 'home',
    lat: homeLocation.lat,
    lng: homeLocation.lng,
    elevation: 0, // Will be estimated
  });
  edges.set('home', []);

  // Create a set of available run/lift IDs for quick lookup
  const availableRunIds = new Set(availableRuns.map((r) => r.id));
  const availableLiftIds = new Set(availableLifts.map((l) => l.id));

  // Add run nodes and edges
  for (const run of skiArea.runs) {
    if (!availableRunIds.has(run.id)) continue;

    const coords = getRunCoordinates(run);
    if (coords.length < 2) continue;

    const startCoord = coords[0];
    const endCoord = coords[coords.length - 1];
    const availableRun = availableRuns.find((r) => r.id === run.id)!;

    const startNodeId = `run_start_${run.id}`;
    const endNodeId = `run_end_${run.id}`;

    nodes.set(startNodeId, {
      id: startNodeId,
      type: 'run_start',
      lat: startCoord[1],
      lng: startCoord[0],
      elevation: startCoord[2] || 0,
      runId: run.id,
    });

    nodes.set(endNodeId, {
      id: endNodeId,
      type: 'run_end',
      lat: endCoord[1],
      lng: endCoord[0],
      elevation: endCoord[2] || 0,
      runId: run.id,
    });

    // Edge for skiing the run (start -> end)
    if (!edges.has(startNodeId)) edges.set(startNodeId, []);
    edges.get(startNodeId)!.push({
      from: startNodeId,
      to: endNodeId,
      type: 'run',
      runId: run.id,
      time: availableRun.estimatedTime,
      distance: availableRun.distance,
      elevationChange: availableRun.elevationChange,
      coordinates: coords,
    });
  }

  // Add lift nodes and edges
  for (const lift of skiArea.lifts) {
    if (!availableLiftIds.has(lift.id)) continue;

    const coords = getLiftCoordinates(lift);
    if (coords.length < 2) continue;

    const startCoord = coords[0];
    const endCoord = coords[coords.length - 1];
    const availableLift = availableLifts.find((l) => l.id === lift.id)!;

    const startNodeId = `lift_start_${lift.id}`;
    const endNodeId = `lift_end_${lift.id}`;

    nodes.set(startNodeId, {
      id: startNodeId,
      type: 'lift_start',
      lat: startCoord[1],
      lng: startCoord[0],
      elevation: startCoord[2] || 0,
      liftId: lift.id,
    });

    nodes.set(endNodeId, {
      id: endNodeId,
      type: 'lift_end',
      lat: endCoord[1],
      lng: endCoord[0],
      elevation: endCoord[2] || 0,
      liftId: lift.id,
    });

    // Edge for riding the lift (start -> end)
    if (!edges.has(startNodeId)) edges.set(startNodeId, []);
    edges.get(startNodeId)!.push({
      from: startNodeId,
      to: endNodeId,
      type: 'lift',
      liftId: lift.id,
      time: availableLift.estimatedTime,
      distance: availableLift.distance,
      elevationChange: availableLift.elevationChange,
      coordinates: coords,
    });
  }

  // Add walking connections between nearby nodes
  const nodeArray = Array.from(nodes.values());
  const maxWalkDistance = 300; // meters
  const maxElevationClimb = 50; // meters

  for (const node1 of nodeArray) {
    if (!edges.has(node1.id)) edges.set(node1.id, []);

    for (const node2 of nodeArray) {
      if (node1.id === node2.id) continue;

      // Only allow certain transitions
      // - From run_end to lift_start (to go back up)
      // - From lift_end to run_start (to ski down)
      // - From home to lift_start or run_start
      // - From run_end or lift_start to home
      const validTransition =
        (node1.type === 'run_end' && node2.type === 'lift_start') ||
        (node1.type === 'lift_end' && node2.type === 'run_start') ||
        (node1.type === 'home' && (node2.type === 'lift_start' || node2.type === 'run_start')) ||
        ((node1.type === 'run_end' || node1.type === 'lift_start') && node2.type === 'home');

      if (!validTransition) continue;

      const distance = haversineDistance(node1.lat, node1.lng, node2.lat, node2.lng);
      const elevationChange = node2.elevation - node1.elevation;

      // Skip if too far or too much climbing
      if (distance > maxWalkDistance) continue;
      if (elevationChange > maxElevationClimb) continue;

      // Walking time with elevation penalty
      const walkingTime = distance / WALKING_SPEED + Math.max(0, elevationChange) / 0.5;

      edges.get(node1.id)!.push({
        from: node1.id,
        to: node2.id,
        type: 'walk',
        time: walkingTime,
        distance,
        elevationChange,
        coordinates: [
          [node1.lng, node1.lat, node1.elevation],
          [node2.lng, node2.lat, node2.elevation],
        ],
      });
    }
  }

  return { nodes, edges };
}

/**
 * Find the best next step from current position
 * Uses a scoring function that prioritizes:
 * 1. Unvisited runs
 * 2. Shorter travel time to reach
 * 3. Sun exposure (calculated during optimization phase)
 */
function findBestNextStep(
  state: RouteState,
  nodes: Map<string, PlanNode>,
  edges: Map<string, PlanEdge[]>,
  availableRuns: AvailableRun[],
  remainingTime: number
): { edge: PlanEdge; run?: AvailableRun } | null {
  const currentEdges = edges.get(state.currentNodeId) || [];
  const currentNode = nodes.get(state.currentNodeId);

  if (!currentNode) return null;

  let bestOption: { edge: PlanEdge; run?: AvailableRun; score: number } | null = null;

  for (const edge of currentEdges) {
    const targetNode = nodes.get(edge.to);
    if (!targetNode) continue;

    // If this is a run edge
    if (edge.type === 'run' && edge.runId) {
      // Skip if already visited
      if (state.visitedRunIds.has(edge.runId)) continue;

      const run = availableRuns.find((r) => r.id === edge.runId);
      if (!run) continue;

      // Check if we have time
      if (edge.time > remainingTime) continue;

      // Score: prioritize unvisited runs, shorter times
      const score = 1000 - edge.time / 60; // Higher score = better

      if (!bestOption || score > bestOption.score) {
        bestOption = { edge, run, score };
      }
    }
    // If this is a lift edge
    else if (edge.type === 'lift' && edge.liftId) {
      // Check if we have time
      if (edge.time > remainingTime) continue;

      // After taking the lift, can we reach new runs?
      const liftEndNode = nodes.get(edge.to);
      if (!liftEndNode) continue;

      const edgesFromLiftEnd = edges.get(edge.to) || [];
      let canReachNewRun = false;
      let shortestRunTime = Infinity;

      for (const nextEdge of edgesFromLiftEnd) {
        if (nextEdge.type === 'walk') {
          const walkTarget = nodes.get(nextEdge.to);
          if (walkTarget?.type === 'run_start' && walkTarget.runId) {
            if (!state.visitedRunIds.has(walkTarget.runId)) {
              canReachNewRun = true;
              const runEdges = edges.get(nextEdge.to) || [];
              for (const runEdge of runEdges) {
                if (runEdge.type === 'run' && runEdge.time < shortestRunTime) {
                  shortestRunTime = runEdge.time;
                }
              }
            }
          }
        }
      }

      if (canReachNewRun) {
        // Score for lifts: lower because they're a means to an end
        const score = 500 - edge.time / 60;

        if (!bestOption || score > bestOption.score) {
          bestOption = { edge, score };
        }
      }
    }
    // Walking edge
    else if (edge.type === 'walk') {
      const targetNode = nodes.get(edge.to);
      if (!targetNode) continue;

      // Check if we have time
      if (edge.time > remainingTime) continue;

      // From walk, check what we can reach
      if (targetNode.type === 'run_start' && targetNode.runId) {
        if (state.visitedRunIds.has(targetNode.runId)) continue;

        const run = availableRuns.find((r) => r.id === targetNode.runId);
        if (!run) continue;

        const runEdges = edges.get(edge.to) || [];
        const runEdge = runEdges.find((e) => e.type === 'run' && e.runId === targetNode.runId);
        if (!runEdge) continue;

        // Total time to walk + ski
        const totalTime = edge.time + runEdge.time;
        if (totalTime > remainingTime) continue;

        const score = 800 - totalTime / 60;

        if (!bestOption || score > bestOption.score) {
          bestOption = { edge, run, score };
        }
      } else if (targetNode.type === 'lift_start') {
        // Score walking to lift lower
        const score = 300 - edge.time / 60;

        if (!bestOption || score > bestOption.score) {
          bestOption = { edge, score };
        }
      }
    }
  }

  return bestOption;
}

/**
 * Main route planning function
 */
export async function planMaxOptimalityRoute(
  config: MaxOptimalityConfig,
  skiArea: SkiAreaDetails,
  availableRuns: AvailableRun[],
  availableLifts: AvailableLift[],
  onProgress?: ProgressCallback
): Promise<MaxOptimalityPlan> {
  const reportProgress = (progress: PlanningProgress) => {
    if (onProgress) {
      onProgress(progress);
    }
  };

  reportProgress({
    phase: 'building-graph',
    progress: 10,
    message: 'Building navigation graph...',
    details: {
      runsFound: availableRuns.length,
      liftsFound: availableLifts.length,
    },
  });

  // Build the planning graph
  const { nodes, edges } = buildPlanningGraph(
    skiArea,
    availableRuns,
    availableLifts,
    config.homeLocation
  );

  if (availableRuns.length === 0) {
    return {
      success: false,
      error: 'No open runs found in selected difficulties',
      steps: [],
      summary: createEmptySummary(config.targetDate),
      coveredRunIds: [],
      usedLiftIds: [],
    };
  }

  reportProgress({
    phase: 'finding-routes',
    progress: 30,
    message: 'Finding optimal route...',
  });

  // Parse operating hours
  const openTime = parseTime(config.liftOpenTime || '09:00');
  const closeTime = parseTime(config.liftCloseTime || '16:30');
  const operatingDuration = (closeTime - openTime) * 60; // in seconds

  // Use the lesser of operating duration or max plan duration
  const maxDuration = Math.min(operatingDuration, MAX_PLAN_DURATION);

  // Set start time for the plan
  const startTime = new Date(config.targetDate);
  startTime.setHours(Math.floor(openTime / 60), openTime % 60, 0, 0);

  // Initialize route state
  const state: RouteState = {
    currentNodeId: 'home',
    visitedRunIds: new Set(),
    visitedLiftIds: new Set(),
    steps: [],
    totalTime: 0,
    currentTime: new Date(startTime),
    coordinates: [[config.homeLocation.lng, config.homeLocation.lat, 0]],
  };

  // Build route using greedy algorithm
  let routesEvaluated = 0;
  const maxIterations = 1000; // Safety limit

  while (state.totalTime < maxDuration && routesEvaluated < maxIterations) {
    const remainingTime = maxDuration - state.totalTime;

    // Need time to return home (estimate)
    const estimatedReturnTime = 300; // 5 minutes buffer
    const effectiveRemainingTime = remainingTime - estimatedReturnTime;

    if (effectiveRemainingTime <= 0) break;

    const nextStep = findBestNextStep(state, nodes, edges, availableRuns, effectiveRemainingTime);

    if (!nextStep) {
      // No more valid steps, try to return home
      break;
    }

    routesEvaluated++;

    // Apply the step
    const { edge, run } = nextStep;

    // Create planned step
    const stepStartTime = new Date(state.currentTime);
    const stepEndTime = new Date(state.currentTime.getTime() + edge.time * 1000);

    const plannedStep: PlannedStep = {
      id: `step_${state.steps.length}`,
      type: edge.type === 'walk' || edge.type === 'transition' ? 'walk' : edge.type,
      name: run?.name || getNodeName(nodes.get(edge.to), skiArea),
      difficulty: run?.difficulty,
      liftType: edge.liftId ? skiArea.lifts.find((l) => l.id === edge.liftId)?.liftType || undefined : undefined,
      duration: edge.time,
      distance: edge.distance,
      elevationChange: edge.elevationChange,
      startTime: stepStartTime,
      endTime: stepEndTime,
      sunExposure: 50, // Will be calculated in optimization phase
      coordinates: edge.coordinates,
    };

    state.steps.push(plannedStep);
    state.totalTime += edge.time;
    state.currentTime = stepEndTime;
    state.currentNodeId = edge.to;
    state.coordinates.push(...edge.coordinates.slice(1));

    if (edge.runId) {
      state.visitedRunIds.add(edge.runId);
    }
    if (edge.liftId) {
      state.visitedLiftIds.add(edge.liftId);
    }

    // Report progress
    if (routesEvaluated % 10 === 0) {
      reportProgress({
        phase: 'finding-routes',
        progress: 30 + Math.min(40, (routesEvaluated / 100) * 40),
        message: `Evaluating routes... (${state.visitedRunIds.size} runs covered)`,
        details: {
          routesEvaluated,
          currentBestCoverage: state.visitedRunIds.size,
        },
      });
    }
  }

  // Add return to home step if not already there
  if (state.currentNodeId !== 'home') {
    const currentNode = nodes.get(state.currentNodeId);
    if (currentNode) {
      const returnDistance = haversineDistance(
        currentNode.lat,
        currentNode.lng,
        config.homeLocation.lat,
        config.homeLocation.lng
      );
      const returnTime = returnDistance / WALKING_SPEED;

      const returnStep: PlannedStep = {
        id: `step_${state.steps.length}`,
        type: 'walk',
        name: 'Return to home',
        duration: returnTime,
        distance: returnDistance,
        elevationChange: 0,
        startTime: new Date(state.currentTime),
        endTime: new Date(state.currentTime.getTime() + returnTime * 1000),
        sunExposure: 50,
        coordinates: [
          [currentNode.lng, currentNode.lat, currentNode.elevation],
          [config.homeLocation.lng, config.homeLocation.lat, 0],
        ],
      };

      state.steps.push(returnStep);
      state.totalTime += returnTime;
    }
  }

  reportProgress({
    phase: 'optimizing-sun',
    progress: 80,
    message: 'Optimizing for sun exposure...',
  });

  // Calculate sun exposure for each step
  await calculateSunExposure(state.steps, skiArea, startTime);

  reportProgress({
    phase: 'finalizing',
    progress: 95,
    message: 'Finalizing route...',
  });

  // Build summary
  const endTime = state.steps.length > 0
    ? state.steps[state.steps.length - 1].endTime
    : startTime;

  const totalDistance = state.steps.reduce((sum, s) => sum + s.distance, 0);
  const totalElevationGain = state.steps
    .filter((s) => s.type === 'lift')
    .reduce((sum, s) => sum + Math.abs(s.elevationChange), 0);
  const totalElevationLoss = state.steps
    .filter((s) => s.type === 'run')
    .reduce((sum, s) => sum + Math.abs(s.elevationChange), 0);
  const averageSunExposure =
    state.steps.length > 0
      ? state.steps.reduce((sum, s) => sum + s.sunExposure, 0) / state.steps.length
      : 0;

  const plan: MaxOptimalityPlan = {
    success: true,
    steps: state.steps,
    summary: {
      totalRunsCovered: state.visitedRunIds.size,
      totalRunsAvailable: availableRuns.length,
      coveragePercentage:
        availableRuns.length > 0
          ? (state.visitedRunIds.size / availableRuns.length) * 100
          : 0,
      totalDuration: state.totalTime,
      totalDistance,
      totalElevationGain,
      totalElevationLoss,
      averageSunExposure,
      startTime,
      endTime,
    },
    coveredRunIds: Array.from(state.visitedRunIds),
    usedLiftIds: Array.from(state.visitedLiftIds),
  };

  // Convert to navigation route for map display
  plan.navigationRoute = convertToNavigationRoute(state.steps);

  reportProgress({
    phase: 'complete',
    progress: 100,
    message: 'Route planning complete!',
    details: {
      runsFound: availableRuns.length,
      liftsFound: availableLifts.length,
      routesEvaluated,
      currentBestCoverage: state.visitedRunIds.size,
    },
  });

  return plan;
}

/**
 * Calculate sun exposure for each step
 */
async function calculateSunExposure(
  steps: PlannedStep[],
  skiArea: SkiAreaDetails,
  startTime: Date
): Promise<void> {
  // Import dynamically to avoid circular dependencies
  const { getSunPosition } = await import('../suncalc');

  for (const step of steps) {
    if (step.type === 'lift') {
      // Lifts don't have meaningful sun exposure calculation
      step.sunExposure = 50;
      continue;
    }

    if (step.coordinates.length < 2) {
      step.sunExposure = 50;
      continue;
    }

    // Calculate average sun exposure along the step
    let sunnyCount = 0;
    const sampleCount = Math.min(10, step.coordinates.length);
    const stepSize = Math.max(1, Math.floor(step.coordinates.length / sampleCount));

    for (let i = 0; i < step.coordinates.length; i += stepSize) {
      const coord = step.coordinates[i];
      const [lng, lat] = coord;

      // Get sun position at this time
      const timeOffset = (step.duration / step.coordinates.length) * i;
      const sampleTime = new Date(step.startTime.getTime() + timeOffset * 1000);
      const sunPos = getSunPosition(sampleTime, lat, lng);

      // If sun is above horizon and slope faces towards sun, count as sunny
      if (sunPos.altitudeDegrees > 10) {
        // Calculate slope aspect from coordinates
        let aspect = 0;
        if (i < step.coordinates.length - 1) {
          const nextCoord = step.coordinates[i + 1];
          const bearing = calculateBearing(lat, lng, nextCoord[1], nextCoord[0]);
          aspect = (bearing + 90) % 360; // Perpendicular to travel
        }

        // Check if slope faces sun
        let angleDiff = Math.abs(sunPos.azimuthDegrees - aspect);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;

        if (angleDiff < 90) {
          sunnyCount++;
        }
      }
    }

    step.sunExposure = (sunnyCount / sampleCount) * 100;
  }
}

/**
 * Convert planned steps to a navigation route for map display
 */
function convertToNavigationRoute(steps: PlannedStep[]): NavigationRoute {
  const segments: RouteSegment[] = steps.map((step) => ({
    type: step.type,
    name: step.name,
    difficulty: step.difficulty,
    liftType: step.liftType,
    distance: step.distance,
    time: step.duration,
    elevationChange: step.elevationChange,
    coordinates: step.coordinates,
  }));

  const totalDistance = steps.reduce((sum, s) => sum + s.distance, 0);
  const totalTime = steps.reduce((sum, s) => sum + s.duration, 0);
  const totalElevationGain = steps
    .filter((s) => s.elevationChange > 0)
    .reduce((sum, s) => sum + s.elevationChange, 0);
  const totalElevationLoss = steps
    .filter((s) => s.elevationChange < 0)
    .reduce((sum, s) => sum + Math.abs(s.elevationChange), 0);

  return {
    edges: [], // Not used for display
    totalDistance,
    totalTime,
    totalElevationGain,
    totalElevationLoss,
    segments,
  };
}

// Helper functions

function getRunCoordinates(run: RunData): [number, number, number?][] {
  const geometry = run.geometry;
  if (geometry.type === 'LineString') {
    return geometry.coordinates as [number, number, number?][];
  } else if (geometry.type === 'Polygon') {
    return geometry.coordinates[0] as [number, number, number?][];
  }
  return [];
}

function getLiftCoordinates(lift: LiftData): [number, number, number?][] {
  return lift.geometry.coordinates as [number, number, number?][];
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseTime(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

function getNodeName(
  node: PlanNode | undefined,
  skiArea: SkiAreaDetails
): string | null {
  if (!node) return null;

  if (node.runId) {
    const run = skiArea.runs.find((r) => r.id === node.runId);
    return run?.name || null;
  }

  if (node.liftId) {
    const lift = skiArea.lifts.find((l) => l.id === node.liftId);
    return lift?.name || null;
  }

  return null;
}

function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;

  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function createEmptySummary(targetDate: Date) {
  return {
    totalRunsCovered: 0,
    totalRunsAvailable: 0,
    coveragePercentage: 0,
    totalDuration: 0,
    totalDistance: 0,
    totalElevationGain: 0,
    totalElevationLoss: 0,
    averageSunExposure: 0,
    startTime: targetDate,
    endTime: targetDate,
  };
}

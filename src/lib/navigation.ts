/**
 * Ski Navigation Routing Library
 * 
 * Implements a graph-based routing algorithm using Dijkstra's algorithm
 * to find optimal paths between ski runs and lifts.
 * 
 * Key considerations:
 * - Lifts go uphill, runs go downhill
 * - Speed varies by difficulty (easier = slower, harder = faster average)
 * - Flat/uphill skiing is very slow (walking pace)
 * - Uses 3D distance considering elevation
 * - Connects nearby endpoints based on horizontal distance and elevation difference
 */

import type { RunData, LiftData, SkiAreaDetails } from './types';
import type { LineString, Polygon } from 'geojson';

// ============================================================================
// Types
// ============================================================================

export interface NavigationNode {
  id: string;
  lng: number;
  lat: number;
  elevation: number;
  type: 'lift_start' | 'lift_end' | 'run_start' | 'run_end' | 'connection';
  featureId: string;
  featureName: string | null;
}

export interface NavigationEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: 'lift' | 'run' | 'walk';
  featureId: string;
  featureName: string | null;
  difficulty?: string | null;
  liftType?: string | null;
  distance: number;       // meters
  elevationChange: number; // positive = uphill
  travelTime: number;     // seconds
  speed: number;          // m/s
  coordinates: [number, number, number?][]; // Full path coordinates
}

export interface NavigationGraph {
  nodes: Map<string, NavigationNode>;
  edges: Map<string, NavigationEdge>;
  adjacency: Map<string, string[]>; // nodeId -> edgeIds
}

export interface NavigationRoute {
  edges: NavigationEdge[];
  totalDistance: number;
  totalTime: number;
  totalElevationGain: number;
  totalElevationLoss: number;
  segments: RouteSegment[];
}

// Diagnostic info for when routing fails
export interface RouteFailureDiagnostics {
  reason: 'no_start_node' | 'no_end_node' | 'unreachable' | 'too_far_to_walk' | 'different_region';
  startNodeExists: boolean;
  endNodeExists: boolean;
  // Distance between nearest reachable node and destination
  nearestReachableDistance?: number;
  // Elevation difference that would need to be climbed
  elevationGap?: number;
  // Distance to nearest node from start/end point
  distanceToNearestNode?: number;
  // The name of the sub-region/area the destination is in
  destinationRegion?: string;
  originRegion?: string;
  // Suggestions for the user
  suggestions: string[];
}

export interface RouteSegment {
  type: 'lift' | 'run' | 'walk';
  name: string | null;
  difficulty?: string | null;
  liftType?: string | null;
  distance: number;
  time: number;
  elevationChange: number;
  coordinates: [number, number, number?][];
}

export interface NavigationDestination {
  id: string;
  name: string;
  type: 'run' | 'lift';
  difficulty?: string | null;
  liftType?: string | null;
  nodeId: string;
}

// ============================================================================
// Speed Constants (in m/s)
// ============================================================================

const SPEEDS = {
  // Skiing speeds by difficulty (average recreational skier)
  skiing: {
    novice: 4,         // ~14 km/h - gentle cruising
    easy: 6,           // ~22 km/h - comfortable pace
    intermediate: 8,   // ~29 km/h - moderate speed
    advanced: 10,      // ~36 km/h - faster skiing
    expert: 12,        // ~43 km/h - aggressive skiing
    freeride: 8,       // ~29 km/h - variable terrain
    unknown: 6,        // Default to easy
  },
  // Lift speeds by type (meters per second)
  lifts: {
    'gondola': 6,      // ~22 km/h
    'cable_car': 10,   // ~36 km/h
    'chair_lift': 3,   // ~11 km/h
    'chairlift': 3,
    'magic_carpet': 0.8, // ~3 km/h
    't-bar': 3,
    'drag_lift': 2.5,
    'platter': 2.5,
    'rope_tow': 2,
    'funicular': 5,
    'unknown': 3,
  },
  // Walking/skating on flat/uphill
  walk: {
    flat: 1.2,         // ~4 km/h walking on skis
    uphill: 0.5,       // Very slow uphill
    downhill_gentle: 2, // Gentle descent without proper run
  },
};

// Lift wait time constant (seconds) - average time waiting for a lift
const LIFT_WAIT_TIME = 180; // 3 minutes

// Maximum distance to connect endpoints (meters) - default for automatic connections
const MAX_CONNECTION_DISTANCE = 150;
// Maximum elevation difference for walking connections (meters) - default
const MAX_WALK_ELEVATION_DIFF = 50;

// Extended walking limits for cross-region connections
const MAX_EXTENDED_WALK_DISTANCE = 500; // Up to 500m walking as user requested
const MAX_EXTENDED_WALK_ELEVATION = 100; // Allow more elevation for extended walks

// ============================================================================
// Graph Building
// ============================================================================

/**
 * Build a navigation graph from ski area data
 */
export function buildNavigationGraph(skiArea: SkiAreaDetails): NavigationGraph {
  const nodes = new Map<string, NavigationNode>();
  const edges = new Map<string, NavigationEdge>();
  const adjacency = new Map<string, string[]>();

  // Helper to add a node
  const addNode = (node: NavigationNode) => {
    nodes.set(node.id, node);
    if (!adjacency.has(node.id)) {
      adjacency.set(node.id, []);
    }
  };

  // Helper to add an edge
  const addEdge = (edge: NavigationEdge) => {
    edges.set(edge.id, edge);
    const fromEdges = adjacency.get(edge.fromNodeId) || [];
    fromEdges.push(edge.id);
    adjacency.set(edge.fromNodeId, fromEdges);
  };

  // Process lifts - they go from start (bottom) to end (top)
  for (const lift of skiArea.lifts) {
    if (!lift.geometry || lift.geometry.type !== 'LineString') continue;
    
    const coords = lift.geometry.coordinates;
    if (coords.length < 2) continue;

    const startCoord = coords[0];
    const endCoord = coords[coords.length - 1];

    // Create nodes for lift endpoints
    const startNode: NavigationNode = {
      id: `lift-${lift.id}-start`,
      lng: startCoord[0],
      lat: startCoord[1],
      elevation: (startCoord[2] as number) || 0,
      type: 'lift_start',
      featureId: lift.id,
      featureName: lift.name,
    };

    const endNode: NavigationNode = {
      id: `lift-${lift.id}-end`,
      lng: endCoord[0],
      lat: endCoord[1],
      elevation: (endCoord[2] as number) || 0,
      type: 'lift_end',
      featureId: lift.id,
      featureName: lift.name,
    };

    addNode(startNode);
    addNode(endNode);

    // Calculate edge properties
    const distance = calculatePathDistance(coords);
    const elevationChange = endNode.elevation - startNode.elevation;
    const speed = getLiftSpeed(lift.liftType);

    // Check for actual lift duration from properties (in minutes)
    // This comes from live status data when available
    const actualDuration = lift.properties?.duration as number | undefined;

    let travelTime: number;
    if (actualDuration !== undefined && actualDuration > 0) {
      // Use actual lift duration (convert minutes to seconds) + wait time
      travelTime = (actualDuration * 60) + LIFT_WAIT_TIME;
    } else {
      // Calculate from distance and speed + wait time
      travelTime = (distance / speed) + LIFT_WAIT_TIME;
    }

    const edge: NavigationEdge = {
      id: `edge-lift-${lift.id}`,
      fromNodeId: startNode.id,
      toNodeId: endNode.id,
      type: 'lift',
      featureId: lift.id,
      featureName: lift.name,
      liftType: lift.liftType,
      distance,
      elevationChange,
      travelTime,
      speed,
      coordinates: coords as [number, number, number?][],
    };

    addEdge(edge);
  }

  // Process runs - they go from top to bottom (downhill direction)
  for (const run of skiArea.runs) {
    let coords: number[][];
    
    if (run.geometry.type === 'LineString') {
      coords = run.geometry.coordinates;
    } else if (run.geometry.type === 'Polygon') {
      // For polygons, extract the longest edge as the main "run" direction
      const ring = run.geometry.coordinates[0];
      coords = extractPolygonCenterline(ring as number[][]);
    } else {
      continue;
    }

    if (coords.length < 2) continue;

    // Determine direction - runs go downhill
    const firstElev = (coords[0][2] as number) || 0;
    const lastElev = (coords[coords.length - 1][2] as number) || 0;
    
    // If first point is higher, it's the start; otherwise reverse
    const isCorrectDirection = firstElev >= lastElev;
    const orderedCoords = isCorrectDirection ? coords : [...coords].reverse();

    const startCoord = orderedCoords[0];
    const endCoord = orderedCoords[orderedCoords.length - 1];

    // Create nodes for run endpoints
    const startNode: NavigationNode = {
      id: `run-${run.id}-start`,
      lng: startCoord[0],
      lat: startCoord[1],
      elevation: (startCoord[2] as number) || 0,
      type: 'run_start',
      featureId: run.id,
      featureName: run.name,
    };

    const endNode: NavigationNode = {
      id: `run-${run.id}-end`,
      lng: endCoord[0],
      lat: endCoord[1],
      elevation: (endCoord[2] as number) || 0,
      type: 'run_end',
      featureId: run.id,
      featureName: run.name,
    };

    addNode(startNode);
    addNode(endNode);

    // Calculate edge properties
    const distance = calculatePathDistance(orderedCoords);
    const elevationChange = endNode.elevation - startNode.elevation; // Negative for downhill
    const speed = getSkiingSpeed(run.difficulty);
    const travelTime = distance / speed;

    const edge: NavigationEdge = {
      id: `edge-run-${run.id}`,
      fromNodeId: startNode.id,
      toNodeId: endNode.id,
      type: 'run',
      featureId: run.id,
      featureName: run.name,
      difficulty: run.difficulty,
      distance,
      elevationChange,
      travelTime,
      speed,
      coordinates: orderedCoords as [number, number, number?][],
    };

    addEdge(edge);
  }

  /**
   * Helper function to determine if walking is appropriate for given terrain
   * Prevents downhill walking - downhill movement should be skiing, not walking
   */
  function canWalkTerrain(fromElev: number, toElev: number, distance: number): boolean {
    if (distance === 0) return true; // Zero distance is always walkable

    const elevChange = toElev - fromElev;
    const slope = elevChange / distance; // meters per meter

    // Allow flat terrain (±2% grade) or uphill
    // Reject downhill slopes (skiing territory)
    // -0.02 means 2% downhill is acceptable (very gentle)
    return slope >= -0.02;
  }

  // Create walk/connection edges between nearby endpoints
  // IMPORTANT: Only create walking connections where there's no better piste option
  // Walking should be a last resort, not a shortcut
  const nodeList = Array.from(nodes.values());
  for (let i = 0; i < nodeList.length; i++) {
    for (let j = i + 1; j < nodeList.length; j++) {
      const nodeA = nodeList[i];
      const nodeB = nodeList[j];

      // Don't connect start and end of same feature
      if (nodeA.featureId === nodeB.featureId) continue;

      const horizontalDist = haversineDistance(
        nodeA.lat, nodeA.lng,
        nodeB.lat, nodeB.lng
      );

      // Only connect if close enough
      if (horizontalDist > MAX_CONNECTION_DISTANCE) continue;

      const elevDiff = nodeB.elevation - nodeA.elevation;
      const absElevDiff = Math.abs(elevDiff);

      // Skip if too much elevation change for walking
      if (absElevDiff > MAX_WALK_ELEVATION_DIFF) continue;
      
      // RESTRICT walking connections to meaningful transitions:
      // Only create walking connections between:
      // 1. Lift end -> Run start (getting off lift to ski)
      // 2. Run end -> Lift start (finishing run to take lift)
      // 3. Lift end -> Lift start (lift-to-lift transfer)
      // Do NOT create: Run end -> Run start (these should follow pistes, not shortcuts)
      const isRunToRun = (
        (nodeA.type === 'run_end' && nodeB.type === 'run_start') ||
        (nodeA.type === 'run_start' && nodeB.type === 'run_end')
      );
      
      // Skip run-to-run connections UNLESS they're between different ski areas (for cross-region routing)
      if (isRunToRun) {
        // Allow if features are from different ski areas (enables cross-region routing)
        // Otherwise skip (prevents shortcuts within same area)
        const nodeASkiArea = nodeA.featureId?.split('-')[0]; // Extract ski area prefix if exists
        const nodeBSkiArea = nodeB.featureId?.split('-')[0];
        if (nodeASkiArea === nodeBSkiArea) {
          continue; // Skip shortcuts within same area
        }
      }

      // Calculate 3D distance
      const dist3D = Math.sqrt(horizontalDist * horizontalDist + absElevDiff * absElevDiff);

      // Determine walk speed based on direction
      let speedAtoB: number;
      let speedBtoA: number;

      if (absElevDiff < 5) {
        // Flat
        speedAtoB = SPEEDS.walk.flat;
        speedBtoA = SPEEDS.walk.flat;
      } else if (elevDiff > 0) {
        // A is lower, going A->B is uphill
        speedAtoB = SPEEDS.walk.uphill;
        speedBtoA = SPEEDS.walk.downhill_gentle;
      } else {
        // A is higher, going A->B is downhill
        speedAtoB = SPEEDS.walk.downhill_gentle;
        speedBtoA = SPEEDS.walk.uphill;
      }
      
      // Add a time penalty to walking to make it less desirable than following pistes
      // This ensures the router prefers actual ski routes over walking shortcuts
      const WALKING_TIME_PENALTY = 3.0; // Walking takes 3x longer than calculated

      // Validate terrain for each direction before creating walk edges
      // Only allow walking on flat or uphill terrain (not downhill)
      const canWalkAtoB = canWalkTerrain(nodeA.elevation, nodeB.elevation, dist3D);
      const canWalkBtoA = canWalkTerrain(nodeB.elevation, nodeA.elevation, dist3D);

      // Create walk edges only for valid directions
      if (canWalkAtoB) {
        const walkEdgeAB: NavigationEdge = {
          id: `walk-${nodeA.id}-${nodeB.id}`,
          fromNodeId: nodeA.id,
          toNodeId: nodeB.id,
          type: 'walk',
          featureId: `connection`,
          featureName: 'Connection',
          distance: dist3D,
          elevationChange: elevDiff,
          travelTime: (dist3D / speedAtoB) * WALKING_TIME_PENALTY,
          speed: speedAtoB,
          coordinates: [
            [nodeA.lng, nodeA.lat, nodeA.elevation],
            [nodeB.lng, nodeB.lat, nodeB.elevation],
          ],
        };
        addEdge(walkEdgeAB);
      }

      if (canWalkBtoA) {
        const walkEdgeBA: NavigationEdge = {
          id: `walk-${nodeB.id}-${nodeA.id}`,
          fromNodeId: nodeB.id,
          toNodeId: nodeA.id,
          type: 'walk',
          featureId: `connection`,
          featureName: 'Connection',
          distance: dist3D,
          elevationChange: -elevDiff,
          travelTime: (dist3D / speedBtoA) * WALKING_TIME_PENALTY,
          speed: speedBtoA,
          coordinates: [
            [nodeB.lng, nodeB.lat, nodeB.elevation],
            [nodeA.lng, nodeA.lat, nodeA.elevation],
          ],
        };
        addEdge(walkEdgeBA);
      }
    }
  }

  // Second pass: Create EXTENDED walking connections (up to 500m)
  // These have a much higher time penalty but allow cross-region connections
  // Only create these if no shorter path already exists
  const EXTENDED_WALKING_TIME_PENALTY = 5.0; // Very slow - discourages but allows
  
  for (let i = 0; i < nodeList.length; i++) {
    for (let j = i + 1; j < nodeList.length; j++) {
      const nodeA = nodeList[i];
      const nodeB = nodeList[j];

      // Don't connect start and end of same feature
      if (nodeA.featureId === nodeB.featureId) continue;

      const horizontalDist = haversineDistance(
        nodeA.lat, nodeA.lng,
        nodeB.lat, nodeB.lng
      );

      // Skip if already connected with regular walk (under 150m)
      if (horizontalDist <= MAX_CONNECTION_DISTANCE) continue;
      
      // Only create extended connections up to 500m
      if (horizontalDist > MAX_EXTENDED_WALK_DISTANCE) continue;

      const elevDiff = nodeB.elevation - nodeA.elevation;
      const absElevDiff = Math.abs(elevDiff);

      // Skip if too much elevation change for extended walking
      if (absElevDiff > MAX_EXTENDED_WALK_ELEVATION) continue;
      
      // For extended walks, allow run-to-run connections (needed for cross-region)
      // But only for meaningful connections (lift ends to run starts, etc.)
      const validConnection = (
        // Lift end to run start (getting off lift)
        (nodeA.type === 'lift_end' && nodeB.type === 'run_start') ||
        (nodeB.type === 'lift_end' && nodeA.type === 'run_start') ||
        // Run end to lift start (to take a lift)
        (nodeA.type === 'run_end' && nodeB.type === 'lift_start') ||
        (nodeB.type === 'run_end' && nodeA.type === 'lift_start') ||
        // Lift end to lift start (lift-to-lift transfer)
        (nodeA.type === 'lift_end' && nodeB.type === 'lift_start') ||
        (nodeB.type === 'lift_end' && nodeA.type === 'lift_start') ||
        // Run end to run start (for cross-region routing only)
        (nodeA.type === 'run_end' && nodeB.type === 'run_start') ||
        (nodeB.type === 'run_end' && nodeA.type === 'run_start')
      );
      
      if (!validConnection) continue;

      // Calculate 3D distance
      const dist3D = Math.sqrt(horizontalDist * horizontalDist + absElevDiff * absElevDiff);

      // Determine walk speed based on direction
      let speedAtoB: number;
      let speedBtoA: number;

      if (absElevDiff < 5) {
        speedAtoB = SPEEDS.walk.flat;
        speedBtoA = SPEEDS.walk.flat;
      } else if (elevDiff > 0) {
        speedAtoB = SPEEDS.walk.uphill;
        speedBtoA = SPEEDS.walk.downhill_gentle;
      } else {
        speedAtoB = SPEEDS.walk.downhill_gentle;
        speedBtoA = SPEEDS.walk.uphill;
      }

      // Validate terrain for each direction before creating extended walk edges
      // Only allow walking on flat or uphill terrain (not downhill)
      const canWalkAtoB = canWalkTerrain(nodeA.elevation, nodeB.elevation, dist3D);
      const canWalkBtoA = canWalkTerrain(nodeB.elevation, nodeA.elevation, dist3D);

      // Create extended walk edges only for valid directions
      if (canWalkAtoB) {
        const extWalkEdgeAB: NavigationEdge = {
          id: `extwalk-${nodeA.id}-${nodeB.id}`,
          fromNodeId: nodeA.id,
          toNodeId: nodeB.id,
          type: 'walk',
          featureId: `extended-connection`,
          featureName: 'Extended Walk',
          distance: dist3D,
          elevationChange: elevDiff,
          travelTime: (dist3D / speedAtoB) * EXTENDED_WALKING_TIME_PENALTY,
          speed: speedAtoB,
          coordinates: [
            [nodeA.lng, nodeA.lat, nodeA.elevation],
            [nodeB.lng, nodeB.lat, nodeB.elevation],
          ],
        };
        addEdge(extWalkEdgeAB);
      }

      if (canWalkBtoA) {
        const extWalkEdgeBA: NavigationEdge = {
          id: `extwalk-${nodeB.id}-${nodeA.id}`,
          fromNodeId: nodeB.id,
          toNodeId: nodeA.id,
          type: 'walk',
          featureId: `extended-connection`,
          featureName: 'Extended Walk',
          distance: dist3D,
          elevationChange: -elevDiff,
          travelTime: (dist3D / speedBtoA) * EXTENDED_WALKING_TIME_PENALTY,
          speed: speedBtoA,
          coordinates: [
            [nodeB.lng, nodeB.lat, nodeB.elevation],
            [nodeA.lng, nodeA.lat, nodeA.elevation],
          ],
        };
        addEdge(extWalkEdgeBA);
      }
    }
  }

  return { nodes, edges, adjacency };
}

/**
 * Post-route optimization: Find shortcuts and intersections along the route
 * This runs AFTER the initial route is found to:
 * 1. Replace walk segments with ski segments where runs intersect
 * 2. Find better transition points between segments
 * 3. Ensure continuous lines with no gaps, following actual piste geometry
 */
export function optimizeRoute(
  route: NavigationRoute,
  skiArea: SkiAreaDetails
): NavigationRoute {
  if (route.segments.length < 2) return route;
  
  const INTERSECTION_DISTANCE = 30; // meters - how close to consider an intersection
  let optimizedSegments: RouteSegment[] = [...route.segments];
  let madeChanges = true;
  let iterations = 0;
  const MAX_ITERATIONS = 5; // Prevent infinite loops
  
  // Keep optimizing until no more improvements found
  while (madeChanges && iterations < MAX_ITERATIONS) {
    madeChanges = false;
    iterations++;
    const newSegments: RouteSegment[] = [];
    
    for (let i = 0; i < optimizedSegments.length; i++) {
      const segment = optimizedSegments[i];
      const nextSegment = optimizedSegments[i + 1];
      const prevSegment = i > 0 ? optimizedSegments[i - 1] : null;
      
      let optimized = false;
      
      // OPTIMIZATION 1: Replace walk segments with ski segments where possible
      if (segment.type === 'walk' && segment.coordinates.length >= 2) {
        const walkStart = segment.coordinates[0];
        const walkEnd = segment.coordinates[segment.coordinates.length - 1];
        
        // Check all runs to see if any cover this walk path
        for (const run of skiArea.runs) {
          if (!run.geometry || run.geometry.type !== 'LineString') continue;
          const runCoords = run.geometry.coordinates;
          
          // Check if both walk endpoints are close to points on this run
          let startIdx = -1;
          let endIdx = -1;
          let startDist = Infinity;
          let endDist = Infinity;
          
          for (let j = 0; j < runCoords.length; j++) {
            const runPoint = runCoords[j];
            const distToStart = haversineDistance(walkStart[1], walkStart[0], runPoint[1], runPoint[0]);
            const distToEnd = haversineDistance(walkEnd[1], walkEnd[0], runPoint[1], runPoint[0]);
            
            if (distToStart < INTERSECTION_DISTANCE && distToStart < startDist) {
              startDist = distToStart;
              startIdx = j;
            }
            if (distToEnd < INTERSECTION_DISTANCE && distToEnd < endDist) {
              endDist = distToEnd;
              endIdx = j;
            }
          }
          
          // If both endpoints connect to this run, replace walk with ski segment
          if (startIdx >= 0 && endIdx >= 0 && endIdx > startIdx) {
            const skiCoords = runCoords.slice(startIdx, endIdx + 1);
            const skiDist = calculatePathDistance(skiCoords as number[][]);
            const startElev = (runCoords[startIdx][2] as number) || 0;
            const endElev = (runCoords[endIdx][2] as number) || 0;
            
            newSegments.push({
              type: 'run',
              name: run.name,
              difficulty: run.difficulty,
              distance: skiDist,
              time: skiDist / 6, // Average skiing speed
              elevationChange: endElev - startElev,
              coordinates: skiCoords as [number, number, number?][],
            });
            
            optimized = true;
            madeChanges = true;
            break;
          }
        }
      }
      
      // OPTIMIZATION 2: Find shortcuts where segments intersect mid-route
      if (!optimized && segment.coordinates.length > 2 && nextSegment) {
        const segmentEnd = segment.coordinates[segment.coordinates.length - 1];
        
        // Check if any point along the next segment is closer than the next segment's start
        if (nextSegment.coordinates.length > 2) {
          let bestIdx = 0;
          let bestDist = haversineDistance(
            segmentEnd[1], segmentEnd[0],
            nextSegment.coordinates[0][1], nextSegment.coordinates[0][0]
          );
          
          for (let j = 1; j < nextSegment.coordinates.length; j++) {
            const dist = haversineDistance(
              segmentEnd[1], segmentEnd[0],
              nextSegment.coordinates[j][1], nextSegment.coordinates[j][0]
            );
            
            if (dist < bestDist && dist < INTERSECTION_DISTANCE) {
              bestDist = dist;
              bestIdx = j;
            }
          }
          
          // If we found a better connection point, truncate next segment
          if (bestIdx > 0) {
            newSegments.push(segment);
            
            // Add shortened next segment starting from the better connection point
            const newCoords = nextSegment.coordinates.slice(bestIdx);
            if (newCoords.length > 1) {
              const newDist = calculatePathDistance(newCoords as number[][]);
              const startElev = (nextSegment.coordinates[bestIdx][2] as number) || 0;
              const endElev = (nextSegment.coordinates[nextSegment.coordinates.length - 1][2] as number) || 0;
              
              newSegments.push({
                ...nextSegment,
                coordinates: newCoords as [number, number, number?][],
                distance: newDist,
                time: newDist / (nextSegment.distance / nextSegment.time),
                elevationChange: endElev - startElev,
              });
              
              i++; // Skip next segment as we've processed it
              optimized = true;
              madeChanges = true;
            }
          }
        }
      }
      
      // OPTIMIZATION 3: Look for run-to-run shortcuts
      if (!optimized && segment.type === 'run' && nextSegment?.type === 'walk') {
        const nextNextSegment = optimizedSegments[i + 2];
        
        if (nextNextSegment?.type === 'run') {
          // Check if the two runs intersect or come close
          let bestIntersection: { seg1Idx: number; seg2Idx: number; dist: number } | null = null;
          
          for (let j = 0; j < segment.coordinates.length; j++) {
            const coord1 = segment.coordinates[j];
            
            for (let k = 0; k < nextNextSegment.coordinates.length; k++) {
              const coord2 = nextNextSegment.coordinates[k];
              const dist = haversineDistance(coord1[1], coord1[0], coord2[1], coord2[0]);
              
              if (dist < INTERSECTION_DISTANCE) {
                if (!bestIntersection || dist < bestIntersection.dist) {
                  bestIntersection = { seg1Idx: j, seg2Idx: k, dist };
                }
              }
            }
          }
          
          // If runs intersect, connect them directly
          if (bestIntersection && bestIntersection.dist < 20) {
            // Add first run up to intersection
            const truncatedCoords1 = segment.coordinates.slice(0, bestIntersection.seg1Idx + 1);
            if (truncatedCoords1.length > 1) {
              const dist1 = calculatePathDistance(truncatedCoords1 as number[][]);
              const startElev1 = (segment.coordinates[0][2] as number) || 0;
              const endElev1 = (segment.coordinates[bestIntersection.seg1Idx][2] as number) || 0;
              
              newSegments.push({
                ...segment,
                coordinates: truncatedCoords1 as [number, number, number?][],
                distance: dist1,
                time: dist1 / (segment.distance / segment.time),
                elevationChange: endElev1 - startElev1,
              });
            }
            
            // Add second run from intersection
            const truncatedCoords2 = nextNextSegment.coordinates.slice(bestIntersection.seg2Idx);
            if (truncatedCoords2.length > 1) {
              const dist2 = calculatePathDistance(truncatedCoords2 as number[][]);
              const startElev2 = (nextNextSegment.coordinates[bestIntersection.seg2Idx][2] as number) || 0;
              const endElev2 = (nextNextSegment.coordinates[nextNextSegment.coordinates.length - 1][2] as number) || 0;
              
              newSegments.push({
                ...nextNextSegment,
                coordinates: truncatedCoords2 as [number, number, number?][],
                distance: dist2,
                time: dist2 / (nextNextSegment.distance / nextNextSegment.time),
                elevationChange: endElev2 - startElev2,
              });
            }
            
            i += 2; // Skip walk and next run
            optimized = true;
            madeChanges = true;
          }
        }
      }

      // OPTIMIZATION 4: Refine edge transitions by finding closest points
      // This allows routes to join/leave pistes mid-way instead of only at endpoints
      if (!optimized && nextSegment &&
          (segment.type === 'run' || segment.type === 'lift') &&
          (nextSegment.type === 'run' || nextSegment.type === 'lift')) {

        // Find closest points between end of current segment and start of next segment
        const closestPair = findClosestPointsBetweenLines(
          segment.coordinates,
          nextSegment.coordinates
        );

        if (closestPair && closestPair.distance < 50) {
          // Segments are close enough to refine the transition
          // Truncate current segment at closest point
          const truncatedCoords1 = extractSubLineString(
            segment.coordinates,
            0, 0,
            closestPair.line1Index,
            closestPair.line1T
          );

          // Start next segment from its closest point
          const truncatedCoords2 = extractSubLineString(
            nextSegment.coordinates,
            closestPair.line2Index,
            closestPair.line2T,
            nextSegment.coordinates.length - 1,
            0
          );

          if (truncatedCoords1.length > 1 && truncatedCoords2.length > 1) {
            const dist1 = calculatePathDistance(truncatedCoords1 as number[][]);
            const dist2 = calculatePathDistance(truncatedCoords2 as number[][]);

            const startElev1 = (truncatedCoords1[0][2] as number) || 0;
            const endElev1 = (truncatedCoords1[truncatedCoords1.length - 1][2] as number) || 0;
            const startElev2 = (truncatedCoords2[0][2] as number) || 0;
            const endElev2 = (truncatedCoords2[truncatedCoords2.length - 1][2] as number) || 0;

            // Add refined current segment
            newSegments.push({
              ...segment,
              coordinates: truncatedCoords1 as [number, number, number?][],
              distance: dist1,
              time: dist1 / (segment.distance / segment.time || 1),
              elevationChange: endElev1 - startElev1,
            });

            // Add refined next segment
            newSegments.push({
              ...nextSegment,
              coordinates: truncatedCoords2 as [number, number, number?][],
              distance: dist2,
              time: dist2 / (nextSegment.distance / nextSegment.time || 1),
              elevationChange: endElev2 - startElev2,
            });

            i++; // Skip next segment as we've processed it
            optimized = true;
            madeChanges = true;
          }
        }
      }

      // OPTIMIZATION 5: Insert connector segments for smooth transitions
      // If there's a gap between segments, try to find a run that bridges it
      if (!optimized && nextSegment && segment.coordinates.length > 0 && nextSegment.coordinates.length > 0) {
        const segmentEnd = segment.coordinates[segment.coordinates.length - 1];
        const nextSegmentStart = nextSegment.coordinates[0];

        // Check if there's a significant gap (> 10m but < 100m)
        const gap = haversineDistance(
          segmentEnd[1], segmentEnd[0],
          nextSegmentStart[1], nextSegmentStart[0]
        );

        if (gap > 10 && gap < 100) {
          // Look for a run that could bridge this gap
          let bestConnector: {
            coords: [number, number, number?][];
            distance: number;
            runName: string | null;
            difficulty: string | null;
          } | null = null;
          let bestTotalDist = Infinity;

          for (const run of skiArea.runs) {
            if (!run.geometry || run.geometry.type !== 'LineString') continue;
            const runCoords = run.geometry.coordinates as [number, number, number?][];

            // Find closest points on this run to both segment end and next segment start
            const closestToEnd = findClosestPointOnLineString(segmentEnd, runCoords);
            const closestToStart = findClosestPointOnLineString(nextSegmentStart, runCoords);

            // If both points are close to the run and in the right order
            if (closestToEnd.distance < 30 && closestToStart.distance < 30 &&
                closestToEnd.pointIndex < closestToStart.pointIndex) {

              // Extract the connector portion of this run
              const connectorCoords = extractSubLineString(
                runCoords,
                closestToEnd.pointIndex,
                closestToEnd.segmentT,
                closestToStart.pointIndex,
                closestToStart.segmentT
              );

              if (connectorCoords.length > 1) {
                const connectorDist = calculatePathDistance(connectorCoords as number[][]);
                const totalDist = closestToEnd.distance + connectorDist + closestToStart.distance;

                // Use this connector if it's better than what we've found
                if (totalDist < bestTotalDist && totalDist < gap * 1.5) {
                  bestConnector = {
                    coords: connectorCoords,
                    distance: connectorDist,
                    runName: run.name,
                    difficulty: run.difficulty,
                  };
                  bestTotalDist = totalDist;
                }
              }
            }
          }

          // If we found a good connector, insert it
          if (bestConnector) {
            const startElev = (bestConnector.coords[0][2] as number) || 0;
            const endElev = (bestConnector.coords[bestConnector.coords.length - 1][2] as number) || 0;

            // Add current segment
            newSegments.push(segment);

            // Add connector segment
            newSegments.push({
              type: 'run' as const,
              name: bestConnector.runName,
              difficulty: bestConnector.difficulty,
              distance: bestConnector.distance,
              time: bestConnector.distance / 6, // Average skiing speed
              elevationChange: endElev - startElev,
              coordinates: bestConnector.coords,
            });

            // Add next segment
            newSegments.push(nextSegment);

            i++; // Skip next segment as we've processed it
            optimized = true;
            madeChanges = true;
          }
        }
      }

      if (!optimized) {
        newSegments.push(segment);
      }
    }
    
    optimizedSegments = newSegments;
  }
  
  // Recalculate totals
  let totalDistance = 0;
  let totalTime = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;
  
  for (const segment of optimizedSegments) {
    totalDistance += segment.distance;
    totalTime += segment.time;
    if (segment.elevationChange > 0) {
      totalElevationGain += segment.elevationChange;
    } else {
      totalElevationLoss += Math.abs(segment.elevationChange);
    }
  }
  
  return {
    edges: route.edges,
    totalDistance,
    totalTime,
    totalElevationGain,
    totalElevationLoss,
    segments: optimizedSegments,
  };
}

// ============================================================================
// Pathfinding (Dijkstra's Algorithm)
// ============================================================================

interface DijkstraState {
  nodeId: string;
  time: number;
  prevEdgeId: string | null;
  prevNodeId: string | null;
}

/**
 * Find the optimal route between two nodes using Dijkstra's algorithm
 */
export function findRoute(
  graph: NavigationGraph,
  startNodeId: string,
  endNodeId: string
): NavigationRoute | null {
  if (!graph.nodes.has(startNodeId) || !graph.nodes.has(endNodeId)) {
    return null;
  }

  // Priority queue (min-heap by time)
  const openSet: DijkstraState[] = [{ 
    nodeId: startNodeId, 
    time: 0, 
    prevEdgeId: null, 
    prevNodeId: null 
  }];
  
  // Track best time to reach each node
  const bestTime = new Map<string, number>();
  bestTime.set(startNodeId, 0);
  
  // Track the path (nodeId -> { prevNodeId, edgeId })
  const cameFrom = new Map<string, { prevNodeId: string; edgeId: string }>();

  while (openSet.length > 0) {
    // Get node with lowest time (simple sort - could use proper heap for large graphs)
    openSet.sort((a, b) => a.time - b.time);
    const current = openSet.shift()!;

    // Reached the goal
    if (current.nodeId === endNodeId) {
      return reconstructRoute(graph, cameFrom, endNodeId);
    }

    // Already found a better path to this node
    const currentBest = bestTime.get(current.nodeId);
    if (currentBest !== undefined && current.time > currentBest) {
      continue;
    }

    // Explore neighbors
    const edgeIds = graph.adjacency.get(current.nodeId) || [];
    for (const edgeId of edgeIds) {
      const edge = graph.edges.get(edgeId);
      if (!edge) continue;

      const neighborId = edge.toNodeId;
      const newTime = current.time + edge.travelTime;

      const neighborBest = bestTime.get(neighborId);
      if (neighborBest === undefined || newTime < neighborBest) {
        bestTime.set(neighborId, newTime);
        cameFrom.set(neighborId, { prevNodeId: current.nodeId, edgeId });
        openSet.push({
          nodeId: neighborId,
          time: newTime,
          prevEdgeId: edgeId,
          prevNodeId: current.nodeId,
        });
      }
    }
  }

  // No path found
  return null;
}

/**
 * Find a route with diagnostics - returns detailed info about why routing failed
 */
export function findRouteWithDiagnostics(
  graph: NavigationGraph,
  startNodeId: string,
  endNodeId: string,
  skiArea: SkiAreaDetails
): { route: NavigationRoute | null; diagnostics: RouteFailureDiagnostics | null } {
  const startNode = graph.nodes.get(startNodeId);
  const endNode = graph.nodes.get(endNodeId);
  
  // Check if nodes exist
  if (!startNode) {
    return {
      route: null,
      diagnostics: {
        reason: 'no_start_node',
        startNodeExists: false,
        endNodeExists: !!endNode,
        suggestions: ['The starting point could not be found in the navigation network.'],
      },
    };
  }
  
  if (!endNode) {
    return {
      route: null,
      diagnostics: {
        reason: 'no_end_node',
        startNodeExists: true,
        endNodeExists: false,
        suggestions: ['The destination could not be found in the navigation network.'],
      },
    };
  }
  
  // Try to find a route
  const route = findRoute(graph, startNodeId, endNodeId);
  
  if (route) {
    // Optimize the route with midpoint intersections
    const optimizedRoute = optimizeRoute(route, skiArea);
    return { route: optimizedRoute, diagnostics: null };
  }
  
  // Route not found - gather diagnostics
  const suggestions: string[] = [];
  
  // Find how far we can get from the start
  const reachableNodes = findReachableNodes(graph, startNodeId);
  
  // Calculate distance from each reachable node to the end
  let nearestReachableDistance = Infinity;
  let nearestReachableNode: NavigationNode | null = null;
  
  for (const nodeId of reachableNodes) {
    const node = graph.nodes.get(nodeId);
    if (!node) continue;
    
    const dist = haversineDistance(node.lat, node.lng, endNode.lat, endNode.lng);
    if (dist < nearestReachableDistance) {
      nearestReachableDistance = dist;
      nearestReachableNode = node;
    }
  }
  
  // Calculate elevation gap
  const elevationGap = nearestReachableNode 
    ? endNode.elevation - nearestReachableNode.elevation 
    : 0;
  
  // Determine the regions
  const originRun = skiArea.runs.find(r => startNodeId.includes(r.id));
  const originLift = skiArea.lifts.find(l => startNodeId.includes(l.id));
  const destRun = skiArea.runs.find(r => endNodeId.includes(r.id));
  const destLift = skiArea.lifts.find(l => endNodeId.includes(l.id));
  
  const originRegion = originRun?.locality || originLift?.name || 'Unknown';
  const destRegion = destRun?.locality || destLift?.name || 'Unknown';
  
  // Determine reason and provide suggestions
  let reason: RouteFailureDiagnostics['reason'] = 'unreachable';
  
  if (nearestReachableDistance > MAX_EXTENDED_WALK_DISTANCE) {
    reason = 'too_far_to_walk';
    suggestions.push(`The nearest reachable point is ${Math.round(nearestReachableDistance)}m away - too far to walk.`);
  }
  
  if (originRegion !== destRegion && originRegion !== 'Unknown' && destRegion !== 'Unknown') {
    reason = 'different_region';
    suggestions.push(`Destination "${destRegion}" may not be directly connected to "${originRegion}".`);
  }
  
  if (Math.abs(elevationGap) > MAX_EXTENDED_WALK_ELEVATION) {
    suggestions.push(`Would require ${Math.abs(Math.round(elevationGap))}m ${elevationGap > 0 ? 'climb' : 'descent'} on foot.`);
  }
  
  if (nearestReachableDistance <= MAX_EXTENDED_WALK_DISTANCE && Math.abs(elevationGap) <= MAX_EXTENDED_WALK_ELEVATION) {
    suggestions.push(`There's a ${Math.round(nearestReachableDistance)}m gap that might require walking.`);
    suggestions.push('Check if the destination is accessible from a different starting point.');
  }
  
  // General suggestions
  if (suggestions.length === 0) {
    suggestions.push('Try adjusting route options to allow more lift types or slope difficulties.');
  }
  
  return {
    route: null,
    diagnostics: {
      reason,
      startNodeExists: true,
      endNodeExists: true,
      nearestReachableDistance: Math.round(nearestReachableDistance),
      elevationGap: Math.round(elevationGap),
      originRegion,
      destinationRegion: destRegion,
      suggestions,
    },
  };
}

/**
 * Find all nodes reachable from a starting node using BFS
 */
function findReachableNodes(graph: NavigationGraph, startNodeId: string): Set<string> {
  const reachable = new Set<string>();
  const queue = [startNodeId];
  
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    
    const edgeIds = graph.adjacency.get(nodeId) || [];
    for (const edgeId of edgeIds) {
      const edge = graph.edges.get(edgeId);
      if (edge && !reachable.has(edge.toNodeId)) {
        queue.push(edge.toNodeId);
      }
    }
  }
  
  return reachable;
}

/**
 * Clean up route segments:
 * 1. Remove walk segments < 100m (too short to be meaningful)
 * 2. Merge consecutive walk segments into one
 * 3. Merge consecutive unnamed run segments (they're all "connections")
 */
function cleanupSegments(segments: RouteSegment[]): RouteSegment[] {
  const MIN_WALK_DISTANCE = 100; // meters
  const cleaned: RouteSegment[] = [];
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    
    // Skip walk segments that are too short (< 100m)
    if (segment.type === 'walk' && segment.distance < MIN_WALK_DISTANCE) {
      continue;
    }
    
    // If this is a walk segment and we can merge with previous walk segment
    if (segment.type === 'walk' && cleaned.length > 0) {
      const lastSegment = cleaned[cleaned.length - 1];
      
      if (lastSegment.type === 'walk') {
        // Merge with previous walk segment
        lastSegment.distance += segment.distance;
        lastSegment.time += segment.time;
        lastSegment.elevationChange += segment.elevationChange;
        // Combine coordinates
        lastSegment.coordinates = [...lastSegment.coordinates, ...segment.coordinates];
        continue;
      }
    }
    
    // Merge consecutive unnamed run segments (they're connection segments)
    // An unnamed run is one where name is null/empty
    if (segment.type === 'run' && !segment.name && cleaned.length > 0) {
      const lastSegment = cleaned[cleaned.length - 1];
      
      // Merge if previous segment is also an unnamed run with same difficulty
      if (lastSegment.type === 'run' && !lastSegment.name && lastSegment.difficulty === segment.difficulty) {
        // Merge with previous unnamed run segment
        lastSegment.distance += segment.distance;
        lastSegment.time += segment.time;
        lastSegment.elevationChange += segment.elevationChange;
        // Combine coordinates
        lastSegment.coordinates = [...lastSegment.coordinates, ...segment.coordinates];
        continue;
      }
    }
    
    // Add segment as-is
    cleaned.push({ ...segment });
  }
  
  return cleaned;
}

/**
 * Reconstruct the route from the pathfinding result
 */
function reconstructRoute(
  graph: NavigationGraph,
  cameFrom: Map<string, { prevNodeId: string; edgeId: string }>,
  endNodeId: string
): NavigationRoute {
  const edges: NavigationEdge[] = [];
  let currentId = endNodeId;

  while (cameFrom.has(currentId)) {
    const { prevNodeId, edgeId } = cameFrom.get(currentId)!;
    const edge = graph.edges.get(edgeId);
    if (edge) {
      edges.unshift(edge); // Add to front
    }
    currentId = prevNodeId;
  }

  // Calculate totals
  let totalDistance = 0;
  let totalTime = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;
  const segments: RouteSegment[] = [];

  for (const edge of edges) {
    totalDistance += edge.distance;
    totalTime += edge.travelTime;
    
    if (edge.elevationChange > 0) {
      totalElevationGain += edge.elevationChange;
    } else {
      totalElevationLoss += Math.abs(edge.elevationChange);
    }

    segments.push({
      type: edge.type,
      name: edge.featureName,
      difficulty: edge.difficulty,
      liftType: edge.liftType,
      distance: edge.distance,
      time: edge.travelTime,
      elevationChange: edge.elevationChange,
      coordinates: edge.coordinates,
    });
  }
  
  // Clean up segments: remove short walks and merge consecutive walks
  const cleanedSegments = cleanupSegments(segments);
  
  // Recalculate totals based on cleaned segments
  let cleanedTotalDistance = 0;
  let cleanedTotalTime = 0;
  let cleanedTotalElevationGain = 0;
  let cleanedTotalElevationLoss = 0;
  
  for (const segment of cleanedSegments) {
    cleanedTotalDistance += segment.distance;
    cleanedTotalTime += segment.time;
    
    if (segment.elevationChange > 0) {
      cleanedTotalElevationGain += segment.elevationChange;
    } else {
      cleanedTotalElevationLoss += Math.abs(segment.elevationChange);
    }
  }

  return {
    edges,
    totalDistance: cleanedTotalDistance,
    totalTime: cleanedTotalTime,
    totalElevationGain: cleanedTotalElevationGain,
    totalElevationLoss: cleanedTotalElevationLoss,
    segments: cleanedSegments,
  };
}

// ============================================================================
// Finding Routes to Features
// ============================================================================

/**
 * Find the nearest node to a given point
 */
export function findNearestNode(
  graph: NavigationGraph,
  lat: number,
  lng: number,
  elevation?: number
): NavigationNode | null {
  let nearestNode: NavigationNode | null = null;
  let nearestDist = Infinity;

  for (const node of graph.nodes.values()) {
    const dist = haversineDistance(lat, lng, node.lat, node.lng);
    
    // If we have elevation, factor it in
    if (elevation !== undefined && node.elevation > 0) {
      const elevDiff = Math.abs(elevation - node.elevation);
      const dist3D = Math.sqrt(dist * dist + elevDiff * elevDiff);
      if (dist3D < nearestDist) {
        nearestDist = dist3D;
        nearestNode = node;
      }
    } else if (dist < nearestDist) {
      nearestDist = dist;
      nearestNode = node;
    }
  }

  return nearestNode;
}

// Maximum walking distance to a POI (toilet, restaurant, etc.)
const MAX_POI_WALK_DISTANCE = 300; // meters - more generous for POIs
const MAX_POI_WALK_ELEVATION = 80; // meters

/**
 * Add a temporary POI node (toilet, restaurant, etc.) to the graph with walking connections.
 * This allows routing TO the POI with generous walking tolerances.
 * Returns the node ID of the created POI node.
 */
export function addPoiNodeToGraph(
  graph: NavigationGraph,
  poiId: string,
  lat: number,
  lng: number,
  name: string
): string {
  const nodeId = `poi-${poiId}`;
  
  // Check if already added
  if (graph.nodes.has(nodeId)) {
    return nodeId;
  }
  
  // Estimate elevation from nearby nodes
  let estimatedElevation = 0;
  let nearestDist = Infinity;
  for (const node of graph.nodes.values()) {
    const dist = haversineDistance(lat, lng, node.lat, node.lng);
    if (dist < nearestDist && node.elevation > 0) {
      nearestDist = dist;
      estimatedElevation = node.elevation;
    }
  }
  
  // Create the POI node
  const poiNode: NavigationNode = {
    id: nodeId,
    lng,
    lat,
    elevation: estimatedElevation,
    type: 'connection',
    featureId: poiId,
    featureName: name,
  };
  graph.nodes.set(nodeId, poiNode);
  graph.adjacency.set(nodeId, []);
  
  // Create walking connections to all nearby nodes (generous distance)
  for (const node of graph.nodes.values()) {
    if (node.id === nodeId) continue;
    
    const horizontalDist = haversineDistance(lat, lng, node.lat, node.lng);
    if (horizontalDist > MAX_POI_WALK_DISTANCE) continue;
    
    const elevDiff = node.elevation - estimatedElevation;
    const absElevDiff = Math.abs(elevDiff);
    if (absElevDiff > MAX_POI_WALK_ELEVATION) continue;
    
    const dist3D = Math.sqrt(horizontalDist * horizontalDist + absElevDiff * absElevDiff);
    
    // Determine walk speed
    let speedToPoi: number;
    let speedFromPoi: number;
    
    if (absElevDiff < 5) {
      speedToPoi = SPEEDS.walk.flat;
      speedFromPoi = SPEEDS.walk.flat;
    } else if (elevDiff > 0) {
      // Node is higher than POI, walking to POI is downhill
      speedToPoi = SPEEDS.walk.downhill_gentle;
      speedFromPoi = SPEEDS.walk.uphill;
    } else {
      speedToPoi = SPEEDS.walk.uphill;
      speedFromPoi = SPEEDS.walk.downhill_gentle;
    }
    
    // Small time penalty for POI walks (less than normal walk penalty)
    const poiWalkPenalty = 1.2;
    
    // Create bidirectional edges
    const edgeToPoi: NavigationEdge = {
      id: `walk-${node.id}-${nodeId}`,
      fromNodeId: node.id,
      toNodeId: nodeId,
      type: 'walk',
      featureId: 'poi-connection',
      featureName: `Walk to ${name}`,
      distance: dist3D,
      elevationChange: -elevDiff,
      travelTime: (dist3D / speedToPoi) * poiWalkPenalty,
      speed: speedToPoi,
      coordinates: [[node.lng, node.lat, node.elevation], [lng, lat, estimatedElevation]],
    };
    
    const edgeFromPoi: NavigationEdge = {
      id: `walk-${nodeId}-${node.id}`,
      fromNodeId: nodeId,
      toNodeId: node.id,
      type: 'walk',
      featureId: 'poi-connection',
      featureName: `Walk from ${name}`,
      distance: dist3D,
      elevationChange: elevDiff,
      travelTime: (dist3D / speedFromPoi) * poiWalkPenalty,
      speed: speedFromPoi,
      coordinates: [[lng, lat, estimatedElevation], [node.lng, node.lat, node.elevation]],
    };
    
    graph.edges.set(edgeToPoi.id, edgeToPoi);
    graph.edges.set(edgeFromPoi.id, edgeFromPoi);
    
    // Update adjacency
    const nodeAdj = graph.adjacency.get(node.id) || [];
    nodeAdj.push(edgeToPoi.id);
    graph.adjacency.set(node.id, nodeAdj);
    
    const poiAdj = graph.adjacency.get(nodeId) || [];
    poiAdj.push(edgeFromPoi.id);
    graph.adjacency.set(nodeId, poiAdj);
  }
  
  return nodeId;
}

/**
 * Get possible destinations (all runs and lifts with their entry nodes)
 */
export function getDestinations(
  skiArea: SkiAreaDetails,
  graph: NavigationGraph
): NavigationDestination[] {
  const destinations: NavigationDestination[] = [];

  // Add runs
  for (const run of skiArea.runs) {
    if (!run.name) continue;
    
    const nodeId = `run-${run.id}-start`;
    if (graph.nodes.has(nodeId)) {
      destinations.push({
        id: run.id,
        name: run.name,
        type: 'run',
        difficulty: run.difficulty,
        nodeId,
      });
    }
  }

  // Add lifts
  for (const lift of skiArea.lifts) {
    if (!lift.name) continue;
    
    const nodeId = `lift-${lift.id}-start`;
    if (graph.nodes.has(nodeId)) {
      destinations.push({
        id: lift.id,
        name: lift.name,
        type: 'lift',
        liftType: lift.liftType,
        nodeId,
      });
    }
  }

  return destinations;
}

/**
 * Find route from user's current location to a destination
 */
export function findRouteFromLocation(
  graph: NavigationGraph,
  userLat: number,
  userLng: number,
  userElevation: number | undefined,
  destinationNodeId: string
): NavigationRoute | null {
  // Find nearest node to user's location
  const nearestNode = findNearestNode(graph, userLat, userLng, userElevation);
  if (!nearestNode) return null;

  return findRoute(graph, nearestNode.id, destinationNodeId);
}

/**
 * Find route between two features
 */
export function findRouteBetweenFeatures(
  graph: NavigationGraph,
  originId: string,
  originType: 'run' | 'lift',
  destinationId: string,
  destinationType: 'run' | 'lift'
): NavigationRoute | null {
  // For runs, start from the end (bottom) to simulate finishing the run
  // For lifts, start from the end (top) to simulate getting off
  const fromNodeId = originType === 'run' 
    ? `run-${originId}-end`
    : `lift-${originId}-end`;
  
  // For destinations, go to the start (entry point)
  const toNodeId = destinationType === 'run'
    ? `run-${destinationId}-start`
    : `lift-${destinationId}-start`;

  return findRoute(graph, fromNodeId, toNodeId);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate the total distance of a path
 */
function calculatePathDistance(coords: number[][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1, elev1] = coords[i - 1];
    const [lng2, lat2, elev2] = coords[i];
    
    const horizontalDist = haversineDistance(lat1, lng1, lat2, lng2);
    const elevDiff = ((elev2 as number) || 0) - ((elev1 as number) || 0);
    
    // 3D distance
    total += Math.sqrt(horizontalDist * horizontalDist + elevDiff * elevDiff);
  }
  return total;
}

/**
 * Haversine formula to calculate distance between two points
 */
function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Get skiing speed based on difficulty
 */
function getSkiingSpeed(difficulty: string | null): number {
  if (!difficulty) return SPEEDS.skiing.unknown;
  const key = difficulty.toLowerCase() as keyof typeof SPEEDS.skiing;
  return SPEEDS.skiing[key] || SPEEDS.skiing.unknown;
}

/**
 * Get lift speed based on type
 */
function getLiftSpeed(liftType: string | null): number {
  if (!liftType) return SPEEDS.lifts.unknown;
  const key = liftType.toLowerCase().replace(/[_\s]/g, '_') as keyof typeof SPEEDS.lifts;
  return SPEEDS.lifts[key] || SPEEDS.lifts.unknown;
}

/**
 * Extract a centerline from a polygon (simple approach using bounding box)
 */
function extractPolygonCenterline(ring: number[][]): number[][] {
  if (ring.length < 3) return ring;
  
  // Find the highest and lowest points
  let highestIdx = 0;
  let lowestIdx = 0;
  let highestElev = (ring[0][2] as number) || 0;
  let lowestElev = highestElev;
  
  for (let i = 1; i < ring.length; i++) {
    const elev = (ring[i][2] as number) || 0;
    if (elev > highestElev) {
      highestElev = elev;
      highestIdx = i;
    }
    if (elev < lowestElev) {
      lowestElev = elev;
      lowestIdx = i;
    }
  }
  
  // Return a simple line from highest to lowest
  return [ring[highestIdx], ring[lowestIdx]];
}

// ============================================================================
// Geometry Refinement Utilities
// ============================================================================

/**
 * Project a point onto a line segment and find the closest point on that segment
 */
function projectPointToLineSegment(
  point: [number, number, number?],
  segStart: [number, number, number?],
  segEnd: [number, number, number?]
): { point: [number, number, number?]; distance: number; t: number } {
  const [px, py] = point;
  const [x1, y1] = segStart;
  const [x2, y2] = segEnd;

  // Vector from start to end of segment
  const dx = x2 - x1;
  const dy = y2 - y1;

  // If segment is a point, return that point
  if (dx === 0 && dy === 0) {
    const dist = haversineDistance(py, px, y1, x1);
    return { point: segStart, distance: dist, t: 0 };
  }

  // Parameter t represents position along segment (0 = start, 1 = end)
  // Project point onto infinite line, then clamp to segment
  const t = Math.max(0, Math.min(1,
    ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
  ));

  // Closest point on segment
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  const closestZ = segStart[2] !== undefined && segEnd[2] !== undefined
    ? segStart[2] + t * (segEnd[2] - segStart[2])
    : undefined;

  const closestPoint: [number, number, number?] = closestZ !== undefined
    ? [closestX, closestY, closestZ]
    : [closestX, closestY];

  const dist = haversineDistance(py, px, closestY, closestX);

  return { point: closestPoint, distance: dist, t };
}

/**
 * Find the closest point on a LineString to a target point
 */
function findClosestPointOnLineString(
  targetPoint: [number, number, number?],
  lineCoords: [number, number, number?][]
): { pointIndex: number; point: [number, number, number?]; distance: number; segmentT: number } {
  if (lineCoords.length === 0) {
    return { pointIndex: 0, point: targetPoint, distance: Infinity, segmentT: 0 };
  }

  if (lineCoords.length === 1) {
    const dist = haversineDistance(
      targetPoint[1], targetPoint[0],
      lineCoords[0][1], lineCoords[0][0]
    );
    return { pointIndex: 0, point: lineCoords[0], distance: dist, segmentT: 0 };
  }

  let bestDist = Infinity;
  let bestPoint = lineCoords[0];
  let bestIndex = 0;
  let bestT = 0;

  // Check each segment of the LineString
  for (let i = 0; i < lineCoords.length - 1; i++) {
    const segStart = lineCoords[i];
    const segEnd = lineCoords[i + 1];

    const projection = projectPointToLineSegment(targetPoint, segStart, segEnd);

    if (projection.distance < bestDist) {
      bestDist = projection.distance;
      bestPoint = projection.point;
      bestIndex = i;
      bestT = projection.t;
    }
  }

  // Also check endpoints directly
  for (let i = 0; i < lineCoords.length; i++) {
    const dist = haversineDistance(
      targetPoint[1], targetPoint[0],
      lineCoords[i][1], lineCoords[i][0]
    );
    if (dist < bestDist) {
      bestDist = dist;
      bestPoint = lineCoords[i];
      bestIndex = i;
      bestT = 0;
    }
  }

  return { pointIndex: bestIndex, point: bestPoint, distance: bestDist, segmentT: bestT };
}

/**
 * Extract a sub-LineString between two indices
 * Handles interpolation when indices don't align with coordinate points
 */
function extractSubLineString(
  coords: [number, number, number?][],
  startIdx: number,
  startT: number, // 0-1 parameter within segment at startIdx
  endIdx: number,
  endT: number     // 0-1 parameter within segment at endIdx
): [number, number, number?][] {
  if (coords.length === 0) return [];
  if (startIdx === endIdx && startT === endT) return [coords[startIdx]];

  const result: [number, number, number?][] = [];

  // Add interpolated start point if needed
  if (startT > 0 && startIdx < coords.length - 1) {
    const seg1 = coords[startIdx];
    const seg2 = coords[startIdx + 1];
    const interpX = seg1[0] + startT * (seg2[0] - seg1[0]);
    const interpY = seg1[1] + startT * (seg2[1] - seg1[1]);
    const interpZ = seg1[2] !== undefined && seg2[2] !== undefined
      ? seg1[2] + startT * (seg2[2] - seg1[2])
      : undefined;
    result.push(interpZ !== undefined ? [interpX, interpY, interpZ] : [interpX, interpY]);
  } else {
    result.push(coords[startIdx]);
  }

  // Add all intermediate points
  for (let i = startIdx + 1; i <= endIdx && i < coords.length; i++) {
    if (i === endIdx && endT < 1 && i < coords.length - 1) {
      // Interpolate end point
      const seg1 = coords[i];
      const seg2 = coords[i + 1];
      const interpX = seg1[0] + endT * (seg2[0] - seg1[0]);
      const interpY = seg1[1] + endT * (seg2[1] - seg1[1]);
      const interpZ = seg1[2] !== undefined && seg2[2] !== undefined
        ? seg1[2] + endT * (seg2[2] - seg1[2])
        : undefined;
      result.push(interpZ !== undefined ? [interpX, interpY, interpZ] : [interpX, interpY]);
    } else {
      result.push(coords[i]);
    }
  }

  return result.length > 0 ? result : [coords[startIdx]];
}

/**
 * Find the closest pair of points between two LineStrings
 */
function findClosestPointsBetweenLines(
  line1Coords: [number, number, number?][],
  line2Coords: [number, number, number?][]
): {
  line1Index: number;
  line1Point: [number, number, number?];
  line1T: number;
  line2Index: number;
  line2Point: [number, number, number?];
  line2T: number;
  distance: number;
} | null {
  if (line1Coords.length === 0 || line2Coords.length === 0) return null;

  let bestDist = Infinity;
  let bestResult = null;

  // For efficiency, sample last 5 points of line1 and first 5 points of line2
  const line1Sample = line1Coords.slice(-5);
  const line2Sample = line2Coords.slice(0, 5);
  const line1Offset = Math.max(0, line1Coords.length - 5);

  for (let i = 0; i < line1Sample.length; i++) {
    const point1 = line1Sample[i];
    const closest = findClosestPointOnLineString(point1, line2Sample);

    if (closest.distance < bestDist) {
      bestDist = closest.distance;
      bestResult = {
        line1Index: line1Offset + i,
        line1Point: point1,
        line1T: 0,
        line2Index: closest.pointIndex,
        line2Point: closest.point,
        line2T: closest.segmentT,
        distance: closest.distance
      };
    }
  }

  return bestResult;
}

/**
 * Find multiple alternative routes using Yen's k-shortest paths algorithm (simplified)
 * This is useful for sunny routing where we want to compare different routes.
 * 
 * @param maxAlternatives - Maximum number of alternative routes to find
 * @param toleranceMultiplier - Only consider routes up to this multiplier of shortest path time
 */
export function findAlternativeRoutes(
  graph: NavigationGraph,
  startNodeId: string,
  endNodeId: string,
  maxAlternatives: number = 5,
  toleranceMultiplier: number = 1.5
): NavigationRoute[] {
  const alternatives: NavigationRoute[] = [];
  
  // First, find the shortest path
  const shortestRoute = findRoute(graph, startNodeId, endNodeId);
  if (!shortestRoute) return alternatives;
  
  const maxTime = shortestRoute.totalTime * toleranceMultiplier;
  
  // Use a modified Dijkstra that finds k-shortest paths
  // We do this by finding paths that avoid different combinations of edges from the shortest path
  
  // Get the edges used in the shortest path
  const usedEdgeIds = new Set(shortestRoute.edges.map(e => e.id));
  
  // Try finding alternative paths by temporarily "blocking" segments of the original path
  for (let blockPoint = 0; blockPoint < shortestRoute.segments.length; blockPoint++) {
    const segment = shortestRoute.segments[blockPoint];
    
    // Skip short segments (not meaningful to route around)
    if (segment.distance < 200) continue;
    
    // Create a filtered graph that excludes this segment's edge
    const filteredAdjacency = new Map<string, string[]>();
    
    for (const [nodeId, edgeIds] of graph.adjacency) {
      const filteredEdgeIds = edgeIds.filter(edgeId => {
        const edge = graph.edges.get(edgeId);
        if (!edge) return false;
        // Block the edge that corresponds to this segment
        if (edge.featureId === segment.name || 
            (segment.type === 'run' && edgeId.includes(segment.name || ''))) {
          return false;
        }
        return true;
      });
      filteredAdjacency.set(nodeId, filteredEdgeIds);
    }
    
    const filteredGraph: NavigationGraph = {
      nodes: graph.nodes,
      edges: graph.edges,
      adjacency: filteredAdjacency,
    };
    
    // Find a route in the filtered graph
    const altRoute = findRoute(filteredGraph, startNodeId, endNodeId);
    
    if (altRoute && altRoute.totalTime <= maxTime) {
      // Check it's actually different from routes we already have
      const altEdgeSet = new Set(altRoute.edges.map(e => e.id));
      let isDifferent = true;
      
      // Must have at least 20% different edges to be considered an alternative
      for (const existing of alternatives) {
        const existingEdgeSet = new Set(existing.edges.map(e => e.id));
        let overlap = 0;
        for (const edgeId of altEdgeSet) {
          if (existingEdgeSet.has(edgeId)) overlap++;
        }
        const overlapRatio = overlap / altEdgeSet.size;
        if (overlapRatio > 0.8) {
          isDifferent = false;
          break;
        }
      }
      
      if (isDifferent) {
        alternatives.push(altRoute);
        if (alternatives.length >= maxAlternatives) break;
      }
    }
  }
  
  return alternatives;
}

/**
 * Format time duration for display
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) {
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

/**
 * Format distance for display
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

// ============================================================================
// Status-Aware Routing
// ============================================================================

export interface LiveStatusData {
  closedLiftIds: Set<string>;
  closedRunIds: Set<string>;
  liftClosingTimes: Map<string, number>; // lift ID -> minutes until close
  runClosingTimes: Map<string, number>;  // run ID -> minutes until close
  liftDurations?: Map<string, number>;   // lift ID -> actual duration in minutes (optional)
}

export interface StatusAwareRouteOptions {
  liveStatus?: LiveStatusData;
  currentTime?: Date;
  closingTimeBuffer?: number; // minutes buffer before closing (default: 10)
  avoidClosingSoon?: boolean; // avoid lifts/runs closing within buffer
}

/**
 * Build a status-aware navigation graph that excludes closed lifts/runs
 * and optionally considers closing times
 */
export function buildStatusAwareGraph(
  baseGraph: NavigationGraph,
  options: StatusAwareRouteOptions = {}
): NavigationGraph {
  const {
    liveStatus,
    closingTimeBuffer = 10,
    avoidClosingSoon = true,
  } = options;

  if (!liveStatus) {
    return baseGraph;
  }

  const { closedLiftIds, closedRunIds, liftClosingTimes, runClosingTimes } = liveStatus;

  // Create new adjacency map that excludes closed features
  const filteredAdjacency = new Map<string, string[]>();

  for (const [nodeId, edgeIds] of baseGraph.adjacency) {
    const filteredEdgeIds = edgeIds.filter(edgeId => {
      const edge = baseGraph.edges.get(edgeId);
      if (!edge) return false;

      // Check if this is a closed lift
      if (edge.type === 'lift') {
        if (closedLiftIds.has(edge.featureId)) {
          return false;
        }
        // Check if closing soon
        if (avoidClosingSoon) {
          const minutesUntilClose = liftClosingTimes.get(edge.featureId);
          if (minutesUntilClose !== undefined && minutesUntilClose <= closingTimeBuffer) {
            return false;
          }
        }
      }

      // Check if this is a closed run
      if (edge.type === 'run') {
        if (closedRunIds.has(edge.featureId)) {
          return false;
        }
        // Check if closing soon
        if (avoidClosingSoon) {
          const minutesUntilClose = runClosingTimes.get(edge.featureId);
          if (minutesUntilClose !== undefined && minutesUntilClose <= closingTimeBuffer) {
            return false;
          }
        }
      }

      return true;
    });

    filteredAdjacency.set(nodeId, filteredEdgeIds);
  }

  return {
    nodes: baseGraph.nodes,
    edges: baseGraph.edges,
    adjacency: filteredAdjacency,
  };
}

/**
 * Enhanced pathfinding that considers arrival time at each lift
 * This ensures we don't route through lifts that will be closed when we arrive
 */
export function findRouteWithArrivalTimes(
  graph: NavigationGraph,
  startNodeId: string,
  endNodeId: string,
  liveStatus?: LiveStatusData,
  closingTimeBuffer: number = 10
): NavigationRoute | null {
  if (!graph.nodes.has(startNodeId) || !graph.nodes.has(endNodeId)) {
    return null;
  }

  // Priority queue tracking both time and arrival time
  interface ArrivalState {
    nodeId: string;
    elapsedTime: number; // seconds since start
    prevEdgeId: string | null;
    prevNodeId: string | null;
  }

  const openSet: ArrivalState[] = [{
    nodeId: startNodeId,
    elapsedTime: 0,
    prevEdgeId: null,
    prevNodeId: null,
  }];

  const bestTime = new Map<string, number>();
  bestTime.set(startNodeId, 0);

  const cameFrom = new Map<string, { prevNodeId: string; edgeId: string }>();

  while (openSet.length > 0) {
    openSet.sort((a, b) => a.elapsedTime - b.elapsedTime);
    const current = openSet.shift()!;

    if (current.nodeId === endNodeId) {
      return reconstructRouteFromPath(graph, cameFrom, endNodeId);
    }

    const currentBest = bestTime.get(current.nodeId);
    if (currentBest !== undefined && current.elapsedTime > currentBest) {
      continue;
    }

    const edgeIds = graph.adjacency.get(current.nodeId) || [];
    for (const edgeId of edgeIds) {
      const edge = graph.edges.get(edgeId);
      if (!edge) continue;

      // Calculate arrival time at the destination of this edge
      const arrivalTimeMinutes = (current.elapsedTime + edge.travelTime) / 60;

      // Check if the feature will still be open when we arrive
      if (liveStatus && edge.type === 'lift') {
        const closingTime = liveStatus.liftClosingTimes.get(edge.featureId);
        if (closingTime !== undefined) {
          // Need buffer time before closing
          const effectiveClosingTime = closingTime - closingTimeBuffer;
          if (arrivalTimeMinutes >= effectiveClosingTime) {
            // This lift will be closed (or closing soon) when we arrive
            continue;
          }
        }
      }

      if (liveStatus && edge.type === 'run') {
        const closingTime = liveStatus.runClosingTimes.get(edge.featureId);
        if (closingTime !== undefined) {
          const effectiveClosingTime = closingTime - closingTimeBuffer;
          if (arrivalTimeMinutes >= effectiveClosingTime) {
            continue;
          }
        }
      }

      const newTime = current.elapsedTime + edge.travelTime;
      const neighborBest = bestTime.get(edge.toNodeId);

      if (neighborBest === undefined || newTime < neighborBest) {
        bestTime.set(edge.toNodeId, newTime);
        cameFrom.set(edge.toNodeId, { prevNodeId: current.nodeId, edgeId });
        openSet.push({
          nodeId: edge.toNodeId,
          elapsedTime: newTime,
          prevEdgeId: edgeId,
          prevNodeId: current.nodeId,
        });
      }
    }
  }

  return null;
}

/**
 * Reconstruct route from pathfinding result (simplified version for status-aware routing)
 */
function reconstructRouteFromPath(
  graph: NavigationGraph,
  cameFrom: Map<string, { prevNodeId: string; edgeId: string }>,
  endNodeId: string
): NavigationRoute {
  const edges: NavigationEdge[] = [];
  let currentId = endNodeId;

  while (cameFrom.has(currentId)) {
    const { prevNodeId, edgeId } = cameFrom.get(currentId)!;
    const edge = graph.edges.get(edgeId);
    if (edge) {
      edges.unshift(edge);
    }
    currentId = prevNodeId;
  }

  let totalDistance = 0;
  let totalTime = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;
  const segments: RouteSegment[] = [];

  for (const edge of edges) {
    totalDistance += edge.distance;
    totalTime += edge.travelTime;

    if (edge.elevationChange > 0) {
      totalElevationGain += edge.elevationChange;
    } else {
      totalElevationLoss += Math.abs(edge.elevationChange);
    }

    segments.push({
      type: edge.type,
      name: edge.featureName,
      difficulty: edge.difficulty,
      liftType: edge.liftType,
      distance: edge.distance,
      time: edge.travelTime,
      elevationChange: edge.elevationChange,
      coordinates: edge.coordinates,
    });
  }

  return {
    edges,
    totalDistance,
    totalTime,
    totalElevationGain,
    totalElevationLoss,
    segments,
  };
}

/**
 * Find status-aware route that avoids closed lifts/runs and respects closing times
 */
export function findStatusAwareRoute(
  graph: NavigationGraph,
  startNodeId: string,
  endNodeId: string,
  skiArea: SkiAreaDetails,
  options: StatusAwareRouteOptions = {}
): { route: NavigationRoute | null; warnings: string[] } {
  const warnings: string[] = [];
  const { liveStatus, closingTimeBuffer = 10 } = options;

  // First, build a status-aware graph excluding closed features
  const statusGraph = buildStatusAwareGraph(graph, options);

  // Try to find a route using arrival-time-aware pathfinding
  let route = findRouteWithArrivalTimes(
    statusGraph,
    startNodeId,
    endNodeId,
    liveStatus,
    closingTimeBuffer
  );

  if (route) {
    // Optimize the route
    route = optimizeRoute(route, skiArea);

    // Add warnings for lifts/runs closing soon on the route
    if (liveStatus) {
      for (const segment of route.segments) {
        if (segment.type === 'lift') {
          const edge = route.edges.find(e => e.type === 'lift' && e.featureName === segment.name);
          if (edge) {
            const minutesUntilClose = liveStatus.liftClosingTimes.get(edge.featureId);
            if (minutesUntilClose !== undefined && minutesUntilClose <= 30) {
              warnings.push(`${segment.name} closes in ${minutesUntilClose} minutes`);
            }
          }
        }
      }
    }

    return { route, warnings };
  }

  // If no route found with status filtering, try without and warn
  const basicRoute = findRoute(graph, startNodeId, endNodeId);
  if (basicRoute) {
    warnings.push('Some lifts or runs on this route may be closed');

    // Check which ones are closed
    if (liveStatus) {
      for (const edge of basicRoute.edges) {
        if (edge.type === 'lift' && liveStatus.closedLiftIds.has(edge.featureId)) {
          warnings.push(`${edge.featureName || 'A lift'} is currently closed`);
        }
        if (edge.type === 'run' && liveStatus.closedRunIds.has(edge.featureId)) {
          warnings.push(`${edge.featureName || 'A run'} is currently closed`);
        }
      }
    }

    return { route: optimizeRoute(basicRoute, skiArea), warnings };
  }

  return { route: null, warnings: ['No route available'] };
}


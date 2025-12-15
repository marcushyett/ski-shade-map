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
    const travelTime = distance / speed;

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

      // Create bidirectional walk edges
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

      addEdge(walkEdgeAB);
      addEdge(walkEdgeBA);
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

      // Create bidirectional extended walk edges with higher penalty
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

      addEdge(extWalkEdgeAB);
      addEdge(extWalkEdgeBA);
    }
  }

  // Third pass: Add mid-point intersection nodes where runs cross or come close to each other
  // This allows transitioning between runs at intermediate points, not just start/end
  const MIN_INTERSECTION_DISTANCE = 30; // meters - how close for intersection
  const runEdgesList = Array.from(edges.values()).filter(e => e.type === 'run');
  const liftEndNodes = Array.from(nodes.values()).filter(n => n.type === 'lift_end');
  
  for (const runEdge of runEdgesList) {
    const coords = runEdge.coordinates;
    if (coords.length < 3) continue; // Need at least 3 points to have a midpoint
    
    // Check each coordinate (except first and last which are already nodes)
    for (let i = 1; i < coords.length - 1; i++) {
      const coord = coords[i];
      const lng = coord[0];
      const lat = coord[1];
      const elev = (coord[2] as number) || 0;
      
      // Check if this point is close to any lift end (common transition point)
      for (const liftEnd of liftEndNodes) {
        const dist = haversineDistance(lat, lng, liftEnd.lat, liftEnd.lng);
        if (dist < MIN_INTERSECTION_DISTANCE) {
          const elevDiff = Math.abs(elev - liftEnd.elevation);
          if (elevDiff < 30) {
            // Create a mid-point node on this run
            const midNodeId = `run-${runEdge.featureId}-mid-${i}`;
            
            if (!nodes.has(midNodeId)) {
              const midNode: NavigationNode = {
                id: midNodeId,
                lng,
                lat,
                elevation: elev,
                type: 'connection',
                featureId: runEdge.featureId,
                featureName: runEdge.featureName,
              };
              addNode(midNode);
              
              // Create walk connection from lift end to this mid-point
              const walkToMid: NavigationEdge = {
                id: `walk-${liftEnd.id}-to-${midNodeId}`,
                fromNodeId: liftEnd.id,
                toNodeId: midNodeId,
                type: 'walk',
                featureId: 'connection',
                featureName: null,
                distance: dist,
                elevationChange: elev - liftEnd.elevation,
                travelTime: dist / SPEEDS.walk.flat,
                speed: SPEEDS.walk.flat,
                coordinates: [
                  [liftEnd.lng, liftEnd.lat, liftEnd.elevation],
                  [lng, lat, elev],
                ],
              };
              addEdge(walkToMid);
              
              // Create edge from mid-point to run end (continuing down the run)
              const remainingCoords = coords.slice(i);
              const remainingDist = calculatePathDistance(remainingCoords);
              const endElev = (coords[coords.length - 1][2] as number) || 0;
              
              const midToEnd: NavigationEdge = {
                id: `run-${runEdge.featureId}-mid${i}-to-end`,
                fromNodeId: midNodeId,
                toNodeId: `run-${runEdge.featureId}-end`,
                type: 'run',
                featureId: runEdge.featureId,
                featureName: runEdge.featureName,
                difficulty: runEdge.difficulty,
                distance: remainingDist,
                elevationChange: endElev - elev,
                travelTime: remainingDist / runEdge.speed,
                speed: runEdge.speed,
                coordinates: remainingCoords as [number, number, number?][],
              };
              addEdge(midToEnd);
            }
            break; // Only need one intersection per coordinate
          }
        }
      }
    }
  }
  
  // Fourth pass: Add run-to-run intersection points
  // This allows transitioning between runs where they cross
  for (let r1 = 0; r1 < runEdgesList.length; r1++) {
    const run1 = runEdgesList[r1];
    const coords1 = run1.coordinates;
    
    for (let r2 = r1 + 1; r2 < runEdgesList.length; r2++) {
      const run2 = runEdgesList[r2];
      const coords2 = run2.coordinates;
      
      // Check if any coordinates of run1 are close to any coordinates of run2
      for (let i = 1; i < coords1.length - 1; i++) {
        const c1 = coords1[i];
        
        for (let j = 1; j < coords2.length - 1; j++) {
          const c2 = coords2[j];
          
          const dist = haversineDistance(c1[1], c1[0], c2[1], c2[0]);
          if (dist < MIN_INTERSECTION_DISTANCE) {
            const elev1 = (c1[2] as number) || 0;
            const elev2 = (c2[2] as number) || 0;
            const elevDiff = Math.abs(elev1 - elev2);
            
            if (elevDiff < 30) {
              // Create intersection node for run1
              const mid1NodeId = `run-${run1.featureId}-mid-${i}`;
              const mid2NodeId = `run-${run2.featureId}-mid-${j}`;
              
              // Add mid-node on run1 if not exists
              if (!nodes.has(mid1NodeId)) {
                const midNode1: NavigationNode = {
                  id: mid1NodeId,
                  lng: c1[0],
                  lat: c1[1],
                  elevation: elev1,
                  type: 'connection',
                  featureId: run1.featureId,
                  featureName: run1.featureName,
                };
                addNode(midNode1);
                
                // Create edge from mid-point to run1 end
                const remainingCoords1 = coords1.slice(i);
                const remainingDist1 = calculatePathDistance(remainingCoords1);
                const endElev1 = (coords1[coords1.length - 1][2] as number) || 0;
                
                const mid1ToEnd: NavigationEdge = {
                  id: `run-${run1.featureId}-mid${i}-to-end`,
                  fromNodeId: mid1NodeId,
                  toNodeId: `run-${run1.featureId}-end`,
                  type: 'run',
                  featureId: run1.featureId,
                  featureName: run1.featureName,
                  difficulty: run1.difficulty,
                  distance: remainingDist1,
                  elevationChange: endElev1 - elev1,
                  travelTime: remainingDist1 / run1.speed,
                  speed: run1.speed,
                  coordinates: remainingCoords1 as [number, number, number?][],
                };
                addEdge(mid1ToEnd);
              }
              
              // Add mid-node on run2 if not exists
              if (!nodes.has(mid2NodeId)) {
                const midNode2: NavigationNode = {
                  id: mid2NodeId,
                  lng: c2[0],
                  lat: c2[1],
                  elevation: elev2,
                  type: 'connection',
                  featureId: run2.featureId,
                  featureName: run2.featureName,
                };
                addNode(midNode2);
                
                // Create edge from mid-point to run2 end
                const remainingCoords2 = coords2.slice(j);
                const remainingDist2 = calculatePathDistance(remainingCoords2);
                const endElev2 = (coords2[coords2.length - 1][2] as number) || 0;
                
                const mid2ToEnd: NavigationEdge = {
                  id: `run-${run2.featureId}-mid${j}-to-end`,
                  fromNodeId: mid2NodeId,
                  toNodeId: `run-${run2.featureId}-end`,
                  type: 'run',
                  featureId: run2.featureId,
                  featureName: run2.featureName,
                  difficulty: run2.difficulty,
                  distance: remainingDist2,
                  elevationChange: endElev2 - elev2,
                  travelTime: remainingDist2 / run2.speed,
                  speed: run2.speed,
                  coordinates: remainingCoords2 as [number, number, number?][],
                };
                addEdge(mid2ToEnd);
              }
              
              // Create bidirectional walk connections between the two mid-points
              const walkBetween1: NavigationEdge = {
                id: `walk-${mid1NodeId}-to-${mid2NodeId}`,
                fromNodeId: mid1NodeId,
                toNodeId: mid2NodeId,
                type: 'walk',
                featureId: 'intersection',
                featureName: null,
                distance: dist,
                elevationChange: elev2 - elev1,
                travelTime: dist / SPEEDS.walk.flat,
                speed: SPEEDS.walk.flat,
                coordinates: [
                  [c1[0], c1[1], elev1],
                  [c2[0], c2[1], elev2],
                ],
              };
              
              const walkBetween2: NavigationEdge = {
                id: `walk-${mid2NodeId}-to-${mid1NodeId}`,
                fromNodeId: mid2NodeId,
                toNodeId: mid1NodeId,
                type: 'walk',
                featureId: 'intersection',
                featureName: null,
                distance: dist,
                elevationChange: elev1 - elev2,
                travelTime: dist / SPEEDS.walk.flat,
                speed: SPEEDS.walk.flat,
                coordinates: [
                  [c2[0], c2[1], elev2],
                  [c1[0], c1[1], elev1],
                ],
              };
              
              addEdge(walkBetween1);
              addEdge(walkBetween2);
            }
          }
        }
      }
    }
  }

  return { nodes, edges, adjacency };
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
    return { route, diagnostics: null };
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
  
  const originRegion = originRun?.subRegionName || originLift?.name || 'Unknown';
  const destRegion = destRun?.subRegionName || destLift?.name || 'Unknown';
  
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


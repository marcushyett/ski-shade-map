import type { RunData, LiftData, BoundingBox } from '@/lib/types';
import type {
  GameWorld,
  GameRun,
  GameLift,
  GameBuilding,
  GameTree,
  TerrainData,
} from './types';
import { DIFFICULTY_POINT_MULTIPLIERS as POINT_MULTIPLIERS } from './types';

/**
 * Coordinate conversion utilities
 * Convert lat/lng to local XZ coordinates (meters from center)
 * Y is elevation
 */
const EARTH_RADIUS = 6371000; // meters

export function latLngToMeters(
  lat: number,
  lng: number,
  centerLat: number,
  centerLng: number
): { x: number; z: number } {
  const latDiff = lat - centerLat;
  const lngDiff = lng - centerLng;

  // Convert to meters
  const z = latDiff * (Math.PI / 180) * EARTH_RADIUS;
  const x = lngDiff * (Math.PI / 180) * EARTH_RADIUS * Math.cos(centerLat * Math.PI / 180);

  return { x, z: -z }; // Negate Z so north is forward
}

export function metersToLatLng(
  x: number,
  z: number,
  centerLat: number,
  centerLng: number
): { lat: number; lng: number } {
  const latDiff = -z / (EARTH_RADIUS * Math.PI / 180);
  const lngDiff = x / (EARTH_RADIUS * Math.PI / 180 * Math.cos(centerLat * Math.PI / 180));

  return {
    lat: centerLat + latDiff,
    lng: centerLng + lngDiff,
  };
}

/**
 * Fetch elevation for a single point using MapTiler terrain-rgb tiles
 */
export async function getElevation(lat: number, lng: number): Promise<number> {
  const MAPTILER_API_KEY = process.env.NEXT_PUBLIC_MAPTILER_API_KEY || '';
  const zoom = 14;

  // Convert lat/lng to tile coordinates
  const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom));

  const tileUrl = `https://api.maptiler.com/tiles/terrain-rgb-v2/${zoom}/${x}/${y}.webp?key=${MAPTILER_API_KEY}`;

  try {
    // In browser context, use canvas to read pixel values
    if (typeof window !== 'undefined') {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = tileUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      // Calculate pixel position within tile
      const xFraction = ((lng + 180) / 360 * Math.pow(2, zoom)) % 1;
      const yFraction = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom)) % 1;

      const px = Math.floor(xFraction * 512);
      const py = Math.floor(yFraction * 512);

      const pixel = ctx.getImageData(px, py, 1, 1).data;

      // Decode elevation from RGB
      const elevation = -10000 + ((pixel[0] * 256 * 256 + pixel[1] * 256 + pixel[2]) * 0.1);
      return elevation;
    }

    return 0; // Fallback for SSR
  } catch {
    return 0;
  }
}

/**
 * Fetch elevation data for a grid of points
 */
export async function getElevationGrid(
  bounds: BoundingBox,
  resolution: number = 20 // meters per cell
): Promise<TerrainData> {
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;

  // Calculate grid dimensions
  const { x: minX, z: minZ } = latLngToMeters(bounds.minLat, bounds.minLng, centerLat, centerLng);
  const { x: maxX, z: maxZ } = latLngToMeters(bounds.maxLat, bounds.maxLng, centerLat, centerLng);

  const width = Math.ceil(Math.abs(maxX - minX) / resolution);
  const height = Math.ceil(Math.abs(maxZ - minZ) / resolution);

  // Limit grid size to prevent performance issues
  const maxDimension = 256;
  const actualWidth = Math.min(width, maxDimension);
  const actualHeight = Math.min(height, maxDimension);
  const actualResolution = Math.max(
    Math.abs(maxX - minX) / actualWidth,
    Math.abs(maxZ - minZ) / actualHeight
  );

  const heightmap = new Float32Array(actualWidth * actualHeight);

  // Sample elevation at each grid point
  // For performance, we'll sample key points and interpolate
  const sampleInterval = Math.max(1, Math.floor(Math.min(actualWidth, actualHeight) / 32));
  const sampledElevations = new Map<string, number>();

  // Sample sparse grid
  for (let y = 0; y <= actualHeight; y += sampleInterval) {
    for (let x = 0; x <= actualWidth; x += sampleInterval) {
      const worldX = minX + x * actualResolution;
      const worldZ = minZ + y * actualResolution;
      const { lat, lng } = metersToLatLng(worldX, worldZ, centerLat, centerLng);

      const elevation = await getElevation(lat, lng);
      sampledElevations.set(`${x},${y}`, elevation);
    }
  }

  // Bilinear interpolation to fill the full grid
  let minElevation = Infinity;
  let maxElevation = -Infinity;

  for (let y = 0; y < actualHeight; y++) {
    for (let x = 0; x < actualWidth; x++) {
      // Find surrounding sample points
      const x0 = Math.floor(x / sampleInterval) * sampleInterval;
      const x1 = Math.min(x0 + sampleInterval, actualWidth);
      const y0 = Math.floor(y / sampleInterval) * sampleInterval;
      const y1 = Math.min(y0 + sampleInterval, actualHeight);

      // Get elevations at corners
      const e00 = sampledElevations.get(`${x0},${y0}`) || 0;
      const e10 = sampledElevations.get(`${x1},${y0}`) || e00;
      const e01 = sampledElevations.get(`${x0},${y1}`) || e00;
      const e11 = sampledElevations.get(`${x1},${y1}`) || e10;

      // Interpolate
      const fx = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
      const fy = y1 > y0 ? (y - y0) / (y1 - y0) : 0;

      const elevation =
        e00 * (1 - fx) * (1 - fy) +
        e10 * fx * (1 - fy) +
        e01 * (1 - fx) * fy +
        e11 * fx * fy;

      heightmap[y * actualWidth + x] = elevation;
      minElevation = Math.min(minElevation, elevation);
      maxElevation = Math.max(maxElevation, elevation);
    }
  }

  return {
    heightmap,
    width: actualWidth,
    height: actualHeight,
    resolution: actualResolution,
    minElevation,
    maxElevation,
  };
}

/**
 * Generate a simulated terrain based on run data when real elevation is not available
 * This creates a smooth terrain that follows the runs with realistic slopes
 */
export function generateSimulatedTerrain(
  runs: GameRun[],
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  resolution: number = 20
): TerrainData {
  const width = Math.ceil((bounds.maxX - bounds.minX) / resolution);
  const height = Math.ceil((bounds.maxZ - bounds.minZ) / resolution);
  const heightmap = new Float32Array(width * height);

  // Start with a base elevation and slope down
  const baseElevation = 2000; // meters
  const slopeAngle = 15 * Math.PI / 180; // 15 degrees average slope

  let minElevation = Infinity;
  let maxElevation = -Infinity;

  // Create terrain based on runs
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const worldX = bounds.minX + x * resolution;
      const worldZ = bounds.minZ + y * resolution;

      // Base elevation decreases as we go "down" (positive Z)
      let elevation = baseElevation - worldZ * Math.tan(slopeAngle);

      // Add some noise for natural variation
      const noise = Math.sin(x * 0.1) * Math.cos(y * 0.1) * 10 +
                   Math.sin(x * 0.05 + 1) * Math.cos(y * 0.07 + 2) * 20;
      elevation += noise;

      // Find distance to nearest run and adjust elevation
      let minDistToRun = Infinity;
      for (const run of runs) {
        for (const point of run.path) {
          const dist = Math.sqrt(
            Math.pow(worldX - point.x, 2) +
            Math.pow(worldZ - point.z, 2)
          );
          minDistToRun = Math.min(minDistToRun, dist);
        }
      }

      // Flatten near runs (they should be on the terrain)
      if (minDistToRun < 50) {
        // Smooth transition
        const blendFactor = minDistToRun / 50;
        elevation = elevation * blendFactor + (elevation - noise * 0.5) * (1 - blendFactor);
      }

      heightmap[y * width + x] = elevation;
      minElevation = Math.min(minElevation, elevation);
      maxElevation = Math.max(maxElevation, elevation);
    }
  }

  return {
    heightmap,
    width,
    height,
    resolution,
    minElevation,
    maxElevation,
  };
}

/**
 * Convert run geometry to game run with 3D path
 */
export async function convertRunToGameRun(
  run: RunData,
  centerLat: number,
  centerLng: number,
  getElevationFn?: (lat: number, lng: number) => Promise<number>
): Promise<GameRun> {
  let coordinates: Array<[number, number]> = [];
  let outerPolygonCoords: Array<[number, number]> | undefined;

  if (run.geometry.type === 'LineString') {
    coordinates = run.geometry.coordinates as Array<[number, number]>;
  } else if (run.geometry.type === 'Polygon') {
    // For polygon runs, use the outer ring as the outer polygon
    // and calculate a centerline
    outerPolygonCoords = run.geometry.coordinates[0] as Array<[number, number]>;
    coordinates = calculateCenterline(outerPolygonCoords);
  }

  // Convert coordinates to 3D path
  const path: Array<{ x: number; y: number; z: number }> = [];
  const widths: number[] = [];

  for (const [lng, lat] of coordinates) {
    const { x, z } = latLngToMeters(lat, lng, centerLat, centerLng);
    let y = 0;

    if (getElevationFn) {
      try {
        y = await getElevationFn(lat, lng);
      } catch {
        y = 2000 - z * 0.15; // Fallback: simulate slope
      }
    } else {
      y = 2000 - z * 0.15; // Simulate slope
    }

    path.push({ x, y, z });

    // Calculate width at this point (default or from polygon)
    if (outerPolygonCoords) {
      const width = calculateWidthAtPoint(lat, lng, outerPolygonCoords, centerLat, centerLng);
      widths.push(width);
    } else {
      // Default width based on difficulty
      const defaultWidth = getDefaultRunWidth(run.difficulty);
      widths.push(defaultWidth);
    }
  }

  // Convert outer polygon if available
  let outerPolygon: Array<{ x: number; y: number; z: number }> | undefined;
  if (outerPolygonCoords) {
    outerPolygon = [];
    for (const [lng, lat] of outerPolygonCoords) {
      const { x, z } = latLngToMeters(lat, lng, centerLat, centerLng);
      // Use interpolated elevation from path
      const y = interpolateElevation(x, z, path);
      outerPolygon.push({ x, y, z });
    }
  }

  // Calculate run statistics
  let length = 0;
  let totalSlope = 0;
  let maxSlope = 0;

  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    const dz = path[i].z - path[i - 1].z;
    const segmentLength = Math.sqrt(dx * dx + dz * dz);
    const slope = Math.abs(Math.atan2(dy, segmentLength) * 180 / Math.PI);

    length += Math.sqrt(dx * dx + dy * dy + dz * dz);
    totalSlope += slope * segmentLength;
    maxSlope = Math.max(maxSlope, slope);
  }

  const averageSlope = length > 0 ? totalSlope / length : 0;
  const averageWidth = widths.length > 0 ? widths.reduce((a, b) => a + b, 0) / widths.length : 30;

  // Calculate point value
  const difficultyMultiplier = run.difficulty ? POINT_MULTIPLIERS[run.difficulty] : 1;
  const lengthMultiplier = Math.sqrt(length / 100); // More points for longer runs
  const slopeMultiplier = 1 + (averageSlope / 45); // Steeper = more points
  const widthMultiplier = averageWidth / 30; // Wider runs need more passes but give more points

  const pointValue = Math.round(100 * difficultyMultiplier * lengthMultiplier * slopeMultiplier * widthMultiplier);

  return {
    id: run.id,
    name: run.name,
    difficulty: run.difficulty,
    path,
    widths,
    outerPolygon,
    length,
    averageWidth,
    averageSlope,
    maxSlope,
    pointValue,
  };
}

/**
 * Calculate a centerline from a polygon (for polygon runs)
 */
function calculateCenterline(polygon: Array<[number, number]>): Array<[number, number]> {
  // Simple approach: find top and bottom points, then create a path
  let minLat = Infinity, maxLat = -Infinity;
  let topPoint: [number, number] = polygon[0];
  let bottomPoint: [number, number] = polygon[0];

  for (const [lng, lat] of polygon) {
    if (lat > maxLat) {
      maxLat = lat;
      topPoint = [lng, lat];
    }
    if (lat < minLat) {
      minLat = lat;
      bottomPoint = [lng, lat];
    }
  }

  // Create a series of points from top to bottom
  const numPoints = Math.max(10, Math.ceil(polygon.length / 2));
  const centerline: Array<[number, number]> = [];

  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    // Interpolate position
    const lat = topPoint[1] + t * (bottomPoint[1] - topPoint[1]);

    // Find the center at this latitude by averaging left and right edge points
    let sumLng = 0;
    let count = 0;

    for (let j = 0; j < polygon.length - 1; j++) {
      const [lng1, lat1] = polygon[j];
      const [lng2, lat2] = polygon[j + 1];

      // Check if this edge crosses the current latitude
      if ((lat1 <= lat && lat <= lat2) || (lat2 <= lat && lat <= lat1)) {
        if (Math.abs(lat2 - lat1) > 0.00001) {
          const t2 = (lat - lat1) / (lat2 - lat1);
          const lng = lng1 + t2 * (lng2 - lng1);
          sumLng += lng;
          count++;
        }
      }
    }

    const centerLng = count > 0 ? sumLng / count : (topPoint[0] + bottomPoint[0]) / 2;
    centerline.push([centerLng, lat]);
  }

  return centerline;
}

/**
 * Calculate width at a specific point on a polygon run
 */
function calculateWidthAtPoint(
  lat: number,
  lng: number,
  polygon: Array<[number, number]>,
  centerLat: number,
  centerLng: number
): number {
  // Find intersections with the polygon at this latitude
  const intersections: number[] = [];

  for (let i = 0; i < polygon.length - 1; i++) {
    const [lng1, lat1] = polygon[i];
    const [lng2, lat2] = polygon[i + 1];

    if ((lat1 <= lat && lat <= lat2) || (lat2 <= lat && lat <= lat1)) {
      if (Math.abs(lat2 - lat1) > 0.00001) {
        const t = (lat - lat1) / (lat2 - lat1);
        const intersectLng = lng1 + t * (lng2 - lng1);
        intersections.push(intersectLng);
      }
    }
  }

  if (intersections.length >= 2) {
    intersections.sort((a, b) => a - b);
    const minLng = intersections[0];
    const maxLng = intersections[intersections.length - 1];

    // Convert to meters
    const { x: x1 } = latLngToMeters(lat, minLng, centerLat, centerLng);
    const { x: x2 } = latLngToMeters(lat, maxLng, centerLat, centerLng);

    return Math.abs(x2 - x1);
  }

  return 30; // Default width
}

/**
 * Get default run width based on difficulty
 */
function getDefaultRunWidth(difficulty: string | null): number {
  switch (difficulty) {
    case 'novice': return 40;
    case 'easy': return 35;
    case 'intermediate': return 25;
    case 'advanced': return 15;
    case 'expert': return 10;
    default: return 30;
  }
}

/**
 * Interpolate elevation from path points
 */
function interpolateElevation(
  x: number,
  z: number,
  path: Array<{ x: number; y: number; z: number }>
): number {
  let minDist = Infinity;
  let closestY = path[0]?.y || 0;

  for (const point of path) {
    const dist = Math.sqrt(Math.pow(x - point.x, 2) + Math.pow(z - point.z, 2));
    if (dist < minDist) {
      minDist = dist;
      closestY = point.y;
    }
  }

  return closestY;
}

/**
 * Convert lift geometry to game lift
 */
export async function convertLiftToGameLift(
  lift: LiftData,
  centerLat: number,
  centerLng: number,
  getElevationFn?: (lat: number, lng: number) => Promise<number>
): Promise<GameLift> {
  const path: Array<{ x: number; y: number; z: number }> = [];
  const pylons: Array<{ x: number; y: number; z: number }> = [];

  for (const coord of lift.geometry.coordinates) {
    const [lng, lat] = coord as [number, number];
    const { x, z } = latLngToMeters(lat, lng, centerLat, centerLng);

    let y = 0;
    if (getElevationFn) {
      try {
        y = await getElevationFn(lat, lng);
      } catch {
        y = 2000 - z * 0.15;
      }
    } else {
      y = 2000 - z * 0.15;
    }

    path.push({ x, y: y + 8, z }); // Lift cables are above ground
  }

  // Generate pylons along the lift
  const numPylons = Math.max(2, Math.ceil(path.length / 3));
  for (let i = 0; i < numPylons; i++) {
    const t = i / (numPylons - 1);
    const index = Math.min(Math.floor(t * (path.length - 1)), path.length - 1);
    pylons.push({ ...path[index], y: path[index].y - 5 }); // Pylon base on ground
  }

  return {
    id: lift.id,
    name: lift.name,
    liftType: lift.liftType,
    path,
    pylons,
  };
}

/**
 * Fetch OSM buildings within bounds
 */
export async function fetchOSMBuildings(bounds: BoundingBox): Promise<GameBuilding[]> {
  const buildings: GameBuilding[] = [];
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;

  // Overpass API query for buildings
  const query = `
    [out:json][timeout:25];
    (
      way["building"]["building"~"restaurant|cafe|alpine_hut|cabin|hotel|chalet|shelter"]
        (${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng});
      node["amenity"~"restaurant|cafe|shelter"]
        (${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng});
    );
    out center;
  `;

  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!response.ok) return buildings;

    const data = await response.json();

    for (const element of data.elements || []) {
      const lat = element.lat || element.center?.lat;
      const lng = element.lon || element.center?.lon;

      if (!lat || !lng) continue;

      const { x, z } = latLngToMeters(lat, lng, centerLat, centerLng);

      const buildingType = element.tags?.building || element.tags?.amenity || 'other';
      const type = (['restaurant', 'cafe', 'alpine_hut', 'cabin', 'hotel', 'chalet', 'shelter'].includes(buildingType))
        ? (buildingType === 'cafe' ? 'restaurant' : buildingType === 'alpine_hut' || buildingType === 'chalet' || buildingType === 'shelter' ? 'cabin' : buildingType as 'restaurant' | 'hotel' | 'cabin')
        : 'other';

      buildings.push({
        id: `osm-${element.id}`,
        name: element.tags?.name || null,
        type: type as 'restaurant' | 'hotel' | 'cabin' | 'other',
        position: { x, y: 2000 - z * 0.15, z }, // Approximate elevation
        dimensions: {
          width: 15 + Math.random() * 10,
          depth: 15 + Math.random() * 10,
          height: 5 + Math.random() * 8,
        },
        rotation: Math.random() * Math.PI * 2,
      });
    }
  } catch {
    // Ignore fetch errors
  }

  return buildings;
}

/**
 * Generate trees near but not on runs - OPTIMIZED for performance
 * Uses spatial grid for faster collision detection and limits total trees
 */
export function generateTrees(
  runs: GameRun[],
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  terrain: TerrainData
): GameTree[] {
  const trees: GameTree[] = [];
  const treeTypes: Array<'pine' | 'fir' | 'spruce'> = ['pine', 'fir', 'spruce'];
  const MAX_TREES = 200; // Hard limit for performance

  // Simple seeded random for reproducibility
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  // Use a spatial grid for faster run collision detection
  const gridSize = 50; // 50m grid cells
  const gridWidth = Math.ceil((bounds.maxX - bounds.minX) / gridSize);
  const gridHeight = Math.ceil((bounds.maxZ - bounds.minZ) / gridSize);
  const runGrid = new Set<number>();

  // Mark grid cells that contain runs (with buffer)
  for (const run of runs) {
    for (let i = 0; i < run.path.length; i++) {
      const point = run.path[i];
      const width = run.widths[i] || run.averageWidth;
      const buffer = width / 2 + 15;

      // Mark surrounding cells
      const minGX = Math.max(0, Math.floor((point.x - buffer - bounds.minX) / gridSize));
      const maxGX = Math.min(gridWidth - 1, Math.floor((point.x + buffer - bounds.minX) / gridSize));
      const minGZ = Math.max(0, Math.floor((point.z - buffer - bounds.minZ) / gridSize));
      const maxGZ = Math.min(gridHeight - 1, Math.floor((point.z + buffer - bounds.minZ) / gridSize));

      for (let gx = minGX; gx <= maxGX; gx++) {
        for (let gz = minGZ; gz <= maxGZ; gz++) {
          runGrid.add(gz * gridWidth + gx);
        }
      }
    }
  }

  // Generate trees in clusters along run edges - sparser for performance
  for (const run of runs) {
    if (trees.length >= MAX_TREES) break;

    // Place tree clusters less frequently (every 5th path point instead of 3rd)
    for (let i = 0; i < run.path.length - 1; i += 5) {
      if (trees.length >= MAX_TREES) break;

      const point = run.path[i];
      const width = run.widths[i] || run.averageWidth;

      // Get direction perpendicular to the run
      const nextPoint = run.path[i + 1];
      const dx = nextPoint.x - point.x;
      const dz = nextPoint.z - point.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len === 0) continue;

      // Perpendicular vector (normalized)
      const perpX = -dz / len;
      const perpZ = dx / len;

      // Place trees on both sides of the run
      for (const side of [-1, 1]) {
        if (trees.length >= MAX_TREES) break;

        const numTrees = Math.floor(random() * 2) + 1; // 1-2 trees per cluster (reduced)

        for (let t = 0; t < numTrees; t++) {
          if (trees.length >= MAX_TREES) break;

          // Distance from run center (beyond the run width plus buffer)
          const baseOffset = (width / 2) + 20 + random() * 40; // 20-60m from run edge
          const lateralOffset = (random() - 0.5) * 15;

          const treeX = point.x + perpX * side * baseOffset + dx / len * lateralOffset;
          const treeZ = point.z + perpZ * side * baseOffset + dz / len * lateralOffset;

          // Check if within bounds
          if (treeX < bounds.minX + 20 || treeX > bounds.maxX - 20 ||
              treeZ < bounds.minZ + 20 || treeZ > bounds.maxZ - 20) {
            continue;
          }

          // Fast grid-based run collision check
          const gx = Math.floor((treeX - bounds.minX) / gridSize);
          const gz = Math.floor((treeZ - bounds.minZ) / gridSize);
          if (runGrid.has(gz * gridWidth + gx)) {
            continue; // Skip trees in or near run grid cells
          }

          // Get elevation from terrain
          const tx = Math.floor((treeX - bounds.minX) / terrain.resolution);
          const tz = Math.floor((treeZ - bounds.minZ) / terrain.resolution);
          const heightIndex = tz * terrain.width + tx;
          const treeY = terrain.heightmap[heightIndex] || terrain.minElevation;

          // Random tree properties
          const height = 8 + random() * 12; // 8-20m tall
          const radius = height * 0.25 + random() * 1;
          const type = treeTypes[Math.floor(random() * treeTypes.length)];

          trees.push({
            position: { x: treeX, y: treeY, z: treeZ },
            height,
            radius,
            type,
          });
        }
      }
    }
  }

  return trees;
}

/**
 * Generate the complete game world from ski area data
 */
export async function generateGameWorld(
  runs: RunData[],
  lifts: LiftData[],
  bounds: BoundingBox,
  options: {
    useRealElevation?: boolean;
    fetchBuildings?: boolean;
  } = {}
): Promise<GameWorld> {
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;

  // Convert runs
  const gameRuns: GameRun[] = [];
  for (const run of runs) {
    const gameRun = await convertRunToGameRun(
      run,
      centerLat,
      centerLng,
      options.useRealElevation ? getElevation : undefined
    );
    gameRuns.push(gameRun);
  }

  // Convert lifts
  const gameLifts: GameLift[] = [];
  for (const lift of lifts) {
    const gameLift = await convertLiftToGameLift(
      lift,
      centerLat,
      centerLng,
      options.useRealElevation ? getElevation : undefined
    );
    gameLifts.push(gameLift);
  }

  // Calculate world bounds
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const run of gameRuns) {
    for (const point of run.path) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
  }

  // Add padding
  const padding = 200;
  minX -= padding;
  maxX += padding;
  minZ -= padding;
  maxZ += padding;

  // Generate terrain
  const terrain = generateSimulatedTerrain(
    gameRuns,
    { minX, maxX, minZ, maxZ },
    25
  );

  // Fetch buildings if requested
  let buildings: GameBuilding[] = [];
  if (options.fetchBuildings) {
    buildings = await fetchOSMBuildings(bounds);
  }

  // Generate trees near but not on runs
  const trees = generateTrees(gameRuns, { minX, maxX, minZ, maxZ }, terrain);

  return {
    runs: gameRuns,
    lifts: gameLifts,
    buildings,
    trees,
    terrain,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
  };
}

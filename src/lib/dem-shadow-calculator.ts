/**
 * DEM Shadow Calculator
 *
 * Computes terrain shadows using MapTiler terrain-RGB tiles.
 * Uses ray casting to determine which areas are in shadow based on sun position.
 */

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || '';

/**
 * Quality levels affect the DEM tile zoom level used
 * Higher zoom = more detail but more tiles to fetch
 */
export type ShadowQuality = 'low' | 'medium' | 'high';

const QUALITY_ZOOM: Record<ShadowQuality, number> = {
  low: 10,
  medium: 12,
  high: 13,
};

/**
 * Result of shadow computation
 */
export interface ShadowComputeResult {
  /** Base64 encoded PNG image */
  imageDataUrl: string;
  /** Bounds for positioning the overlay [west, south, east, north] */
  bounds: [number, number, number, number];
  /** Time taken to compute in ms */
  computeTime: number;
  /** Number of tiles fetched */
  tileCount: number;
}

/**
 * Bounds in lng/lat
 */
export interface LngLatBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Convert lng/lat to tile coordinates
 */
function lngLatToTile(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const x = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
  return { x, y };
}

/**
 * Convert tile coordinates to lng/lat bounds
 */
function tileToBounds(x: number, y: number, zoom: number): LngLatBounds {
  const n = Math.pow(2, zoom);
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const northRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const southRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  const north = (northRad * 180) / Math.PI;
  const south = (southRad * 180) / Math.PI;
  return { west, south, east, north };
}

/**
 * Decode elevation from terrain-RGB pixel
 * MapTiler terrain-RGB formula: elevation = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
 */
function decodeElevation(r: number, g: number, b: number): number {
  return -10000 + (r * 256 * 256 + g * 256 + b) * 0.1;
}

/**
 * Fetch a terrain tile and return elevation data
 */
async function fetchTerrainTile(
  x: number,
  y: number,
  zoom: number
): Promise<Float32Array | null> {
  const url = `https://api.maptiler.com/tiles/terrain-rgb-v2/${zoom}/${x}/${y}.webp?key=${MAPTILER_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);

    // Create canvas to read pixel data
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(imageBitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, imageBitmap.width, imageBitmap.height);
    const pixels = imageData.data;

    // Convert to elevation array
    const elevations = new Float32Array(imageBitmap.width * imageBitmap.height);
    for (let i = 0; i < elevations.length; i++) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      elevations[i] = decodeElevation(r, g, b);
    }

    return elevations;
  } catch (error) {
    console.error(`[DEMShadow] Failed to fetch tile ${zoom}/${x}/${y}:`, error);
    return null;
  }
}

/**
 * Main shadow computation function
 */
export async function computeTerrainShadows(
  bounds: LngLatBounds,
  sunAzimuth: number,
  sunAltitude: number,
  quality: ShadowQuality = 'medium',
  onProgress?: (progress: number) => void
): Promise<ShadowComputeResult | null> {
  const startTime = performance.now();
  const zoom = QUALITY_ZOOM[quality];

  // Don't compute shadows if sun is below horizon or very high
  if (sunAltitude <= 0) {
    return null; // Night time - everything in shadow
  }
  if (sunAltitude > 75) {
    return null; // Sun nearly overhead - minimal shadows
  }

  // Calculate which tiles we need
  const topLeft = lngLatToTile(bounds.west, bounds.north, zoom);
  const bottomRight = lngLatToTile(bounds.east, bounds.south, zoom);

  const tilesX = bottomRight.x - topLeft.x + 1;
  const tilesY = bottomRight.y - topLeft.y + 1;
  const totalTiles = tilesX * tilesY;

  // Limit tile count for performance
  if (totalTiles > 25) {
    console.warn(`[DEMShadow] Too many tiles (${totalTiles}), reducing quality`);
    // Try with lower zoom
    const lowerQuality = quality === 'high' ? 'medium' : 'low';
    return computeTerrainShadows(bounds, sunAzimuth, sunAltitude, lowerQuality, onProgress);
  }

  // Fetch all tiles
  const tileSize = 256;
  const totalWidth = tilesX * tileSize;
  const totalHeight = tilesY * tileSize;
  const elevationGrid = new Float32Array(totalWidth * totalHeight);

  let fetchedTiles = 0;
  const fetchPromises: Promise<void>[] = [];

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tileX = topLeft.x + tx;
      const tileY = topLeft.y + ty;

      fetchPromises.push(
        fetchTerrainTile(tileX, tileY, zoom).then((elevations) => {
          if (elevations) {
            // Copy tile data into the grid
            for (let py = 0; py < tileSize; py++) {
              for (let px = 0; px < tileSize; px++) {
                const gridX = tx * tileSize + px;
                const gridY = ty * tileSize + py;
                const gridIdx = gridY * totalWidth + gridX;
                const tileIdx = py * tileSize + px;
                elevationGrid[gridIdx] = elevations[tileIdx];
              }
            }
          }
          fetchedTiles++;
          onProgress?.(fetchedTiles / totalTiles * 0.5); // First 50% is fetching
        })
      );
    }
  }

  await Promise.all(fetchPromises);

  // Calculate the actual bounds covered by our tiles
  const actualTopLeft = tileToBounds(topLeft.x, topLeft.y, zoom);
  const actualBottomRight = tileToBounds(bottomRight.x + 1, bottomRight.y + 1, zoom);
  const actualBounds: LngLatBounds = {
    west: actualTopLeft.west,
    north: actualTopLeft.north,
    east: actualBottomRight.east,
    south: actualBottomRight.south,
  };

  // Calculate meters per pixel (approximate at center latitude)
  const centerLat = (actualBounds.north + actualBounds.south) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const degreesPerPixelX = (actualBounds.east - actualBounds.west) / totalWidth;
  const degreesPerPixelY = (actualBounds.north - actualBounds.south) / totalHeight;
  const metersPerPixelX = degreesPerPixelX * metersPerDegLng;
  const metersPerPixelY = degreesPerPixelY * metersPerDegLat;
  const metersPerPixel = (metersPerPixelX + metersPerPixelY) / 2;

  // Compute shadows using ray casting
  const shadowMask = new Uint8Array(totalWidth * totalHeight);

  // Convert sun position to direction vector
  const sunAzimuthRad = (sunAzimuth * Math.PI) / 180;
  const sunAltitudeRad = (sunAltitude * Math.PI) / 180;

  // Direction TO the sun (we'll march in this direction)
  const sunDirX = Math.sin(sunAzimuthRad);
  const sunDirY = -Math.cos(sunAzimuthRad); // Negative because Y increases downward in image
  const sunTanAlt = Math.tan(sunAltitudeRad);

  // Ray march settings
  const maxMarchDistance = 5000; // meters
  const stepSize = metersPerPixel * 2; // Step 2 pixels at a time for speed

  for (let y = 0; y < totalHeight; y++) {
    for (let x = 0; x < totalWidth; x++) {
      const idx = y * totalWidth + x;
      const baseElevation = elevationGrid[idx];

      // Skip if no elevation data
      if (baseElevation < -9000) {
        shadowMask[idx] = 0;
        continue;
      }

      // March toward the sun
      let inShadow = false;
      let distance = stepSize;

      while (distance < maxMarchDistance) {
        // Calculate position along ray
        const sampleX = x + (sunDirX * distance) / metersPerPixel;
        const sampleY = y + (sunDirY * distance) / metersPerPixel;

        // Check bounds
        if (sampleX < 0 || sampleX >= totalWidth || sampleY < 0 || sampleY >= totalHeight) {
          break;
        }

        // Get elevation at sample point (bilinear interpolation)
        const sx = Math.floor(sampleX);
        const sy = Math.floor(sampleY);
        const sampleIdx = sy * totalWidth + sx;
        const terrainElevation = elevationGrid[sampleIdx];

        // Calculate expected elevation along sun ray
        const expectedElevation = baseElevation + distance * sunTanAlt;

        // If terrain is higher than the ray, we're in shadow
        if (terrainElevation > expectedElevation + 5) {
          // +5m tolerance
          inShadow = true;
          break;
        }

        distance += stepSize;
      }

      shadowMask[idx] = inShadow ? 255 : 0;
    }

    // Progress update (50-100% is computation)
    if (y % 50 === 0) {
      onProgress?.(0.5 + (y / totalHeight) * 0.5);
    }
  }

  // Create shadow image
  const canvas = new OffscreenCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const imageData = ctx.createImageData(totalWidth, totalHeight);
  for (let i = 0; i < shadowMask.length; i++) {
    const alpha = shadowMask[i];
    imageData.data[i * 4] = 0; // R
    imageData.data[i * 4 + 1] = 0; // G
    imageData.data[i * 4 + 2] = 30; // B (slight blue tint for shadows)
    imageData.data[i * 4 + 3] = alpha; // A
  }
  ctx.putImageData(imageData, 0, 0);

  // Convert to data URL
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const imageDataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });

  const computeTime = performance.now() - startTime;

  return {
    imageDataUrl,
    bounds: [actualBounds.west, actualBounds.south, actualBounds.east, actualBounds.north],
    computeTime,
    tileCount: totalTiles,
  };
}

/**
 * Cache for shadow computations
 */
const shadowCache = new Map<string, ShadowComputeResult>();

/**
 * Generate cache key from parameters
 */
function getCacheKey(
  bounds: LngLatBounds,
  sunAzimuth: number,
  sunAltitude: number,
  quality: ShadowQuality
): string {
  // Round values to allow for cache hits with slight variations
  const roundedAzimuth = Math.round(sunAzimuth / 5) * 5; // 5 degree increments
  const roundedAltitude = Math.round(sunAltitude / 5) * 5;
  const roundedBounds = {
    west: Math.round(bounds.west * 100) / 100,
    south: Math.round(bounds.south * 100) / 100,
    east: Math.round(bounds.east * 100) / 100,
    north: Math.round(bounds.north * 100) / 100,
  };
  return `${JSON.stringify(roundedBounds)}_${roundedAzimuth}_${roundedAltitude}_${quality}`;
}

/**
 * Compute shadows with caching
 */
export async function computeTerrainShadowsCached(
  bounds: LngLatBounds,
  sunAzimuth: number,
  sunAltitude: number,
  quality: ShadowQuality = 'medium',
  onProgress?: (progress: number) => void
): Promise<ShadowComputeResult | null> {
  const cacheKey = getCacheKey(bounds, sunAzimuth, sunAltitude, quality);

  // Check cache
  const cached = shadowCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Compute new result
  const result = await computeTerrainShadows(bounds, sunAzimuth, sunAltitude, quality, onProgress);

  // Cache result
  if (result) {
    shadowCache.set(cacheKey, result);

    // Limit cache size
    if (shadowCache.size > 20) {
      const firstKey = shadowCache.keys().next().value;
      if (firstKey) {
        shadowCache.delete(firstKey);
      }
    }
  }

  return result;
}

/**
 * Clear the shadow cache
 */
export function clearShadowCache(): void {
  shadowCache.clear();
}

/**
 * DEM Shadow Calculator
 *
 * Computes terrain shadows using MapTiler terrain-RGB tiles.
 * Uses ray casting to determine which areas are in shadow based on sun position.
 */

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || '';

// Fixed high quality zoom level - no user option
const SHADOW_ZOOM = 14;

// Number of buffer tiles to fetch around the visible area for ray marching
const BUFFER_TILES = 2;

// Maximum tiles to fetch (including buffer) - prevents excessive API usage
const MAX_TILES = 64;

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

// Tile cache to avoid re-fetching
const tileCache = new Map<string, Float32Array>();

/**
 * Fetch a terrain tile and return elevation data
 */
async function fetchTerrainTile(
  x: number,
  y: number,
  zoom: number
): Promise<Float32Array | null> {
  const cacheKey = `${zoom}/${x}/${y}`;

  // Check cache first
  const cached = tileCache.get(cacheKey);
  if (cached) {
    return cached;
  }

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

    // Cache the result
    tileCache.set(cacheKey, elevations);

    // Limit cache size
    if (tileCache.size > 100) {
      const firstKey = tileCache.keys().next().value;
      if (firstKey) tileCache.delete(firstKey);
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
  onProgress?: (progress: number) => void
): Promise<ShadowComputeResult | null> {
  const startTime = performance.now();
  const zoom = SHADOW_ZOOM;

  // Don't compute shadows if sun is below horizon or very high
  if (sunAltitude <= 0) {
    return null; // Night time - everything in shadow
  }
  if (sunAltitude > 75) {
    return null; // Sun nearly overhead - minimal shadows
  }

  // Calculate which tiles we need for the visible area
  const visibleTopLeft = lngLatToTile(bounds.west, bounds.north, zoom);
  const visibleBottomRight = lngLatToTile(bounds.east, bounds.south, zoom);

  // Add buffer tiles for ray marching (shadows can be cast from outside visible area)
  const topLeft = {
    x: visibleTopLeft.x - BUFFER_TILES,
    y: visibleTopLeft.y - BUFFER_TILES,
  };
  const bottomRight = {
    x: visibleBottomRight.x + BUFFER_TILES,
    y: visibleBottomRight.y + BUFFER_TILES,
  };

  const tilesX = bottomRight.x - topLeft.x + 1;
  const tilesY = bottomRight.y - topLeft.y + 1;
  const totalTiles = tilesX * tilesY;

  // Limit tile count to prevent excessive API usage
  if (totalTiles > MAX_TILES) {
    console.warn(`[DEMShadow] Too many tiles (${totalTiles}), skipping shadow computation`);
    return null;
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
          onProgress?.(fetchedTiles / totalTiles * 0.4); // First 40% is fetching
        })
      );
    }
  }

  await Promise.all(fetchPromises);

  // Calculate the actual bounds covered by our tiles (including buffer)
  const actualTopLeft = tileToBounds(topLeft.x, topLeft.y, zoom);
  const actualBottomRight = tileToBounds(bottomRight.x + 1, bottomRight.y + 1, zoom);

  // Calculate the visible bounds (without buffer) for the output image
  const outputTopLeft = tileToBounds(visibleTopLeft.x, visibleTopLeft.y, zoom);
  const outputBottomRight = tileToBounds(visibleBottomRight.x + 1, visibleBottomRight.y + 1, zoom);
  const outputBounds: LngLatBounds = {
    west: outputTopLeft.west,
    north: outputTopLeft.north,
    east: outputBottomRight.east,
    south: outputBottomRight.south,
  };

  // Calculate output dimensions (just the visible tiles, no buffer)
  const outputTilesX = visibleBottomRight.x - visibleTopLeft.x + 1;
  const outputTilesY = visibleBottomRight.y - visibleTopLeft.y + 1;
  const outputWidth = outputTilesX * tileSize;
  const outputHeight = outputTilesY * tileSize;

  // Offset of visible area within the full grid (in pixels)
  const visibleOffsetX = BUFFER_TILES * tileSize;
  const visibleOffsetY = BUFFER_TILES * tileSize;

  // Calculate meters per pixel (approximate at center latitude)
  const centerLat = (actualTopLeft.north + actualBottomRight.south) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const degreesPerPixelX = (actualBottomRight.east - actualTopLeft.west) / totalWidth;
  const degreesPerPixelY = (actualTopLeft.north - actualBottomRight.south) / totalHeight;
  const metersPerPixelX = degreesPerPixelX * metersPerDegLng;
  const metersPerPixelY = degreesPerPixelY * metersPerDegLat;
  const metersPerPixel = (metersPerPixelX + metersPerPixelY) / 2;

  // Compute shadows using ray casting - only for the visible area
  const shadowMask = new Uint8Array(outputWidth * outputHeight);

  // Convert sun position to direction vector
  const sunAzimuthRad = (sunAzimuth * Math.PI) / 180;
  const sunAltitudeRad = (sunAltitude * Math.PI) / 180;

  // Direction TO the sun (we'll march in this direction)
  const sunDirX = Math.sin(sunAzimuthRad);
  const sunDirY = -Math.cos(sunAzimuthRad); // Negative because Y increases downward in image
  const sunTanAlt = Math.tan(sunAltitudeRad);

  // Ray march settings - use finer steps to avoid stripes
  const maxMarchDistance = 8000; // meters - longer distance for better shadow casting
  const stepSize = metersPerPixel; // Step 1 pixel at a time for quality

  for (let oy = 0; oy < outputHeight; oy++) {
    for (let ox = 0; ox < outputWidth; ox++) {
      // Convert output coordinates to full grid coordinates
      const x = ox + visibleOffsetX;
      const y = oy + visibleOffsetY;

      const idx = y * totalWidth + x;
      const baseElevation = elevationGrid[idx];

      // Skip if no elevation data
      if (baseElevation < -9000) {
        shadowMask[oy * outputWidth + ox] = 0;
        continue;
      }

      // March toward the sun
      let inShadow = false;
      let distance = stepSize;

      while (distance < maxMarchDistance) {
        // Calculate position along ray (in full grid coordinates)
        const sampleX = x + (sunDirX * distance) / metersPerPixel;
        const sampleY = y + (sunDirY * distance) / metersPerPixel;

        // Check bounds (against full grid including buffer)
        if (sampleX < 0 || sampleX >= totalWidth || sampleY < 0 || sampleY >= totalHeight) {
          break;
        }

        // Get elevation at sample point using bilinear interpolation
        const sx = Math.floor(sampleX);
        const sy = Math.floor(sampleY);
        const fx = sampleX - sx;
        const fy = sampleY - sy;

        // Bilinear interpolation for smoother results
        const idx00 = sy * totalWidth + sx;
        const idx10 = sy * totalWidth + Math.min(sx + 1, totalWidth - 1);
        const idx01 = Math.min(sy + 1, totalHeight - 1) * totalWidth + sx;
        const idx11 = Math.min(sy + 1, totalHeight - 1) * totalWidth + Math.min(sx + 1, totalWidth - 1);

        const e00 = elevationGrid[idx00];
        const e10 = elevationGrid[idx10];
        const e01 = elevationGrid[idx01];
        const e11 = elevationGrid[idx11];

        const terrainElevation =
          e00 * (1 - fx) * (1 - fy) +
          e10 * fx * (1 - fy) +
          e01 * (1 - fx) * fy +
          e11 * fx * fy;

        // Calculate expected elevation along sun ray
        const expectedElevation = baseElevation + distance * sunTanAlt;

        // If terrain is higher than the ray, we're in shadow
        if (terrainElevation > expectedElevation + 3) {
          // +3m tolerance (reduced for more accuracy)
          inShadow = true;
          break;
        }

        // Adaptive step size - larger steps when far from terrain
        const elevationDiff = expectedElevation - terrainElevation;
        if (elevationDiff > 100) {
          distance += stepSize * 3; // Faster steps when well above terrain
        } else if (elevationDiff > 50) {
          distance += stepSize * 2;
        } else {
          distance += stepSize;
        }
      }

      shadowMask[oy * outputWidth + ox] = inShadow ? 255 : 0;
    }

    // Progress update (40-90% is computation)
    if (oy % 32 === 0) {
      onProgress?.(0.4 + (oy / outputHeight) * 0.5);
    }
  }

  // Apply a light blur to smooth the shadow edges
  const blurredMask = applyGaussianBlur(shadowMask, outputWidth, outputHeight);

  // Create shadow image
  const canvas = new OffscreenCanvas(outputWidth, outputHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const imageData = ctx.createImageData(outputWidth, outputHeight);
  for (let i = 0; i < blurredMask.length; i++) {
    const alpha = blurredMask[i];
    imageData.data[i * 4] = 0; // R
    imageData.data[i * 4 + 1] = 0; // G
    imageData.data[i * 4 + 2] = 40; // B (slight blue tint for shadows)
    imageData.data[i * 4 + 3] = alpha; // A
  }
  ctx.putImageData(imageData, 0, 0);

  onProgress?.(0.95);

  // Convert to data URL
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const imageDataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });

  const computeTime = performance.now() - startTime;

  onProgress?.(1);

  return {
    imageDataUrl,
    bounds: [outputBounds.west, outputBounds.south, outputBounds.east, outputBounds.north],
    computeTime,
    tileCount: totalTiles,
  };
}

/**
 * Apply a simple box blur to smooth shadow edges
 */
function applyGaussianBlur(mask: Uint8Array, width: number, height: number): Uint8Array {
  const result = new Uint8Array(mask.length);
  const radius = 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;

          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            sum += mask[ny * width + nx];
            count++;
          }
        }
      }

      result[y * width + x] = Math.round(sum / count);
    }
  }

  return result;
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
  sunAltitude: number
): string {
  // Round values to allow for cache hits with slight variations
  const roundedAzimuth = Math.round(sunAzimuth / 3) * 3; // 3 degree increments
  const roundedAltitude = Math.round(sunAltitude / 3) * 3;
  const roundedBounds = {
    west: Math.round(bounds.west * 100) / 100,
    south: Math.round(bounds.south * 100) / 100,
    east: Math.round(bounds.east * 100) / 100,
    north: Math.round(bounds.north * 100) / 100,
  };
  return `${JSON.stringify(roundedBounds)}_${roundedAzimuth}_${roundedAltitude}`;
}

/**
 * Compute shadows with caching
 */
export async function computeTerrainShadowsCached(
  bounds: LngLatBounds,
  sunAzimuth: number,
  sunAltitude: number,
  onProgress?: (progress: number) => void
): Promise<ShadowComputeResult | null> {
  const cacheKey = getCacheKey(bounds, sunAzimuth, sunAltitude);

  // Check cache
  const cached = shadowCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Compute new result
  const result = await computeTerrainShadows(bounds, sunAzimuth, sunAltitude, onProgress);

  // Cache result
  if (result) {
    shadowCache.set(cacheKey, result);

    // Limit cache size
    if (shadowCache.size > 30) {
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

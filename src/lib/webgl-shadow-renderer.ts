/**
 * WebGL-based Terrain Shadow Renderer
 *
 * Uses GPU ray marching to compute terrain shadows efficiently.
 * This approach is much faster than CPU-based ray casting because
 * the GPU can process millions of pixels in parallel.
 */

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || '';

// Vertex shader - just passes through coordinates
const VERTEX_SHADER = `
  attribute vec2 a_position;
  varying vec2 v_texCoord;

  void main() {
    v_texCoord = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

// Fragment shader - performs ray marching toward sun
const FRAGMENT_SHADER = `
  precision highp float;

  uniform sampler2D u_elevation;
  uniform vec2 u_sunDir;        // Normalized direction toward sun (x, y in texture space)
  uniform float u_sunTanAlt;    // tan(sun altitude angle)
  uniform vec2 u_texelSize;     // 1.0 / texture dimensions (full grid including buffer)
  uniform float u_metersPerPixel;
  uniform vec2 u_textureOffset; // Offset into texture for visible area (accounts for buffer tiles)
  uniform vec2 u_textureScale;  // Scale factor to map visible area to full texture

  varying vec2 v_texCoord;

  // Decode elevation from terrain-RGB (MapTiler format)
  float decodeElevation(vec4 color) {
    return -10000.0 + (color.r * 256.0 * 256.0 + color.g * 256.0 + color.b) * 255.0 * 0.1;
  }

  // Calculate edge fade factor (0 at edges, 1 in center)
  float getEdgeFade(vec2 coord) {
    // Fade over 5% of the texture at each edge
    float fadeWidth = 0.05;

    float fadeLeft = smoothstep(0.0, fadeWidth, coord.x);
    float fadeRight = smoothstep(0.0, fadeWidth, 1.0 - coord.x);
    float fadeTop = smoothstep(0.0, fadeWidth, coord.y);
    float fadeBottom = smoothstep(0.0, fadeWidth, 1.0 - coord.y);

    return fadeLeft * fadeRight * fadeTop * fadeBottom;
  }

  void main() {
    // Map output texture coords (0-1) to position in full elevation texture
    // This accounts for the buffer tiles around the visible area
    vec2 elevTexCoord = u_textureOffset + v_texCoord * u_textureScale;

    // Get base elevation at current pixel
    vec4 baseColor = texture2D(u_elevation, elevTexCoord);
    float baseElevation = decodeElevation(baseColor);

    // Calculate edge fade for smooth blending at borders
    float edgeFade = getEdgeFade(v_texCoord);

    // Skip if no valid elevation data
    if (baseElevation < -9000.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
      return;
    }

    // Ray march toward the sun
    float stepSize = 1.5; // pixels per step (slightly more than 1 for performance)
    float maxSteps = 500.0;
    float maxDistance = 8000.0; // meters

    vec2 pos = elevTexCoord;
    float distance = 0.0;
    bool inShadow = false;

    for (float i = 0.0; i < 500.0; i++) {
      if (i >= maxSteps) break;

      distance += stepSize * u_metersPerPixel;
      if (distance >= maxDistance) break;

      // Move along sun direction in texture space
      pos += u_sunDir * u_texelSize * stepSize;

      // Check bounds (entire texture, including buffer for shadow casting)
      if (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) {
        break;
      }

      // Sample terrain elevation at this position
      vec4 sampleColor = texture2D(u_elevation, pos);
      float terrainElevation = decodeElevation(sampleColor);

      // Calculate expected elevation along sun ray
      float expectedElevation = baseElevation + distance * u_sunTanAlt;

      // If terrain is higher than the ray, we're in shadow
      if (terrainElevation > expectedElevation + 5.0) { // 5m tolerance
        inShadow = true;
        break;
      }
    }

    // Output shadow color with alpha, applying edge fade
    if (inShadow) {
      gl_FragColor = vec4(0.0, 0.0, 0.15, 0.6 * edgeFade); // Dark blue shadow with edge fade
    } else {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); // Transparent (no shadow)
    }
  }
`;

interface TileCoord {
  x: number;
  y: number;
  z: number;
}

interface ShadowResult {
  canvas: HTMLCanvasElement;
  bounds: [number, number, number, number]; // [west, south, east, north]
}

/**
 * Convert lng/lat to tile coordinates
 */
function lngLatToTile(lng: number, lat: number, zoom: number): TileCoord {
  const x = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
  return { x, y, z: zoom };
}

/**
 * Convert tile coordinates to lng/lat bounds
 */
function tileToBounds(x: number, y: number, zoom: number): { west: number; south: number; east: number; north: number } {
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
 * WebGL Shadow Renderer class
 */
export class WebGLShadowRenderer {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private canvas: HTMLCanvasElement;
  private tileCache: Map<string, HTMLImageElement> = new Map();
  private pendingTiles: Map<string, Promise<HTMLImageElement | null>> = new Map();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.initWebGL();
  }

  private initWebGL(): void {
    const gl = this.canvas.getContext('webgl', {
      antialias: false,
      depth: false,
      stencil: false,
      alpha: true,
      premultipliedAlpha: false,
    });

    if (!gl) {
      console.error('[WebGLShadow] WebGL not supported');
      return;
    }

    this.gl = gl;

    // Create shaders
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

    if (!vertexShader || !fragmentShader) {
      console.error('[WebGLShadow] Failed to compile shaders');
      return;
    }

    // Create program
    const program = gl.createProgram();
    if (!program) {
      console.error('[WebGLShadow] Failed to create program');
      return;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[WebGLShadow] Program link error:', gl.getProgramInfoLog(program));
      return;
    }

    this.program = program;

    // Create vertex buffer for full-screen quad
    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl;
    if (!gl) return null;

    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[WebGLShadow] Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  /**
   * Fetch a terrain tile image
   */
  private async fetchTile(x: number, y: number, z: number): Promise<HTMLImageElement | null> {
    const key = `${z}/${x}/${y}`;

    // Check cache
    const cached = this.tileCache.get(key);
    if (cached) return cached;

    // Check pending
    const pending = this.pendingTiles.get(key);
    if (pending) return pending;

    // Fetch tile
    const promise = new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.tileCache.set(key, img);
        this.pendingTiles.delete(key);
        resolve(img);
      };
      img.onerror = () => {
        this.pendingTiles.delete(key);
        resolve(null);
      };
      img.src = `https://api.maptiler.com/tiles/terrain-rgb-v2/${z}/${x}/${y}.webp?key=${MAPTILER_KEY}`;
    });

    this.pendingTiles.set(key, promise);
    return promise;
  }

  /**
   * Render shadows for the given bounds and sun position
   */
  async render(
    bounds: { west: number; south: number; east: number; north: number },
    sunAzimuth: number,
    sunAltitude: number,
    onProgress?: (progress: number) => void
  ): Promise<ShadowResult | null> {
    const gl = this.gl;
    const program = this.program;

    if (!gl || !program) {
      console.error('[WebGLShadow] WebGL not initialized');
      return null;
    }

    // Don't render if sun is below horizon or nearly overhead
    if (sunAltitude <= 0 || sunAltitude > 75) {
      return null;
    }

    onProgress?.(0.1);

    // Determine which tiles to fetch (zoom 12 for good balance of detail and performance)
    const zoom = 12;
    const topLeft = lngLatToTile(bounds.west, bounds.north, zoom);
    const bottomRight = lngLatToTile(bounds.east, bounds.south, zoom);

    // Add buffer tiles for shadow casting from outside visible area
    const buffer = 2;
    const startX = topLeft.x - buffer;
    const startY = topLeft.y - buffer;
    const endX = bottomRight.x + buffer;
    const endY = bottomRight.y + buffer;

    const tilesX = endX - startX + 1;
    const tilesY = endY - startY + 1;
    const totalTiles = tilesX * tilesY;

    // Limit tile count
    if (totalTiles > 64) {
      console.warn('[WebGLShadow] Too many tiles, skipping');
      return null;
    }

    // Fetch all tiles
    const tileSize = 256;
    const gridWidth = tilesX * tileSize;
    const gridHeight = tilesY * tileSize;

    // Create a canvas to composite all tiles
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = gridWidth;
    tileCanvas.height = gridHeight;
    const tileCtx = tileCanvas.getContext('2d');
    if (!tileCtx) return null;

    let loadedTiles = 0;
    const tilePromises: Promise<void>[] = [];

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const tileX = startX + tx;
        const tileY = startY + ty;

        tilePromises.push(
          this.fetchTile(tileX, tileY, zoom).then((img) => {
            if (img) {
              tileCtx.drawImage(img, tx * tileSize, ty * tileSize);
            }
            loadedTiles++;
            onProgress?.(0.1 + (loadedTiles / totalTiles) * 0.3);
          })
        );
      }
    }

    await Promise.all(tilePromises);
    onProgress?.(0.4);

    // Calculate output dimensions (visible tiles only, without buffer)
    const visibleTilesX = bottomRight.x - topLeft.x + 1;
    const visibleTilesY = bottomRight.y - topLeft.y + 1;
    const outputWidth = visibleTilesX * tileSize;
    const outputHeight = visibleTilesY * tileSize;

    // Set canvas size
    this.canvas.width = outputWidth;
    this.canvas.height = outputHeight;
    gl.viewport(0, 0, outputWidth, outputHeight);

    // Create texture from tile canvas
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tileCanvas);

    onProgress?.(0.5);

    // Calculate sun direction in texture space
    const sunAzimuthRad = (sunAzimuth * Math.PI) / 180;
    const sunDirX = Math.sin(sunAzimuthRad);
    const sunDirY = -Math.cos(sunAzimuthRad); // Flip Y for texture coordinates
    const sunTanAlt = Math.tan((sunAltitude * Math.PI) / 180);

    // Calculate meters per pixel based on the TILE resolution (not output resolution)
    // This is important for correct shadow distance calculation
    const centerLat = (bounds.north + bounds.south) / 2;
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos((centerLat * Math.PI) / 180);

    // Calculate the geographic extent of the full tile grid (including buffer)
    const gridBoundsTopLeft = tileToBounds(startX, startY, zoom);
    const gridBoundsBottomRight = tileToBounds(endX + 1, endY + 1, zoom);
    const gridDegreesX = gridBoundsBottomRight.east - gridBoundsTopLeft.west;
    const gridDegreesY = gridBoundsTopLeft.north - gridBoundsBottomRight.south;
    const metersPerPixel = ((gridDegreesX / gridWidth) * metersPerDegLng + (gridDegreesY / gridHeight) * metersPerDegLat) / 2;

    // Calculate texture offset and scale to map visible area to full grid
    // The buffer tiles are at the edges, visible tiles are in the center
    const textureOffsetX = (buffer * tileSize) / gridWidth;
    const textureOffsetY = (buffer * tileSize) / gridHeight;
    const textureScaleX = outputWidth / gridWidth;
    const textureScaleY = outputHeight / gridHeight;

    // Set up shader uniforms
    gl.useProgram(program);

    gl.uniform1i(gl.getUniformLocation(program, 'u_elevation'), 0);
    gl.uniform2f(gl.getUniformLocation(program, 'u_sunDir'), sunDirX, sunDirY);
    gl.uniform1f(gl.getUniformLocation(program, 'u_sunTanAlt'), sunTanAlt);
    gl.uniform2f(gl.getUniformLocation(program, 'u_texelSize'), 1.0 / gridWidth, 1.0 / gridHeight);
    gl.uniform1f(gl.getUniformLocation(program, 'u_metersPerPixel'), metersPerPixel);
    gl.uniform2f(gl.getUniformLocation(program, 'u_textureOffset'), textureOffsetX, textureOffsetY);
    gl.uniform2f(gl.getUniformLocation(program, 'u_textureScale'), textureScaleX, textureScaleY);

    // Enable blending for transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Clear and render
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    onProgress?.(0.9);

    // Calculate output bounds (visible area only)
    const outputTopLeft = tileToBounds(topLeft.x, topLeft.y, zoom);
    const outputBottomRight = tileToBounds(bottomRight.x + 1, bottomRight.y + 1, zoom);

    // Create output canvas with the rendered shadows
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;
    const outputCtx = outputCanvas.getContext('2d');
    if (outputCtx) {
      outputCtx.drawImage(this.canvas, 0, 0);
    }

    // Clean up texture
    gl.deleteTexture(texture);

    onProgress?.(1.0);

    return {
      canvas: outputCanvas,
      bounds: [outputTopLeft.west, outputBottomRight.south, outputBottomRight.east, outputTopLeft.north],
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.tileCache.clear();
    this.pendingTiles.clear();
    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
    }
  }
}

// Singleton instance
let rendererInstance: WebGLShadowRenderer | null = null;

/**
 * Get or create the WebGL shadow renderer
 */
export function getWebGLShadowRenderer(): WebGLShadowRenderer {
  if (!rendererInstance) {
    rendererInstance = new WebGLShadowRenderer();
  }
  return rendererInstance;
}

/**
 * Compute terrain shadows using WebGL
 */
export async function computeWebGLShadows(
  bounds: { west: number; south: number; east: number; north: number },
  sunAzimuth: number,
  sunAltitude: number,
  onProgress?: (progress: number) => void
): Promise<{ imageDataUrl: string; bounds: [number, number, number, number] } | null> {
  const renderer = getWebGLShadowRenderer();
  const result = await renderer.render(bounds, sunAzimuth, sunAltitude, onProgress);

  if (!result) return null;

  return {
    imageDataUrl: result.canvas.toDataURL('image/png'),
    bounds: result.bounds,
  };
}

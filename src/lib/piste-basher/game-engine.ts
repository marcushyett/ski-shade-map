import * as THREE from 'three';
import type {
  GameWorld,
  GameRun,
  GameLift,
  GameBuilding,
  GameTree,
  VehicleState,
  VehiclePhysics,
  ControlInput,
  GameScore,
  RunGroomingState,
  GroomedSegment,
  ScoreBonus,
  GameState,
} from './types';
import { DEFAULT_VEHICLE_PHYSICS, DIFFICULTY_COLORS as COLORS } from './types';

/**
 * Piste Basher Game Engine
 * Handles all game logic, physics, and rendering
 */
export class PisteBasherEngine {
  // Three.js objects
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock: THREE.Clock;

  // Game state
  private gameState: GameState = 'menu';
  private world: GameWorld | null = null;
  private vehicle: VehicleState;
  private physics: VehiclePhysics;
  private controlInput: ControlInput;
  private score: GameScore;
  private runStates: Map<string, RunGroomingState> = new Map();

  // 3D objects
  private vehicleMesh: THREE.Group | null = null;
  private terrainMesh: THREE.Mesh | null = null;
  private runMeshes: Map<string, THREE.Mesh> = new Map();
  private groomingTrailMeshes: Map<string, THREE.Mesh> = new Map();
  private buildingMeshes: THREE.Group[] = [];
  private liftMeshes: THREE.Group[] = [];
  private treeMeshes: THREE.Group[] = [];
  private pisteOverlayMesh: THREE.Mesh | null = null;
  private corduroyTrailMesh: THREE.Mesh | null = null;
  private corduroyTrailPoints: Array<{ x: number; y: number; z: number; rotation: number }> = [];
  private snowPileParticles: THREE.Points | null = null;

  // Lights
  private moonLight: THREE.DirectionalLight | null = null;
  private ambientLight: THREE.AmbientLight | null = null;
  private vehicleHeadlights: THREE.SpotLight[] = [];
  private vehicleWorkLights: THREE.PointLight[] = [];
  private beaconLight: THREE.PointLight | null = null;

  // Effects
  private snowParticles: THREE.Points | null = null;
  private starField: THREE.Points | null = null;

  // Callbacks
  private onScoreUpdate?: (score: GameScore) => void;
  private onRunGroomed?: (runId: string, progress: number) => void;
  private onGameStateChange?: (state: GameState) => void;

  // Animation
  private animationId: number | null = null;
  private lastTime = 0;

  constructor() {
    // Initialize Three.js
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.clock = new THREE.Clock();

    // Initialize vehicle state
    this.vehicle = this.createInitialVehicleState();
    this.physics = { ...DEFAULT_VEHICLE_PHYSICS };
    this.controlInput = this.createEmptyControlInput();

    // Initialize score
    this.score = {
      totalPoints: 0,
      runsGroomed: 0,
      totalDistance: 0,
      fuelUsed: 0,
      timeElapsed: 0,
      bonuses: [],
    };

    // Configure renderer
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.3; // Night time exposure
  }

  private createInitialVehicleState(): VehicleState {
    return {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      speed: 0,
      throttle: 0,
      brake: 0,
      steering: 0,
      blade: {
        lowered: false,
        angle: 0,
        width: DEFAULT_VEHICLE_PHYSICS.bladeWidth,
      },
      lights: {
        headlights: true,
        workLights: true,
        beacon: true,
      },
    };
  }

  private createEmptyControlInput(): ControlInput {
    return {
      forward: false,
      backward: false,
      left: false,
      right: false,
      bladeLower: false,
      bladeRaise: false,
      bladeTiltLeft: false,
      bladeTiltRight: false,
      toggleLights: false,
      toggleBeacon: false,
      horn: false,
      pause: false,
    };
  }

  /**
   * Initialize the game with a container element
   */
  initialize(container: HTMLElement): void {
    const rect = container.getBoundingClientRect();
    this.renderer.setSize(rect.width, rect.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();

    // Setup scene
    this.setupScene();
  }

  /**
   * Setup the basic scene with lighting and atmosphere
   */
  private setupScene(): void {
    // Night sky background
    this.scene.background = new THREE.Color(0x0a0a1a);
    this.scene.fog = new THREE.FogExp2(0x0a0a2a, 0.0003);

    // Ambient light (moonlight reflected from snow)
    this.ambientLight = new THREE.AmbientLight(0x2244aa, 0.15);
    this.scene.add(this.ambientLight);

    // Moon light
    this.moonLight = new THREE.DirectionalLight(0x8899bb, 0.4);
    this.moonLight.position.set(100, 200, 50);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.width = 2048;
    this.moonLight.shadow.mapSize.height = 2048;
    this.moonLight.shadow.camera.near = 0.5;
    this.moonLight.shadow.camera.far = 1000;
    this.moonLight.shadow.camera.left = -500;
    this.moonLight.shadow.camera.right = 500;
    this.moonLight.shadow.camera.top = 500;
    this.moonLight.shadow.camera.bottom = -500;
    this.scene.add(this.moonLight);

    // Create star field
    this.createStarField();
  }

  /**
   * Create a star field for night sky
   */
  private createStarField(): void {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 3000;
    const positions = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);

    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const radius = 4000 + Math.random() * 1000;

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = Math.abs(radius * Math.cos(phi)); // Only above horizon
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

      sizes[i] = Math.random() * 2 + 0.5;
    }

    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.8,
    });

    this.starField = new THREE.Points(starGeometry, starMaterial);
    this.scene.add(this.starField);
  }

  /**
   * Create snow particles effect
   */
  private createSnowParticles(): void {
    const particleCount = 5000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 500;
      positions[i * 3 + 1] = Math.random() * 200;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 500;

      velocities[i * 3] = (Math.random() - 0.5) * 0.5;
      velocities[i * 3 + 1] = -Math.random() * 2 - 1;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.5,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });

    this.snowParticles = new THREE.Points(geometry, material);
    this.scene.add(this.snowParticles);
  }

  /**
   * Load the game world
   */
  async loadWorld(world: GameWorld): Promise<void> {
    this.world = world;
    this.gameState = 'loading';
    this.onGameStateChange?.(this.gameState);

    // Clear existing meshes
    this.clearWorld();

    // Create terrain
    this.createTerrain();

    // Create runs
    for (const run of world.runs) {
      this.createRunMesh(run);
      this.initializeRunState(run);
    }

    // Create lifts
    for (const lift of world.lifts) {
      this.createLiftMesh(lift);
    }

    // Create buildings
    for (const building of world.buildings) {
      this.createBuildingMesh(building);
    }

    // Create trees
    for (const tree of world.trees) {
      this.createTreeMesh(tree);
    }

    // Create piste overlay (initially hidden)
    this.createPisteOverlay();

    // Create vehicle
    this.createVehicle();

    // Create snow particles
    this.createSnowParticles();

    // Create grooming effects
    this.createCorduroyTrail();
    this.createSnowPileParticles();

    // Find best starting position - prefer wide, easy runs at high elevation
    if (world.runs.length > 0) {
      const startRun = this.findBestStartingRun(world.runs);
      const startPoint = startRun.path[0];
      this.vehicle.position = { ...startPoint };
      this.vehicle.position.y += 1; // Above ground

      // Face down the run
      if (startRun.path.length > 1) {
        const dx = startRun.path[1].x - startRun.path[0].x;
        const dz = startRun.path[1].z - startRun.path[0].z;
        this.vehicle.rotation.y = Math.atan2(dx, dz);
      }
    }

    this.gameState = 'playing';
    this.onGameStateChange?.(this.gameState);
  }

  /**
   * Clear all world meshes
   */
  private clearWorld(): void {
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh = null;
    }

    for (const mesh of this.runMeshes.values()) {
      this.scene.remove(mesh);
    }
    this.runMeshes.clear();

    for (const mesh of this.groomingTrailMeshes.values()) {
      this.scene.remove(mesh);
    }
    this.groomingTrailMeshes.clear();

    for (const group of this.buildingMeshes) {
      this.scene.remove(group);
    }
    this.buildingMeshes = [];

    for (const group of this.liftMeshes) {
      this.scene.remove(group);
    }
    this.liftMeshes = [];

    for (const group of this.treeMeshes) {
      this.scene.remove(group);
    }
    this.treeMeshes = [];

    if (this.pisteOverlayMesh) {
      this.scene.remove(this.pisteOverlayMesh);
      this.pisteOverlayMesh = null;
    }

    if (this.vehicleMesh) {
      this.scene.remove(this.vehicleMesh);
      this.vehicleMesh = null;
    }

    if (this.snowParticles) {
      this.scene.remove(this.snowParticles);
      this.snowParticles = null;
    }

    if (this.corduroyTrailMesh) {
      this.scene.remove(this.corduroyTrailMesh);
      this.corduroyTrailMesh.geometry.dispose();
      (this.corduroyTrailMesh.material as THREE.Material).dispose();
      this.corduroyTrailMesh = null;
    }
    this.corduroyTrailPoints = [];

    if (this.snowPileParticles) {
      this.scene.remove(this.snowPileParticles);
      this.snowPileParticles.geometry.dispose();
      (this.snowPileParticles.material as THREE.Material).dispose();
      this.snowPileParticles = null;
    }
  }

  /**
   * Create terrain mesh from heightmap
   */
  private createTerrain(): void {
    if (!this.world) return;

    const terrain = this.world.terrain;
    const geometry = new THREE.PlaneGeometry(
      terrain.width * terrain.resolution,
      terrain.height * terrain.resolution,
      terrain.width - 1,
      terrain.height - 1
    );

    // Apply heightmap
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = Math.floor(i % terrain.width);
      const y = Math.floor(i / terrain.width);
      const heightIndex = y * terrain.width + x;
      const height = terrain.heightmap[heightIndex] || 0;

      // PlaneGeometry is initially XY, we rotate it to XZ
      positions.setZ(i, height - terrain.minElevation);
    }

    geometry.computeVertexNormals();

    // Snow material
    const material = new THREE.MeshStandardMaterial({
      color: 0xeeeeff,
      roughness: 0.8,
      metalness: 0.0,
      flatShading: false,
    });

    this.terrainMesh = new THREE.Mesh(geometry, material);
    this.terrainMesh.rotation.x = -Math.PI / 2;
    this.terrainMesh.position.set(
      (this.world.bounds.minX + this.world.bounds.maxX) / 2,
      terrain.minElevation,
      (this.world.bounds.minZ + this.world.bounds.maxZ) / 2
    );
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);
  }

  /**
   * Create a mesh for a ski run
   */
  private createRunMesh(run: GameRun): void {
    if (run.path.length < 2) return;

    // Create a tube geometry along the run path
    const points = run.path.map(p => new THREE.Vector3(p.x, p.y + 0.1, p.z));
    const curve = new THREE.CatmullRomCurve3(points);

    const geometry = new THREE.TubeGeometry(
      curve,
      Math.max(10, run.path.length * 2),
      run.averageWidth / 2,
      8,
      false
    );

    // Make it flat by collapsing the tube to a ribbon
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      // Flatten vertically but keep some thickness for visibility
      positions.setY(i, Math.min(y + 0.5, y));
    }
    geometry.computeVertexNormals();

    const color = run.difficulty ? COLORS[run.difficulty] : '#888888';
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).multiplyScalar(0.3), // Darker for night
      roughness: 0.9,
      metalness: 0.0,
      transparent: true,
      opacity: 0.8,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.runMeshes.set(run.id, mesh);
  }

  /**
   * Initialize run grooming state
   */
  private initializeRunState(run: GameRun): void {
    const passesRequired = Math.ceil(run.averageWidth / this.physics.bladeWidth);

    this.runStates.set(run.id, {
      runId: run.id,
      runName: run.name,
      difficulty: run.difficulty,
      totalLength: run.length,
      totalWidth: run.averageWidth,
      groomedSegments: [],
      groomingProgress: 0,
      pointsEarned: 0,
      passesRequired,
      passesCompleted: 0,
    });
  }

  /**
   * Create lift mesh
   */
  private createLiftMesh(lift: GameLift): void {
    const group = new THREE.Group();

    // Create cable using tube geometry
    if (lift.path.length >= 2) {
      const points = lift.path.map(p => new THREE.Vector3(p.x, p.y, p.z));
      const curve = new THREE.CatmullRomCurve3(points);
      const cableGeometry = new THREE.TubeGeometry(curve, 50, 0.1, 8, false);
      const cableMaterial = new THREE.MeshStandardMaterial({
        color: 0x333333,
        metalness: 0.8,
        roughness: 0.3,
      });
      const cable = new THREE.Mesh(cableGeometry, cableMaterial);
      group.add(cable);
    }

    // Create pylons
    for (const pylon of lift.pylons) {
      const pylonGeometry = new THREE.CylinderGeometry(0.3, 0.5, 12, 8);
      const pylonMaterial = new THREE.MeshStandardMaterial({
        color: 0x666666,
        metalness: 0.6,
        roughness: 0.4,
      });
      const pylonMesh = new THREE.Mesh(pylonGeometry, pylonMaterial);
      pylonMesh.position.set(pylon.x, pylon.y + 6, pylon.z);
      pylonMesh.castShadow = true;
      group.add(pylonMesh);

      // Add crossarm
      const armGeometry = new THREE.BoxGeometry(6, 0.3, 0.3);
      const arm = new THREE.Mesh(armGeometry, pylonMaterial);
      arm.position.set(pylon.x, pylon.y + 12, pylon.z);
      group.add(arm);
    }

    this.scene.add(group);
    this.liftMeshes.push(group);
  }

  /**
   * Create building mesh
   */
  private createBuildingMesh(building: GameBuilding): void {
    const group = new THREE.Group();

    // Main building body
    const bodyGeometry = new THREE.BoxGeometry(
      building.dimensions.width,
      building.dimensions.height,
      building.dimensions.depth
    );

    // Different colors for different building types
    let color = 0x8b7355; // Default wood color
    switch (building.type) {
      case 'restaurant':
        color = 0xa0522d;
        break;
      case 'hotel':
        color = 0xdeb887;
        break;
      case 'cabin':
        color = 0x6b4423;
        break;
      case 'lift_station':
        color = 0x808080;
        break;
    }

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      metalness: 0.0,
    });

    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = building.dimensions.height / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Roof (simple pyramid)
    const roofGeometry = new THREE.ConeGeometry(
      Math.max(building.dimensions.width, building.dimensions.depth) * 0.7,
      building.dimensions.height * 0.5,
      4
    );
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.8,
      metalness: 0.0,
    });
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.y = building.dimensions.height + building.dimensions.height * 0.25;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);

    // Add warm window glow
    const windowGeometry = new THREE.PlaneGeometry(2, 2);
    const windowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa44,
      transparent: true,
      opacity: 0.8,
    });

    // Add windows on each side
    for (let i = 0; i < 4; i++) {
      const window = new THREE.Mesh(windowGeometry, windowMaterial);
      window.position.y = building.dimensions.height * 0.5;
      const angle = (i * Math.PI) / 2;
      window.position.x = Math.sin(angle) * (building.dimensions.width / 2 + 0.1);
      window.position.z = Math.cos(angle) * (building.dimensions.depth / 2 + 0.1);
      window.rotation.y = angle;
      group.add(window);
    }

    group.position.set(building.position.x, building.position.y, building.position.z);
    group.rotation.y = building.rotation;

    this.scene.add(group);
    this.buildingMeshes.push(group);
  }

  /**
   * Create a tree mesh
   */
  private createTreeMesh(tree: GameTree): void {
    const group = new THREE.Group();

    // Trunk
    const trunkHeight = tree.height * 0.25;
    const trunkRadius = tree.radius * 0.15;
    const trunkGeometry = new THREE.CylinderGeometry(
      trunkRadius * 0.6,
      trunkRadius,
      trunkHeight,
      8
    );
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a3728,
      roughness: 0.9,
      metalness: 0.0,
    });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    group.add(trunk);

    // Foliage - cone shape for alpine trees
    const foliageHeight = tree.height * 0.8;
    const foliageRadius = tree.radius;

    // Create multiple layers of cones for more realistic look
    const numLayers = 3;
    for (let i = 0; i < numLayers; i++) {
      const layerHeight = foliageHeight / numLayers * 1.2;
      const layerRadius = foliageRadius * (1 - i * 0.15);
      const layerY = trunkHeight + (i * foliageHeight / numLayers * 0.7);

      const coneGeometry = new THREE.ConeGeometry(layerRadius, layerHeight, 8);
      const coneMaterial = new THREE.MeshStandardMaterial({
        color: tree.type === 'pine' ? 0x1a3d1a :
               tree.type === 'fir' ? 0x1a4d2a :
               0x1a3d2a, // spruce
        roughness: 0.9,
        metalness: 0.0,
      });
      const cone = new THREE.Mesh(coneGeometry, coneMaterial);
      cone.position.y = layerY + layerHeight / 2;
      cone.castShadow = true;
      group.add(cone);
    }

    // Add a tiny bit of snow on the tree (white patches on top)
    const snowCapGeometry = new THREE.ConeGeometry(foliageRadius * 0.3, foliageHeight * 0.1, 6);
    const snowMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0.0,
      transparent: true,
      opacity: 0.9,
    });
    const snowCap = new THREE.Mesh(snowCapGeometry, snowMaterial);
    snowCap.position.y = trunkHeight + foliageHeight * 0.95;
    group.add(snowCap);

    group.position.set(tree.position.x, tree.position.y, tree.position.z);

    this.scene.add(group);
    this.treeMeshes.push(group);
  }

  /**
   * Create piste overlay that shows runs on the terrain
   */
  private createPisteOverlay(): void {
    if (!this.world) return;

    // Create a large plane above the terrain that shows the piste map
    const bounds = this.world.bounds;
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;

    // Create geometry for the overlay
    const geometry = new THREE.PlaneGeometry(width, depth, 1, 1);

    // Create a canvas to draw the piste map
    const canvas = document.createElement('canvas');
    const canvasSize = 1024;
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext('2d')!;

    // Clear with transparent background
    ctx.clearRect(0, 0, canvasSize, canvasSize);

    // Draw runs on the canvas
    for (const run of this.world.runs) {
      if (run.path.length < 2) continue;

      ctx.beginPath();
      ctx.strokeStyle = run.difficulty ? COLORS[run.difficulty] : '#888888';
      ctx.lineWidth = Math.max(2, (run.averageWidth / width) * canvasSize * 0.5);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.6;

      const firstPoint = run.path[0];
      const x0 = ((firstPoint.x - bounds.minX) / width) * canvasSize;
      const y0 = ((firstPoint.z - bounds.minZ) / depth) * canvasSize;
      ctx.moveTo(x0, y0);

      for (let i = 1; i < run.path.length; i++) {
        const point = run.path[i];
        const x = ((point.x - bounds.minX) / width) * canvasSize;
        const y = ((point.z - bounds.minZ) / depth) * canvasSize;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    // Create material with transparency
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.pisteOverlayMesh = new THREE.Mesh(geometry, material);
    this.pisteOverlayMesh.rotation.x = -Math.PI / 2;
    this.pisteOverlayMesh.position.set(
      (bounds.minX + bounds.maxX) / 2,
      bounds.maxY + 5, // Slightly above highest point
      (bounds.minZ + bounds.maxZ) / 2
    );
    this.pisteOverlayMesh.visible = false; // Hidden by default

    this.scene.add(this.pisteOverlayMesh);
  }

  /**
   * Toggle the piste overlay visibility
   */
  togglePisteOverlay(): void {
    if (this.pisteOverlayMesh) {
      this.pisteOverlayMesh.visible = !this.pisteOverlayMesh.visible;
    }
  }

  /**
   * Get piste overlay visibility
   */
  isPisteOverlayVisible(): boolean {
    return this.pisteOverlayMesh?.visible ?? false;
  }

  /**
   * Create the piste basher vehicle
   */
  private createVehicle(): void {
    this.vehicleMesh = new THREE.Group();

    // Main body (cab)
    const cabGeometry = new THREE.BoxGeometry(3, 2.5, 4);
    const cabMaterial = new THREE.MeshStandardMaterial({
      color: 0xff4444, // Classic red PistenBully color
      metalness: 0.3,
      roughness: 0.5,
    });
    const cab = new THREE.Mesh(cabGeometry, cabMaterial);
    cab.position.y = 2.5;
    cab.position.z = -0.5;
    cab.castShadow = true;
    this.vehicleMesh.add(cab);

    // Windows
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: 0x111133,
      metalness: 0.9,
      roughness: 0.1,
      transparent: true,
      opacity: 0.7,
    });

    // Front window
    const frontWindowGeometry = new THREE.PlaneGeometry(2.5, 1.5);
    const frontWindow = new THREE.Mesh(frontWindowGeometry, windowMaterial);
    frontWindow.position.set(0, 3, 1.51);
    this.vehicleMesh.add(frontWindow);

    // Engine/body section
    const bodyGeometry = new THREE.BoxGeometry(3.5, 1.5, 6);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xcc3333,
      metalness: 0.2,
      roughness: 0.6,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 1.25;
    body.position.z = 0.5;
    body.castShadow = true;
    this.vehicleMesh.add(body);

    // Tracks (left and right)
    const trackGeometry = new THREE.BoxGeometry(1, 0.8, 7);
    const trackMaterial = new THREE.MeshStandardMaterial({
      color: 0x222222,
      metalness: 0.1,
      roughness: 0.9,
    });

    const leftTrack = new THREE.Mesh(trackGeometry, trackMaterial);
    leftTrack.position.set(-2, 0.4, 0);
    leftTrack.castShadow = true;
    this.vehicleMesh.add(leftTrack);

    const rightTrack = new THREE.Mesh(trackGeometry, trackMaterial);
    rightTrack.position.set(2, 0.4, 0);
    rightTrack.castShadow = true;
    this.vehicleMesh.add(rightTrack);

    // Front blade
    const bladeGeometry = new THREE.BoxGeometry(6, 1, 0.3);
    const bladeMaterial = new THREE.MeshStandardMaterial({
      color: 0xff6600,
      metalness: 0.4,
      roughness: 0.5,
    });
    const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
    blade.position.set(0, 0.5, 4);
    blade.name = 'blade';
    blade.castShadow = true;
    this.vehicleMesh.add(blade);

    // Rear tiller
    const tillerGeometry = new THREE.CylinderGeometry(0.5, 0.5, 5, 12);
    const tillerMaterial = new THREE.MeshStandardMaterial({
      color: 0x444444,
      metalness: 0.6,
      roughness: 0.4,
    });
    const tiller = new THREE.Mesh(tillerGeometry, tillerMaterial);
    tiller.rotation.z = Math.PI / 2;
    tiller.position.set(0, 0.5, -4);
    tiller.name = 'tiller';
    this.vehicleMesh.add(tiller);

    // Headlights
    this.createVehicleLights();

    // Beacon
    const beaconGeometry = new THREE.SphereGeometry(0.3, 16, 8);
    const beaconMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.8,
    });
    const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial);
    beacon.position.set(0, 4, -0.5);
    beacon.name = 'beacon';
    this.vehicleMesh.add(beacon);

    // Add beacon light
    this.beaconLight = new THREE.PointLight(0xffaa00, 2, 50);
    this.beaconLight.position.copy(beacon.position);
    this.vehicleMesh.add(this.beaconLight);

    this.scene.add(this.vehicleMesh);
  }

  /**
   * Create vehicle lights (headlights and work lights)
   */
  private createVehicleLights(): void {
    if (!this.vehicleMesh) return;

    // Headlights (front)
    const headlightPositions = [
      { x: -1.2, y: 2, z: 2 },
      { x: 1.2, y: 2, z: 2 },
    ];

    for (const pos of headlightPositions) {
      const light = new THREE.SpotLight(0xffffee, 50, 100, Math.PI / 6, 0.5, 2);
      light.position.set(pos.x, pos.y, pos.z);
      light.target.position.set(pos.x, 0, pos.z + 30);
      light.castShadow = true;
      this.vehicleMesh.add(light);
      this.vehicleMesh.add(light.target);
      this.vehicleHeadlights.push(light);

      // Visible headlight housing
      const housingGeometry = new THREE.SphereGeometry(0.2, 8, 8);
      const housingMaterial = new THREE.MeshBasicMaterial({ color: 0xffffaa });
      const housing = new THREE.Mesh(housingGeometry, housingMaterial);
      housing.position.set(pos.x, pos.y, pos.z);
      this.vehicleMesh.add(housing);
    }

    // Work lights (on top of cab, pointing to sides and rear)
    const workLightPositions = [
      { x: -1.5, y: 4, z: -1 },
      { x: 1.5, y: 4, z: -1 },
      { x: 0, y: 4, z: -2 },
    ];

    for (const pos of workLightPositions) {
      const light = new THREE.PointLight(0xffffee, 30, 40);
      light.position.set(pos.x, pos.y, pos.z);
      this.vehicleMesh.add(light);
      this.vehicleWorkLights.push(light);
    }
  }

  /**
   * Create the corduroy trail mesh for groomed snow effect
   */
  private createCorduroyTrail(): void {
    // Create a canvas texture for corduroy pattern
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    // Draw corduroy lines pattern
    ctx.fillStyle = '#e8eef8';
    ctx.fillRect(0, 0, 128, 128);

    ctx.strokeStyle = '#d0d8e8';
    ctx.lineWidth = 2;
    for (let i = 0; i < 128; i += 4) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(128, i);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 10);

    // Create initial empty geometry
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(6000 * 3); // Max 2000 quads * 3 verts * 3 coords
    const uvs = new Float32Array(6000 * 2);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setDrawRange(0, 0);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.corduroyTrailMesh = new THREE.Mesh(geometry, material);
    this.corduroyTrailMesh.renderOrder = 1;
    this.scene.add(this.corduroyTrailMesh);
  }

  /**
   * Create snow pile particles for when blade is grooming
   */
  private createSnowPileParticles(): void {
    const particleCount = 200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const lifetimes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = -100; // Start hidden below ground
      positions[i * 3 + 2] = 0;
      velocities[i * 3] = 0;
      velocities[i * 3 + 1] = 0;
      velocities[i * 3 + 2] = 0;
      lifetimes[i] = 0;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.8,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    this.snowPileParticles = new THREE.Points(geometry, material);
    this.scene.add(this.snowPileParticles);
  }

  /**
   * Update corduroy trail when grooming
   */
  private updateCorduroyTrail(): void {
    if (!this.corduroyTrailMesh || !this.vehicle.blade.lowered) return;

    // Add new point at vehicle rear position
    const bladeWidth = this.physics.bladeWidth;
    const rearOffset = -5; // Behind the vehicle

    // Calculate rear position in world space
    const forward = new THREE.Vector3(0, 0, 1);
    forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.vehicle.rotation.y);

    const newPoint = {
      x: this.vehicle.position.x + forward.x * rearOffset,
      y: this.vehicle.position.y - 0.5,
      z: this.vehicle.position.z + forward.z * rearOffset,
      rotation: this.vehicle.rotation.y,
    };

    // Only add if moved enough from last point
    const lastPoint = this.corduroyTrailPoints[this.corduroyTrailPoints.length - 1];
    if (lastPoint) {
      const dist = Math.sqrt(
        (newPoint.x - lastPoint.x) ** 2 +
        (newPoint.z - lastPoint.z) ** 2
      );
      if (dist < 1) return; // Need at least 1m movement
    }

    this.corduroyTrailPoints.push(newPoint);

    // Limit trail length
    if (this.corduroyTrailPoints.length > 500) {
      this.corduroyTrailPoints.shift();
    }

    // Rebuild trail mesh
    if (this.corduroyTrailPoints.length < 2) return;

    const positions = this.corduroyTrailMesh.geometry.attributes.position as THREE.BufferAttribute;
    const uvs = this.corduroyTrailMesh.geometry.attributes.uv as THREE.BufferAttribute;

    let vertIndex = 0;
    for (let i = 0; i < this.corduroyTrailPoints.length - 1 && vertIndex < 5994; i++) {
      const p1 = this.corduroyTrailPoints[i];
      const p2 = this.corduroyTrailPoints[i + 1];

      // Calculate perpendicular for width
      const dx = p2.x - p1.x;
      const dz = p2.z - p1.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len === 0) continue;

      const perpX = -dz / len * bladeWidth / 2;
      const perpZ = dx / len * bladeWidth / 2;

      // Create quad (2 triangles)
      // Triangle 1
      positions.setXYZ(vertIndex, p1.x - perpX, p1.y, p1.z - perpZ);
      uvs.setXY(vertIndex, 0, i * 0.1);
      vertIndex++;
      positions.setXYZ(vertIndex, p1.x + perpX, p1.y, p1.z + perpZ);
      uvs.setXY(vertIndex, 1, i * 0.1);
      vertIndex++;
      positions.setXYZ(vertIndex, p2.x - perpX, p2.y, p2.z - perpZ);
      uvs.setXY(vertIndex, 0, (i + 1) * 0.1);
      vertIndex++;

      // Triangle 2
      positions.setXYZ(vertIndex, p1.x + perpX, p1.y, p1.z + perpZ);
      uvs.setXY(vertIndex, 1, i * 0.1);
      vertIndex++;
      positions.setXYZ(vertIndex, p2.x + perpX, p2.y, p2.z + perpZ);
      uvs.setXY(vertIndex, 1, (i + 1) * 0.1);
      vertIndex++;
      positions.setXYZ(vertIndex, p2.x - perpX, p2.y, p2.z - perpZ);
      uvs.setXY(vertIndex, 0, (i + 1) * 0.1);
      vertIndex++;
    }

    positions.needsUpdate = true;
    uvs.needsUpdate = true;
    this.corduroyTrailMesh.geometry.setDrawRange(0, vertIndex);
  }

  /**
   * Update snow pile particles when grooming
   */
  private updateSnowPileParticles(deltaTime: number): void {
    if (!this.snowPileParticles) return;

    const positions = this.snowPileParticles.geometry.attributes.position as THREE.BufferAttribute;
    const velocities = this.snowPileParticles.geometry.attributes.velocity as THREE.BufferAttribute;
    const lifetimes = this.snowPileParticles.geometry.attributes.lifetime as THREE.BufferAttribute;

    const bladeWidth = this.physics.bladeWidth;
    const isGrooming = this.vehicle.blade.lowered && Math.abs(this.vehicle.speed) > 0.5;

    // Calculate blade front position
    const forward = new THREE.Vector3(0, 0, 1);
    forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.vehicle.rotation.y);
    const right = new THREE.Vector3(forward.z, 0, -forward.x);

    const bladeFrontX = this.vehicle.position.x + forward.x * 4;
    const bladeFrontY = this.vehicle.position.y;
    const bladeFrontZ = this.vehicle.position.z + forward.z * 4;

    for (let i = 0; i < positions.count; i++) {
      let lifetime = lifetimes.getX(i);

      if (lifetime <= 0 && isGrooming) {
        // Respawn particle at blade front
        const offset = (Math.random() - 0.5) * bladeWidth;
        positions.setXYZ(
          i,
          bladeFrontX + right.x * offset,
          bladeFrontY + 0.3 + Math.random() * 0.5,
          bladeFrontZ + right.z * offset
        );

        // Spray forward and up
        const speed = 2 + Math.random() * 3;
        velocities.setXYZ(
          i,
          forward.x * speed + (Math.random() - 0.5) * 2,
          1 + Math.random() * 2,
          forward.z * speed + (Math.random() - 0.5) * 2
        );

        lifetime = 0.5 + Math.random() * 0.5;
      } else if (lifetime > 0) {
        // Update particle
        let x = positions.getX(i);
        let y = positions.getY(i);
        let z = positions.getZ(i);

        let vx = velocities.getX(i);
        let vy = velocities.getY(i);
        let vz = velocities.getZ(i);

        // Apply gravity
        vy -= 9.8 * deltaTime;

        // Update position
        x += vx * deltaTime;
        y += vy * deltaTime;
        z += vz * deltaTime;

        // Ground collision
        if (y < this.vehicle.position.y - 0.5) {
          y = this.vehicle.position.y - 0.5;
          vy = 0;
          vx *= 0.5;
          vz *= 0.5;
        }

        positions.setXYZ(i, x, y, z);
        velocities.setXYZ(i, vx, vy, vz);

        lifetime -= deltaTime;
      }

      lifetimes.setX(i, lifetime);
    }

    positions.needsUpdate = true;
    velocities.needsUpdate = true;
    lifetimes.needsUpdate = true;
  }

  /**
   * Find the best run to start on - prefer wide, easy runs at high elevation
   */
  private findBestStartingRun(runs: GameRun[]): GameRun {
    if (runs.length === 0) throw new Error('No runs available');
    if (runs.length === 1) return runs[0];

    // Score each run for starting suitability
    let bestRun = runs[0];
    let bestScore = -Infinity;

    for (const run of runs) {
      let score = 0;

      // Prefer wider runs (easier to navigate)
      score += run.averageWidth * 2;

      // Prefer easier difficulties
      const difficultyScores: Record<string, number> = {
        novice: 100,
        easy: 80,
        intermediate: 60,
        advanced: 30,
        expert: 10,
      };
      score += difficultyScores[run.difficulty || 'intermediate'] || 50;

      // Prefer higher starting elevation
      if (run.path.length > 0) {
        score += run.path[0].y * 0.05;
      }

      // Prefer longer runs (more to groom)
      score += Math.min(run.length / 50, 20);

      // Prefer runs that go generally downhill (first point higher than last)
      if (run.path.length >= 2) {
        const elevDrop = run.path[0].y - run.path[run.path.length - 1].y;
        if (elevDrop > 0) {
          score += Math.min(elevDrop * 0.1, 30);
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestRun = run;
      }
    }

    return bestRun;
  }

  /**
   * Update control input
   */
  setControlInput(input: Partial<ControlInput>): void {
    this.controlInput = { ...this.controlInput, ...input };
  }

  /**
   * Main game loop update
   */
  update(deltaTime: number): void {
    if (this.gameState !== 'playing') return;

    // Update vehicle physics
    this.updateVehiclePhysics(deltaTime);

    // Update camera
    this.updateCamera();

    // Update vehicle mesh position
    this.updateVehicleMesh();

    // Update grooming
    this.updateGrooming();

    // Update grooming effects (corduroy trail and snow spray)
    this.updateCorduroyTrail();
    this.updateSnowPileParticles(deltaTime);

    // Update effects
    this.updateEffects(deltaTime);

    // Update score
    this.score.timeElapsed += deltaTime;
    this.score.fuelUsed += (this.physics.fuelConsumption / 3600) * deltaTime;
  }

  /**
   * Update vehicle physics
   */
  private updateVehiclePhysics(deltaTime: number): void {
    // Calculate throttle and brake from input
    if (this.controlInput.forward) {
      this.vehicle.throttle = Math.min(this.vehicle.throttle + deltaTime * 2, 1);
    } else if (this.controlInput.backward) {
      this.vehicle.throttle = Math.max(this.vehicle.throttle - deltaTime * 2, -1);
    } else {
      this.vehicle.throttle *= 0.95; // Natural deceleration
    }

    // Steering
    if (this.controlInput.left) {
      this.vehicle.steering = Math.min(this.vehicle.steering + deltaTime * 3, 1);
    } else if (this.controlInput.right) {
      this.vehicle.steering = Math.max(this.vehicle.steering - deltaTime * 3, -1);
    } else {
      this.vehicle.steering *= 0.9; // Return to center
    }

    // Blade controls
    if (this.controlInput.bladeLower && !this.vehicle.blade.lowered) {
      this.vehicle.blade.lowered = true;
    }
    if (this.controlInput.bladeRaise && this.vehicle.blade.lowered) {
      this.vehicle.blade.lowered = false;
    }

    // Calculate max speed (reduced when grooming or on steep slopes)
    let maxSpeed = this.physics.maxSpeed;
    if (this.vehicle.blade.lowered) {
      maxSpeed = Math.min(maxSpeed, this.physics.groomingSpeed);
    }

    // Calculate terrain slope at current position
    const slopeAngle = this.getTerrainSlopeAtPosition(
      this.vehicle.position.x,
      this.vehicle.position.z
    );

    // Adjust speed based on slope
    if (slopeAngle > 0) {
      // Going uphill - reduce max speed
      maxSpeed *= Math.max(0.3, 1 - slopeAngle * this.physics.slopeSpeedMultiplier);
    } else {
      // Going downhill - gravity assists but limit max speed
      maxSpeed *= Math.min(1.3, 1 - slopeAngle * this.physics.slopeSpeedMultiplier * 0.5);
    }

    // Apply acceleration
    const targetSpeed = this.vehicle.throttle * maxSpeed;
    if (targetSpeed > this.vehicle.speed) {
      this.vehicle.speed = Math.min(
        this.vehicle.speed + this.physics.acceleration * deltaTime,
        targetSpeed
      );
    } else if (targetSpeed < this.vehicle.speed) {
      this.vehicle.speed = Math.max(
        this.vehicle.speed - this.physics.braking * deltaTime,
        targetSpeed
      );
    }

    // Apply steering (turn rate depends on speed)
    const turnRate = this.physics.turnRate * (0.3 + 0.7 * Math.abs(this.vehicle.speed) / this.physics.maxSpeed);
    this.vehicle.rotation.y += this.vehicle.steering * turnRate * deltaTime * Math.sign(this.vehicle.speed);

    // Calculate velocity
    const forward = new THREE.Vector3(0, 0, 1);
    forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.vehicle.rotation.y);
    forward.multiplyScalar(this.vehicle.speed);

    this.vehicle.velocity.x = forward.x;
    this.vehicle.velocity.z = forward.z;

    // Update position
    this.vehicle.position.x += this.vehicle.velocity.x * deltaTime;
    this.vehicle.position.z += this.vehicle.velocity.z * deltaTime;

    // Update elevation from terrain
    const terrainHeight = this.getTerrainHeightAtPosition(
      this.vehicle.position.x,
      this.vehicle.position.z
    );
    this.vehicle.position.y = terrainHeight + 1; // Vehicle height above ground

    // Update distance traveled
    this.score.totalDistance += Math.abs(this.vehicle.speed) * deltaTime;

    // Tilt based on terrain
    this.vehicle.rotation.x = -slopeAngle * 0.5;
  }

  /**
   * Get terrain height at a position
   */
  private getTerrainHeightAtPosition(x: number, z: number): number {
    if (!this.world) return 0;

    const terrain = this.world.terrain;
    const bounds = this.world.bounds;

    // Convert world position to terrain grid coordinates
    const tx = (x - bounds.minX) / terrain.resolution;
    const tz = (z - bounds.minZ) / terrain.resolution;

    const x0 = Math.floor(tx);
    const z0 = Math.floor(tz);
    const x1 = Math.min(x0 + 1, terrain.width - 1);
    const z1 = Math.min(z0 + 1, terrain.height - 1);

    if (x0 < 0 || x0 >= terrain.width || z0 < 0 || z0 >= terrain.height) {
      return this.world.bounds.minY;
    }

    // Bilinear interpolation
    const fx = tx - x0;
    const fz = tz - z0;

    const h00 = terrain.heightmap[z0 * terrain.width + x0] || 0;
    const h10 = terrain.heightmap[z0 * terrain.width + x1] || 0;
    const h01 = terrain.heightmap[z1 * terrain.width + x0] || 0;
    const h11 = terrain.heightmap[z1 * terrain.width + x1] || 0;

    const height =
      h00 * (1 - fx) * (1 - fz) +
      h10 * fx * (1 - fz) +
      h01 * (1 - fx) * fz +
      h11 * fx * fz;

    return height;
  }

  /**
   * Get terrain slope at a position (positive = uphill in movement direction)
   */
  private getTerrainSlopeAtPosition(x: number, z: number): number {
    const sampleDist = 2;
    const forward = new THREE.Vector3(0, 0, 1);
    forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.vehicle.rotation.y);

    const h1 = this.getTerrainHeightAtPosition(x, z);
    const h2 = this.getTerrainHeightAtPosition(
      x + forward.x * sampleDist,
      z + forward.z * sampleDist
    );

    return Math.atan2(h2 - h1, sampleDist);
  }

  /**
   * Update camera to follow vehicle
   */
  private updateCamera(): void {
    const cameraOffset = new THREE.Vector3(0, 8, -15);
    const lookOffset = new THREE.Vector3(0, 2, 10);

    // Rotate offset by vehicle rotation
    cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.vehicle.rotation.y);
    lookOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.vehicle.rotation.y);

    // Smooth camera follow
    const targetPos = new THREE.Vector3(
      this.vehicle.position.x + cameraOffset.x,
      this.vehicle.position.y + cameraOffset.y,
      this.vehicle.position.z + cameraOffset.z
    );

    this.camera.position.lerp(targetPos, 0.1);

    const lookAt = new THREE.Vector3(
      this.vehicle.position.x + lookOffset.x,
      this.vehicle.position.y + lookOffset.y,
      this.vehicle.position.z + lookOffset.z
    );

    this.camera.lookAt(lookAt);
  }

  /**
   * Update vehicle mesh position and rotation
   */
  private updateVehicleMesh(): void {
    if (!this.vehicleMesh) return;

    this.vehicleMesh.position.set(
      this.vehicle.position.x,
      this.vehicle.position.y,
      this.vehicle.position.z
    );

    this.vehicleMesh.rotation.set(
      this.vehicle.rotation.x,
      this.vehicle.rotation.y,
      this.vehicle.rotation.z
    );

    // Update blade position
    const blade = this.vehicleMesh.getObjectByName('blade');
    if (blade) {
      blade.position.y = this.vehicle.blade.lowered ? 0 : 1;
    }

    // Update lights visibility
    for (const light of this.vehicleHeadlights) {
      light.visible = this.vehicle.lights.headlights;
    }
    for (const light of this.vehicleWorkLights) {
      light.visible = this.vehicle.lights.workLights;
    }
    if (this.beaconLight) {
      this.beaconLight.visible = this.vehicle.lights.beacon;
      // Pulse beacon
      if (this.vehicle.lights.beacon) {
        this.beaconLight.intensity = 2 + Math.sin(Date.now() * 0.01) * 1.5;
      }
    }

    // Update beacon mesh
    const beacon = this.vehicleMesh.getObjectByName('beacon');
    if (beacon && beacon instanceof THREE.Mesh) {
      const material = beacon.material as THREE.MeshBasicMaterial;
      material.opacity = this.vehicle.lights.beacon
        ? 0.6 + Math.sin(Date.now() * 0.01) * 0.4
        : 0.2;
    }
  }

  /**
   * Update grooming progress
   */
  private updateGrooming(): void {
    if (!this.vehicle.blade.lowered || !this.world) return;

    // Find which run we're on and update grooming
    for (const run of this.world.runs) {
      const state = this.runStates.get(run.id);
      if (!state) continue;

      // Check distance to run path
      for (let i = 0; i < run.path.length - 1; i++) {
        const p1 = run.path[i];
        const p2 = run.path[i + 1];

        // Check if vehicle is near this segment
        const dist = this.pointToSegmentDistance(
          this.vehicle.position.x,
          this.vehicle.position.z,
          p1.x,
          p1.z,
          p2.x,
          p2.z
        );

        const runWidth = run.widths[i] || run.averageWidth;
        if (dist < runWidth / 2) {
          // Calculate lateral offset (-1 to 1)
          const lateralOffset = (dist / (runWidth / 2)) *
            (this.isLeftOfSegment(
              this.vehicle.position.x,
              this.vehicle.position.z,
              p1.x,
              p1.z,
              p2.x,
              p2.z
            ) ? -1 : 1);

          // Add groomed segment
          const segment: GroomedSegment = {
            startIndex: i,
            endIndex: i + 1,
            lateralOffset,
            timestamp: Date.now(),
          };

          // Check if this segment overlaps with existing groomed segments
          if (!this.isSegmentGroomed(state, segment)) {
            state.groomedSegments.push(segment);
            this.updateGroomingProgress(run, state);
            this.updateGroomingVisuals(run, state);
          }
        }
      }
    }
  }

  /**
   * Calculate point to line segment distance
   */
  private pointToSegmentDistance(
    px: number,
    pz: number,
    x1: number,
    z1: number,
    x2: number,
    z2: number
  ): number {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const lengthSq = dx * dx + dz * dz;

    if (lengthSq === 0) {
      return Math.sqrt((px - x1) ** 2 + (pz - z1) ** 2);
    }

    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lengthSq));
    const projX = x1 + t * dx;
    const projZ = z1 + t * dz;

    return Math.sqrt((px - projX) ** 2 + (pz - projZ) ** 2);
  }

  /**
   * Check if point is left of segment
   */
  private isLeftOfSegment(
    px: number,
    pz: number,
    x1: number,
    z1: number,
    x2: number,
    z2: number
  ): boolean {
    return (x2 - x1) * (pz - z1) - (z2 - z1) * (px - x1) > 0;
  }

  /**
   * Check if a segment is already groomed
   */
  private isSegmentGroomed(state: RunGroomingState, newSegment: GroomedSegment): boolean {
    const tolerance = 0.2; // Lateral offset tolerance

    for (const segment of state.groomedSegments) {
      if (
        segment.startIndex === newSegment.startIndex &&
        Math.abs(segment.lateralOffset - newSegment.lateralOffset) < tolerance
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Update grooming progress and scoring
   */
  private updateGroomingProgress(run: GameRun, state: RunGroomingState): void {
    // Calculate how much of the run is groomed
    const uniqueSegments = new Set<string>();

    for (const segment of state.groomedSegments) {
      // Discretize lateral offset into passes
      const passIndex = Math.floor((segment.lateralOffset + 1) * state.passesRequired / 2);
      uniqueSegments.add(`${segment.startIndex}-${passIndex}`);
    }

    const totalSegments = (run.path.length - 1) * state.passesRequired;
    const previousProgress = state.groomingProgress;
    state.groomingProgress = uniqueSegments.size / totalSegments;

    // Award points for progress
    const progressDelta = state.groomingProgress - previousProgress;
    if (progressDelta > 0) {
      const pointsEarned = Math.round(run.pointValue * progressDelta);
      state.pointsEarned += pointsEarned;
      this.score.totalPoints += pointsEarned;

      // Check for run completion
      if (state.groomingProgress >= 0.95 && previousProgress < 0.95) {
        this.score.runsGroomed++;

        // Add difficulty bonus
        if (run.difficulty) {
          const bonus: ScoreBonus = {
            type: 'difficulty',
            name: `${run.difficulty.charAt(0).toUpperCase() + run.difficulty.slice(1)} Run`,
            points: Math.round(run.pointValue * 0.2),
            description: `Completed a ${run.difficulty} run`,
          };
          this.score.bonuses.push(bonus);
          this.score.totalPoints += bonus.points;
        }

        // Add length bonus for long runs
        if (run.length > 1000) {
          const bonus: ScoreBonus = {
            type: 'length',
            name: 'Long Run',
            points: Math.round(run.length / 10),
            description: `Groomed ${Math.round(run.length)}m run`,
          };
          this.score.bonuses.push(bonus);
          this.score.totalPoints += bonus.points;
        }

        // Perfect run bonus (if covered full width)
        if (state.groomingProgress >= 0.98) {
          const bonus: ScoreBonus = {
            type: 'perfect_run',
            name: 'Perfect Grooming',
            points: 500,
            description: 'Complete coverage of run width',
          };
          this.score.bonuses.push(bonus);
          this.score.totalPoints += bonus.points;
        }
      }

      this.onScoreUpdate?.(this.score);
      this.onRunGroomed?.(run.id, state.groomingProgress);
    }
  }

  /**
   * Update grooming trail visuals
   */
  private updateGroomingVisuals(run: GameRun, state: RunGroomingState): void {
    // Create or update grooming trail mesh
    let trailMesh = this.groomingTrailMeshes.get(run.id);

    if (!trailMesh && state.groomedSegments.length > 0) {
      // Create new grooming trail
      const geometry = new THREE.BufferGeometry();
      const material = new THREE.MeshBasicMaterial({
        color: 0x88aaff,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
      });

      trailMesh = new THREE.Mesh(geometry, material);
      this.scene.add(trailMesh);
      this.groomingTrailMeshes.set(run.id, trailMesh);
    }

    // Update geometry would go here - simplified for now
  }

  /**
   * Update visual effects
   */
  private updateEffects(deltaTime: number): void {
    // Update snow particles
    if (this.snowParticles) {
      const positions = this.snowParticles.geometry.attributes.position as THREE.BufferAttribute;
      const velocities = this.snowParticles.geometry.attributes.velocity as THREE.BufferAttribute;

      for (let i = 0; i < positions.count; i++) {
        let x = positions.getX(i) + velocities.getX(i) * deltaTime * 30;
        let y = positions.getY(i) + velocities.getY(i) * deltaTime * 30;
        let z = positions.getZ(i) + velocities.getZ(i) * deltaTime * 30;

        // Wrap around to follow vehicle
        const dx = x - this.vehicle.position.x;
        const dz = z - this.vehicle.position.z;
        if (Math.abs(dx) > 250) x = this.vehicle.position.x + (Math.random() - 0.5) * 500;
        if (Math.abs(dz) > 250) z = this.vehicle.position.z + (Math.random() - 0.5) * 500;
        if (y < 0) y = 200;

        positions.setXYZ(i, x, y, z);
      }
      positions.needsUpdate = true;

      // Move snow particle system with vehicle
      this.snowParticles.position.set(this.vehicle.position.x, 0, this.vehicle.position.z);
    }

    // Rotate star field slowly
    if (this.starField) {
      this.starField.rotation.y += deltaTime * 0.001;
    }
  }

  /**
   * Render the scene
   */
  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Start the game loop
   */
  start(): void {
    this.lastTime = performance.now();
    this.gameLoop();
  }

  private gameLoop = (): void => {
    this.animationId = requestAnimationFrame(this.gameLoop);

    const currentTime = performance.now();
    const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.1); // Cap at 100ms
    this.lastTime = currentTime;

    this.update(deltaTime);
    this.render();
  };

  /**
   * Stop the game loop
   */
  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * Pause the game
   */
  pause(): void {
    if (this.gameState === 'playing') {
      this.gameState = 'paused';
      this.onGameStateChange?.(this.gameState);
    }
  }

  /**
   * Resume the game
   */
  resume(): void {
    if (this.gameState === 'paused') {
      this.gameState = 'playing';
      this.onGameStateChange?.(this.gameState);
    }
  }

  /**
   * Handle window resize
   */
  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /**
   * Set callbacks
   */
  setCallbacks(callbacks: {
    onScoreUpdate?: (score: GameScore) => void;
    onRunGroomed?: (runId: string, progress: number) => void;
    onGameStateChange?: (state: GameState) => void;
  }): void {
    this.onScoreUpdate = callbacks.onScoreUpdate;
    this.onRunGroomed = callbacks.onRunGroomed;
    this.onGameStateChange = callbacks.onGameStateChange;
  }

  /**
   * Get current score
   */
  getScore(): GameScore {
    return { ...this.score };
  }

  /**
   * Get run grooming states
   */
  getRunStates(): Map<string, RunGroomingState> {
    return new Map(this.runStates);
  }

  /**
   * Get game state
   */
  getGameState(): GameState {
    return this.gameState;
  }

  /**
   * Get vehicle state (for HUD)
   */
  getVehicleState(): VehicleState {
    return { ...this.vehicle };
  }

  /**
   * Cleanup
   */
  dispose(): void {
    this.stop();
    this.clearWorld();

    if (this.starField) {
      this.scene.remove(this.starField);
      this.starField.geometry.dispose();
      (this.starField.material as THREE.Material).dispose();
    }

    this.renderer.dispose();
  }
}

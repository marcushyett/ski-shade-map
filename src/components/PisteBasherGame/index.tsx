'use client';

import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { Modal, Button, Progress, Spin } from 'antd';
import {
  PlayCircleOutlined,
  PauseOutlined,
  CloseOutlined,
  CarOutlined,
  WarningOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
} from '@ant-design/icons';
import type { RunData, LiftData, BoundingBox } from '@/lib/types';
import type { GameScore, GameState, VehicleState, RunGroomingState } from '@/lib/piste-basher/types';
import { DIFFICULTY_COLORS } from '@/lib/piste-basher/types';
import { PisteBasherEngine } from '@/lib/piste-basher/game-engine';
import { generateGameWorld } from '@/lib/piste-basher/world-generator';

interface PisteBasherGameProps {
  visible: boolean;
  onClose: () => void;
  runs: RunData[];
  lifts: LiftData[];
  bounds: BoundingBox;
  skiAreaName: string;
}

// Touch control joystick component
const TouchJoystick = memo(function TouchJoystick({
  position,
  size,
  value,
  onChange,
  label,
}: {
  position: 'left' | 'right';
  size: number;
  value: { x: number; y: number };
  onChange: (value: { x: number; y: number }) => void;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [touchId, setTouchId] = useState<number | null>(null);

  const handleStart = useCallback((clientX: number, clientY: number, id?: number) => {
    setIsDragging(true);
    if (id !== undefined) setTouchId(id);
  }, []);

  const handleMove = useCallback((clientX: number, clientY: number) => {
    if (!isDragging || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = (clientX - centerX) / (size / 2);
    const dy = (clientY - centerY) / (size / 2);

    // Clamp to unit circle
    const magnitude = Math.sqrt(dx * dx + dy * dy);
    if (magnitude > 1) {
      onChange({ x: dx / magnitude, y: dy / magnitude });
    } else {
      onChange({ x: dx, y: dy });
    }
  }, [isDragging, size, onChange]);

  const handleEnd = useCallback(() => {
    setIsDragging(false);
    setTouchId(null);
    onChange({ x: 0, y: 0 });
  }, [onChange]);

  useEffect(() => {
    const handleTouchMove = (e: TouchEvent) => {
      if (touchId === null) return;
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === touchId) {
          handleMove(e.touches[i].clientX, e.touches[i].clientY);
          break;
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchId === null) return;
      let found = false;
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === touchId) {
          found = true;
          break;
        }
      }
      if (!found) handleEnd();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging && touchId === null) {
        handleMove(e.clientX, e.clientY);
      }
    };

    const handleMouseUp = () => {
      if (isDragging && touchId === null) {
        handleEnd();
      }
    };

    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [touchId, isDragging, handleMove, handleEnd]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        [position]: 20,
        bottom: 20,
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'rgba(255, 255, 255, 0.1)',
        border: '2px solid rgba(255, 255, 255, 0.3)',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onTouchStart={(e) => {
        e.preventDefault();
        const touch = e.touches[0];
        handleStart(touch.clientX, touch.clientY, touch.identifier);
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        handleStart(e.clientX, e.clientY);
      }}
    >
      {/* Inner joystick knob */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: size * 0.4,
          height: size * 0.4,
          borderRadius: '50%',
          background: isDragging ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.4)',
          transform: `translate(-50%, -50%) translate(${value.x * size * 0.3}px, ${value.y * size * 0.3}px)`,
          transition: isDragging ? 'none' : 'transform 0.1s ease-out',
        }}
      />
      {/* Label */}
      <div
        style={{
          position: 'absolute',
          bottom: -25,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 11,
          color: 'rgba(255, 255, 255, 0.6)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
    </div>
  );
});

// Action button for touch controls
const ActionButton = memo(function ActionButton({
  icon,
  label,
  active,
  onPress,
  onRelease,
  style,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onPress: () => void;
  onRelease: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      style={{
        width: 60,
        height: 60,
        borderRadius: 8,
        border: 'none',
        background: active ? 'rgba(255, 170, 0, 0.6)' : 'rgba(255, 255, 255, 0.1)',
        color: active ? '#fff' : 'rgba(255, 255, 255, 0.7)',
        fontSize: 24,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        touchAction: 'none',
        userSelect: 'none',
        cursor: 'pointer',
        ...style,
      }}
      onTouchStart={(e) => {
        e.preventDefault();
        onPress();
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        onRelease();
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      onMouseUp={(e) => {
        e.preventDefault();
        onRelease();
      }}
      onMouseLeave={onRelease}
    >
      {icon}
      <span style={{ fontSize: 9 }}>{label}</span>
    </button>
  );
});

// Vehicle HUD component
const VehicleHUD = memo(function VehicleHUD({
  vehicle,
  score,
}: {
  vehicle: VehicleState;
  score: GameScore;
}) {
  const speedKmh = Math.abs(vehicle.speed * 3.6).toFixed(1);
  const fuelPercent = Math.max(0, 100 - (score.fuelUsed / 200) * 100); // Assume 200L tank

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        left: 10,
        padding: '10px 15px',
        background: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 8,
        color: '#fff',
        fontSize: 12,
        minWidth: 150,
      }}
    >
      {/* Speedometer */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ color: '#888', marginBottom: 2 }}>SPEED</div>
        <div style={{ fontSize: 24, fontWeight: 'bold', fontFamily: 'monospace' }}>
          {speedKmh} <span style={{ fontSize: 12, color: '#888' }}>km/h</span>
        </div>
      </div>

      {/* Fuel gauge */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ color: '#888', marginBottom: 2 }}>FUEL</div>
        <Progress
          percent={fuelPercent}
          size="small"
          strokeColor={fuelPercent < 20 ? '#ff4d4f' : '#52c41a'}
          showInfo={false}
        />
      </div>

      {/* Blade status */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ color: '#888', marginBottom: 2 }}>BLADE</div>
        <div style={{
          color: vehicle.blade.lowered ? '#ffaa00' : '#666',
          fontWeight: vehicle.blade.lowered ? 'bold' : 'normal',
        }}>
          {vehicle.blade.lowered ? 'LOWERED - GROOMING' : 'RAISED'}
        </div>
      </div>

      {/* Lights */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{
          padding: '2px 6px',
          borderRadius: 4,
          background: vehicle.lights.headlights ? '#ffff00' : '#333',
          color: vehicle.lights.headlights ? '#000' : '#666',
          fontSize: 10,
        }}>
          HEAD
        </div>
        <div style={{
          padding: '2px 6px',
          borderRadius: 4,
          background: vehicle.lights.workLights ? '#ffffaa' : '#333',
          color: vehicle.lights.workLights ? '#000' : '#666',
          fontSize: 10,
        }}>
          WORK
        </div>
        <div style={{
          padding: '2px 6px',
          borderRadius: 4,
          background: vehicle.lights.beacon ? '#ffaa00' : '#333',
          color: vehicle.lights.beacon ? '#000' : '#666',
          fontSize: 10,
        }}>
          BEACON
        </div>
      </div>
    </div>
  );
});

// Score panel component
const ScorePanel = memo(function ScorePanel({
  score,
  runStates,
}: {
  score: GameScore;
  runStates: Map<string, RunGroomingState>;
}) {
  // Get top runs by progress
  const sortedRuns = Array.from(runStates.values())
    .filter(r => r.groomingProgress > 0)
    .sort((a, b) => b.groomingProgress - a.groomingProgress)
    .slice(0, 5);

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        right: 10,
        padding: '10px 15px',
        background: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 8,
        color: '#fff',
        fontSize: 12,
        minWidth: 180,
      }}
    >
      {/* Score */}
      <div style={{ marginBottom: 15 }}>
        <div style={{ color: '#888', marginBottom: 2 }}>SCORE</div>
        <div style={{ fontSize: 28, fontWeight: 'bold', color: '#ffaa00' }}>
          {score.totalPoints.toLocaleString()}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 15 }}>
        <div>
          <div style={{ color: '#888', fontSize: 10 }}>RUNS</div>
          <div style={{ fontSize: 16, fontWeight: 'bold' }}>{score.runsGroomed}</div>
        </div>
        <div>
          <div style={{ color: '#888', fontSize: 10 }}>DISTANCE</div>
          <div style={{ fontSize: 16, fontWeight: 'bold' }}>
            {(score.totalDistance / 1000).toFixed(1)}km
          </div>
        </div>
        <div>
          <div style={{ color: '#888', fontSize: 10 }}>TIME</div>
          <div style={{ fontSize: 16, fontWeight: 'bold' }}>
            {Math.floor(score.timeElapsed / 60)}:{String(Math.floor(score.timeElapsed % 60)).padStart(2, '0')}
          </div>
        </div>
        <div>
          <div style={{ color: '#888', fontSize: 10 }}>FUEL</div>
          <div style={{ fontSize: 16, fontWeight: 'bold' }}>
            {score.fuelUsed.toFixed(0)}L
          </div>
        </div>
      </div>

      {/* Run progress */}
      {sortedRuns.length > 0 && (
        <div>
          <div style={{ color: '#888', marginBottom: 6, fontSize: 10 }}>GROOMING PROGRESS</div>
          {sortedRuns.map((run) => (
            <div key={run.runId} style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                <span style={{
                  color: run.difficulty ? DIFFICULTY_COLORS[run.difficulty] : '#888',
                  maxWidth: 100,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {run.runName || 'Unknown'}
                </span>
                <span>{Math.round(run.groomingProgress * 100)}%</span>
              </div>
              <Progress
                percent={run.groomingProgress * 100}
                size="small"
                strokeColor={run.difficulty ? DIFFICULTY_COLORS[run.difficulty] : '#888'}
                showInfo={false}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// Control instructions
const ControlInstructions = memo(function ControlInstructions({ isMobile }: { isMobile: boolean }) {
  if (isMobile) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 10,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '8px 16px',
        background: 'rgba(0, 0, 0, 0.6)',
        borderRadius: 8,
        color: 'rgba(255, 255, 255, 0.7)',
        fontSize: 11,
        display: 'flex',
        gap: 20,
      }}
    >
      <span><b>W/S</b> or <b>Up/Down</b> - Drive</span>
      <span><b>A/D</b> or <b>Left/Right</b> - Steer</span>
      <span><b>Space</b> - Lower/Raise Blade</span>
      <span><b>M</b> - Toggle Map</span>
      <span><b>ESC</b> - Pause</span>
    </div>
  );
});

// Minimap component showing position on ski area
const Minimap = memo(function Minimap({
  runs,
  vehicle,
  bounds,
  visible,
}: {
  runs: RunData[];
  vehicle: VehicleState | null;
  bounds: BoundingBox;
  visible: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Convert game coordinates to minimap coordinates
  const gameToMinimap = useCallback((x: number, z: number, width: number, height: number) => {
    // Game uses meters from center, we need to map to minimap
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    const centerLng = (bounds.minLng + bounds.maxLng) / 2;

    // Approximate conversion (meters to lat/lng)
    const EARTH_RADIUS = 6371000;
    const latDiff = -z / (EARTH_RADIUS * Math.PI / 180);
    const lngDiff = x / (EARTH_RADIUS * Math.PI / 180 * Math.cos(centerLat * Math.PI / 180));

    const lat = centerLat + latDiff;
    const lng = centerLng + lngDiff;

    // Map to minimap coordinates
    const mx = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * width;
    const my = ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * height;

    return { mx, my };
  }, [bounds]);

  useEffect(() => {
    if (!visible || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, width, height);

    // Draw runs
    for (const run of runs) {
      if (!run.geometry || run.geometry.type !== 'LineString') continue;
      const coords = run.geometry.coordinates as Array<[number, number]>;
      if (coords.length < 2) continue;

      ctx.beginPath();
      ctx.strokeStyle = run.difficulty ? DIFFICULTY_COLORS[run.difficulty] : '#888888';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const [lng0, lat0] = coords[0];
      const x0 = ((lng0 - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * width;
      const y0 = ((bounds.maxLat - lat0) / (bounds.maxLat - bounds.minLat)) * height;
      ctx.moveTo(x0, y0);

      for (let i = 1; i < coords.length; i++) {
        const [lng, lat] = coords[i];
        const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * width;
        const y = ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * height;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Draw vehicle position
    if (vehicle) {
      const { mx, my } = gameToMinimap(vehicle.position.x, vehicle.position.z, width, height);

      // Vehicle direction indicator
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(vehicle.rotation.y);

      // Draw arrow
      ctx.beginPath();
      ctx.fillStyle = '#ff4444';
      ctx.moveTo(0, -8);
      ctx.lineTo(-5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(5, 6);
      ctx.closePath();
      ctx.fill();

      // Outer glow
      ctx.shadowColor = '#ff4444';
      ctx.shadowBlur = 10;
      ctx.fill();

      ctx.restore();
    }
  }, [visible, runs, vehicle, bounds, gameToMinimap]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 80,
        left: 10,
        width: 180,
        height: 180,
        background: 'rgba(0, 0, 0, 0.7)',
        border: '2px solid rgba(255, 255, 255, 0.3)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div style={{
        position: 'absolute',
        top: 4,
        left: 4,
        right: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        color: 'rgba(255, 255, 255, 0.7)',
        fontSize: 10,
        zIndex: 1,
      }}>
        <EnvironmentOutlined />
        <span>MAP</span>
      </div>
      <canvas
        ref={canvasRef}
        width={180}
        height={180}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
});

// Main game component
export default function PisteBasherGame({
  visible,
  onClose,
  runs,
  lifts,
  bounds,
  skiAreaName,
}: PisteBasherGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PisteBasherEngine | null>(null);

  const [gameState, setGameState] = useState<GameState>('menu');
  const [score, setScore] = useState<GameScore>({
    totalPoints: 0,
    runsGroomed: 0,
    totalDistance: 0,
    fuelUsed: 0,
    timeElapsed: 0,
    bonuses: [],
  });
  const [vehicle, setVehicle] = useState<VehicleState | null>(null);
  const [runStates, setRunStates] = useState<Map<string, RunGroomingState>>(new Map());
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);
  const [showPisteOverlay, setShowPisteOverlay] = useState(false);

  // Touch control state
  const [leftJoystick, setLeftJoystick] = useState({ x: 0, y: 0 });
  const [rightJoystick, setRightJoystick] = useState({ x: 0, y: 0 });
  const [bladePressed, setBladePressed] = useState(false);

  // Check if mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768 || 'ontouchstart' in window);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Initialize game engine
  useEffect(() => {
    if (!visible || !containerRef.current) return;

    const engine = new PisteBasherEngine();
    engine.initialize(containerRef.current);
    engine.setCallbacks({
      onScoreUpdate: setScore,
      onGameStateChange: setGameState,
      onRunGroomed: () => {
        setRunStates(new Map(engine.getRunStates()));
      },
    });
    engineRef.current = engine;

    // Handle resize
    const handleResize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        engine.resize(rect.width, rect.height);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      engine.dispose();
      engineRef.current = null;
    };
  }, [visible]);

  // Start game
  const startGame = useCallback(async () => {
    if (!engineRef.current) return;

    // Show loading immediately for responsiveness
    setLoading(true);
    setLoadingMessage('Preparing ski area...');

    // Give the UI a moment to update before heavy processing
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      setLoadingMessage('Generating terrain...');

      // Generate world without blocking on building fetch
      const world = await generateGameWorld(runs, lifts, bounds, {
        useRealElevation: false, // Use simulated for performance
        fetchBuildings: false, // Disabled for faster startup - buildings fetched in background
      });

      setLoadingMessage('Planting trees...');
      await new Promise(resolve => setTimeout(resolve, 10));

      setLoadingMessage('Loading world...');
      await engineRef.current.loadWorld(world);

      setLoadingMessage('Positioning vehicle...');
      await new Promise(resolve => setTimeout(resolve, 10));

      setLoadingMessage('Starting engine...');
      engineRef.current.start();
      setGameState('playing');
    } catch (error) {
      console.error('Failed to start game:', error);
      setLoadingMessage('Failed to start game');
    } finally {
      setLoading(false);
    }
  }, [runs, lifts, bounds]);

  // Keyboard controls
  useEffect(() => {
    if (!visible || gameState !== 'playing') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!engineRef.current) return;

      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          engineRef.current.setControlInput({ forward: true });
          break;
        case 's':
        case 'arrowdown':
          engineRef.current.setControlInput({ backward: true });
          break;
        case 'a':
        case 'arrowleft':
          engineRef.current.setControlInput({ left: true });
          break;
        case 'd':
        case 'arrowright':
          engineRef.current.setControlInput({ right: true });
          break;
        case ' ':
          const currentVehicle = engineRef.current.getVehicleState();
          if (currentVehicle.blade.lowered) {
            engineRef.current.setControlInput({ bladeRaise: true });
          } else {
            engineRef.current.setControlInput({ bladeLower: true });
          }
          break;
        case 'l':
          // Toggle lights
          break;
        case 'm':
          // Toggle minimap
          setShowMinimap(prev => !prev);
          break;
        case 'o':
          // Toggle piste overlay
          setShowPisteOverlay(prev => {
            const newVal = !prev;
            if (engineRef.current) {
              engineRef.current.togglePisteOverlay();
            }
            return newVal;
          });
          break;
        case 'escape':
          engineRef.current.pause();
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!engineRef.current) return;

      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          engineRef.current.setControlInput({ forward: false });
          break;
        case 's':
        case 'arrowdown':
          engineRef.current.setControlInput({ backward: false });
          break;
        case 'a':
        case 'arrowleft':
          engineRef.current.setControlInput({ left: false });
          break;
        case 'd':
        case 'arrowright':
          engineRef.current.setControlInput({ right: false });
          break;
        case ' ':
          engineRef.current.setControlInput({ bladeLower: false, bladeRaise: false });
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [visible, gameState]);

  // Touch controls
  useEffect(() => {
    if (!engineRef.current || gameState !== 'playing') return;

    // Left joystick controls forward/backward
    engineRef.current.setControlInput({
      forward: leftJoystick.y < -0.3,
      backward: leftJoystick.y > 0.3,
    });

    // Right joystick controls steering
    engineRef.current.setControlInput({
      left: rightJoystick.x < -0.3,
      right: rightJoystick.x > 0.3,
    });
  }, [leftJoystick, rightJoystick, gameState]);

  // Update blade from button
  useEffect(() => {
    if (!engineRef.current || gameState !== 'playing') return;

    if (bladePressed) {
      const currentVehicle = engineRef.current.getVehicleState();
      if (currentVehicle.blade.lowered) {
        engineRef.current.setControlInput({ bladeRaise: true, bladeLower: false });
      } else {
        engineRef.current.setControlInput({ bladeLower: true, bladeRaise: false });
      }
    } else {
      engineRef.current.setControlInput({ bladeLower: false, bladeRaise: false });
    }
  }, [bladePressed, gameState]);

  // Update vehicle state for HUD
  useEffect(() => {
    if (!visible || gameState !== 'playing') return;

    const interval = setInterval(() => {
      if (engineRef.current) {
        setVehicle(engineRef.current.getVehicleState());
      }
    }, 100);

    return () => clearInterval(interval);
  }, [visible, gameState]);

  // Handle close
  const handleClose = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.stop();
    }
    setGameState('menu');
    onClose();
  }, [onClose]);

  // Pause/resume
  const togglePause = useCallback(() => {
    if (!engineRef.current) return;

    if (gameState === 'playing') {
      engineRef.current.pause();
    } else if (gameState === 'paused') {
      engineRef.current.resume();
    }
  }, [gameState]);

  return (
    <Modal
      open={visible}
      onCancel={handleClose}
      footer={null}
      width="100%"
      style={{
        maxWidth: '100vw',
        top: 0,
        padding: 0,
        margin: 0,
      }}
      styles={{
        body: {
          padding: 0,
          height: '100vh',
          background: '#000',
        },
        mask: { background: 'rgba(0, 0, 0, 0.9)' },
      }}
      closable={false}
      maskClosable={false}
    >
      {/* Game canvas container */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
      >
        {/* Header bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 50,
            background: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 15px',
            zIndex: 100,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CarOutlined style={{ fontSize: 20, color: '#ff4444' }} />
            <span style={{ color: '#fff', fontWeight: 'bold' }}>
              PISTE BASHER
            </span>
            <span style={{ color: '#888', fontSize: 12 }}>
              {skiAreaName}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            {gameState === 'playing' && (
              <>
                <Button
                  icon={<EnvironmentOutlined />}
                  onClick={() => setShowMinimap(prev => !prev)}
                  type="text"
                  style={{ color: showMinimap ? '#ffaa00' : '#fff' }}
                  title="Toggle minimap (M)"
                />
                <Button
                  icon={showPisteOverlay ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                  onClick={() => {
                    setShowPisteOverlay(prev => !prev);
                    if (engineRef.current) {
                      engineRef.current.togglePisteOverlay();
                    }
                  }}
                  type="text"
                  style={{ color: showPisteOverlay ? '#ffaa00' : '#fff' }}
                  title="Toggle piste overlay (O)"
                />
                <Button
                  icon={<PauseOutlined />}
                  onClick={togglePause}
                  type="text"
                  style={{ color: '#fff' }}
                />
              </>
            )}
            <Button
              icon={<CloseOutlined />}
              onClick={handleClose}
              type="text"
              style={{ color: '#fff' }}
            />
          </div>
        </div>

        {/* Menu overlay */}
        {gameState === 'menu' && !loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(180deg, rgba(10,10,30,0.95) 0%, rgba(20,20,50,0.95) 100%)',
              zIndex: 50,
            }}
          >
            <CarOutlined style={{ fontSize: 80, color: '#ff4444', marginBottom: 20 }} />
            <h1 style={{ color: '#fff', fontSize: 36, margin: 0, fontWeight: 'bold' }}>
              PISTE BASHER
            </h1>
            <p style={{ color: '#888', fontSize: 14, marginTop: 8, marginBottom: 30 }}>
              Groom the slopes of {skiAreaName}
            </p>

            <div style={{
              background: 'rgba(255, 255, 255, 0.1)',
              borderRadius: 8,
              padding: 20,
              marginBottom: 30,
              maxWidth: 400,
            }}>
              <h3 style={{ color: '#ffaa00', margin: '0 0 10px 0', fontSize: 14 }}>HOW TO PLAY</h3>
              <ul style={{ color: '#ccc', fontSize: 12, margin: 0, paddingLeft: 20 }}>
                <li style={{ marginBottom: 6 }}>Drive the piste basher up and down ski runs at night</li>
                <li style={{ marginBottom: 6 }}>Lower the blade to groom the snow</li>
                <li style={{ marginBottom: 6 }}>Cover the full width of runs by making multiple passes</li>
                <li style={{ marginBottom: 6 }}>Earn more points for harder and longer runs</li>
                <li>Watch out for steep slopes - they affect handling!</li>
              </ul>
            </div>

            <div style={{
              marginBottom: 30,
              textAlign: 'center',
              color: '#888',
              fontSize: 12,
            }}>
              <div style={{ marginBottom: 5 }}>
                <strong>{runs.length}</strong> runs to groom
              </div>
              <div>
                Total points available: <strong style={{ color: '#ffaa00' }}>
                  {runs.reduce((sum, run) => {
                    const mult = run.difficulty ? { novice: 1, easy: 1.5, intermediate: 2, advanced: 3, expert: 5 }[run.difficulty] : 1;
                    return sum + Math.round(100 * mult);
                  }, 0).toLocaleString()}
                </strong>
              </div>
            </div>

            <Button
              type="primary"
              size="large"
              icon={<PlayCircleOutlined />}
              onClick={startGame}
              style={{
                background: '#ff4444',
                borderColor: '#ff4444',
                height: 50,
                fontSize: 18,
                paddingLeft: 40,
                paddingRight: 40,
              }}
            >
              START GROOMING
            </Button>
          </div>
        )}

        {/* Loading overlay */}
        {loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.9)',
              zIndex: 50,
            }}
          >
            <Spin size="large" />
            <p style={{ color: '#fff', marginTop: 20 }}>{loadingMessage}</p>
          </div>
        )}

        {/* Pause overlay */}
        {gameState === 'paused' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.8)',
              zIndex: 50,
            }}
          >
            <h2 style={{ color: '#fff', marginBottom: 30 }}>PAUSED</h2>
            <div style={{ display: 'flex', gap: 15 }}>
              <Button
                type="primary"
                size="large"
                icon={<PlayCircleOutlined />}
                onClick={togglePause}
              >
                RESUME
              </Button>
              <Button
                size="large"
                onClick={handleClose}
              >
                QUIT
              </Button>
            </div>
          </div>
        )}

        {/* Game HUD */}
        {gameState === 'playing' && vehicle && (
          <>
            <VehicleHUD vehicle={vehicle} score={score} />
            <ScorePanel score={score} runStates={runStates} />
            <Minimap runs={runs} vehicle={vehicle} bounds={bounds} visible={showMinimap} />
            <ControlInstructions isMobile={isMobile} />

            {/* Mobile touch controls */}
            {isMobile && (
              <>
                <TouchJoystick
                  position="left"
                  size={120}
                  value={leftJoystick}
                  onChange={setLeftJoystick}
                  label="DRIVE"
                />
                <TouchJoystick
                  position="right"
                  size={120}
                  value={rightJoystick}
                  onChange={setRightJoystick}
                  label="STEER"
                />

                {/* Action buttons */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 150,
                    right: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <ActionButton
                    icon={<WarningOutlined />}
                    label="BLADE"
                    active={vehicle.blade.lowered}
                    onPress={() => setBladePressed(true)}
                    onRelease={() => setBladePressed(false)}
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

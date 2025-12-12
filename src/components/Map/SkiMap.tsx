'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getSunPosition } from '@/lib/suncalc';
import { getDifficultyColor } from '@/lib/shade-calculator';
import LoadingSpinner from '@/components/LoadingSpinner';
import type { SkiAreaDetails } from '@/lib/types';
import type { LineString, Feature, FeatureCollection, Point } from 'geojson';

interface CloudCover {
  total: number;
  low: number;
  mid: number;
  high: number;
  visibility: number;
}

interface MapViewState {
  lat: number;
  lng: number;
  zoom: number;
}

interface SkiMapProps {
  skiArea: SkiAreaDetails | null;
  selectedTime: Date;
  is3D: boolean;
  onMapReady?: () => void;
  highlightedFeatureId?: string | null;
  cloudCover?: CloudCover | null;
  initialView?: MapViewState | null;
  onViewChange?: (view: MapViewState) => void;
}

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || '';

// Monochrome sun/shade colors
const SUNNY_COLOR = '#ffffff';
const SHADE_COLOR = '#1a1a1a';
const NIGHT_COLOR = '#0a0a0a';

interface SegmentProperties {
  runId: string;
  runName: string | null;
  difficulty: string | null;
  segmentIndex: number;
  isShaded: boolean;
  bearing: number;
  slopeAspect: number;
}

export default function SkiMap({ skiArea, selectedTime, is3D, onMapReady, highlightedFeatureId, cloudCover, initialView, onViewChange }: SkiMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const layersInitialized = useRef(false);
  const currentSkiAreaId = useRef<string | null>(null);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingUpdateRef = useRef<{ area: SkiAreaDetails; time: Date } | null>(null);
  const currentSunAzimuth = useRef<number>(0);
  const currentSkiAreaRef = useRef<SkiAreaDetails | null>(null);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const style = `https://api.maptiler.com/maps/backdrop/style.json?key=${MAPTILER_KEY}`;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style,
      center: [6.8, 45.9],
      zoom: 10,
      pitch: is3D ? 60 : 0,
      bearing: 0,
      maxPitch: 85,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.current.addControl(new maplibregl.ScaleControl(), 'bottom-left');

    map.current.on('load', () => {
      setMapLoaded(true);
      setupTerrainAndHillshade();
      onMapReady?.();
    });

    // Update sun indicator on map move/zoom and report view changes
    map.current.on('moveend', () => {
      updateSunIndicatorPosition();
      if (map.current && onViewChange) {
        const center = map.current.getCenter();
        const zoom = map.current.getZoom();
        onViewChange({ lat: center.lat, lng: center.lng, zoom });
      }
    });

    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Update sun indicator position based on current map view
  const updateSunIndicatorPosition = useCallback(() => {
    if (!map.current || !currentSkiAreaRef.current) return;
    
    const sunIndicatorSource = map.current.getSource('sun-indicator') as maplibregl.GeoJSONSource | undefined;
    if (sunIndicatorSource) {
      sunIndicatorSource.setData(createSunIndicator(currentSkiAreaRef.current, currentSunAzimuth.current, map.current));
    }
  }, []);

  // Setup terrain source and hillshade layer
  const setupTerrainAndHillshade = useCallback(() => {
    if (!map.current) return;

    // Add terrain source
    if (!map.current.getSource('terrain-dem')) {
      map.current.addSource('terrain-dem', {
        type: 'raster-dem',
        url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`,
        tileSize: 256,
      });
    }

    // Add hillshade layer - significantly increased intensity
    if (!map.current.getLayer('terrain-hillshade')) {
      const layers = map.current.getStyle().layers;
      let insertBefore: string | undefined;
      for (const layer of layers) {
        if (layer.type === 'line' || layer.type === 'symbol') {
          insertBefore = layer.id;
          break;
        }
      }
      
      map.current.addLayer({
        id: 'terrain-hillshade',
        type: 'hillshade',
        source: 'terrain-dem',
        paint: {
          'hillshade-illumination-direction': 315,
          'hillshade-illumination-anchor': 'map',
          'hillshade-shadow-color': '#000000',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-accent-color': '#000000',
          'hillshade-exaggeration': 0.8, // Increased from 0.5
        },
      }, insertBefore);
    }

    // Add night overlay layer (initially hidden)
    if (!map.current.getLayer('night-overlay')) {
      map.current.addLayer({
        id: 'night-overlay',
        type: 'background',
        paint: {
          'background-color': '#000011',
          'background-opacity': 0,
          'background-opacity-transition': { duration: 300 },
        },
      });
    }

    // Add cloud/fog overlay layer for reduced visibility
    if (!map.current.getLayer('cloud-overlay')) {
      map.current.addLayer({
        id: 'cloud-overlay',
        type: 'background',
        paint: {
          'background-color': '#e8e8e8',  // Light gray/white mist
          'background-opacity': 0,
          'background-opacity-transition': { duration: 500 },
        },
      });
    }
  }, []);

  // Handle 3D toggle
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    if (is3D) {
      map.current.setTerrain({
        source: 'terrain-dem',
        exaggeration: 1.5,
      });
    } else {
      map.current.setTerrain(null);
    }

    map.current.easeTo({
      pitch: is3D ? 60 : 0,
      duration: 1000,
    });
  }, [is3D, mapLoaded]);

  // Update cloud/visibility overlay based on weather
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    if (!map.current.getLayer('cloud-overlay')) return;

    if (!cloudCover) {
      map.current.setPaintProperty('cloud-overlay', 'background-opacity', 0);
      return;
    }

    // Calculate opacity based on cloud cover and visibility
    // Low clouds (below 2000m) have the most impact on visibility for skiers
    // Visibility in meters - less than 5000m starts to be noticeable
    const lowCloudFactor = cloudCover.low / 100;  // 0-1
    const visibilityFactor = Math.max(0, 1 - cloudCover.visibility / 10000); // Poor vis = higher factor
    
    // Combine factors - low clouds and poor visibility create fog effect
    const fogIntensity = Math.min(0.5, (lowCloudFactor * 0.3) + (visibilityFactor * 0.3));
    
    map.current.setPaintProperty('cloud-overlay', 'background-opacity', fogIntensity);
    
    // Also adjust the sun/shade colors when visibility is poor
    // In heavy cloud/fog, switch to grey tones instead of black/white
    if (map.current.getLayer('ski-segments-sunny') && cloudCover.total > 70) {
      // When heavily overcast, make sunny segments grey instead of bright white
      const sunnyColor = cloudCover.total > 85 ? '#888888' : '#aaaaaa';
      map.current.setPaintProperty('ski-segments-sunny', 'line-color', sunnyColor);
    } else if (map.current.getLayer('ski-segments-sunny')) {
      // Clear weather - bright white for sunny
      map.current.setPaintProperty('ski-segments-sunny', 'line-color', SUNNY_COLOR);
    }
  }, [cloudCover, mapLoaded]);

  // Initialize layers when ski area changes
  useEffect(() => {
    if (!map.current || !mapLoaded || !skiArea) return;

    if (currentSkiAreaId.current !== skiArea.id) {
      currentSkiAreaId.current = skiArea.id;
      layersInitialized.current = false;

      // Use initial view if provided (from URL state), otherwise fly to ski area center
      const center = initialView 
        ? [initialView.lng, initialView.lat] as [number, number]
        : [skiArea.longitude, skiArea.latitude] as [number, number];
      const zoom = initialView?.zoom ?? 14;

      map.current.flyTo({
        center,
        zoom,
        duration: initialView ? 0 : 2000, // Instant if from URL
      });

      initializeLayers(skiArea, selectedTime);
    }
  }, [skiArea, mapLoaded, initialView]);

  // Debounced update when time changes
  useEffect(() => {
    if (!map.current || !mapLoaded || !skiArea || !layersInitialized.current) return;

    pendingUpdateRef.current = { area: skiArea, time: selectedTime };
    setIsUpdating(true);

    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }

    updateTimeoutRef.current = setTimeout(() => {
      if (pendingUpdateRef.current) {
        updateShading(pendingUpdateRef.current.area, pendingUpdateRef.current.time);
        pendingUpdateRef.current = null;
      }
      setIsUpdating(false);
    }, 50);

    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, [selectedTime, skiArea, mapLoaded]);

  // Initialize all layers for a ski area
  const initializeLayers = useCallback((area: SkiAreaDetails, time: Date) => {
    if (!map.current) return;

    // Remove existing layers
    const layersToRemove = [
      'sun-rays', 'sun-icon-glow', 'sun-icon',
      'ski-segments-sunny', 'ski-segments-shaded', 
      'ski-runs-line', 'ski-lifts', 'ski-lifts-symbols'
    ];
    layersToRemove.forEach(layerId => {
      if (map.current?.getLayer(layerId)) {
        map.current.removeLayer(layerId);
      }
    });

    const sourcesToRemove = ['sun-indicator', 'ski-segments', 'ski-runs', 'ski-lifts'];
    sourcesToRemove.forEach(sourceId => {
      if (map.current?.getSource(sourceId)) {
        map.current.removeSource(sourceId);
      }
    });

    const sunPos = getSunPosition(time, area.latitude, area.longitude);
    const isNight = sunPos.altitudeDegrees <= 0;
    
    // Store refs for map move updates
    currentSunAzimuth.current = sunPos.azimuthDegrees;
    currentSkiAreaRef.current = area;

    // Add sun indicator source
    map.current.addSource('sun-indicator', {
      type: 'geojson',
      data: createSunIndicator(area, sunPos.azimuthDegrees, map.current),
    });

    // Sun rays - bolder, white color
    map.current.addLayer({
      id: 'sun-rays',
      type: 'line',
      source: 'sun-indicator',
      filter: ['==', ['get', 'type'], 'ray'],
      layout: {
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['get', 'width'],
        'line-opacity': isNight ? 0 : ['get', 'opacity'],
        'line-opacity-transition': { duration: 200 },
      },
    });

    // Sun icon glow - larger and more intense
    map.current.addLayer({
      id: 'sun-icon-glow',
      type: 'circle',
      source: 'sun-indicator',
      filter: ['==', ['get', 'type'], 'sun'],
      paint: {
        'circle-radius': 24,
        'circle-color': '#ffffff',
        'circle-blur': 0.8,
        'circle-opacity': isNight ? 0 : 0.7,
        'circle-opacity-transition': { duration: 200 },
      },
    });

    // Sun icon - white and bold
    map.current.addLayer({
      id: 'sun-icon',
      type: 'circle',
      source: 'sun-indicator',
      filter: ['==', ['get', 'type'], 'sun'],
      paint: {
        'circle-radius': 10,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#333333',
        'circle-stroke-width': 2,
        'circle-opacity': isNight ? 0 : 1,
        'circle-opacity-transition': { duration: 200 },
      },
    });

    // Create segments source
    const segments = createRunSegments(area, time, area.latitude, area.longitude);
    map.current.addSource('ski-segments', {
      type: 'geojson',
      data: segments,
    });

    // Sunny segments layer - white
    map.current.addLayer({
      id: 'ski-segments-sunny',
      type: 'line',
      source: 'ski-segments',
      filter: ['==', ['get', 'isShaded'], false],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': SUNNY_COLOR,
        'line-width': 14,
        'line-blur': 2,
        'line-opacity': 0.85,
        'line-opacity-transition': { duration: 200 },
      },
    });

    // Shaded segments layer - black/dark
    map.current.addLayer({
      id: 'ski-segments-shaded',
      type: 'line',
      source: 'ski-segments',
      filter: ['==', ['get', 'isShaded'], true],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': isNight ? NIGHT_COLOR : SHADE_COLOR,
        'line-width': 14,
        'line-blur': 2,
        'line-opacity': 0.8,
        'line-opacity-transition': { duration: 200 },
        'line-color-transition': { duration: 200 },
      },
    });

    // Runs source and layer
    const runsGeoJSON = {
      type: 'FeatureCollection' as const,
      features: area.runs.map(run => ({
        type: 'Feature' as const,
        properties: {
          id: run.id,
          name: run.name,
          difficulty: run.difficulty,
          status: run.status,
          color: getDifficultyColor(run.difficulty),
        },
        geometry: run.geometry,
      })),
    };

    map.current.addSource('ski-runs', {
      type: 'geojson',
      data: runsGeoJSON,
    });

    map.current.addLayer({
      id: 'ski-runs-line',
      type: 'line',
      source: 'ski-runs',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 3,
        'line-opacity': 1,
      },
    });

    // Lifts source and layer
    const liftsGeoJSON = {
      type: 'FeatureCollection' as const,
      features: area.lifts.map(lift => ({
        type: 'Feature' as const,
        properties: {
          id: lift.id,
          name: lift.name,
          liftType: lift.liftType,
          status: lift.status,
        },
        geometry: lift.geometry,
      })),
    };

    map.current.addSource('ski-lifts', {
      type: 'geojson',
      data: liftsGeoJSON,
    });

    // Lift lines with status-based coloring
    map.current.addLayer({
      id: 'ski-lifts',
      type: 'line',
      source: 'ski-lifts',
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'status'], 'open'], '#52c41a',
          ['==', ['get', 'status'], 'closed'], '#ff4d4f',
          '#888888'
        ],
        'line-width': 2,
        'line-dasharray': [4, 2],
      },
    });

    // Lift symbols (circles at stations)
    map.current.addLayer({
      id: 'ski-lifts-symbols',
      type: 'circle',
      source: 'ski-lifts',
      paint: {
        'circle-radius': 3,
        'circle-color': [
          'case',
          ['==', ['get', 'status'], 'open'], '#52c41a',
          ['==', ['get', 'status'], 'closed'], '#ff4d4f',
          '#888888'
        ],
        'circle-stroke-color': '#000',
        'circle-stroke-width': 1,
      },
    });

    setupClickHandlers();
    layersInitialized.current = true;
  }, []);

  // Handle highlighted feature
  useEffect(() => {
    if (!map.current || !mapLoaded || !layersInitialized.current) return;

    // Reset all highlights first
    if (map.current.getLayer('ski-runs-line')) {
      map.current.setPaintProperty('ski-runs-line', 'line-width', 
        highlightedFeatureId 
          ? ['case', ['==', ['get', 'id'], highlightedFeatureId], 6, 3]
          : 3
      );
    }

    if (map.current.getLayer('ski-lifts')) {
      map.current.setPaintProperty('ski-lifts', 'line-width',
        highlightedFeatureId
          ? ['case', ['==', ['get', 'id'], highlightedFeatureId], 5, 2]
          : 2
      );
    }

    // Zoom to highlighted feature if it exists
    if (highlightedFeatureId && skiArea) {
      const run = skiArea.runs.find(r => r.id === highlightedFeatureId);
      const lift = skiArea.lifts.find(l => l.id === highlightedFeatureId);
      
      const geometry = run?.geometry || lift?.geometry;
      if (geometry && geometry.type === 'LineString' && geometry.coordinates.length > 0) {
        const coords = geometry.coordinates;
        const midIndex = Math.floor(coords.length / 2);
        const midPoint = coords[midIndex];
        
        map.current.easeTo({
          center: [midPoint[0], midPoint[1]],
          zoom: 15,
          duration: 500,
        });
      }
    }
  }, [highlightedFeatureId, mapLoaded, skiArea]);

  // Update shading without recreating layers
  const updateShading = useCallback((area: SkiAreaDetails, time: Date) => {
    if (!map.current) return;

    const sunPos = getSunPosition(time, area.latitude, area.longitude);
    const isNight = sunPos.altitudeDegrees <= 0;
    
    // Store refs for map move updates
    currentSunAzimuth.current = sunPos.azimuthDegrees;
    currentSkiAreaRef.current = area;

    // Update night overlay
    if (map.current.getLayer('night-overlay')) {
      map.current.setPaintProperty('night-overlay', 'background-opacity', isNight ? 0.4 : 0);
    }

    // Update hillshade - more intense shadows
    if (map.current.getLayer('terrain-hillshade')) {
      const illuminationDir = isNight ? 315 : sunPos.azimuthDegrees;
      // Much higher exaggeration, especially at low sun angles
      const exaggeration = isNight ? 0.3 : Math.min(1.0, 0.5 + (90 - sunPos.altitudeDegrees) / 90);
      
      map.current.setPaintProperty('terrain-hillshade', 'hillshade-illumination-direction', illuminationDir);
      map.current.setPaintProperty('terrain-hillshade', 'hillshade-exaggeration', exaggeration);
    }

    // Update sun indicator
    const sunIndicatorSource = map.current.getSource('sun-indicator') as maplibregl.GeoJSONSource | undefined;
    if (sunIndicatorSource) {
      sunIndicatorSource.setData(createSunIndicator(area, sunPos.azimuthDegrees, map.current));
    }

    // Update sun visibility
    if (map.current.getLayer('sun-rays')) {
      map.current.setPaintProperty('sun-rays', 'line-opacity', isNight ? 0 : ['get', 'opacity']);
      map.current.setPaintProperty('sun-icon-glow', 'circle-opacity', isNight ? 0 : 0.7);
      map.current.setPaintProperty('sun-icon', 'circle-opacity', isNight ? 0 : 1);
    }

    // Update segments data
    const segments = createRunSegments(area, time, area.latitude, area.longitude);
    const segmentsSource = map.current.getSource('ski-segments') as maplibregl.GeoJSONSource | undefined;
    if (segmentsSource) {
      segmentsSource.setData(segments);
    }

    // Update shaded color for night
    if (map.current.getLayer('ski-segments-shaded')) {
      map.current.setPaintProperty('ski-segments-shaded', 'line-color', isNight ? NIGHT_COLOR : SHADE_COLOR);
    }
  }, []);

  // Setup click handlers
  const setupClickHandlers = useCallback(() => {
    if (!map.current) return;

    map.current.on('click', 'ski-runs-line', (e) => {
      if (!e.features?.length || !map.current) return;
      
      const feature = e.features[0];
      const props = feature.properties;
      
      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="padding: 6px;">
            <strong>${props.name || 'Unnamed Run'}</strong>
            <br/>
            <span style="color: ${props.color}">● ${props.difficulty || 'Unknown'}</span>
            ${props.status ? `<br/><small>Status: ${props.status}</small>` : ''}
          </div>
        `)
        .addTo(map.current);
    });

    map.current.on('click', 'ski-lifts', (e) => {
      if (!e.features?.length || !map.current) return;
      
      const feature = e.features[0];
      const props = feature.properties;
      
      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="padding: 6px;">
            <strong>${props.name || 'Unnamed Lift'}</strong>
            <br/>
            <small>Type: ${props.liftType || 'Unknown'}</small>
            ${props.status ? `<br/><small>Status: ${props.status}</small>` : ''}
          </div>
        `)
        .addTo(map.current);
    });

    map.current.on('mouseenter', 'ski-runs-line', () => {
      if (map.current) map.current.getCanvas().style.cursor = 'pointer';
    });

    map.current.on('mouseleave', 'ski-runs-line', () => {
      if (map.current) map.current.getCanvas().style.cursor = '';
    });
  }, []);

  return (
    <div className="relative w-full h-full" style={{ minHeight: '400px' }}>
      <div ref={mapContainer} className="w-full h-full" />
      
      {isUpdating && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-2 py-1 rounded"
             style={{ background: 'rgba(0,0,0,0.85)' }}>
          <LoadingSpinner size={16} />
          <span style={{ fontSize: 10, color: '#888' }}>Updating</span>
        </div>
      )}
    </div>
  );
}

/**
 * Create sun indicator with rays showing light direction
 */
function createSunIndicator(
  area: SkiAreaDetails,
  sunAzimuth: number,
  mapInstance: maplibregl.Map
): FeatureCollection {
  const center = [area.longitude, area.latitude];
  const bounds = mapInstance.getBounds();
  
  const latSpan = bounds.getNorth() - bounds.getSouth();
  const lngSpan = bounds.getEast() - bounds.getWest();
  const maxSpan = Math.max(latSpan, lngSpan);
  
  const rad = (sunAzimuth * Math.PI) / 180;
  const sunDistance = maxSpan * 0.4;
  
  const sunPosition: [number, number] = [
    center[0] + sunDistance * Math.sin(rad),
    center[1] + sunDistance * Math.cos(rad),
  ];

  const features: Feature[] = [];

  // Add sun point
  features.push({
    type: 'Feature',
    properties: { type: 'sun' },
    geometry: {
      type: 'Point',
      coordinates: sunPosition,
    } as Point,
  });

  // Add rays from sun toward center - bolder
  const numRays = 7;
  const raySpread = 20;
  
  for (let i = 0; i < numRays; i++) {
    const offset = (i - (numRays - 1) / 2) * (raySpread / (numRays - 1));
    const rayAngle = sunAzimuth + offset + 180;
    const rayRad = (rayAngle * Math.PI) / 180;
    
    const rayLength = sunDistance * 0.7;
    const rayEnd: [number, number] = [
      sunPosition[0] + rayLength * Math.sin(rayRad),
      sunPosition[1] + rayLength * Math.cos(rayRad),
    ];

    const distFromCenter = Math.abs(i - (numRays - 1) / 2);
    const width = 5 - distFromCenter * 0.8; // Bolder rays
    const opacity = 0.7 - distFromCenter * 0.1; // More visible

    features.push({
      type: 'Feature',
      properties: { 
        type: 'ray',
        width,
        opacity,
      },
      geometry: {
        type: 'LineString',
        coordinates: [sunPosition, rayEnd],
      } as LineString,
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Create segments from runs for per-segment shade calculation
 */
function createRunSegments(
  area: SkiAreaDetails,
  time: Date,
  latitude: number,
  longitude: number
): FeatureCollection<LineString, SegmentProperties> {
  const sunPos = getSunPosition(time, latitude, longitude);
  const sunAzimuth = sunPos.azimuthDegrees;
  const sunAltitude = sunPos.altitudeDegrees;
  const isNight = sunAltitude <= 0;

  const features: Feature<LineString, SegmentProperties>[] = [];

  for (const run of area.runs) {
    let coords: number[][] = [];
    
    if (run.geometry.type === 'LineString') {
      coords = run.geometry.coordinates;
    } else if (run.geometry.type === 'Polygon') {
      coords = run.geometry.coordinates[0];
    }

    if (coords.length < 2) continue;

    for (let i = 0; i < coords.length - 1; i++) {
      const segmentCoords = [coords[i], coords[i + 1]];
      
      const [lng1, lat1] = coords[i];
      const [lng2, lat2] = coords[i + 1];
      
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const lat1Rad = lat1 * Math.PI / 180;
      const lat2Rad = lat2 * Math.PI / 180;
      
      const y = Math.sin(dLng) * Math.cos(lat2Rad);
      const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
                Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
      
      const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      const slopeAspect = (bearing + 90) % 360;
      
      const isShaded = isNight ? true : calculateSegmentShade(slopeAspect, sunAzimuth, sunAltitude);

      features.push({
        type: 'Feature',
        properties: {
          runId: run.id,
          runName: run.name,
          difficulty: run.difficulty,
          segmentIndex: i,
          isShaded,
          bearing,
          slopeAspect,
        },
        geometry: {
          type: 'LineString',
          coordinates: segmentCoords,
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Calculate if a segment is in shade
 */
function calculateSegmentShade(
  slopeAspect: number,
  sunAzimuth: number,
  sunAltitude: number
): boolean {
  if (sunAltitude <= 0) return true;

  let angleDiff = Math.abs(sunAzimuth - slopeAspect);
  if (angleDiff > 180) angleDiff = 360 - angleDiff;

  const shadedByOrientation = angleDiff > 90;
  const shadedByLowSun = sunAltitude < 15 && angleDiff > 60;

  return shadedByOrientation || shadedByLowSun;
}

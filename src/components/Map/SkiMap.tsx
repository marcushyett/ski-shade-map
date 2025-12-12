'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getSunPosition } from '@/lib/suncalc';
import { getDifficultyColor } from '@/lib/shade-calculator';
import type { SkiAreaDetails } from '@/lib/types';
import type { LineString, Feature, FeatureCollection } from 'geojson';

interface SkiMapProps {
  skiArea: SkiAreaDetails | null;
  selectedTime: Date;
  is3D: boolean;
  onMapReady?: () => void;
}

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || '';

interface SegmentProperties {
  runId: string;
  runName: string | null;
  difficulty: string | null;
  segmentIndex: number;
  isShaded: boolean;
  bearing: number;
  slopeAspect: number;
}

export default function SkiMap({ skiArea, selectedTime, is3D, onMapReady }: SkiMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const layersInitialized = useRef(false);
  const currentSkiAreaId = useRef<string | null>(null);

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

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Setup terrain source and hillshade layer (once)
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

    // Add hillshade layer for terrain shadows
    if (!map.current.getLayer('terrain-hillshade')) {
      map.current.addLayer({
        id: 'terrain-hillshade',
        type: 'hillshade',
        source: 'terrain-dem',
        paint: {
          'hillshade-illumination-direction': 315,
          'hillshade-illumination-anchor': 'map',
          'hillshade-shadow-color': '#000022',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-accent-color': '#000000',
          'hillshade-exaggeration': 0.3,
        },
      }, 'building'); // Insert below buildings if they exist
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

  // Initialize layers when ski area changes
  useEffect(() => {
    if (!map.current || !mapLoaded || !skiArea) return;

    // Check if this is a new ski area
    if (currentSkiAreaId.current !== skiArea.id) {
      currentSkiAreaId.current = skiArea.id;
      layersInitialized.current = false;

      map.current.flyTo({
        center: [skiArea.longitude, skiArea.latitude],
        zoom: 14,
        duration: 2000,
      });

      initializeLayers(skiArea, selectedTime);
    }
  }, [skiArea, mapLoaded]);

  // Update shading when time changes (smooth update, no layer recreation)
  useEffect(() => {
    if (!map.current || !mapLoaded || !skiArea || !layersInitialized.current) return;

    updateShading(skiArea, selectedTime);
  }, [selectedTime, skiArea, mapLoaded]);

  // Initialize all layers for a ski area
  const initializeLayers = useCallback((area: SkiAreaDetails, time: Date) => {
    if (!map.current) return;

    // Remove existing layers if any
    const layersToRemove = [
      'sun-direction-glow', 'sun-direction-line',
      'ski-segments-sunny', 'ski-segments-shaded', 
      'ski-runs-line', 'ski-lifts'
    ];
    layersToRemove.forEach(layerId => {
      if (map.current?.getLayer(layerId)) {
        map.current.removeLayer(layerId);
      }
    });

    const sourcesToRemove = ['sun-direction', 'ski-segments', 'ski-runs', 'ski-lifts'];
    sourcesToRemove.forEach(sourceId => {
      if (map.current?.getSource(sourceId)) {
        map.current.removeSource(sourceId);
      }
    });

    const sunPos = getSunPosition(time, area.latitude, area.longitude);

    // Add sun direction source
    map.current.addSource('sun-direction', {
      type: 'geojson',
      data: createSunDirectionLine(area, sunPos.azimuthDegrees),
    });

    // Sun direction glow
    map.current.addLayer({
      id: 'sun-direction-glow',
      type: 'line',
      source: 'sun-direction',
      paint: {
        'line-color': '#FFD700',
        'line-width': 8,
        'line-blur': 6,
        'line-opacity': sunPos.altitudeDegrees > 0 ? 0.4 : 0,
        'line-opacity-transition': { duration: 300 },
      },
    });

    // Sun direction line
    map.current.addLayer({
      id: 'sun-direction-line',
      type: 'line',
      source: 'sun-direction',
      paint: {
        'line-color': '#FFD700',
        'line-width': 2,
        'line-opacity': sunPos.altitudeDegrees > 0 ? 0.8 : 0,
        'line-opacity-transition': { duration: 300 },
        'line-dasharray': [4, 2],
      },
    });

    // Create segments source
    const segments = createRunSegments(area, time, area.latitude, area.longitude);
    map.current.addSource('ski-segments', {
      type: 'geojson',
      data: segments,
    });

    // Sunny segments layer
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
        'line-color': '#FFD700',
        'line-width': 14,
        'line-blur': 3,
        'line-opacity': 0.75,
        'line-opacity-transition': { duration: 300 },
      },
    });

    // Shaded segments layer
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
        'line-color': '#1a237e',
        'line-width': 14,
        'line-blur': 3,
        'line-opacity': 0.7,
        'line-opacity-transition': { duration: 300 },
        'line-color-transition': { duration: 300 },
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

    map.current.addLayer({
      id: 'ski-lifts',
      type: 'line',
      source: 'ski-lifts',
      paint: {
        'line-color': '#666666',
        'line-width': 2,
        'line-dasharray': [2, 1],
      },
    });

    // Add click handlers
    setupClickHandlers();

    layersInitialized.current = true;
  }, []);

  // Update shading without recreating layers
  const updateShading = useCallback((area: SkiAreaDetails, time: Date) => {
    if (!map.current) return;

    const sunPos = getSunPosition(time, area.latitude, area.longitude);
    const isNight = sunPos.altitudeDegrees <= 0;

    // Update hillshade illumination direction based on sun
    if (map.current.getLayer('terrain-hillshade')) {
      // MapLibre uses 0-360 where 0 is top (north), going clockwise
      // Sun azimuth is already in this format
      const illuminationDir = isNight ? 315 : sunPos.azimuthDegrees;
      const exaggeration = isNight ? 0.1 : Math.min(0.5, 0.2 + (90 - sunPos.altitudeDegrees) / 180);
      
      map.current.setPaintProperty('terrain-hillshade', 'hillshade-illumination-direction', illuminationDir);
      map.current.setPaintProperty('terrain-hillshade', 'hillshade-exaggeration', exaggeration);
    }

    // Update sun direction line
    const sunDirectionSource = map.current.getSource('sun-direction') as maplibregl.GeoJSONSource | undefined;
    if (sunDirectionSource) {
      sunDirectionSource.setData(createSunDirectionLine(area, sunPos.azimuthDegrees));
    }

    // Update sun direction visibility
    if (map.current.getLayer('sun-direction-glow')) {
      map.current.setPaintProperty('sun-direction-glow', 'line-opacity', isNight ? 0 : 0.4);
      map.current.setPaintProperty('sun-direction-line', 'line-opacity', isNight ? 0 : 0.8);
    }

    // Update segments data
    const segments = createRunSegments(area, time, area.latitude, area.longitude);
    const segmentsSource = map.current.getSource('ski-segments') as maplibregl.GeoJSONSource | undefined;
    if (segmentsSource) {
      segmentsSource.setData(segments);
    }

    // Update shaded color for night
    if (map.current.getLayer('ski-segments-shaded')) {
      map.current.setPaintProperty(
        'ski-segments-shaded', 
        'line-color', 
        isNight ? '#0d1b2a' : '#1a237e'
      );
      map.current.setPaintProperty(
        'ski-segments-shaded',
        'line-opacity',
        isNight ? 0.85 : 0.7
      );
    }
  }, []);

  // Setup click handlers for popups
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
    <div 
      ref={mapContainer} 
      className="w-full h-full"
      style={{ minHeight: '400px' }}
    />
  );
}

/**
 * Create a line showing sun direction
 */
function createSunDirectionLine(
  area: SkiAreaDetails,
  sunAzimuth: number
): FeatureCollection<LineString> {
  const center = [area.longitude, area.latitude];
  const length = 0.012;
  
  const rad = (sunAzimuth * Math.PI) / 180;
  const endPoint = [
    center[0] + length * Math.sin(rad),
    center[1] + length * Math.cos(rad),
  ];
  
  const startOffset = 0.004;
  const startPoint = [
    center[0] - startOffset * Math.sin(rad),
    center[1] - startOffset * Math.cos(rad),
  ];

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [startPoint, endPoint],
      },
    }],
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
      
      // At night, all segments are shaded
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
 * Calculate if a segment is in shade based on its aspect and sun position
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

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getSunPosition } from '@/lib/suncalc';
import { getDifficultyColor } from '@/lib/shade-calculator';
import type { SkiAreaDetails } from '@/lib/types';
import type { LineString, Feature, FeatureCollection, Point, Polygon as GeoPolygon } from 'geojson';

interface SkiMapProps {
  skiArea: SkiAreaDetails | null;
  selectedTime: Date;
  is3D: boolean;
  onMapReady?: () => void;
}

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || '';

// Segment properties for per-segment shading
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
  const terrainAdded = useRef(false);
  const skiAreaRef = useRef<SkiAreaDetails | null>(null);
  const selectedTimeRef = useRef<Date>(selectedTime);

  // Keep refs updated
  useEffect(() => {
    skiAreaRef.current = skiArea;
  }, [skiArea]);

  useEffect(() => {
    selectedTimeRef.current = selectedTime;
  }, [selectedTime]);

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
      if (is3D) {
        addTerrain();
      }
      onMapReady?.();
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Add 3D terrain
  const addTerrain = useCallback(() => {
    if (!map.current || terrainAdded.current) return;
    
    if (!map.current.getSource('terrain')) {
      map.current.addSource('terrain', {
        type: 'raster-dem',
        url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`,
        tileSize: 256,
      });
    }

    map.current.setTerrain({
      source: 'terrain',
      exaggeration: 1.5,
    });

    terrainAdded.current = true;
  }, []);

  // Add all ski area layers
  const addSkiAreaLayers = useCallback((area: SkiAreaDetails, time: Date) => {
    if (!map.current) return;

    const sunPos = getSunPosition(time, area.latitude, area.longitude);
    const isNight = sunPos.altitudeDegrees <= 0;

    // Remove existing layers
    const layersToRemove = [
      'shadow-overlay', 'sun-direction-line', 'sun-direction-glow',
      'ski-segments-sunny', 'ski-segments-shaded', 
      'ski-runs-line', 'ski-lifts'
    ];
    layersToRemove.forEach(layerId => {
      if (map.current?.getLayer(layerId)) {
        map.current.removeLayer(layerId);
      }
    });

    const sourcesToRemove = ['shadow-overlay', 'sun-direction', 'ski-segments', 'ski-runs', 'ski-lifts'];
    sourcesToRemove.forEach(sourceId => {
      if (map.current?.getSource(sourceId)) {
        map.current.removeSource(sourceId);
      }
    });

    // Add shadow overlay (subtle gradient showing shaded direction)
    const shadowOverlay = createShadowOverlay(area, sunPos.azimuthDegrees, sunPos.altitudeDegrees);
    map.current.addSource('shadow-overlay', {
      type: 'geojson',
      data: shadowOverlay,
    });

    map.current.addLayer({
      id: 'shadow-overlay',
      type: 'fill',
      source: 'shadow-overlay',
      paint: {
        'fill-color': isNight ? '#0a0a14' : '#1a1a2e',
        'fill-opacity': isNight ? 0.6 : 0.25,
      },
    });

    // Add sun direction indicator (only during day)
    if (!isNight) {
      const sunDirection = createSunDirectionLine(area, sunPos.azimuthDegrees);
      map.current.addSource('sun-direction', {
        type: 'geojson',
        data: sunDirection,
      });

      // Glow effect
      map.current.addLayer({
        id: 'sun-direction-glow',
        type: 'line',
        source: 'sun-direction',
        paint: {
          'line-color': '#FFD700',
          'line-width': 8,
          'line-blur': 6,
          'line-opacity': 0.4,
        },
      });

      // Core line
      map.current.addLayer({
        id: 'sun-direction-line',
        type: 'line',
        source: 'sun-direction',
        paint: {
          'line-color': '#FFD700',
          'line-width': 2,
          'line-opacity': 0.8,
          'line-dasharray': [4, 2],
        },
      });
    }

    // Create segments from runs for per-segment shading
    const segments = createRunSegments(area, time, area.latitude, area.longitude);

    map.current.addSource('ski-segments', {
      type: 'geojson',
      data: segments,
    });

    // Add sunny segments layer
    map.current.addLayer({
      id: 'ski-segments-sunny',
      type: 'line',
      source: 'ski-segments',
      filter: isNight ? ['==', 1, 0] : ['==', ['get', 'isShaded'], false],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#FFD700',
        'line-width': 14,
        'line-blur': 3,
        'line-opacity': 0.75,
      },
    });

    // Add shaded segments layer
    map.current.addLayer({
      id: 'ski-segments-shaded',
      type: 'line',
      source: 'ski-segments',
      filter: isNight ? ['==', 1, 1] : ['==', ['get', 'isShaded'], true],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': isNight ? '#0d1b2a' : '#1a237e',
        'line-width': 14,
        'line-blur': 3,
        'line-opacity': isNight ? 0.9 : 0.7,
      },
    });

    // Add runs source for the colored difficulty line on top
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

    // Add lifts source
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

    // Add popup on click
    map.current.on('click', 'ski-runs-line', (e) => {
      if (!e.features?.length) return;
      
      const feature = e.features[0];
      const props = feature.properties;
      
      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="padding: 8px;">
            <strong>${props.name || 'Unnamed Run'}</strong>
            <br/>
            <span style="color: ${props.color}">● ${props.difficulty || 'Unknown'}</span>
            ${props.status ? `<br/><small>Status: ${props.status}</small>` : ''}
          </div>
        `)
        .addTo(map.current!);
    });

    map.current.on('click', 'ski-lifts', (e) => {
      if (!e.features?.length) return;
      
      const feature = e.features[0];
      const props = feature.properties;
      
      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="padding: 8px;">
            <strong>${props.name || 'Unnamed Lift'}</strong>
            <br/>
            <small>Type: ${props.liftType || 'Unknown'}</small>
            ${props.status ? `<br/><small>Status: ${props.status}</small>` : ''}
          </div>
        `)
        .addTo(map.current!);
    });

    // Change cursor on hover
    map.current.on('mouseenter', 'ski-runs-line', () => {
      if (map.current) map.current.getCanvas().style.cursor = 'pointer';
    });

    map.current.on('mouseleave', 'ski-runs-line', () => {
      if (map.current) map.current.getCanvas().style.cursor = '';
    });
  }, []);

  // Handle 3D toggle - don't reload style, just toggle terrain and pitch
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    if (is3D) {
      addTerrain();
    } else {
      map.current.setTerrain(null);
      terrainAdded.current = false;
    }

    map.current.easeTo({
      pitch: is3D ? 60 : 0,
      duration: 1000,
    });
  }, [is3D, mapLoaded, addTerrain]);

  // Update ski area display
  useEffect(() => {
    if (!map.current || !mapLoaded || !skiArea) return;

    map.current.flyTo({
      center: [skiArea.longitude, skiArea.latitude],
      zoom: 14,
      duration: 2000,
    });

    addSkiAreaLayers(skiArea, selectedTime);
  }, [skiArea, mapLoaded, addSkiAreaLayers]);

  // Update shading based on time
  useEffect(() => {
    if (!map.current || !mapLoaded || !skiArea) return;

    addSkiAreaLayers(skiArea, selectedTime);
  }, [selectedTime, skiArea, mapLoaded, addSkiAreaLayers]);

  return (
    <div 
      ref={mapContainer} 
      className="w-full h-full"
      style={{ minHeight: '400px' }}
    />
  );
}

/**
 * Create a shadow overlay polygon showing the shaded side of the ski area
 */
function createShadowOverlay(
  area: SkiAreaDetails,
  sunAzimuth: number,
  sunAltitude: number
): FeatureCollection<GeoPolygon> {
  // Create a semi-circle on the shaded side of the map
  const center = [area.longitude, area.latitude];
  const radius = 0.02; // Roughly 2km at European latitudes
  
  // The shadow is opposite to the sun direction
  const shadowDirection = (sunAzimuth + 180) % 360;
  
  // Create a wedge shape on the shaded side
  const points: number[][] = [center];
  
  // Create arc from shadow direction -90 to +90 degrees
  for (let angle = shadowDirection - 90; angle <= shadowDirection + 90; angle += 10) {
    const rad = (angle * Math.PI) / 180;
    const x = center[0] + radius * Math.sin(rad);
    const y = center[1] + radius * Math.cos(rad);
    points.push([x, y]);
  }
  
  points.push(center); // Close the polygon

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [points],
      },
    }],
  };
}

/**
 * Create a line showing sun direction
 */
function createSunDirectionLine(
  area: SkiAreaDetails,
  sunAzimuth: number
): FeatureCollection<LineString> {
  const center = [area.longitude, area.latitude];
  const length = 0.015; // Line length in degrees
  
  // Calculate end point in sun direction
  const rad = (sunAzimuth * Math.PI) / 180;
  const endPoint = [
    center[0] + length * Math.sin(rad),
    center[1] + length * Math.cos(rad),
  ];
  
  // Also create a line from center towards the sun (showing where light comes from)
  const startOffset = 0.005;
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

  const features: Feature<LineString, SegmentProperties>[] = [];

  for (const run of area.runs) {
    let coords: number[][] = [];
    
    if (run.geometry.type === 'LineString') {
      coords = run.geometry.coordinates;
    } else if (run.geometry.type === 'Polygon') {
      coords = run.geometry.coordinates[0];
    }

    if (coords.length < 2) continue;

    // Create a segment for each pair of consecutive points
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
      
      // At night, everything is shaded
      const isShaded = sunAltitude <= 0 ? true : calculateSegmentShade(slopeAspect, sunAzimuth, sunAltitude);

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

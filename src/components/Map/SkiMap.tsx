'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getSunPosition } from '@/lib/suncalc';
import { getDifficultyColor } from '@/lib/shade-calculator';
import type { SkiAreaDetails } from '@/lib/types';
import type { LineString, Polygon, Feature, FeatureCollection } from 'geojson';

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

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    // Use backdrop style for dark, minimal aesthetic
    const style = `https://api.maptiler.com/maps/backdrop/style.json?key=${MAPTILER_KEY}`;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style,
      center: [6.8, 45.9], // Default to Alps
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
    
    // Add terrain source
    if (!map.current.getSource('terrain')) {
      map.current.addSource('terrain', {
        type: 'raster-dem',
        url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`,
        tileSize: 256,
      });
    }

    // Enable terrain with exaggeration
    map.current.setTerrain({
      source: 'terrain',
      exaggeration: 1.5, // Make mountains more pronounced
    });

    terrainAdded.current = true;
  }, []);

  // Remove terrain
  const removeTerrain = useCallback(() => {
    if (!map.current) return;
    
    // Disable terrain
    map.current.setTerrain(null);
    terrainAdded.current = false;
  }, []);

  // Handle 3D toggle
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Keep backdrop style for both modes
    const style = `https://api.maptiler.com/maps/backdrop/style.json?key=${MAPTILER_KEY}`;

    map.current.setStyle(style);
    
    // Re-add layers and terrain after style change
    map.current.once('style.load', () => {
      terrainAdded.current = false;
      if (is3D) {
        addTerrain();
      }
      if (skiArea) {
        addSkiAreaLayers(skiArea);
      }
    });

    map.current.easeTo({
      pitch: is3D ? 60 : 0,
      duration: 1000,
    });
  }, [is3D, mapLoaded, addTerrain]);

  // Update ski area display
  useEffect(() => {
    if (!map.current || !mapLoaded || !skiArea) return;

    // Fly to ski area
    map.current.flyTo({
      center: [skiArea.longitude, skiArea.latitude],
      zoom: 14,
      duration: 2000,
    });

    addSkiAreaLayers(skiArea);
  }, [skiArea, mapLoaded]);

  // Update shading based on time
  useEffect(() => {
    if (!map.current || !mapLoaded || !skiArea) return;

    updateShading(skiArea, selectedTime);
  }, [selectedTime, skiArea, mapLoaded]);

  const addSkiAreaLayers = useCallback((area: SkiAreaDetails) => {
    if (!map.current) return;

    // Remove existing layers
    ['ski-segments-sunny', 'ski-segments-shaded', 'ski-runs-line', 'ski-lifts'].forEach(layerId => {
      if (map.current?.getLayer(layerId)) {
        map.current.removeLayer(layerId);
      }
    });

    ['ski-segments', 'ski-runs', 'ski-lifts'].forEach(sourceId => {
      if (map.current?.getSource(sourceId)) {
        map.current.removeSource(sourceId);
      }
    });

    // Create segments from runs for per-segment shading
    const segments = createRunSegments(area, selectedTime, area.latitude, area.longitude);

    map.current.addSource('ski-segments', {
      type: 'geojson',
      data: segments,
    });

    // Add sunny segments layer (bright, wide, golden glow)
    map.current.addLayer({
      id: 'ski-segments-sunny',
      type: 'line',
      source: 'ski-segments',
      filter: ['==', ['get', 'isShaded'], false],
      paint: {
        'line-color': '#FFD700', // Bright gold
        'line-width': 12,
        'line-blur': 2,
        'line-opacity': 0.8,
      },
    });

    // Add shaded segments layer (dark blue shadow)
    map.current.addLayer({
      id: 'ski-segments-shaded',
      type: 'line',
      source: 'ski-segments',
      filter: ['==', ['get', 'isShaded'], true],
      paint: {
        'line-color': '#1a237e', // Dark blue
        'line-width': 12,
        'line-blur': 2,
        'line-opacity': 0.7,
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

    // Add runs layer (thin difficulty-colored line on top)
    map.current.addLayer({
      id: 'ski-runs-line',
      type: 'line',
      source: 'ski-runs',
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
        'line-color': '#000000',
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
  }, [selectedTime]);

  const updateShading = (area: SkiAreaDetails, time: Date) => {
    if (!map.current) return;

    const sunPos = getSunPosition(time, area.latitude, area.longitude);

    // If sun is below horizon, make everything dark
    if (sunPos.altitudeDegrees <= 0) {
      if (map.current.getLayer('ski-segments-sunny')) {
        map.current.setFilter('ski-segments-sunny', ['==', 1, 0]); // Hide all sunny
        map.current.setFilter('ski-segments-shaded', ['==', 1, 1]); // Show all as shaded
        map.current.setPaintProperty('ski-segments-shaded', 'line-color', '#0d1b2a');
        map.current.setPaintProperty('ski-segments-shaded', 'line-opacity', 0.9);
      }
      return;
    }

    // Recalculate segments with new sun position
    const segments = createRunSegments(area, time, area.latitude, area.longitude);

    const source = map.current.getSource('ski-segments') as maplibregl.GeoJSONSource | undefined;
    if (source && typeof source.setData === 'function') {
      source.setData(segments);
    }

    // Reset filters and styling
    if (map.current.getLayer('ski-segments-sunny')) {
      map.current.setFilter('ski-segments-sunny', ['==', ['get', 'isShaded'], false]);
      map.current.setFilter('ski-segments-shaded', ['==', ['get', 'isShaded'], true]);
      map.current.setPaintProperty('ski-segments-shaded', 'line-color', '#1a237e');
      map.current.setPaintProperty('ski-segments-shaded', 'line-opacity', 0.7);
    }
  };

  return (
    <div 
      ref={mapContainer} 
      className="w-full h-full"
      style={{ minHeight: '400px' }}
    />
  );
}

/**
 * Create segments from runs for per-segment shade calculation
 * Each segment is a short piece of the run that can be individually shaded
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
      
      // Calculate bearing for this segment
      const [lng1, lat1] = coords[i];
      const [lng2, lat2] = coords[i + 1];
      
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const lat1Rad = lat1 * Math.PI / 180;
      const lat2Rad = lat2 * Math.PI / 180;
      
      const y = Math.sin(dLng) * Math.cos(lat2Rad);
      const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
                Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
      
      const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      
      // Slope aspect is perpendicular to bearing (slope faces right side of run direction)
      const slopeAspect = (bearing + 90) % 360;
      
      // Calculate if this segment is shaded
      const isShaded = calculateSegmentShade(slopeAspect, sunAzimuth, sunAltitude);

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
  if (sunAltitude <= 0) return true; // Night time

  // Calculate angle difference between sun direction and slope aspect
  let angleDiff = Math.abs(sunAzimuth - slopeAspect);
  if (angleDiff > 180) angleDiff = 360 - angleDiff;

  // Slope is shaded if it faces away from the sun (angle > 90 degrees)
  // Also shaded if sun is very low (< 15 degrees) and angle is > 60 degrees
  const shadedByOrientation = angleDiff > 90;
  const shadedByLowSun = sunAltitude < 15 && angleDiff > 60;

  return shadedByOrientation || shadedByLowSun;
}

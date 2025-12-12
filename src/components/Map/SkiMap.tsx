'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getSunPosition } from '@/lib/suncalc';
import { getDifficultyColor } from '@/lib/shade-calculator';
import type { SkiAreaDetails } from '@/lib/types';
import type { LineString, Polygon } from 'geojson';

interface SkiMapProps {
  skiArea: SkiAreaDetails | null;
  selectedTime: Date;
  is3D: boolean;
  onMapReady?: () => void;
}

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || '';

export default function SkiMap({ skiArea, selectedTime, is3D, onMapReady }: SkiMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const style = is3D 
      ? `https://api.maptiler.com/maps/winter-v2/style.json?key=${MAPTILER_KEY}`
      : `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${MAPTILER_KEY}`;

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
      onMapReady?.();
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Handle 3D toggle
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const style = is3D 
      ? `https://api.maptiler.com/maps/winter-v2/style.json?key=${MAPTILER_KEY}`
      : `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${MAPTILER_KEY}`;

    map.current.setStyle(style);
    
    // Re-add layers after style change
    map.current.once('style.load', () => {
      if (skiArea) {
        addSkiAreaLayers(skiArea);
      }
    });

    map.current.easeTo({
      pitch: is3D ? 60 : 0,
      duration: 1000,
    });
  }, [is3D, mapLoaded]);

  // Update ski area display
  useEffect(() => {
    if (!map.current || !mapLoaded || !skiArea) return;

    // Fly to ski area
    map.current.flyTo({
      center: [skiArea.longitude, skiArea.latitude],
      zoom: 13,
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
    ['ski-runs-shade', 'ski-runs-line', 'ski-lifts'].forEach(layerId => {
      if (map.current?.getLayer(layerId)) {
        map.current.removeLayer(layerId);
      }
    });

    ['ski-runs', 'ski-lifts'].forEach(sourceId => {
      if (map.current?.getSource(sourceId)) {
        map.current.removeSource(sourceId);
      }
    });

    // Add runs source
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

    // Add shade layer (will be updated based on sun position)
    map.current.addLayer({
      id: 'ski-runs-shade',
      type: 'line',
      source: 'ski-runs',
      paint: {
        'line-color': 'rgba(50, 50, 100, 0.5)',
        'line-width': 8,
        'line-blur': 3,
      },
    });

    // Add runs layer
    map.current.addLayer({
      id: 'ski-runs-line',
      type: 'line',
      source: 'ski-runs',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 4,
        'line-opacity': 0.9,
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

    updateShading(area, selectedTime);
  }, [selectedTime]);

  const updateShading = (area: SkiAreaDetails, time: Date) => {
    if (!map.current) return;

    const sunPos = getSunPosition(time, area.latitude, area.longitude);
    const sunAzimuth = sunPos.azimuthDegrees;
    const sunAltitude = sunPos.altitudeDegrees;

    // Calculate shade for each run based on its orientation
    const runsWithShade = area.runs.map(run => {
      const isShaded = calculateRunShade(run.geometry, sunAzimuth, sunAltitude);
      return {
        type: 'Feature' as const,
        properties: {
          id: run.id,
          name: run.name,
          difficulty: run.difficulty,
          status: run.status,
          color: getDifficultyColor(run.difficulty),
          isShaded,
        },
        geometry: run.geometry,
      };
    });

    // Update the shade layer colors
    if (map.current.getLayer('ski-runs-shade')) {
      const source = map.current.getSource('ski-runs') as maplibregl.GeoJSONSource | undefined;
      if (source && typeof source.setData === 'function') {
        source.setData({
          type: 'FeatureCollection',
          features: runsWithShade,
        });
      }

      // If sun is below horizon, everything is shaded
      if (sunAltitude <= 0) {
        map.current.setPaintProperty('ski-runs-shade', 'line-color', 'rgba(30, 30, 80, 0.7)');
        map.current.setPaintProperty('ski-runs-shade', 'line-width', 10);
      } else {
        map.current.setPaintProperty('ski-runs-shade', 'line-color', [
          'case',
          ['get', 'isShaded'],
          'rgba(50, 50, 120, 0.6)',
          'rgba(255, 220, 100, 0.4)',
        ]);
        map.current.setPaintProperty('ski-runs-shade', 'line-width', 8);
      }
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
 * Calculate if a run is likely in shade based on its orientation and sun position
 * This is a simplified model - true shade would require DEM data
 */
function calculateRunShade(
  geometry: LineString | Polygon,
  sunAzimuth: number,
  sunAltitude: number
): boolean {
  if (sunAltitude <= 0) return true; // Night time

  // Get coordinates
  let coords: number[][] = [];
  if (geometry.type === 'LineString') {
    coords = geometry.coordinates;
  } else if (geometry.type === 'Polygon') {
    coords = geometry.coordinates[0];
  }

  if (coords.length < 2) return false;

  // Calculate average bearing of the run
  let totalBearing = 0;
  let segments = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    
    // Calculate bearing
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    
    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
    
    const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    totalBearing += bearing;
    segments++;
  }

  const avgBearing = totalBearing / segments;
  
  // Slope aspect is perpendicular to bearing (assume slope faces right side of run)
  const slopeAspect = (avgBearing + 90) % 360;
  
  // Calculate angle between sun and slope aspect
  // If sun is behind the slope, it's shaded
  const angleDiff = Math.abs(sunAzimuth - slopeAspect);
  const normalizedDiff = angleDiff > 180 ? 360 - angleDiff : angleDiff;
  
  // If sun is more than 90 degrees from slope face, it's likely shaded
  // Also consider sun altitude - low sun creates more shade
  const shadedByOrientation = normalizedDiff > 90;
  const shadedByAltitude = sunAltitude < 20 && normalizedDiff > 60;
  
  return shadedByOrientation || shadedByAltitude;
}


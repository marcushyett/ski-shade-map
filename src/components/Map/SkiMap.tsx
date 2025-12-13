'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getSunPosition } from '@/lib/suncalc';
import { getDifficultyColor, getDifficultyColorSunny, getDifficultyColorShaded } from '@/lib/shade-calculator';
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

export interface UserLocationMarker {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface MountainHomeMarker {
  latitude: number;
  longitude: number;
  name: string;
}

export interface SharedLocationMarker {
  latitude: number;
  longitude: number;
  name: string;
  id: string;
}

export interface MapRef {
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  getCenter: () => { lat: number; lng: number } | null;
}

export interface SearchPlaceMarker {
  latitude: number;
  longitude: number;
  name: string;
  placeType?: string;
}

interface SkiMapProps {
  skiArea: SkiAreaDetails | null;
  selectedTime: Date;
  is3D: boolean;
  onMapReady?: () => void;
  highlightedFeatureId?: string | null;
  highlightedFeatureType?: 'run' | 'lift' | null;
  cloudCover?: CloudCover | null;
  initialView?: MapViewState | null;
  onViewChange?: (view: MapViewState) => void;
  favouriteIds?: string[];
  onToggleFavourite?: (runId: string) => void;
  userLocation?: UserLocationMarker | null;
  mountainHome?: MountainHomeMarker | null;
  sharedLocations?: SharedLocationMarker[];
  onRemoveSharedLocation?: (id: string) => void;
  mapRef?: React.MutableRefObject<MapRef | null>;
  isEditingHome?: boolean;
  onSetHomeLocation?: (location: { lat: number; lng: number }) => void;
  searchPlaceMarker?: SearchPlaceMarker | null;
  onClearSearchPlace?: () => void;
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
  sunnyColor: string;
  shadedColor: string;
}

export default function SkiMap({ skiArea, selectedTime, is3D, onMapReady, highlightedFeatureId, cloudCover, initialView, onViewChange, userLocation, mountainHome, sharedLocations, onRemoveSharedLocation, mapRef, searchPlaceMarker, onClearSearchPlace, favouriteIds = [], onToggleFavourite, isEditingHome = false, onSetHomeLocation }: SkiMapProps) {
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
  const favouriteIdsRef = useRef<string[]>([]);
  const onToggleFavouriteRef = useRef(onToggleFavourite);
  const isEditingHomeRef = useRef(isEditingHome);
  const onSetHomeLocationRef = useRef(onSetHomeLocation);
  
  // Keep refs updated
  favouriteIdsRef.current = favouriteIds;
  onToggleFavouriteRef.current = onToggleFavourite;
  isEditingHomeRef.current = isEditingHome;
  onSetHomeLocationRef.current = onSetHomeLocation;
  const userLocationMarkerRef = useRef<maplibregl.Marker | null>(null);
  const mountainHomeMarkerRef = useRef<maplibregl.Marker | null>(null);
  const sharedLocationMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const highlightPopupRef = useRef<maplibregl.Popup | null>(null);
  const searchPlaceMarkerRef = useRef<maplibregl.Marker | null>(null);

  // Expose map methods via ref
  useEffect(() => {
    if (mapRef) {
      mapRef.current = {
        flyTo: (lat: number, lng: number, zoom?: number) => {
          map.current?.flyTo({
            center: [lng, lat],
            zoom: zoom ?? 15,
            duration: 1000,
          });
        },
        getCenter: () => {
          if (!map.current) return null;
          const center = map.current.getCenter();
          return { lat: center.lat, lng: center.lng };
        },
      };
    }
  }, [mapRef, mapLoaded]);

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
          'hillshade-exaggeration': 0.35, // Reduced for better readability
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
    
    // In heavy cloud/fog, reduce opacity to show muted colors
    if (map.current.getLayer('ski-segments-sunny') && cloudCover.total > 70) {
      const opacity = cloudCover.total > 85 ? 0.6 : 0.8;
      map.current.setPaintProperty('ski-segments-sunny', 'line-opacity', opacity);
    } else if (map.current.getLayer('ski-segments-sunny')) {
      // Clear weather - full opacity
      map.current.setPaintProperty('ski-segments-sunny', 'line-opacity', 1);
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
      'ski-runs-line', 'ski-runs-favourite', 'ski-lifts', 'ski-lifts-symbols',
      'ski-segments-sunny-glow',
      'ski-runs-polygon-fill-sunny', 'ski-runs-polygon-fill-shaded',
      'ski-runs-labels', 'ski-lifts-labels',
    ];
    layersToRemove.forEach(layerId => {
      if (map.current?.getLayer(layerId)) {
        map.current.removeLayer(layerId);
      }
    });

    const sourcesToRemove = ['sun-indicator', 'ski-segments', 'ski-runs', 'ski-runs-polygons', 'ski-lifts'];
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

    // Sunny segments glow layer - creates a bright halo effect behind sunny runs
    map.current.addLayer({
      id: 'ski-segments-sunny-glow',
      type: 'line',
      source: 'ski-segments',
      filter: ['==', ['get', 'isShaded'], false],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#ffffff',
        'line-width': 10,
        'line-blur': 4,
        'line-opacity': isNight ? 0 : 0.6,
        'line-opacity-transition': { duration: 200 },
      },
    });

    // Sunny segments layer - uses bright difficulty colors
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
        'line-color': ['get', 'sunnyColor'],
        'line-width': 4,
        'line-opacity': isNight ? 0 : 1,
        'line-opacity-transition': { duration: 200 },
      },
    });

    // Shaded segments layer - uses darker difficulty color (also used at night)
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
        'line-color': ['get', 'shadedColor'],
        'line-width': 4,
        'line-opacity': 1,
        'line-opacity-transition': { duration: 200 },
        'line-color-transition': { duration: 200 },
      },
    });

    // Polygon runs source (for fill) - only runs that are polygons
    // Calculate sun/shade for each polygon based on its orientation (sunPos already defined above)
    const polygonRunsGeoJSON = {
      type: 'FeatureCollection' as const,
      features: area.runs
        .filter(run => run.geometry.type === 'Polygon')
        .map(run => {
          // Calculate polygon's slope aspect from its bounding box
          const ring = run.geometry.coordinates[0] as number[][];
          let minLat = Infinity, maxLat = -Infinity;
          let minLng = Infinity, maxLng = -Infinity;
          
          for (const [lng, lat] of ring) {
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
          }
          
          // Calculate slope aspect based on polygon orientation
          const latRange = maxLat - minLat;
          const lngRange = maxLng - minLng;
          
          // If taller than wide, slope faces E or W; if wider, faces N or S
          // Use the center to determine which direction it faces
          const slopeAspect = latRange > lngRange ? 90 : 0; // Simplified: E-facing if tall, N-facing if wide
          
          // Calculate if polygon is in shade
          const isShaded = sunPos.altitudeDegrees <= 0 ? true : 
            calculateSegmentShade(slopeAspect, sunPos.azimuthDegrees, sunPos.altitudeDegrees);
          
          return {
            type: 'Feature' as const,
            properties: {
              id: run.id,
              name: run.name,
              difficulty: run.difficulty,
              status: run.status,
              isShaded,
              color: getDifficultyColor(run.difficulty),
              sunnyColor: getDifficultyColorSunny(run.difficulty),
              shadedColor: getDifficultyColorShaded(run.difficulty),
            },
            geometry: run.geometry,
          };
        }),
    };

    if (polygonRunsGeoJSON.features.length > 0) {
      map.current.addSource('ski-runs-polygons', {
        type: 'geojson',
        data: polygonRunsGeoJSON,
      });

      // Polygon fill layer for sunny areas - very faint opacity with sunny color
      map.current.addLayer({
        id: 'ski-runs-polygon-fill-sunny',
        type: 'fill',
        source: 'ski-runs-polygons',
        filter: ['==', ['get', 'isShaded'], false],
        paint: {
          'fill-color': ['get', 'sunnyColor'],
          'fill-opacity': isNight ? 0 : 0.12,
        },
      });

      // Polygon fill layer for shaded areas - very faint opacity with shaded color
      map.current.addLayer({
        id: 'ski-runs-polygon-fill-shaded',
        type: 'fill',
        source: 'ski-runs-polygons',
        filter: ['==', ['get', 'isShaded'], true],
        paint: {
          'fill-color': ['get', 'shadedColor'],
          'fill-opacity': 0.12,
        },
      });
    }

    // Runs source and layer (all runs for click detection)
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

    // Runs line layer - invisible but used for click detection
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
        'line-width': 8, // Wide for easy clicking
        'line-opacity': 0, // Invisible - segments show the actual colors
      },
    });

    // Favourite runs - subtle golden glow underneath
    map.current.addLayer({
      id: 'ski-runs-favourite',
      type: 'line',
      source: 'ski-runs',
      filter: ['in', ['get', 'id'], ['literal', favouriteIdsRef.current]],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#faad14', // Golden color
        'line-width': 12, // Wider than the run
        'line-opacity': 0.4,
        'line-blur': 3, // Soft glow effect
      },
    }, 'ski-segments-shaded'); // Place below ALL segment layers so it's just a glow

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

    // Run/piste name labels along the line - only when zoomed in
    map.current.addLayer({
      id: 'ski-runs-labels',
      type: 'symbol',
      source: 'ski-runs',
      minzoom: 13.5,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-font': ['Open Sans Italic', 'Arial Unicode MS Regular'],
        'text-max-angle': 30,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'symbol-spacing': 250,
        'text-pitch-alignment': 'viewport',
        'text-rotation-alignment': 'map',
      },
      paint: {
        'text-color': [
          'match',
          ['get', 'difficulty'],
          'novice', '#22c55e',
          'easy', '#3b82f6', 
          'intermediate', '#dc2626',
          'advanced', '#1a1a1a',
          'expert', '#f97316',
          'freeride', '#f59e0b',
          '#666666'
        ],
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
        'text-halo-blur': 0.5,
      },
    });

    // Lift name labels along the line
    map.current.addLayer({
      id: 'ski-lifts-labels',
      type: 'symbol',
      source: 'ski-lifts',
      minzoom: 12.5,
      layout: {
        'symbol-placement': 'line-center',
        'text-field': ['get', 'name'],
        'text-size': 10,
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-max-angle': 30,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-pitch-alignment': 'viewport',
        'text-rotation-alignment': 'map',
        'text-letter-spacing': 0.05,
      },
      paint: {
        'text-color': '#333333',
        'text-halo-color': '#ffffff',
        'text-halo-width': 2,
        'text-halo-blur': 0.5,
      },
    });

    setupClickHandlers();
    layersInitialized.current = true;
  }, []);

  // Handle highlighted feature with orange glow and popup
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Remove any existing highlight popup
    if (highlightPopupRef.current) {
      highlightPopupRef.current.remove();
      highlightPopupRef.current = null;
    }
    
    // Highlight segments for the selected run using width increase and orange glow
    const highlightWidth = highlightedFeatureId 
      ? ['case', ['==', ['get', 'runId'], highlightedFeatureId], 8, 4]
      : 4;
    const highlightGlowWidth = highlightedFeatureId 
      ? ['case', ['==', ['get', 'runId'], highlightedFeatureId], 20, 10]
      : 10;
    const highlightGlowOpacity = highlightedFeatureId 
      ? ['case', ['==', ['get', 'runId'], highlightedFeatureId], 0.9, 0.6]
      : 0.6;
    
    if (map.current.getLayer('ski-segments-sunny-glow')) {
      map.current.setPaintProperty('ski-segments-sunny-glow', 'line-width', highlightGlowWidth);
      map.current.setPaintProperty('ski-segments-sunny-glow', 'line-opacity', highlightGlowOpacity);
    }
    if (map.current.getLayer('ski-segments-sunny')) {
      map.current.setPaintProperty('ski-segments-sunny', 'line-width', highlightWidth);
    }
    if (map.current.getLayer('ski-segments-shaded')) {
      map.current.setPaintProperty('ski-segments-shaded', 'line-width', highlightWidth);
    }
    
    // For lifts, update lift layer width
    if (map.current.getLayer('ski-lifts')) {
      const liftWidth = highlightedFeatureId 
        ? ['case', ['==', ['get', 'id'], highlightedFeatureId], 5, 2]
        : 2;
      map.current.setPaintProperty('ski-lifts', 'line-width', liftWidth);
    }

    // Reset when no highlight
    if (!highlightedFeatureId) {
      return;
    }

    if (!skiArea) return;

    const run = skiArea.runs.find(r => r.id === highlightedFeatureId);
    const lift = skiArea.lifts.find(l => l.id === highlightedFeatureId);
    const isRun = !!run;
    const feature = run || lift;

    if (!feature) return;

    // Get center point of the geometry for popup and zoom
    const geometry = feature.geometry;
    let centerPoint: [number, number] | null = null;

    if (geometry.type === 'LineString' && geometry.coordinates.length > 0) {
      const coords = geometry.coordinates as [number, number][];
      const midIndex = Math.floor(coords.length / 2);
      centerPoint = coords[midIndex];
    } else if (geometry.type === 'Polygon' && geometry.coordinates.length > 0) {
      // For polygons, get the centroid of the first ring
      const coords = geometry.coordinates[0] as [number, number][];
      const sumLng = coords.reduce((sum, c) => sum + c[0], 0);
      const sumLat = coords.reduce((sum, c) => sum + c[1], 0);
      centerPoint = [sumLng / coords.length, sumLat / coords.length];
    }

    if (centerPoint) {
      // Fly to the feature
      map.current.easeTo({
        center: centerPoint,
        zoom: 16,
        duration: 500,
      });

      // Show popup with feature info
      const popupContent = isRun
        ? `<div class="highlight-popup">
            <strong>${run.name || 'Unnamed Run'}</strong>
            ${run.difficulty ? `<br><span style="color: ${getDifficultyColor(run.difficulty)}">● ${run.difficulty}</span>` : ''}
          </div>`
        : `<div class="highlight-popup">
            <strong>${lift?.name || 'Unnamed Lift'}</strong>
            ${lift?.liftType ? `<br><span style="opacity: 0.7">${lift.liftType}</span>` : ''}
          </div>`;

      highlightPopupRef.current = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        className: 'search-highlight-popup',
      })
        .setLngLat(centerPoint)
        .setHTML(popupContent)
        .addTo(map.current);
    }
  }, [highlightedFeatureId, mapLoaded, skiArea]);

  // Handle user location marker
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Remove existing marker if location is null
    if (!userLocation) {
      if (userLocationMarkerRef.current) {
        userLocationMarkerRef.current.remove();
        userLocationMarkerRef.current = null;
      }
      return;
    }

    // Create or update marker
    if (userLocationMarkerRef.current) {
      userLocationMarkerRef.current.setLngLat([userLocation.longitude, userLocation.latitude]);
    } else {
      // Create custom marker element
      const el = document.createElement('div');
      el.className = 'user-location-marker';
      el.innerHTML = `
        <div class="user-location-dot"></div>
        <div class="user-location-pulse"></div>
      `;

      userLocationMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([userLocation.longitude, userLocation.latitude])
        .addTo(map.current);
    }
  }, [userLocation, mapLoaded]);

  // Handle mountain home marker
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Remove existing marker if home is null
    if (!mountainHome) {
      if (mountainHomeMarkerRef.current) {
        mountainHomeMarkerRef.current.remove();
        mountainHomeMarkerRef.current = null;
      }
      return;
    }

    // Create or update marker
    if (mountainHomeMarkerRef.current) {
      mountainHomeMarkerRef.current.setLngLat([mountainHome.longitude, mountainHome.latitude]);
    } else {
      // Create custom marker element with home icon
      const el = document.createElement('div');
      el.className = 'mountain-home-marker';
      el.innerHTML = `
        <div class="mountain-home-circle">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
          </svg>
        </div>
      `;
      el.title = mountainHome.name;

      mountainHomeMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([mountainHome.longitude, mountainHome.latitude])
        .setPopup(
          new maplibregl.Popup({ offset: 25 })
            .setHTML(`<div style="padding: 4px; font-size: 11px;"><strong>${mountainHome.name}</strong></div>`)
        )
        .addTo(map.current);
    }
  }, [mountainHome, mapLoaded]);

  // Handle shared location markers
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const currentMarkerIds = new Set(sharedLocations?.map(l => l.id) || []);
    
    // Remove markers that are no longer in the list
    sharedLocationMarkersRef.current.forEach((marker, id) => {
      if (!currentMarkerIds.has(id)) {
        marker.remove();
        sharedLocationMarkersRef.current.delete(id);
      }
    });

    // Add or update markers
    sharedLocations?.forEach(location => {
      const existingMarker = sharedLocationMarkersRef.current.get(location.id);
      
      if (existingMarker) {
        existingMarker.setLngLat([location.longitude, location.latitude]);
      } else {
        // Create custom marker element with person icon
        const el = document.createElement('div');
        el.className = 'shared-location-marker';
        el.innerHTML = `
          <div class="shared-location-circle">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
          </div>
        `;
        el.title = location.name + ' (click to dismiss)';
        
        // Add click handler to remove marker
        el.addEventListener('click', () => {
          onRemoveSharedLocation?.(location.id);
        });

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([location.longitude, location.latitude])
          .setPopup(
            new maplibregl.Popup({ offset: 25, closeOnClick: false })
              .setHTML(`
                <div style="padding: 6px; font-size: 11px;">
                  <strong>${location.name}</strong>
                  <div style="margin-top: 4px; font-size: 9px; color: #888;">Click marker to dismiss</div>
                </div>
              `)
          )
          .addTo(map.current!);
        
        sharedLocationMarkersRef.current.set(location.id, marker);
      }
    });
  }, [sharedLocations, mapLoaded, onRemoveSharedLocation]);

  // Handle search place marker
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Remove existing marker if null
    if (!searchPlaceMarker) {
      if (searchPlaceMarkerRef.current) {
        searchPlaceMarkerRef.current.remove();
        searchPlaceMarkerRef.current = null;
      }
      return;
    }

    // Get icon based on place type
    const getPlaceIcon = (placeType?: string) => {
      switch (placeType) {
        case 'hotel':
          return '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z"/></svg>';
        case 'restaurant':
          return '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/></svg>';
        case 'shop':
          return '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>';
        case 'road':
          return '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M11 8.5v-6h2v6h-2zm-9.5 4h6v-2h-6v2zm9.5 8.5v-6h2v6h-2zm8-10.5h-6v2h6v-2z"/></svg>';
        case 'building':
          return '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>';
        default:
          return '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>';
      }
    };

    // Remove existing marker first
    if (searchPlaceMarkerRef.current) {
      searchPlaceMarkerRef.current.remove();
      searchPlaceMarkerRef.current = null;
    }

    // Create custom marker element
    const el = document.createElement('div');
    el.className = 'search-place-marker';
    el.innerHTML = `
      <div class="search-place-circle">
        ${getPlaceIcon(searchPlaceMarker.placeType)}
      </div>
    `;
    el.title = searchPlaceMarker.name;
    
    // Add click handler to clear the marker
    el.addEventListener('click', () => {
      onClearSearchPlace?.();
    });

    searchPlaceMarkerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([searchPlaceMarker.longitude, searchPlaceMarker.latitude])
      .setPopup(
        new maplibregl.Popup({ offset: 25, closeOnClick: false, className: 'search-highlight-popup' })
          .setHTML(`
            <div class="highlight-popup">
              <strong>${searchPlaceMarker.name}</strong>
              ${searchPlaceMarker.placeType ? `<br><span style="opacity: 0.7; text-transform: capitalize">${searchPlaceMarker.placeType}</span>` : ''}
              <div style="margin-top: 4px; font-size: 9px; color: #888;">Click marker to dismiss</div>
            </div>
          `)
      )
      .addTo(map.current);

    // Open popup automatically
    searchPlaceMarkerRef.current.togglePopup();
  }, [searchPlaceMarker, mapLoaded, onClearSearchPlace]);

  // Update favourite runs layer filter when favouriteIds change
  useEffect(() => {
    if (!map.current || !mapLoaded || !layersInitialized.current) return;

    if (map.current.getLayer('ski-runs-favourite')) {
      map.current.setFilter('ski-runs-favourite', 
        ['in', ['get', 'id'], ['literal', favouriteIds]]
      );
    }
  }, [favouriteIds, mapLoaded]);

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

    // Update hillshade - subtle terrain shading
    if (map.current.getLayer('terrain-hillshade')) {
      const illuminationDir = isNight ? 315 : sunPos.azimuthDegrees;
      // Subtle exaggeration for better readability
      const exaggeration = isNight ? 0.2 : Math.min(0.5, 0.25 + (90 - sunPos.altitudeDegrees) / 180);
      
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

    // Update polygon fills with new sun/shade data
    const polygonsSource = map.current.getSource('ski-runs-polygons') as maplibregl.GeoJSONSource | undefined;
    if (polygonsSource) {
      const polygonRunsGeoJSON = {
        type: 'FeatureCollection' as const,
        features: area.runs
          .filter(run => run.geometry.type === 'Polygon')
          .map(run => {
            const ring = run.geometry.coordinates[0] as number[][];
            let minLat = Infinity, maxLat = -Infinity;
            let minLng = Infinity, maxLng = -Infinity;
            
            for (const [lng, lat] of ring) {
              minLat = Math.min(minLat, lat);
              maxLat = Math.max(maxLat, lat);
              minLng = Math.min(minLng, lng);
              maxLng = Math.max(maxLng, lng);
            }
            
            const latRange = maxLat - minLat;
            const lngRange = maxLng - minLng;
            const slopeAspect = latRange > lngRange ? 90 : 0;
            const isShaded = isNight ? true : calculateSegmentShade(slopeAspect, sunPos.azimuthDegrees, sunPos.altitudeDegrees);
            
            return {
              type: 'Feature' as const,
              properties: {
                id: run.id,
                name: run.name,
                difficulty: run.difficulty,
                status: run.status,
                isShaded,
                color: getDifficultyColor(run.difficulty),
                sunnyColor: getDifficultyColorSunny(run.difficulty),
                shadedColor: getDifficultyColorShaded(run.difficulty),
              },
              geometry: run.geometry,
            };
          }),
      };
      polygonsSource.setData(polygonRunsGeoJSON);
    }

    // Hide sunny segments and glow at night, show shaded colors for all runs
    if (map.current.getLayer('ski-segments-sunny-glow')) {
      map.current.setPaintProperty('ski-segments-sunny-glow', 'line-opacity', isNight ? 0 : 0.6);
    }
    if (map.current.getLayer('ski-segments-sunny')) {
      map.current.setPaintProperty('ski-segments-sunny', 'line-opacity', isNight ? 0 : 1);
    }
    
    // Hide sunny polygon fills at night
    if (map.current.getLayer('ski-runs-polygon-fill-sunny')) {
      map.current.setPaintProperty('ski-runs-polygon-fill-sunny', 'fill-opacity', isNight ? 0 : 0.12);
    }
    // Shaded segments always show their difficulty colors (no NIGHT_COLOR override)
  }, []);

  // Setup click handlers
  const setupClickHandlers = useCallback(() => {
    if (!map.current) return;

    // General map click handler for edit home mode
    map.current.on('click', (e) => {
      // Only handle if we're in edit home mode
      if (!isEditingHomeRef.current) return;
      
      // Set the home location
      onSetHomeLocationRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    map.current.on('click', 'ski-runs-line', (e) => {
      if (!e.features?.length || !map.current) return;
      if (isEditingHomeRef.current) return; // Don't show popup in edit mode
      
      const feature = e.features[0];
      const props = feature.properties;
      const runId = props.id;
      const isFavourite = favouriteIdsRef.current.includes(runId);
      
      const popup = new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="padding: 6px; min-width: 150px;">
            <strong>${props.name || 'Unnamed Run'}</strong>
            <br/>
            <span style="color: ${props.color}">● ${props.difficulty || 'Unknown'}</span>
            ${props.status ? `<br/><small>Status: ${props.status}</small>` : ''}
            <hr style="margin: 6px 0; border: none; border-top: 1px solid #333;" />
            <button 
              id="toggle-favourite-${runId}"
              style="
                width: 100%;
                padding: 6px 10px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 500;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                background: ${isFavourite ? 'rgba(250, 173, 20, 0.25)' : 'rgba(250, 173, 20, 0.1)'};
                color: #faad14;
                border: 1px solid #faad14;
                transition: all 0.2s;
              "
              onmouseover="this.style.background='rgba(250, 173, 20, 0.3)'"
              onmouseout="this.style.background='${isFavourite ? 'rgba(250, 173, 20, 0.25)' : 'rgba(250, 173, 20, 0.1)'}'"
            >
              <span style="font-size: 14px;">${isFavourite ? '★' : '☆'}</span>
              ${isFavourite ? 'Remove from Favourites' : 'Add to Favourites'}
            </button>
          </div>
        `)
        .addTo(map.current);
      
      // Add click handler after popup is added to DOM
      setTimeout(() => {
        const btn = document.getElementById(`toggle-favourite-${runId}`);
        if (btn) {
          btn.addEventListener('click', () => {
            onToggleFavouriteRef.current?.(runId);
            popup.remove();
          });
        }
      }, 0);
    });

    map.current.on('click', 'ski-lifts', (e) => {
      if (!e.features?.length || !map.current) return;
      if (isEditingHomeRef.current) return; // Don't show popup in edit mode
      
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
    // Only process LineString runs - polygons are rendered as fills, not centerlines
    if (run.geometry.type !== 'LineString') continue;
    
    const coords = run.geometry.coordinates;
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
          sunnyColor: getDifficultyColorSunny(run.difficulty),
          shadedColor: getDifficultyColorShaded(run.difficulty),
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

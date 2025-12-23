'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getSunPosition } from '@/lib/suncalc';
import { getDifficultyColor, getDifficultyColorSunny, getDifficultyColorShaded } from '@/lib/shade-calculator';
import { 
  startGeometryPrecomputation, 
  getGeometryCache, 
  generateShadedGeoJSON,
  calculateSegmentShadeFromCache,
  type GeometryCache 
} from '@/lib/geometry-cache';
import LoadingSpinner from '@/components/LoadingSpinner';
import { trackEvent } from '@/lib/posthog';
import type { SkiAreaDetails, RunData, LiftData, POIData, OperationStatus } from '@/lib/types';
import type { EnrichedRunData, EnrichedLiftData, LiftStatus, RunStatus } from '@/lib/lift-status-types';
import type { LineString, Feature, FeatureCollection, Point } from 'geojson';
import type { NavigationRoute } from '@/lib/navigation';

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
  fitBounds: (bounds: [[number, number], [number, number]], options?: { padding?: number; duration?: number }) => void;
  getCenter: () => { lat: number; lng: number } | null;
  project: (lngLat: [number, number]) => { x: number; y: number } | null;
  on: (event: string, handler: () => void) => void;
  off: (event: string, handler: () => void) => void;
}

export interface SearchPlaceMarker {
  latitude: number;
  longitude: number;
  name: string;
  placeType?: string;
}

interface SnowAnalysis {
  runId: string;
  score: number;
  condition: string;
  conditionLabel: string;
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
  onRunClick?: (runId: string, lngLat: { lng: number; lat: number }) => void;
  onLiftClick?: (liftId: string, lngLat: { lng: number; lat: number }) => void;
  onMapClick?: () => void;
  // Handler for background map clicks (not on features) - returns true if handled
  onMapBackgroundClick?: (lngLat: { lng: number; lat: number }) => boolean;
  userLocation?: UserLocationMarker | null;
  mountainHome?: MountainHomeMarker | null;
  sharedLocations?: SharedLocationMarker[];
  onRemoveSharedLocation?: (id: string) => void;
  mapRef?: React.MutableRefObject<MapRef | null>;
  isEditingHome?: boolean;
  onSetHomeLocation?: (location: { lat: number; lng: number }) => void;
  searchPlaceMarker?: SearchPlaceMarker | null;
  onClearSearchPlace?: () => void;
  snowAnalyses?: SnowAnalysis[];
  // Navigation props
  navigationRoute?: NavigationRoute | null;
  isNavigating?: boolean;
  userHeading?: number | null;
  // Visual indicator for navigation map click mode
  navMapClickMode?: 'origin' | 'destination' | null;
  isFakeLocationDropMode?: boolean;
  // Navigation origin/destination for showing pins
  navigationOrigin?: { lat: number; lng: number; name?: string } | null;
  navigationDestination?: { lat: number; lng: number; name?: string } | null;
  // Return to route point when user is off-route
  navigationReturnPoint?: { lat: number; lng: number } | null;
  // Points of Interest (toilets, restaurants, viewpoints)
  pois?: POIData[];
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

export default function SkiMap({ skiArea, selectedTime, is3D, onMapReady, highlightedFeatureId, cloudCover, initialView, onViewChange, userLocation, mountainHome, sharedLocations, onRemoveSharedLocation, mapRef, searchPlaceMarker, onClearSearchPlace, favouriteIds = [], onToggleFavourite, onRunClick, onLiftClick, onMapClick, onMapBackgroundClick, isEditingHome = false, onSetHomeLocation, snowAnalyses = [], navigationRoute, isNavigating = false, userHeading, navMapClickMode, isFakeLocationDropMode = false, navigationOrigin, navigationDestination, navigationReturnPoint, pois = [] }: SkiMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const layersInitialized = useRef(false);
  const currentSkiAreaId = useRef<string | null>(null);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingUpdateRef = useRef<{ area: SkiAreaDetails; time: Date } | null>(null);
  const rafIdRef = useRef<number | null>(null); // For batching map updates
  const currentSunAzimuth = useRef<number>(0);
  const currentSkiAreaRef = useRef<SkiAreaDetails | null>(null);
  const favouriteIdsRef = useRef<string[]>([]);
  const onToggleFavouriteRef = useRef(onToggleFavourite);
  const onRunClickRef = useRef(onRunClick);
  const onMapClickRef = useRef(onMapClick);
  const isEditingHomeRef = useRef(isEditingHome);
  const onSetHomeLocationRef = useRef(onSetHomeLocation);
  const navMapClickModeRef = useRef(navMapClickMode);
  const isFakeLocationDropModeRef = useRef(isFakeLocationDropMode);
  
  const snowAnalysesRef = useRef<SnowAnalysis[]>([]);
  const onLiftClickRef = useRef(onLiftClick);
  const geometryCacheRef = useRef<GeometryCache | null>(null);
  
  // Keep refs updated
  favouriteIdsRef.current = favouriteIds;
  onToggleFavouriteRef.current = onToggleFavourite;
  onRunClickRef.current = onRunClick;
  onLiftClickRef.current = onLiftClick;
  onMapClickRef.current = onMapClick;
  const onMapBackgroundClickRef = useRef(onMapBackgroundClick);
  onMapBackgroundClickRef.current = onMapBackgroundClick;
  isEditingHomeRef.current = isEditingHome;
  onSetHomeLocationRef.current = onSetHomeLocation;
  navMapClickModeRef.current = navMapClickMode;
  isFakeLocationDropModeRef.current = isFakeLocationDropMode;
  snowAnalysesRef.current = snowAnalyses;
  const userLocationMarkerRef = useRef<maplibregl.Marker | null>(null);
  const mountainHomeMarkerRef = useRef<maplibregl.Marker | null>(null);
  const sharedLocationMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const highlightPopupRef = useRef<maplibregl.Popup | null>(null);
  const searchPlaceMarkerRef = useRef<maplibregl.Marker | null>(null);
  const navOriginMarkerRef = useRef<maplibregl.Marker | null>(null);
  const navDestinationMarkerRef = useRef<maplibregl.Marker | null>(null);
  const navReturnPointMarkerRef = useRef<maplibregl.Marker | null>(null);

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
        fitBounds: (bounds: [[number, number], [number, number]], options?: { padding?: number; duration?: number }) => {
          map.current?.fitBounds(bounds, {
            padding: options?.padding ?? 50,
            duration: options?.duration ?? 500,
          });
        },
        getCenter: () => {
          if (!map.current) return null;
          const center = map.current.getCenter();
          return { lat: center.lat, lng: center.lng };
        },
        project: (lngLat: [number, number]) => {
          if (!map.current) return null;
          const point = map.current.project(lngLat);
          return { x: point.x, y: point.y };
        },
        on: (event: string, handler: () => void) => {
          map.current?.on(event, handler);
        },
        off: (event: string, handler: () => void) => {
          map.current?.off(event, handler);
        },
      };
    }
  }, [mapRef, mapLoaded]);

  // Store initial view in a ref so we can use it during map initialization
  const initialViewRef = useRef(initialView);
  initialViewRef.current = initialView;

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const style = `https://api.maptiler.com/maps/backdrop/style.json?key=${MAPTILER_KEY}`;

    // Use initialView if available, otherwise default to Alps
    const startCenter = initialViewRef.current
      ? [initialViewRef.current.lng, initialViewRef.current.lat] as [number, number]
      : [6.8, 45.9] as [number, number];
    const startZoom = initialViewRef.current?.zoom ?? 10;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style,
      center: startCenter,
      zoom: startZoom,
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

    // Track zoom changes
    let lastZoom = map.current.getZoom();
    map.current.on('zoomend', () => {
      if (!map.current) return;
      const newZoom = map.current.getZoom();
      if (Math.abs(newZoom - lastZoom) > 0.5) {
        trackEvent('map_zoom', {
          zoom_level: Math.round(newZoom * 10) / 10,
          ski_area_id: currentSkiAreaId.current || undefined,
        });
        lastZoom = newZoom;
      }
    });

    // Track map pans (debounced by moveend)
    map.current.on('dragend', () => {
      if (!map.current) return;
      const center = map.current.getCenter();
      trackEvent('map_pan', {
        latitude: Math.round(center.lat * 10000) / 10000,
        longitude: Math.round(center.lng * 10000) / 10000,
        zoom_level: Math.round(map.current.getZoom() * 10) / 10,
        ski_area_id: currentSkiAreaId.current || undefined,
      });
    });

    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
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

      // Start lazy background geometry precomputation
      // This runs in idle time and doesn't block initial rendering
      geometryCacheRef.current = startGeometryPrecomputation(
        skiArea.id,
        skiArea.runs
      );

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

  // Track previous initialView to detect when it changes (for current location feature)
  const prevInitialViewRef = useRef<MapViewState | null>(null);

  // Handle initialView changes after map is loaded (e.g., when using "Use Current Location")
  useEffect(() => {
    if (!map.current || !mapLoaded || !initialView) return;

    // Only fly to initialView if it actually changed (not just on every render)
    const prev = prevInitialViewRef.current;
    if (prev && prev.lat === initialView.lat && prev.lng === initialView.lng && prev.zoom === initialView.zoom) {
      return; // No change
    }

    // Update the ref
    prevInitialViewRef.current = initialView;

    // If this is a new initialView (user used current location), fly there
    if (prev !== null) {
      map.current.flyTo({
        center: [initialView.lng, initialView.lat],
        zoom: initialView.zoom,
        duration: 1000,
      });
    }
  }, [initialView, mapLoaded]);

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
    }, 150); // Increased from 50ms for smoother slider experience

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
      'ski-segments-sunny', 'ski-segments-shaded', 'ski-segments-closed', 'ski-segments-closed-markers',
      'ski-segments-closing-soon',
      'ski-runs-line', 'ski-runs-favourite', 'ski-lifts', 'ski-lifts-touch', 'ski-lifts-symbols',
      'ski-segments-sunny-glow',
      'ski-runs-polygon-fill-sunny', 'ski-runs-polygon-fill-shaded',
      'ski-runs-labels', 'ski-lifts-labels',
      'ski-runs-arrows', 'ski-lifts-arrows',
      'poi-circles', 'poi-icons', 'poi-labels',
    ];
    layersToRemove.forEach(layerId => {
      if (map.current?.getLayer(layerId)) {
        map.current.removeLayer(layerId);
      }
    });

    const sourcesToRemove = ['sun-indicator', 'ski-segments', 'ski-runs', 'ski-runs-polygons', 'ski-lifts', 'pois'];
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

    // Sunny segments layer - uses bright difficulty colors (open runs only)
    map.current.addLayer({
      id: 'ski-segments-sunny',
      type: 'line',
      source: 'ski-segments',
      filter: ['all', ['==', ['get', 'isShaded'], false], ['!=', ['get', 'isClosed'], true]],
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

    // Shaded segments layer - uses darker difficulty color (open runs only)
    map.current.addLayer({
      id: 'ski-segments-shaded',
      type: 'line',
      source: 'ski-segments',
      filter: ['all', ['==', ['get', 'isShaded'], true], ['!=', ['get', 'isClosed'], true]],
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

    // Closed runs layer - dashed lines with reduced opacity
    map.current.addLayer({
      id: 'ski-segments-closed',
      type: 'line',
      source: 'ski-segments',
      filter: ['==', ['get', 'isClosed'], true],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#666666',
        'line-width': 3,
        'line-opacity': 0.4,
        'line-dasharray': [2, 2],
      },
    });

    // Closed runs X markers - show at higher zoom levels
    map.current.addLayer({
      id: 'ski-segments-closed-markers',
      type: 'symbol',
      source: 'ski-segments',
      minzoom: 14,
      filter: ['==', ['get', 'isClosed'], true],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 80,
        'text-field': '\u2716', // X symbol
        'text-size': 10,
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#ff4d4f',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1,
      },
    });

    // Closing soon runs - orange glow underneath (only for open runs closing within 60 min)
    map.current.addLayer({
      id: 'ski-segments-closing-soon',
      type: 'line',
      source: 'ski-segments',
      filter: ['all', ['==', ['get', 'closingSoon'], true], ['!=', ['get', 'isClosed'], true]],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#f97316',
        'line-width': 8,
        'line-opacity': 0.4,
        'line-blur': 2,
      },
    }, 'ski-segments-sunny'); // Place below the main segment layers

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
    } else {
      // Always create the source even if empty (for progressive loading)
      map.current.addSource('ski-runs-polygons', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

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

    // Runs source and layer (LineString runs only - for click detection)
    // Polygon runs are handled separately with their own fill layers
    const runsGeoJSON = {
      type: 'FeatureCollection' as const,
      features: area.runs
        .filter(run => run.geometry.type === 'LineString') // Exclude polygons - they have their own source
        .map(run => ({
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

    // Runs line layer - invisible but used for click/touch detection
    // Wider on touch devices for easier tapping
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
        'line-width': 20, // Wide for easy touch/click detection on mobile
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
      features: area.lifts.map(lift => {
        const minutesUntilClose = 'minutesUntilClose' in lift ? (lift as EnrichedLiftData).minutesUntilClose : null;
        const closingSoon = typeof minutesUntilClose === 'number' && minutesUntilClose > 0 && minutesUntilClose <= 60;
        return {
          type: 'Feature' as const,
          properties: {
            id: lift.id,
            name: lift.name,
            liftType: lift.liftType,
            status: lift.status,
            closingSoon,
          },
          geometry: lift.geometry,
        };
      }),
    };

    map.current.addSource('ski-lifts', {
      type: 'geojson',
      data: liftsGeoJSON,
    });

    // Lift touch detection layer - invisible but wide for easy tapping
    map.current.addLayer({
      id: 'ski-lifts-touch',
      type: 'line',
      source: 'ski-lifts',
      paint: {
        'line-color': '#000000',
        'line-width': 20, // Wide for easy touch/click detection on mobile
        'line-opacity': 0, // Invisible
      },
    });

    // Lift lines with status-based coloring and opacity
    map.current.addLayer({
      id: 'ski-lifts',
      type: 'line',
      source: 'ski-lifts',
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'status'], 'closed'], '#888888',
          ['==', ['get', 'closingSoon'], true], '#f97316',
          ['==', ['get', 'status'], 'open'], '#52c41a',
          '#888888'
        ],
        'line-width': [
          'case',
          ['==', ['get', 'status'], 'closed'], 1.5,
          2
        ],
        'line-opacity': [
          'case',
          ['==', ['get', 'status'], 'closed'], 0.4,
          1
        ],
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
          ['==', ['get', 'status'], 'closed'], '#888888',
          ['==', ['get', 'closingSoon'], true], '#f97316',
          ['==', ['get', 'status'], 'open'], '#52c41a',
          '#888888'
        ],
        'circle-stroke-color': '#000',
        'circle-stroke-width': 1,
        'circle-opacity': [
          'case',
          ['==', ['get', 'status'], 'closed'], 0.4,
          1
        ],
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

    // Direction arrows for runs (pointing downhill)
    // Uses '>' character which is well-supported in map fonts
    map.current.addLayer({
      id: 'ski-runs-arrows',
      type: 'symbol',
      source: 'ski-runs',
      minzoom: 13.5,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 120,
        'text-field': '>',
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': 14,
        'text-keep-upright': false,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-offset': [0, 0],
      },
      paint: {
        'text-color': [
          'match',
          ['get', 'difficulty'],
          'novice', '#166534',
          'easy', '#1d4ed8', 
          'intermediate', '#b91c1c',
          'advanced', '#000000',
          'expert', '#c2410c',
          'freeride', '#b45309',
          '#444444'
        ],
        'text-opacity': 1,
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    });

    // Direction arrows for lifts (pointing uphill)
    map.current.addLayer({
      id: 'ski-lifts-arrows',
      type: 'symbol',
      source: 'ski-lifts',
      minzoom: 12.5,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 100,
        'text-field': '>',
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': 12,
        'text-keep-upright': false,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-offset': [0, 0],
      },
      paint: {
        'text-color': '#1a1a1a',
        'text-opacity': 1,
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    });

    // Initialize empty POI source - will be populated when pois prop changes
    map.current.addSource('pois', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    // POI circle background - colored circles for each POI type
    map.current.addLayer({
      id: 'poi-circles',
      type: 'circle',
      source: 'pois',
      minzoom: 14, // Only show at zoom 14+
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14, 6,
          16, 10
        ],
        'circle-color': [
          'match',
          ['get', 'type'],
          'toilet', '#3b82f6',     // Blue for toilets
          'restaurant', '#f97316', // Orange for restaurants
          'viewpoint', '#22c55e',  // Green for viewpoints
          '#888888'                // Default gray
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14, 0.8,
          15, 1
        ],
      },
    });

    // POI icons - simple text symbols inside circles
    map.current.addLayer({
      id: 'poi-icons',
      type: 'symbol',
      source: 'pois',
      minzoom: 14.5, // Show slightly later than circles
      layout: {
        'text-field': ['get', 'symbol'],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14.5, 8,
          16, 11
        ],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#ffffff',
      },
    });

    // POI labels - show name at high zoom
    map.current.addLayer({
      id: 'poi-labels',
      type: 'symbol',
      source: 'pois',
      minzoom: 15.5, // Only show labels at very high zoom
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 10,
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-max-width': 8,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#333333',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
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

      // Show popup with feature info including snow quality
      const snowAnalysis = isRun ? snowAnalysesRef.current.find(s => s.runId === highlightedFeatureId) : null;
      const snowScoreColor = snowAnalysis 
        ? (snowAnalysis.score >= 70 ? '#22c55e' : snowAnalysis.score >= 40 ? '#a3a3a3' : '#ef4444')
        : '#888';
      
      // Calculate run stats for popup
      let runStats: { distance: string; elevation: string } | null = null;
      if (isRun && run.geometry.type === 'LineString') {
        const coords = run.geometry.coordinates;
        // Calculate distance
        let totalDist = 0;
        for (let i = 1; i < coords.length; i++) {
          const [lng1, lat1] = coords[i - 1];
          const [lng2, lat2] = coords[i];
          const dLat = (lat2 - lat1) * Math.PI / 180;
          const dLng = (lng2 - lng1) * Math.PI / 180;
          const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                    Math.sin(dLng / 2) * Math.sin(dLng / 2);
          totalDist += 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }
        const distStr = totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)}km` : `${Math.round(totalDist)}m`;
        
        // Calculate elevation range (only if we have valid elevation data)
        const elevations = coords.map(c => c[2]).filter((e): e is number => typeof e === 'number' && e > 0);
        let elevStr = '';
        if (elevations.length >= 2) {
          const high = Math.max(...elevations);
          const low = Math.min(...elevations);
          const drop = high - low;
          if (drop > 0) {
            elevStr = `↓${Math.round(drop)}m (${Math.round(high)}→${Math.round(low)}m)`;
          }
        }
        runStats = { distance: distStr, elevation: elevStr };
      }
      
      // Status colors and labels
      const statusColors: Record<string, string> = {
        open: '#52c41a',
        closed: '#ff4d4f',
        scheduled: '#faad14',
        unknown: '#8c8c8c',
      };
      const statusLabels: Record<string, string> = {
        open: 'Open',
        closed: 'Closed',
        scheduled: 'Scheduled',
        unknown: 'Unknown',
      };

      const runStatusColor = run?.status ? statusColors[run.status] : statusColors.unknown;
      const runStatusLabel = run?.status ? statusLabels[run.status] : '';
      const liftStatusColor = lift?.status ? statusColors[lift.status] : statusColors.unknown;
      const liftStatusLabel = lift?.status ? statusLabels[lift.status] : '';

      // Extract enriched data for runs
      const runLiveStatus = run && 'liveStatus' in run ? (run as EnrichedRunData).liveStatus : null;
      const runOpeningTimes = runLiveStatus?.openingTimes?.[0];
      const runGroomingStatus = runLiveStatus?.groomingStatus;
      const runSnowQuality = runLiveStatus?.snowQuality;
      const runMessage = runLiveStatus?.message;
      const runMinutesUntilClose = run && 'minutesUntilClose' in run ? (run as EnrichedRunData).minutesUntilClose : null;
      const runClosingSoon = typeof runMinutesUntilClose === 'number' && runMinutesUntilClose > 0 && runMinutesUntilClose <= 60;

      // Extract enriched data for lifts
      const liftLiveStatus = lift && 'liveStatus' in lift ? (lift as EnrichedLiftData).liveStatus : null;
      const liftOpeningTimes = liftLiveStatus?.openingTimes?.[0];
      const liftSpeed = liftLiveStatus?.speed;
      const liftCapacity = liftLiveStatus?.uphillCapacity;
      const liftMessage = liftLiveStatus?.message;
      const liftMinutesUntilClose = lift && 'minutesUntilClose' in lift ? (lift as EnrichedLiftData).minutesUntilClose : null;
      const liftClosingSoon = typeof liftMinutesUntilClose === 'number' && liftMinutesUntilClose > 0 && liftMinutesUntilClose <= 60;

      // Grooming status labels (text only for HTML popups)
      const groomingLabels: Record<string, { label: string; color: string }> = {
        GROOMED: { label: 'Groomed', color: '#22c55e' },
        PARTIALLY_GROOMED: { label: 'Partial', color: '#eab308' },
        NOT_GROOMED: { label: 'Ungroomed', color: '#888' },
      };
      const groomingInfo = runGroomingStatus ? groomingLabels[runGroomingStatus] : null;

      const popupContent = isRun
        ? `<div class="run-popup" style="min-width: 180px; max-width: 240px;">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
              <span style="width: 10px; height: 10px; border-radius: 50%; background: ${getDifficultyColor(run.difficulty || 'unknown')}; flex-shrink: 0;"></span>
              <strong style="font-size: 13px;">${run.name || 'Unnamed Run'}</strong>
              ${run?.status && run.status !== 'unknown' ? `<span style="font-size: 9px; padding: 1px 4px; border-radius: 3px; background: ${runStatusColor}20; color: ${runStatusColor}; font-weight: 500; margin-left: auto;">${runStatusLabel}</span>` : ''}
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; font-size: 10px;">
              ${run.difficulty ? `<span style="color: ${getDifficultyColor(run.difficulty)};">${run.difficulty}</span>` : ''}
              ${runStats?.distance ? `<span style="color: #888;">${runStats.distance}</span>` : ''}
              ${runStats?.elevation ? `<span style="color: #888;">${runStats.elevation}</span>` : ''}
            </div>
            ${runOpeningTimes || groomingInfo || runSnowQuality ? `<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; font-size: 10px;">
              ${runOpeningTimes ? `<span style="color: #aaa;">${runOpeningTimes.beginTime}-${runOpeningTimes.endTime}${runClosingSoon ? ` <span style="color: #eab308;">(${runMinutesUntilClose}min)</span>` : ''}</span>` : ''}
              ${groomingInfo ? `<span style="color: ${groomingInfo.color};">${groomingInfo.label}</span>` : ''}
              ${runSnowQuality ? `<span style="color: #60a5fa;">${runSnowQuality.replace(/_/g, ' ').toLowerCase()}</span>` : ''}
            </div>` : ''}
            ${runMessage ? `<div style="font-size: 10px; color: #f97316; padding: 4px 6px; background: rgba(249, 115, 22, 0.1); border-radius: 4px; margin-bottom: 4px;">${runMessage}</div>` : ''}
            ${snowAnalysis ? `<div style="font-size: 10px; padding: 4px 6px; background: rgba(0,0,0,0.3); border-radius: 4px;">
              Snow: <span style="color: ${snowScoreColor}; font-weight: 600;">${Math.round(snowAnalysis.score)}%</span>
              <span style="color: #888;">${snowAnalysis.conditionLabel}</span>
            </div>` : ''}
          </div>`
        : `<div class="lift-popup" style="min-width: 160px; max-width: 220px;">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
              <strong style="font-size: 13px;">${lift?.name || 'Unnamed Lift'}</strong>
              ${lift?.status && lift.status !== 'unknown' ? `<span style="font-size: 9px; padding: 1px 4px; border-radius: 3px; background: ${liftStatusColor}20; color: ${liftStatusColor}; font-weight: 500; margin-left: auto;">${liftStatusLabel}</span>` : ''}
            </div>
            ${lift?.liftType ? `<div style="font-size: 10px; color: #888; margin-bottom: 4px;">${lift.liftType}</div>` : ''}
            ${liftOpeningTimes || liftSpeed || liftCapacity ? `<div style="display: flex; flex-wrap: wrap; gap: 6px; font-size: 10px; margin-bottom: 4px;">
              ${liftOpeningTimes ? `<span style="color: #aaa;">${liftOpeningTimes.beginTime}-${liftOpeningTimes.endTime}${liftClosingSoon ? ` <span style="color: #eab308;">(${liftMinutesUntilClose}min)</span>` : ''}</span>` : ''}
              ${liftSpeed ? `<span style="color: #888;">${liftSpeed} m/s</span>` : ''}
              ${liftCapacity ? `<span style="color: #888;">${liftCapacity} pers/h</span>` : ''}
            </div>` : ''}
            ${liftMessage ? `<div style="font-size: 10px; color: #f97316; padding: 4px 6px; background: rgba(249, 115, 22, 0.1); border-radius: 4px;">${liftMessage}</div>` : ''}
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

  // Navigation origin/destination markers
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Handle origin marker
    if (navOriginMarkerRef.current) {
      navOriginMarkerRef.current.remove();
      navOriginMarkerRef.current = null;
    }
    
    if (navigationOrigin && navigationOrigin.lat && navigationOrigin.lng) {
      const el = document.createElement('div');
      el.className = 'nav-origin-marker';
      el.innerHTML = `
        <div style="
          width: 24px;
          height: 24px;
          background: #22c55e;
          border: 2px solid white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          color: white;
          font-size: 12px;
          font-weight: bold;
        ">A</div>
      `;
      el.title = navigationOrigin.name || 'Start';
      
      navOriginMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([navigationOrigin.lng, navigationOrigin.lat])
        .addTo(map.current);
    }

    // Handle destination marker
    if (navDestinationMarkerRef.current) {
      navDestinationMarkerRef.current.remove();
      navDestinationMarkerRef.current = null;
    }
    
    if (navigationDestination && navigationDestination.lat && navigationDestination.lng) {
      const el = document.createElement('div');
      el.className = 'nav-destination-marker';
      el.innerHTML = `
        <div style="
          width: 24px;
          height: 24px;
          background: #ef4444;
          border: 2px solid white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          color: white;
          font-size: 12px;
          font-weight: bold;
        ">B</div>
      `;
      el.title = navigationDestination.name || 'Destination';
      
      navDestinationMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([navigationDestination.lng, navigationDestination.lat])
        .addTo(map.current);
    }
  }, [navigationOrigin, navigationDestination, mapLoaded]);

  // Navigation return point marker (shown when user is off-route)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Remove existing marker
    if (navReturnPointMarkerRef.current) {
      navReturnPointMarkerRef.current.remove();
      navReturnPointMarkerRef.current = null;
    }
    
    if (navigationReturnPoint && navigationReturnPoint.lat && navigationReturnPoint.lng) {
      const el = document.createElement('div');
      el.className = 'nav-return-point-marker';
      el.innerHTML = `
        <div style="
          width: 28px;
          height: 28px;
          background: #f59e0b;
          border: 3px solid white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 10px rgba(245, 158, 11, 0.5);
          color: white;
          font-size: 14px;
          animation: pulse 1.5s infinite;
        ">📍</div>
      `;
      el.title = 'Return to route here';
      
      navReturnPointMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([navigationReturnPoint.lng, navigationReturnPoint.lat])
        .addTo(map.current);
    }
  }, [navigationReturnPoint, mapLoaded]);

  // Update favourite runs layer filter when favouriteIds change
  useEffect(() => {
    if (!map.current || !mapLoaded || !layersInitialized.current) return;

    if (map.current.getLayer('ski-runs-favourite')) {
      map.current.setFilter('ski-runs-favourite',
        ['in', ['get', 'id'], ['literal', favouriteIds]]
      );
    }
  }, [favouriteIds, mapLoaded]);

  // Track what we've rendered to detect progressive loading updates
  const lastRenderedRunsRef = useRef<string | null>(null);
  const lastRenderedLiftsRef = useRef<string | null>(null);
  const lastRunsCountRef = useRef<string | null>(null);

  // Update map sources when runs/lifts are progressively loaded or status changes
  useEffect(() => {
    if (!map.current || !mapLoaded || !layersInitialized.current || !skiArea) return;

    // Create keys that include count AND status data to detect when status is enriched
    // Count how many items have non-null status to detect when status data arrives
    const runsWithStatus = skiArea.runs.filter(r => r.status && r.status !== 'unknown').length;
    const liftsWithStatus = skiArea.lifts.filter(l => l.status && l.status !== 'unknown').length;
    const runsKey = `${skiArea.id}-${skiArea.runs.length}-${runsWithStatus}`;
    const liftsKey = `${skiArea.id}-${skiArea.lifts.length}-${liftsWithStatus}`;
    const runsCountKey = `${skiArea.id}-${skiArea.runs.length}`;

    const runsChanged = runsKey !== lastRenderedRunsRef.current;
    const liftsChanged = liftsKey !== lastRenderedLiftsRef.current;
    const runsCountChanged = runsCountKey !== lastRunsCountRef.current;

    // Skip if nothing to update or no data loaded yet
    if (!runsChanged && !liftsChanged) return;
    if (skiArea.runs.length === 0 && skiArea.lifts.length === 0) return;

    // Update the tracking refs
    lastRenderedRunsRef.current = runsKey;
    lastRenderedLiftsRef.current = liftsKey;
    lastRunsCountRef.current = runsCountKey;

    // Start geometry precomputation only when new runs are loaded (not just status changes)
    if (runsCountChanged && skiArea.runs.length > 0) {
      geometryCacheRef.current = startGeometryPrecomputation(
        skiArea.id,
        skiArea.runs
      );
    }

    const sunPos = getSunPosition(selectedTime, skiArea.latitude, skiArea.longitude);

    // Update runs source (LineString runs for click detection)
    if (runsChanged && skiArea.runs.length > 0) {
      const runsSource = map.current.getSource('ski-runs') as maplibregl.GeoJSONSource | undefined;
      if (runsSource) {
        const runsGeoJSON = {
          type: 'FeatureCollection' as const,
          features: skiArea.runs
            .filter(run => run.geometry.type === 'LineString')
            .map(run => ({
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
        runsSource.setData(runsGeoJSON);
      }

      // Update segments source
      const segmentsSource = map.current.getSource('ski-segments') as maplibregl.GeoJSONSource | undefined;
      if (segmentsSource) {
        const segments = createRunSegments(skiArea, selectedTime, skiArea.latitude, skiArea.longitude);
        segmentsSource.setData(segments);
      }

      // Update polygon runs source
      const polygonSource = map.current.getSource('ski-runs-polygons') as maplibregl.GeoJSONSource | undefined;
      if (polygonSource) {
        const polygonRunsGeoJSON = {
          type: 'FeatureCollection' as const,
          features: skiArea.runs
            .filter(run => run.geometry.type === 'Polygon')
            .map(run => {
              const ring = run.geometry.coordinates[0] as number[][];
              let minLat = Infinity, maxLat = -Infinity;
              for (const [, lat] of ring) {
                minLat = Math.min(minLat, lat);
                maxLat = Math.max(maxLat, lat);
              }
              const latRange = maxLat - minLat;
              const slopeAspect = latRange > 0 ? 90 : 0;
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
        polygonSource.setData(polygonRunsGeoJSON);
      }
    }

    // Update lifts source
    if (liftsChanged && skiArea.lifts.length > 0) {
      const liftsSource = map.current.getSource('ski-lifts') as maplibregl.GeoJSONSource | undefined;
      if (liftsSource) {
        const liftsGeoJSON = {
          type: 'FeatureCollection' as const,
          features: skiArea.lifts.map(lift => {
            const minutesUntilClose = 'minutesUntilClose' in lift ? (lift as EnrichedLiftData).minutesUntilClose : null;
            const closingSoon = typeof minutesUntilClose === 'number' && minutesUntilClose > 0 && minutesUntilClose <= 60;
            return {
              type: 'Feature' as const,
              properties: {
                id: lift.id,
                name: lift.name,
                liftType: lift.liftType,
                status: lift.status,
                closingSoon,
              },
              geometry: lift.geometry,
            };
          }),
        };
        liftsSource.setData(liftsGeoJSON);
      }
    }
  }, [skiArea?.id, skiArea?.runs.length, skiArea?.lifts.length, mapLoaded, selectedTime]);

  // Update POI source when pois change
  useEffect(() => {
    if (!map.current || !mapLoaded || !layersInitialized.current) return;

    const poiSource = map.current.getSource('pois') as maplibregl.GeoJSONSource | undefined;
    if (!poiSource) return;

    // Simple text symbols for each POI type
    const getPoiSymbol = (type: string): string => {
      switch (type) {
        case 'toilet': return 'WC';
        case 'restaurant': return 'R';
        case 'viewpoint': return 'V';
        default: return '•';
      }
    };

    const poiGeoJSON = {
      type: 'FeatureCollection' as const,
      features: pois.map(poi => ({
        type: 'Feature' as const,
        properties: {
          id: poi.id,
          type: poi.type,
          name: poi.name || '',
          symbol: getPoiSymbol(poi.type),
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [poi.longitude, poi.latitude],
        },
      })),
    };

    poiSource.setData(poiGeoJSON);
  }, [pois, mapLoaded]);

  // Handle navigation route rendering and dimming
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Remove existing navigation layers
    const navLayers = ['nav-route-labels', 'nav-route-expert-stripes', 'nav-route-outline', 'nav-route-line', 'nav-route-glow'];
    navLayers.forEach(layerId => {
      if (map.current?.getLayer(layerId)) {
        map.current.removeLayer(layerId);
      }
    });
    if (map.current.getSource('nav-route')) {
      map.current.removeSource('nav-route');
    }

    // If no route, reset opacity and return
    if (!navigationRoute) {
      // Reset all layer opacities to normal
      const layersToReset = [
        'ski-segments-sunny', 'ski-segments-shaded', 'ski-segments-closed', 'ski-segments-closed-markers',
        'ski-segments-closing-soon', 'ski-segments-sunny-glow',
        'ski-lifts', 'ski-lifts-symbols', 'ski-runs-labels', 'ski-lifts-labels',
      ];
      layersToReset.forEach(layerId => {
        if (map.current?.getLayer(layerId)) {
          if (layerId.includes('glow')) {
            map.current.setPaintProperty(layerId, 'line-opacity', 0.6);
          } else if (layerId === 'ski-lifts') {
            map.current.setPaintProperty(layerId, 'line-opacity', 1);
          } else if (layerId === 'ski-lifts-symbols') {
            map.current.setPaintProperty(layerId, 'circle-opacity', 1);
          } else if (layerId.includes('labels') || layerId.includes('markers')) {
            map.current.setPaintProperty(layerId, 'text-opacity', 1);
          } else {
            map.current.setPaintProperty(layerId, 'line-opacity', 1);
          }
        }
      });
      
      // Reset POI styling to normal
      if (map.current.getLayer('poi-circles')) {
        map.current.setLayerZoomRange('poi-circles', 14, 24);
        map.current.setPaintProperty('poi-circles', 'circle-radius', [
          'interpolate',
          ['linear'],
          ['zoom'],
          14, 6,
          16, 10
        ]);
        map.current.setPaintProperty('poi-circles', 'circle-opacity', [
          'interpolate',
          ['linear'],
          ['zoom'],
          14, 0.8,
          15, 1
        ]);
      }
      if (map.current.getLayer('poi-icons')) {
        map.current.setLayerZoomRange('poi-icons', 14.5, 24);
      }
      if (map.current.getLayer('poi-labels')) {
        map.current.setLayerZoomRange('poi-labels', 15.5, 24);
        map.current.setPaintProperty('poi-labels', 'text-opacity', 1);
      }
      
      return;
    }

    // Dim all non-route features
    const dimOpacity = 0.25;
    const dimLayers = [
      { id: 'ski-segments-sunny', prop: 'line-opacity' },
      { id: 'ski-segments-shaded', prop: 'line-opacity' },
      { id: 'ski-segments-closing-soon', prop: 'line-opacity' },
      { id: 'ski-segments-sunny-glow', prop: 'line-opacity' },
      { id: 'ski-lifts', prop: 'line-opacity' },
      { id: 'ski-lifts-symbols', prop: 'circle-opacity' },
      { id: 'ski-runs-labels', prop: 'text-opacity' },
      { id: 'ski-lifts-labels', prop: 'text-opacity' },
    ];
    dimLayers.forEach(({ id, prop }) => {
      if (map.current?.getLayer(id)) {
        map.current.setPaintProperty(id, prop, dimOpacity);
      }
    });

    // Build route GeoJSON from segments
    const routeCoordinates: [number, number][][] = [];
    navigationRoute.segments.forEach(segment => {
      const coords = segment.coordinates.map(c => [c[0], c[1]] as [number, number]);
      routeCoordinates.push(coords);
    });

    const routeGeoJSON: FeatureCollection = {
      type: 'FeatureCollection',
      features: navigationRoute.segments.map((segment, idx) => ({
        type: 'Feature' as const,
        properties: {
          type: segment.type,
          name: segment.name,
          difficulty: segment.difficulty,
          liftType: segment.liftType,
          segmentIndex: idx,
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: segment.coordinates.map(c => [c[0], c[1]]),
        },
      })),
    };

    // Add route source
    map.current.addSource('nav-route', {
      type: 'geojson',
      data: routeGeoJSON,
    });

    // Add route glow layer
    map.current.addLayer({
      id: 'nav-route-glow',
      type: 'line',
      source: 'nav-route',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#3b82f6',
        'line-width': 14,
        'line-blur': 4,
        'line-opacity': 0.5,
      },
    });

    // Add route outline layer (white border)
    map.current.addLayer({
      id: 'nav-route-outline',
      type: 'line',
      source: 'nav-route',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#ffffff',
        'line-width': 8,
        'line-opacity': 1,
      },
    });

    // Add route line layer (colored by segment type)
    map.current.addLayer({
      id: 'nav-route-line',
      type: 'line',
      source: 'nav-route',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'type'], 'lift'], '#9ca3af', // Grey for lifts
          ['==', ['get', 'type'], 'walk'], '#f97316',
          // For runs, use difficulty colors
          ['==', ['get', 'difficulty'], 'novice'], '#22c55e',
          ['==', ['get', 'difficulty'], 'easy'], '#3b82f6',
          ['==', ['get', 'difficulty'], 'intermediate'], '#dc2626',
          ['==', ['get', 'difficulty'], 'advanced'], '#1a1a1a',
          ['==', ['get', 'difficulty'], 'expert'], '#1a1a1a', // Black base for expert
          '#3b82f6', // Default blue
        ],
        'line-width': 5,
        'line-opacity': 1,
      },
    });

    // Add expert route overlay with yellow dashes for hazard stripe effect
    map.current.addLayer({
      id: 'nav-route-expert-stripes',
      type: 'line',
      source: 'nav-route',
      filter: ['==', ['get', 'difficulty'], 'expert'],
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#fbbf24', // Yellow
        'line-width': 5,
        'line-opacity': 1,
        'line-dasharray': [2, 2], // Alternating pattern
      },
    });

    // Add route labels layer - show names of runs and lifts on the route
    map.current.addLayer({
      id: 'nav-route-labels',
      type: 'symbol',
      source: 'nav-route',
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-size': 12,
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-max-angle': 30,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'symbol-spacing': 200,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': [
          'case',
          ['==', ['get', 'type'], 'lift'], '#6b7280', // Grey for lifts
          ['==', ['get', 'type'], 'walk'], '#f97316',
          ['==', ['get', 'difficulty'], 'novice'], '#22c55e',
          ['==', ['get', 'difficulty'], 'easy'], '#3b82f6',
          ['==', ['get', 'difficulty'], 'intermediate'], '#dc2626',
          ['==', ['get', 'difficulty'], 'advanced'], '#1a1a1a',
          ['==', ['get', 'difficulty'], 'expert'], '#fbbf24', // Yellow for expert
          '#3b82f6',
        ],
        'text-halo-width': 2,
        'text-opacity': 1,
      },
    });

    // Highlight toilets during navigation (subtle)
    // Make toilets more visible when planning/navigating routes
    if (map.current.getLayer('poi-circles')) {
      map.current.setLayoutProperty('poi-circles', 'visibility', 'visible');
      // Lower minzoom for toilets so they appear earlier
      map.current.setLayerZoomRange('poi-circles', 12, 24);
      // Make toilet circles slightly larger and more prominent
      map.current.setPaintProperty('poi-circles', 'circle-radius', [
        'interpolate',
        ['linear'],
        ['zoom'],
        12, ['case', ['==', ['get', 'type'], 'toilet'], 5, 4], // Toilets slightly larger at low zoom
        14, ['case', ['==', ['get', 'type'], 'toilet'], 8, 6],
        16, ['case', ['==', ['get', 'type'], 'toilet'], 12, 10]
      ]);
      map.current.setPaintProperty('poi-circles', 'circle-opacity', [
        'case',
        ['==', ['get', 'type'], 'toilet'], 0.95, // Toilets more opaque
        0.7 // Other POIs dimmed
      ]);
    }
    if (map.current.getLayer('poi-icons')) {
      map.current.setLayerZoomRange('poi-icons', 12.5, 24);
    }
    if (map.current.getLayer('poi-labels')) {
      // Show toilet labels earlier
      map.current.setLayerZoomRange('poi-labels', 14, 24);
      map.current.setPaintProperty('poi-labels', 'text-opacity', [
        'case',
        ['==', ['get', 'type'], 'toilet'], 0.9,
        0.6 // Other labels dimmed
      ]);
    }

    // Fit bounds to route
    if (routeCoordinates.length > 0) {
      const allCoords = routeCoordinates.flat();
      if (allCoords.length > 0) {
        const lngs = allCoords.map(c => c[0]);
        const lats = allCoords.map(c => c[1]);
        const bounds: [[number, number], [number, number]] = [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ];
        map.current.fitBounds(bounds, {
          padding: { top: 100, bottom: 150, left: 50, right: 50 },
          duration: 500,
        });
      }
    }
  }, [navigationRoute, mapLoaded]);

  // Handle user heading for auto-orientation in navigation mode
  useEffect(() => {
    if (!map.current || !mapLoaded || !isNavigating) return;

    if (userHeading !== null && userHeading !== undefined) {
      // Rotate map to face the direction of travel
      map.current.easeTo({
        bearing: -userHeading, // Negative because we want map to rotate opposite to heading
        duration: 300,
      });
    }
  }, [userHeading, isNavigating, mapLoaded]);

  // Update shading without recreating layers
  // Uses requestAnimationFrame to batch all MapLibre updates into a single frame
  const updateShading = useCallback((area: SkiAreaDetails, time: Date) => {
    if (!map.current) return;

    // Cancel any pending animation frame to avoid duplicate updates
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }

    // Batch all map updates in a single animation frame for better performance
    rafIdRef.current = requestAnimationFrame(() => {
      if (!map.current) return;
      
      const sunPos = getSunPosition(time, area.latitude, area.longitude);
      const isNight = sunPos.altitudeDegrees <= 0;
      
      // Store refs for map move updates
      currentSunAzimuth.current = sunPos.azimuthDegrees;
      currentSkiAreaRef.current = area;

      // Build status and minutes until close maps for runs
      const runStatusMap = new Map<string, OperationStatus>();
      const runMinutesUntilCloseMap = new Map<string, number | undefined>();
      area.runs.forEach(run => {
        if (run.status) {
          runStatusMap.set(run.id, run.status);
        }
        if ('minutesUntilClose' in run) {
          runMinutesUntilCloseMap.set(run.id, (run as EnrichedRunData).minutesUntilClose);
        }
      });

      // Prepare segment data first (outside of map updates)
      const cache = getGeometryCache(area.id);
      let segments: GeoJSON.FeatureCollection;

      if (cache && cache.isComplete && cache.segments.size > 0) {
        // Use precomputed geometry - much faster, only calculates isShaded
        segments = generateShadedGeoJSON(cache, sunPos.azimuthDegrees, sunPos.altitudeDegrees, runStatusMap, runMinutesUntilCloseMap);
      } else {
        // Fallback to on-demand calculation (initial load or cache still processing)
        segments = createRunSegments(area, time, area.latitude, area.longitude);
      }

      // Prepare polygon data
      let polygonRunsGeoJSON: GeoJSON.FeatureCollection | null = null;
      const polygonsSource = map.current.getSource('ski-runs-polygons') as maplibregl.GeoJSONSource | undefined;
      if (polygonsSource) {
        polygonRunsGeoJSON = {
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
      }

      // Now apply all map updates together
      // Update night overlay
      if (map.current.getLayer('night-overlay')) {
        map.current.setPaintProperty('night-overlay', 'background-opacity', isNight ? 0.4 : 0);
      }

      // Update hillshade
      if (map.current.getLayer('terrain-hillshade')) {
        const illuminationDir = isNight ? 315 : sunPos.azimuthDegrees;
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
      const segmentsSource = map.current.getSource('ski-segments') as maplibregl.GeoJSONSource | undefined;
      if (segmentsSource) {
        segmentsSource.setData(segments);
      }

      // Update polygon fills
      if (polygonsSource && polygonRunsGeoJSON) {
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
    }); // End of requestAnimationFrame callback
  }, []);

  // Setup click handlers
  const setupClickHandlers = useCallback(() => {
    if (!map.current) return;

    // General map click handler
    map.current.on('click', (e) => {
      // Handle edit home mode
      if (isEditingHomeRef.current) {
        onSetHomeLocationRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
        return;
      }
      
      // Check if we clicked on a run or lift (includes touch detection layers)
      const features = map.current?.queryRenderedFeatures(e.point, { 
        layers: ['ski-runs-line', 'ski-lifts', 'ski-lifts-touch'] 
      });
      
      // If nav click mode or fake location drop mode is active and we didn't click a feature, handle background click
      if ((!features || features.length === 0) && (navMapClickModeRef.current || isFakeLocationDropModeRef.current)) {
        const handled = onMapBackgroundClickRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat });
        if (handled) return;
      }
      
      // Otherwise, close detail panel if no features clicked
      if (!features || features.length === 0) {
        onMapClickRef.current?.();
      }
    });

    map.current.on('click', 'ski-runs-line', (e) => {
      if (!e.features?.length || !map.current) return;
      if (isEditingHomeRef.current) return; // Don't trigger in edit mode
      
      const feature = e.features[0];
      const props = feature.properties;
      const runId = props.id;
      
      // Track run click
      trackEvent('run_clicked', {
        run_id: runId,
        run_name: props.name || undefined,
        run_difficulty: props.difficulty || undefined,
        ski_area_id: currentSkiAreaId.current || undefined,
        latitude: e.lngLat.lat,
        longitude: e.lngLat.lng,
      });
      
      // Call the onRunClick callback with map coordinates
      onRunClickRef.current?.(runId, { lng: e.lngLat.lng, lat: e.lngLat.lat });
    });
    
    // Handle polygon run clicks (sunny and shaded fill layers)
    // When clicking on a polygon fill, show the popup for the associated run
    // Only trigger for named runs - ignore clicks on unnamed polygons as they show unhelpful data
    const handlePolygonClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length || !map.current) return;
      if (isEditingHomeRef.current) return;
      
      const feature = e.features[0];
      const props = feature.properties;
      const runId = props.id;
      const runName = props.name;
      
      // Ignore clicks on unnamed polygon runs - they show unhelpful/redundant data
      if (!runName) {
        return;
      }
      
      // Track run click
      trackEvent('run_clicked', {
        run_id: runId,
        run_name: runName || undefined,
        run_difficulty: props.difficulty || undefined,
        ski_area_id: currentSkiAreaId.current || undefined,
        latitude: e.lngLat.lat,
        longitude: e.lngLat.lng,
      });
      
      // Call the onRunClick callback with map coordinates
      onRunClickRef.current?.(runId, { lng: e.lngLat.lng, lat: e.lngLat.lat });
    };
    
    // Polygon click handlers - only handle clicks for named runs (unnamed are ignored)
    // No pointer cursor shown since these are secondary visual elements
    if (map.current.getLayer('ski-runs-polygon-fill-sunny')) {
      map.current.on('click', 'ski-runs-polygon-fill-sunny', handlePolygonClick);
    }
    
    if (map.current.getLayer('ski-runs-polygon-fill-shaded')) {
      map.current.on('click', 'ski-runs-polygon-fill-shaded', handlePolygonClick);
    }

    // Lift click handler (shared for both visible and touch layers)
    const handleLiftClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length || !map.current) return;
      if (isEditingHomeRef.current) return; // Don't show popup in edit mode

      const feature = e.features[0];
      const props = feature.properties;
      const liftId = props.id;

      // Look up the full enriched lift data to get opening times, etc.
      const enrichedLift = skiArea?.lifts.find(l => l.id === liftId);
      const liveStatus = enrichedLift && 'liveStatus' in enrichedLift ? (enrichedLift as EnrichedLiftData).liveStatus : null;

      // Track lift click
      trackEvent('lift_selected', {
        lift_id: liftId,
        lift_name: props.name || undefined,
        lift_type: props.liftType || undefined,
        ski_area_id: currentSkiAreaId.current || undefined,
      });

      // Call the onLiftClick callback with map coordinates (for navigation)
      onLiftClickRef.current?.(liftId, { lng: e.lngLat.lng, lat: e.lngLat.lat });

      // Only show popup if not in navigation click mode
      if (!navMapClickModeRef.current) {
        // Get status from enriched data or fall back to GeoJSON props
        const status = enrichedLift?.status || props.status as string | undefined;
        const statusColor = status === 'open' ? '#22c55e' : status === 'closed' ? '#ef4444' : status === 'scheduled' ? '#eab308' : '#888';
        const statusBg = status === 'open' ? 'rgba(34, 197, 94, 0.15)' : status === 'closed' ? 'rgba(239, 68, 68, 0.15)' : status === 'scheduled' ? 'rgba(234, 179, 8, 0.15)' : 'rgba(136, 136, 136, 0.15)';
        const statusLabel = status === 'open' ? 'Open' : status === 'closed' ? 'Closed' : status === 'scheduled' ? 'Scheduled' : null;

        // Build opening times string
        const openingTimes = liveStatus?.openingTimes?.[0];
        const timesStr = openingTimes ? `${openingTimes.beginTime} - ${openingTimes.endTime}` : null;

        // Get closing info
        const closingTime = enrichedLift && 'closingTime' in enrichedLift ? (enrichedLift as EnrichedLiftData).closingTime : null;
        const minutesUntilClose = enrichedLift && 'minutesUntilClose' in enrichedLift ? (enrichedLift as EnrichedLiftData).minutesUntilClose : null;
        const closingSoon = typeof minutesUntilClose === 'number' && minutesUntilClose > 0 && minutesUntilClose <= 60;

        // Build additional info
        const speed = liveStatus?.speed;
        const capacity = liveStatus?.uphillCapacity;
        const message = liveStatus?.message;

        new maplibregl.Popup({
          closeButton: true,
          closeOnClick: false,
          className: 'search-highlight-popup',
        })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div class="lift-popup" style="min-width: 160px; max-width: 220px;">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                <strong style="font-size: 13px;">${props.name || 'Unnamed Lift'}</strong>
                ${statusLabel ? `<span style="font-size: 9px; padding: 1px 4px; border-radius: 3px; background: ${statusBg}; color: ${statusColor}; font-weight: 500; margin-left: auto;">${statusLabel}</span>` : ''}
              </div>
              ${props.liftType ? `<div style="font-size: 10px; color: #888; margin-bottom: 4px;">${props.liftType}</div>` : ''}
              ${timesStr || speed || capacity ? `<div style="display: flex; flex-wrap: wrap; gap: 6px; font-size: 10px; margin-bottom: 4px;">
                ${timesStr ? `<span style="color: #aaa;">${timesStr}${closingSoon ? ` <span style="color: #eab308;">(${minutesUntilClose}min)</span>` : ''}</span>` : ''}
                ${speed ? `<span style="color: #888;">${speed} m/s</span>` : ''}
                ${capacity ? `<span style="color: #888;">${capacity} pers/h</span>` : ''}
              </div>` : ''}
              ${message ? `<div style="font-size: 10px; color: #f97316; padding: 4px 6px; background: rgba(249, 115, 22, 0.1); border-radius: 4px;">${message}</div>` : ''}
            </div>
          `)
          .addTo(map.current);
      }
    };

    map.current.on('click', 'ski-lifts', handleLiftClick);
    map.current.on('click', 'ski-lifts-touch', handleLiftClick);

    map.current.on('mouseenter', 'ski-runs-line', () => {
      if (map.current) map.current.getCanvas().style.cursor = 'pointer';
    });

    map.current.on('mouseleave', 'ski-runs-line', () => {
      if (map.current) map.current.getCanvas().style.cursor = '';
    });
    
    // Also make lifts clickable (both visible and touch layers)
    map.current.on('mouseenter', 'ski-lifts', () => {
      if (map.current) map.current.getCanvas().style.cursor = 'pointer';
    });

    map.current.on('mouseleave', 'ski-lifts', () => {
      if (map.current) map.current.getCanvas().style.cursor = '';
    });

    map.current.on('mouseenter', 'ski-lifts-touch', () => {
      if (map.current) map.current.getCanvas().style.cursor = 'pointer';
    });

    map.current.on('mouseleave', 'ski-lifts-touch', () => {
      if (map.current) map.current.getCanvas().style.cursor = '';
    });

    // POI click handler - show popup with basic information
    const handlePoiClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length || !map.current) return;
      if (isEditingHomeRef.current) return;
      
      const feature = e.features[0];
      const props = feature.properties;
      const poiType = props.type as string;
      const poiName = props.name as string;
      
      // Get label and color based on POI type
      const getPoiInfo = (type: string) => {
        switch (type) {
          case 'toilet':
            return { label: 'Restroom', color: '#3b82f6' };
          case 'restaurant':
            return { label: 'Restaurant', color: '#f97316' };
          case 'viewpoint':
            return { label: 'Viewpoint', color: '#22c55e' };
          default:
            return { label: 'Point of Interest', color: '#888888' };
        }
      };
      
      const poiInfo = getPoiInfo(poiType);
      
      // Track POI click
      trackEvent('poi_clicked', {
        poi_id: props.id,
        poi_type: poiType,
        poi_name: poiName || undefined,
        ski_area_id: currentSkiAreaId.current || undefined,
        latitude: e.lngLat.lat,
        longitude: e.lngLat.lng,
      });
      
      // Create popup content
      const popupContent = `
        <div style="padding: 8px; min-width: 100px;">
          <strong style="font-size: 13px; color: ${poiInfo.color};">${poiInfo.label}</strong>
          ${poiName ? `<div style="font-size: 12px; color: #e0e0e0; margin-top: 4px;">${poiName}</div>` : ''}
        </div>
      `;
      
      new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        className: 'poi-popup',
      })
        .setLngLat(e.lngLat)
        .setHTML(popupContent)
        .addTo(map.current);
    };

    map.current.on('click', 'poi-circles', handlePoiClick);
    map.current.on('click', 'poi-icons', handlePoiClick);

    // POI hover cursor
    map.current.on('mouseenter', 'poi-circles', () => {
      if (map.current) map.current.getCanvas().style.cursor = 'pointer';
    });

    map.current.on('mouseleave', 'poi-circles', () => {
      if (map.current) map.current.getCanvas().style.cursor = '';
    });

    map.current.on('mouseenter', 'poi-icons', () => {
      if (map.current) map.current.getCanvas().style.cursor = 'pointer';
    });

    map.current.on('mouseleave', 'poi-icons', () => {
      if (map.current) map.current.getCanvas().style.cursor = '';
    });
  }, []);

  // Update cursor when nav click mode is active
  useEffect(() => {
    if (!map.current) return;
    
    if (navMapClickMode || isFakeLocationDropMode) {
      // Add crosshair cursor when clicking mode is active
      map.current.getCanvas().style.cursor = 'crosshair';
    } else {
      map.current.getCanvas().style.cursor = '';
    }
  }, [navMapClickMode, isFakeLocationDropMode]);

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
      
      {/* Navigation map click mode indicator - positioned at top on all devices */}
      {(navMapClickMode || isFakeLocationDropMode) && (
        <div 
          className="nav-click-mode-indicator"
          style={{ 
            position: 'absolute',
            top: 60,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30,
            padding: '8px 16px',
            borderRadius: 20,
            background: isFakeLocationDropMode ? 'rgba(34, 197, 94, 0.95)' : 'rgba(59, 130, 246, 0.95)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: 12, color: 'white', fontWeight: 500, whiteSpace: 'nowrap' }}>
            {isFakeLocationDropMode 
              ? '📍 Tap to set fake location' 
              : navMapClickMode === 'origin'
                ? '📍 Tap to set your START location'
                : '🏁 Tap to set your DESTINATION'
            }
          </span>
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

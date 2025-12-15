import type { Feature, FeatureCollection, Geometry, LineString, Point, Polygon } from 'geojson';

export interface SkiAreaSummary {
  id: string;
  name: string;
  country: string | null;
  region: string | null;
  latitude: number;
  longitude: number;
}

export interface SubRegionData {
  id: string;
  name: string;
  bounds: BoundingBox | null;
  centroid: { lat: number; lng: number } | null;
}

export interface SkiAreaDetails extends SkiAreaSummary {
  bounds: BoundingBox | null;
  geometry: Geometry | null;
  properties: Record<string, unknown> | null;
  runs: RunData[];
  lifts: LiftData[];
  subRegions: SubRegionData[];
  connectedAreas?: SkiAreaSummary[];
}

export interface RunData {
  id: string;
  name: string | null;
  difficulty: RunDifficulty | null;
  status: OperationStatus | null;
  geometry: LineString | Polygon;
  properties: Record<string, unknown> | null;
  subRegionId: string | null;
  subRegionName?: string | null;
}

export interface LiftData {
  id: string;
  name: string | null;
  liftType: string | null;
  status: OperationStatus | null;
  capacity: number | null;
  geometry: LineString;
  properties: Record<string, unknown> | null;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export type RunDifficulty = 'novice' | 'easy' | 'intermediate' | 'advanced' | 'expert';
export type OperationStatus = 'open' | 'closed' | 'unknown';

export interface MapViewState {
  latitude: number;
  longitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface TimeSliderValue {
  date: Date;
  displayTime: string;
}

export interface SunInfo {
  azimuthDegrees: number;
  altitudeDegrees: number;
  isUp: boolean;
  sunrise: Date;
  sunset: Date;
}

// GeoJSON feature with typed properties
export interface SkiRunFeature extends Feature<LineString | Polygon> {
  properties: {
    id: string;
    name: string | null;
    difficulty: RunDifficulty | null;
    status: OperationStatus | null;
    isShaded: boolean;
    shadeConfidence: number;
  };
}

export interface SkiLiftFeature extends Feature<LineString> {
  properties: {
    id: string;
    name: string | null;
    liftType: string | null;
    status: OperationStatus | null;
  };
}

export interface SkiRunsGeoJSON extends FeatureCollection<LineString | Polygon> {
  features: SkiRunFeature[];
}

export interface SkiLiftsGeoJSON extends FeatureCollection<LineString> {
  features: SkiLiftFeature[];
}

// Points of Interest types
export type POIType = 'toilet' | 'restaurant' | 'viewpoint';

export interface POIData {
  id: string;
  type: POIType;
  name: string | null;
  latitude: number;
  longitude: number;
}


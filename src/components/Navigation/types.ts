import type { NavigationRoute } from '@/lib/navigation';
import type { RouteSunAnalysis } from '@/lib/route-sun-calculator';
import type { POIData } from '@/lib/types';

export interface NavigationState {
  isActive: boolean;
  origin: SelectedPoint | null;
  destination: SelectedPoint | null;
  route: NavigationRoute | null;
  isNavigating: boolean;
  currentHeading: number | null;
}

export interface SelectedPoint {
  type: 'run' | 'lift' | 'location' | 'mapPoint' | 'home' | 'closestToilet';
  id: string;
  name: string;
  nodeId?: string;
  difficulty?: string | null;
  liftType?: string | null;
  lat?: number;
  lng?: number;
  position?: 'top' | 'bottom';
}

export interface RouteFilters {
  difficulties: {
    novice: boolean;
    easy: boolean;
    intermediate: boolean;
    advanced: boolean;
    expert: boolean;
  };
  liftTypes: {
    gondola: boolean;
    cable_car: boolean;
    chair_lift: boolean;
    't-bar': boolean;
    drag_lift: boolean;
    platter: boolean;
    rope_tow: boolean;
    magic_carpet: boolean;
    funicular: boolean;
  };
}

export const DEFAULT_FILTERS: RouteFilters = {
  difficulties: {
    novice: true,
    easy: true,
    intermediate: true,
    advanced: true,
    expert: true,
  },
  liftTypes: {
    gondola: true,
    cable_car: true,
    chair_lift: true,
    't-bar': true,
    drag_lift: true,
    platter: true,
    rope_tow: true,
    magic_carpet: true,
    funicular: true,
  },
};

// Collapsed section state
export type SectionId = 'origin-destination' | 'route-options' | 'route-steps';


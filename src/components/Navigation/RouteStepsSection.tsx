'use client';

import { useMemo, useCallback } from 'react';
import { NodeIndexOutlined, SwapOutlined } from '@ant-design/icons';
import { CollapsibleSection } from './CollapsibleSection';
import { getDifficultyColor } from '@/lib/shade-calculator';
import { formatDuration, formatDistance, type NavigationRoute } from '@/lib/navigation';
import type { POIData } from '@/lib/types';

interface DisplaySegment {
  displayName: string;
  type: 'lift' | 'run' | 'walk';
  difficulty?: string | null;
  distance: number;
  time: number;
  elevationChange: number;
  coordinates: [number, number, number?][];
}

interface RouteStepsSectionProps {
  route: NavigationRoute;
  pois?: POIData[];
  isExpanded: boolean;
  onToggle: () => void;
}

export function RouteStepsSection({
  route,
  pois = [],
  isExpanded,
  onToggle,
}: RouteStepsSectionProps) {
  // Check if there are toilets near a segment
  const hasNearbyToilet = useCallback((coordinates: [number, number, number?][]) => {
    if (pois.length === 0 || coordinates.length === 0) return false;
    const toilets = pois.filter((poi) => poi.type === 'toilet');
    if (toilets.length === 0) return false;
    const NEARBY_THRESHOLD = 0.001;
    for (const toilet of toilets) {
      for (const coord of coordinates) {
        const distance = Math.sqrt(
          Math.pow(coord[1] - toilet.latitude, 2) + Math.pow(coord[0] - toilet.longitude, 2)
        );
        if (distance < NEARBY_THRESHOLD) return true;
      }
    }
    return false;
  }, [pois]);

  // Find next named destination for unnamed segments
  const getConnectionDestination = (segmentIndex: number, segments: typeof route.segments) => {
    for (let i = segmentIndex + 1; i < segments.length; i++) {
      const nextSeg = segments[i];
      if (!nextSeg.name || nextSeg.name === 'Connection' || nextSeg.name === 'Extended Walk') continue;
      return nextSeg.name;
    }
    return null;
  };

  // Get display name for a segment
  const getSegmentName = (
    segment: typeof route.segments[0],
    idx: number,
    segments: typeof route.segments
  ) => {
    if (segment.type === 'walk') return 'Walk/Skate';
    if (segment.type === 'run' && !segment.name) {
      const destination = getConnectionDestination(idx, segments);
      if (destination) return `Connection to ${destination}`;
    }
    return segment.name || 'Unnamed';
  };

  // Merge consecutive segments with the same display name
  const displaySegments = useMemo(() => {
    const merged: DisplaySegment[] = [];
    for (let i = 0; i < route.segments.length; i++) {
      const segment = route.segments[i];
      const displayName = getSegmentName(segment, i, route.segments);
      if (merged.length > 0) {
        const lastMerged = merged[merged.length - 1];
        if (lastMerged.displayName === displayName && lastMerged.type === segment.type) {
          lastMerged.distance += segment.distance;
          lastMerged.time += segment.time;
          lastMerged.elevationChange += segment.elevationChange;
          lastMerged.coordinates = [...lastMerged.coordinates, ...segment.coordinates];
          continue;
        }
      }
      merged.push({
        displayName,
        type: segment.type,
        difficulty: segment.difficulty,
        distance: segment.distance,
        time: segment.time,
        elevationChange: segment.elevationChange,
        coordinates: segment.coordinates,
      });
    }
    return merged;
  }, [route.segments]);

  const badge = <span className="steps-badge">{displaySegments.length} steps</span>;

  return (
    <CollapsibleSection
      title="Route Steps"
      icon={<NodeIndexOutlined style={{ fontSize: 11 }} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      badge={!isExpanded ? badge : undefined}
    >
      <div className="route-steps-content">
        {displaySegments.map((segment, idx) => {
          const hasToilet = hasNearbyToilet(segment.coordinates);
          return (
            <div key={idx} className="route-step">
              <div className="route-step-icon">
                {segment.type === 'lift' ? (
                  <SwapOutlined style={{ fontSize: 11, color: '#9ca3af' }} />
                ) : segment.type === 'run' ? (
                  <span
                    className="route-step-dot"
                    style={{ backgroundColor: getDifficultyColor(segment.difficulty) }}
                  />
                ) : (
                  <span className="route-step-dot" style={{ backgroundColor: '#f97316' }} />
                )}
              </div>
              <div className="route-step-info">
                <span className="route-step-name">
                  {segment.displayName}
                  {hasToilet && (
                    <span className="route-step-wc" title="Toilet nearby">WC</span>
                  )}
                </span>
                <span className="route-step-meta">
                  {formatDistance(segment.distance)} · {formatDuration(segment.time)}
                  {segment.elevationChange !== 0 && (
                    <span className={segment.elevationChange > 0 ? 'elev-up' : 'elev-down'}>
                      {' '}· {segment.elevationChange > 0 ? '↑' : '↓'}
                      {Math.abs(Math.round(segment.elevationChange))}m
                    </span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}


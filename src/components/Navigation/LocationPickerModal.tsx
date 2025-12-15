'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Input } from 'antd';
import {
  SearchOutlined,
  CloseOutlined,
  AimOutlined,
  HomeOutlined,
  NodeIndexOutlined,
  SwapOutlined,
  EnvironmentOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import type { SkiAreaDetails } from '@/lib/types';
import { getDifficultyColor } from '@/lib/shade-calculator';
import type { UserLocation, MountainHome } from '@/components/LocationControls';
import type { SelectedPoint } from './types';

interface LocationPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (point: SelectedPoint) => void;
  skiArea: SkiAreaDetails;
  title: string;
  showCurrentLocation?: boolean;
  userLocation?: UserLocation | null;
  isUserLocationValid?: boolean;
  mountainHome?: MountainHome | null;
  onRequestMapClick?: () => void;
}

export function LocationPickerModal({
  isOpen,
  onClose,
  onSelect,
  skiArea,
  title,
  showCurrentLocation = false,
  userLocation,
  isUserLocationValid = false,
  mountainHome,
  onRequestMapClick,
}: LocationPickerModalProps) {
  const [searchText, setSearchText] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchText('');
      setSelectedIndex(-1);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filter runs and lifts by search - deduplicate by name+subregion
  const filteredRuns = useMemo(() => {
    if (!searchText) return [];
    const lower = searchText.toLowerCase();
    const matchingRuns = skiArea.runs.filter((r) => r.name && r.name.toLowerCase().includes(lower));
    
    const grouped = new Map<string, typeof matchingRuns[0]>();
    for (const run of matchingRuns) {
      const key = `${run.name}::${run.subRegionName || ''}`;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, run);
      } else {
        const getMaxElevation = (r: typeof run) => {
          if (r.geometry.type === 'LineString') {
            const coords = r.geometry.coordinates;
            return coords.length > 0 ? (coords[0][2] || coords[0][1]) : 0;
          }
          return 0;
        };
        if (getMaxElevation(run) > getMaxElevation(existing)) {
          grouped.set(key, run);
        }
      }
    }
    return Array.from(grouped.values()).slice(0, 10);
  }, [skiArea.runs, searchText]);

  const filteredLifts = useMemo(() => {
    if (!searchText) return [];
    const lower = searchText.toLowerCase();
    return skiArea.lifts
      .filter((l) => l.name?.toLowerCase().includes(lower))
      .slice(0, 6);
  }, [skiArea.lifts, searchText]);

  // Combined results for keyboard navigation
  const allResults = useMemo(() => {
    const results: SelectedPoint[] = [];
    
    if (showCurrentLocation && userLocation && isUserLocationValid && (!searchText || 'current location my location'.includes(searchText.toLowerCase()))) {
      results.push({
        type: 'location',
        id: 'current-location',
        name: 'My Current Location',
        lat: userLocation.latitude,
        lng: userLocation.longitude,
      });
    }
    
    // Add "Closest Toilet" as a searchable special destination
    if (!searchText || 'toilet wc bathroom restroom closest'.includes(searchText.toLowerCase())) {
      results.push({
        type: 'closestToilet',
        id: 'closest-toilet',
        name: 'Closest Toilet',
      });
    }
    
    filteredRuns.forEach((run) => {
      results.push({
        type: 'run',
        id: run.id,
        name: run.name || 'Unnamed Run',
        nodeId: `run-${run.id}-start`,
        difficulty: run.difficulty,
      });
    });
    
    filteredLifts.forEach((lift) => {
      results.push({
        type: 'lift',
        id: lift.id,
        name: lift.name || 'Unnamed Lift',
        nodeId: `lift-${lift.id}-start`,
        liftType: lift.liftType,
      });
    });
    
    return results;
  }, [filteredRuns, filteredLifts, showCurrentLocation, userLocation, isUserLocationValid, searchText]);

  const handleSelect = useCallback((point: SelectedPoint) => {
    onSelect(point);
    onClose();
  }, [onSelect, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, allResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      handleSelect(allResults[selectedIndex]);
    }
  }, [allResults, selectedIndex, handleSelect]);

  const handleMapClick = useCallback(() => {
    onRequestMapClick?.();
    onClose();
  }, [onRequestMapClick, onClose]);

  if (!isOpen) return null;

  return (
    <div className="location-picker-overlay" onClick={onClose}>
      <div className="location-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="location-picker-header">
          <span className="location-picker-title">{title}</span>
          <button className="location-picker-close" onClick={onClose}>
            <CloseOutlined style={{ fontSize: 14 }} />
          </button>
        </div>
        
        <div className="location-picker-search">
          <Input
            ref={inputRef as any}
            placeholder="Search runs, lifts..."
            prefix={<SearchOutlined style={{ fontSize: 14, opacity: 0.5 }} />}
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setSelectedIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            size="large"
            autoFocus
          />
        </div>

        <div className="location-picker-quick-actions">
          {showCurrentLocation && userLocation && isUserLocationValid && (
            <button 
              className="location-picker-quick-btn"
              onClick={() => handleSelect({
                type: 'location',
                id: 'current-location',
                name: 'My Current Location',
                lat: userLocation.latitude,
                lng: userLocation.longitude,
              })}
            >
              <AimOutlined style={{ fontSize: 14, color: '#3b82f6' }} />
              <span>Current Location</span>
            </button>
          )}
          
          {mountainHome && (
            <button 
              className="location-picker-quick-btn"
              onClick={() => handleSelect({
                type: 'home',
                id: 'mountain-home',
                name: mountainHome.name,
                lat: mountainHome.latitude,
                lng: mountainHome.longitude,
              })}
            >
              <HomeOutlined style={{ fontSize: 14, color: '#faad14' }} />
              <span>{mountainHome.name}</span>
            </button>
          )}
          
          {onRequestMapClick && (
            <button className="location-picker-quick-btn" onClick={handleMapClick}>
              <EnvironmentOutlined style={{ fontSize: 14, color: '#f59e0b' }} />
              <span>Pick on Map</span>
            </button>
          )}
        </div>

        <div className="location-picker-results">
          {/* No search yet */}
          {!searchText && allResults.length === 0 && (
            <div className="location-picker-hint">
              Type to search for runs and lifts
            </div>
          )}
          
          {/* Warning if user location is too far */}
          {showCurrentLocation && userLocation && !isUserLocationValid && (
            <div className="location-picker-warning">
              <AimOutlined style={{ fontSize: 12, marginRight: 6 }} />
              Location is too far from ski area
            </div>
          )}
          
          {/* Closest Toilet option */}
          {(!searchText || 'toilet wc bathroom restroom closest'.includes(searchText.toLowerCase())) && (
            <button
              className={`location-picker-item ${selectedIndex === (showCurrentLocation && userLocation && isUserLocationValid ? 1 : 0) ? 'selected' : ''}`}
              onClick={() => handleSelect({
                type: 'closestToilet',
                id: 'closest-toilet',
                name: 'Closest Toilet',
              })}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: '#3b82f6', marginRight: 8 }}>WC</span>
              <span className="location-picker-item-name">Closest Toilet</span>
              <span className="location-picker-item-meta">Route to nearest</span>
            </button>
          )}
          
          {/* Runs */}
          {filteredRuns.length > 0 && (
            <div className="location-picker-category">
              <div className="location-picker-category-header">
                <NodeIndexOutlined style={{ fontSize: 10, marginRight: 4 }} />
                Runs
              </div>
              {filteredRuns.map((run, idx) => {
                const resultIndex = (showCurrentLocation && userLocation && isUserLocationValid) ? idx + 1 : idx;
                return (
                  <button
                    key={run.id}
                    className={`location-picker-item ${selectedIndex === resultIndex ? 'selected' : ''}`}
                    onClick={() => handleSelect({
                      type: 'run',
                      id: run.id,
                      name: run.name || 'Unnamed',
                      nodeId: `run-${run.id}-start`,
                      difficulty: run.difficulty,
                    })}
                  >
                    <span
                      className="location-picker-dot"
                      style={{ backgroundColor: getDifficultyColor(run.difficulty) }}
                    />
                    <span className="location-picker-item-name">{run.name || 'Unnamed'}</span>
                    {run.subRegionName && (
                      <span className="location-picker-item-subregion">{run.subRegionName}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          
          {/* Lifts */}
          {filteredLifts.length > 0 && (
            <div className="location-picker-category">
              <div className="location-picker-category-header">
                <SwapOutlined style={{ fontSize: 10, marginRight: 4 }} />
                Lifts
              </div>
              {filteredLifts.map((lift, idx) => {
                const resultIndex = (showCurrentLocation && userLocation && isUserLocationValid ? 1 : 0) + filteredRuns.length + idx;
                return (
                  <button
                    key={lift.id}
                    className={`location-picker-item ${selectedIndex === resultIndex ? 'selected' : ''}`}
                    onClick={() => handleSelect({
                      type: 'lift',
                      id: lift.id,
                      name: lift.name || 'Unnamed',
                      nodeId: `lift-${lift.id}-start`,
                      liftType: lift.liftType,
                    })}
                  >
                    <SwapOutlined style={{ fontSize: 12, color: '#52c41a', marginRight: 8 }} />
                    <span className="location-picker-item-name">{lift.name || 'Unnamed'}</span>
                    {lift.liftType && (
                      <span className="location-picker-item-meta">{lift.liftType}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          
          {/* No results */}
          {searchText && allResults.length === 0 && (
            <div className="location-picker-no-results">
              No results found for "{searchText}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Point display component with top/bottom toggle
interface SelectedPointDisplayProps {
  point: SelectedPoint;
  onClear: () => void;
  onPositionChange?: (position: 'top' | 'bottom') => void;
}

export function SelectedPointDisplay({ point, onClear, onPositionChange }: SelectedPointDisplayProps) {
  const getDefaultPosition = () => {
    if (point.position) return point.position;
    return point.type === 'run' ? 'top' : point.type === 'lift' ? 'bottom' : undefined;
  };
  
  const effectivePosition = getDefaultPosition();
  const showPositionToggle = point.type === 'run' || point.type === 'lift';
  
  return (
    <div className="selected-point-display">
      <div className="selected-point-main" onClick={onClear}>
        {point.type === 'location' && <AimOutlined style={{ fontSize: 12, color: '#3b82f6' }} />}
        {point.type === 'home' && <HomeOutlined style={{ fontSize: 12, color: '#faad14' }} />}
        {point.type === 'mapPoint' && <EnvironmentOutlined style={{ fontSize: 12, color: '#f59e0b' }} />}
        {point.type === 'closestToilet' && <span style={{ fontSize: 11, fontWeight: 600, color: '#3b82f6' }}>WC</span>}
        {point.type === 'run' && (
          <span className="location-picker-dot" style={{ backgroundColor: getDifficultyColor(point.difficulty) }} />
        )}
        {point.type === 'lift' && <SwapOutlined style={{ fontSize: 11, color: '#52c41a' }} />}
        <span className="selected-point-name">{point.name}</span>
        <CloseOutlined style={{ fontSize: 10, opacity: 0.5 }} />
      </div>
      
      {showPositionToggle && onPositionChange && (
        <div className="selected-point-position">
          <button
            className={`position-btn ${effectivePosition === 'top' ? 'active' : ''}`}
            onClick={() => onPositionChange('top')}
          >
            <ArrowUpOutlined style={{ fontSize: 9 }} />
            Top
          </button>
          <button
            className={`position-btn ${effectivePosition === 'bottom' ? 'active' : ''}`}
            onClick={() => onPositionChange('bottom')}
          >
            <ArrowDownOutlined style={{ fontSize: 9 }} />
            Bottom
          </button>
        </div>
      )}
    </div>
  );
}


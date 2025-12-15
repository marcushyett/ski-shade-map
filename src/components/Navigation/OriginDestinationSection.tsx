'use client';

import { useState, useCallback } from 'react';
import { SwapOutlined, EnvironmentOutlined } from '@ant-design/icons';
import type { SkiAreaDetails } from '@/lib/types';
import type { UserLocation, MountainHome } from '@/components/LocationControls';
import { CollapsibleSection } from './CollapsibleSection';
import { LocationPickerModal, SelectedPointDisplay } from './LocationPickerModal';
import type { SelectedPoint } from './types';

interface OriginDestinationSectionProps {
  origin: SelectedPoint | null;
  destination: SelectedPoint | null;
  onOriginChange: (point: SelectedPoint | null) => void;
  onDestinationChange: (point: SelectedPoint | null) => void;
  skiArea: SkiAreaDetails;
  userLocation: UserLocation | null;
  isUserLocationValid: boolean;
  mountainHome: MountainHome | null;
  isExpanded: boolean;
  onToggle: () => void;
  onRequestMapClick?: (field: 'origin' | 'destination') => void;
  mapClickMode?: 'origin' | 'destination' | null;
}

export function OriginDestinationSection({
  origin,
  destination,
  onOriginChange,
  onDestinationChange,
  skiArea,
  userLocation,
  isUserLocationValid,
  mountainHome,
  isExpanded,
  onToggle,
  onRequestMapClick,
  mapClickMode,
}: OriginDestinationSectionProps) {
  const [activeModal, setActiveModal] = useState<'origin' | 'destination' | null>(null);

  const handleSwap = useCallback(() => {
    const temp = origin;
    onOriginChange(destination);
    onDestinationChange(temp);
  }, [origin, destination, onOriginChange, onDestinationChange]);

  const handleOriginPositionChange = useCallback((position: 'top' | 'bottom') => {
    if (origin) {
      onOriginChange({ ...origin, position });
    }
  }, [origin, onOriginChange]);

  const handleDestinationPositionChange = useCallback((position: 'top' | 'bottom') => {
    if (destination) {
      onDestinationChange({ ...destination, position });
    }
  }, [destination, onDestinationChange]);

  // Badge showing origin → destination summary
  const badge = origin && destination ? (
    <span className="od-badge">
      {origin.name.slice(0, 10)}{origin.name.length > 10 ? '...' : ''} → {destination.name.slice(0, 10)}{destination.name.length > 10 ? '...' : ''}
    </span>
  ) : origin ? (
    <span className="od-badge">From: {origin.name.slice(0, 15)}{origin.name.length > 15 ? '...' : ''}</span>
  ) : null;

  return (
    <>
      <CollapsibleSection
        title="Origin & Destination"
        icon={<EnvironmentOutlined style={{ fontSize: 11 }} />}
        isExpanded={isExpanded}
        onToggle={onToggle}
        badge={!isExpanded ? badge : undefined}
      >
        <div className="od-section-content">
          {/* From field */}
          <div className="od-field">
            <label className="od-label">FROM</label>
            {origin ? (
              <SelectedPointDisplay
                point={origin}
                onClear={() => onOriginChange(null)}
                onPositionChange={handleOriginPositionChange}
              />
            ) : (
              <button 
                className={`od-select-btn ${mapClickMode === 'origin' ? 'map-mode' : ''}`}
                onClick={() => setActiveModal('origin')}
              >
                {mapClickMode === 'origin' ? 'Click on map or ' : ''}Select start point...
              </button>
            )}
          </div>

          {/* Swap button */}
          <div className="od-swap-row">
            <button className="od-swap-btn" onClick={handleSwap} title="Swap origin and destination">
              <SwapOutlined style={{ transform: 'rotate(90deg)', fontSize: 12 }} />
            </button>
          </div>

          {/* To field */}
          <div className="od-field">
            <label className="od-label">TO</label>
            {destination ? (
              <SelectedPointDisplay
                point={destination}
                onClear={() => onDestinationChange(null)}
                onPositionChange={handleDestinationPositionChange}
              />
            ) : (
              <button 
                className={`od-select-btn ${mapClickMode === 'destination' ? 'map-mode' : ''}`}
                onClick={() => setActiveModal('destination')}
              >
                {mapClickMode === 'destination' ? 'Click on map or ' : ''}Select destination...
              </button>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* Origin picker modal */}
      <LocationPickerModal
        isOpen={activeModal === 'origin'}
        onClose={() => setActiveModal(null)}
        onSelect={onOriginChange}
        skiArea={skiArea}
        title="Select Origin"
        showCurrentLocation={true}
        userLocation={userLocation}
        isUserLocationValid={isUserLocationValid}
        mountainHome={mountainHome}
        onRequestMapClick={() => onRequestMapClick?.('origin')}
      />

      {/* Destination picker modal */}
      <LocationPickerModal
        isOpen={activeModal === 'destination'}
        onClose={() => setActiveModal(null)}
        onSelect={onDestinationChange}
        skiArea={skiArea}
        title="Select Destination"
        showCurrentLocation={true}
        userLocation={userLocation}
        isUserLocationValid={isUserLocationValid}
        mountainHome={mountainHome}
        onRequestMapClick={() => onRequestMapClick?.('destination')}
      />
    </>
  );
}


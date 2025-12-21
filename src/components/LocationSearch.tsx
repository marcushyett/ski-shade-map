'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { SearchOutlined, EnvironmentOutlined, AimOutlined } from '@ant-design/icons';
import { trackEvent } from '@/lib/posthog';
import LoadingSpinner from './LoadingSpinner';
import { useLocationSearch, LocationSearchResult } from '@/hooks/useLocationSearch';

export interface LocationSelection {
  skiAreaId: string;
  skiAreaName: string;
  locality?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  zoomToLocality?: boolean;
}

interface LocationSearchProps {
  onSelect: (location: LocationSelection) => void;
  onUseCurrentLocation?: () => void;
  isGettingLocation?: boolean;
  currentLocation?: {
    country?: string;
    region?: string;
    locality?: string;
  };
  disabled?: boolean;
  placeholder?: string;
}

export default function LocationSearch({
  onSelect,
  onUseCurrentLocation,
  isGettingLocation = false,
  currentLocation,
  disabled,
  placeholder = 'Search ski areas, regions, villages...',
}: LocationSearchProps) {
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingResultRef = useRef<LocationSearchResult | null>(null);

  // Client-side search - instant results, no network calls
  const { search, isLoading: isLoadingIndex, isReady } = useLocationSearch();

  // Compute results synchronously - no network calls, instant (<1ms)
  const results = useMemo(() => {
    if (!isReady || !isSearching || query.length < 2) {
      return [];
    }
    return search(query, 15);
  }, [query, isReady, isSearching, search]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsSearching(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setSelectedIndex(0);
  };

  const handleSelect = (result: LocationSearchResult) => {
    trackEvent('location_selected', {
      type: result.type,
      name: result.name,
      country: result.country,
      skiAreaId: result.skiAreaId,
    });

    const selection: LocationSelection = {
      skiAreaId: result.skiAreaId,
      skiAreaName: result.type === 'locality' ? result.region! : result.name,
      country: result.country,
      latitude: result.latitude,
      longitude: result.longitude,
    };

    if (result.type === 'locality') {
      selection.locality = result.name;
      selection.zoomToLocality = true;
    }

    onSelect(selection);
    setIsSearching(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isSearching) return;

    // Calculate total items including current location button if present
    const hasCurrentLocationOption = !!onUseCurrentLocation;
    const totalItems = results.length + (hasCurrentLocationOption ? 1 : 0);

    if (totalItems === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, totalItems - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // If current location button is selected (index 0 when hasCurrentLocationOption)
      if (hasCurrentLocationOption && selectedIndex === 0) {
        trackEvent('use_current_location_clicked', { source: 'keyboard' });
        onUseCurrentLocation();
        setIsSearching(false);
        setQuery('');
      } else {
        // Adjust index for results array
        const resultIndex = hasCurrentLocationOption ? selectedIndex - 1 : selectedIndex;
        if (resultIndex >= 0 && resultIndex < results.length) {
          handleSelect(results[resultIndex]);
        }
      }
    } else if (e.key === 'Escape') {
      setIsSearching(false);
      setQuery('');
    }
  };

  const getTypeLabel = (type: LocationSearchResult['type']) => {
    switch (type) {
      case 'region':
        return 'Ski Area';
      case 'locality':
        return 'Village';
    }
  };

  const startSearching = () => {
    setIsSearching(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Show current location as a clickable box when not searching
  if (!isSearching && currentLocation?.region) {
    return (
      <div className="location-search" ref={containerRef}>
        <button
          className="location-selected-box"
          onClick={startSearching}
          disabled={disabled}
        >
          <EnvironmentOutlined className="location-selected-icon" />
          <div className="location-selected-content">
            <div className="location-selected-name">{currentLocation.region}</div>
            <div className="location-selected-meta">
              {currentLocation.country}
              {currentLocation.locality && ` · ${currentLocation.locality}`}
            </div>
          </div>
          <SearchOutlined className="location-selected-search-icon" />
        </button>
      </div>
    );
  }

  return (
    <div className="location-search" ref={containerRef}>
      <div className="location-search-input-wrapper">
        <SearchOutlined className="location-search-icon" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setIsSearching(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isLoadingIndex}
          className="location-search-input"
          autoFocus={isSearching}
        />
        {isLoadingIndex && <div className="location-search-spinner"><LoadingSpinner size={18} /></div>}
      </div>

      {/* Dropdown results */}
      {isSearching && (
        <div className="location-search-dropdown">
          {/* Current Location option - show when dropdown opens and handler is available */}
          {onUseCurrentLocation && (
            <button
              className={`location-search-result current-location-btn ${query.length < 2 && selectedIndex === 0 ? 'selected' : ''}`}
              onClick={() => {
                trackEvent('use_current_location_clicked');
                onUseCurrentLocation();
                setIsSearching(false);
                setQuery('');
              }}
              onMouseEnter={() => query.length < 2 && setSelectedIndex(0)}
              disabled={isGettingLocation}
            >
              <AimOutlined className="location-result-icon" style={{ color: isGettingLocation ? '#666' : '#3b82f6' }} />
              <div className="location-result-content">
                <div className="location-result-name" style={{ color: isGettingLocation ? '#666' : undefined }}>
                  {isGettingLocation ? 'Getting location...' : 'Use Current Location'}
                </div>
                <div className="location-result-meta">
                  Navigate to your current position
                </div>
              </div>
              {isGettingLocation && (
                <div className="location-search-spinner" style={{ position: 'static', marginLeft: 'auto' }}>
                  <LoadingSpinner size={16} />
                </div>
              )}
            </button>
          )}

          {results.length === 0 && !isLoadingIndex && query.length >= 2 && (
            <div className="location-search-empty">
              No locations found for &ldquo;{query}&rdquo;
            </div>
          )}

          {results.map((result, index) => {
            // Offset index by 1 if current location button is shown
            const adjustedIndex = onUseCurrentLocation ? index + 1 : index;
            return (
              <button
                key={`${result.type}-${result.id}`}
                className={`location-search-result ${adjustedIndex === selectedIndex ? 'selected' : ''}`}
                onPointerDown={() => {
                  pendingResultRef.current = result;
                }}
                onClick={() => {
                  const resultToSelect = pendingResultRef.current || result;
                  pendingResultRef.current = null;
                  handleSelect(resultToSelect);
                }}
                onMouseEnter={() => setSelectedIndex(adjustedIndex)}
              >
                <EnvironmentOutlined className="location-result-icon" />
                <div className="location-result-content">
                  <div className="location-result-name">{result.name}</div>
                  <div className="location-result-meta">
                    {result.type === 'locality' && result.region && (
                      <>
                        {result.region}
                        {result.country && ` · ${result.country}`}
                      </>
                    )}
                    {result.type === 'region' && result.country && (
                      <>{result.country}</>
                    )}
                    {result.runCount && (
                      <> · {result.runCount} runs</>
                    )}
                  </div>
                </div>
                <div className="location-result-type">
                  {getTypeLabel(result.type)}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

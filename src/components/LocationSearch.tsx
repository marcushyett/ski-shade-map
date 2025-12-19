'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { SearchOutlined, EnvironmentOutlined } from '@ant-design/icons';
import debounce from 'lodash.debounce';
import { trackEvent } from '@/lib/posthog';
import LoadingSpinner from './LoadingSpinner';
import type { LocationSearchResult } from '@/app/api/locations/search/route';

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
  currentLocation,
  disabled,
  placeholder = 'Search ski areas, regions, villages...',
}: LocationSearchProps) {
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isHoveringResults, setIsHoveringResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingResultRef = useRef<LocationSearchResult | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsSearching(false);
        setQuery('');
        setResults([]);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchLocations = useMemo(
    () => debounce(async (searchQuery: string, shouldUpdateResults: () => boolean) => {
      if (searchQuery.length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/locations/search?q=${encodeURIComponent(searchQuery)}&limit=15`);
        const data = await res.json();
        // Only update results if user isn't hovering (prevents clicks on wrong items)
        if (shouldUpdateResults()) {
          setResults(data.results || []);
        }
      } catch (error) {
        console.error('Search failed:', error);
        if (shouldUpdateResults()) {
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    }, 300), // Increased for better stability and fewer false clicks
    []
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    setSelectedIndex(0);
    setLoading(true);
    // Pass function that checks if we should update results (not hovering)
    searchLocations(value, () => !isHoveringResults);
  };

  const handleSelect = (result: LocationSearchResult) => {
    trackEvent('location_selected', {
      type: result.type,
      name: result.name,
      country: result.country,
      skiAreaId: result.skiAreaId,
    });

    if (result.type === 'country') {
      // For country, just filter results - show ski areas from that country
      setQuery(result.name);
      searchLocations(result.name, () => true);
      return;
    }

    const selection: LocationSelection = {
      skiAreaId: result.skiAreaId!,
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
    setResults([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isSearching || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      setIsSearching(false);
      setQuery('');
      setResults([]);
    }
  };

  const getTypeLabel = (type: LocationSearchResult['type']) => {
    switch (type) {
      case 'country':
        return 'Country';
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
          disabled={disabled}
          className="location-search-input"
          autoFocus={isSearching}
        />
        {loading && <div className="location-search-spinner"><LoadingSpinner size={18} /></div>}
      </div>

      {/* Dropdown results */}
      {isSearching && (query.length >= 2 || results.length > 0) && (
        <div 
          className="location-search-dropdown"
          onMouseEnter={() => setIsHoveringResults(true)}
          onMouseLeave={() => setIsHoveringResults(false)}
        >
          {results.length === 0 && !loading && query.length >= 2 && (
            <div className="location-search-empty">
              No locations found for "{query}"
            </div>
          )}

          {results.map((result, index) => (
            <button
              key={`${result.type}-${result.id}`}
              className={`location-search-result ${index === selectedIndex ? 'selected' : ''}`}
              onPointerDown={() => {
                // Capture result at pointer down to prevent race condition
                pendingResultRef.current = result;
              }}
              onClick={() => {
                // Use captured result from pointer down, or current if not captured
                const resultToSelect = pendingResultRef.current || result;
                pendingResultRef.current = null;
                handleSelect(resultToSelect);
              }}
              onMouseEnter={() => setSelectedIndex(index)}
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
                  {result.type === 'country' && result.runCount && (
                    <>{result.runCount} ski areas</>
                  )}
                  {result.type !== 'country' && result.runCount && (
                    <> · {result.runCount} runs</>
                  )}
                </div>
              </div>
              <div className="location-result-type">
                {getTypeLabel(result.type)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { SearchOutlined, EnvironmentOutlined, GlobalOutlined, CompassOutlined } from '@ant-design/icons';
import { Spin } from 'antd';
import debounce from 'lodash.debounce';
import { trackEvent } from '@/lib/posthog';
import type { LocationSearchResult } from '@/app/api/locations/search/route';

export interface LocationSelection {
  skiAreaId: string;
  skiAreaName: string;
  subRegionId?: string;
  subRegionName?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  zoomToSubRegion?: boolean;
}

interface LocationSearchProps {
  onSelect: (location: LocationSelection) => void;
  currentLocation?: {
    country?: string;
    region?: string;
    subRegion?: string;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const searchLocations = useCallback(
    debounce(async (searchQuery: string) => {
      if (searchQuery.length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/locations/search?q=${encodeURIComponent(searchQuery)}&limit=15`);
        const data = await res.json();
        setResults(data.results || []);
      } catch (error) {
        console.error('Search failed:', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250),
    []
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    setSelectedIndex(0);
    setLoading(true);
    searchLocations(value);
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
      searchLocations(result.name);
      return;
    }

    const selection: LocationSelection = {
      skiAreaId: result.skiAreaId!,
      skiAreaName: result.type === 'subregion' ? result.region! : result.name,
      country: result.country,
      latitude: result.latitude,
      longitude: result.longitude,
    };

    if (result.type === 'subregion') {
      selection.subRegionId = result.id;
      selection.subRegionName = result.name;
      selection.zoomToSubRegion = true;
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
      case 'subregion':
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
              {currentLocation.subRegion && ` · ${currentLocation.subRegion}`}
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
        {loading && <Spin size="small" className="location-search-spinner" />}
      </div>

      {/* Dropdown results */}
      {isSearching && (query.length >= 2 || results.length > 0) && (
        <div className="location-search-dropdown">
          {results.length === 0 && !loading && query.length >= 2 && (
            <div className="location-search-empty">
              No locations found for "{query}"
            </div>
          )}

          {results.map((result, index) => (
            <button
              key={`${result.type}-${result.id}`}
              className={`location-search-result ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => handleSelect(result)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <EnvironmentOutlined className="location-result-icon" />
              <div className="location-result-content">
                <div className="location-result-name">{result.name}</div>
                <div className="location-result-meta">
                  {result.type === 'subregion' && result.region && (
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

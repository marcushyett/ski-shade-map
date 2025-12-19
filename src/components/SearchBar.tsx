'use client';

import { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import { Input, Spin } from 'antd';
import {
  SearchOutlined,
  NodeIndexOutlined,
  SwapOutlined,
  EnvironmentOutlined,
  CloseOutlined,
  HomeOutlined,
  ShopOutlined,
  CoffeeOutlined,
  BankOutlined,
  CarOutlined,
} from '@ant-design/icons';
import { trackEvent } from '@/lib/posthog';
import type { RunData, LiftData } from '@/lib/types';
import { getDifficultyColor } from '@/lib/shade-calculator';
import debounce from 'lodash.debounce';

type PlaceType = 'hotel' | 'restaurant' | 'shop' | 'building' | 'road' | 'other';

interface SearchResult {
  type: 'run' | 'lift' | 'place';
  id: string;
  name: string;
  difficulty?: string | null;
  liftType?: string | null;
  coordinates?: [number, number];
  placeType?: PlaceType;
  locality?: string | null;
}

interface SearchBarProps {
  runs: RunData[];
  lifts: LiftData[];
  skiAreaLatitude?: number;
  skiAreaLongitude?: number;
  onSelectRun?: (run: RunData) => void;
  onSelectLift?: (lift: LiftData) => void;
  onSelectPlace?: (coordinates: [number, number], name: string, placeType?: PlaceType) => void;
  placeholder?: string;
}

// Geocoding via Nominatim (OpenStreetMap)
interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  class: string;
}

// Map Nominatim class/type to our place types
function getPlaceType(osmClass: string, osmType: string): PlaceType {
  // Hotels and accommodation
  if (osmClass === 'tourism' && ['hotel', 'hostel', 'motel', 'guest_house', 'chalet', 'apartment'].includes(osmType)) {
    return 'hotel';
  }
  // Restaurants, cafes, food
  if (osmClass === 'amenity' && ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court'].includes(osmType)) {
    return 'restaurant';
  }
  // Shops
  if (osmClass === 'shop' || (osmClass === 'amenity' && osmType === 'marketplace')) {
    return 'shop';
  }
  // Roads
  if (osmClass === 'highway' || osmType === 'road' || osmType === 'street') {
    return 'road';
  }
  // Buildings
  if (osmClass === 'building' || osmClass === 'place' || osmClass === 'amenity') {
    return 'building';
  }
  return 'other';
}

// Get icon for place type
function getPlaceIcon(placeType: PlaceType) {
  switch (placeType) {
    case 'hotel':
      return <HomeOutlined style={{ fontSize: 10, color: '#faad14', marginRight: 6 }} />;
    case 'restaurant':
      return <CoffeeOutlined style={{ fontSize: 10, color: '#ef4444', marginRight: 6 }} />;
    case 'shop':
      return <ShopOutlined style={{ fontSize: 10, color: '#8b5cf6', marginRight: 6 }} />;
    case 'road':
      return <CarOutlined style={{ fontSize: 10, color: '#6b7280', marginRight: 6 }} />;
    case 'building':
      return <BankOutlined style={{ fontSize: 10, color: '#3b82f6', marginRight: 6 }} />;
    default:
      return <EnvironmentOutlined style={{ fontSize: 10, color: '#888', marginRight: 6 }} />;
  }
}

async function searchPlaces(
  query: string,
  latitude?: number,
  longitude?: number
): Promise<SearchResult[]> {
  if (!query || query.length < 3) return [];
  
  try {
    const viewbox = latitude && longitude
      ? `&viewbox=${longitude - 0.5},${latitude + 0.5},${longitude + 0.5},${latitude - 0.5}&bounded=1`
      : '';
    
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}${viewbox}&limit=8&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'SkiShadeMap/1.0',
        },
      }
    );
    
    if (!res.ok) return [];
    
    const data: NominatimResult[] = await res.json();
    return data.map((item) => ({
      type: 'place' as const,
      id: `place-${item.place_id}`,
      name: item.display_name.split(',').slice(0, 2).join(', '),
      coordinates: [parseFloat(item.lon), parseFloat(item.lat)] as [number, number],
      placeType: getPlaceType(item.class, item.type),
    }));
  } catch {
    return [];
  }
}

function SearchBarInner({
  runs,
  lifts,
  skiAreaLatitude,
  skiAreaLongitude,
  onSelectRun,
  onSelectLift,
  onSelectPlace,
  placeholder = 'Search trails, lifts, places...',
}: SearchBarProps) {
  const [searchText, setSearchText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isSearchingPlaces, setIsSearchingPlaces] = useState(false);
  const [placeResults, setPlaceResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced place search
  const debouncedPlaceSearch = useMemo(
    () =>
      debounce(async (query: string) => {
        if (query.length >= 3) {
          setIsSearchingPlaces(true);
          const results = await searchPlaces(query, skiAreaLatitude, skiAreaLongitude);
          setPlaceResults(results);
          setIsSearchingPlaces(false);
        } else {
          setPlaceResults([]);
        }
      }, 300),
    [skiAreaLatitude, skiAreaLongitude]
  );

  // Search effect
  useEffect(() => {
    debouncedPlaceSearch(searchText);
    return () => debouncedPlaceSearch.cancel();
  }, [searchText, debouncedPlaceSearch]);

  // Filter runs and lifts by search
  // Deduplicate runs by name+locality, keeping highest altitude
  // Filter out unnamed runs
  const filteredRuns = useMemo(() => {
    if (!searchText) return [];
    const lower = searchText.toLowerCase();
    const matchingRuns = runs.filter((r) => r.name && r.name.toLowerCase().includes(lower));

    // Group by name + locality, keep highest altitude
    const grouped = new Map<string, typeof matchingRuns[0]>();
    for (const run of matchingRuns) {
      const key = `${run.name}::${run.locality || ''}`;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, run);
      } else {
        // Get elevation from geometry if available
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
    
    return Array.from(grouped.values()).slice(0, 8);
  }, [runs, searchText]);

  const filteredLifts = useMemo(() => {
    if (!searchText) return [];
    const lower = searchText.toLowerCase();
    return lifts
      .filter((l) => l.name?.toLowerCase().includes(lower))
      .slice(0, 5);
  }, [lifts, searchText]);

  // Combined results for keyboard navigation
  const allResults = useMemo(() => {
    const results: SearchResult[] = [];
    
    filteredRuns.forEach((run) => {
      results.push({
        type: 'run',
        id: run.id,
        name: run.name || 'Unnamed Run',
        difficulty: run.difficulty,
        locality: run.locality,
      });
    });
    
    filteredLifts.forEach((lift) => {
      results.push({
        type: 'lift',
        id: lift.id,
        name: lift.name || 'Unnamed Lift',
        liftType: lift.liftType,
      });
    });
    
    placeResults.forEach((place) => {
      results.push(place);
    });
    
    return results;
  }, [filteredRuns, filteredLifts, placeResults]);

  // Track search when results change
  const allResultsLength = allResults.length;
  useEffect(() => {
    if (searchText.length >= 2) {
      trackSearchRef.current(searchText, allResultsLength);
    }
  }, [allResultsLength, searchText]);

  // Track search (debounced)
  const trackSearchRef = useRef(
    debounce((query: string, resultCount: number) => {
      if (query.length >= 2) {
        trackEvent('search_performed', {
          search_query: query,
          result_count: resultCount,
        });
      }
    }, 500)
  );

  // Reset selected index when search text changes 
  const handleSearchChange = useCallback((value: string) => {
    setSearchText(value);
    setSelectedIndex(-1);
  }, []);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      // Track the selection
      if (result.type === 'run') {
        trackEvent('search_result_selected', {
          result_type: 'run',
          run_id: result.id,
          run_name: result.name,
          run_difficulty: result.difficulty || undefined,
          search_query: searchText,
        });
        const run = runs.find((r) => r.id === result.id);
        if (run) onSelectRun?.(run);
      } else if (result.type === 'lift') {
        trackEvent('search_result_selected', {
          result_type: 'lift',
          lift_id: result.id,
          lift_name: result.name,
          search_query: searchText,
        });
        const lift = lifts.find((l) => l.id === result.id);
        if (lift) onSelectLift?.(lift);
      } else if (result.type === 'place' && result.coordinates) {
        trackEvent('place_search_result_selected', {
          result_type: 'place',
          place_name: result.name,
          place_type: result.placeType || undefined,
          latitude: result.coordinates[1],
          longitude: result.coordinates[0],
          search_query: searchText,
        });
        onSelectPlace?.(result.coordinates, result.name, result.placeType);
      }
      
      setSearchText('');
      setIsFocused(false);
      // Blur the active element
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    },
    [runs, lifts, onSelectRun, onSelectLift, onSelectPlace, searchText]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, allResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, -1));
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        handleSelect(allResults[selectedIndex]);
      } else if (e.key === 'Escape') {
        setSearchText('');
        setIsFocused(false);
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }
    },
    [allResults, selectedIndex, handleSelect]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsFocused(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const showDropdown = isFocused && searchText.length > 0 && (allResults.length > 0 || isSearchingPlaces);

  return (
    <div ref={containerRef} className="search-bar-container relative">
      <Input
        placeholder={placeholder}
        prefix={<SearchOutlined style={{ fontSize: 12, opacity: 0.5 }} />}
        suffix={
          searchText ? (
            <CloseOutlined
              style={{ fontSize: 10, opacity: 0.5, cursor: 'pointer' }}
              onClick={() => handleSearchChange('')}
            />
          ) : null
        }
        value={searchText}
        onChange={(e) => handleSearchChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onKeyDown={handleKeyDown}
        size="small"
        style={{ width: '100%' }}
      />
      
      {showDropdown && (
        <div className="search-dropdown">
          {/* Runs category */}
          {filteredRuns.length > 0 && (
            <div className="search-category">
              <div className="search-category-header">
                <NodeIndexOutlined style={{ fontSize: 10, marginRight: 4 }} />
                Runs
              </div>
              {filteredRuns.map((run, idx) => {
                const resultIndex = idx;
                const isSelected = selectedIndex === resultIndex;
                return (
                  <div
                    key={run.id}
                    className={`search-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelect({ type: 'run', id: run.id, name: run.name || '', difficulty: run.difficulty, locality: run.locality })}
                  >
                    <span
                      className="search-item-dot"
                      style={{ backgroundColor: getDifficultyColor(run.difficulty) }}
                    />
                    <span className="search-item-name">{run.name || 'Unnamed'}</span>
                    {run.locality && (
                      <span className="search-item-subregion">
                        {run.locality}
                      </span>
                    )}
                    {run.difficulty && (
                      <span className="search-item-meta" style={{ color: getDifficultyColor(run.difficulty) }}>
                        {run.difficulty}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Lifts category */}
          {filteredLifts.length > 0 && (
            <div className="search-category">
              <div className="search-category-header">
                <SwapOutlined style={{ fontSize: 10, marginRight: 4 }} />
                Lifts
              </div>
              {filteredLifts.map((lift, idx) => {
                const resultIndex = filteredRuns.length + idx;
                const isSelected = selectedIndex === resultIndex;
                return (
                  <div
                    key={lift.id}
                    className={`search-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelect({ type: 'lift', id: lift.id, name: lift.name || '', liftType: lift.liftType })}
                  >
                    <SwapOutlined style={{ fontSize: 10, color: '#52c41a', marginRight: 6 }} />
                    <span className="search-item-name">{lift.name || 'Unnamed'}</span>
                    {lift.liftType && (
                      <span className="search-item-meta">{lift.liftType}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Places category */}
          {(placeResults.length > 0 || isSearchingPlaces) && (
            <div className="search-category">
              <div className="search-category-header">
                <EnvironmentOutlined style={{ fontSize: 10, marginRight: 4 }} />
                Places
                {isSearchingPlaces && <Spin size="small" style={{ marginLeft: 8 }} />}
              </div>
              {placeResults.map((place, idx) => {
                const resultIndex = filteredRuns.length + filteredLifts.length + idx;
                const isSelected = selectedIndex === resultIndex;
                return (
                  <div
                    key={place.id}
                    className={`search-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelect(place)}
                  >
                    {getPlaceIcon(place.placeType || 'other')}
                    <span className="search-item-name">{place.name}</span>
                    <span className="search-item-meta">
                      {place.placeType === 'hotel' && 'Hotel'}
                      {place.placeType === 'restaurant' && 'Food'}
                      {place.placeType === 'shop' && 'Shop'}
                      {place.placeType === 'road' && 'Road'}
                      {place.placeType === 'building' && 'Building'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* No results */}
          {allResults.length === 0 && !isSearchingPlaces && searchText.length >= 3 && (
            <div className="search-no-results">
              No results found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SearchBar = memo(SearchBarInner);
export default SearchBar;

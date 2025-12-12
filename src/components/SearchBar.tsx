'use client';

import { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import { Input, Spin } from 'antd';
import {
  SearchOutlined,
  NodeIndexOutlined,
  SwapOutlined,
  EnvironmentOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import type { RunData, LiftData } from '@/lib/types';
import { getDifficultyColor } from '@/lib/shade-calculator';
import debounce from 'lodash.debounce';

interface SearchResult {
  type: 'run' | 'lift' | 'place';
  id: string;
  name: string;
  difficulty?: string | null;
  liftType?: string | null;
  coordinates?: [number, number];
}

interface SearchBarProps {
  runs: RunData[];
  lifts: LiftData[];
  skiAreaLatitude?: number;
  skiAreaLongitude?: number;
  onSelectRun?: (run: RunData) => void;
  onSelectLift?: (lift: LiftData) => void;
  onSelectPlace?: (coordinates: [number, number], name: string) => void;
  placeholder?: string;
}

// Geocoding via Nominatim (OpenStreetMap)
interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
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
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}${viewbox}&limit=5`,
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
  const filteredRuns = useMemo(() => {
    if (!searchText) return [];
    const lower = searchText.toLowerCase();
    return runs
      .filter((r) => r.name?.toLowerCase().includes(lower))
      .slice(0, 8);
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

  // Reset selected index when results change
  const allResultsLength = allResults.length;
  useEffect(() => {
    // Reset index when search results change (works as a side effect of search text changing)
  }, [allResultsLength]);

  // Reset selected index when search text changes 
  const handleSearchChange = useCallback((value: string) => {
    setSearchText(value);
    setSelectedIndex(-1);
  }, []);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      if (result.type === 'run') {
        const run = runs.find((r) => r.id === result.id);
        if (run) onSelectRun?.(run);
      } else if (result.type === 'lift') {
        const lift = lifts.find((l) => l.id === result.id);
        if (lift) onSelectLift?.(lift);
      } else if (result.type === 'place' && result.coordinates) {
        onSelectPlace?.(result.coordinates, result.name);
      }
      
      setSearchText('');
      setIsFocused(false);
      // Blur the active element
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    },
    [runs, lifts, onSelectRun, onSelectLift, onSelectPlace]
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
                    onClick={() => handleSelect({ type: 'run', id: run.id, name: run.name || '', difficulty: run.difficulty })}
                  >
                    <span
                      className="search-item-dot"
                      style={{ backgroundColor: getDifficultyColor(run.difficulty) }}
                    />
                    <span className="search-item-name">{run.name || 'Unnamed'}</span>
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
                    <EnvironmentOutlined style={{ fontSize: 10, color: '#888', marginRight: 6 }} />
                    <span className="search-item-name">{place.name}</span>
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

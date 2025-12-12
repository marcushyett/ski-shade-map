'use client';

import { useState, useCallback, useMemo } from 'react';
import type { RunData } from '@/lib/types';

const FAVOURITES_STORAGE_KEY = 'ski-shade-favourites';

export interface FavouriteRun {
  id: string;
  name: string | null;
  difficulty: string | null;
  skiAreaId: string;
  skiAreaName: string;
}

interface FavouritesState {
  [skiAreaId: string]: FavouriteRun[];
}

// Load from localStorage (client-side only)
function loadFavouritesFromStorage(): FavouritesState {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(FAVOURITES_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore localStorage errors
  }
  return {};
}

export function useFavourites(skiAreaId: string | null, skiAreaName: string | null) {
  const [allFavourites, setAllFavourites] = useState<FavouritesState>(() => loadFavouritesFromStorage());

  // Get favourites for current ski area
  const favourites = useMemo(() => {
    if (!skiAreaId) return [];
    return allFavourites[skiAreaId] || [];
  }, [allFavourites, skiAreaId]);

  // Save favourites to localStorage
  const saveFavourites = useCallback((newFavourites: FavouritesState) => {
    try {
      localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(newFavourites));
      setAllFavourites(newFavourites);
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Check if a run is a favourite
  const isFavourite = useCallback((runId: string): boolean => {
    return favourites.some(f => f.id === runId);
  }, [favourites]);

  // Toggle favourite status
  const toggleFavourite = useCallback((run: RunData) => {
    if (!skiAreaId || !skiAreaName) return;

    const isCurrentlyFavourite = isFavourite(run.id);
    
    let newAreaFavourites: FavouriteRun[];
    
    if (isCurrentlyFavourite) {
      newAreaFavourites = favourites.filter(f => f.id !== run.id);
    } else {
      const newFavourite: FavouriteRun = {
        id: run.id,
        name: run.name,
        difficulty: run.difficulty,
        skiAreaId,
        skiAreaName,
      };
      newAreaFavourites = [...favourites, newFavourite];
    }
    
    const newAllFavourites = {
      ...allFavourites,
      [skiAreaId]: newAreaFavourites,
    };
    
    // Clean up empty arrays
    if (newAreaFavourites.length === 0) {
      delete newAllFavourites[skiAreaId];
    }
    
    saveFavourites(newAllFavourites);
  }, [skiAreaId, skiAreaName, favourites, allFavourites, isFavourite, saveFavourites]);

  // Add a run to favourites
  const addFavourite = useCallback((run: RunData) => {
    if (!skiAreaId || !skiAreaName || isFavourite(run.id)) return;
    
    const newFavourite: FavouriteRun = {
      id: run.id,
      name: run.name,
      difficulty: run.difficulty,
      skiAreaId,
      skiAreaName,
    };
    
    const newAreaFavourites = [...favourites, newFavourite];
    
    const newAllFavourites = {
      ...allFavourites,
      [skiAreaId]: newAreaFavourites,
    };
    
    saveFavourites(newAllFavourites);
  }, [skiAreaId, skiAreaName, favourites, allFavourites, isFavourite, saveFavourites]);

  // Remove a run from favourites
  const removeFavourite = useCallback((runId: string) => {
    if (!skiAreaId) return;
    
    const newAreaFavourites = favourites.filter(f => f.id !== runId);
    
    const newAllFavourites = {
      ...allFavourites,
      [skiAreaId]: newAreaFavourites,
    };
    
    if (newAreaFavourites.length === 0) {
      delete newAllFavourites[skiAreaId];
    }
    
    saveFavourites(newAllFavourites);
  }, [skiAreaId, favourites, allFavourites, saveFavourites]);

  // Get favourite run IDs for map highlighting
  const favouriteIds = favourites.map(f => f.id);

  return {
    favourites,
    favouriteIds,
    isFavourite,
    toggleFavourite,
    addFavourite,
    removeFavourite,
  };
}

'use client';

import { useState, useCallback, useEffect } from 'react';
import { trackEvent } from '@/lib/posthog';
import {
  type PlanningModeState,
  type PlanningModeFilters,
  type ShadowSettings,
  DEFAULT_PLANNING_MODE_STATE,
} from '@/lib/planning-mode-types';

const PLANNING_MODE_STORAGE_KEY = 'ski-shade-planning-mode';

/**
 * Load planning mode settings from localStorage
 */
function loadFromStorage(): Partial<PlanningModeState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(PLANNING_MODE_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore localStorage errors
  }
  return null;
}

/**
 * Save planning mode settings to localStorage
 */
function saveToStorage(state: PlanningModeState): void {
  if (typeof window === 'undefined') return;
  try {
    // Only persist filter and shadow settings, not enabled state
    const toSave = {
      filters: state.filters,
      shadowSettings: state.shadowSettings,
    };
    localStorage.setItem(PLANNING_MODE_STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Hook to manage Planning Mode state.
 *
 * Planning Mode is a desktop-only feature for planning ski runs
 * the night before. It shows all runs as open, assumes sunny conditions,
 * and provides filtering and shadow visualization.
 *
 * @returns Planning mode state and control functions
 */
export function usePlanningMode() {
  const [planningMode, setPlanningModeState] = useState<PlanningModeState>(() => {
    // Start with default state
    const defaultState = { ...DEFAULT_PLANNING_MODE_STATE };

    // Load persisted settings from storage (filters and shadow settings only)
    const stored = loadFromStorage();
    if (stored) {
      if (stored.filters) {
        defaultState.filters = { ...defaultState.filters, ...stored.filters };
      }
      if (stored.shadowSettings) {
        defaultState.shadowSettings = { ...defaultState.shadowSettings, ...stored.shadowSettings };
      }
    }

    return defaultState;
  });

  // Save to storage when filters or shadow settings change
  useEffect(() => {
    saveToStorage(planningMode);
  }, [planningMode.filters, planningMode.shadowSettings]);

  /**
   * Toggle planning mode on/off
   */
  const togglePlanningMode = useCallback(() => {
    setPlanningModeState((prev) => {
      const newEnabled = !prev.enabled;

      // Track the toggle event
      trackEvent(newEnabled ? 'planning_mode_enabled' : 'planning_mode_disabled', {});

      return {
        ...prev,
        enabled: newEnabled,
        // Reset shadow loading state when disabling
        shadowsLoading: newEnabled ? prev.shadowsLoading : false,
      };
    });
  }, []);

  /**
   * Enable planning mode
   */
  const enablePlanningMode = useCallback(() => {
    setPlanningModeState((prev) => {
      if (prev.enabled) return prev;

      trackEvent('planning_mode_enabled', {});

      return {
        ...prev,
        enabled: true,
      };
    });
  }, []);

  /**
   * Disable planning mode
   */
  const disablePlanningMode = useCallback(() => {
    setPlanningModeState((prev) => {
      if (!prev.enabled) return prev;

      trackEvent('planning_mode_disabled', {});

      return {
        ...prev,
        enabled: false,
        shadowsLoading: false,
      };
    });
  }, []);

  /**
   * Update filter settings
   */
  const setFilters = useCallback((filters: Partial<PlanningModeFilters>) => {
    setPlanningModeState((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        ...filters,
      },
    }));
  }, []);

  /**
   * Update shadow settings
   */
  const setShadowSettings = useCallback((settings: Partial<ShadowSettings>) => {
    setPlanningModeState((prev) => ({
      ...prev,
      shadowSettings: {
        ...prev.shadowSettings,
        ...settings,
      },
    }));
  }, []);

  /**
   * Set shadows loading state
   */
  const setShadowsLoading = useCallback((loading: boolean) => {
    setPlanningModeState((prev) => ({
      ...prev,
      shadowsLoading: loading,
    }));
  }, []);

  /**
   * Reset filters to default
   */
  const resetFilters = useCallback(() => {
    setPlanningModeState((prev) => ({
      ...prev,
      filters: { ...DEFAULT_PLANNING_MODE_STATE.filters },
    }));
  }, []);

  /**
   * Full state setter for complex updates
   */
  const setPlanningMode = useCallback((updater: PlanningModeState | ((prev: PlanningModeState) => PlanningModeState)) => {
    setPlanningModeState(updater);
  }, []);

  return {
    planningMode,
    setPlanningMode,
    togglePlanningMode,
    enablePlanningMode,
    disablePlanningMode,
    setFilters,
    setShadowSettings,
    setShadowsLoading,
    resetFilters,
  };
}

export default usePlanningMode;

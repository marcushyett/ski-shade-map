/**
 * Max Optimality Module
 *
 * Provides route planning that maximizes run coverage while optimizing for sun exposure.
 * This module is designed to be lazy-loaded to avoid impacting app startup time.
 */

export * from './types';
export * from './analytics-query';
export { planMaxOptimalityRoute, type ProgressCallback } from './route-planner';

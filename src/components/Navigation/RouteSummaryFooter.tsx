'use client';

import { useState } from 'react';
import {
  CompassOutlined,
  CloseOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  SunOutlined,
  CloudOutlined,
  UpOutlined,
  DownOutlined,
} from '@ant-design/icons';
import { formatDuration, formatDistance, type NavigationRoute } from '@/lib/navigation';
import type { RouteSunAnalysis } from '@/lib/route-sun-calculator';

interface RouteSummaryFooterProps {
  route: NavigationRoute;
  sunAnalysis?: RouteSunAnalysis | null;
  isActivelyNavigating: boolean;
  onStartNavigation: () => void;
  onStopNavigation: () => void;
  onClear: () => void;
  hasOriginOrDestination: boolean;
}

export function RouteSummaryFooter({
  route,
  sunAnalysis,
  isActivelyNavigating,
  onStartNavigation,
  onStopNavigation,
  onClear,
  hasOriginOrDestination,
}: RouteSummaryFooterProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const showSun = sunAnalysis && sunAnalysis.isReliable && !sunAnalysis.isBadWeather;

  return (
    <div className={`route-summary-footer ${isExpanded ? 'expanded' : ''}`}>
      {/* Expand/collapse toggle */}
      <button className="footer-toggle" onClick={() => setIsExpanded(!isExpanded)}>
        {isExpanded ? <DownOutlined style={{ fontSize: 10 }} /> : <UpOutlined style={{ fontSize: 10 }} />}
      </button>

      {/* Collapsed view - key stats */}
      <div className="footer-stats">
        <span className="footer-stat">
          <strong>{formatDuration(route.totalTime)}</strong>
        </span>
        <span className="footer-divider">·</span>
        <span className="footer-stat">
          <strong>{formatDistance(route.totalDistance)}</strong>
        </span>
        {showSun && (
          <>
            <span className="footer-divider">·</span>
            <span className="footer-stat sun">
              <SunOutlined style={{ fontSize: 10 }} />
              <strong>{Math.round(sunAnalysis.sunPercentage)}%</strong>
            </span>
          </>
        )}
      </div>

      {/* Expanded view - more details */}
      {isExpanded && (
        <div className="footer-details">
          <div className="footer-detail-row">
            <span className="footer-detail">
              <ArrowUpOutlined style={{ fontSize: 10 }} />
              <span>{Math.round(route.totalElevationGain)}m up</span>
            </span>
            <span className="footer-detail">
              <ArrowDownOutlined style={{ fontSize: 10 }} />
              <span>{Math.round(route.totalElevationLoss)}m down</span>
            </span>
          </div>

          {/* Sun distribution chart */}
          {showSun && sunAnalysis.sunDistribution.length > 1 && (
            <div className="footer-sun-chart">
              <div className="sun-chart-header">
                <SunOutlined style={{ fontSize: 10, color: '#f59e0b' }} />
                <span>Sun exposure during route</span>
              </div>
              <div className="sun-chart-bars">
                {sunAnalysis.sunDistribution.map((segment, idx) => (
                  <div
                    key={idx}
                    className="sun-bar"
                    style={{
                      height: `${Math.max(4, segment.sunPercentage * 0.3)}px`,
                      backgroundColor:
                        segment.sunPercentage >= 50
                          ? `rgba(245, 158, 11, ${0.3 + segment.sunPercentage * 0.007})`
                          : `rgba(100, 100, 100, ${0.2 + segment.sunPercentage * 0.005})`,
                    }}
                    title={`${segment.timeOfDay}: ${Math.round(segment.sunPercentage)}% sun`}
                  />
                ))}
              </div>
              <div className="sun-chart-labels">
                <span>{sunAnalysis.sunDistribution[0].timeOfDay}</span>
                {sunAnalysis.sunDistribution.length > 2 && (
                  <span>
                    {sunAnalysis.sunDistribution[Math.floor(sunAnalysis.sunDistribution.length / 2)].timeOfDay}
                  </span>
                )}
                <span>{sunAnalysis.sunDistribution[sunAnalysis.sunDistribution.length - 1].timeOfDay}</span>
              </div>
            </div>
          )}

          {/* Bad weather notice */}
          {sunAnalysis?.isBadWeather && (
            <div className="footer-bad-weather">
              <CloudOutlined style={{ fontSize: 10 }} />
              <span>Poor visibility - sun routing disabled</span>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="footer-actions">
        {!isActivelyNavigating ? (
          <button className="footer-btn primary" onClick={onStartNavigation}>
            <CompassOutlined style={{ fontSize: 12 }} />
            Start
          </button>
        ) : (
          <button className="footer-btn danger" onClick={onStopNavigation}>
            <CloseOutlined style={{ fontSize: 10 }} />
            Stop
          </button>
        )}
        {hasOriginOrDestination && (
          <button className="footer-btn secondary" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}


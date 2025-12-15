'use client';

import { memo } from 'react';
import { GlobalOutlined, EnvironmentOutlined, CompassOutlined, SearchOutlined } from '@ant-design/icons';

interface LocationNavbarProps {
  country?: string;
  region?: string;
  subRegion?: string;
  onChangeLocation: () => void;
  onNavigateToRegion?: () => void;
  onNavigateToSubRegion?: () => void;
}

function LocationNavbar({
  country,
  region,
  subRegion,
  onChangeLocation,
  onNavigateToRegion,
  onNavigateToSubRegion,
}: LocationNavbarProps) {
  if (!region) {
    return (
      <div className="location-navbar">
        <button className="location-navbar-change" onClick={onChangeLocation}>
          <SearchOutlined style={{ marginRight: 4 }} />
          Select a ski area
        </button>
      </div>
    );
  }

  return (
    <div className="location-navbar">
      <div className="location-navbar-breadcrumb">
        {country && (
          <>
            <span className="location-navbar-item">
              <GlobalOutlined style={{ fontSize: 10, opacity: 0.6 }} />
              {country}
            </span>
            <span className="location-navbar-sep">›</span>
          </>
        )}
        
        <button
          className={`location-navbar-item ${!subRegion ? 'active' : ''}`}
          onClick={onNavigateToRegion}
          title="Zoom to entire ski area"
        >
          <EnvironmentOutlined style={{ fontSize: 10, opacity: 0.6 }} />
          {region}
        </button>

        {subRegion && (
          <>
            <span className="location-navbar-sep">›</span>
            <button
              className="location-navbar-item active"
              onClick={onNavigateToSubRegion}
              title="Zoom to this area"
            >
              <CompassOutlined style={{ fontSize: 10, opacity: 0.6 }} />
              {subRegion}
            </button>
          </>
        )}
      </div>

      <button className="location-navbar-change" onClick={onChangeLocation}>
        Change
      </button>
    </div>
  );
}

export default memo(LocationNavbar);


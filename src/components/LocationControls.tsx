'use client';

import { useState, useCallback, useEffect, memo } from 'react';
import { Tooltip, message, Modal, Input } from 'antd';
import {
  AimOutlined,
  HomeOutlined,
  ShareAltOutlined,
  CheckOutlined,
} from '@ant-design/icons';

export interface MountainHome {
  latitude: number;
  longitude: number;
  name: string;
}

export interface UserLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

interface LocationControlsProps {
  onUserLocationChange?: (location: UserLocation | null) => void;
  onMountainHomeChange?: (home: MountainHome | null) => void;
  onGoToLocation?: (lat: number, lng: number, zoom?: number) => void;
  mountainHome: MountainHome | null;
  userLocation: UserLocation | null;
  isTrackingLocation: boolean;
  onToggleTracking: (tracking: boolean) => void;
}

const MOUNTAIN_HOME_STORAGE_KEY = 'ski-shade-mountain-home';

function LocationControlsInner({
  onUserLocationChange,
  onMountainHomeChange,
  onGoToLocation,
  mountainHome,
  userLocation,
  isTrackingLocation,
  onToggleTracking,
}: LocationControlsProps) {
  const [showHomeModal, setShowHomeModal] = useState(false);
  const [homeName, setHomeName] = useState('');
  const [pendingHomeCoords, setPendingHomeCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  // Load mountain home from storage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(MOUNTAIN_HOME_STORAGE_KEY);
      if (stored) {
        const home = JSON.parse(stored) as MountainHome;
        onMountainHomeChange?.(home);
      }
    } catch {
      // Ignore storage errors
    }
  }, [onMountainHomeChange]);

  // Handle current location button click
  const handleCurrentLocation = useCallback(() => {
    if (isTrackingLocation && userLocation) {
      // If already tracking, just go to the location
      onGoToLocation?.(userLocation.latitude, userLocation.longitude, 16);
      return;
    }

    if (!navigator.geolocation) {
      message.error('Geolocation is not supported by your browser');
      return;
    }

    setIsGettingLocation(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location: UserLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        };
        onUserLocationChange?.(location);
        onGoToLocation?.(location.latitude, location.longitude, 16);
        onToggleTracking(true);
        setIsGettingLocation(false);
      },
      (error) => {
        setIsGettingLocation(false);
        switch (error.code) {
          case error.PERMISSION_DENIED:
            message.error('Location permission denied');
            break;
          case error.POSITION_UNAVAILABLE:
            message.error('Location information unavailable');
            break;
          case error.TIMEOUT:
            message.error('Location request timed out');
            break;
          default:
            message.error('Unable to get your location');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  }, [isTrackingLocation, userLocation, onUserLocationChange, onGoToLocation, onToggleTracking]);

  // Share current location
  const handleShareLocation = useCallback(async () => {
    if (!userLocation) {
      message.info('Enable location first to share');
      return;
    }

    const lat = userLocation.latitude.toFixed(6);
    const lng = userLocation.longitude.toFixed(6);
    const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    const shareText = `I'm at: ${lat}, ${lng}\n${mapsUrl}`;

    const shareData = {
      title: 'My Location',
      text: shareText,
      url: mapsUrl,
    };

    if (navigator.share && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
      }
    }

    // Fallback to clipboard
    try {
      await navigator.clipboard.writeText(shareText);
      message.success('Location copied to clipboard!');
    } catch {
      message.info(`Location: ${lat}, ${lng}`);
    }
  }, [userLocation]);

  // Set Mountain Home - use current location or prompt for location
  const handleSetMountainHome = useCallback(() => {
    if (userLocation) {
      setPendingHomeCoords({
        lat: userLocation.latitude,
        lng: userLocation.longitude,
      });
      setHomeName('My Mountain Home');
      setShowHomeModal(true);
    } else if (navigator.geolocation) {
      setIsGettingLocation(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setPendingHomeCoords({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setHomeName('My Mountain Home');
          setShowHomeModal(true);
          setIsGettingLocation(false);
        },
        () => {
          message.error('Enable location to set Mountain Home');
          setIsGettingLocation(false);
        }
      );
    }
  }, [userLocation]);

  // Confirm Mountain Home
  const handleConfirmHome = useCallback(() => {
    if (!pendingHomeCoords) return;

    const home: MountainHome = {
      latitude: pendingHomeCoords.lat,
      longitude: pendingHomeCoords.lng,
      name: homeName || 'Mountain Home',
    };

    try {
      localStorage.setItem(MOUNTAIN_HOME_STORAGE_KEY, JSON.stringify(home));
    } catch {
      // Ignore storage errors
    }

    onMountainHomeChange?.(home);
    setShowHomeModal(false);
    setPendingHomeCoords(null);
    message.success('Mountain Home set!');
  }, [pendingHomeCoords, homeName, onMountainHomeChange]);

  // Clear Mountain Home
  const handleClearHome = useCallback(() => {
    try {
      localStorage.removeItem(MOUNTAIN_HOME_STORAGE_KEY);
    } catch {
      // Ignore
    }
    onMountainHomeChange?.(null);
    message.info('Mountain Home cleared');
  }, [onMountainHomeChange]);

  // Go to Mountain Home
  const handleGoToHome = useCallback(() => {
    if (mountainHome) {
      onGoToLocation?.(mountainHome.latitude, mountainHome.longitude, 16);
    }
  }, [mountainHome, onGoToLocation]);

  return (
    <>
      <div className="location-controls">
        {/* Current Location Button */}
        <Tooltip 
          title={
            isTrackingLocation 
              ? 'Go to my location • Long press to share' 
              : 'Show my location'
          }
          placement="left"
        >
          <button
            className={`location-btn ${isTrackingLocation ? 'active' : ''} ${isGettingLocation ? 'loading' : ''}`}
            onClick={handleCurrentLocation}
            onContextMenu={(e) => {
              e.preventDefault();
              handleShareLocation();
            }}
            disabled={isGettingLocation}
          >
            <AimOutlined style={{ fontSize: 16 }} />
          </button>
        </Tooltip>

        {/* Share Location Button (visible when tracking) */}
        {isTrackingLocation && (
          <Tooltip title="Share my location" placement="left">
            <button
              className="location-btn share-btn"
              onClick={handleShareLocation}
            >
              <ShareAltOutlined style={{ fontSize: 14 }} />
            </button>
          </Tooltip>
        )}

        {/* Mountain Home Button */}
        <Tooltip 
          title={mountainHome ? `Go to ${mountainHome.name}` : 'Set Mountain Home'} 
          placement="left"
        >
          <button
            className={`location-btn home-btn ${mountainHome ? 'has-home' : ''}`}
            onClick={mountainHome ? handleGoToHome : handleSetMountainHome}
            onContextMenu={(e) => {
              e.preventDefault();
              if (mountainHome) {
                handleClearHome();
              } else {
                handleSetMountainHome();
              }
            }}
          >
            <HomeOutlined style={{ fontSize: 16 }} />
          </button>
        </Tooltip>
      </div>

      {/* Set Mountain Home Modal */}
      <Modal
        title={
          <span style={{ fontSize: 12, fontWeight: 500 }}>
            <HomeOutlined style={{ marginRight: 8, color: '#f97316' }} />
            Set Mountain Home
          </span>
        }
        open={showHomeModal}
        onCancel={() => {
          setShowHomeModal(false);
          setPendingHomeCoords(null);
        }}
        footer={null}
        width={300}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <div className="flex flex-col gap-3">
          <div>
            <label style={{ fontSize: 10, color: '#888', display: 'block', marginBottom: 4 }}>
              Name your location
            </label>
            <Input
              value={homeName}
              onChange={(e) => setHomeName(e.target.value)}
              placeholder="e.g., Chalet, Hotel, Apartment"
              size="small"
            />
          </div>
          <div style={{ fontSize: 10, color: '#666' }}>
            This will mark your current location on the map with a home icon.
          </div>
          <div className="flex gap-2 justify-end">
            <button
              className="location-btn"
              style={{ width: 'auto', padding: '4px 12px' }}
              onClick={() => setShowHomeModal(false)}
            >
              Cancel
            </button>
            <button
              className="location-btn has-home"
              style={{ width: 'auto', padding: '4px 12px' }}
              onClick={handleConfirmHome}
            >
              <CheckOutlined style={{ marginRight: 4 }} />
              Set Home
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

const LocationControls = memo(LocationControlsInner);
export default LocationControls;

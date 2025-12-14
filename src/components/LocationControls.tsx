'use client';

import { useState, useCallback, useEffect, memo } from 'react';
import { Tooltip, Modal, Input, App } from 'antd';
import {
  AimOutlined,
  HomeOutlined,
  ShareAltOutlined,
  CheckOutlined,
  EditOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { trackEvent } from '@/lib/posthog';

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
  skiAreaId?: string | null;
  skiAreaName?: string | null;
  isEditingHome: boolean;
  onEditingHomeChange: (editing: boolean) => void;
  pendingHomeLocation?: { lat: number; lng: number } | null;
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
  skiAreaId,
  skiAreaName,
  isEditingHome,
  onEditingHomeChange,
  pendingHomeLocation,
}: LocationControlsProps) {
  const { message } = App.useApp();
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

  // When a location is selected from the map in edit mode, show the modal
  useEffect(() => {
    if (pendingHomeLocation && isEditingHome) {
      setPendingHomeCoords(pendingHomeLocation);
      setHomeName(mountainHome?.name || 'Mountain Home');
      setShowHomeModal(true);
      onEditingHomeChange(false);
    }
  }, [pendingHomeLocation, isEditingHome, mountainHome?.name, onEditingHomeChange]);

  // Handle current location button click
  const handleCurrentLocation = useCallback(() => {
    if (isTrackingLocation && userLocation) {
      // If already tracking, just go to the location
      trackEvent('fly_to_location', {
        location_type: 'user',
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
      });
      onGoToLocation?.(userLocation.latitude, userLocation.longitude, 16);
      return;
    }

    if (!navigator.geolocation) {
      message.error('Geolocation is not supported by your browser');
      return;
    }

    setIsGettingLocation(true);
    trackEvent('user_location_requested');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location: UserLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        };
        trackEvent('user_location_granted', {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
        });
        onUserLocationChange?.(location);
        onGoToLocation?.(location.latitude, location.longitude, 16);
        onToggleTracking(true);
        setIsGettingLocation(false);
      },
      (error) => {
        setIsGettingLocation(false);
        trackEvent('user_location_denied', {
          error_code: error.code,
          error_message: error.message,
        });
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
  }, [isTrackingLocation, userLocation, onUserLocationChange, onGoToLocation, onToggleTracking, message]);

  // Share current location - creates an app link with location marker
  const handleShareLocation = useCallback(async () => {
    if (!userLocation) {
      message.info('Enable location first to share');
      return;
    }

    // Build URL with shared location parameters
    const params = new URLSearchParams();
    
    // Include ski area if available
    if (skiAreaId) {
      params.set('area', skiAreaId);
    }
    if (skiAreaName) {
      params.set('name', skiAreaName);
    }
    
    // Set map center to the shared location
    params.set('lat', userLocation.latitude.toFixed(6));
    params.set('lng', userLocation.longitude.toFixed(6));
    params.set('z', '16');
    
    // Shared location marker parameters
    params.set('slat', userLocation.latitude.toFixed(6));
    params.set('slng', userLocation.longitude.toFixed(6));
    params.set('sname', 'Someone shared their location');

    const shareUrl = `${window.location.origin}?${params.toString()}`;
    
    const shareData = {
      title: 'SKISHADE - My Location',
      text: `I'm on the mountain! Check where I am:\n\n${shareUrl}`,
      url: shareUrl,
    };

    trackEvent('share_initiated', {
      has_location: true,
      ski_area_id: skiAreaId || undefined,
      ski_area_name: skiAreaName || undefined,
    });

    if (navigator.share && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
        trackEvent('share_completed', {
          share_method: 'native',
          has_location: true,
        });
        return;
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
      }
    }

    // Fallback to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      trackEvent('share_link_copied', {
        has_location: true,
      });
      message.success('Location link copied to clipboard!');
    } catch {
      message.info('Copy this link: ' + shareUrl);
    }
  }, [userLocation, skiAreaId, skiAreaName, message]);

  // Enter edit mode to place mountain home on map
  const handleEnterEditMode = useCallback(() => {
    onEditingHomeChange(true);
    message.info('Tap on the map to set your Mountain Home location');
  }, [onEditingHomeChange, message]);

  // Cancel edit mode
  const handleCancelEditMode = useCallback(() => {
    onEditingHomeChange(false);
  }, [onEditingHomeChange]);

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

    trackEvent('mountain_home_set', {
      latitude: home.latitude,
      longitude: home.longitude,
      home_name: home.name,
      ski_area_id: skiAreaId || undefined,
    });

    onMountainHomeChange?.(home);
    setShowHomeModal(false);
    setPendingHomeCoords(null);
    message.success('Mountain Home set!');
  }, [pendingHomeCoords, homeName, onMountainHomeChange, message, skiAreaId]);

  // Clear Mountain Home
  const handleClearHome = useCallback(() => {
    try {
      localStorage.removeItem(MOUNTAIN_HOME_STORAGE_KEY);
    } catch {
      // Ignore
    }
    trackEvent('mountain_home_removed');
    onMountainHomeChange?.(null);
    message.info('Mountain Home cleared');
  }, [onMountainHomeChange, message]);

  // Go to Mountain Home
  const handleGoToHome = useCallback(() => {
    if (mountainHome) {
      trackEvent('fly_to_location', {
        location_type: 'mountain_home',
        latitude: mountainHome.latitude,
        longitude: mountainHome.longitude,
      });
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
              className="location-btn"
              onClick={handleShareLocation}
            >
              <ShareAltOutlined style={{ fontSize: 14 }} />
            </button>
          </Tooltip>
        )}

        {/* Mountain Home Button */}
        <Tooltip 
          title={
            isEditingHome 
              ? 'Cancel editing' 
              : mountainHome 
                ? `Go to ${mountainHome.name}` 
                : 'Set Mountain Home'
          } 
          placement="left"
        >
          <button
            className={`location-btn home-btn ${mountainHome ? 'has-home' : ''} ${isEditingHome ? 'editing' : ''}`}
            onClick={() => {
              if (isEditingHome) {
                handleCancelEditMode();
              } else if (mountainHome) {
                handleGoToHome();
              } else {
                handleEnterEditMode();
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (mountainHome) {
                handleClearHome();
              }
            }}
          >
            {isEditingHome ? (
              <CloseOutlined style={{ fontSize: 14 }} />
            ) : (
              <HomeOutlined style={{ fontSize: 16 }} />
            )}
          </button>
        </Tooltip>

        {/* Edit/Move Mountain Home Button (visible when home exists) */}
        {mountainHome && !isEditingHome && (
          <Tooltip title="Move Mountain Home" placement="left">
            <button
              className="location-btn"
              onClick={handleEnterEditMode}
            >
              <EditOutlined style={{ fontSize: 14 }} />
            </button>
          </Tooltip>
        )}
      </div>

      {/* Edit Mode Indicator */}
      {isEditingHome && (
        <div className="edit-home-banner">
          <HomeOutlined style={{ marginRight: 6 }} />
          Tap on map to set location
          <button 
            className="edit-home-cancel"
            onClick={handleCancelEditMode}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Set Mountain Home Modal */}
      <Modal
        title={
          <span style={{ fontSize: 12, fontWeight: 500 }}>
            <HomeOutlined style={{ marginRight: 8, color: '#faad14' }} />
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
            This will mark the selected location on the map with a home icon.
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

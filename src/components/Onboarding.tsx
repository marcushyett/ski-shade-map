'use client';

import { SunOutlined, CompassOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import LocationSearch, { type LocationSelection } from './LocationSearch';
import Logo from './Logo';
import { trackEvent } from '@/lib/posthog';

const { Text } = Typography;

interface OnboardingProps {
  onSelectLocation: (location: LocationSelection) => void;
}

export default function Onboarding({ onSelectLocation }: OnboardingProps) {
  const handleLocationSelect = (location: LocationSelection) => {
    trackEvent('onboarding_resort_selected', {
      skiAreaId: location.skiAreaId,
      skiAreaName: location.skiAreaName,
    });
    onSelectLocation(location);
  };

  return (
    <div className="onboarding-container">
      <div className="onboarding-content">
        <div className="onboarding-header">
          <Logo size="lg" />
          <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
            Chase the sun, on the snow
          </Text>
        </div>

        <div className="onboarding-features">
          <div className="onboarding-feature">
            <SunOutlined className="onboarding-feature-icon" />
            <span>Find sunny or shaded runs in real-time</span>
          </div>
          <div className="onboarding-feature">
            <CompassOutlined className="onboarding-feature-icon" />
            <span>Plan efficient routes through the resort</span>
          </div>
          <div className="onboarding-feature">
            <EnvironmentOutlined className="onboarding-feature-icon" />
            <span>Locate toilets and facilities quickly</span>
          </div>
        </div>

        <div className="onboarding-search">
          <Text type="secondary" style={{ fontSize: 10, marginBottom: 8, display: 'block', textAlign: 'center' }}>
            SELECT A RESORT TO BEGIN
          </Text>
          <LocationSearch
            onSelect={handleLocationSelect}
            placeholder="Search ski areas..."
          />
        </div>

        <div className="onboarding-footer">
          <Text type="secondary" style={{ fontSize: 9 }}>
            By selecting a resort, you agree to our{' '}
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="onboarding-link">
              Terms
            </a>
            {' and '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="onboarding-link">
              Privacy Policy
            </a>
          </Text>
          <Text type="secondary" style={{ fontSize: 9, marginTop: 6, display: 'block' }}>
            Free and open source. We use anonymous analytics (PostHog) to improve the app.
            <br />
            No personal data is stored.
          </Text>
        </div>
      </div>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import Logo from '@/components/Logo';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy Policy for SKISHADE - how we handle your data',
};

export default function PrivacyPolicy() {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <div className="legal-header">
          <Link href="/" className="legal-logo-link">
            <Logo size="md" />
          </Link>
        </div>

        <h1 className="legal-title">Privacy Policy</h1>
        <p className="legal-updated">Last updated: December 2024</p>

        <section className="legal-section">
          <h2>Overview</h2>
          <p>
            SKISHADE is a free, open-source ski mapping application. We are committed to
            protecting your privacy and being transparent about how we handle data.
          </p>
        </section>

        <section className="legal-section">
          <h2>Data We Collect</h2>
          <h3>Local Storage Only</h3>
          <p>
            SKISHADE stores your preferences and settings locally on your device using
            browser localStorage. This data never leaves your device and includes:
          </p>
          <ul>
            <li>Your selected ski resort</li>
            <li>Unit preferences (Celsius/Fahrenheit, km/mph)</li>
            <li>Favourite runs</li>
            <li>Mountain home location</li>
            <li>Navigation routes (temporary)</li>
          </ul>
          <p>
            You can clear all stored data at any time using the &quot;Clear cache &amp; storage&quot;
            option in the app settings.
          </p>
        </section>

        <section className="legal-section">
          <h2>Analytics</h2>
          <p>
            We use PostHog for anonymous analytics to understand how the app is used and
            to improve it. This includes:
          </p>
          <ul>
            <li>Page views and feature usage (anonymized)</li>
            <li>App performance metrics</li>
            <li>Error reports</li>
          </ul>
          <p>
            We do not collect or store any personally identifiable information.
            Analytics data is aggregated and cannot be used to identify individual users.
          </p>
        </section>

        <section className="legal-section">
          <h2>Location Data</h2>
          <p>
            If you enable location features, your GPS position is used only within the app
            to show your location on the map and provide navigation. This data is processed
            locally on your device and is not sent to our servers.
          </p>
        </section>

        <section className="legal-section">
          <h2>Third-Party Services</h2>
          <p>SKISHADE uses the following third-party services:</p>
          <ul>
            <li>
              <strong>MapTiler</strong> - Map tiles and geocoding
            </li>
            <li>
              <strong>Open-Meteo</strong> - Weather data
            </li>
            <li>
              <strong>OpenSkiMap</strong> - Ski resort data (via OpenStreetMap)
            </li>
            <li>
              <strong>PostHog</strong> - Anonymous analytics
            </li>
          </ul>
          <p>
            These services have their own privacy policies. We recommend reviewing them
            if you have concerns about how they handle data.
          </p>
        </section>

        <section className="legal-section">
          <h2>Cookies</h2>
          <p>
            SKISHADE uses localStorage instead of cookies for storing your preferences.
            PostHog may use localStorage for analytics purposes. No tracking cookies are used.
          </p>
        </section>

        <section className="legal-section">
          <h2>Data Retention</h2>
          <p>
            All user preferences are stored locally on your device. We do not maintain
            any user databases or store personal information on our servers.
          </p>
        </section>

        <section className="legal-section">
          <h2>Your Rights</h2>
          <p>
            Since we don&apos;t collect personal data, there is no personal information
            to access, modify, or delete from our systems. You can clear your local data
            at any time through your browser settings or the app&apos;s reset function.
          </p>
        </section>

        <section className="legal-section">
          <h2>Open Source</h2>
          <p>
            SKISHADE is open source. You can review our code to verify how we handle data.
          </p>
        </section>

        <section className="legal-section">
          <h2>Contact</h2>
          <p>
            For privacy-related questions, please open an issue on our GitHub repository.
          </p>
        </section>

        <div className="legal-footer">
          <Link href="/" className="legal-back-link">
            Back to SKISHADE
          </Link>
        </div>
      </div>
    </div>
  );
}

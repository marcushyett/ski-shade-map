import type { Metadata } from 'next';
import Link from 'next/link';
import Logo from '@/components/Logo';

export const metadata: Metadata = {
  title: 'Terms and Conditions',
  description: 'Terms and Conditions for using SKISHADE',
};

export default function TermsAndConditions() {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <div className="legal-header">
          <Link href="/" className="legal-logo-link">
            <Logo size="md" />
          </Link>
        </div>

        <h1 className="legal-title">Terms and Conditions</h1>
        <p className="legal-updated">Last updated: December 2024</p>

        <section className="legal-section">
          <h2>Acceptance of Terms</h2>
          <p>
            By accessing and using SKISHADE, you agree to be bound by these Terms and
            Conditions. If you do not agree with any part of these terms, you should
            not use this application.
          </p>
        </section>

        <section className="legal-section">
          <h2>Description of Service</h2>
          <p>
            SKISHADE is a free, open-source ski mapping application that provides:
          </p>
          <ul>
            <li>Real-time sun and shade information on ski runs</li>
            <li>Route planning within ski resorts</li>
            <li>Weather and snow condition information</li>
            <li>Facility locations (toilets, restaurants, etc.)</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>Disclaimer of Warranties</h2>
          <p>
            SKISHADE is provided &quot;as is&quot; and &quot;as available&quot; without any warranties
            of any kind, either express or implied, including but not limited to:
          </p>
          <ul>
            <li>Accuracy of sun/shade calculations</li>
            <li>Accuracy of weather data</li>
            <li>Accuracy of trail and lift information</li>
            <li>Availability of the service</li>
            <li>Fitness for any particular purpose</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>Safety Warning</h2>
          <p>
            <strong>Important:</strong> SKISHADE is a planning and informational tool only.
            It should not be used as your sole source of navigation or safety information
            while skiing. Always:
          </p>
          <ul>
            <li>Follow resort signage and official trail markings</li>
            <li>Obey ski patrol instructions</li>
            <li>Check official resort conditions and avalanche reports</li>
            <li>Ski within your ability level</li>
            <li>Be aware of changing weather and snow conditions</li>
          </ul>
          <p>
            Mountain conditions can change rapidly. Do not rely solely on this app for
            safety-critical decisions.
          </p>
        </section>

        <section className="legal-section">
          <h2>Limitation of Liability</h2>
          <p>
            To the fullest extent permitted by law, SKISHADE and its creators shall not
            be liable for any direct, indirect, incidental, special, consequential, or
            punitive damages arising out of or relating to your use of the application,
            including but not limited to:
          </p>
          <ul>
            <li>Personal injury or death</li>
            <li>Property damage</li>
            <li>Loss of data</li>
            <li>Inaccurate information</li>
            <li>Service interruptions</li>
          </ul>
          <p>
            You assume all risks associated with skiing and using this application.
          </p>
        </section>

        <section className="legal-section">
          <h2>Data Sources</h2>
          <p>
            SKISHADE relies on third-party data sources including:
          </p>
          <ul>
            <li><strong>OpenSkiMap/OpenStreetMap</strong> - Trail and lift data</li>
            <li><strong>Open-Meteo</strong> - Weather forecasts</li>
            <li><strong>MapTiler</strong> - Map tiles</li>
          </ul>
          <p>
            We do not guarantee the accuracy or completeness of data from these sources.
            Trail information may be outdated, incomplete, or incorrect.
          </p>
        </section>

        <section className="legal-section">
          <h2>Intellectual Property</h2>
          <p>
            SKISHADE is open-source software. The source code is available under its
            respective license. Map data is provided by OpenStreetMap contributors and
            is available under the Open Database License.
          </p>
        </section>

        <section className="legal-section">
          <h2>User Conduct</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use the service for any unlawful purpose</li>
            <li>Attempt to interfere with the proper functioning of the service</li>
            <li>Misuse the service in any way that could damage the service or impair access</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>Modifications to Terms</h2>
          <p>
            We reserve the right to modify these terms at any time. Continued use of
            SKISHADE after changes constitutes acceptance of the new terms.
          </p>
        </section>

        <section className="legal-section">
          <h2>Governing Law</h2>
          <p>
            These terms shall be governed by and construed in accordance with applicable
            laws, without regard to conflict of law principles.
          </p>
        </section>

        <section className="legal-section">
          <h2>Contact</h2>
          <p>
            For questions about these terms, please open an issue on our GitHub repository.
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

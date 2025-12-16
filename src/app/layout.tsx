import type { Metadata, Viewport } from "next";
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider, theme, App } from 'antd';
import PostHogProvider from '@/components/PostHogProvider';
import "./globals.css";
import { BASE_URL, SKI_KEYWORDS } from '@/lib/seo-utils';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "SKISHADE | Live 3D Ski Maps & Real-Time Snow Conditions",
    template: "%s | SKISHADE",
  },
  description: "Find sunny or shaded ski slopes in real-time. Live 3D piste maps, snow conditions, sun tracking, and smart route planning for every ski resort. Optimize every second of your skiing.",
  keywords: [
    ...SKI_KEYWORDS,
    "ski", "skiing", "sun", "shade", "map", "slopes", "winter sports",
    "piste map", "ski conditions", "snow report", "ski navigation",
    "alpine skiing", "ski resort finder", "mountain weather",
  ],
  authors: [{ name: "Marcus Hyett" }],
  creator: "SKISHADE",
  publisher: "SKISHADE",
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SKISHADE',
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'SKISHADE | Live 3D Ski Maps & Real-Time Snow Conditions',
    description: 'Find sunny or shaded ski slopes in real-time. Live 3D piste maps, snow conditions, sun tracking, and smart route planning for every ski resort.',
    type: 'website',
    siteName: 'SKISHADE',
    locale: 'en_US',
    url: BASE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SKISHADE | Live 3D Ski Maps & Real-Time Snow Conditions',
    description: 'Find sunny or shaded ski slopes in real-time. Live 3D piste maps, snow conditions, and smart route planning.',
    creator: '@skishade',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: BASE_URL,
  },
  category: 'sports',
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0a0a0a',
};

// JSON-LD structured data for the website
const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'SKISHADE',
  alternateName: ['Ski Shade', 'SkiShade'],
  url: BASE_URL,
  description: 'Real-time 3D ski maps with live snow conditions, sun & shade tracking, and smart route planning for every ski resort worldwide.',
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${BASE_URL}/?search={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
};

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'SKISHADE',
  url: BASE_URL,
  logo: `${BASE_URL}/favicon.svg`,
  description: 'Real-time 3D ski maps with live snow conditions and sun tracking.',
  sameAs: [],
};

const softwareAppJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'SKISHADE',
  applicationCategory: 'SportsApplication',
  operatingSystem: 'Web',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  description: 'Live 3D ski maps with real-time snow conditions, sun & shade tracking, and smart route planning.',
  featureList: [
    'Real-time 3D piste maps',
    'Live snow conditions',
    'Sun and shade tracking',
    'Smart route planning',
    'Weather forecasts',
    'Offline support',
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Preconnect to external APIs for faster resource loading */}
        <link rel="preconnect" href="https://api.maptiler.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://api.open-meteo.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://api.maptiler.com" />
        <link rel="dns-prefetch" href="https://api.open-meteo.com" />
        
        {/* JSON-LD Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppJsonLd) }}
        />
        
        {/* PWA and iOS specific meta tags */}
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="SKISHADE" />
      </head>
      <body>
        <PostHogProvider>
          <AntdRegistry>
            <ConfigProvider
              theme={{
                algorithm: theme.darkAlgorithm,
                token: {
                  colorPrimary: '#ffffff',
                  colorBgBase: '#0a0a0a',
                  colorBgContainer: '#141414',
                  colorBorder: '#262626',
                  colorText: '#e5e5e5',
                  colorTextSecondary: '#a3a3a3',
                  borderRadius: 2,
                  borderRadiusLG: 2,
                  borderRadiusSM: 2,
                  borderRadiusXS: 1,
                  paddingXS: 4,
                  paddingSM: 6,
                  padding: 8,
                  paddingLG: 12,
                  marginXS: 4,
                  marginSM: 6,
                  margin: 8,
                  marginLG: 12,
                  controlHeight: 28,
                  controlHeightSM: 22,
                  controlHeightLG: 32,
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                },
              }}
            >
              <App>
                {children}
              </App>
            </ConfigProvider>
          </AntdRegistry>
        </PostHogProvider>
      </body>
    </html>
  );
}

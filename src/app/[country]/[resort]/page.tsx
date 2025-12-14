import { Metadata } from 'next';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { 
  slugToCountry, 
  countryToSlug, 
  toSlug, 
  getCountryDisplayName, 
  getResortKeywords,
  BASE_URL 
} from '@/lib/seo-utils';
import { notFound } from 'next/navigation';

interface PageProps {
  params: Promise<{ country: string; resort: string }>;
}

interface SkiAreaBasic {
  name: string;
  country: string | null;
}

interface SkiAreaWithCount {
  id: string;
  name: string;
  country: string | null;
  region: string | null;
  latitude: number;
  longitude: number;
  _count: {
    runs: number;
    lifts: number;
  };
}

// Generate static params for all resorts at build time
export async function generateStaticParams() {
  const skiAreas: SkiAreaBasic[] = await prisma.skiArea.findMany({
    where: { country: { not: null } },
    select: {
      name: true,
      country: true,
    },
  });

  return skiAreas.map((area: SkiAreaBasic) => ({
    country: countryToSlug(area.country!),
    resort: toSlug(area.name),
  }));
}

// Helper to find ski area by slug
async function findSkiAreaBySlug(countrySlug: string, resortSlug: string): Promise<SkiAreaWithCount | undefined> {
  const countryCode = slugToCountry(countrySlug);
  
  // Get all ski areas for this country
  const skiAreas: SkiAreaWithCount[] = await prisma.skiArea.findMany({
    where: {
      country: {
        equals: countryCode,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      name: true,
      country: true,
      region: true,
      latitude: true,
      longitude: true,
      _count: {
        select: {
          runs: true,
          lifts: true,
        },
      },
    },
  });

  // Find the one matching the slug
  return skiAreas.find((area: SkiAreaWithCount) => toSlug(area.name) === resortSlug);
}

// Generate metadata for SEO
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { country: countrySlug, resort: resortSlug } = await params;
  const skiArea = await findSkiAreaBySlug(countrySlug, resortSlug);
  
  if (!skiArea) {
    return { title: 'Resort Not Found | SKISHADE' };
  }

  const countryName = getCountryDisplayName(skiArea.country || '');
  const keywords = getResortKeywords(skiArea.name, skiArea.country || '');
  
  const title = `${skiArea.name} Ski Map | Live Snow Conditions & Sun Tracking | SKISHADE`;
  const description = `Explore ${skiArea.name} with our real-time 3D piste map. Live snow conditions, sun & shade tracking, ${skiArea._count.runs} pistes, ${skiArea._count.lifts} lifts. Find sunny slopes and plan your perfect ski day in ${countryName}.`;

  return {
    title,
    description,
    keywords: keywords.join(', '),
    openGraph: {
      title,
      description,
      type: 'website',
      url: `${BASE_URL}/${countrySlug}/${resortSlug}`,
      siteName: 'SKISHADE',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
    alternates: {
      canonical: `${BASE_URL}/${countrySlug}/${resortSlug}`,
    },
  };
}

export default async function ResortPage({ params }: PageProps) {
  const { country: countrySlug, resort: resortSlug } = await params;
  const skiArea = await findSkiAreaBySlug(countrySlug, resortSlug);

  if (!skiArea) {
    notFound();
  }

  const countryCode = skiArea.country || '';
  const countryName = getCountryDisplayName(countryCode);

  // JSON-LD structured data for the ski resort
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SkiResort',
    name: skiArea.name,
    description: `Real-time 3D ski map of ${skiArea.name} with live snow conditions, sun & shade tracking, and smart route planning.`,
    url: `${BASE_URL}/${countrySlug}/${resortSlug}`,
    address: {
      '@type': 'PostalAddress',
      addressCountry: countryCode,
      addressRegion: skiArea.region,
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: skiArea.latitude,
      longitude: skiArea.longitude,
    },
    amenityFeature: [
      {
        '@type': 'LocationFeatureSpecification',
        name: 'Pistes',
        value: skiArea._count.runs,
      },
      {
        '@type': 'LocationFeatureSpecification',
        name: 'Ski Lifts',
        value: skiArea._count.lifts,
      },
    ],
    potentialAction: {
      '@type': 'ViewAction',
      name: 'View Live Ski Map',
      target: `${BASE_URL}/?area=${skiArea.id}`,
    },
  };

  // BreadcrumbList for navigation
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: BASE_URL,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: countryName,
        item: `${BASE_URL}/${countrySlug}`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: skiArea.name,
        item: `${BASE_URL}/${countrySlug}/${resortSlug}`,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <div className="min-h-screen bg-[#0a0a0a] text-white">
        <header className="border-b border-white/10 px-4 py-4 md:px-8">
          <Link href="/" className="inline-block text-xl font-bold tracking-wider hover:opacity-80">
            SKISHADE
          </Link>
          <p className="mt-1 text-sm text-gray-400">Real-time ski maps & conditions</p>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
          <nav className="mb-6 text-sm text-gray-400">
            <Link href="/" className="hover:text-white">Home</Link>
            <span className="mx-2">/</span>
            <Link href={`/${countrySlug}`} className="hover:text-white">{countryName}</Link>
            <span className="mx-2">/</span>
            <span className="text-white">{skiArea.name}</span>
          </nav>

          <div className="mb-8">
            <h1 className="mb-2 text-3xl font-bold md:text-4xl">
              {skiArea.name}
            </h1>
            <p className="text-lg text-gray-400">
              {skiArea.region && `${skiArea.region}, `}{countryName}
            </p>
          </div>

          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border border-white/10 bg-white/5 p-4">
              <div className="text-2xl font-bold">{skiArea._count.runs}</div>
              <div className="text-sm text-gray-400">Pistes & Trails</div>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-4">
              <div className="text-2xl font-bold">{skiArea._count.lifts}</div>
              <div className="text-sm text-gray-400">Ski Lifts</div>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-4">
              <div className="text-2xl font-bold text-green-400">Live</div>
              <div className="text-sm text-gray-400">Real-time Updates</div>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-4">
              <div className="text-2xl font-bold">3D</div>
              <div className="text-sm text-gray-400">Interactive Map</div>
            </div>
          </div>

          {/* CTA to open the map */}
          <div className="mb-8">
            <Link
              href={`/?area=${skiArea.id}`}
              className="inline-flex items-center gap-2 rounded bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700"
            >
              <span>🗺️</span>
              Open Live Ski Map
            </Link>
            <p className="mt-2 text-sm text-gray-400">
              View real-time conditions, sun & shade, and plan your perfect ski day
            </p>
          </div>

          <section className="mb-12">
            <h2 className="mb-4 text-xl font-semibold">
              About {skiArea.name}
            </h2>
            <p className="text-gray-300 leading-relaxed max-w-3xl">
              Discover {skiArea.name} with SKISHADE&apos;s real-time 3D ski map. 
              Our live piste map shows you exactly which slopes are in the sun or shade 
              at any time of day, helping you find the best snow conditions. 
              With {skiArea._count.runs} pistes and {skiArea._count.lifts} ski lifts to explore, 
              plan your day efficiently using our smart route planner &ndash; like a satnav for 
              the mountains.
            </p>
          </section>

          <section className="mb-12 grid gap-6 md:grid-cols-2">
            <div className="rounded border border-white/10 bg-white/5 p-6">
              <h3 className="mb-3 font-semibold text-lg">☀️ Sun & Shade Tracking</h3>
              <p className="text-sm text-gray-400">
                Know exactly which runs at {skiArea.name} are sunny or shaded right now. 
                Perfect for finding powder that&apos;s stayed cold, or warming up on 
                sun-kissed slopes. Slider lets you plan ahead for any time of day.
              </p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-6">
              <h3 className="mb-3 font-semibold text-lg">❄️ Live Snow Conditions</h3>
              <p className="text-sm text-gray-400">
                Real-time snow quality analysis for {skiArea.name} based on weather, 
                altitude, and sun exposure. Find the best snow conditions on the mountain
                with our intelligent condition tracking.
              </p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-6">
              <h3 className="mb-3 font-semibold text-lg">🗺️ Interactive 3D Map</h3>
              <p className="text-sm text-gray-400">
                Explore every run and lift at {skiArea.name} in stunning 3D. 
                Toggle between 2D and 3D views, search for specific pistes, 
                and get detailed information about each trail.
              </p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-6">
              <h3 className="mb-3 font-semibold text-lg">🧭 Route Planning</h3>
              <p className="text-sm text-gray-400">
                Navigate {skiArea.name} efficiently. Our smart route planner helps 
                you find the optimal path between any two points on the mountain &ndash; 
                like having a satnav for skiing.
              </p>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="mb-4 text-xl font-semibold">
              How to Use the {skiArea.name} Live Map
            </h2>
            <ol className="list-decimal list-inside space-y-3 text-gray-300">
              <li>
                <strong>Open the map</strong> &ndash; Click &quot;Open Live Ski Map&quot; to see {skiArea.name} in real-time
              </li>
              <li>
                <strong>Check sun & shade</strong> &ndash; Yellow slopes are sunny, blue are shaded. Use the time slider to plan ahead
              </li>
              <li>
                <strong>View snow conditions</strong> &ndash; Tap any piste to see current snow quality and conditions
              </li>
              <li>
                <strong>Plan your route</strong> &ndash; Use search to find specific runs or lifts, and navigate efficiently
              </li>
            </ol>
          </section>

          <section className="border-t border-white/10 pt-8">
            <h2 className="mb-4 text-xl font-semibold">
              More Ski Resorts in {countryName}
            </h2>
            <p className="mb-4 text-gray-400">
              Explore other ski resorts in {countryName} with live piste maps and conditions:
            </p>
            <Link
              href={`/${countrySlug}`}
              className="text-blue-400 hover:text-blue-300"
            >
              View all ski resorts in {countryName} →
            </Link>
          </section>
        </main>

        <footer className="border-t border-white/10 px-4 py-6 text-center text-sm text-gray-400 md:px-8">
          <p>&copy; {new Date().getFullYear()} SKISHADE &middot; Real-time ski maps powered by OpenSkiMap</p>
        </footer>
      </div>
    </>
  );
}

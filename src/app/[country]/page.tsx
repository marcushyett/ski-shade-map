import { Metadata } from 'next';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { 
  slugToCountry, 
  countryToSlug, 
  toSlug, 
  getCountryDisplayName, 
  getCountryKeywords,
  BASE_URL 
} from '@/lib/seo-utils';
import { notFound } from 'next/navigation';

interface PageProps {
  params: Promise<{ country: string }>;
}

interface SkiAreaWithCount {
  id: string;
  name: string;
  region: string | null;
  latitude: number;
  longitude: number;
  _count: {
    runs: number;
    lifts: number;
  };
}

// Generate static params for all countries at build time
export async function generateStaticParams() {
  const countries = await prisma.skiArea.groupBy({
    by: ['country'],
    where: { country: { not: null } },
  });

  return countries
    .filter((c: { country: string | null }) => c.country)
    .map((c: { country: string | null }) => ({
      country: countryToSlug(c.country!),
    }));
}

// Generate metadata for SEO
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { country: countrySlug } = await params;
  const countryCode = slugToCountry(countrySlug);
  const countryName = getCountryDisplayName(countryCode);
  const keywords = getCountryKeywords(countryCode);
  
  const title = `Ski Resorts in ${countryName} | Live Piste Maps & Snow Conditions | SKISHADE`;
  const description = `Explore all ski resorts in ${countryName} with real-time 3D piste maps, live snow conditions, sun & shade tracking, and smart route planning. Find the best skiing conditions today.`;

  return {
    title,
    description,
    keywords: keywords.join(', '),
    openGraph: {
      title,
      description,
      type: 'website',
      url: `${BASE_URL}/${countrySlug}`,
      siteName: 'SKISHADE',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
    alternates: {
      canonical: `${BASE_URL}/${countrySlug}`,
    },
  };
}

export default async function CountryPage({ params }: PageProps) {
  const { country: countrySlug } = await params;
  const countryCode = slugToCountry(countrySlug);
  
  // Fetch all ski areas for this country
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
    orderBy: { name: 'asc' },
  });

  if (skiAreas.length === 0) {
    notFound();
  }

  const countryName = getCountryDisplayName(countryCode);

  // Group by region
  const byRegion = skiAreas.reduce<Record<string, SkiAreaWithCount[]>>((acc, area) => {
    const region = area.region || 'Other';
    if (!acc[region]) acc[region] = [];
    acc[region].push(area);
    return acc;
  }, {});

  // JSON-LD structured data
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Ski Resorts in ${countryName}`,
    description: `Complete list of ski resorts in ${countryName} with live conditions and 3D maps`,
    numberOfItems: skiAreas.length,
    itemListElement: skiAreas.map((area: SkiAreaWithCount, index: number) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'SkiResort',
        name: area.name,
        url: `${BASE_URL}/${countrySlug}/${toSlug(area.name)}`,
        geo: {
          '@type': 'GeoCoordinates',
          latitude: area.latitude,
          longitude: area.longitude,
        },
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
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
            <span className="text-white">{countryName}</span>
          </nav>

          <h1 className="mb-2 text-3xl font-bold md:text-4xl">
            Ski Resorts in {countryName}
          </h1>
          <p className="mb-8 text-gray-400 max-w-2xl">
            Explore {skiAreas.length} ski resorts in {countryName} with live 3D piste maps, 
            real-time snow conditions, sun & shade tracking, and smart route planning to 
            optimize every moment on the mountain.
          </p>

          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border border-white/10 bg-white/5 p-4">
              <div className="text-2xl font-bold">{skiAreas.length}</div>
              <div className="text-sm text-gray-400">Ski Resorts</div>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-4">
              <div className="text-2xl font-bold">
                {skiAreas.reduce((sum: number, a: SkiAreaWithCount) => sum + a._count.runs, 0).toLocaleString()}
              </div>
              <div className="text-sm text-gray-400">Pistes & Trails</div>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-4">
              <div className="text-2xl font-bold">
                {skiAreas.reduce((sum: number, a: SkiAreaWithCount) => sum + a._count.lifts, 0).toLocaleString()}
              </div>
              <div className="text-sm text-gray-400">Ski Lifts</div>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-4">
              <div className="text-2xl font-bold text-green-400">Live</div>
              <div className="text-sm text-gray-400">Real-time Updates</div>
            </div>
          </div>

          {Object.entries(byRegion).sort(([a], [b]) => a.localeCompare(b)).map(([region, areas]) => (
            <section key={region} className="mb-8">
              <h2 className="mb-4 text-xl font-semibold border-b border-white/10 pb-2">
                {region}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {areas.map((area: SkiAreaWithCount) => (
                  <Link
                    key={area.id}
                    href={`/${countrySlug}/${toSlug(area.name)}`}
                    className="group rounded border border-white/10 bg-white/5 p-4 transition-colors hover:border-white/30 hover:bg-white/10"
                  >
                    <h3 className="font-medium group-hover:text-blue-400">
                      {area.name}
                    </h3>
                    <p className="mt-1 text-sm text-gray-400">
                      {area._count.runs} pistes · {area._count.lifts} lifts
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          ))}

          <section className="mt-12 border-t border-white/10 pt-8">
            <h2 className="mb-4 text-xl font-semibold">
              Why Use SKISHADE for {countryName} Ski Resorts?
            </h2>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="font-medium text-blue-400">☀️ Sun & Shade Tracking</h3>
                <p className="mt-1 text-sm text-gray-400">
                  See exactly which slopes are in the sun or shade throughout the day. 
                  Find the best snow conditions by knowing where the sun hasn&apos;t hit yet.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-blue-400">🗺️ Interactive 3D Piste Maps</h3>
                <p className="mt-1 text-sm text-gray-400">
                  Explore every run and lift in stunning 3D. Plan your day with detailed 
                  trail information and real-time conditions.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-blue-400">❄️ Live Snow Conditions</h3>
                <p className="mt-1 text-sm text-gray-400">
                  Get up-to-date snow quality information based on weather, altitude, 
                  and sun exposure. Know where to find the best powder.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-blue-400">🧭 Smart Route Planning</h3>
                <p className="mt-1 text-sm text-gray-400">
                  Navigate efficiently between different parts of the resort. 
                  Like a satnav for skiing &ndash; find the optimal route to any destination.
                </p>
              </div>
            </div>
          </section>
        </main>

        <footer className="border-t border-white/10 px-4 py-6 text-center text-sm text-gray-400 md:px-8">
          <p>&copy; {new Date().getFullYear()} SKISHADE &middot; Real-time ski maps powered by OpenSkiMap</p>
        </footer>
      </div>
    </>
  );
}

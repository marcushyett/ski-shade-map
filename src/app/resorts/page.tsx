import { Metadata } from 'next';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { countryToSlug, getCountryDisplayName, BASE_URL } from '@/lib/seo-utils';

// Use ISR (Incremental Static Regeneration) - page is cached after first request
// Revalidates every hour for fresh data while keeping pages fast and SEO-friendly
// No database required at build time, but pages are cached like static pages
export const revalidate = 3600; // 1 hour

export const metadata: Metadata = {
  title: 'All Ski Resorts | Live 3D Maps & Snow Conditions',
  description: 'Browse all ski resorts worldwide with real-time 3D piste maps, live snow conditions, sun & shade tracking, and smart route planning. Find your perfect ski destination.',
  keywords: [
    'ski resorts worldwide',
    'all ski resorts',
    'ski resort list',
    'ski resort finder',
    'best ski resorts',
    'ski destinations',
    'ski resort map',
  ].join(', '),
  openGraph: {
    title: 'All Ski Resorts | Live 3D Maps & Snow Conditions | SKISHADE',
    description: 'Browse all ski resorts worldwide with real-time 3D piste maps and live snow conditions.',
    type: 'website',
    url: `${BASE_URL}/resorts`,
    siteName: 'SKISHADE',
  },
  alternates: {
    canonical: `${BASE_URL}/resorts`,
  },
};

export default async function ResortsPage() {
  // Get all countries with their resort counts
  const countries = await prisma.skiArea.groupBy({
    by: ['country'],
    _count: { country: true },
    where: { country: { not: null } },
    orderBy: { country: 'asc' },
  });

  // Get total stats
  const totalStats = await prisma.$transaction([
    prisma.skiArea.count(),
    prisma.run.count(),
    prisma.lift.count(),
  ]);

  const totalResorts = totalStats[0];
  const totalRuns = totalStats[1];
  const totalLifts = totalStats[2];

  // JSON-LD structured data
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'All Ski Resorts',
    description: 'Complete list of ski resorts worldwide with live conditions and 3D maps',
    numberOfItems: totalResorts,
    itemListElement: countries.map((c: (typeof countries)[number], index: number) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Place',
        name: `Ski Resorts in ${getCountryDisplayName(c.country!)}`,
        url: `${BASE_URL}/${countryToSlug(c.country!)}`,
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
            <span className="text-white">All Resorts</span>
          </nav>

          <h1 className="mb-2 text-3xl font-bold md:text-4xl">
            All Ski Resorts
          </h1>
          <p className="mb-8 text-gray-400 max-w-2xl">
            Explore ski resorts worldwide with live 3D piste maps, real-time snow conditions,
            sun & shade tracking, and smart route planning.
          </p>

          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border border-white/10 bg-white/5 p-4">
              <div className="text-2xl font-bold">{totalResorts.toLocaleString()}</div>
              <div className="text-sm text-gray-400">Ski Resorts</div>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-4">
              <div className="text-2xl font-bold">{countries.length}</div>
              <div className="text-sm text-gray-400">Countries</div>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-4">
              <div className="text-2xl font-bold">{totalRuns.toLocaleString()}</div>
              <div className="text-sm text-gray-400">Pistes & Trails</div>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-4">
              <div className="text-2xl font-bold">{totalLifts.toLocaleString()}</div>
              <div className="text-sm text-gray-400">Ski Lifts</div>
            </div>
          </div>

          <h2 className="mb-4 text-xl font-semibold">Browse by Country</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {countries
              .filter((c: (typeof countries)[number]) => c.country)
              .map((c: (typeof countries)[number]) => {
                const countryName = getCountryDisplayName(c.country!);
                return (
                  <Link
                    key={c.country}
                    href={`/${countryToSlug(c.country!)}`}
                    className="group rounded border border-white/10 bg-white/5 p-4 transition-colors hover:border-white/30 hover:bg-white/10"
                  >
                    <h3 className="font-medium group-hover:text-blue-400">
                      {countryName}
                    </h3>
                    <p className="mt-1 text-sm text-gray-400">
                      {c._count.country} ski resorts
                    </p>
                  </Link>
                );
              })}
          </div>

          <section className="mt-12 border-t border-white/10 pt-8">
            <h2 className="mb-4 text-xl font-semibold">
              Why Choose SKISHADE?
            </h2>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="font-medium text-blue-400">☀️ Real-Time Sun & Shade</h3>
                <p className="mt-1 text-sm text-gray-400">
                  See exactly which slopes are in the sun or shade at any time of day.
                  Find the best snow conditions by knowing where the sun hasn&apos;t melted the powder.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-blue-400">🗺️ Interactive 3D Maps</h3>
                <p className="mt-1 text-sm text-gray-400">
                  Explore every run and lift in stunning 3D. Toggle between views,
                  search for specific pistes, and plan your perfect ski day.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-blue-400">❄️ Live Snow Conditions</h3>
                <p className="mt-1 text-sm text-gray-400">
                  Real-time snow quality analysis based on weather, altitude, and sun exposure.
                  Know where to find the best conditions on the mountain.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-blue-400">🧭 Smart Route Planning</h3>
                <p className="mt-1 text-sm text-gray-400">
                  Navigate efficiently between any two points on the mountain.
                  Like a satnav for skiing &ndash; optimize every second of your day.
                </p>
              </div>
            </div>
          </section>
        </main>

        <footer className="border-t border-white/10 px-4 py-6 text-center text-sm text-gray-400 md:px-8">
          <p>&copy; {new Date().getFullYear()} SKISHADE &middot; Real-time ski maps powered by OpenSkiMap &middot; Weather by <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Open-Meteo</a></p>
        </footer>
      </div>
    </>
  );
}

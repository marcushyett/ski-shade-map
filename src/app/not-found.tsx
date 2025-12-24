import Link from 'next/link';
import prisma from '@/lib/prisma';
import { countryToSlug, toSlug, getCountryDisplayName, BASE_URL } from '@/lib/seo-utils';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Page Not Found | SKISHADE',
  description: 'The page you are looking for could not be found. Explore our collection of 4,900+ ski resorts worldwide with real-time 3D maps and snow conditions.',
};

interface FeaturedResort {
  id: string;
  name: string;
  country: string | null;
  region: string | null;
  _count: {
    runs: number;
    lifts: number;
  };
}

// Get random resorts from the database
async function getRandomResorts(count: number = 12): Promise<FeaturedResort[]> {
  try {
    // Get total count for random offset
    const totalCount = await prisma.skiArea.count({
      where: { country: { not: null } },
    });

    // Get multiple random batches to ensure variety
    const resorts: FeaturedResort[] = [];
    const usedIds = new Set<string>();

    // Try to get `count` unique resorts
    for (let attempt = 0; attempt < count * 3 && resorts.length < count; attempt++) {
      const randomOffset = Math.floor(Math.random() * Math.max(1, totalCount - 1));

      const batch = await prisma.skiArea.findMany({
        where: {
          country: { not: null },
          id: { notIn: Array.from(usedIds) },
        },
        select: {
          id: true,
          name: true,
          country: true,
          region: true,
          _count: {
            select: {
              runs: true,
              lifts: true,
            },
          },
        },
        skip: randomOffset,
        take: 1,
      });

      for (const resort of batch) {
        if (!usedIds.has(resort.id) && resorts.length < count) {
          usedIds.add(resort.id);
          resorts.push(resort);
        }
      }
    }

    return resorts;
  } catch (error) {
    console.error('Failed to fetch random resorts:', error);
    return [];
  }
}

// Get country statistics
async function getCountryStats(): Promise<{ country: string; count: number }[]> {
  try {
    const stats = await prisma.skiArea.groupBy({
      by: ['country'],
      _count: true,
      where: { country: { not: null } },
      orderBy: { _count: { country: 'desc' } },
      take: 10,
    });

    return stats
      .filter((s): s is typeof s & { country: string } => s.country !== null)
      .map(s => ({ country: s.country, count: s._count }));
  } catch (error) {
    console.error('Failed to fetch country stats:', error);
    return [];
  }
}

export default async function NotFound() {
  const [randomResorts, countryStats] = await Promise.all([
    getRandomResorts(12),
    getCountryStats(),
  ]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="border-b border-white/10 px-4 py-4 md:px-8">
        <Link href="/" className="inline-block text-xl font-bold tracking-wider hover:opacity-80">
          SKISHADE
        </Link>
        <p className="mt-1 text-sm text-gray-400">Real-time ski maps &amp; conditions</p>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-12 md:px-8">
        {/* 404 Message */}
        <div className="mb-12 text-center">
          <h1 className="mb-4 text-6xl font-bold text-gray-600">404</h1>
          <h2 className="mb-4 text-2xl font-semibold">Page Not Found</h2>
          <p className="mx-auto max-w-lg text-gray-400">
            The ski resort or page you&apos;re looking for doesn&apos;t exist in our database.
            But don&apos;t worry &ndash; we have <strong className="text-white">4,900+ ski resorts</strong> worldwide
            that you can explore!
          </p>
        </div>

        {/* CTA Buttons */}
        <div className="mb-16 flex flex-wrap justify-center gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700"
          >
            <span>🗺️</span>
            Open Live Map
          </Link>
          <Link
            href="/resorts"
            className="inline-flex items-center gap-2 rounded border border-white/20 bg-white/5 px-6 py-3 font-medium text-white transition-colors hover:bg-white/10"
          >
            <span>⛷️</span>
            Browse All Resorts
          </Link>
        </div>

        {/* What is SKISHADE */}
        <section className="mb-16">
          <h2 className="mb-6 text-center text-xl font-semibold">What is SKISHADE?</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border border-white/10 bg-white/5 p-5">
              <div className="mb-2 text-2xl">☀️</div>
              <h3 className="mb-2 font-semibold">Sun &amp; Shade Tracking</h3>
              <p className="text-sm text-gray-400">
                See which slopes are sunny or shaded in real-time. Find the best snow conditions throughout the day.
              </p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-5">
              <div className="mb-2 text-2xl">❄️</div>
              <h3 className="mb-2 font-semibold">Live Snow Conditions</h3>
              <p className="text-sm text-gray-400">
                Real-time snow quality analysis based on weather, altitude, and sun exposure.
              </p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-5">
              <div className="mb-2 text-2xl">🗺️</div>
              <h3 className="mb-2 font-semibold">Interactive 3D Maps</h3>
              <p className="text-sm text-gray-400">
                Explore every run and lift in stunning 3D. Toggle views, search pistes, and plan your day.
              </p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-5">
              <div className="mb-2 text-2xl">🧭</div>
              <h3 className="mb-2 font-semibold">Route Planning</h3>
              <p className="text-sm text-gray-400">
                Smart navigation between any two points on the mountain &ndash; like a satnav for skiing.
              </p>
            </div>
          </div>
        </section>

        {/* Random Resorts */}
        {randomResorts.length > 0 && (
          <section className="mb-16">
            <h2 className="mb-6 text-center text-xl font-semibold">Discover Ski Resorts</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {randomResorts.map((resort) => {
                const countrySlug = countryToSlug(resort.country || '');
                const resortSlug = toSlug(resort.name);
                const countryName = getCountryDisplayName(resort.country || '');

                return (
                  <Link
                    key={resort.id}
                    href={`/${countrySlug}/${resortSlug}`}
                    className="group rounded border border-white/10 bg-white/5 p-4 transition-colors hover:border-white/20 hover:bg-white/10"
                  >
                    <h3 className="font-medium group-hover:text-blue-400">{resort.name}</h3>
                    <p className="text-sm text-gray-400">
                      {resort.region && `${resort.region}, `}{countryName}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {resort._count.runs} pistes &middot; {resort._count.lifts} lifts
                    </p>
                  </Link>
                );
              })}
            </div>
            <p className="mt-4 text-center text-sm text-gray-500">
              Showing random selection &ndash; refresh for more resorts
            </p>
          </section>
        )}

        {/* Countries */}
        {countryStats.length > 0 && (
          <section className="mb-16">
            <h2 className="mb-6 text-center text-xl font-semibold">Browse by Country</h2>
            <div className="flex flex-wrap justify-center gap-3">
              {countryStats.map(({ country, count }) => (
                <Link
                  key={country}
                  href={`/${countryToSlug(country)}`}
                  className="rounded border border-white/10 bg-white/5 px-4 py-2 text-sm transition-colors hover:border-white/20 hover:bg-white/10"
                >
                  {getCountryDisplayName(country)} <span className="text-gray-500">({count})</span>
                </Link>
              ))}
            </div>
            <p className="mt-4 text-center">
              <Link href="/resorts" className="text-sm text-blue-400 hover:text-blue-300">
                View all countries →
              </Link>
            </p>
          </section>
        )}

        {/* Help Text */}
        <section className="text-center">
          <p className="text-gray-400">
            Looking for a specific resort? Try the{' '}
            <Link href="/" className="text-blue-400 hover:text-blue-300">
              search on our main map
            </Link>
            .
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Data powered by OpenSkiMap &middot; Weather by Open-Meteo
          </p>
        </section>
      </main>

      <footer className="border-t border-white/10 px-4 py-6 text-center text-sm text-gray-400 md:px-8">
        <p>&copy; {new Date().getFullYear()} SKISHADE &middot; Real-time ski maps for every mountain</p>
      </footer>
    </div>
  );
}

import { MetadataRoute } from 'next';
import prisma from '@/lib/prisma';
import { countryToSlug, toSlug, BASE_URL } from '@/lib/seo-utils';

interface SkiAreaForSitemap {
  id: string;
  name: string;
  country: string | null;
  updatedAt: Date;
}

// Use dynamic rendering for sitemap - generated at request time
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = BASE_URL;
  const now = new Date();

  // Static pages - always include these
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/resorts`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
  ];

  // Try to get ski areas from database, but gracefully handle errors
  let skiAreas: SkiAreaForSitemap[] = [];
  try {
    skiAreas = await prisma.skiArea.findMany({
      where: { country: { not: null } },
      select: {
        id: true,
        name: true,
        country: true,
        updatedAt: true,
      },
    });
  } catch (error) {
    console.error('Failed to fetch ski areas for sitemap:', error);
    // Return just static pages if database is unavailable
    return staticPages;
  }

  // Get unique countries
  const countriesMap = new Map<string, Date>();
  skiAreas.forEach((area: SkiAreaForSitemap) => {
    if (area.country) {
      const existing = countriesMap.get(area.country);
      if (!existing || area.updatedAt > existing) {
        countriesMap.set(area.country, area.updatedAt);
      }
    }
  });

  // Country pages
  const countryPages: MetadataRoute.Sitemap = Array.from(countriesMap.entries()).map(
    ([country, lastModified]) => ({
      url: `${baseUrl}/${countryToSlug(country)}`,
      lastModified,
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    })
  );

  // Resort pages
  const resortPages: MetadataRoute.Sitemap = skiAreas.map((area: SkiAreaForSitemap) => ({
    url: `${baseUrl}/${countryToSlug(area.country!)}/${toSlug(area.name)}`,
    lastModified: area.updatedAt,
    changeFrequency: 'daily' as const,
    priority: 0.8,
  }));

  return [...staticPages, ...countryPages, ...resortPages];
}

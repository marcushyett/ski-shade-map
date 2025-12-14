import { MetadataRoute } from 'next';
import prisma from '@/lib/prisma';
import { countryToSlug, toSlug, BASE_URL } from '@/lib/seo-utils';

interface SkiAreaForSitemap {
  id: string;
  name: string;
  country: string | null;
  updatedAt: Date;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = BASE_URL;
  
  // Get all ski areas
  const skiAreas: SkiAreaForSitemap[] = await prisma.skiArea.findMany({
    where: { country: { not: null } },
    select: {
      id: true,
      name: true,
      country: true,
      updatedAt: true,
    },
  });

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

  const now = new Date();

  // Static pages
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

import type { MetadataRoute } from 'next';
import { listActiveCities, listAllCategories } from '@/db/queries-postgis';

export const dynamic = 'force-dynamic';

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://eneleje.com';

/** Sitemap dinámico: home + categoría (subdominio) + categoría × ciudad. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categorias, ciudades] = await Promise.all([listAllCategories(), listActiveCities()]);

  const entradas: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, changeFrequency: 'daily', priority: 1 },
    ...categorias.map((c) => ({
      url: `${BASE}/c/${c.slug}`,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...categorias.flatMap((c) =>
      ciudades.map((city) => ({
        url: `${BASE}/c/${c.slug}/${city.slug}`,
        changeFrequency: 'daily' as const,
        priority: 0.6,
      })),
    ),
  ];
  return entradas;
}

import type { MetadataRoute } from 'next';

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://eneleje.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/panel', '/api', '/entrar', '/registro'],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}

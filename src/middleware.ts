/**
 * eneleje.com · Middleware de multi-tenancy dinámico
 *
 * Mapea subdominio -> categoría y path -> ciudad SIN tocar la base de datos
 * (corre en Edge). La validación de que el subdominio es una categoría real
 * ocurre en la página /c/[categoria] con caché (puede hacer redirect).
 *
 *   panaderias.eneleje.com                          -> /c/panaderias
 *   panaderias.eneleje.com/pereira                  -> /c/panaderias/pereira
 *   panaderias.eneleje.com/pereira/la-espiga        -> /c/panaderias/pereira/la-espiga
 *   eneleje.com | www | admin | api | ...           -> sin cambios
 *
 * Ruta interna receptora: app/(catalogo)/c/[categoria]/[[...rest]]/page.tsx
 */
import { NextResponse, type NextRequest } from 'next/server';

const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'eneleje.com').toLowerCase();

/** Subdominios que NUNCA se interpretan como categoría (coincide con el CHECK de categories). */
const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'admin', 'api', 'auth', 'cdn', 'static', 'assets', 'img',
  'mail', 'blog', 'docs', 'status', 'help', 'panel', 'dashboard', 'mod',
  'dev', 'staging', 'test',
]);

/**
 * Extrae el subdominio de primer nivel si el host vive bajo ROOT_DOMAIN.
 * Tolerante a puerto (localhost:3000) y a hosts ajenos (IP, preview de Vercel).
 */
function parseSubdomain(rawHost: string): string | null {
  const host = rawHost.split(':')[0]?.toLowerCase() ?? '';
  if (!host.endsWith(`.${ROOT_DOMAIN}`)) return null;

  const sub = host.slice(0, host.length - ROOT_DOMAIN.length - 1);
  // Solo un nivel: panaderias.eneleje.com sí; a.b.eneleje.com no (host ajeno/hack)
  if (!sub || sub.includes('.')) return null;
  return sub;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const subdomain = parseSubdomain(request.headers.get('host') ?? '');

  // Dominio raíz, www, reservados u hosts ajenos: la app corre normal.
  if (!subdomain || RESERVED_SUBDOMAINS.has(subdomain)) {
    return NextResponse.next();
  }

  // Loop-protection: la ruta ya fue reescrita por este mismo middleware.
  if (pathname.startsWith('/c/')) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  // categoria.eneleje.com            -> /c/{categoria}
  // categoria.eneleje.com/pereira/... -> /c/{categoria}/pereira/...
  url.pathname = `/c/${subdomain}${pathname === '/' ? '' : pathname}`;

  const response = NextResponse.rewrite(url);
  // Disponible en Server Components vía headers() (conviene propagarla en fetch cache keys)
  response.headers.set('x-category-subdomain', subdomain);
  return response;
}

export const config = {
  // Nada de assets estáticos, APIs internas ni archivos de metadata
  matcher: [
    '/((?!_next/|api/|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest).*)',
  ],
};

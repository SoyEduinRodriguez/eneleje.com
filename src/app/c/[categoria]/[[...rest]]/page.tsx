import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  getBusinessBySlug,
  getBusinessCatalog,
  getCategoryBySlug,
  getCityBySlug,
  listActiveCities,
  searchBusinesses,
  type BusinessSearchRow,
} from '@/db/queries-postgis';
import { ContingencyBadge, formatDistance, whatsappLink } from '@/components/contingency';

/**
 * Contrato de URLs (ver docs/ARQUITECTURA.md):
 *   /c/{categoria}                       → listado regional
 *   /c/{categoria}/{ciudad}              → listado por ciudad
 *   /c/{categoria}/{ciudad}/{negocio}    → perfil público
 * El middleware reescribe aquí los subdominios: panaderias.eneleje.com/pereira.
 */

type Props = { params: Promise<{ categoria: string; rest?: string[] }> };

export const dynamic = 'force-dynamic'; // Fase 1: sin capas de caché todavía

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { categoria, rest = [] } = await params;
  const category = await getCategoryBySlug(categoria);
  if (!category) return { title: 'Categoría no encontrada' };
  const ciudad = rest[0] ? await getCityBySlug(rest[0]) : null;
  const where = ciudad ? `en ${ciudad.name}` : 'en el Eje Cafetero';
  return { title: `${category.name} ${where}` };
}

export default async function CatalogPage({ params }: Props) {
  const { categoria, rest = [] } = await params;
  const [ciudadSlug, negocioSlug] = rest;

  const category = await getCategoryBySlug(categoria);
  if (!category || !category.isActive) notFound();

  const city = ciudadSlug ? await getCityBySlug(ciudadSlug) : null;
  if (ciudadSlug && !city) notFound();

  // ── Perfil de negocio: /c/{categoria}/{ciudad}/{negocio} ──────────────────
  if (negocioSlug) {
    if (!city || !ciudadSlug) notFound();
    const biz = await getBusinessBySlug(categoria, ciudadSlug, negocioSlug);
    if (!biz) notFound();
    return <BusinessProfile biz={biz} categoria={categoria} ciudad={ciudadSlug} />;
  }

  // ── Listado: /c/{categoria} o /c/{categoria}/{ciudad} ─────────────────────
  const [businesses, cities] = await Promise.all([
    searchBusinesses({
      categorySlug: categoria,
      citySlug: city?.slug,
      // Orden por proximidad al centroid de la ciudad (sin filtro de radio)
      lat: city?.lat,
      lon: city?.lon,
      limit: 24,
    }),
    listActiveCities(),
  ]);

  return (
    <div className="space-y-6">
      <nav className="text-sm text-slate-500">
        <Link href="/" className="hover:text-emerald-700">
          Inicio
        </Link>
        <span className="mx-1.5">/</span>
        <span className="font-medium text-slate-700">{category.name}</span>
        {city && (
          <>
            <span className="mx-1.5">/</span>
            <span className="font-medium text-slate-700">{city.name}</span>
          </>
        )}
      </nav>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {category.emoji ?? '🏪'} {category.name}{' '}
          <span className="font-normal text-slate-500">
            {city ? `en ${city.name}` : 'en el Eje Cafetero'}
          </span>
        </h1>
        <p className="text-sm text-slate-500">
          {businesses.length === 0
            ? 'Aún no hay negocios publicados aquí.'
            : `${businesses.length} negocio${businesses.length !== 1 ? 's' : ''} publicad${
                businesses.length !== 1 ? 'os' : 'o'
              }${city ? ' · ordenados por proximidad al centro' : ''}`}
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <CityChip href={`/c/${categoria}`} label="Toda la región" active={!city} />
        {cities.map((c) => (
          <CityChip
            key={c.slug}
            href={`/c/${categoria}/${c.slug}`}
            label={c.name}
            active={city?.slug === c.slug}
          />
        ))}
      </div>

      {businesses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          Nadie se ha registrado todavía en esta categoría
          {city ? ` en ${city.name}` : ''}. El primero puede ser tuyo — el registro es
          gratis e inmediato.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {businesses.map((biz) => (
            <BusinessCard
              key={biz.id}
              biz={biz}
              href={
                city && ciudadSlug
                  ? `/c/${categoria}/${ciudadSlug}/${biz.slug}`
                  : `/c/${categoria}/${biz.slug}`
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CityChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-sm transition ${
        active
          ? 'border-emerald-600 bg-emerald-600 text-white'
          : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-400 hover:text-emerald-700'
      }`}
    >
      {label}
    </Link>
  );
}

function BusinessCard({ biz, href }: { biz: BusinessSearchRow; href: string }) {
  const distance = formatDistance(biz.distance_m);
  return (
    <li>
      <Link
        href={href}
        className="flex h-full flex-col gap-2 rounded-xl border border-slate-200 bg-white p-5 transition hover:border-emerald-400 hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-semibold text-slate-900">
            {biz.name}
            {biz.is_verified && (
              <span className="ml-1.5 align-middle text-xs text-sky-600" title="Verificado">
                ✔
              </span>
            )}
          </h2>
          {distance && (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {distance}
            </span>
          )}
        </div>
        {biz.short_description && (
          <p className="line-clamp-2 text-sm text-slate-600">{biz.short_description}</p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <ContingencyBadge status={biz.contingency_status} note={biz.contingency_note} />
          <span className="text-xs font-medium text-emerald-700">Ver perfil →</span>
        </div>
      </Link>
    </li>
  );
}

type ProfileRow = NonNullable<Awaited<ReturnType<typeof getBusinessBySlug>>>;

function formatCOP(v: string | null): string {
  if (!v) return '';
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString('es-CO')}` : v;
}

function BusinessProfile({
  biz,
  categoria,
  ciudad,
}: {
  biz: ProfileRow;
  categoria: string;
  ciudad: string;
}) {
  return <Perfil biz={biz} categoria={categoria} ciudad={ciudad} />;
}

async function Perfil({
  biz,
  categoria,
  ciudad,
}: {
  biz: ProfileRow;
  categoria: string;
  ciudad: string;
}) {
  const catalogo = await getBusinessCatalog(biz.id, true);
  const secciones = agruparCatalogo(catalogo);

  // Datos estructurados para resultados enriquecidos en buscadores (SEO local).
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: biz.name,
    description: biz.short_description ?? undefined,
    telephone: biz.phone ?? biz.whatsapp_phone,
    address: biz.address
      ? { '@type': 'PostalAddress', streetAddress: biz.address, addressLocality: biz.city_name, addressCountry: 'CO' }
      : undefined,
    geo: { '@type': 'GeoCoordinates', latitude: biz.lat, longitude: biz.lon },
    url: `https://eneleje.com/c/${categoria}/${ciudad}/${biz.slug}`,
  };

  return (
    <div className="space-y-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="text-sm text-slate-500">
        <Link href="/" className="hover:text-emerald-700">
          Inicio
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={`/c/${categoria}`} className="hover:text-emerald-700">
          {biz.category_name}
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={`/c/${categoria}/${ciudad}`} className="hover:text-emerald-700">
          {biz.city_name}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="font-medium text-slate-700">{biz.name}</span>
      </nav>

      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {biz.name}
          {biz.is_verified && (
            <span className="ml-2 align-middle text-sm font-medium text-sky-600">
              ✔ Verificado
            </span>
          )}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <ContingencyBadge status={biz.contingency_status} note={biz.contingency_note} />
          <span className="text-sm text-slate-500">
            {biz.category_name} · {biz.city_name}
          </span>
        </div>
        {biz.contingency_note && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {biz.contingency_note}
          </p>
        )}
        {biz.short_description && <p className="text-slate-700">{biz.short_description}</p>}
      </header>

      <section className="flex flex-col gap-3 sm:flex-row">
        <a
          href={whatsappLink(biz.whatsapp_phone, biz.name)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-xl bg-emerald-600 px-5 py-3.5 text-center font-semibold text-white transition hover:bg-emerald-700"
        >
          💬 Escribir por WhatsApp
        </a>
        {biz.phone && (
          <a
            href={`tel:${biz.phone.replace(/\s/g, '')}`}
            className="flex-1 rounded-xl border border-slate-300 bg-white px-5 py-3.5 text-center font-semibold text-slate-800 transition hover:border-emerald-400"
          >
            📞 Llamar {biz.phone}
          </a>
        )}
      </section>

      {biz.description && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 font-semibold text-slate-900">Sobre el negocio</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
            {biz.description}
          </p>
        </section>
      )}

      {secciones.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight">Menú / catálogo</h2>
          {secciones.map((s) => (
            <div key={s.cat_id} className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="mb-3 font-semibold text-slate-900">📋 {s.cat_name}</h3>
              <ul className="divide-y divide-slate-100">
                {s.items.map((it) => (
                  <li key={it.item_id} className="py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-slate-900">{it.item_name}</p>
                      <p className="text-sm">
                        {it.promo_price ? (
                          <>
                            <span className="font-semibold text-emerald-700">
                              {formatCOP(it.promo_price)}
                            </span>{' '}
                            <s className="text-xs text-slate-400">{formatCOP(it.price)}</s>
                          </>
                        ) : (
                          <span className="font-semibold text-slate-700">{formatCOP(it.price)}</span>
                        )}
                      </p>
                    </div>
                    {it.item_description && (
                      <p className="mt-0.5 text-sm text-slate-500">{it.item_description}</p>
                    )}
                    {it.promo_ends_at && (
                      <p className="mt-0.5 text-xs text-amber-700">
                        Promo vigente hasta {new Date(it.promo_ends_at).toLocaleDateString('es-CO')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
        <h2 className="mb-2 font-semibold text-slate-900">Ubicación y contacto</h2>
        <dl className="space-y-1.5 text-slate-700">
          {biz.address && (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-slate-500">Dirección</dt>
              <dd>
                {biz.address}
                {biz.neighborhood ? ` · ${biz.neighborhood}` : ''}
              </dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-slate-500">WhatsApp</dt>
            <dd className="font-mono text-xs leading-6">{biz.whatsapp_phone}</dd>
          </div>
          {biz.website_url && (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-slate-500">Sitio web</dt>
              <dd>
                <a
                  href={biz.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-700 hover:underline"
                >
                  {biz.website_url}
                </a>
              </dd>
            </div>
          )}
          {biz.instagram_url && (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-slate-500">Instagram</dt>
              <dd>
                <a
                  href={biz.instagram_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-700 hover:underline"
                >
                  {biz.instagram_url}
                </a>
              </dd>
            </div>
          )}
        </dl>
      </section>

      <p className="text-xs text-slate-400">
        Coordenadas del local: {biz.lat.toFixed(5)}, {biz.lon.toFixed(5)} — el mapa
        interactivo llega en la Fase 3.
      </p>
    </div>
  );
}

interface SeccionCatalogo {
  cat_id: string;
  cat_name: string;
  items: { item_id: string; item_name: string; item_description: string | null; price: string | null; promo_price: string | null; promo_ends_at: string | null }[];
}

function agruparCatalogo(rows: Awaited<ReturnType<typeof getBusinessCatalog>>): SeccionCatalogo[] {
  const out = new Map<string, SeccionCatalogo>();
  for (const r of rows) {
    if (!r.item_id) continue;
    let s = out.get(r.cat_id);
    if (!s) {
      s = { cat_id: r.cat_id, cat_name: r.cat_name, items: [] };
      out.set(r.cat_id, s);
    }
    s.items.push({
      item_id: r.item_id,
      item_name: r.item_name ?? '',
      item_description: r.item_description,
      price: r.price,
      promo_price: r.promo_price,
      promo_ends_at: r.promo_ends_at,
    });
  }
  return [...out.values()];
}

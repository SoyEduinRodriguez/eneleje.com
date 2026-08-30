/**
 * eneleje.com · Integración PostGIS con Drizzle ORM
 *
 * Estrategia: Drizzle maneja CRUD tipado; las consultas espaciales y el KNN
 * van como SQL nativo con `sql` templates (parámetros vinculados, sin riesgo
 * de inyección). Así aprovechamos el índice GiST y el operador `<->` intactos.
 *
 * Requiere: DATABASE_URL, drizzle-orm, pg.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, eq, desc } from 'drizzle-orm';
import { Pool } from 'pg';
import { businesses, categories, cities } from './schema';

/* --------------------------------- cliente -------------------------------- */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
export const db = drizzle(pool);

/** Tipo de la transacción que entrega db.transaction (para callbacks tipados). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* ------------------------------ helpers PostGIS --------------------------- */

/** geography literal desde coordenadas. ⚠ Orden: (LONGITUD, latitud). */
export function geogPoint(lon: number, lat: number) {
  return sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography`;
}

/** Proyección a lat/lon para el mapa (MapLibre). */
const latExpr = sql<number>`ST_Y(b.geom::geometry)`;
const lonExpr = sql<number>`ST_X(b.geom::geometry)`;

/* --------------------------- RLS: contexto de sesión ---------------------- */

/**
 * Envuelve una operación de ESCRITURA en una transacción con el contexto RLS.
 * Las policies de 004_rls_policies.sql leen app.user_id / app.role con
 * set_config(..., true) = válido solo dentro de esta transacción.
 */
export function withUserContext<T>(
  userId: string,
  role: 'owner' | 'moderator' | 'superadmin',
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql`SELECT set_config('app.role', ${role}, true)`);
    return fn(tx);
  });
}

/* ------------------------------- consultas -------------------------------- */

export interface SearchParams {
  categorySlug: string;
  citySlug?: string;
  q?: string;
  lat?: number;
  lon?: number;
  radiusM?: number; // default 5000
  limit?: number;   // default 24, máx 100
  offset?: number;
}

// type (no interface): db.execute<T> exige un index signature implícito,
// que TypeScript solo otorga a alias de tipo objeto.
export type BusinessSearchRow = {
  id: string;
  name: string;
  slug: string;
  short_description: string | null;
  whatsapp_phone: string;
  contingency_status: 'normal' | 'delivery_only' | 'closed_damage' | 'collection_center' | 'unknown';
  contingency_note: string | null;
  is_verified: boolean;
  logo_url: string | null;
  lat: number;
  lon: number;
  distance_m: number | null;
};

/**
 * HOT PATH — categoría + ciudad + radio, ordenado por proximidad.
 * Usa idx_businesses_cat_city_published (B-Tree) + idx_businesses_geom
 * (GiST) con ST_DWithin (filtro por radio) y `<->` (KNN ordenado por índice).
 */
export async function searchBusinesses(p: SearchParams): Promise<BusinessSearchRow[]> {
  const hasLocation = typeof p.lat === 'number' && typeof p.lon === 'number';
  const point = geogPoint(p.lon ?? 0, p.lat ?? 0);
  const limit = Math.min(p.limit ?? 24, 100);
  const offset = Math.max(p.offset ?? 0, 0);

  const conditions = [
    sql`b.status = 'published'`,
    sql`b.deleted_at IS NULL`,
    sql`c.slug = ${p.categorySlug}`,
  ];
  if (p.citySlug) conditions.push(sql`ci.slug = ${p.citySlug}`);
  if (p.q) conditions.push(sql`b.name ILIKE ${'%' + p.q + '%'}`);
  // El radio FILTRA solo cuando se pide explícitamente ("cerca de mí").
  // Con lat/lon sin radius se ORDENA por proximidad sin recortar resultados.
  if (hasLocation && typeof p.radiusM === 'number') {
    conditions.push(sql`ST_DWithin(b.geom, ${point}, ${p.radiusM})`);
  }

  const result = await db.execute<BusinessSearchRow>(sql`
    SELECT b.id,
           b.name,
           b.slug,
           b.short_description,
           b.whatsapp_phone,
           b.contingency_status,
           b.contingency_note,
           b.is_verified,
           b.logo_url,
           ${latExpr} AS lat,
           ${lonExpr} AS lon,
           ${hasLocation
             ? sql`ST_Distance(b.geom, ${point})`
             : sql`NULL::double precision`} AS distance_m
    FROM businesses b
    JOIN categories c ON c.id = b.category_id
    JOIN cities ci    ON ci.id = b.city_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY ${hasLocation
      ? sql`b.geom <-> ${point}`
      : sql`b.is_verified DESC, b.published_at DESC`}
    LIMIT ${limit} OFFSET ${offset}
  `);
  return result.rows;
}

/** Datos de la categoría para el subdominio (cacheable 24 h en app/Redis). */
export async function getCategoryBySlug(slug: string) {
  const [row] = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
  return row ?? null;
}

/** Ciudad por slug: centroid + bbox para centrar/ajustar el mapa. */
export async function getCityBySlug(slug: string) {
  const result = await db.execute<{
    id: number; slug: string; name: string; department: string | null;
    lat: number; lon: number; bbox: [number, number, number, number] | null;
  }>(sql`
    SELECT id, slug, name, department,
           ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon,
           bbox
    FROM cities
    WHERE slug = ${slug} AND is_active
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

/** Ciudades activas para los chips de filtro del catálogo. */
export async function listActiveCities() {
  const result = await db.execute<{ id: number; slug: string; name: string }>(
    sql`SELECT id, slug, name FROM cities WHERE is_active ORDER BY name`,
  );
  return result.rows;
}

/** Categorías activas con conteo de negocios publicados (home). */
export async function listCategoriesWithCounts() {
  const result = await db.execute<{
    slug: string; name: string; emoji: string | null; description: string | null;
    negocios: number;
  }>(sql`
    SELECT c.slug, c.name, c.emoji, c.description,
           count(b.id) FILTER (WHERE b.status = 'published' AND b.deleted_at IS NULL)::int AS negocios
    FROM categories c
    LEFT JOIN businesses b ON b.category_id = c.id
    WHERE c.is_active
    GROUP BY c.id
    ORDER BY c.sort_order, c.name
  `);
  return result.rows;
}

/** Perfil público por ruta completa /c/{categoria}/{ciudad}/{negocio}. */
export async function getBusinessBySlug(categorySlug: string, citySlug: string, slug: string) {
  const result = await db.execute<{
    id: string; name: string; slug: string;
    short_description: string | null; description: string | null;
    whatsapp_phone: string; phone: string | null;
    address: string | null; neighborhood: string | null;
    contingency_status: BusinessSearchRow['contingency_status'];
    contingency_note: string | null;
    is_verified: boolean;
    website_url: string | null; instagram_url: string | null; facebook_url: string | null;
    category_name: string; city_name: string;
    lat: number; lon: number;
  }>(sql`
    SELECT b.id, b.name, b.slug,
           b.short_description, b.description,
           b.whatsapp_phone, b.phone, b.address, b.neighborhood,
           b.contingency_status, b.contingency_note, b.is_verified,
           b.website_url, b.instagram_url, b.facebook_url,
           c.name AS category_name, ci.name AS city_name,
           ${latExpr} AS lat, ${lonExpr} AS lon
    FROM businesses b
    JOIN categories c ON c.id = b.category_id
    JOIN cities ci    ON ci.id = b.city_id
    WHERE b.slug = ${slug}
      AND c.slug = ${categorySlug}
      AND ci.slug = ${citySlug}
      AND b.status = 'published'
      AND b.deleted_at IS NULL
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

/** Registro del negocio con permisos RLS del dueño (Server Action).
 *  El slug NO se pasa: lo genera el trigger businesses_before_write en la BD. */
export function createBusinessAsOwner(
  userId: string,
  values: Omit<typeof businesses.$inferInsert, 'ownerId' | 'slug'>,
) {
  return withUserContext(userId, 'owner', (tx) =>
    // slug='': el trigger businesses_before_write lo reemplaza por el real.
    tx.insert(businesses).values({ ...values, ownerId: userId, slug: '' }).returning(),
  );
}

/* ─────────────────────── panel del comerciante (Fase 2) ─────────────────── */

/** Categorías activas para selects del panel (sin conteos). */
export async function listAllCategories() {
  return db
    .select({ id: categories.id, name: categories.name, slug: categories.slug, emoji: categories.emoji })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(categories.sortOrder, categories.name);
}

export interface MyBusinessRow {
  id: string;
  name: string;
  slug: string;
  status: typeof businesses.$inferSelect['status'];
  contingency_status: typeof businesses.$inferSelect['contingencyStatus'];
  is_verified: boolean;
  category_name: string;
  category_slug: string;
  city_name: string;
  city_slug: string;
}

/** Negocios del dueño (incluye no publicados) — lectura con contexto RLS. */
export async function listMyBusinesses(userId: string): Promise<MyBusinessRow[]> {
  return withUserContext(userId, 'owner', (tx) =>
    tx
      .select({
        id: businesses.id,
        name: businesses.name,
        slug: businesses.slug,
        status: businesses.status,
        contingencyStatus: businesses.contingencyStatus,
        isVerified: businesses.isVerified,
        categoryName: categories.name,
        categorySlug: categories.slug,
        cityName: cities.name,
        citySlug: cities.slug,
      })
      .from(businesses)
      .innerJoin(categories, eq(categories.id, businesses.categoryId))
      .innerJoin(cities, eq(cities.id, businesses.cityId))
      .where(eq(businesses.ownerId, userId))
      .orderBy(desc(businesses.createdAt)),
  ).then((rows) =>
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      contingency_status: r.contingencyStatus,
      is_verified: r.isVerified,
      category_name: r.categoryName,
      category_slug: r.categorySlug,
      city_name: r.cityName,
      city_slug: r.citySlug,
    })),
  );
}

/** Fila completa de un negocio propio (null si no existe o no es del dueño). */
export async function getMyBusiness(userId: string, businessId: string) {
  const rows = await withUserContext(userId, 'owner', (tx) =>
    tx
      .select({
        id: businesses.id,
        name: businesses.name,
        slug: businesses.slug,
        shortDescription: businesses.shortDescription,
        description: businesses.description,
        whatsappPhone: businesses.whatsappPhone,
        phone: businesses.phone,
        address: businesses.address,
        neighborhood: businesses.neighborhood,
        contingencyStatus: businesses.contingencyStatus,
        contingencyNote: businesses.contingencyNote,
        status: businesses.status,
        websiteUrl: businesses.websiteUrl,
        instagramUrl: businesses.instagramUrl,
        facebookUrl: businesses.facebookUrl,
        tiktokUrl: businesses.tiktokUrl,
        isVerified: businesses.isVerified,
        categoryId: businesses.categoryId,
        cityId: businesses.cityId,
        categoryName: categories.name,
        categorySlug: categories.slug,
        cityName: cities.name,
        citySlug: cities.slug,
        lat: sql<number>`ST_Y(${businesses.geom}::geometry)`,
        lon: sql<number>`ST_X(${businesses.geom}::geometry)`,
      })
      .from(businesses)
      .innerJoin(categories, eq(categories.id, businesses.categoryId))
      .innerJoin(cities, eq(cities.id, businesses.cityId))
      .where(eq(businesses.id, businessId))
      .limit(1),
  );
  return rows[0] ?? null;
}

export type MyBusiness = NonNullable<Awaited<ReturnType<typeof getMyBusiness>>>;

/** Centroid de una ciudad (para geolocalizar el negocio si el dueño no da coords). */
export async function getCityCentroid(cityId: number): Promise<{ lat: number; lon: number } | null> {
  const result = await db.execute<{ lat: number; lon: number }>(
    sql`SELECT ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon FROM cities WHERE id = ${cityId}`,
  );
  return result.rows[0] ?? null;
}

// type (no interface): requisito de índice implícito de db.execute<T>
export type CatalogRow = {
  cat_id: string;
  cat_name: string;
  cat_slug: string;
  item_id: string | null;
  item_name: string | null;
  item_description: string | null;
  price: string | null;
  promo_price: string | null;
  promo_ends_at: string | null;
  photo_url: string | null;
  is_available: boolean | null;
};

/** Menú/catálogo de un negocio. onlyAvailable=false para el panel del dueño. */
export async function getBusinessCatalog(businessId: string, onlyAvailable = true): Promise<CatalogRow[]> {
  const result = await db.execute<CatalogRow>(sql`
    SELECT cc.id   AS cat_id,
           cc.name AS cat_name,
           cc.slug AS cat_slug,
           ci.id   AS item_id,
           ci.name AS item_name,
           ci.description AS item_description,
           ci.price,
           ci.promo_price,
           ci.promo_ends_at,
           ci.photo_url,
           ci.is_available
    FROM catalog_categories cc
    LEFT JOIN catalog_items ci
      ON ci.catalog_category_id = cc.id
      ${onlyAvailable ? sql`AND ci.is_available` : sql``}
    WHERE cc.business_id = ${businessId}::uuid
    ORDER BY cc.sort_order, cc.name, ci.sort_order, ci.name
  `);
  return result.rows;
}

/** RPC de analítica — fallback directo a Postgres cuando Redis no responde. */
export async function recordInteraction(businessId: string, type: string) {
  await db.execute(
    sql`SELECT record_interaction(${businessId}::uuid, ${type}::interaction_type)`,
  );
}

/** Flush masivo idempotente desde Redis (job diario). */
export async function flushInteractions(
  events: { business_id: string; day: string; type: string; hits: number }[],
): Promise<number> {
  if (events.length === 0) return 0;
  const result = await db.execute<{ flush_interactions: number }>(
    sql`SELECT flush_interactions(${JSON.stringify(events)}::jsonb)`,
  );
  return Number(result.rows[0]?.flush_interactions ?? 0);
}

/** Mantenimiento diario (purga + reactivaciones). */
export async function runMaintenance() {
  const [purged, reactivated] = await Promise.all([
    db.execute<{ purge_interaction_cache: string }>(sql`SELECT purge_interaction_cache()`),
    db.execute<{ reactivate_expired_suspensions: number }>(sql`SELECT reactivate_expired_suspensions()`),
  ]);
  return {
    purgedRows: Number(purged.rows[0]?.purge_interaction_cache ?? 0),
    reactivated: Number(reactivated.rows[0]?.reactivate_expired_suspensions ?? 0),
  };
}

/** Resumen 30 días para el panel del comerciante. */
export async function businessInsights30d(businessId: string) {
  const result = await db.execute<{
    vistas_perfil: number; clics_whatsapp: number; llamadas: number;
    aperturas_mapa: number; escaneos_qr: number; tasa_contacto_pct: string | null;
  }>(sql`
    SELECT COALESCE(SUM(hits) FILTER (WHERE interaction_type = 'profile_view'), 0)   AS vistas_perfil,
           COALESCE(SUM(hits) FILTER (WHERE interaction_type = 'whatsapp_click'), 0) AS clics_whatsapp,
           COALESCE(SUM(hits) FILTER (WHERE interaction_type = 'phone_call'), 0)     AS llamadas,
           COALESCE(SUM(hits) FILTER (WHERE interaction_type = 'map_open'), 0)       AS aperturas_mapa,
           COALESCE(SUM(hits) FILTER (WHERE interaction_type = 'qr_scan'), 0)        AS escaneos_qr,
           ROUND(100.0 * SUM(hits) FILTER (WHERE interaction_type = 'whatsapp_click')
                 / NULLIF(SUM(hits) FILTER (WHERE interaction_type = 'profile_view'), 0), 1) AS tasa_contacto_pct
    FROM business_interaction_cache
    WHERE business_id = ${businessId}::uuid
      AND day >= current_date - 30
  `);
  return result.rows[0] ?? null;
}

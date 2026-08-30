-- =============================================================================
-- eneleje.com · Consultas geográficas optimizadas (PostGIS)
-- ⚠ Convención PostGIS: ST_MakePoint(LONGITUD, LATITUD) — nunca al revés.
-- Índices usados:
--   idx_businesses_geom             GiST(geom)              -> ST_DWithin + KNN (<->)
--   idx_businesses_cat_city_published B-Tree(category,city) -> filtro selectivo
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) HOT PATH — Listado de una categoría en una ciudad ordenado por distancia
--    al punto del usuario. El operador KNN `<->` sobre geography recorre el
--    índice GiST ya ordenado por proximidad; ST_DWithin descarta lo que queda
--    fuera del radio. ST_Distance SOLO se calcula para pintar "a 1.2 km".
--    Parámetros: :category, :city, :lon, :lat, :radius_m, :limit, :offset
-- -----------------------------------------------------------------------------
SELECT
    b.id,
    b.name,
    b.slug,
    b.short_description,
    b.whatsapp_phone,
    b.contingency_status,
    b.contingency_note,
    b.is_verified,
    b.logo_url,
    ST_Y(b.geom::geometry)                              AS lat,
    ST_X(b.geom::geometry)                              AS lon,
    ST_Distance(b.geom, :point::geography)              AS distance_m,   -- :point = ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)
    ST_Distance(b.geom, :point::geography) / 1000.0     AS distance_km
FROM businesses b
JOIN categories c ON c.id = b.category_id
JOIN cities ci    ON ci.id = b.city_id
WHERE c.slug = :category
  AND ci.slug = :city
  AND b.status = 'published'
  AND b.deleted_at IS NULL
  AND ST_DWithin(b.geom, :point::geography, :radius_m)      -- filtro por radio (usa GiST)
ORDER BY b.geom <-> :point::geography                        -- KNN: orden por proximidad (usa GiST)
LIMIT :limit OFFSET :offset;

-- Variante equivalente lista para probar con psql (Pereira centro, 3 km):
-- SELECT b.name, round(ST_Distance(b.geom, ST_SetSRID(ST_MakePoint(-75.6961, 4.8133), 4326)::geography)) AS m
-- FROM businesses b JOIN categories c ON c.id = b.category_id
-- WHERE c.slug = 'panaderias' AND b.status = 'published' AND b.deleted_at IS NULL
--   AND ST_DWithin(b.geom, ST_SetSRID(ST_MakePoint(-75.6961, 4.8133), 4326)::geography, 3000)
-- ORDER BY b.geom <-> ST_SetSRID(ST_MakePoint(-75.6961, 4.8133), 4326)::geography;

-- -----------------------------------------------------------------------------
-- 2) "CERCA DE MÍ" — sin ciudad (usuario móvil con GPS). Radio configurable.
-- -----------------------------------------------------------------------------
SELECT
    b.id, b.name, b.slug, c.slug AS category_slug, ci.slug AS city_slug,
    b.whatsapp_phone, b.contingency_status, b.logo_url,
    ST_Y(b.geom::geometry) AS lat, ST_X(b.geom::geometry) AS lon,
    ST_Distance(b.geom, :point::geography) AS distance_m
FROM businesses b
JOIN categories c ON c.id  = b.category_id
JOIN cities ci    ON ci.id = b.city_id
WHERE b.status = 'published'
  AND b.deleted_at IS NULL
  AND ST_DWithin(b.geom, :point::geography, :radius_m)   -- 500..25000 según zoom del mapa
ORDER BY b.geom <-> :point::geography
LIMIT :limit;

-- -----------------------------------------------------------------------------
-- 3) Sin ubicación (SEO / primera carga): verificados y recientes primero
-- -----------------------------------------------------------------------------
SELECT b.id, b.name, b.slug, b.short_description, b.logo_url, b.is_verified,
       b.contingency_status, b.published_at
FROM businesses b
JOIN categories c ON c.id = b.category_id
JOIN cities ci    ON ci.id = b.city_id
WHERE c.slug = :category
  AND ci.slug = :city
  AND b.status = 'published'
  AND b.deleted_at IS NULL
ORDER BY b.is_verified DESC, b.published_at DESC
LIMIT :limit;

-- -----------------------------------------------------------------------------
-- 4) Perfil de negocio (URL canónica: {cat}.eneleje.com/{ciudad}/{slug})
-- -----------------------------------------------------------------------------
SELECT
    b.*, c.slug AS category_slug, c.name AS category_name,
    ci.slug AS city_slug, ci.name AS city_name,
    ST_Y(b.geom::geometry) AS lat, ST_X(b.geom::geometry) AS lon
FROM businesses b
JOIN categories c ON c.id  = b.category_id
JOIN cities ci    ON ci.id = b.city_id
WHERE c.slug  = :category
  AND ci.slug = :city
  AND b.slug  = :business_slug
  AND b.status = 'published'
  AND b.deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 5) Landing de categoría: ciudades con negocios disponibles (chips de ciudad)
--    (se sirve con ISR/cache; corre pocas veces por minuto como máximo)
-- -----------------------------------------------------------------------------
SELECT ci.slug, ci.name, count(b.id) AS business_count,
       count(*) FILTER (WHERE b.contingency_status IN ('delivery_only','collection_center')) AS contingencia
FROM businesses b
JOIN categories c ON c.id  = b.category_id
JOIN cities ci    ON ci.id = b.city_id
WHERE c.slug = :category
  AND b.status = 'published'
  AND b.deleted_at IS NULL
GROUP BY ci.slug, ci.name, ci.population
ORDER BY business_count DESC, ci.population DESC NULLS LAST;

-- -----------------------------------------------------------------------------
-- 6) Resolución de ciudad por slug (centrado del mapa: centroid + fitBounds)
-- -----------------------------------------------------------------------------
SELECT id, slug, name, department,
       ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon,
       bbox
FROM cities
WHERE slug = :city AND is_active;

-- -----------------------------------------------------------------------------
-- 7) Home del subdominio: resumen de la categoría (negocios, contingencia, mapa)
-- -----------------------------------------------------------------------------
SELECT
    count(*)                                                     AS total_publicados,
    count(*) FILTER (WHERE contingency_status = 'closed_damage') AS cerrados_por_danos,
    count(*) FILTER (WHERE contingency_status = 'delivery_only') AS solo_domicilio,
    count(*) FILTER (WHERE contingency_status = 'collection_center') AS centros_acopio,
    count(*) FILTER (WHERE created_at >= now() - interval '24 hours') AS nuevos_hoy
FROM businesses b
JOIN categories c ON c.id = b.category_id
WHERE c.slug = :category
  AND b.status = 'published'
  AND b.deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 8) Verificación de EXPLAIN: el plan debe mostrar
--    "Index Scan using idx_businesses_geom" con "Order By (geom ~> ...)"/distance
--    o "Bitmap Index Scan" + sort pequeño para los listados por ciudad.
-- EXPLAIN (ANALYZE, BUFFERS) <cualquiera de las queries 1..2>;

-- =============================================================================
-- eneleje.com · 003 — Funciones auxiliares y triggers
-- Depende de: 002_schema.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- updated_at automático (genérico)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------
-- slugify: 'Panadería La Espiga Ñoña' -> 'panaderia-la-espiga-nonona'
-- STABLE (unaccent depende del diccionario); no se usa en expresiones indexadas.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION slugify(raw text) RETURNS text
LANGUAGE sql STABLE STRICT PARALLEL SAFE AS $$
    SELECT trim(
        regexp_replace(
            regexp_replace(lower(unaccent(raw)), '[^a-z0-9]+', '-', 'g'),
            '^-+|-+$', '', 'g')
    );
$$;

-- -----------------------------------------------------------------------------
-- businesses: slug automático único por ciudad + updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION businesses_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_base      text;
    v_candidate text;
    v_suffix    int := 0;
BEGIN
    IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
        v_base := left(slugify(NEW.name), 120);
        IF v_base IS NULL OR v_base = '' THEN
            v_base := 'negocio';
        END IF;
        v_candidate := v_base;
        WHILE EXISTS (
            SELECT 1 FROM businesses b
            WHERE b.city_id = NEW.city_id AND b.slug = v_candidate AND b.id <> NEW.id
        ) LOOP
            v_suffix    := v_suffix + 1;
            v_candidate := v_base || '-' || v_suffix::text;
        END LOOP;
        NEW.slug := v_candidate;
    ELSE
        NEW.slug := slugify(NEW.slug);
        IF NEW.slug = '' THEN
            RAISE EXCEPTION 'Slug invalido para el negocio "%"', NEW.name;
        END IF;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE TRIGGER trg_businesses_before_write
    BEFORE INSERT OR UPDATE ON businesses
    FOR EACH ROW EXECUTE FUNCTION businesses_before_write();

-- updated_at genérico para el resto de tablas con la columna
CREATE TRIGGER trg_users_updated        BEFORE UPDATE ON users                FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_categories_updated   BEFORE UPDATE ON categories           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_cities_updated       BEFORE UPDATE ON cities               FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tiers_updated        BEFORE UPDATE ON subscription_tiers   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_catalog_cat_updated  BEFORE UPDATE ON catalog_categories   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_catalog_item_updated BEFORE UPDATE ON catalog_items        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_interactions_updated BEFORE UPDATE ON business_interaction_cache FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_settings_updated     BEFORE UPDATE ON system_settings      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Lectura tipada de system_settings (fallback si la clave no existe)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_setting_int(p_key text, p_default int) RETURNS int
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v jsonb;
BEGIN
    SELECT value INTO v FROM system_settings WHERE key = p_key;
    IF v IS NULL THEN
        RETURN p_default;
    END IF;
    RETURN (v #>> '{}')::int;
EXCEPTION WHEN others THEN
    RETURN p_default;
END $$;

-- -----------------------------------------------------------------------------
-- Moderación: umbral de reportes -> alerta o auto-suspensión temporal
-- Se ejecuta tras cada INSERT en business_reports. Cuenta REPORTANTES DISTINTOS
-- (usuario o IP hasheada) en una ventana móvil configurable.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_report_thresholds() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_alert         int;
    v_suspend       int;
    v_window_days   int;
    v_suspend_hours int;
    v_reporters     int;
BEGIN
    SELECT get_setting_int('report_alert_threshold',   3),
           get_setting_int('report_suspend_threshold', 5),
           get_setting_int('report_window_days',       7),
           get_setting_int('suspension_hours',        72)
    INTO v_alert, v_suspend, v_window_days, v_suspend_hours;

    SELECT count(DISTINCT coalesce(reporter_id::text, reporter_ip_hash, reporter_fingerprint, id::text))
    INTO v_reporters
    FROM business_reports
    WHERE business_id = NEW.business_id
      AND status IN ('pending', 'under_review', 'validated')
      AND created_at >= now() - make_interval(days => v_window_days);

    IF v_reporters >= v_suspend THEN
        UPDATE businesses
           SET status           = 'suspended',
               suspended_until  = now() + make_interval(hours => v_suspend_hours),
               suspension_reason = format('Auto-suspendido: %s reportes comunitarios en %s dias.',
                                         v_reporters, v_window_days)
         WHERE id = NEW.business_id
           AND status = 'published';
    ELSIF v_reporters >= v_alert THEN
        UPDATE businesses
           SET flagged_at = now()
         WHERE id = NEW.business_id
           AND flagged_at IS NULL
           AND status = 'published';
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER trg_reports_thresholds
    AFTER INSERT ON business_reports
    FOR EACH ROW EXECUTE FUNCTION apply_report_thresholds();

-- -----------------------------------------------------------------------------
-- Interacciones: RPC de escritura directa (fallback cuando Redis no está
-- disponible) y flush masivo idempotente desde Redis (job diario).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_interaction(p_business_id uuid, p_type interaction_type)
RETURNS void
LANGUAGE sql AS $$
    INSERT INTO business_interaction_cache AS bic (business_id, day, interaction_type, hits)
    VALUES (p_business_id, current_date, p_type, 1)
    ON CONFLICT (business_id, day, interaction_type)
    DO UPDATE SET hits = bic.hits + 1, updated_at = now();
$$;

-- p_events: '[{"business_id":"...","day":"2026-08-29","type":"whatsapp_click","hits":42}, ...]'
-- Idempotente ante reintento: suma los hits del payload (el job borra las llaves
-- de Redis ya volcadas; un reintento duplicado solo re-sumaría lo ya borrado).
CREATE OR REPLACE FUNCTION flush_interactions(p_events jsonb) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
    v_count int;
BEGIN
    WITH payload AS (
        SELECT (e ->> 'business_id')::uuid            AS business_id,
               (e ->> 'day')::date                    AS day,
               (e ->> 'type')::interaction_type       AS interaction_type,
               COALESCE((e ->> 'hits')::bigint, 1)    AS hits
        FROM jsonb_array_elements(p_events) AS e
    ),
    upserted AS (
        INSERT INTO business_interaction_cache AS bic (business_id, day, interaction_type, hits)
        SELECT business_id, day, interaction_type, hits
        FROM payload
        ON CONFLICT (business_id, day, interaction_type)
        DO UPDATE SET hits = bic.hits + excluded.hits, updated_at = now()
        RETURNING 1
    )
    SELECT count(*) INTO v_count FROM upserted;

    RETURN v_count;
END $$;

-- -----------------------------------------------------------------------------
-- Mantenimiento programado (job diario 03:15 — ver src/lib/analytics.ts)
-- -----------------------------------------------------------------------------

-- Purga de analítica: retención configurable (default 90 días). BRIN(day) la hace barata.
CREATE OR REPLACE FUNCTION purge_interaction_cache(p_retention_days int DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
    v_days    int;
    v_deleted bigint;
BEGIN
    v_days := coalesce(p_retention_days, get_setting_int('interaction_retention_days', 90));
    DELETE FROM business_interaction_cache WHERE day < current_date - v_days;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END $$;

-- Reactiva negocios cuya suspensión temporal venció (moderación comunitaria)
CREATE OR REPLACE FUNCTION reactivate_expired_suspensions() RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
    v_count int;
BEGIN
    UPDATE businesses
       SET status            = 'published',
           suspended_until   = NULL,
           suspension_reason = NULL,
           flagged_at        = NULL
     WHERE status = 'suspended'
       AND suspended_until IS NOT NULL
       AND suspended_until <= now();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END $$;

-- Limpieza de tokens de auth vencidos/consumidos (+30 días)
CREATE OR REPLACE FUNCTION purge_auth_tokens() RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
    v_deleted bigint;
BEGIN
    DELETE FROM auth_tokens
     WHERE (used_at IS NOT NULL AND used_at < now() - interval '30 days')
        OR (expires_at < now() - interval '30 days');
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END $$;

-- -----------------------------------------------------------------------------
-- Búsqueda principal: categoría + ciudad + texto + "cerca de mí"
-- Devuelve página + total (count(*) OVER () evita una segunda query de COUNT).
-- Cuando hay ubicación, el orden es por distancia (los resultados ya vienen del
-- índice GiST vía ST_DWithin). Sin ubicación: verificados primero, luego recientes.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_businesses(
    p_category_slug text            DEFAULT NULL,
    p_city_slug     text            DEFAULT NULL,
    p_q             text            DEFAULT NULL,
    p_lat           double precision DEFAULT NULL,
    p_lon           double precision DEFAULT NULL,
    p_radius_m      int             DEFAULT 5000,
    p_limit         int             DEFAULT 24,
    p_offset        int             DEFAULT 0
)
RETURNS TABLE (
    id                  uuid,
    name                varchar,
    slug                varchar,
    category_slug       varchar,
    city_slug           varchar,
    city_name           varchar,
    short_description   varchar,
    whatsapp_phone      varchar,
    contingency_status  contingency_status,
    is_verified         boolean,
    logo_url            varchar,
    lat                 double precision,
    lon                 double precision,
    distance_m          double precision,
    total               bigint
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    WITH filtered AS (
        SELECT b.*,
               c.slug  AS c_slug,
               ci.slug AS ci_slug,
               ci.name AS ci_name,
               ST_Y(b.geom::geometry) AS b_lat,
               ST_X(b.geom::geometry) AS b_lon,
               CASE
                   WHEN p_lat IS NOT NULL AND p_lon IS NOT NULL THEN
                       ST_Distance(b.geom, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography)
               END AS b_dist
        FROM businesses b
        JOIN categories c  ON c.id  = b.category_id
        JOIN cities     ci ON ci.id = b.city_id
        WHERE b.status = 'published'
          AND b.deleted_at IS NULL
          AND (p_category_slug IS NULL OR c.slug = p_category_slug)
          AND (p_city_slug     IS NULL OR ci.slug = p_city_slug)
          AND (p_q IS NULL OR b.name ILIKE '%' || p_q || '%'
                           OR coalesce(b.short_description, '') ILIKE '%' || p_q || '%')
          AND (p_lat IS NULL OR p_lon IS NULL OR
               ST_DWithin(b.geom, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography, p_radius_m))
    )
    SELECT f.id, f.name, f.slug, f.c_slug, f.ci_slug, f.ci_name,
           f.short_description, f.whatsapp_phone, f.contingency_status,
           f.is_verified, f.logo_url, f.b_lat, f.b_lon, f.b_dist,
           count(*) OVER ()
    FROM filtered f
    ORDER BY f.b_dist ASC NULLS LAST,
             f.is_verified DESC,
             f.published_at DESC
    LIMIT least(p_limit, 100)
    OFFSET greatest(p_offset, 0);
END $$;

-- Comentario sobre privileges: EXECUTE se concede a eneleje_app en 004_rls_policies.sql

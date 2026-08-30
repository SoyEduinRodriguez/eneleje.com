-- =============================================================================
-- eneleje.com · DDL COMPLETO TODO-EN-UNO (pgAdmin Query Tool)
-- -----------------------------------------------------------------------------
-- Requisitos en el servidor Ubuntu: PostgreSQL 14+ (ideal 16) + PostGIS 3:
--     sudo apt install postgresql-16-postgis-3      # ajusta "16" a tu versión
-- Cómo ejecutar: pgAdmin → conecta al servidor → clic derecho a la BD "eneleje"
--   → Query Tool (conectado como superusuario postgres) → pega TODO → F5.
-- Idempotente: se puede re-ejecutar sin romper nada.
-- Contraseñas: reemplaza 'CAMBIA_ESTA_CLAVE_APP' y 'CAMBIA_ESTA_CLAVE_MIGRATOR'
--   aquí y en tu .env (DATABASE_URL usa la de eneleje_app).
-- =============================================================================

-- ───────────────────────── 0 · PRE-VUELO DE EXTENSIONES ─────────────────────
DO $preflight$
DECLARE
    v_faltan text;
BEGIN
    SELECT string_agg(name, ', ') INTO v_faltan
    FROM unnest(ARRAY['postgis', 'pgcrypto', 'citext', 'unaccent', 'pg_trgm']) AS name
    WHERE NOT EXISTS (SELECT 1 FROM pg_available_extensions a WHERE a.name = name);
    IF v_faltan IS NOT NULL THEN
        RAISE EXCEPTION
            'Faltan extensiones en el servidor: %. Instala PostGIS: sudo apt install postgresql-16-postgis-3',
            v_faltan;
    END IF;
END
$preflight$;

CREATE EXTENSION IF NOT EXISTS postgis;   -- geography, ST_Distance, ST_DWithin, KNN
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_bytes, digest, hmac (hash de IPs)
CREATE EXTENSION IF NOT EXISTS citext;    -- email case-insensitive
CREATE EXTENSION IF NOT EXISTS unaccent;  -- slugify (tildes/ñ)
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- búsqueda difusa por nombre

-- ───────────────────────── 1 · ROLES DE APLICACIÓN ──────────────────────────
DO $roles$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eneleje_app') THEN
        CREATE ROLE eneleje_app LOGIN PASSWORD 'CAMBIA_ESTA_CLAVE_APP';
    ELSE
        ALTER ROLE eneleje_app WITH LOGIN PASSWORD 'CAMBIA_ESTA_CLAVE_APP';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eneleje_migrator') THEN
        CREATE ROLE eneleje_migrator LOGIN PASSWORD 'CAMBIA_ESTA_CLAVE_MIGRATOR';
    ELSE
        ALTER ROLE eneleje_migrator WITH LOGIN PASSWORD 'CAMBIA_ESTA_CLAVE_MIGRATOR';
    END IF;
END
$roles$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;  -- endurece el esquema

-- (SOLO si un intento anterior quedó a medias: descomenta para empezar limpio)
-- DROP TABLE IF EXISTS business_interaction_cache, business_reports,
--   catalog_items, catalog_categories, auth_tokens, businesses,
--   subscription_tiers, cities, categories, users, roles, system_settings CASCADE;

-- ───────────────────────── 2 · ENUMS Y DOMINIOS ─────────────────────────────
DO $types$ BEGIN
    CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $types$;

DO $types$ BEGIN
    CREATE TYPE business_status AS ENUM ('published', 'suspended', 'blocked', 'closed_by_owner');
EXCEPTION WHEN duplicate_object THEN NULL; END $types$;

DO $types$ BEGIN
    CREATE TYPE contingency_status AS ENUM ('normal', 'delivery_only', 'closed_damage', 'collection_center', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $types$;

DO $types$ BEGIN
    CREATE TYPE report_reason AS ENUM ('spam', 'false_data', 'closed_business', 'inappropriate_content', 'duplicate', 'wrong_location', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $types$;

DO $types$ BEGIN
    CREATE TYPE report_status AS ENUM ('pending', 'under_review', 'validated', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $types$;

DO $types$ BEGIN
    CREATE TYPE interaction_type AS ENUM ('profile_view', 'whatsapp_click', 'phone_call', 'map_open', 'qr_scan', 'share', 'catalog_view', 'route_click');
EXCEPTION WHEN duplicate_object THEN NULL; END $types$;

DO $types$ BEGIN
    CREATE TYPE auth_token_purpose AS ENUM ('email_verification', 'password_reset');
EXCEPTION WHEN duplicate_object THEN NULL; END $types$;

DO $types$ BEGIN
    CREATE DOMAIN slug AS varchar(64) CONSTRAINT slug_format CHECK (VALUE ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
EXCEPTION WHEN duplicate_object THEN NULL; END $types$;

DO $types$ BEGIN
    CREATE DOMAIN phone_e164 AS varchar(20) CONSTRAINT phone_format CHECK (VALUE ~ '^\+[1-9][0-9]{6,14}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $types$;

-- ───────────────────────── 3 · TABLAS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
    id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug        varchar(30)  NOT NULL UNIQUE,
    name        varchar(60)  NOT NULL,
    description varchar(200),
    level       smallint     NOT NULL DEFAULT 0,
    created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id           smallint     NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    email             citext       NOT NULL UNIQUE,
    password_hash     text,                              -- argon2id/bcrypt desde la app
    display_name      varchar(120) NOT NULL,
    phone             varchar(20),
    email_verified_at timestamptz,
    status            user_status  NOT NULL DEFAULT 'active',
    last_login_at     timestamptz,
    created_at        timestamptz  NOT NULL DEFAULT now(),
    updated_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
    id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug        varchar(64)  NOT NULL UNIQUE,   -- slug == subdominio
    name        varchar(80)  NOT NULL,
    description varchar(300),
    icon        varchar(60),
    emoji       varchar(8),
    sort_order  smallint     NOT NULL DEFAULT 100,
    is_active   boolean      NOT NULL DEFAULT true,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT categories_not_reserved CHECK (
        slug NOT IN ('www','app','admin','api','auth','cdn','static','assets','img',
                     'mail','blog','docs','status','help','panel','dashboard','mod',
                     'dev','staging','test')
    )
);

CREATE TABLE IF NOT EXISTS cities (
    id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug        slug            NOT NULL UNIQUE,
    name        varchar(120)    NOT NULL,
    department  varchar(120),
    geom        geography(Point, 4326) NOT NULL,
    bbox        double precision[4],
    population  integer,
    is_active   boolean         NOT NULL DEFAULT true,
    created_at  timestamptz     NOT NULL DEFAULT now(),
    updated_at  timestamptz     NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_tiers (
    id                smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug              varchar(30)  NOT NULL UNIQUE,
    name              varchar(60)  NOT NULL,
    description       varchar(300),
    price_cents       integer      NOT NULL DEFAULT 0,
    currency          char(3)      NOT NULL DEFAULT 'COP',
    max_photos        integer,                     -- NULL = ilimitado
    max_catalog_items integer,
    ads_free          boolean      NOT NULL DEFAULT false,
    has_badge         boolean      NOT NULL DEFAULT false,
    features          jsonb        NOT NULL DEFAULT '[]'::jsonb,
    is_active         boolean      NOT NULL DEFAULT true,
    sort_order        smallint     NOT NULL DEFAULT 100,
    created_at        timestamptz  NOT NULL DEFAULT now(),
    updated_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS businesses (
    id                    uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id              uuid                NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    category_id           smallint            NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    city_id               smallint            NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    tier_id               smallint            NOT NULL DEFAULT 1 REFERENCES subscription_tiers(id) ON DELETE RESTRICT,
    name                  varchar(120)        NOT NULL,
    slug                  varchar(140)        NOT NULL,
    short_description     varchar(200),
    description           text,
    whatsapp_phone        phone_e164          NOT NULL,
    phone                 varchar(20),
    address               varchar(240),
    neighborhood          varchar(120),
    geom                  geography(Point, 4326) NOT NULL,
    contingency_status    contingency_status  NOT NULL DEFAULT 'unknown',
    contingency_note      varchar(280),
    contingency_updated_at timestamptz,
    status                business_status     NOT NULL DEFAULT 'published',
    published_at          timestamptz         NOT NULL DEFAULT now(),
    suspended_until       timestamptz,
    suspension_reason     varchar(300),
    flagged_at            timestamptz,
    website_url           varchar(300),
    instagram_url         varchar(300),
    facebook_url          varchar(300),
    tiktok_url            varchar(300),
    logo_url              varchar(400),
    cover_url             varchar(400),
    opening_hours         jsonb,
    qr_token              uuid                NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    is_verified           boolean             NOT NULL DEFAULT false,
    deleted_at            timestamptz,
    created_at            timestamptz         NOT NULL DEFAULT now(),
    updated_at            timestamptz         NOT NULL DEFAULT now(),
    CONSTRAINT businesses_slug_format      CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT businesses_city_slug_unique UNIQUE (city_id, slug)
);

CREATE TABLE IF NOT EXISTS catalog_categories (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name        varchar(80) NOT NULL,
    slug        varchar(90) NOT NULL,
    sort_order  smallint    NOT NULL DEFAULT 100,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT catalog_categories_unique UNIQUE (business_id, slug)
);

CREATE TABLE IF NOT EXISTS catalog_items (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         uuid            NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    catalog_category_id uuid            NOT NULL REFERENCES catalog_categories(id) ON DELETE CASCADE,
    name                varchar(120)    NOT NULL,
    description         varchar(500),
    price               numeric(12,2)   NOT NULL CHECK (price >= 0),
    currency            char(3)         NOT NULL DEFAULT 'COP',
    promo_price         numeric(12,2)   CHECK (promo_price IS NULL OR promo_price >= 0),
    promo_ends_at       timestamptz,
    photo_url           varchar(400),
    is_available        boolean         NOT NULL DEFAULT true,
    sort_order          smallint        NOT NULL DEFAULT 100,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    CONSTRAINT catalog_items_promo_check CHECK (promo_price IS NULL OR promo_price <= price)
);

CREATE TABLE IF NOT EXISTS business_reports (
    id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id          uuid          NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    reporter_id          uuid          REFERENCES users(id) ON DELETE SET NULL,
    reporter_ip_hash     varchar(64),
    reporter_fingerprint varchar(64),
    reason               report_reason NOT NULL,
    details              varchar(1000),
    status               report_status NOT NULL DEFAULT 'pending',
    reviewed_by          uuid          REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at          timestamptz,
    resolution_note      varchar(500),
    created_at           timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_interaction_cache (
    business_id      uuid             NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    day              date             NOT NULL,
    interaction_type interaction_type NOT NULL,
    hits             bigint           NOT NULL DEFAULT 0,
    updated_at       timestamptz      NOT NULL DEFAULT now(),
    PRIMARY KEY (business_id, day, interaction_type)
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    id         uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid               NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    auth_token_purpose NOT NULL,
    token_hash varchar(64)        NOT NULL UNIQUE,
    expires_at timestamptz        NOT NULL,
    used_at    timestamptz,
    created_at timestamptz        NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_settings (
    key         varchar(60)  PRIMARY KEY,
    value       jsonb        NOT NULL,
    description varchar(200),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);

-- ───────────────────────── 4 · ÍNDICES ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role_id);
CREATE INDEX IF NOT EXISTS idx_categories_active ON categories (sort_order) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_cities_geom ON cities USING gist (geom);

CREATE INDEX IF NOT EXISTS idx_businesses_geom ON businesses USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_businesses_cat_city_published
    ON businesses (category_id, city_id) WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_published_recent
    ON businesses (published_at DESC) WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_owner ON businesses (owner_id);
CREATE INDEX IF NOT EXISTS idx_businesses_name_trgm
    ON businesses USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_businesses_suspended
    ON businesses (suspended_until) WHERE status = 'suspended';

CREATE INDEX IF NOT EXISTS idx_catalog_items_listing
    ON catalog_items (business_id, catalog_category_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_reports_open ON business_reports (business_id, created_at DESC)
    WHERE status IN ('pending', 'under_review');
CREATE INDEX IF NOT EXISTS idx_reports_ip ON business_reports (reporter_ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_reviewer ON business_reports (reviewed_by);

CREATE INDEX IF NOT EXISTS idx_interaction_cache_day_brin
    ON business_interaction_cache USING brin (day);
CREATE INDEX IF NOT EXISTS idx_interaction_cache_biz_day
    ON business_interaction_cache (business_id, day DESC);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id, purpose);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires ON auth_tokens (expires_at);

-- ───────────────────────── 5 · FUNCIONES Y TRIGGERS ─────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION slugify(raw text) RETURNS text
LANGUAGE sql STABLE STRICT PARALLEL SAFE AS $$
    SELECT trim(
        regexp_replace(
            regexp_replace(lower(unaccent(raw)), '[^a-z0-9]+', '-', 'g'),
            '^-+|-+$', '', 'g')
    );
$$;

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

DROP TRIGGER IF EXISTS trg_businesses_before_write ON businesses;
CREATE TRIGGER trg_businesses_before_write
    BEFORE INSERT OR UPDATE ON businesses
    FOR EACH ROW EXECUTE FUNCTION businesses_before_write();

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_categories_updated ON categories;
CREATE TRIGGER trg_categories_updated BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_cities_updated ON cities;
CREATE TRIGGER trg_cities_updated BEFORE UPDATE ON cities
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_tiers_updated ON subscription_tiers;
CREATE TRIGGER trg_tiers_updated BEFORE UPDATE ON subscription_tiers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_catalog_cat_updated ON catalog_categories;
CREATE TRIGGER trg_catalog_cat_updated BEFORE UPDATE ON catalog_categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_catalog_item_updated ON catalog_items;
CREATE TRIGGER trg_catalog_item_updated BEFORE UPDATE ON catalog_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_interactions_updated ON business_interaction_cache;
CREATE TRIGGER trg_interactions_updated BEFORE UPDATE ON business_interaction_cache
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_settings_updated ON system_settings;
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON system_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

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
           SET status            = 'suspended',
               suspended_until   = now() + make_interval(hours => v_suspend_hours),
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

DROP TRIGGER IF EXISTS trg_reports_thresholds ON business_reports;
CREATE TRIGGER trg_reports_thresholds
    AFTER INSERT ON business_reports
    FOR EACH ROW EXECUTE FUNCTION apply_report_thresholds();

CREATE OR REPLACE FUNCTION record_interaction(p_business_id uuid, p_type interaction_type)
RETURNS void
LANGUAGE sql AS $$
    INSERT INTO business_interaction_cache AS bic (business_id, day, interaction_type, hits)
    VALUES (p_business_id, current_date, p_type, 1)
    ON CONFLICT (business_id, day, interaction_type)
    DO UPDATE SET hits = bic.hits + 1, updated_at = now();
$$;

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

CREATE OR REPLACE FUNCTION search_businesses(
    p_category_slug text             DEFAULT NULL,
    p_city_slug     text             DEFAULT NULL,
    p_q             text             DEFAULT NULL,
    p_lat           double precision DEFAULT NULL,
    p_lon           double precision DEFAULT NULL,
    p_radius_m      int              DEFAULT 5000,
    p_limit         int              DEFAULT 24,
    p_offset        int              DEFAULT 0
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

-- ───────────────────────── 6 · GRANTS Y RLS ─────────────────────────────────
GRANT USAGE ON SCHEMA public TO eneleje_app, eneleje_migrator;
GRANT CREATE ON SCHEMA public TO eneleje_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eneleje_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO eneleje_migrator;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eneleje_app, eneleje_migrator;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO eneleje_app, eneleje_migrator;

-- Para tablas creadas en el futuro por este mismo rol (postgres):
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eneleje_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL PRIVILEGES ON TABLES TO eneleje_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO eneleje_app, eneleje_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO eneleje_app, eneleje_migrator;

ALTER TABLE users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories               ENABLE ROW LEVEL SECURITY;
ALTER TABLE cities                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_tiers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_reports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_interaction_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_insert ON users;
CREATE POLICY users_insert ON users FOR INSERT TO eneleje_app WITH CHECK (true);

DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users FOR SELECT TO eneleje_app
    USING (
        id = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR current_setting('app.role', true) IN ('moderator', 'superadmin')
    );

DROP POLICY IF EXISTS users_update_self ON users;
CREATE POLICY users_update_self ON users FOR UPDATE TO eneleje_app
    USING      (id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    WITH CHECK (id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS roles_select ON roles;
CREATE POLICY roles_select ON roles FOR SELECT TO eneleje_app USING (true);

DROP POLICY IF EXISTS categories_select ON categories;
CREATE POLICY categories_select ON categories FOR SELECT TO eneleje_app USING (true);

DROP POLICY IF EXISTS categories_moderate ON categories;
CREATE POLICY categories_moderate ON categories FOR ALL TO eneleje_app
    USING      (current_setting('app.role', true) IN ('moderator', 'superadmin'))
    WITH CHECK (current_setting('app.role', true) IN ('moderator', 'superadmin'));

DROP POLICY IF EXISTS cities_select ON cities;
CREATE POLICY cities_select ON cities FOR SELECT TO eneleje_app USING (true);

DROP POLICY IF EXISTS cities_moderate ON cities;
CREATE POLICY cities_moderate ON cities FOR ALL TO eneleje_app
    USING      (current_setting('app.role', true) IN ('moderator', 'superadmin'))
    WITH CHECK (current_setting('app.role', true) IN ('moderator', 'superadmin'));

DROP POLICY IF EXISTS tiers_select ON subscription_tiers;
CREATE POLICY tiers_select ON subscription_tiers FOR SELECT TO eneleje_app USING (true);

DROP POLICY IF EXISTS businesses_public_read ON businesses;
CREATE POLICY businesses_public_read ON businesses FOR SELECT TO eneleje_app
    USING (
        (status = 'published' AND deleted_at IS NULL)
        OR (status = 'suspended' AND suspended_until IS NOT NULL
            AND suspended_until <= now() AND deleted_at IS NULL)
        OR owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR current_setting('app.role', true) IN ('moderator', 'superadmin')
    );

DROP POLICY IF EXISTS businesses_owner_manage ON businesses;
CREATE POLICY businesses_owner_manage ON businesses FOR ALL TO eneleje_app
    USING      (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    WITH CHECK (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS businesses_moderate ON businesses;
CREATE POLICY businesses_moderate ON businesses FOR ALL TO eneleje_app
    USING      (current_setting('app.role', true) IN ('moderator', 'superadmin'))
    WITH CHECK (current_setting('app.role', true) IN ('moderator', 'superadmin'));

DROP POLICY IF EXISTS catalog_cat_public_read ON catalog_categories;
CREATE POLICY catalog_cat_public_read ON catalog_categories FOR SELECT TO eneleje_app
    USING (
        EXISTS (SELECT 1 FROM businesses b
                WHERE b.id = catalog_categories.business_id
                  AND b.status = 'published' AND b.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM businesses b
                   WHERE b.id = catalog_categories.business_id
                     AND b.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
        OR current_setting('app.role', true) IN ('moderator', 'superadmin')
    );

DROP POLICY IF EXISTS catalog_cat_owner_manage ON catalog_categories;
CREATE POLICY catalog_cat_owner_manage ON catalog_categories FOR ALL TO eneleje_app
    USING      (EXISTS (SELECT 1 FROM businesses b
                        WHERE b.id = catalog_categories.business_id
                          AND b.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
    WITH CHECK (EXISTS (SELECT 1 FROM businesses b
                        WHERE b.id = catalog_categories.business_id
                          AND b.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

DROP POLICY IF EXISTS catalog_cat_moderate ON catalog_categories;
CREATE POLICY catalog_cat_moderate ON catalog_categories FOR ALL TO eneleje_app
    USING      (current_setting('app.role', true) IN ('moderator', 'superadmin'))
    WITH CHECK (current_setting('app.role', true) IN ('moderator', 'superadmin'));

DROP POLICY IF EXISTS catalog_item_public_read ON catalog_items;
CREATE POLICY catalog_item_public_read ON catalog_items FOR SELECT TO eneleje_app
    USING (
        EXISTS (SELECT 1 FROM businesses b
                WHERE b.id = catalog_items.business_id
                  AND b.status = 'published' AND b.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM businesses b
                   WHERE b.id = catalog_items.business_id
                     AND b.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
        OR current_setting('app.role', true) IN ('moderator', 'superadmin')
    );

DROP POLICY IF EXISTS catalog_item_owner_manage ON catalog_items;
CREATE POLICY catalog_item_owner_manage ON catalog_items FOR ALL TO eneleje_app
    USING      (EXISTS (SELECT 1 FROM businesses b
                        WHERE b.id = catalog_items.business_id
                          AND b.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
    WITH CHECK (EXISTS (SELECT 1 FROM businesses b
                        WHERE b.id = catalog_items.business_id
                          AND b.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

DROP POLICY IF EXISTS catalog_item_moderate ON catalog_items;
CREATE POLICY catalog_item_moderate ON catalog_items FOR ALL TO eneleje_app
    USING      (current_setting('app.role', true) IN ('moderator', 'superadmin'))
    WITH CHECK (current_setting('app.role', true) IN ('moderator', 'superadmin'));

DROP POLICY IF EXISTS reports_insert ON business_reports;
CREATE POLICY reports_insert ON business_reports FOR INSERT TO eneleje_app
    WITH CHECK (
        reporter_id IS NULL
        OR reporter_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    );

DROP POLICY IF EXISTS reports_select ON business_reports;
CREATE POLICY reports_select ON business_reports FOR SELECT TO eneleje_app
    USING (
        reporter_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR current_setting('app.role', true) IN ('moderator', 'superadmin')
    );

DROP POLICY IF EXISTS reports_moderate ON business_reports;
CREATE POLICY reports_moderate ON business_reports FOR UPDATE TO eneleje_app
    USING      (current_setting('app.role', true) IN ('moderator', 'superadmin'))
    WITH CHECK (current_setting('app.role', true) IN ('moderator', 'superadmin'));

DROP POLICY IF EXISTS interactions_insert ON business_interaction_cache;
CREATE POLICY interactions_insert ON business_interaction_cache
    FOR INSERT TO eneleje_app WITH CHECK (true);

DROP POLICY IF EXISTS interactions_update ON business_interaction_cache;
CREATE POLICY interactions_update ON business_interaction_cache
    FOR UPDATE TO eneleje_app USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS interactions_purge ON business_interaction_cache;
CREATE POLICY interactions_purge ON business_interaction_cache
    FOR DELETE TO eneleje_app USING (true);

DROP POLICY IF EXISTS interactions_select ON business_interaction_cache;
CREATE POLICY interactions_select ON business_interaction_cache FOR SELECT TO eneleje_app
    USING (
        EXISTS (SELECT 1 FROM businesses b
                WHERE b.id = business_interaction_cache.business_id
                  AND b.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
        OR current_setting('app.role', true) IN ('moderator', 'superadmin')
    );

-- Sin RLS: system_settings (solo umbrales, la leen los triggers) y auth_tokens
-- (el token se guarda solo como sha256; ver docs/ARQUITECTURA.md).

-- ───────────────────────── 7 · SEED DE PRODUCCIÓN ───────────────────────────
INSERT INTO roles (slug, name, description, level) VALUES
    ('superadmin', 'Super Administrador', 'Control total: categorias, ciudades, usuarios, tiers.', 100),
    ('moderator',  'Moderador',           'Revisa reportes, suspende/verifica negocios.', 50),
    ('owner',      'Dueño de Comercio',   'Gestiona su perfil, catalogo y ve sus metricas.', 10)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO subscription_tiers
    (slug, name, description, price_cents, currency, max_photos, max_catalog_items,
     ads_free, has_badge, features, sort_order)
VALUES
    ('free', 'Gratuito',
     'Publicación inmediata con perfil completo, botón de WhatsApp y código QR.',
     0, 'COP', 10, 50, false, false,
     '["Perfil georreferenciado","Botón de WhatsApp Business","Código QR del local","Catálogo de hasta 50 items","Estado de contingencia"]'::jsonb,
     10),
    ('premium', 'Premium',
     'Fotos ilimitadas, cero anuncios, insignia verificada y métricas avanzadas.',
     19900, 'COP', NULL, NULL, true, true,
     '["Fotos ilimitadas","Cero anuncios","Insignia de verificado","Métricas avanzadas y sugerencias","Promociones destacadas"]'::jsonb,
     20)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, description, emoji, icon, sort_order) VALUES
    ('panaderias',      'Panaderías',        'Pan fresco, repostería y panes artesanales.',            '🥖', 'croissant',      10),
    ('ferreterias',     'Ferreterías',       'Materiales, herramientas y reparaciones del hogar.',     '🔧', 'wrench',         20),
    ('comidas-rapidas', 'Comidas Rápidas',   'Hamburguesas, pizza, perros calientes y a domicilio.',   '🍔', 'sandwich',       30),
    ('restaurantes',    'Restaurantes',      'Menú del día, asados y cocina local.',                   '🍽️', 'utensils',       40),
    ('supermercados',   'Supermercados',     'Mercado, aseo y despensa a domicilio.',                  '🛒', 'shopping-cart',  50),
    ('farmacias',       'Farmacias',         'Medicamentos y fórmulas con entrega urgente.',           '💊', 'pill',           60),
    ('droguerias',      'Droguerías',        'Droguerías de barrio con servicio inmediato.',           '🧪', 'flask-conical',  70),
    ('peluquerias',     'Peluquerías',       'Corte, color y barbería con cita por WhatsApp.',         '✂️', 'scissors',       80),
    ('talleres',        'Talleres',          'Mecánica, llantas y motos: vuelve a rodar.',             '🛠️', 'car',            90),
    ('veterinarias',    'Veterinarias',      'Consulta, vacunas y emergencias para tu mascota.',       '🐾', 'paw-print',     100),
    ('librerias',       'Librerías',         'Útiles escolares, libros e impresiones.',                '📚', 'book-open',     110),
    ('lavanderias',     'Lavanderías',       'Lavado y plano, por kilo y a domicilio.',                '🧺', 'shirt',         120),
    ('otros',           'Otros servicios',   'Negocios cuya categoría específica aún no está en el directorio.', '🧩', 'shapes', 900)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO cities (slug, name, department, geom, bbox, population) VALUES
    ('pereira',             'Pereira',             'Risaralda', ST_SetSRID(ST_MakePoint(-75.6961, 4.8133), 4326)::geography, ARRAY[-75.7450, 4.7560, -75.6350, 4.8350], 483000),
    ('dosquebradas',        'Dosquebradas',        'Risaralda', ST_SetSRID(ST_MakePoint(-75.6783, 4.8383), 4326)::geography, ARRAY[-75.7100, 4.8000, -75.6400, 4.8800], 230000),
    ('santa-rosa-de-cabal', 'Santa Rosa de Cabal', 'Risaralda', ST_SetSRID(ST_MakePoint(-75.6225, 4.8756), 4326)::geography, ARRAY[-75.6600, 4.8400, -75.5900, 4.9100],  77000),
    ('la-virginia',         'La Virginia',         'Risaralda', ST_SetSRID(ST_MakePoint(-75.8742, 4.9036), 4326)::geography, ARRAY[-75.9100, 4.8700, -75.8400, 4.9400],  34000),
    ('marsella',            'Marsella',            'Risaralda', ST_SetSRID(ST_MakePoint(-75.8883, 4.9383), 4326)::geography, ARRAY[-75.9200, 4.9000, -75.8600, 4.9700],  22000),
    ('belen-de-umbria',     'Belén de Umbría',     'Risaralda', ST_SetSRID(ST_MakePoint(-75.8694, 5.2022), 4326)::geography, ARRAY[-75.9000, 5.1700, -75.8400, 5.2300],  27000),
    ('armenia',             'Armenia',             'Quindío',   ST_SetSRID(ST_MakePoint(-75.6811, 4.5339), 4326)::geography, ARRAY[-75.7300, 4.4700, -75.6200, 4.5900], 310000),
    ('calarca',             'Calarcá',             'Quindío',   ST_SetSRID(ST_MakePoint(-75.6486, 4.5336), 4326)::geography, ARRAY[-75.6800, 4.5000, -75.6100, 4.5700],  78000),
    ('circasia',            'Circasia',            'Quindío',   ST_SetSRID(ST_MakePoint(-75.6489, 4.6167), 4326)::geography, ARRAY[-75.6800, 4.5800, -75.6100, 4.6500],  30000),
    ('montenegro',          'Montenegro',          'Quindío',   ST_SetSRID(ST_MakePoint(-75.7506, 4.5452), 4326)::geography, ARRAY[-75.7800, 4.5100, -75.7200, 4.5800],  42000),
    ('manizales',           'Manizales',           'Caldas',    ST_SetSRID(ST_MakePoint(-75.5138, 5.0703), 4326)::geography, ARRAY[-75.5600, 5.0200, -75.4600, 5.1200], 435000),
    ('chinchina',           'Chinchiná',           'Caldas',    ST_SetSRID(ST_MakePoint(-75.6006, 5.0011), 4326)::geography, ARRAY[-75.6300, 4.9700, -75.5700, 5.0300],  40000)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO system_settings (key, value, description) VALUES
    ('report_alert_threshold',          '3',  'Reportantes distintos que disparan la alerta al moderador.'),
    ('report_suspend_threshold',        '5',  'Reportantes distintos que auto-suspenden el negocio.'),
    ('report_window_days',              '7',  'Ventana móvil (dias) para contar reportes.'),
    ('suspension_hours',                '72', 'Duración de la auto-suspensión temporal.'),
    ('interaction_retention_days',      '90', 'Retención de business_interaction_cache antes de purga.'),
    ('registration_max_per_hour_ip',    '3',  'Registros máximos por IP y hora (anti-spam).'),
    ('reports_max_per_day_ip',          '10', 'Reportes máximos por IP y día.'),
    ('tracking_max_per_minute_ip',      '60', 'Eventos de analítica máximos por IP y minuto.')
ON CONFLICT (key) DO NOTHING;

-- ───────────────────────── 8 · DATOS DEMO (solo pruebas) ────────────────────
DO $demo$
DECLARE
    v_role_owner  smallint;
    v_role_mod    smallint;
    v_role_super  smallint;
    v_cat_pana    smallint;
    v_cat_ferre   smallint;
    v_cat_comi    smallint;
    v_city_per    smallint;
    v_city_dos    smallint;
    v_tier_free   smallint;
    v_owner_id    uuid;
    v_mod_id      uuid;
    v_pan_id      uuid;
    v_fer_id      uuid;
    v_comi_id     uuid;
    v_cat_breads  uuid;
BEGIN
    SELECT id INTO v_role_owner FROM roles WHERE slug = 'owner';
    SELECT id INTO v_role_mod   FROM roles WHERE slug = 'moderator';
    SELECT id INTO v_role_super FROM roles WHERE slug = 'superadmin';
    SELECT id INTO v_cat_pana   FROM categories WHERE slug = 'panaderias';
    SELECT id INTO v_cat_ferre  FROM categories WHERE slug = 'ferreterias';
    SELECT id INTO v_cat_comi   FROM categories WHERE slug = 'comidas-rapidas';
    SELECT id INTO v_city_per   FROM cities WHERE slug = 'pereira';
    SELECT id INTO v_city_dos   FROM cities WHERE slug = 'dosquebradas';
    SELECT id INTO v_tier_free  FROM subscription_tiers WHERE slug = 'free';

    IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'dueno@demo.eneleje.com') THEN
        INSERT INTO users (role_id, email, display_name, email_verified_at)
        VALUES (v_role_owner, 'dueno@demo.eneleje.com', 'María Gómez', now())
        RETURNING id INTO v_owner_id;
    ELSE
        SELECT id INTO v_owner_id FROM users WHERE email = 'dueno@demo.eneleje.com';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'moderador@demo.eneleje.com') THEN
        INSERT INTO users (role_id, email, display_name, email_verified_at)
        VALUES (v_role_mod, 'moderador@demo.eneleje.com', 'Camila Moderadora', now())
        RETURNING id INTO v_mod_id;
    ELSE
        SELECT id INTO v_mod_id FROM users WHERE email = 'moderador@demo.eneleje.com';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'super@demo.eneleje.com') THEN
        INSERT INTO users (role_id, email, display_name, email_verified_at)
        VALUES (v_role_super, 'super@demo.eneleje.com', 'Super Admin', now());
    END IF;

    -- Nota: password_hash NULL => no pueden iniciar sesión hasta definir clave.

    IF NOT EXISTS (SELECT 1 FROM businesses WHERE name = 'Panadería La Espiga Dorada') THEN
        INSERT INTO businesses
            (owner_id, category_id, city_id, tier_id, name, short_description, description,
             whatsapp_phone, phone, address, neighborhood,
             geom, contingency_status, contingency_note, contingency_updated_at,
             instagram_url, opening_hours)
        VALUES
            (v_owner_id, v_cat_pana, v_city_per, v_tier_free,
             'Panadería La Espiga Dorada',
             'Pan artesanal y repostería con entrega a domicilio',
             'Horneamos desde 1998. Panes artesanales, pandebono, buñuelos y tortas por encargo.',
             '+573001112233', '+57631234567', 'Carrera 12 # 34-56', 'Centro',
             ST_SetSRID(ST_MakePoint(-75.6903, 4.8156), 4326)::geography,
             'delivery_only', 'Horneamos con gas; entrega por WhatsApp de 7am a 6pm.', now(),
             'https://instagram.com/espigadorada',
             '{"mon":[["06:30","19:00"]],"tue":[["06:30","19:00"]],"wed":[["06:30","19:00"]],"thu":[["06:30","19:00"]],"fri":[["06:30","20:00"]],"sat":[["06:30","20:00"]],"sun":[["07:00","13:00"]]}'::jsonb)
        RETURNING id INTO v_pan_id;

        INSERT INTO catalog_categories (business_id, name, slug, sort_order)
        VALUES (v_pan_id, 'Panes y Salados', 'panes-y-salados', 10)
        RETURNING id INTO v_cat_breads;

        INSERT INTO catalog_categories (business_id, name, slug, sort_order)
        VALUES (v_pan_id, 'Bebidas', 'bebidas', 20);

        INSERT INTO catalog_items
            (business_id, catalog_category_id, name, description, price, promo_price, photo_url, sort_order)
        VALUES
            (v_pan_id, v_cat_breads, 'Pandebono (unidad)', 'Queso y yuca fresco cada mañana.', 1200, NULL, NULL, 10),
            (v_pan_id, v_cat_breads, 'Pan artesanal de trigo', 'Masa madre, 500 g.', 8500, 6900, NULL, 20),
            (v_pan_id, v_cat_breads, 'Torta de encargo', 'Por libra, decorada.', 18000, NULL, NULL, 30),
            (v_pan_id, (SELECT id FROM catalog_categories WHERE business_id = v_pan_id AND slug = 'bebidas'),
             'Chocolate con queso', 'Taza grande.', 4500, NULL, NULL, 10);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM businesses WHERE name = 'Ferretería El Constructor') THEN
        INSERT INTO businesses
            (owner_id, category_id, city_id, tier_id, name, short_description,
             whatsapp_phone, address, neighborhood,
             geom, contingency_status, contingency_updated_at)
        VALUES
            (v_owner_id, v_cat_ferre, v_city_per, v_tier_free,
             'Ferretería El Constructor',
             'Materiales, pinturas y herramientas',
             '+573004445566', 'Avenida Circunvalar # 18-90', 'Alamos',
             ST_SetSRID(ST_MakePoint(-75.6891, 4.8092), 4326)::geography,
             'normal', now())
        RETURNING id INTO v_fer_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM businesses WHERE name = 'Comidas Rápidas Sabor Paisa') THEN
        INSERT INTO businesses
            (owner_id, category_id, city_id, tier_id, name, short_description,
             whatsapp_phone, address, neighborhood,
             geom, contingency_status, contingency_note, contingency_updated_at)
        VALUES
            (v_owner_id, v_cat_comi, v_city_dos, v_tier_free,
             'Comidas Rápidas Sabor Paisa',
             'Hamburguesas y pizza a domicilio',
             '+573007778899', 'Calle 30 # 15-40', 'La Castilla',
             ST_SetSRID(ST_MakePoint(-75.6779, 4.8371), 4326)::geography,
             'delivery_only', 'Solo domicilio mientras reparen el local.', now())
        RETURNING id INTO v_comi_id;
    END IF;

    INSERT INTO business_interaction_cache (business_id, day, interaction_type, hits)
    SELECT b.id, d::date, t.itype, floor(random() * 35 + 5)::bigint
    FROM businesses b
    CROSS JOIN generate_series(current_date - 30, current_date, interval '1 day') AS d
    CROSS JOIN (VALUES ('profile_view'::interaction_type),
                       ('whatsapp_click'), ('map_open'),
                       ('phone_call'), ('qr_scan')) AS t(itype)
    WHERE b.name IN ('Panadería La Espiga Dorada', 'Ferretería El Constructor', 'Comidas Rápidas Sabor Paisa')
    ON CONFLICT (business_id, day, interaction_type) DO NOTHING;

    IF v_fer_id IS NOT NULL AND v_pan_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM business_reports WHERE business_id = v_fer_id) THEN
        INSERT INTO business_reports
            (business_id, reporter_ip_hash, reason, details, status, created_at)
        VALUES
            (v_fer_id, encode(digest('ip-demo-1', 'sha256'), 'hex'), 'wrong_location',
             'El marcador está a una cuadra del local real.', 'pending', now() - interval '2 days'),
            (v_fer_id, encode(digest('ip-demo-2', 'sha256'), 'hex'), 'false_data',
             'El horario publicado no corresponde.', 'pending', now() - interval '1 day');

        INSERT INTO business_reports
            (business_id, reporter_ip_hash, reason, details, status,
             reviewed_by, reviewed_at, resolution_note, created_at)
        VALUES
            (v_pan_id, encode(digest('ip-demo-3', 'sha256'), 'hex'), 'closed_business',
             'Decían que estaba cerrado.', 'dismissed', v_mod_id, now() - interval '3 days',
             'Verificado por WhatsApp: operando a domicilio.', now() - interval '4 days');
    END IF;
END
$demo$;

-- ─────────────────────── 11 · LOGIN BAJO RLS (Fase 2) ───────────────────────
-- users_select no permite a eneleje_app leer el password_hash de otro usuario
-- (correcto), pero el login necesita verificar credenciales ANTES de tener
-- sesión. Esta función SECURITY DEFINER expone solo lo mínimo, por email exacto.
CREATE OR REPLACE FUNCTION app_login_lookup(p_email citext)
RETURNS TABLE (id uuid, password_hash text, display_name varchar,
               role_slug varchar, status user_status)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT u.id, u.password_hash, u.display_name, r.slug, u.status
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.email = p_email
$$;

REVOKE ALL ON FUNCTION app_login_lookup(citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_login_lookup(citext) TO eneleje_app;

-- ──────────────── 12 · RECUPERACIÓN + CATEGORÍAS (Fase 2.5) ─────────────────
-- auth_tokens NO tiene policies para eneleje_app (a propósito): todo el acceso
-- va por funciones SECURITY DEFINER. El reset guarda solo el sha256 del token.

CREATE OR REPLACE FUNCTION app_create_reset_token(p_user uuid, p_token_hash text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
    VALUES (p_user, 'password_reset', p_token_hash, now() + interval '1 hour');
$$;

-- Valida token (hash, vigente, sin usar), actualiza la contraseña y marca usado.
CREATE OR REPLACE FUNCTION app_consume_reset_token(p_token_hash text, p_password_hash text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_token auth_tokens;
BEGIN
    SELECT * INTO v_token FROM auth_tokens
     WHERE token_hash = p_token_hash
       AND purpose = 'password_reset'
       AND used_at IS NULL
       AND expires_at > now();
    IF NOT FOUND THEN RETURN false; END IF;

    UPDATE users SET password_hash = p_password_hash, updated_at = now()
     WHERE id = v_token.user_id;

    UPDATE auth_tokens SET used_at = now() WHERE id = v_token.id;
    RETURN true;
END;
$$;

-- Sugerencias de categorías: las propone los dueños desde el registro de negocio;
-- un moderador/superadmin las convierte en categoría real o las descarta.
CREATE TABLE IF NOT EXISTS category_suggestions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    suggested_name varchar(120) NOT NULL,
    suggested_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    business_id    uuid REFERENCES businesses(id) ON DELETE SET NULL,
    status         text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'created', 'dismissed')),
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION app_suggest_category(p_business uuid, p_name text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    INSERT INTO category_suggestions (suggested_name, business_id)
    VALUES (left(btrim(p_name), 120), p_business);
$$;

CREATE OR REPLACE FUNCTION app_list_pending_suggestions()
RETURNS TABLE (id uuid, suggested_name varchar, business_id uuid,
               business_name varchar, suggested_by text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT s.id, s.suggested_name, s.business_id, b.name, s.suggested_by::text, s.created_at
    FROM category_suggestions s
    LEFT JOIN businesses b ON b.id = s.business_id
    WHERE s.status = 'pending'
    ORDER BY s.created_at;
$$;

CREATE OR REPLACE FUNCTION app_resolve_suggestion(p_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_status NOT IN ('created', 'dismissed') THEN
        RAISE EXCEPTION 'Estado inválido: %', p_status;
    END IF;
    UPDATE category_suggestions SET status = p_status WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION app_create_reset_token(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_consume_reset_token(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_suggest_category(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_list_pending_suggestions() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_resolve_suggestion(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_create_reset_token(uuid, text) TO eneleje_app;
GRANT EXECUTE ON FUNCTION app_consume_reset_token(text, text) TO eneleje_app;
GRANT EXECUTE ON FUNCTION app_suggest_category(uuid, text) TO eneleje_app;
GRANT EXECUTE ON FUNCTION app_list_pending_suggestions() TO eneleje_app;
GRANT EXECUTE ON FUNCTION app_resolve_suggestion(uuid, text) TO eneleje_app;

-- Categoría genérica de caída: negocios cuya categoría específica aún no existe.
-- Los dueños pueden re-categorizar desde el panel cuando se apruebe la suya.
INSERT INTO categories (slug, name, description, emoji, icon, sort_order) VALUES
    ('otros', 'Otros servicios', 'Negocios cuya categoría específica aún no está en el directorio.', '🧩', 'shapes', 900)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- VERIFICACIÓN (ejecuta por separado en el Query Tool):
--   SELECT postgis_full_version();
--   SELECT slug, name FROM categories ORDER BY sort_order;
--   SELECT b.name, round(ST_Distance(b.geom,
--              ST_SetSRID(ST_MakePoint(-75.6961, 4.8133), 4326)::geography)) AS metros
--   FROM businesses b WHERE b.status = 'published' ORDER BY metros;
--   SELECT * FROM search_businesses('panaderias', 'pereira');
--   SELECT * FROM business_interaction_cache ORDER BY day DESC LIMIT 10;
--
-- La app se conecta como eneleje_app (RLS activa). Desde pgAdmin como postgres
-- ves TODO (el owner bypasea RLS) — es el comportamiento esperado.
-- =============================================================================

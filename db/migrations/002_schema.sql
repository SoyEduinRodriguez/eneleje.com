-- =============================================================================
-- eneleje.com · 002 — Esquema relacional (tablas, constraints e índices)
-- Depende de: 001_extensions.sql (enums, dominios)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Roles de plataforma (SuperAdmin / Moderador / Dueño)
-- -----------------------------------------------------------------------------
CREATE TABLE roles (
    id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug        varchar(30)  NOT NULL UNIQUE,
    name        varchar(60)  NOT NULL,
    description varchar(200),
    level       smallint     NOT NULL DEFAULT 0,   -- mayor = más privilegios
    created_at  timestamptz  NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Usuarios de la plataforma (dueños, moderadores, superadmins)
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id           smallint     NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    email             citext       NOT NULL UNIQUE,
    password_hash     text,                              -- argon2id desde la app; NULL = clave aún sin definir
    display_name      varchar(120) NOT NULL,
    phone             varchar(20),
    email_verified_at timestamptz,
    status            user_status  NOT NULL DEFAULT 'active',
    last_login_at     timestamptz,
    created_at        timestamptz  NOT NULL DEFAULT now(),
    updated_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role ON users (role_id);

-- -----------------------------------------------------------------------------
-- Categorías  ⚠ slug == subdominio (panaderias.eneleje.com)
-- -----------------------------------------------------------------------------
CREATE TABLE categories (
    id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug        varchar(64)  NOT NULL UNIQUE,
    name        varchar(80)  NOT NULL,        -- "Panaderías"
    description varchar(300),
    icon        varchar(60),                  -- nombre de icono lucide/react
    emoji       varchar(8),
    sort_order  smallint     NOT NULL DEFAULT 100,
    is_active   boolean      NOT NULL DEFAULT true,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    -- impide crear categorías que choquen con subdominios reservados del middleware
    CONSTRAINT categories_not_reserved CHECK (
        slug NOT IN ('www','app','admin','api','auth','cdn','static','assets','img',
                     'mail','blog','docs','status','help','panel','dashboard','mod',
                     'dev','staging','test')
    )
);

CREATE INDEX idx_categories_active ON categories (sort_order) WHERE is_active;

-- -----------------------------------------------------------------------------
-- Ciudades (segmentación por path: categoria.eneleje.com/{slug_ciudad})
-- -----------------------------------------------------------------------------
CREATE TABLE cities (
    id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug        slug            NOT NULL UNIQUE,
    name        varchar(120)    NOT NULL,
    department  varchar(120),
    geom        geography(Point, 4326) NOT NULL,   -- centroide para centrar el mapa
    bbox        double precision[4],               -- [minLon, minLat, maxLon, maxLat] para fitBounds
    population  integer,
    is_active   boolean         NOT NULL DEFAULT true,
    created_at  timestamptz     NOT NULL DEFAULT now(),
    updated_at  timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX idx_cities_geom ON cities USING gist (geom);

-- -----------------------------------------------------------------------------
-- Tiers de membresía (Free / Premium) — límites declarativos
-- -----------------------------------------------------------------------------
CREATE TABLE subscription_tiers (
    id                smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug              varchar(30)  NOT NULL UNIQUE,
    name              varchar(60)  NOT NULL,
    description       varchar(300),
    price_cents       integer      NOT NULL DEFAULT 0,
    currency          char(3)      NOT NULL DEFAULT 'COP',
    max_photos        integer,                     -- NULL = ilimitadas
    max_catalog_items integer,                     -- NULL = ilimitados
    ads_free          boolean      NOT NULL DEFAULT false,
    has_badge         boolean      NOT NULL DEFAULT false,
    features          jsonb        NOT NULL DEFAULT '[]'::jsonb,
    is_active         boolean      NOT NULL DEFAULT true,
    sort_order        smallint     NOT NULL DEFAULT 100,
    created_at        timestamptz  NOT NULL DEFAULT now(),
    updated_at        timestamptz  NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Negocios  (tabla núcleo: campo espacial geom + estado de contingencia)
-- -----------------------------------------------------------------------------
CREATE TABLE businesses (
    id                    uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id              uuid                NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    category_id           smallint            NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    city_id               smallint            NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    tier_id               smallint            NOT NULL DEFAULT 1 REFERENCES subscription_tiers(id) ON DELETE RESTRICT, -- 1 = Free (seed)
    name                  varchar(120)        NOT NULL,
    slug                  varchar(140)        NOT NULL,             -- autogenerado con trigger si falta
    short_description     varchar(200),
    description           text,
    whatsapp_phone        phone_e164          NOT NULL,             -- botón dinámico wa.me
    phone                 varchar(20),
    address               varchar(240),
    neighborhood          varchar(120),
    geom                  geography(Point, 4326) NOT NULL,          -- ubicación exacta del establecimiento
    -- estado de contingencia post-emergencia
    contingency_status    contingency_status  NOT NULL DEFAULT 'unknown',
    contingency_note      varchar(280),
    contingency_updated_at timestamptz,
    -- ciclo de vida / moderación
    status                business_status     NOT NULL DEFAULT 'published',   -- publicación inmediata
    published_at          timestamptz         NOT NULL DEFAULT now(),
    suspended_until       timestamptz,                       -- ventana de auto-suspensión
    suspension_reason     varchar(300),
    flagged_at            timestamptz,                       -- umbral de alerta alcanzado (cola moderador)
    -- contacto y redes
    website_url           varchar(300),
    instagram_url         varchar(300),
    facebook_url          varchar(300),
    tiktok_url            varchar(300),
    -- medios y horarios
    logo_url              varchar(400),
    cover_url             varchar(400),
    opening_hours         jsonb,                             -- {"mon":[["07:00","19:00"]], ...}
    -- QR del establecimiento: codifica https://eneleje.com/n/{qr_token}
    qr_token              uuid                NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    is_verified           boolean             NOT NULL DEFAULT false,
    -- soft delete
    deleted_at            timestamptz,
    created_at            timestamptz         NOT NULL DEFAULT now(),
    updated_at            timestamptz         NOT NULL DEFAULT now(),

    CONSTRAINT businesses_slug_format      CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT businesses_city_slug_unique UNIQUE (city_id, slug)   -- URL: {cat}.eneleje.com/{ciudad}/{slug}
);

-- Índice espacial GiST: "cerca de mí", ST_DWithin y KNN (<->)
CREATE INDEX idx_businesses_geom ON businesses USING gist (geom);

-- Listado por categoría + ciudad (hot path) — solo lo publicado existe para el público
CREATE INDEX idx_businesses_cat_city_published
    ON businesses (category_id, city_id)
    WHERE status = 'published' AND deleted_at IS NULL;

-- "Recién publicados" en home/landing
CREATE INDEX idx_businesses_published_recent
    ON businesses (published_at DESC)
    WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX idx_businesses_owner ON businesses (owner_id);

-- Búsqueda difusa por nombre (buscador de texto con pg_trgm)
CREATE INDEX idx_businesses_name_trgm ON businesses USING gin (lower(name) gin_trgm_ops);

-- Barrido de suspensiones vencidas por el job de reactivación
CREATE INDEX idx_businesses_suspended ON businesses (suspended_until) WHERE status = 'suspended';

-- -----------------------------------------------------------------------------
-- Catálogo / menú del negocio
-- -----------------------------------------------------------------------------
CREATE TABLE catalog_categories (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name        varchar(80) NOT NULL,
    slug        varchar(90) NOT NULL,
    sort_order  smallint    NOT NULL DEFAULT 100,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT catalog_categories_unique UNIQUE (business_id, slug)
);

CREATE TABLE catalog_items (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         uuid            NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    catalog_category_id uuid            NOT NULL REFERENCES catalog_categories(id) ON DELETE CASCADE,
    name                varchar(120)    NOT NULL,
    description         varchar(500),
    price               numeric(12,2)   NOT NULL CHECK (price >= 0),
    currency            char(3)         NOT NULL DEFAULT 'COP',
    promo_price         numeric(12,2)   CHECK (promo_price IS NULL OR promo_price >= 0),
    promo_ends_at       timestamptz,             -- promociones activas con vencimiento
    photo_url           varchar(400),            -- WebP en R2/S3
    is_available        boolean         NOT NULL DEFAULT true,
    sort_order          smallint        NOT NULL DEFAULT 100,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    CONSTRAINT catalog_items_promo_check CHECK (promo_price IS NULL OR promo_price <= price)
);

CREATE INDEX idx_catalog_items_listing
    ON catalog_items (business_id, catalog_category_id, sort_order);

-- -----------------------------------------------------------------------------
-- Reportes comunitarios (moderación posterior a la publicación)
-- -----------------------------------------------------------------------------
CREATE TABLE business_reports (
    id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id          uuid          NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    reporter_id          uuid          REFERENCES users(id) ON DELETE SET NULL,  -- NULL = reporte anónimo
    reporter_ip_hash     varchar(64),            -- hmac-sha256(ip + PEPPER); nunca la IP cruda
    reporter_fingerprint varchar(64),            -- huella de dispositivo (anti abuso)
    reason               report_reason NOT NULL,
    details              varchar(1000),
    status               report_status NOT NULL DEFAULT 'pending',
    reviewed_by          uuid          REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at          timestamptz,
    resolution_note      varchar(500),
    created_at           timestamptz   NOT NULL DEFAULT now()
);

-- Cola de moderación: reportes abiertos por negocio
CREATE INDEX idx_reports_open ON business_reports (business_id, created_at DESC)
    WHERE status IN ('pending', 'under_review');

-- Anti-abuso: cuántos reportes lanza una misma IP
CREATE INDEX idx_reports_ip ON business_reports (reporter_ip_hash, created_at);

CREATE INDEX idx_reports_reviewer ON business_reports (reviewed_by);

-- -----------------------------------------------------------------------------
-- Analítica ligera: agregado DIARIO por negocio/tipo (no eventos crudos)
-- Escritura en caliente: Redis; flush diario + purga automática (ver 003 y queries/)
-- -----------------------------------------------------------------------------
CREATE TABLE business_interaction_cache (
    business_id      uuid             NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    day              date             NOT NULL,
    interaction_type interaction_type NOT NULL,
    hits             bigint           NOT NULL DEFAULT 0,
    updated_at       timestamptz      NOT NULL DEFAULT now(),
    PRIMARY KEY (business_id, day, interaction_type)
);

-- BRIN: la purga por rango de fechas es secuencial y barata
CREATE INDEX idx_interaction_cache_day_brin
    ON business_interaction_cache USING brin (day);

-- Panel del comerciante: series de 7/30 días por negocio
CREATE INDEX idx_interaction_cache_biz_day
    ON business_interaction_cache (business_id, day DESC);

-- -----------------------------------------------------------------------------
-- Tokens de verificación de email / reset de contraseña (solo sha256 del token)
-- -----------------------------------------------------------------------------
CREATE TABLE auth_tokens (
    id         uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid               NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    auth_token_purpose NOT NULL,
    token_hash varchar(64)        NOT NULL UNIQUE,     -- sha256 hex del token enviado por email
    expires_at timestamptz        NOT NULL,
    used_at    timestamptz,
    created_at timestamptz        NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_tokens_user ON auth_tokens (user_id, purpose);
CREATE INDEX idx_auth_tokens_expires ON auth_tokens (expires_at);   -- barrido de limpieza

-- -----------------------------------------------------------------------------
-- Configuración de plataforma (umbrales de moderación, anti-spam, retención)
-- -----------------------------------------------------------------------------
CREATE TABLE system_settings (
    key         varchar(60)  PRIMARY KEY,
    value       jsonb        NOT NULL,
    description varchar(200),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);

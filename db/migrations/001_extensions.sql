-- =============================================================================
-- eneleje.com · 001 — Extensiones, enums y dominios
-- Aplicar: psql -d eneleje -f 001_extensions.sql   (orden numérico 000..006)
-- =============================================================================

-- Tipos espaciales: geography(Point,4326), ST_Distance, ST_DWithin, KNN (<->)
CREATE EXTENSION IF NOT EXISTS postgis;

-- gen_random_bytes(), digest(), hmac(): hash de IPs de reportes y tokens de auth
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Emails case-insensitive ('Tienda@X.com' == 'tienda@x.com')
CREATE EXTENSION IF NOT EXISTS citext;

-- slugify(): 'Panadería La Espiga' -> 'panaderia-la-espiga'
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Búsqueda difusa por nombre de negocio (ILIKE acelerado por índice GIN trgm)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================================
-- Enums (tipos controlados por BD; en Drizzle se espejan con pgEnum)
-- =============================================================================

CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');

-- Ciclo de vida del negocio. Publicación inmediata => DEFAULT 'published'.
CREATE TYPE business_status AS ENUM (
    'published',        -- visible al público
    'suspended',        -- auto-suspendido por reportes comunitarios (temporal)
    'blocked',          -- bloqueado por moderador (permanente hasta revisión)
    'closed_by_owner'   -- cerrado/eliminado por el dueño
);

-- Estado de contingencia post-emergencia (especificación de negocio)
CREATE TYPE contingency_status AS ENUM (
    'normal',             -- operando normal
    'delivery_only',      -- solo domicilio
    'closed_damage',      -- cerrado por daños
    'collection_center',  -- centro de acopio
    'unknown'             -- sin reportar (default)
);

CREATE TYPE report_reason AS ENUM (
    'spam', 'false_data', 'closed_business', 'inappropriate_content',
    'duplicate', 'wrong_location', 'other'
);

CREATE TYPE report_status AS ENUM ('pending', 'under_review', 'validated', 'dismissed');

-- Interacciones clave que alimenta el panel del comerciante
CREATE TYPE interaction_type AS ENUM (
    'profile_view', 'whatsapp_click', 'phone_call', 'map_open',
    'qr_scan', 'share', 'catalog_view', 'route_click'
);

CREATE TYPE auth_token_purpose AS ENUM ('email_verification', 'password_reset');

-- =============================================================================
-- Dominios (validación declarativa reutilizable)
-- =============================================================================

-- Slugs válidos para subdominios de categoría, ciudades y negocios
CREATE DOMAIN slug AS varchar(64) CONSTRAINT slug_format CHECK (VALUE ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Teléfonos E.164 (+573001234567) para WhatsApp Business y llamadas
CREATE DOMAIN phone_e164 AS varchar(20) CONSTRAINT phone_format CHECK (VALUE ~ '^\+[1-9][0-9]{6,14}$');

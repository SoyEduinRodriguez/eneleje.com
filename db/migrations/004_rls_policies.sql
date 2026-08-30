-- =============================================================================
-- eneleje.com · 004 — Seguridad: grants + Row Level Security
--
-- Modelo: la app SIEMPRE se conecta como `eneleje_app` (sin DDL, sin superusuario).
-- Cada transacción de Server Action ejecuta:
--     SET LOCAL app.user_id = '<uuid del usuario autenticado o NULL>';
--     SET LOCAL app.role    = 'owner' | 'moderator' | 'superadmin';
-- Las policies de abajo convierten esos GUCs en la última barrera de autorización
-- (defensa en profundidad frente a inyección SQL o bugs de authorization en app).
--
-- `eneleje_migrator` es dueño operativo de los datos (bypass de RLS al no ser
-- FORZADA) y solo se usa para correr migraciones y jobs de mantenimiento.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Grants base
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO eneleje_app, eneleje_migrator;
GRANT CREATE ON SCHEMA public TO eneleje_migrator;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eneleje_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO eneleje_migrator;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eneleje_app, eneleje_migrator;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO eneleje_app, eneleje_migrator;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eneleje_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL PRIVILEGES ON TABLES TO eneleje_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO eneleje_app, eneleje_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO eneleje_app, eneleje_migrator;

-- -----------------------------------------------------------------------------
-- Helper: ¿sesión con rol de moderación?
-- (inline en cada policy: RLS no permite funciones STABLE con lectura de tablas
--  sin riesgo de recursión, así que se usa current_setting directamente)
-- -----------------------------------------------------------------------------

-- =============================== users =======================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Auto-registro abierto: cualquiera puede crear cuenta (el anti-spam vive en app/Redis/Turnstile)
CREATE POLICY users_insert ON users FOR INSERT TO eneleje_app WITH CHECK (true);

-- Cada quien se ve a sí mismo; moderación ve todos los perfiles
CREATE POLICY users_select ON users FOR SELECT TO eneleje_app
    USING (
        id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.role', true) IN ('moderator', 'superadmin')
    );

-- Solo el propio usuario se edita; nunca hay DELETE lógico vía BD (status='deleted')
CREATE POLICY users_update_self ON users FOR UPDATE TO eneleje_app
    USING      (id = current_setting('app.user_id', true)::uuid)
    WITH CHECK (id = current_setting('app.user_id', true)::uuid);

-- =============================== roles =======================================
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY roles_select ON roles FOR SELECT TO eneleje_app USING (true);
-- Sin policies de escritura: roles solo se modifican por migraciones/migrator.

-- ============================ categories =====================================
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY categories_select ON categories FOR SELECT TO eneleje_app USING (true);

CREATE POLICY categories_moderate ON categories FOR ALL TO eneleje_app
    USING      (current_setting('app.role', true) IN ('moderator', 'superadmin'))
    WITH CHECK (current_setting('app.role', true) IN ('moderator', 'superadmin'));

-- =============================== cities ======================================
ALTER TABLE cities ENABLE ROW LEVEL SECURITY;

CREATE POLICY cities_select ON cities FOR SELECT TO eneleje_app USING (true);

CREATE POLICY cities_moderate ON cities FOR ALL TO eneleje_app
    USING      (current_setting('app.role', true) IN ('moderator', 'superadmin'))
    WITH CHECK (current_setting('app.role', true) IN ('moderator', 'superadmin'));

-- ========================= subscription_tiers ================================
ALTER TABLE subscription_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY tiers_select ON subscription_tiers FOR SELECT TO eneleje_app USING (true);
-- Escritura solo por migrator (migraciones/cambios de pricing).

-- ============================== businesses ===================================
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

-- Lectura pública: publicados (o suspensión ya vencida aunque el job no haya
-- pasado aún) y no eliminados. El dueño y la moderación ven todo lo suyo.
CREATE POLICY businesses_public_read ON businesses FOR SELECT TO eneleje_app
    USING (
        (status = 'published' AND deleted_at IS NULL)
        OR (status = 'suspended' AND suspended_until IS NOT NULL
            AND suspended_until <= now() AND deleted_at IS NULL)
        OR owner_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.role', true) IN ('moderator', 'superadmin')
    );

-- El dueño gestiona su negocio (perfil, contingencia, soft-delete). La inserción
-- exige que el owner sea el usuario de la sesión => nadie registra a nombre de otro.
CREATE POLICY businesses_owner_manage ON businesses FOR ALL TO eneleje_app
    USING      (owner_id = current_setting('app.user_id', true)::uuid)
    WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

-- Moderación completa
CREATE POLICY businesses_moderate ON businesses FOR ALL TO eneleje_app
    USING      (current_setting('app.role', true) IN ('moderator', 'superadmin'))
    WITH CHECK (current_setting('app.role', true) IN ('moderator', 'superadmin'));

-- ========================== catalog_categories ===============================
ALTER TABLE catalog_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalog_cat_public_read ON catalog_categories FOR SELECT TO eneleje_app
    USING (
        EXISTS (
            SELECT 1 FROM businesses b
            WHERE b.id = catalog_categories.business_id
              AND b.status = 'published'
              AND b.deleted_at IS NULL
        )
        OR EXISTS (
            SELECT 1 FROM businesses b
            WHERE b.id = catalog_categories.business_id
              AND b.owner_id = current_setting('app.user_id', true)::uuid
        )
        OR current_setting('app.role', true) IN ('moderator', 'superadmin')
    );

CREATE POLICY catalog_cat_owner_manage ON catalog_categories FOR ALL TO eneleje_app
    USING      (EXISTS (SELECT 1 FROM businesses b
                        WHERE b.id = catalog_categories.business_id
                          AND b.owner_id = current_setting('app.user_id', true)::uuid))
    WITH CHECK (EXISTS (SELECT 1 FROM businesses b
                        WHERE b.id = catalog_categories.business_id
                          AND b.owner_id = current_setting('app.user_id', true)::uuid));

CREATE POLICY catalog_cat_moderate ON catalog_categories FOR ALL TO eneleje_app
    USING      (current_setting('app.role', true) IN ('moderator', 'superadmin'))
    WITH CHECK (current_setting('app.role', true) IN ('moderator', 'superadmin'));

-- ============================ catalog_items ==================================
ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalog_item_public_read ON catalog_items FOR SELECT TO eneleje_app
    USING (
        EXISTS (
            SELECT 1 FROM businesses b
            WHERE b.id = catalog_items.business_id
              AND b.status = 'published'
              AND b.deleted_at IS NULL
        )
        OR EXISTS (
            SELECT 1 FROM businesses b
            WHERE b.id = catalog_items.business_id
              AND b.owner_id = current_setting('app.user_id', true)::uuid
        )
        OR current_setting('app.role', true) IN ('moderator', 'superadmin')
    );

CREATE POLICY catalog_item_owner_manage ON catalog_items FOR ALL TO eneleje_app
    USING      (EXISTS (SELECT 1 FROM businesses b
                        WHERE b.id = catalog_items.business_id
                          AND b.owner_id = current_setting('app.user_id', true)::uuid))
    WITH CHECK (EXISTS (SELECT 1 FROM businesses b
                        WHERE b.id = catalog_items.business_id
                          AND b.owner_id = current_setting('app.user_id', true)::uuid));

CREATE POLICY catalog_item_moderate ON catalog_items FOR ALL TO eneleje_app
    USING      (current_setting('app.role', true) IN ('moderator', 'superadmin'))
    WITH CHECK (current_setting('app.role', true) IN ('moderator', 'superadmin'));

-- =========================== business_reports ================================
ALTER TABLE business_reports ENABLE ROW LEVEL SECURITY;

-- Cualquiera reporta (anónimo o autenticado); el anti-abuso es rate limiting + hmac(ip)
CREATE POLICY reports_insert ON business_reports FOR INSERT TO eneleje_app
    WITH CHECK (
        reporter_id IS NULL
        OR reporter_id = current_setting('app.user_id', true)::uuid
    );

-- Un reportante ve solo los suyos; la moderación ve todos
CREATE POLICY reports_select ON business_reports FOR SELECT TO eneleje_app
    USING (
        reporter_id = current_setting('app.user_id', true)::uuid
        OR current_setting('app.role', true) IN ('moderator', 'superadmin')
    );

-- Solo la moderación cambia el estado del reporte
CREATE POLICY reports_moderate ON business_reports FOR UPDATE TO eneleje_app
    USING      (current_setting('app.role', true) IN ('moderator', 'superadmin'))
    WITH CHECK (current_setting('app.role', true) IN ('moderator', 'superadmin'));
-- Sin DELETE: los reportes son historial inmutable (auditoría).

-- ======================= business_interaction_cache ==========================
ALTER TABLE business_interaction_cache ENABLE ROW LEVEL SECURITY;

-- Escritura de métricas: la app registra/flushes (valores agregados, no sensibles)
CREATE POLICY interactions_insert ON business_interaction_cache FOR INSERT TO eneleje_app WITH CHECK (true);
CREATE POLICY interactions_update ON business_interaction_cache FOR UPDATE TO eneleje_app USING (true) WITH CHECK (true);
-- El job de purga corre como eneleje_app => necesita DELETE
CREATE POLICY interactions_purge  ON business_interaction_cache FOR DELETE TO eneleje_app USING (true);

-- Lectura: el dueño ve las métricas de SUS negocios; moderación, todas
CREATE POLICY interactions_select ON business_interaction_cache FOR SELECT TO eneleje_app
    USING (
        EXISTS (
            SELECT 1 FROM businesses b
            WHERE b.id = business_interaction_cache.business_id
              AND b.owner_id = current_setting('app.user_id', true)::uuid
        )
        OR current_setting('app.role', true) IN ('moderator', 'superadmin')
    );

-- ============================ system_settings ================================
-- Sin RLS: solo contiene umbrales/configuración operativa (sin PII). Los triggers
-- de moderación la leen en nombre de eneleje_app.
-- ============================== auth_tokens ==================================
-- Sin RLS: la app necesita buscar por token_hash para validar verificación/reset.
-- El token se guarda SOLO como sha256, así que un compromiso de la BD no expone
-- tokens utilizables. Alternativa estricta: mover la validación a una función
-- SECURITY DEFINER que no exponga la tabla.

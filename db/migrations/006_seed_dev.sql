-- =============================================================================
-- eneleje.com · 006 — SOLO DESARROLLO: datos demo
-- Crea usuarios de prueba (SIN contraseña: password_hash NULL => no pueden
-- iniciar sesión hasta definir clave por flujo de recuperación) y 3 negocios
-- con catálogo, métricas de 30 días y reportes para probar la moderación.
-- =============================================================================

DO $$
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

    -- ------------------------------------------------------------------ users
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

    -- ------------------------------------------------------------- businesses
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

        -- ------------------------------------------------------------- catálogo
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

    -- ------------------------------------- métricas demo (últimos 30 días)
    INSERT INTO business_interaction_cache (business_id, day, interaction_type, hits)
    SELECT b.id, d::date, t.itype, floor(random() * 35 + 5)::bigint
    FROM businesses b
    CROSS JOIN generate_series(current_date - 30, current_date, interval '1 day') AS d
    CROSS JOIN (VALUES ('profile_view'::interaction_type),
                       ('whatsapp_click'), ('map_open'),
                       ('phone_call'), ('qr_scan')) AS t(itype)
    WHERE b.name IN ('Panadería La Espiga Dorada', 'Ferretería El Constructor', 'Comidas Rápidas Sabor Paisa')
    ON CONFLICT (business_id, day, interaction_type) DO NOTHING;

    -- ------------------------------------- reportes demo (por debajo del umbral)
    IF v_fer_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM business_reports WHERE business_id = v_fer_id) THEN
        INSERT INTO business_reports
            (business_id, reporter_ip_hash, reason, details, status, created_at)
        VALUES
            (v_fer_id, encode(digest('ip-demo-1', 'sha256'), 'hex'), 'wrong_location',
             'El marcador está a una cuadra del local real.', 'pending', now() - interval '2 days'),
            (v_fer_id, encode(digest('ip-demo-2', 'sha256'), 'hex'), 'false_data',
             'El horario publicado no corresponde.', 'pending', now() - interval '1 day');

        -- un reporte resuelto de ejemplo en la panadería
        INSERT INTO business_reports
            (business_id, reporter_ip_hash, reason, details, status,
             reviewed_by, reviewed_at, resolution_note, created_at)
        VALUES
            (v_pan_id, encode(digest('ip-demo-3', 'sha256'), 'hex'), 'closed_business',
             'Decían que estaba cerrado.', 'dismissed', v_mod_id, now() - interval '3 days',
             'Verificado por WhatsApp: operando a domicilio.', now() - interval '4 days');
    END IF;
END $$;

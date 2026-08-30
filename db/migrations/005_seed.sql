-- =============================================================================
-- eneleje.com · 005 — Seed de producción (roles, tiers, categorías, ciudades,
-- configuración de plataforma). Idempotente (ON CONFLICT DO NOTHING).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------
INSERT INTO roles (slug, name, description, level) VALUES
    ('superadmin', 'Super Administrador', 'Control total: categorías, ciudades, usuarios, tiers.', 100),
    ('moderator',  'Moderador',           'Revisa reportes, suspende/verifica negocios, gestiona catálogo global.', 50),
    ('owner',      'Dueño de Comercio',   'Gestiona su perfil, catálogo y ve sus métricas.', 10)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Tiers de membresía (Free hoy, Premium cuando se active facturación)
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- Categorías principales (slug == subdominio). Ampliable desde /admin.
-- -----------------------------------------------------------------------------
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
    ('lavanderias',     'Lavanderías',       'Lavado y plano, por kilo y a domicilio.',                '🧺', 'shirt',         120)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Ciudades del Eje Cafetero (coordenadas aproximadas de centroide).
-- ⚠ Orden PostGIS: ST_MakePoint(LONGITUD, LATITUD).
-- bbox = [minLon, minLat, maxLon, maxLat] para fitBounds del mapa.
-- -----------------------------------------------------------------------------
INSERT INTO cities (slug, name, department, geom, bbox, population) VALUES
    ('pereira',             'Pereira',            'Risaralda', ST_SetSRID(ST_MakePoint(-75.6961, 4.8133), 4326)::geography, ARRAY[-75.7450, 4.7560, -75.6350, 4.8350], 483000),
    ('dosquebradas',        'Dosquebradas',       'Risaralda', ST_SetSRID(ST_MakePoint(-75.6783, 4.8383), 4326)::geography, ARRAY[-75.7100, 4.8000, -75.6400, 4.8800], 230000),
    ('santa-rosa-de-cabal', 'Santa Rosa de Cabal','Risaralda', ST_SetSRID(ST_MakePoint(-75.6225, 4.8756), 4326)::geography, ARRAY[-75.6600, 4.8400, -75.5900, 4.9100],  77000),
    ('la-virginia',         'La Virginia',        'Risaralda', ST_SetSRID(ST_MakePoint(-75.8742, 4.9036), 4326)::geography, ARRAY[-75.9100, 4.8700, -75.8400, 4.9400],  34000),
    ('marsella',            'Marsella',           'Risaralda', ST_SetSRID(ST_MakePoint(-75.8883, 4.9383), 4326)::geography, ARRAY[-75.9200, 4.9000, -75.8600, 4.9700],  22000),
    ('belen-de-umbria',     'Belén de Umbría',    'Risaralda', ST_SetSRID(ST_MakePoint(-75.8694, 5.2022), 4326)::geography, ARRAY[-75.9000, 5.1700, -75.8400, 5.2300],  27000),
    ('armenia',             'Armenia',            'Quindío',   ST_SetSRID(ST_MakePoint(-75.6811, 4.5339), 4326)::geography, ARRAY[-75.7300, 4.4700, -75.6200, 4.5900], 310000),
    ('calarca',             'Calarcá',            'Quindío',   ST_SetSRID(ST_MakePoint(-75.6486, 4.5336), 4326)::geography, ARRAY[-75.6800, 4.5000, -75.6100, 4.5700],  78000),
    ('circasia',            'Circasia',           'Quindío',   ST_SetSRID(ST_MakePoint(-75.6489, 4.6167), 4326)::geography, ARRAY[-75.6800, 4.5800, -75.6100, 4.6500],  30000),
    ('montenegro',          'Montenegro',         'Quindío',   ST_SetSRID(ST_MakePoint(-75.7506, 4.5452), 4326)::geography, ARRAY[-75.7800, 4.5100, -75.7200, 4.5800],  42000),
    ('manizales',           'Manizales',          'Caldas',    ST_SetSRID(ST_MakePoint(-75.5138, 5.0703), 4326)::geography, ARRAY[-75.5600, 5.0200, -75.4600, 5.1200], 435000),
    ('chinchina',           'Chinchiná',          'Caldas',    ST_SetSRID(ST_MakePoint(-75.6006, 5.0011), 4326)::geography, ARRAY[-75.6300, 4.9700, -75.5700, 5.0300],  40000)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Configuración de plataforma (editable en caliente desde /admin)
-- -----------------------------------------------------------------------------
INSERT INTO system_settings (key, value, description) VALUES
    ('report_alert_threshold',          '3',  'Reportantes distintos que disparan la alerta al moderador.'),
    ('report_suspend_threshold',        '5',  'Reportantes distintos que auto-suspenden el negocio.'),
    ('report_window_days',              '7',  'Ventana móvil (días) para contar reportes.'),
    ('suspension_hours',                '72', 'Duración de la auto-suspensión temporal.'),
    ('interaction_retention_days',      '90', 'Retención de business_interaction_cache antes de purga.'),
    ('registration_max_per_hour_ip',    '3',  'Registros máximos por IP y hora (anti-spam).'),
    ('reports_max_per_day_ip',          '10', 'Reportes máximos por IP y día.'),
    ('tracking_max_per_minute_ip',      '60', 'Eventos de analítica máximos por IP y minuto.')
ON CONFLICT (key) DO NOTHING;

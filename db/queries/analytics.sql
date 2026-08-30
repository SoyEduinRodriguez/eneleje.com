-- =============================================================================
-- eneleje.com · Analítica ligera: escritura, panel del comerciante, purga
-- Pipeline: clic en la UI -> Redis INCR (O(1)) -> flush diario -> esta tabla
--           -> sugerencias automáticas en /panel. Purga automática a N días.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) Escritura directa (fallback sin Redis / reconciliación): RPC atómica
-- -----------------------------------------------------------------------------
SELECT record_interaction('00000000-0000-0000-0000-000000000000'::uuid, 'whatsapp_click');

-- Flujo normal en caliente (Redis): key = int:{business_id}:{type}:{yyyymmdd}
--   INCR int:...   EXPIRE int:... 604800   (8 días: margen para el flush diario)
-- El job diario (03:15) hace SCAN int:* y llama a flush_interactions con el JSON:
SELECT flush_interactions('[
  {"business_id":"00000000-0000-0000-0000-000000000000",
   "day":"2026-08-29","type":"whatsapp_click","hits":42},
  {"business_id":"00000000-0000-0000-0000-000000000000",
   "day":"2026-08-29","type":"profile_view","hits":317}
]'::jsonb);

-- -----------------------------------------------------------------------------
-- B) Panel del comerciante — resumen 30 días con tasa de conversión a WhatsApp
-- -----------------------------------------------------------------------------
SELECT
    SUM(hits) FILTER (WHERE interaction_type = 'profile_view')    AS vistas_perfil,
    SUM(hits) FILTER (WHERE interaction_type = 'whatsapp_click')  AS clics_whatsapp,
    SUM(hits) FILTER (WHERE interaction_type = 'phone_call')      AS llamadas,
    SUM(hits) FILTER (WHERE interaction_type = 'map_open')        AS aperturas_mapa,
    SUM(hits) FILTER (WHERE interaction_type = 'qr_scan')         AS escaneos_qr,
    SUM(hits) FILTER (WHERE interaction_type = 'catalog_view')    AS vistas_catalogo,
    ROUND(
        100.0 * SUM(hits) FILTER (WHERE interaction_type = 'whatsapp_click')
        / NULLIF(SUM(hits) FILTER (WHERE interaction_type = 'profile_view'), 0)
    , 1)                                                          AS tasa_contacto_pct
FROM business_interaction_cache
WHERE business_id = :business_id
  AND day >= current_date - 30;

-- -----------------------------------------------------------------------------
-- C) Serie diaria (gráfica de tendencia 14 días)
-- -----------------------------------------------------------------------------
SELECT day,
       SUM(hits) FILTER (WHERE interaction_type = 'profile_view')   AS vistas,
       SUM(hits) FILTER (WHERE interaction_type = 'whatsapp_click') AS whatsapp
FROM business_interaction_cache
WHERE business_id = :business_id
  AND day >= current_date - 14
GROUP BY day
ORDER BY day;

-- -----------------------------------------------------------------------------
-- D) Sugerencias automáticas de optimización (heurística simple)
--    Muchas vistas + pocos clics  => mejorar fotos/descracción/precios
--    Muchos clics + catálogo bajo => publicar más items del catálogo
-- -----------------------------------------------------------------------------
SELECT
    b.id, b.name,
    SUM(ic.hits) FILTER (WHERE ic.interaction_type = 'profile_view')   AS vistas,
    SUM(ic.hits) FILTER (WHERE ic.interaction_type = 'whatsapp_click') AS whatsapp,
    (SELECT count(*) FROM catalog_items ci WHERE ci.business_id = b.id) AS items_catalogo,
    CASE
        WHEN SUM(ic.hits) FILTER (WHERE ic.interaction_type = 'profile_view') > 50
             AND SUM(ic.hits) FILTER (WHERE ic.interaction_type = 'whatsapp_click')
                 < 0.05 * SUM(ic.hits) FILTER (WHERE ic.interaction_type = 'profile_view')
            THEN 'Mejora tus fotos y la descripción: muchos te ven pero pocos escriben.'
        WHEN SUM(ic.hits) FILTER (WHERE ic.interaction_type = 'whatsapp_click') > 20
             AND (SELECT count(*) FROM catalog_items ci WHERE ci.business_id = b.id) < 5
            THEN 'Tienes demanda: publica más productos en tu catálogo.'
        WHEN b.contingency_updated_at IS NULL
             OR b.contingency_updated_at < now() - interval '7 days'
            THEN 'Actualiza tu estado de contingencia: los clientes buscan esta información.'
        ELSE 'Vas bien. Sigue actualizando tu catálogo y estado.'
    END AS sugerencia
FROM businesses b
JOIN business_interaction_cache ic ON ic.business_id = b.id
WHERE b.id = :business_id
  AND ic.day >= current_date - 30
GROUP BY b.id, b.name, b.contingency_updated_at;

-- -----------------------------------------------------------------------------
-- E) Rankings internos (moderación/home): negocios con más tracción 7 días
-- -----------------------------------------------------------------------------
SELECT b.id, b.name, c.slug AS category_slug, ci.slug AS city_slug,
       SUM(ic.hits) AS total_interacciones
FROM business_interaction_cache ic
JOIN businesses b ON b.id  = ic.business_id
JOIN categories c ON c.id  = b.category_id
JOIN cities ci    ON ci.id = b.city_id
WHERE ic.day >= current_date - 7
  AND b.status = 'published'
GROUP BY b.id, b.name, c.slug, ci.slug
ORDER BY total_interacciones DESC
LIMIT 50;

-- -----------------------------------------------------------------------------
-- F) MANTENIMIENTO PROGRAMADO (job diario 03:15) — ver src/lib/analytics.ts
-- -----------------------------------------------------------------------------
SELECT purge_interaction_cache();            -- retención de system_settings (90 días)
SELECT reactivate_expired_suspensions();     -- republisha negocios cuya suspensión venció
SELECT purge_auth_tokens();                  -- limpia tokens de email vencidos/consumidos

-- Vaciado manual de un rango (operación):
-- DELETE FROM business_interaction_cache WHERE day < current_date - 90;

-- -----------------------------------------------------------------------------
-- G) Rollup mensual opcional (si se quieren métricas históricas más allá de la
--    retención): una fila por negocio/mes/tipo, ~1/30 del volumen.
-- -----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_interactions_monthly AS
SELECT business_id,
       date_trunc('month', day)::date AS month,
       interaction_type,
       SUM(hits) AS hits
FROM business_interaction_cache
GROUP BY business_id, date_trunc('month', day), interaction_type;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_interactions_monthly
    ON mv_interactions_monthly (business_id, month, interaction_type);

-- Refresco tras cada flush: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_interactions_monthly;

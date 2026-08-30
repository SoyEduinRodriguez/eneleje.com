# project_context.md — eneleje.com

> Memoria de proyecto. Léela (o pégala en una nueva sesión de ZCode) para retomar
> el trabajo sin re-explicar nada. Última actualización: 2026-08-30.

---

## 1. Qué es eneleje.com

Directorio comercial **dinámico, auto-mantenido y georreferenciado** para acelerar la
reactivación económica local tras emergencias/sismos (enfoque inicial: Eje Cafetero,
Colombia — Pereira y alrededores).

Modelo de negocio:
- **Auto-registro con publicación inmediata** (sin aprobación previa), moderación
  comunitaria posterior vía reportes/denuncias con umbrales automáticos.
- **Multi-tenancy por subdominio de categoría**: `panaderias.eneleje.com/pereira`
  (la categoría principal única del negocio ES el subdominio; la ciudad va por path).
- **Geolocalización con PostGIS** (`geography(Point,4326)`): "cerca de mí" con radio
  en km y ordenamiento por proximidad.
- Módulos del comercio: WhatsApp Business, redes, QR del local, estado de contingencia
  (normal / solo domicilio / cerrado por daños / centro de acopio), catálogo con
  promociones.
- Tiers: hoy 100% gratis, esquema preparado para Free/Premium (límites declarativos).
- Analítica ligera de interacciones (clics WhatsApp, llamadas, mapa, vistas) con
  purga automática, para alimentar sugerencias al comerciante.

---

## 2. Stack decidido

| Capa | Elección | Por qué (resumen ADR) |
|---|---|---|
| Full Stack | Next.js App Router (RSC + Server Actions) + TypeScript | SSR cacheable, Server Actions para CRUD |
| UI | Tailwind CSS + shadcn/ui | ligero, rápido en móvil inestable |
| Mapas | MapLibre GL JS + tiles vectoriales OSM | sin token obligatorio, liviano |
| BD | PostgreSQL 16 + PostGIS 3.4 | distancias reales en metros, KNN con índice |
| ORM | **Drizzle ORM** (SQL nativo para PostGIS) | Prisma solo soporta PostGIS vía `Unsupported` |
| Caché/Cola | Redis | rate limiting + contadores de analítica O(1) |
| Medios | Cloudflare R2 / S3 (WebP) | upload por URL presignada, la app nunca recibe bytes |
| Edge | Cloudflare (DNS wildcard + SSL) → Nginx → Next.js | wildcard `*.eneleje.com` |
| Auth | JWT de acceso + refresh en cookie httpOnly (lib `jose`) | sin tabla de sesiones |

Convenciones críticas:
- **`ST_MakePoint(LONGITUD, latitud)`** — ese orden, siempre (origen clásico de bugs).
- Slugs en minúscula-guiones; el slug de `categories` = subdominio; slugs reservados
  (`www`, `admin`, `api`...) bloqueados en middleware Y en CHECK de BD.
- RLS: la app se conecta como `eneleje_app` y en cada transacción de escritura ejecuta
  `SET LOCAL app.user_id = '...'` y `SET LOCAL app.role = '...'` (ver
  `src/db/queries-postgis.ts` → `withUserContext`).
- Analítica: clic → Redis `INCR int:{bizId}:{tipo}:{yyyyMMdd}` → job diario hace flush a
  `business_interaction_cache` (agregado por día) → purga a 90 días.

---

## 3. Lo que YA tenemos (inventario real)

### Documentación
- `README.md` — mapa del repo y arranque rápido.
- `docs/ARQUITECTURA.md` — **documento maestro**: topología, contrato de URLs,
  modelo de datos (ER), PostGIS, analítica, moderación, seguridad, despliegue, ADRs.

### Base de datos (DDL completo, validado estáticamente)
- `db/migrations/000_roles.sh` → `006_seed_dev.sql` — migraciones numeradas (para el
  flujo docker-compose con `docker-entrypoint-initdb.d`).
- `db/migrations/zz_ddl_completo_pgadmin.sql` — **DDL todo-en-uno para pgAdmin
  (idempotente, 100% SQL, sin bash)**. Es la fuente que el usuario ejecuta en su
  homelab. Incluye: preflight de extensiones, roles con password, enums, dominios
  (`slug`, `phone_e164`), 12 tablas, 17 índices (GiST/B-Tree/GIN/BRIN), 11 funciones
  y triggers, 25 policies RLS, seeds de producción (12 categorías, 12 ciudades del
  Eje Cafetero, tiers, settings) y datos demo (3 negocios, catálogo, 30 días de
  métricas, reportes).
- `db/queries/geo_search.sql` — hot path con KNN `<->`, "cerca de mí", landing counts.
- `db/queries/analytics.sql` — flush, panel del comerciante, sugerencias, purga.

### Código TypeScript (referencia, aún NO es una app ejecutable)

> ⚠️ Obsoleto: desde el 2026-08-30 SÍ es una app ejecutable — ver la sección siguiente.

### App Next.js EJECUTABLE (Fase 2 completa — 2026-08-30)
- Scaffold en la raíz: `package.json` (Next 15.5 + React 19 + Tailwind v4 + drizzle-orm
  0.44 + pg + ioredis + node-cron + **jose + @node-rs/argon2**), `tsconfig.json` (paths
  `@/*`), `next.config.ts` (`output: 'standalone'`), `postcss.config.mjs`, `.gitignore`.
- **Landing con SEO** (`src/app/page.tsx`): hero, cómo funciona (3 pasos), categorías
  vivas, FAQ, JSON-LD (WebSite + Organization + FAQPage); `sitemap.ts` dinámico
  (157 URLs: categorías × ciudades), `robots.ts`; metadata OG/Twitter/canonical en
  `layout.tsx` con metadataBase.
- **Auth**: `src/lib/auth.ts` (argon2id, JWT en cookie httpOnly `eneleje_session`,
  7 días, `getSession`/`requireSession`), login vía función BD `app_login_lookup`
  (SECURITY DEFINER, ya en el DDL canónico) porque `users_select` impide leer el hash.
  Rutas `(auth)/registro` y `(auth)/entrar` con honeypot + trampa de tiempo (3 s) +
  rate limit en memoria (`src/lib/rate-limit-mem.ts`, interino hasta tener Redis) +
  Turnstile opcional (se activa con env vars). El registro crea la sesión al instante.
- **Panel** `/panel` (layout con sesión obligatoria): mis negocios con estados,
  `negocio/nuevo` (creación con publicación inmediata, GPS opcional, slug por trigger
  de BD), `negocio/[id]` (editar perfil + **estado de contingencia** + redes +
  ubicación), `negocio/[id]/catalogo` (secciones + productos con precio, promo y
  agotado), `negocio/[id]/compartir` (enlace público, invitación WhatsApp, Google
  Maps, QR anunciado para Fase 5).
- **Recuperación de contraseña** (`/recuperar`): token aleatorio de 32 bytes, BD
  guarda solo sha256 en `auth_tokens` (1 h, un solo uso) vía funciones SECURITY
  DEFINER `app_create_reset_token` / `app_consume_reset_token`. Interino sin SMTP:
  con `DEV_RESET_LINK=true` el enlace se muestra en pantalla — **apagar en producción**.
- **Categorías flexibles**: categoría genérica `otros` (🧩 Otros servicios) como
  caída; al registrar un negocio bajo «otros» se exige sugerencia que se guarda en
  `category_suggestions` (vía `app_suggest_category`); `/admin` (solo moderator/
  superadmin) las revisa, crea la categoría real (`categories_moderate` RLS) o las
  descarta (`app_resolve_suggestion`); el dueño puede re-categorizar su negocio
  desde editar perfil. DDL canónico: sección 12.
- **Perfil público**: ahora muestra el menú/catálogo (solo disponible, promos con
  precio tachado) y JSON-LD `LocalBusiness` con geo y teléfono.
- `src/db/queries-postgis.ts`: +`getBusinessBySlug`, `listActiveCities`,
  `listCategoriesWithCounts`, `listAllCategories`, `listMyBusinesses`,
  `getMyBusiness`, `getCityCentroid`, `getBusinessCatalog`; radio solo filtra con
  `radiusM` explícito. `schema.ts`: `citextColumn` customType, `geographyPoint`
  acepta fragmento SQL en insert, `createBusinessAsOwner` genera UUID y slug via BD.
- **Build de producción OK** y E2E completa (ver Fase 2 en plan). Datos de prueba
  vivos: cuenta dueña de "Cafetería El Paraíso" (restaurantes/pereira, con menú) y
  cuenta dueña de los 3 negocios demo. **Credenciales de prueba: ver comentarios al
  final de `.env.local` (gitignored, nunca versionar contraseñas).**
- `src/middleware.ts` — multi-tenancy: `Host` → rewrite `/c/{categoria}/{ciudad}/{negocio}`,
  reservados, tolerante a puertos (dev: `panaderias.localhost:3000`).
- `src/db/schema.ts` — esquema Drizzle completo (enums, `geographyPoint` customType).
- `src/db/queries-postgis.ts` — cliente Drizzle, `searchBusinesses` (KNN),
  `getCityBySlug`, `withUserContext` (RLS), `recordInteraction`, `flushInteractions`,
  `runMaintenance`, `businessInsights30d`.
- `src/lib/analytics.ts` — track con Redis + fallback a PG, flush diario (SCAN+MGET),
  `startScheduler()` (node-cron 03:15).
- `src/lib/rate-limit.ts` — ventana fija atómica con Redis (fail-open si Redis cae).

### Infraestructura
- `infra/docker-compose.yml` — PostGIS 16, Redis 7, app, Nginx (validado sintaxis).
- `infra/Dockerfile` — Next.js standalone multi-stage, usuario no-root.
- `infra/env.example` — todas las variables de entorno documentadas.
- `infra/nginx/conf.d/eneleje.conf` + `snippets/` — wildcard TLS, limit_req por zona,
  headers de seguridad, extracción de `X-Subdomain`.

### Estado del entorno del usuario (homelab) — verificado en vivo el 2026-08-30
- **Trabajamos DIRECTAMENTE en el homelab Ubuntu** (ya no hay flujo Windows → Ubuntu;
  ZCode corre como usuario `homelab` en la misma máquina del Postgres).
- PostgreSQL **18.6** (no 16 como se planeó; el DDL es compatible, 14+). Cliente `psql`
  instalado. pgAdmin presente. BD **`Eneleje`** (con mayúscula inicial) creada.
- ✅ **PostGIS 3.6.2 instalado** (`postgresql-18-postgis-3`).
- ✅ **DDL aplicado y verificado**: 12 tablas + `spatial_ref_sys`, 25 policies RLS,
  seeds (12 categorías, 12 ciudades, 3 negocios demo), hot path KNN probado
  (distancias reales: 150 m / 591 m / 2.9 km desde el centro de Pereira).
- ✅ **Roles con contraseña real**: `eneleje_app` (clave en `.env.local`, conexión y
  RLS probados: ve 3 negocios publicados, 0 users), `eneleje_migrator` (clave guardada
  en `.eneleje_migrator_pass.txt`, chmod 600).
- `.env.local` en la raíz con `DATABASE_URL` (rol `eneleje_app`), `AUTH_SECRET`,
  `IP_HASH_PEPPER`, `PORT=3006`, `NEXT_PUBLIC_ROOT_DOMAIN=eneleje.com`.
- El puerto 3000 del homelab está ocupado por otro servicio → la app corre en **3006**.
- Otras BD en el servidor (de otros proyectos, no tocar): economia_familiar, Ecofamiliar,
  controlprestamos, Controlveh.

---

## 4. Lo que NOS FALTA (brechas concretas)

### P0 — La app existe y sirve el catálogo + registro + panel
- [x] Scaffold Next.js real; `src/` de referencia integrado y corregido (drizzle 0.44).
- [x] Rutas públicas: landing con SEO, `/c/...` completa, `/registro`, `/entrar`.
- [x] Auth real: argon2id + JWT httpOnly (jose) + `app_login_lookup` (SECURITY DEFINER)
      + recuperación de contraseña con tokens (`/recuperar`). Falta email real (SMTP)
      para enviar el enlace automáticamente.
- [x] `/panel`: mis negocios, crear negocio, editar perfil/contingencia, menú, compartir.
- [x] `/admin` inicial (moderador/superadmin): crear categorías + resolver sugerencias.
      PENDIENTE: cola de reportes, suspensiones, verificación de negocios.
- [ ] Credenciales de prueba (2026-08-30): NO versionarlas — están como comentarios
      en `.env.local` (gitignored). Incluyen: dueña de los negocios demo,
      moderador y superadmin de demo (para probar `/admin`), la Cafetería El
      Paraíso con menú, y la cuenta personal del propietario (desbloqueada a mano;
      cambiarla con el flujo de recuperación).
- [ ] Endpoints: `/api/track` (sendBeacon), `/api/health` (app+DB+Redis), `/api/auth/*`
      (mucho ya cubierto por Server Actions; track y health faltan).
- [ ] Rate limit con Redis (hoy: `rate-limit-mem.ts` en memoria, monoproceso).

### P1 — Infraestructura de soporte
- [x] PostGIS instalado: `postgresql-18-postgis-3` 3.6.2 (2026-08-30).
- [x] DDL aplicado a la BD `Eneleje` + roles con contraseña real + verificación KNN/RLS.
- [ ] Redis instalado (¿en el homelab? aún no definido) o Upstash.
- [ ] R2/S3 (o MinIO local) + flujo de upload presignado + optimización a WebP.
- [ ] Nginx/TLS wildcard real y DNS (Cloudflare) — para probar subdominios en prod;
      en dev basta `*.localhost:3000` (Chromium los resuelve a 127.0.0.1).
- [x] `.env` real en la raíz (`.env.local`) con `AUTH_SECRET` e `IP_HASH_PEPPER`
      generados (2026-08-30).

### P2 — Producto y calidad
- [ ] Generador de QR (`/n/{qr_token}` + atribución `qr_scan`).
- [ ] Mapa MapLibre con clustering y chips de contingencia.
- [ ] SEO: sitemap dinámico por categoría/ciudad, canonical por subdominio, OG tags.
- [ ] Facturación Premium (webhook MercadoPago/Wompi → `tier_id`).
- [ ] Pruebas: verificar DDL en vivo, EXPLAIN de las queries KNN, test de RLS
      (`SET ROLE eneleje_app`), test de umbrales de reportes.

---

## 5. Plan de acción sugerido (orden de ejecución)

1. **Fase 0 — BD viva (✅ COMPLETA 2026-08-30)**: PostGIS 3.6.2, DDL aplicado a
   `Eneleje`, roles con contraseña real, KNN y RLS verificados en vivo,
   `DATABASE_URL` → `eneleje_app`.
2. **Fase 1 — App mínima vertical (✅ COMPLETA 2026-08-30)**: scaffold Next.js 15 +
   home + catálogo + perfil. Prueba E2E aprobada: build de prod OK, `/c/panaderias/
   pereira` lista el negocio demo con distancia real (692 m), perfil con CTA WhatsApp
   (`wa.me/573001112233`), subdominio `panaderias.localhost:3006` reescrito por el
   middleware, 404 correctos y estado vacío en ciudad sin negocios. Correr con
   `npx next start -p 3006` (o `next dev -p 3006`).
3. **Fase 2 — Registro y perfil (✅ COMPLETA 2026-08-30)**: `/registro` con anti-bot
   (Turnstile listo vía env vars, honeypot + timing + rate limit activos), auth
   argon2id/JWT, `/panel` con edición de contingencia, menú/catálogo CRUD y enlaces de
   compartición. Fix crítico aplicado: NULLIF en policies RLS (ver lecciones).
4. **Fase 3 — Mapa y búsqueda (SIGUIENTE)**: MapLibre, "cerca de mí" con
   geolocalización del móvil. Nota: la búsqueda KNN ya está operativa server-side.
4. **Fase 3 — Mapa y búsqueda**: MapLibre, "cerca de mí" con geolocalización del móvil.
5. **Fase 4 — Moderación**: reportes públicos, cola `/admin`, umbrales (trigger ya
   implementado en BD), verificación.
6. **Fase 5 — Analítica y QR**: `/api/track`, Redis, panel de métricas con sugerencias.
7. **Fase 6 — Despliegue**: docker-compose en el homelab (o VPS), Cloudflare wildcard,
   R2, backups `pg_dump`.

### Estado del repositorio
- Git inicializado (rama `main`) y publicado en GitHub (2026-08-30):
  **https://github.com/SoyEduinRodriguez/eneleje.com** — **PRIVADO** (pasar a público
  con `gh repo edit SoyEduinRodriguez/eneleje.com --visibility public --accept-visibility-change-consequences`).
- Commit inicial: `03aad76` con Fases 0-2. Auditado: sin secretos versionados
  (`.env.local`, `.eneleje_migrator_pass.txt` y credenciales de prueba solo en local).

---

## 6. Cómo retomar una sesión (plantilla)

> "Lee `project_context.md` y `docs/ARQUITECTURA.md` de eneleje.com. Estamos en la
> Fase N. Continúa con: <tarea concreta>. La BD PostGIS ya está corriendo en el
> homelab (Ubuntu, pgAdmin, BD `eneleje`, DDL consolidado aplicado)."

Lecciones aprendidas que conviene no repetir:
- El import por archivos falló por `000_roles.sh` (bash, no SQL) y CRLF de Windows;
  por eso existe `zz_ddl_completo_pgadmin.sql` — **ese es el DDL canónico para manos**.
- **PostgreSQL 18 + RLS: tras `set_config('app.user_id', x, true)` + COMMIT,
  `current_setting('app.user_id', true)` devuelve `''` (no NULL) en esa sesión, y
  `''::uuid` lanza error 22P02.** Fix aplicado: `NULLIF(current_setting(...), '')::uuid`
  en TODAS las policies (DDL canónico corregido y aplicado en vivo a las 11 policies).
  Síntoma clásico: "invalid input syntax for type uuid: ''" intermitente según qué
  conexión del pool sirva la query.
- **INSERT ... RETURNING bajo RLS exige policy SELECT**: el registro fallaba porque
  `users_select` no cubría la fila nueva. Fix: generar UUID en la app y hacer el INSERT
  dentro de `withUserContext` (app.user_id = nuevo id).
- Login bajo RLS: `users_select` no deja leer el password_hash → función
  `app_login_lookup` SECURITY DEFINER (en el DDL canónico, sección 11).
- drizzle-orm 0.44: (a) NO exporta `citext` → customType `citextColumn`; (b)
  `db.execute<T>` exige `type` (no `interface`) por index signature; (c) spread de
  `$inferInsert & {x?: never}` truena → usar `Omit`; (d) `slug` NOT NULL sin default
  se pasa como `''` y el trigger de BD lo reemplaza.
- El CLI de Next NO lee `PORT` desde `.env`: pasar `-p` explícito. En el homelab el
  puerto 3000 ya está ocupado por otro servicio → usar **3006**.
- `next start` advierte con `output: 'standalone'` (funciona igual en dev); en Docker
  usar `node .next/standalone/server.js` como ya hace `infra/Dockerfile`.
- Los grep de verificación sobre HTML de React fallan por nodos de comentario del SSR:
  usar `sed 's/<[^>]*>/ /g'` antes de grep.

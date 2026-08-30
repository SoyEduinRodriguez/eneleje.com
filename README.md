# eneleje.com — Directorio comercial georreferenciado

Plataforma de auto-registro con publicación inmediata, moderación comunitaria posterior y
multi-tenancy por subdominio de categoría (`panaderias.eneleje.com/pereira`), pensada para
reactivar la economía local tras emergencias y sismos (enfoque inicial: Eje Cafetero, Colombia).

## Qué funciona hoy

- **Landing con SEO**: hero, cómo funciona, FAQ con datos estructurados (JSON-LD
  WebSite + Organization + FAQPage), `sitemap.xml` dinámico y `robots.txt`.
- **Catálogo público**: `/{categoría}/{ciudad}/{negocio}` con distancias reales en
  metros (PostGIS KNN), badges de contingencia y chips de ciudad.
- **Registro de negocios con publicación inmediata**: cuenta gratuita, formulario
  con honeypot + trampa de tiempo + rate limit + Cloudflare Turnstile (opcional).
- **Panel del comerciante**: estado de contingencia (normal / solo domicilio /
  cerrado por daños / centro de acopio), datos del anuncio, re-categorización,
  menú/catálogo con promociones y enlaces de compartición (WhatsApp, Maps).
- **Autenticación**: argon2id + JWT en cookie httpOnly, recuperación de contraseña
  por token de un solo uso, y funciones SECURITY DEFINER para operar bajo RLS.
- **Administración inicial** (`/admin`, moderadores): creación de categorías y
  resolución de sugerencias (los negocios sin categoría viven en «Otros servicios»).
- **RLS de PostgreSQL 18** en toda la escritura: la app corre como `eneleje_app`
  y cada transacción fija `app.user_id` / `app.role`.

## Mapa del repositorio

| Ruta | Contenido |
|---|---|
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | **Documento maestro**: arquitectura, routing multi-tenant, modelo de datos, seguridad, despliegue y ADRs |
| [db/migrations/zz_ddl_completo_pgadmin.sql](db/migrations/zz_ddl_completo_pgadmin.sql) | **DDL todo-en-uno** (PostgreSQL 14+ con PostGIS): roles, enums, 13 tablas, índices, 25 policies RLS, funciones, seeds y datos demo |
| [db/migrations/](db/migrations) | Migraciones numeradas para docker-entrypoint-initdb.d |
| [db/queries/](db/queries) | SQL de referencia: hot path geográfico y pipeline de analítica |
| [src/app/](src/app) | Next.js App Router: landing, catálogo, registro, panel, admin |
| [src/middleware.ts](src/middleware.ts) | Multi-tenancy: subdominio → categoría, path → ciudad |
| [src/db/schema.ts](src/db/schema.ts) | Esquema Drizzle ORM (tipos espaciales incluidos) |
| [src/db/queries-postgis.ts](src/db/queries-postgis.ts) | Integración PostGIS desde TypeScript (KNN, RLS, analítica) |
| [src/lib/](src/lib) | Auth (argon2id/JWT), rate limit, validación, Turnstile |
| [infra/](infra) | Docker Compose, Dockerfile, Nginx y variables de entorno |

## Arranque rápido (desarrollo sin Docker)

Requisitos: Node 20+, PostgreSQL 14+ con PostGIS (en Ubuntu:
`sudo apt install postgresql-18-postgis-3`).

```bash
# 1. Base de datos (como superusuario de Postgres)
createdb Eneleje
psql -d Eneleje -f db/migrations/zz_ddl_completo_pgadmin.sql

# 2. Entorno de la app
cp .env.example .env.local        # ajusta DATABASE_URL y genera AUTH_SECRET/IP_HASH_PEPPER
npm install

# 3. Correr
npx next dev -p 3006              # o: npm run build && npx next start -p 3006
```

La primera cuenta que registres en `/registro` puede crear negocios al instante.
Para probar los subdominios en local, el middleware reescribe
`panaderias.localhost:3006` → `/c/panaderias` (Chromium resuelve `*.localhost`
a `127.0.0.1`).

## Seguridad

- Los archivos `.env`, `.env.local` y credenciales operativas están **gitignored**;
  nunca se versionan contraseñas.
- `DEV_RESET_LINK=true` muestra en pantalla el enlace de recuperación (solo
  desarrollo, sin SMTP). **Apágalo en producción.**
- Las políticas RLS usan `NULLIF(current_setting(...), '')::uuid`: en PostgreSQL 18
  un `set_config` local deja `''` (no NULL) tras el commit y el cast directo falla.

## Stack

Next.js 15 (App Router, Server Components + Server Actions) · TypeScript · Tailwind CSS ·
PostgreSQL 14+ con PostGIS · Drizzle ORM · Redis (opcional en desarrollo) ·
jose + argon2id · Cloudflare R2 / S3 (media, en preparación) · Nginx + Cloudflare
(DNS wildcard + SSL) en despliegue.

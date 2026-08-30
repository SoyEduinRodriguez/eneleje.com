/**
 * eneleje.com · Esquema Drizzle ORM (espejo de db/migrations/002_schema.sql)
 *
 * PostGIS: Drizzle no tiene tipo geography nativo; se declara con customType y
 * los puntos se leen/escriben con fragments SQL (ST_Y/ST_X, ST_MakePoint).
 * Ver helpers en src/db/queries-postgis.ts.
 */
import { sql } from 'drizzle-orm';
import {
  bigint, boolean, char, customType, date, index, integer,
  jsonb, numeric, pgEnum, pgTable, primaryKey, smallint, text,
  timestamp, unique, uuid, varchar,
} from 'drizzle-orm/pg-core';

/* ------------------------------- enums ---------------------------------- */

export const userStatus = pgEnum('user_status', ['active', 'suspended', 'deleted']);
export const businessStatus = pgEnum('business_status', [
  'published', 'suspended', 'blocked', 'closed_by_owner',
]);
export const contingencyStatus = pgEnum('contingency_status', [
  'normal', 'delivery_only', 'closed_damage', 'collection_center', 'unknown',
]);
export const reportReason = pgEnum('report_reason', [
  'spam', 'false_data', 'closed_business', 'inappropriate_content',
  'duplicate', 'wrong_location', 'other',
]);
export const reportStatus = pgEnum('report_status', [
  'pending', 'under_review', 'validated', 'dismissed',
]);
export const interactionType = pgEnum('interaction_type', [
  'profile_view', 'whatsapp_click', 'phone_call', 'map_open',
  'qr_scan', 'share', 'catalog_view', 'route_click',
]);
export const authTokenPurpose = pgEnum('auth_token_purpose', [
  'email_verification', 'password_reset',
]);

/* --------------------------- tipos espaciales ---------------------------- */

/**
 * geography(Point,4326). En inserts se pasa el fragmento geogPoint(lon, lat);
 * en selects nunca se materializa la columna: se proyecta con ST_Y/ST_X.
 * data: unknown para aceptar el fragmento SQL en insert (drizzle no tiene
 * tipo geography nativo) y porque jamás se lee la columna cruda.
 */
export const geographyPoint = customType<{ data: unknown; driverData: string }>({
  dataType() {
    return 'geography(Point,4326)';
  },
});

/**
 * Email case-insensitive (columntype citext de la extensión citext).
 * drizzle-orm 0.44 aún no lo trae nativo: customType equivalente.
 */
export const citextColumn = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

/* ------------------------------- tablas ---------------------------------- */

export const roles = pgTable('roles', {
  id: smallint('id').generatedAlwaysAsIdentity().primaryKey(),
  slug: varchar('slug', { length: 30 }).notNull().unique(),
  name: varchar('name', { length: 60 }).notNull(),
  description: varchar('description', { length: 200 }),
  level: smallint('level').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  roleId: smallint('role_id').notNull().references(() => roles.id),
  email: citextColumn('email').notNull().unique(),
  passwordHash: text('password_hash'),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  status: userStatus('status').notNull().default('active'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const categories = pgTable('categories', {
  id: smallint('id').generatedAlwaysAsIdentity().primaryKey(),
  slug: varchar('slug', { length: 64 }).notNull().unique(), // == subdominio
  name: varchar('name', { length: 80 }).notNull(),
  description: varchar('description', { length: 300 }),
  icon: varchar('icon', { length: 60 }),
  emoji: varchar('emoji', { length: 8 }),
  sortOrder: smallint('sort_order').notNull().default(100),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cities = pgTable('cities', {
  id: smallint('id').generatedAlwaysAsIdentity().primaryKey(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  department: varchar('department', { length: 120 }),
  geom: geographyPoint('geom').notNull(),
  // bbox double precision[4] se consulta por SQL crudo (ver getCityBySlug):
  // Drizzle no modela arrays de doubles sin customType y no se escribe desde la app.
  population: integer('population'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptionTiers = pgTable('subscription_tiers', {
  id: smallint('id').generatedAlwaysAsIdentity().primaryKey(),
  slug: varchar('slug', { length: 30 }).notNull().unique(),
  name: varchar('name', { length: 60 }).notNull(),
  description: varchar('description', { length: 300 }),
  priceCents: integer('price_cents').notNull().default(0),
  currency: char('currency', { length: 3 }).notNull().default('COP'),
  maxPhotos: integer('max_photos'), // NULL = ilimitado
  maxCatalogItems: integer('max_catalog_items'),
  adsFree: boolean('ads_free').notNull().default(false),
  hasBadge: boolean('has_badge').notNull().default(false),
  features: jsonb('features').notNull().default(sql`'[]'::jsonb`),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: smallint('sort_order').notNull().default(100),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const businesses = pgTable(
  'businesses',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    categoryId: smallint('category_id').notNull().references(() => categories.id),
    cityId: smallint('city_id').notNull().references(() => cities.id),
    tierId: smallint('tier_id').notNull().default(1).references(() => subscriptionTiers.id),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 140 }).notNull(), // trigger lo genera si falta
    shortDescription: varchar('short_description', { length: 200 }),
    description: text('description'),
    whatsappPhone: varchar('whatsapp_phone', { length: 20 }).notNull(),
    phone: varchar('phone', { length: 20 }),
    address: varchar('address', { length: 240 }),
    neighborhood: varchar('neighborhood', { length: 120 }),
    geom: geographyPoint('geom').notNull(),
    contingencyStatus: contingencyStatus('contingency_status').notNull().default('unknown'),
    contingencyNote: varchar('contingency_note', { length: 280 }),
    contingencyUpdatedAt: timestamp('contingency_updated_at', { withTimezone: true }),
    status: businessStatus('status').notNull().default('published'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    suspendedUntil: timestamp('suspended_until', { withTimezone: true }),
    suspensionReason: varchar('suspension_reason', { length: 300 }),
    flaggedAt: timestamp('flagged_at', { withTimezone: true }),
    websiteUrl: varchar('website_url', { length: 300 }),
    instagramUrl: varchar('instagram_url', { length: 300 }),
    facebookUrl: varchar('facebook_url', { length: 300 }),
    tiktokUrl: varchar('tiktok_url', { length: 300 }),
    logoUrl: varchar('logo_url', { length: 400 }),
    coverUrl: varchar('cover_url', { length: 400 }),
    openingHours: jsonb('opening_hours'),
    qrToken: uuid('qr_token').notNull().default(sql`gen_random_uuid()`).unique(),
    isVerified: boolean('is_verified').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('businesses_city_slug_unique').on(t.cityId, t.slug),
    index('idx_businesses_owner').on(t.ownerId),
  ],
);

export const catalogCategories = pgTable(
  'catalog_categories',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    slug: varchar('slug', { length: 90 }).notNull(),
    sortOrder: smallint('sort_order').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('catalog_categories_unique').on(t.businessId, t.slug)],
);

export const catalogItems = pgTable(
  'catalog_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
    catalogCategoryId: uuid('catalog_category_id').notNull().references(() => catalogCategories.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    description: varchar('description', { length: 500 }),
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('COP'),
    promoPrice: numeric('promo_price', { precision: 12, scale: 2 }),
    promoEndsAt: timestamp('promo_ends_at', { withTimezone: true }),
    photoUrl: varchar('photo_url', { length: 400 }),
    isAvailable: boolean('is_available').notNull().default(true),
    sortOrder: smallint('sort_order').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_catalog_items_listing').on(t.businessId, t.catalogCategoryId, t.sortOrder)],
);

export const businessReports = pgTable(
  'business_reports',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    reporterIpHash: varchar('reporter_ip_hash', { length: 64 }),
    reporterFingerprint: varchar('reporter_fingerprint', { length: 64 }),
    reason: reportReason('reason').notNull(),
    details: varchar('details', { length: 1000 }),
    status: reportStatus('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    resolutionNote: varchar('resolution_note', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_reports_ip').on(t.reporterIpHash, t.createdAt)],
);

export const businessInteractionCache = pgTable(
  'business_interaction_cache',
  {
    businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    interactionType: interactionType('interaction_type').notNull(),
    hits: bigint('hits', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.businessId, t.day, t.interactionType] }),
    index('idx_interaction_cache_biz_day').on(t.businessId, t.day),
  ],
);

export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: authTokenPurpose('purpose').notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const systemSettings = pgTable('system_settings', {
  key: varchar('key', { length: 60 }).primaryKey(),
  value: jsonb('value').notNull(),
  description: varchar('description', { length: 200 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* --------------------------- tipos inferidos ------------------------------ */

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type City = typeof cities.$inferSelect;
export type CatalogItem = typeof catalogItems.$inferSelect;

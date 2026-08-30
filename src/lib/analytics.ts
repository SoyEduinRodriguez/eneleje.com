/**
 * eneleje.com · Analítica ligera (Redis -> Postgres -> purga)
 *
 * Caliente (cada clic, O(1)):   Redis INCR int:{businessId}:{type}:{yyyyMMdd} EX 8d
 * Frío (job diario 03:15):      SCAN int:* -> flush_interactions(jsonb) -> DEL
 *                               + purge_interaction_cache()
 *                               + reactivate_expired_suspensions()
 *
 * Fallback: si Redis no responde, el clic va directo a la RPC record_interaction
 * (menos barato, pero nunca se pierde una métrica en una emergencia).
 *
 * El scheduler se activa llamando startScheduler() desde instrumentation.ts
 * (register()) SOLO en la instancia designada: ENABLE_SCHEDULER=true.
 * En Vercel: sustituir por app/api/cron/analytics/route.ts + vercel.json crons.
 */
import Redis from 'ioredis';
import { sql } from 'drizzle-orm';
import { db, flushInteractions, recordInteraction, runMaintenance } from '@/db/queries-postgis';

/* --------------------------------- cliente -------------------------------- */

let redisSingleton: Redis | null = null;

export function getRedis(): Redis {
  if (!redisSingleton) {
    redisSingleton = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
  }
  return redisSingleton;
}

/* --------------------------------- caliente ------------------------------- */

export type InteractionKind =
  | 'profile_view' | 'whatsapp_click' | 'phone_call' | 'map_open'
  | 'qr_scan' | 'share' | 'catalog_view' | 'route_click';

const KEY_PREFIX = 'int';
const FLUSH_TTL_SECONDS = 8 * 24 * 60 * 60; // margen de 8 días para el flush diario

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Endpoint objetivo: POST /api/track  (navigator.sendBeacon o fetch keepalive).
 * El rate limit (60/min/IP) lo aplica Nginx y/o enforceRateLimit en el handler.
 */
export async function trackInteraction(businessId: string, type: InteractionKind): Promise<void> {
  const day = today();
  try {
    const redis = getRedis();
    const key = `${KEY_PREFIX}:${businessId}:${type}:${day}`;
    await redis.multi().incr(key).expire(key, FLUSH_TTL_SECONDS).exec();
  } catch {
    // Redis caído: persistencia directa (upsert atómico en business_interaction_cache)
    try {
      await recordInteraction(businessId, type);
    } catch (dbErr) {
      // Ni Redis ni PG: se descarta el evento; es métrica, nunca flujo crítico.
      console.error('[analytics] evento descartado', dbErr);
    }
  }
}

/* ------------------------------------ frío -------------------------------- */

interface InteractionEvent {
  business_id: string;
  day: string;
  type: string;
  hits: number;
}

/** Lee los contadores de Redis (SCAN + MGET por lotes), vuelca a Postgres y
 *  borra SOLO las llaves ya confirmadas por el flush. */
export async function flushFromRedis(): Promise<{ flushed: number; keysDeleted: number }> {
  const redis = getRedis();

  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${KEY_PREFIX}:*`, 'COUNT', 1000);
    cursor = next;
    if (batch.length > 0) keys.push(...batch);
  } while (cursor !== '0');

  const events = new Map<string, InteractionEvent>();
  const keysByEvent = new Map<string, string[]>();

  for (let i = 0; i < keys.length; i += 500) {
    const batch = keys.slice(i, i + 500);
    const values = await redis.mget(...batch);
    for (let j = 0; j < batch.length; j++) {
      const hits = Number(values[j] ?? 0);
      if (!hits) continue;
      // int:{uuid}:{tipo}:{fecha} — el uuid contiene '-', tipo y fecha no contienen ':'
      const [, businessId, type, day] = batch[j].split(':');
      if (!businessId || !type || !day) continue;

      const eventId = `${businessId}|${day}|${type}`;
      const existing = events.get(eventId);
      if (existing) existing.hits += hits;
      else events.set(eventId, { business_id: businessId, day, type, hits });

      const bucket = keysByEvent.get(eventId) ?? [];
      bucket.push(batch[j]);
      keysByEvent.set(eventId, bucket);
    }
  }

  const eventList = [...events.values()];
  if (eventList.length === 0) return { flushed: 0, keysDeleted: 0 };

  await flushInteractions(eventList); // upsert idempotente (hits = hits + excluded)

  const toDelete = [...keysByEvent.values()].flat();
  for (let i = 0; i < toDelete.length; i += 500) {
    await redis.del(...toDelete.slice(i, i + 500));
  }
  return { flushed: eventList.length, keysDeleted: toDelete.length };
}

/* --------------------------------- scheduler ------------------------------ */

/** Job diario 03:15 (hora del servidor): flush + purga + reactivaciones. */
export function startScheduler(): void {
  if (process.env.ENABLE_SCHEDULER !== 'true') return;

  // Import dinámico: solo la instancia con ENABLE_SCHEDULER carga node-cron.
  void import('node-cron').then(({ default: cron }) => {
    cron.schedule('15 3 * * *', async () => {
      try {
        const flushed = await flushFromRedis();
        const maintenance = await runMaintenance();
        await db.execute(sql`SELECT purge_auth_tokens()`);
        console.log('[analytics] flush', flushed, 'mantenimiento', maintenance);
      } catch (err) {
        console.error('[analytics] job diario falló (se reintenta mañana; Redis retiene 8 días)', err);
      }
    });
    console.log('[analytics] scheduler activo (03:15 diario)');
  });
}
